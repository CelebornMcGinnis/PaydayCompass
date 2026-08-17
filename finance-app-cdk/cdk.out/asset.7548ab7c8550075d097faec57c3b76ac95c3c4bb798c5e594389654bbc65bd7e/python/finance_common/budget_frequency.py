"""
Budget-frequency math. A budget's `amount` is a cap for one period of
its `frequency` ("monthly" | "weekly" | "biweekly") - these helpers
convert that into whatever basis a caller actually needs.
"""
from datetime import date

MONTHLY_EQUIVALENT_FACTOR = {
    "monthly": 1.0,
    "weekly": 4.348,   # 52 weeks / 12 months
    "biweekly": 2.174,  # 26 paychecks / 12 months
}

# Average period length in days, used to derive a daily rate for
# budget_amount_due_on_payday below. "monthly" uses the calendar
# average (365.25/12) rather than a fixed 30, so the rate doesn't
# systematically drift across a full year of uneven month lengths.
PERIOD_DAYS = {
    "monthly": 365.25 / 12,
    "weekly": 7,
    "biweekly": 14,
}


def to_monthly_equivalent(amount, frequency):
    """Normalizes any budget amount to a monthly-equivalent figure, for
    contexts that need a single comparable basis (scenario expense
    totals, the Projected-vs-Actual page's initial budgeted-per-month
    figure) regardless of how the budget itself is actually tracked."""
    factor = MONTHLY_EQUIVALENT_FACTOR.get(frequency, 1.0)
    return float(amount) * factor


def previous_date_before(template, from_date_str):
    """Exact inverse of schedule.next_date_after - steps one occurrence
    backward, landing on a real prior occurrence, not an approximation.
    Used by payday-fn to find the start of the current pay period."""
    from finance_common.schedule import add_months

    d = date.fromisoformat(from_date_str)
    freq = template["frequency"]

    if freq == "weekly":
        from datetime import timedelta
        return (d - timedelta(days=7)).isoformat()
    if freq == "biweekly":
        from datetime import timedelta
        return (d - timedelta(days=14)).isoformat()
    if freq == "monthly":
        return add_months(d, -1).isoformat()
    if freq == "annual":
        return add_months(d, -12).isoformat()
    if freq == "semimonthly":
        anchor_days = sorted(template.get("anchorDays") or [1, 15])
        for day in reversed(anchor_days):
            if d.day > day:
                return d.replace(day=day).isoformat()
        prev_month_last = add_months(d.replace(day=1), -1)
        return prev_month_last.replace(day=anchor_days[-1]).isoformat()

    raise ValueError(f"Unknown frequency: {freq}")


def budget_amount_due_on_payday(budget, previous_payday, next_payday):
    """How much of this budget should be moved on one specific real
    payday, pro-rated by how many days actually elapsed in this pay
    period relative to the budget's own period length. This is what
    makes a weekly budget correctly show DOUBLE against biweekly
    paychecks (14 real days / 7 budget days = 2x), a monthly budget
    show roughly a quarter against weekly paychecks, and so on -
    "money set aside for the next time duration," scaled to however
    long that duration actually turns out to be, rather than assuming
    the budget's frequency always matches the paycheck's."""
    amount = float(budget["amount"])
    frequency = budget.get("frequency", "monthly")
    period_days = PERIOD_DAYS.get(frequency, PERIOD_DAYS["monthly"])
    daily_rate = amount / period_days

    days_in_this_period = (date.fromisoformat(next_payday) - date.fromisoformat(previous_payday)).days
    return round(daily_rate * days_in_this_period, 2)
