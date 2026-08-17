"""
Shared real-payday boundary math. Given a user's actual income
templates (not an assumed schedule), finds the real payday immediately
before or after any given date - the boundaries of one real pay period.

Originally lived only in payday-fn; moved here once scenarios-fn needed
the same "snap this one-time date to the real paycheck before it" logic,
since each Lambda is a separate deployment package and can't import
another function's own code directly.
"""
from datetime import date, timedelta


def next_real_payday_after(income_items, after_date):
    """The real payday immediately after after_date, across every income
    template - the end of the current pay period. Mirrors
    previous_real_payday's logic in the opposite direction. Falls back
    to 14 days out if there's no income schedule at all."""
    from finance_common.schedule import next_date_after

    candidates = []
    for item in income_items:
        d = item["nextDueDate"]
        for _ in range(60):
            if d > after_date:
                break
            d = next_date_after(item, d)
        candidates.append(d)
    if candidates:
        return min(candidates)
    return (date.fromisoformat(after_date) + timedelta(days=14)).isoformat()


def previous_real_payday(income_items, target_date):
    """The real payday immediately before target_date, across every
    income template - the start of the pay period ending at
    target_date. Falls back to 30 days before if there's no income
    schedule at all, so a brand-new user without income set up yet
    still gets a workable (if approximate) window rather than a crash."""
    from finance_common.schedule import next_date_after
    from finance_common.budget_frequency import previous_date_before

    candidates = []
    for item in income_items:
        d = item["nextDueDate"]
        if d >= target_date:
            for _ in range(60):
                d = previous_date_before(item, d)
                if d < target_date:
                    break
        else:
            for _ in range(60):
                nxt = next_date_after(item, d)
                if nxt >= target_date:
                    break
                d = nxt
        candidates.append(d)
    if candidates:
        return max(candidates)
    return (date.fromisoformat(target_date) - timedelta(days=30)).isoformat()
