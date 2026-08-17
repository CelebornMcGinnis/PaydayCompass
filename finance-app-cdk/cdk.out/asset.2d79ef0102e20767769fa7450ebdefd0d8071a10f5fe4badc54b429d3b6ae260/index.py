"""
Budgets / Projections Lambda
Routes:
  GET  /budgets       -> list this user's budgets (one row per category)
  POST /budgets       -> create/update a budget (category, monthlyAmount, startDate)
  GET  /projections    -> projected net income vs. budgets/goals

Budget start-date rule (as discussed): the budget doesn't take effect on the
literal startDate the user picked - it snaps forward to the next scheduled
paycheck on/after that date, so a budget change never splits a pay period.

Cross-account aggregation: category spend is summed across ALL of the user's
accounts using the transactions table's `byUserAndCategory` GSI, not scoped
to a single account.

Income frequency handling: weekly, bi-weekly (every 14 days, drifts across
months), semi-monthly (fixed calendar days, e.g. 1st & 15th), or annual.
Normalize all income sources to a monthly-equivalent for projection math.
One-time credits (bonus/gift, added via POST /accounts/{accountId}/income) are
included in aggregation/projections by default regardless of category -
tracked via the sparse `byOneTimeCreditIncluded` GSI, which only contains
credits the user hasn't explicitly excluded (their "don't include in
aggregations" checkbox). A credit dated in a future month counts toward
THAT month's projection once queried for that period, not the current one -
the month window here is bounded on both ends so a future-dated deposit
never bleeds into "this month" incorrectly.
"""
import os
import json
import decimal
from datetime import date
import boto3
from finance_common.schedule import next_date_after, add_months
from finance_common.budget_notify import get_active_budgets, category_spend_all_accounts
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])

FREQUENCY_TO_MONTHLY_MULTIPLIER = {
    "weekly": decimal.Decimal(52) / decimal.Decimal(12),
    "biweekly": decimal.Decimal(26) / decimal.Decimal(12),
    "semimonthly": decimal.Decimal(2),
    "monthly": decimal.Decimal(1),
    "annual": decimal.Decimal(1) / decimal.Decimal(12),
}


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource == "/projections" and method == "GET":
        return _get_projections(user_id, event.get("queryStringParameters") or {})

    if method == "GET":
        return _list_budgets(user_id)
    if method == "POST":
        return _upsert_budget(user_id, json.loads(event.get("body") or "{}"))

    return _response(405, {"error": "Method not allowed"})


def _list_budgets(user_id):
    """Returns the currently-active budget per category (not full history),
    each annotated with spentAmount - the actual month-to-date DEBIT spend
    for that category, aggregated across every account. Previously this
    endpoint returned budget rows with no spend at all, which forced the
    frontend into fetching every account's full transaction history just
    to render a progress bar - moving that computation server-side, where
    it belongs, since the backend already has the right indexes for it."""
    today = date.today().isoformat()
    active_budgets = get_active_budgets(user_id, today)

    for budget in active_budgets:
        spend = category_spend_all_accounts(user_id, budget["category"], budget["effectiveStartDate"])
        budget["spentAmount"] = spend

    return _response(200, active_budgets, default=_decimal_default)


def _upsert_budget(user_id, body):
    category = body["category"]
    requested_start = body["startDate"]  # e.g. "2026-08-15"

    effective_start = _next_paycheck_on_or_after(user_id, requested_start)

    item = {
        "userId": user_id,
        "sk": f"{category}#{effective_start}",
        "category": category,
        "monthlyAmount": decimal.Decimal(str(body["monthlyAmount"])),
        "requestedStartDate": requested_start,
        "effectiveStartDate": effective_start,
    }
    budgets_table.put_item(Item=item)
    return _response(201, item, default=_decimal_default)


def _get_income_templates(user_id):
    """Active recurring income sources, via the per-user GSI (never crosses
    into another user's data)."""
    items = recurring_table.query(
        IndexName="byUserAndNextDue",
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    return [i for i in items if i.get("isIncome") and i.get("activeFlag") == "true"]


def _next_paycheck_on_or_after(user_id, requested_date):
    """Finds the next scheduled paycheck date on/after requested_date, so a
    budget's effective start never splits a pay period. Falls back to the
    requested date itself if no income schedule is set up yet."""
    income_templates = _get_income_templates(user_id)
    if not income_templates:
        return requested_date

    candidates = []
    for template in income_templates:
        current = template["nextDueDate"]
        # Bounded walk forward (max 60 occurrences) in case nextDueDate is
        # far in the past relative to requested_date.
        for _ in range(60):
            if current >= requested_date:
                candidates.append(current)
                break
            current = next_date_after(template, current)

    return min(candidates) if candidates else requested_date


def _get_planned_expense_monthly_contributions(user_id):
    """Monthly-equivalent amount to set aside for each planned/annual expense,
    independent of that item's own display contributionFrequency - projections
    need everything normalized to the same monthly basis to be comparable."""
    items = planned_expenses_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])

    today = date.today()
    contributions = []
    for item in items:
        remaining = decimal.Decimal(str(item["targetAmount"])) - decimal.Decimal(str(item.get("amountSaved", 0)))
        if remaining <= 0:
            continue
        target = date.fromisoformat(item["targetDate"])
        months_remaining = max((target.year - today.year) * 12 + (target.month - today.month), 1)
        monthly_amount = remaining / decimal.Decimal(months_remaining)
        contributions.append(
            {
                "plannedExpenseId": item["plannedExpenseId"],
                "name": item.get("name", "Untitled"),
                "targetDate": item["targetDate"],
                "monthlyContribution": monthly_amount,
            }
        )
    return contributions


def _get_one_time_credits_this_month(user_id, today):
    """Sum of one-time credits (bonuses/gifts) dated within the current
    calendar month that the user has NOT excluded from aggregation.
    Bounded on both ends so a credit dated in a different month - past or
    future - is never miscounted into "this month"."""
    month_start = today[:7] + "-01"  # "2026-08-15" -> "2026-08-01"
    next_month_start = add_months(date.fromisoformat(month_start), 1).isoformat()

    result = transactions_table.query(
        IndexName="byOneTimeCreditIncluded",
        KeyConditionExpression="oneTimeCreditUserId = :uid AND createdAt BETWEEN :start AND :end",
        ExpressionAttributeValues={
            ":uid": user_id,
            ":start": month_start,
            ":end": next_month_start,  # inclusive upper bound; fine since createdAt is a full timestamp/date string, not exactly midnight
        },
    )
    items = result.get("Items", [])
    return sum(decimal.Decimal(str(i["amount"])) for i in items)


def _get_projections(user_id, query_params):
    today = date.today().isoformat()

    income_templates = _get_income_templates(user_id)
    recurring_monthly_income = sum(
        (
            decimal.Decimal(str(t["estimatedAmount"]))
            * FREQUENCY_TO_MONTHLY_MULTIPLIER.get(t["frequency"], decimal.Decimal(1))
        )
        for t in income_templates
    )

    one_time_credits_this_month = _get_one_time_credits_this_month(user_id, today)
    total_income_this_month = recurring_monthly_income + one_time_credits_this_month

    active_budgets = get_active_budgets(user_id, today)
    total_budgeted = sum(decimal.Decimal(str(b["monthlyAmount"])) for b in active_budgets)
    spent_so_far = sum(
        category_spend_all_accounts(user_id, b["category"], b["effectiveStartDate"]) for b in active_budgets
    )

    planned_contributions = _get_planned_expense_monthly_contributions(user_id)
    total_planned_monthly = sum(c["monthlyContribution"] for c in planned_contributions)

    projected_leftover = total_income_this_month - total_budgeted - total_planned_monthly

    return _response(
        200,
        {
            "asOfDate": today,
            "income": {
                "recurringMonthlyIncome": recurring_monthly_income,
                "oneTimeCreditsThisMonth": one_time_credits_this_month,
                "totalThisMonth": total_income_this_month,
            },
            "totalBudgeted": total_budgeted,
            "spentSoFarThisPeriod": spent_so_far,
            "plannedExpenses": {
                "totalMonthlyContribution": total_planned_monthly,
                "items": planned_contributions,
            },
            "projectedLeftover": projected_leftover,
        },
        default=_decimal_default,
    )


