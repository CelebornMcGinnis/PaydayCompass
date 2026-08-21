"""
Shared planned-expense contribution math. suggestedContribution is
deliberately never persisted on the DynamoDB item itself - it's always
computed fresh from targetAmount/amountSaved/targetDate, since those can
change and a stale stored value would drift. planned_expenses-fn computes
it at list/create/update time before returning a response; payday-fn
needs the identical calculation when reading planned expenses directly
from the table (a separate Lambda package, so it can't just call
planned_expenses-fn's own function).
"""
import decimal
import uuid
from datetime import date

from finance_common.schedule import add_months
from finance_common.budget_frequency import budget_amount_due_on_payday


def classify_planned_expenses(planned_items, today, previous_payday, next_payday):
    """Splits active planned expenses into upcoming and overdue, excluding
    anything explicitly marked complete or that's already fully funded
    despite its date having passed (nothing left to contribute, so it
    shouldn't clutter Payday even without an explicit complete click).
    Overdue items use the full remaining gap (targetAmount - amountSaved)
    directly rather than the usual prorated-per-period contribution -
    once the target date has passed there's no time left to spread the
    contribution across, so the whole remaining amount is what's
    actually still needed. Shared between payday-fn (both the live
    preview and a manual submit) and recurring_processor's daily
    auto-sweep, so "what's due" can't drift between the two."""
    upcoming, overdue = [], []
    for pe in planned_items:
        if pe.get("completed", False):
            continue
        remaining = float(decimal.Decimal(str(pe["targetAmount"])) - decimal.Decimal(str(pe.get("amountSaved", 0))))
        is_overdue = pe["targetDate"] < today
        if is_overdue:
            if remaining <= 0:
                continue
            overdue.append({
                "plannedExpenseId": pe["plannedExpenseId"],
                "name": pe.get("name", ""),
                "category": pe.get("category"),
                "amount": round(remaining, 2),
                "targetDate": pe["targetDate"],
                "recurrenceType": pe.get("recurrenceType", "one_time"),
                "linkedAccountId": pe.get("linkedAccountId"),
                "divisionId": pe.get("divisionId"),
            })
        else:
            upcoming.append({
                "plannedExpenseId": pe["plannedExpenseId"],
                "name": pe.get("name", ""),
                "category": pe.get("category"),
                "amount": budget_amount_due_on_payday(
                    {"amount": suggested_contribution(pe), "frequency": pe.get("contributionFrequency", "monthly")},
                    previous_payday,
                    next_payday,
                ),
                "linkedAccountId": pe.get("linkedAccountId"),
                "divisionId": pe.get("divisionId"),
            })
    return upcoming, overdue


def suggested_contribution(item):
    """How much to set aside per period to hit the target by targetDate."""
    remaining = decimal.Decimal(str(item["targetAmount"])) - decimal.Decimal(str(item.get("amountSaved", 0)))
    if remaining <= 0:
        return 0.0

    today = date.today()
    target = date.fromisoformat(item["targetDate"])
    days_remaining = max((target - today).days, 1)

    frequency = item.get("contributionFrequency", "monthly")
    periods_per_day = {
        "weekly": 1 / 7,
        "biweekly": 1 / 14,
        "monthly": 1 / 30,
    }.get(frequency, 1 / 30)

    periods_remaining = max(days_remaining * periods_per_day, 1)
    return float(remaining / decimal.Decimal(str(periods_remaining)))


def complete_planned_expense(table, user_id, item):
    """Marks a planned expense done and, for an annual one, rolls a fresh
    card forward to next year's occurrence - completing this year's
    birthday fund shouldn't lose the recurring commitment to save for
    next year's. A one-time item just gets marked complete with no
    replacement. Shared between planned_expenses-fn's own explicit
    /complete endpoint and both Lambdas' auto-complete-when-funded path,
    so the rollover behavior only has to be right in one place. Returns
    the new rolled-over item, or None for a one-time item."""
    table.update_item(
        Key={"userId": user_id, "plannedExpenseId": item["plannedExpenseId"]},
        UpdateExpression="SET completed = :true",
        ExpressionAttributeValues={":true": True},
    )

    if item.get("recurrenceType") != "annual":
        return None

    next_target_date = item["targetDate"]
    today = date.today().isoformat()
    for _ in range(20):
        next_target_date = add_months(date.fromisoformat(next_target_date), 12).isoformat()
        if next_target_date >= today:
            break

    new_item = {
        "userId": user_id,
        "plannedExpenseId": str(uuid.uuid4()),
        "name": item.get("name", "Untitled"),
        "category": item.get("category", "Uncategorized"),
        "targetAmount": item["targetAmount"],
        "targetDate": next_target_date,
        "recurrenceType": "annual",
        "amountSaved": decimal.Decimal(0),
        "contributionFrequency": item.get("contributionFrequency", "monthly"),
        "linkedAccountId": item.get("linkedAccountId"),
        "divisionId": item.get("divisionId"),
        "notes": item.get("notes", ""),
        "completed": False,
    }
    table.put_item(Item=new_item)
    return new_item


def is_funded(item):
    """True once amountSaved has reached targetAmount - the trigger for
    auto-completing rather than waiting for an explicit user click."""
    remaining = decimal.Decimal(str(item["targetAmount"])) - decimal.Decimal(str(item.get("amountSaved", 0)))
    return remaining <= 0
