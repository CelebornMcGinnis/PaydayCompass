"""
Recurring-transaction schedule math. Pure date functions - no AWS calls,
no environment variables - safe to import from any function.

Frequency options: "weekly", "biweekly", "semimonthly" (two fixed calendar
days, e.g. 1st & 15th), "monthly", "annual".
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

    raise ValueError(f"Unknown frequency: {freq}")


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
