"""
Recurring-transaction schedule math. Pure date functions - no AWS calls,
no environment variables - safe to import from any function.

Frequency options: "weekly", "biweekly", "semimonthly" (two fixed calendar
days, e.g. 1st & 15th), "monthly", "annual", "custom" (every N days/weeks/
months, via intervalCount + intervalUnit), "monthly_weekday" (the nth
occurrence of a weekday each month, e.g. "2nd Tuesday" - via weekOfMonth
[1-4, or -1 for the last one in the month] + dayOfWeek [0=Monday..6=Sunday]).
"""
from datetime import date, timedelta


def next_date_after(template, from_date_str):
    """Given a recurring template dict (with 'frequency' and the relevant
    anchor fields) and a date string, returns the next occurrence date
    after it as an ISO date string."""
    d = date.fromisoformat(from_date_str)
    freq = template["frequency"]

    if freq == "weekly":
        return (d + timedelta(days=7)).isoformat()
    if freq == "biweekly":
        return (d + timedelta(days=14)).isoformat()
    if freq == "semimonthly":
        anchor_days = sorted(template.get("anchorDays") or [1, 15])
        return _next_semimonthly(d, anchor_days)
    if freq == "monthly":
        return add_months(d, 1).isoformat()
    if freq == "annual":
        return add_months(d, 12).isoformat()
    if freq == "monthly_weekday":
        week_of_month = int(template.get("weekOfMonth") or 1)
        day_of_week = int(template.get("dayOfWeek") or 0)
        next_month = add_months(d, 1)
        return nth_weekday_of_month(next_month.year, next_month.month, week_of_month, day_of_week).isoformat()
    if freq == "custom":
        count = max(int(template.get("intervalCount") or 1), 1)
        unit = template.get("intervalUnit") or "days"
        if unit == "days":
            return (d + timedelta(days=count)).isoformat()
        if unit == "weeks":
            return (d + timedelta(weeks=count)).isoformat()
        if unit == "months":
            return add_months(d, count).isoformat()
        raise ValueError(f"Unknown intervalUnit: {unit}")

    raise ValueError(f"Unknown frequency: {freq}")


def nth_weekday_of_month(year, month, week_of_month, day_of_week):
    """The date of the nth occurrence of day_of_week in the given month.
    week_of_month: 1-4 for the 1st-4th occurrence, or -1 for the last
    occurrence (which may be the 4th or 5th depending on the month -
    "last Friday" should always mean the actual last one, not skip a
    5th-week Friday some months have)."""
    if week_of_month == -1:
        if month == 12:
            last_day = date(year, 12, 31)
        else:
            last_day = date(year, month + 1, 1) - timedelta(days=1)
        offset = (last_day.weekday() - day_of_week) % 7
        return last_day - timedelta(days=offset)

    first_day = date(year, month, 1)
    offset = (day_of_week - first_day.weekday()) % 7
    first_occurrence = first_day + timedelta(days=offset)
    return first_occurrence + timedelta(days=7 * (week_of_month - 1))


def _next_semimonthly(d, anchor_days):
    for day in anchor_days:
        if d.day < day:
            return d.replace(day=day).isoformat()
    first_of_next = add_months(d.replace(day=1), 1)
    return first_of_next.replace(day=anchor_days[0]).isoformat()


def add_months(d, months):
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, 28)  # templates are expected to use anchorDay <= 28
    return date(year, month, day)
