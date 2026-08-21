"""
Projects, per account, the LOWEST balance it's likely to hit before every
income source has had at least one full cycle - not the balance at the
nearest payday (too short a look-ahead for a longer-cycle income to ever
show its own due bills), and not just the ending balance at a far horizon
either (a dip that partially recovers before the horizon can be deeper
than wherever the horizon happens to land).

Approach: build one flat, dated list of every income/expense occurrence
between now and a horizon, plus a budget/planned-expense debit at every
real payday in between (mirroring how payday/index.py already reprorates
those for a single window, just repeated per window here), then walk the
list in date order per account, tracking the lowest point the running
balance touches. On a tie for date, debits are applied before credits -
a bill due "by" a payday is due before that payday's income lands, same
assumption the single-window version already made.
"""
from finance_common.schedule import next_date_after
from finance_common.budget_frequency import budget_amount_due_on_payday, recurring_item_monthly_equivalent
from finance_common.payday_periods import next_real_payday_after
from finance_common.planned_expenses import suggested_contribution

MAX_OCCURRENCES_PER_ITEM = 60  # safety cap, mirrors next_real_payday_after's own
MAX_CHECKPOINTS = 60


def _current_estimate(item, occurrence_date):
    overrides = item.get("occurrenceOverrides") or {}
    override = overrides.get(occurrence_date)
    return float(override) if override is not None else float(item["estimatedAmount"])


def _period_days(item):
    """Average days between this item's occurrences, derived from the same
    per-frequency factor recurring_item_monthly_equivalent already uses
    (including "custom" intervals) - reusing it here avoids a second,
    partial period-length table drifting out of sync with that one."""
    factor = float(recurring_item_monthly_equivalent({**item, "estimatedAmount": 1}))
    if factor <= 0:
        return 365.25 / 12
    return (365.25 / 12) / factor


def _occurrences_through(item, horizon):
    """Every occurrence date for this item from its current nextDueDate
    through horizon, inclusive."""
    occurrences = []
    current = item["nextDueDate"]
    steps = 0
    while current <= horizon and steps < MAX_OCCURRENCES_PER_ITEM:
        occurrences.append(current)
        current = next_date_after(item, current)
        steps += 1
    return occurrences


def project_lowest_balance(income_items, expense_items, budgets, planned_items,
                            overdue_planned_expenses, account_balances, today):
    """Returns {accountId: {"amount": float, "asOfDate": "<ISO date>"}} for
    every account in account_balances. income_items/expense_items are raw
    recurring-item records (need nextDueDate/frequency/estimatedAmount/
    accountId); budgets are raw budget records; planned_items are raw
    planned-expense records; overdue_planned_expenses is the list
    payday/index.py's _classify_planned_expenses already produces (reused
    as-is - it doesn't depend on which window it's viewed from)."""
    if not income_items:
        return {}

    # 1. Horizon = the income with the longest cycle; ties broken by the
    # larger amount, per the user's own tie-break rule for same-cycle,
    # time-offset incomes.
    horizon_income = max(
        income_items,
        key=lambda i: (_period_days(i), _current_estimate(i, i["nextDueDate"])),
    )
    horizon = horizon_income["nextDueDate"]

    # 2. Checkpoints: every real payday from today through the horizon.
    # horizon_income's own stored nextDueDate is always exactly `horizon`,
    # so it's always a valid candidate at every step - the walk is
    # guaranteed to land on horizon exactly, never past it.
    checkpoints = []
    cursor = today
    steps = 0
    while cursor < horizon and steps < MAX_CHECKPOINTS:
        cursor = next_real_payday_after(income_items, cursor)
        checkpoints.append(cursor)
        steps += 1
    if not checkpoints or checkpoints[-1] < horizon:
        checkpoints.append(horizon)

    # 3. Flat, dated per-account delta list.
    events = []  # (date, accountId, delta, isDebit)

    for item in income_items:
        for occ in _occurrences_through(item, horizon):
            events.append((occ, item["accountId"], _current_estimate(item, occ), False))

    for item in expense_items:
        for occ in _occurrences_through(item, horizon):
            events.append((occ, item["accountId"], -_current_estimate(item, occ), True))

    window_start = today
    for checkpoint in checkpoints:
        for b in budgets:
            if not b.get("accountId"):
                continue
            amount = budget_amount_due_on_payday(b, window_start, checkpoint)
            events.append((checkpoint, b["accountId"], -amount, True))
        for pe in planned_items:
            if pe.get("completed", False):
                continue
            if pe["targetDate"] < today:
                continue  # already overdue - handled once, below, not per window
            if not pe.get("linkedAccountId"):
                continue
            amount = budget_amount_due_on_payday(
                {"amount": suggested_contribution(pe), "frequency": pe.get("contributionFrequency", "monthly")},
                window_start,
                checkpoint,
            )
            events.append((checkpoint, pe["linkedAccountId"], -amount, True))
        window_start = checkpoint

    for pe in overdue_planned_expenses:
        if pe.get("linkedAccountId"):
            events.append((today, pe["linkedAccountId"], -pe["amount"], True))

    # 4. Simulate per account, in date order (debits before credits on a
    # tied date), tracking the running low.
    events.sort(key=lambda e: (e[0], 0 if e[3] else 1))
    running = dict(account_balances)
    lowest = {acct: {"amount": round(bal, 2), "asOfDate": today} for acct, bal in account_balances.items()}
    for occ_date, acct, delta, is_debit in events:
        if acct not in running:
            continue
        running[acct] += delta
        if is_debit and running[acct] < lowest[acct]["amount"]:
            lowest[acct] = {"amount": round(running[acct], 2), "asOfDate": occ_date}
    return lowest
