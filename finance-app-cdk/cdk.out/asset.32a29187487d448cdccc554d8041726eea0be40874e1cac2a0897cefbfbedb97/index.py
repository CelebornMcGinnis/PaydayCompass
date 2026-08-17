"""
Budgets / Projections Lambda
Routes:
  GET  /budgets       -> list this user's budgets (one row per category)
  POST /budgets       -> create/update a budget (category, amount, frequency, startDate)
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
from finance_common.budget_frequency import to_monthly_equivalent, recurring_item_monthly_equivalent
from finance_common.budget_notify import get_active_budgets, category_spend_all_accounts
from finance_common.payday_periods import previous_real_payday
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])



def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource == "/projections" and method == "GET":
        return _get_projections(user_id, event.get("queryStringParameters") or {})

    if resource.endswith("/projected-vs-actual") and method == "GET":
        return _get_projected_vs_actual(user_id, event.get("queryStringParameters") or {})

    if method == "GET":
        return _list_budgets(user_id)
    if method == "POST":
        return _upsert_budget(user_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        sk = event["pathParameters"]["sk"]
        return _delete_budget(user_id, sk)

    return _response(405, {"error": "Method not allowed"})


def _get_projected_vs_actual(user_id, query_params):
    """Total money in minus total money out, per real pay period - not
    broken down by category (Category Trends already covers that
    breakdown). "Actual" is the real net across every account the user
    owns for that period, computed directly from transaction history -
    which already includes any fund movement made through the Payday
    calculator (transfers are real transactions) and any expense added
    during that period, with no special-casing needed for either."""
    num_periods = min(int(query_params.get("numPeriods", 6)), 26)

    income_templates = _get_income_templates(user_id)
    recurring_monthly_income = sum(recurring_item_monthly_equivalent(t) for t in income_templates)
    today = date.today().isoformat()
    active_budgets = get_active_budgets(user_id, today)
    total_budgeted = decimal.Decimal(str(sum(to_monthly_equivalent(b["amount"], b.get("frequency", "monthly")) for b in active_budgets)))
    planned_contributions = _get_planned_expense_monthly_contributions(user_id)
    total_planned_monthly = sum(c["monthlyContribution"] for c in planned_contributions)
    # One-time credits deliberately excluded from the baseline here -
    # "projected" represents the expected, recurring pattern; a one-off
    # windfall isn't something to project forward as if it repeats.
    projected_monthly_leftover = recurring_monthly_income - total_budgeted - decimal.Decimal(str(total_planned_monthly))

    accounts = accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    account_ids = [a["accountId"] for a in accounts]

    # Walk backward through N COMPLETED real pay periods - "actual" needs
    # real past data, so this starts from today and walks toward the
    # past, then reverses for oldest-to-newest display.
    periods = []
    cursor = today
    for _ in range(num_periods):
        period_start = previous_real_payday(income_templates, cursor)
        periods.append((period_start, cursor))
        cursor = period_start
    periods.reverse()

    series = []
    for period_start, period_end in periods:
        days = (date.fromisoformat(period_end) - date.fromisoformat(period_start)).days
        daily_rate = projected_monthly_leftover / decimal.Decimal("30.4375")
        projected = daily_rate * days

        # sk is "{timestamp}#{txnId}" where timestamp may be a bare date
        # (recurring postings) or a full ISO datetime (manual entries) -
        # the \uffff sentinel on both bounds ensures every transaction
        # actually dated on period_start is excluded (it belongs to the
        # PRIOR period, which already claimed that payday's arrival) and
        # every transaction dated on period_end is included, regardless
        # of which sk format that particular transaction happens to use.
        lo = period_start + "\uffff"
        hi = period_end + "\uffff"
        actual = decimal.Decimal(0)
        for account_id in account_ids:
            items = transactions_table.query(
                KeyConditionExpression="accountId = :aid AND sk BETWEEN :lo AND :hi",
                ExpressionAttributeValues={":aid": account_id, ":lo": lo, ":hi": hi},
            ).get("Items", [])
            for t in items:
                amount = decimal.Decimal(str(t["amount"]))
                actual += amount if t.get("direction") == "credit" else -amount

        series.append({
            "periodStart": period_start,
            "periodEnd": period_end,
            "projected": round(float(projected), 2),
            "actual": round(float(actual), 2),
        })

    return _response(200, {
        "asOfDate": today,
        "projectedMonthlyLeftover": projected_monthly_leftover,
        "series": series,
    }, default=_decimal_default)

def _list_budgets(user_id):
    """Returns the latest budget per category, whether or not it's
    started yet - a brand-new budget's effective start date is often
    snapped forward to the user's next paycheck (see
    _next_paycheck_on_or_after), which can be days away. Previously this
    only returned budgets already in effect, which meant a budget you'd
    just created could be completely invisible in the list until that
    future date arrived - indistinguishable from the save having silently
    failed. Now a not-yet-started budget still shows, tagged
    isUpcoming=True with no spend computed against it yet (nothing has
    been spent against a budget period that hasn't started)."""
    today = date.today().isoformat()

    result = budgets_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    by_category = {}
    for item in result.get("Items", []):
        category = item["category"]
        existing = by_category.get(category)
        if not existing or item["effectiveStartDate"] > existing["effectiveStartDate"]:
            by_category[category] = item

    active_budgets = list(by_category.values())
    for budget in active_budgets:
        if budget["effectiveStartDate"] <= today:
            budget["spentAmount"] = category_spend_all_accounts(user_id, budget["category"], budget["effectiveStartDate"])
            budget["isUpcoming"] = False
        else:
            budget["spentAmount"] = 0
            budget["isUpcoming"] = True

    return _response(200, active_budgets, default=_decimal_default)


MAX_RETROACTIVE_DAYS = 365


def _upsert_budget(user_id, body):
    category = body["category"]
    requested_start = body["startDate"]  # e.g. "2026-08-15"
    today = date.today().isoformat()

    if requested_start < today:
        days_back = (date.today() - date.fromisoformat(requested_start)).days
        if days_back > MAX_RETROACTIVE_DAYS:
            return _response(400, {"error": f"start date can't be more than {MAX_RETROACTIVE_DAYS} days in the past"})
        if not body.get("backfillForTrends"):
            return _response(400, {"error": "a past start date requires backfillForTrends: true - see the confirmation dialog"})

    effective_start = _next_paycheck_on_or_after(user_id, requested_start)
    new_sk = f"{category}#{effective_start}"

    # Editing an existing budget (e.g. just changing the amount) recomputes
    # effective_start from "next paycheck on/after today", which is a
    # different value on virtually every different day - previously this
    # meant every edit silently created a NEW row and left the old one
    # behind, so a category could accumulate several orphaned rows over
    # time. Deleting only ever removed the newest one, making delete look
    # broken once an older row was still sitting underneath. Clean up
    # every other row for this category first, so exactly one ever exists.
    existing = budgets_table.query(
        KeyConditionExpression="userId = :uid AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":uid": user_id, ":prefix": f"{category}#"},
    ).get("Items", [])
    for old_item in existing:
        if old_item["sk"] != new_sk:
            budgets_table.delete_item(Key={"userId": user_id, "sk": old_item["sk"]})

    item = {
        "userId": user_id,
        "sk": new_sk,
        "category": category,
        "amount": decimal.Decimal(str(body["amount"])),
        "frequency": body.get("frequency", "monthly"),  # "monthly" | "weekly" | "biweekly"
        "accountId": body.get("accountId"),  # where this budget's set-aside money moves to on payday submit - optional for backward compat with budgets created before this existed
        "divisionId": body.get("divisionId"),  # optional - a division within accountId, if the money should be tracked as going into a specific sub-allocation rather than just the account as a whole
        "alertsEnabled": body.get("alertsEnabled", True),  # 80%/100%/repeat-over threshold alerts for this category specifically
        "requestedStartDate": requested_start,
        "effectiveStartDate": effective_start,
    }
    budgets_table.put_item(Item=item)
    return _response(201, item, default=_decimal_default)


def _delete_budget(user_id, sk):
    category = sk.split("#", 1)[0]
    existing = budgets_table.query(
        KeyConditionExpression="userId = :uid AND begins_with(sk, :prefix)",
        ExpressionAttributeValues={":uid": user_id, ":prefix": f"{category}#"},
    ).get("Items", [])
    for item in existing:
        budgets_table.delete_item(Key={"userId": user_id, "sk": item["sk"]})
    return _response(204, None)


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
    recurring_monthly_income = sum(recurring_item_monthly_equivalent(t) for t in income_templates)

    one_time_credits_this_month = _get_one_time_credits_this_month(user_id, today)
    total_income_this_month = recurring_monthly_income + one_time_credits_this_month

    active_budgets = get_active_budgets(user_id, today)
    total_budgeted = decimal.Decimal(str(sum(to_monthly_equivalent(b["amount"], b.get("frequency", "monthly")) for b in active_budgets)))
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


