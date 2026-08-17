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
from datetime import date


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
