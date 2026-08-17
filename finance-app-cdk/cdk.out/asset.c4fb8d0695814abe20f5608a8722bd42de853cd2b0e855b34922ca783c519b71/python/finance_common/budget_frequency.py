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


def recurring_item_monthly_equivalent(item):
    """Same idea as to_monthly_equivalent, but for a recurring income/
    expense TEMPLATE rather than a budget - these can use "custom"
    (every N days/weeks/months), which has no fixed factor the way the
    other frequencies do, so it's computed directly from the template's
    own intervalCount/intervalUnit rather than a static lookup table.
    Was previously duplicated as an identical static dict in both
    scenarios-fn and budgets-fn, and neither handled "custom" at all -
    consolidated here as part of adding that support."""
    import decimal

    amount = decimal.Decimal(str(item["estimatedAmount"]))
    frequency = item["frequency"]

    if frequency == "custom":
        count = max(int(item.get("intervalCount") or 1), 1)
        unit = item.get("intervalUnit") or "days"
        days_per_occurrence = {"days": count, "weeks": count * 7, "months": count * (365.25 / 12)}.get(unit, count)
        occurrences_per_month = (365.25 / 12) / days_per_occurrence
        return amount * decimal.Decimal(str(occurrences_per_month))

    factor = {
        "weekly": decimal.Decimal(52) / decimal.Decimal(12),
        "biweekly": decimal.Decimal(26) / decimal.Decimal(12),
        "semimonthly": decimal.Decimal(2),
        "monthly": decimal.Decimal(1),
        "monthly_weekday": decimal.Decimal(1),  # "2nd Tuesday of every month" - once per month, same as monthly
        "annual": decimal.Decimal(1) / decimal.Decimal(12),
    }.get(frequency, decimal.Decimal(1))
    return amount * factor


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
    if freq == "monthly_weekday":
        from finance_common.schedule import nth_weekday_of_month

        week_of_month = int(template.get("weekOfMonth") or 1)
        day_of_week = int(template.get("dayOfWeek") or 0)
        prev_month = add_months(d, -1)
        return nth_weekday_of_month(prev_month.year, prev_month.month, week_of_month, day_of_week).isoformat()
    if freq == "semimonthly":
        anchor_days = sorted(template.get("anchorDays") or [1, 15])
        for day in reversed(anchor_days):
            if d.day > day:
                return d.replace(day=day).isoformat()
        prev_month_last = add_months(d.replace(day=1), -1)
        return prev_month_last.replace(day=anchor_days[-1]).isoformat()
    if freq == "custom":
        from datetime import timedelta

        count = max(int(template.get("intervalCount") or 1), 1)
        unit = template.get("intervalUnit") or "days"
        if unit == "days":
            return (d - timedelta(days=count)).isoformat()
        if unit == "weeks":
            return (d - timedelta(weeks=count)).isoformat()
        if unit == "months":
            return add_months(d, -count).isoformat()
        raise ValueError(f"Unknown intervalUnit: {unit}")

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
