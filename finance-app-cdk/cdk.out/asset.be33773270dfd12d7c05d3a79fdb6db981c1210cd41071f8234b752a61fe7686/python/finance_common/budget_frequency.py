"""
Budget-frequency math. A budget's `amount` is a cap for one period of
its `frequency` ("monthly" | "weekly" | "biweekly") - these helpers
convert that into whatever basis a caller actually needs.

Deliberately separate from schedule.py: recurring templates walk their
OWN independent schedule from an anchor date, but a budget's due amount
depends on the user's REAL paycheck schedule (from their income
templates), not an independent walk - see payday-fn for why.
"""
from datetime import date, timedelta

MONTHLY_EQUIVALENT_FACTOR = {
    "monthly": 1.0,
    "weekly": 4.348,   # 52 weeks / 12 months
    "biweekly": 2.174,  # 26 paychecks / 12 months
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
    Needed because a target month can fall before a template's
    nextDueDate anchor, and getting this wrong would silently produce
    the wrong set of real paydays for that month."""
    from finance_common.schedule import add_months

    d = date.fromisoformat(from_date_str)
    freq = template["frequency"]

    if freq == "weekly":
        return (d - timedelta(days=7)).isoformat()
    if freq == "biweekly":
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


def real_paydays_in_month(income_templates, year, month):
    """Every real payday date (from the user's actual income templates,
    not an assumed schedule) that falls within the given calendar month.
    Used to split a monthly budget's amount across however many paydays
    actually land in that month - which varies month to month and isn't
    knowable from the budget alone. Walks from each template's real
    nextDueDate anchor in whichever direction reaches the target month -
    both directions use exact schedule math, never an approximation."""
    from finance_common.schedule import next_date_after

    month_start = date(year, month, 1)
    month_end = date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)

    paydays = set()
    for template in income_templates:
        d = date.fromisoformat(template["nextDueDate"])

        # Walk backward (exact) until at or before month_start, bounded
        # against a runaway loop if a template's frequency is malformed.
        reached = False
        for _ in range(200):
            if d < month_start:
                reached = True
                break
            d = date.fromisoformat(previous_date_before(template, d.isoformat()))
        if not reached:
            continue  # couldn't reach the target month safely - skip rather than risk a bad range

        # Now walk forward (exact, the existing verified schedule math)
        # collecting every real occurrence inside the target month.
        for _ in range(200):
            if d >= month_end:
                break
            if d >= month_start:
                paydays.add(d.isoformat())
            d = date.fromisoformat(next_date_after(template, d.isoformat()))

    return sorted(paydays)


def budget_amount_due_on_payday(budget, payday_date, income_templates):
    """How much of this budget should be moved on one specific real
    payday. Monthly budgets split their amount across however many real
    paydays actually fall in that calendar month (uneven month to
    month). Weekly/biweekly budgets assign the full period amount to
    each real payday - this assumes the budget's frequency matches the
    user's actual paycheck cadence, which is the common case; a
    weekly budget against monthly paychecks would need proportional
    splitting this doesn't attempt, since it's not a case in use today."""
    amount = float(budget["amount"])
    frequency = budget.get("frequency", "monthly")

    if frequency != "monthly":
        return amount

    d = date.fromisoformat(payday_date)
    paydays_this_month = real_paydays_in_month(income_templates, d.year, d.month)
    count = len(paydays_this_month) or 1
    return round(amount / count, 2)
