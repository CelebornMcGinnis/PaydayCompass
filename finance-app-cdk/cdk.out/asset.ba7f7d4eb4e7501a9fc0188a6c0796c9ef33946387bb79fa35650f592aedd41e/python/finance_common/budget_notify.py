"""
Budget lookup, cross-account category spend aggregation, and the
budget-threshold notification trigger - the logic that used to be
duplicated nearly verbatim across csv_import_export/, recurring_processor/,
and transactions/ (the notification-check quad), and separately across
budgets/ and scenarios/ (get_active_budgets, for projections).

Requires BUDGETS_TABLE, TRANSACTIONS_TABLE environment variables (every
function gets these via commonEnv). trigger_budget_check additionally
needs NOTIFICATIONS_FN_NAME to actually invoke the alert - if that env var
isn't set on the calling function, it's a no-op rather than an error, so
functions that don't need to send alerts can still import this module for
the lookup/aggregation helpers alone.
"""
import os
import json
import decimal
from datetime import date
import boto3

from .cognito_lookup import lookup_email_by_sub
from .user_preferences import get_preference

_dynamodb = boto3.resource("dynamodb")
_lambda_client = boto3.client("lambda")


def _budgets_table():
    return _dynamodb.Table(os.environ["BUDGETS_TABLE"])


def _transactions_table():
    return _dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])


def get_active_budget(user_id, category, as_of_date):
    """The single most recent budget for ONE category with
    effectiveStartDate <= as_of_date, or None."""
    result = _budgets_table().query(
        KeyConditionExpression="userId = :uid AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":uid": user_id, ":prefix": f"{category}#"},
        ScanIndexForward=False,
    )
    for item in result.get("Items", []):
        if item["effectiveStartDate"] <= as_of_date:
            return item
    return None


def get_active_budgets(user_id, as_of_date):
    """The active budget for EVERY category the user has one for, as of
    as_of_date - used by projections, which need the whole set rather
    than a single category."""
    result = _budgets_table().query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    by_category = {}
    for item in result.get("Items", []):
        if item["effectiveStartDate"] > as_of_date:
            continue
        category = item["category"]
        existing = by_category.get(category)
        if not existing or item["effectiveStartDate"] > existing["effectiveStartDate"]:
            by_category[category] = item
    return list(by_category.values())


def category_spend_all_accounts(user_id, category, since_date):
    """Sum of debit spend for a category across every account the user
    owns, since since_date - the cross-account aggregation budgets and
    projections are built on."""
    result = _transactions_table().query(
        IndexName="byUserAndCategory",
        KeyConditionExpression="userId = :uid AND category = :cat",
        ExpressionAttributeValues={":uid": user_id, ":cat": category},
    )
    items = [i for i in result.get("Items", []) if i["createdAt"] >= since_date and i.get("direction") == "debit"]
    return sum(decimal.Decimal(str(i["amount"])) for i in items)


def trigger_budget_check(user_id, account_id, category, net_change_amount):
    """Re-checks the 80%/100%/repeat-over-100% thresholds for a category
    after its debit spend increases by net_change_amount, and invokes
    notifications-fn if a threshold was crossed. No-ops (does nothing,
    doesn't raise) if there's no budget for the category, no user email
    on file, the user has turned budget alerts off, or the calling
    function has no NOTIFICATIONS_FN_NAME set. Never called for decreases
    (net_change_amount <= 0) - crossing a threshold downward isn't
    alert-worthy."""
    notifications_fn_name = os.environ.get("NOTIFICATIONS_FN_NAME")
    if net_change_amount is None or net_change_amount <= 0 or not notifications_fn_name:
        return
    if not get_preference(user_id, "budgetAlertsEnabled", True):
        return

    today = date.today().isoformat()
    budget = get_active_budget(user_id, category, today)
    if not budget:
        return

    since_date = budget["effectiveStartDate"]
    new_total = category_spend_all_accounts(user_id, category, since_date)
    previous_total = new_total - net_change_amount

    user_email = lookup_email_by_sub(user_id)
    if not user_email:
        return

    _lambda_client.invoke(
        FunctionName=notifications_fn_name,
        InvocationType="Event",
        Payload=json.dumps(
            {
                "userId": user_id,
                "userEmail": user_email,
                "category": category,
                "accountId": account_id,
                "newSpendTotal": float(new_total),
                "previousSpendTotal": float(previous_total),
                "budgetAmount": float(budget["monthlyAmount"]),
            }
        ),
    )
