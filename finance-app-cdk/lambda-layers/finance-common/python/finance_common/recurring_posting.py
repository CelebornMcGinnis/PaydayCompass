"""
Single-occurrence posting and schedule-advance for a recurring template -
shared by recurring_processor (the daily automatic job) and recurring-fn's
manual "mark as paid"/"skip" actions, so the two paths can't drift the way
recurring_processor and payday's own separate copy of this logic already
had (recurring_processor's had low-balance/budget-threshold checks payday's
never got - see payday/index.py's _post_recurring_occurrence, intentionally
left as its own implementation for now since Payday's batch-submit
semantics differ enough - amount overrides come from the request body, not
the template's own occurrenceOverrides, no per-occurrence budget check
inside a batch submit - that folding it into this shared version wasn't a
safe drop-in for this pass).

Requires ACCOUNTS_TABLE, TRANSACTIONS_TABLE, RECURRING_TABLE,
DIVISIONS_TABLE, USER_PREFERENCES_TABLE, BUDGETS_TABLE (the last two via
low_balance_alerts/budget_notify) env vars, plus NOTIFICATIONS_FN_NAME +
lambda:InvokeFunction on notifications-fn if the caller wants
trigger_budget_check to actually fire (a no-op otherwise - see
budget_notify.py's own docstring).
"""
import os
import uuid
import decimal
from datetime import date
import boto3

from .divisions import adjust_division_balance
from .low_balance_alerts import check_low_balance_alert
from .budget_notify import trigger_budget_check

_dynamodb = boto3.resource("dynamodb")


def _transactions_table():
    return _dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])


def _accounts_table():
    return _dynamodb.Table(os.environ["ACCOUNTS_TABLE"])


def _recurring_table():
    return _dynamodb.Table(os.environ["RECURRING_TABLE"])


def post_occurrence(template, occurrence_date, *, source):
    """Posts ONE occurrence of a recurring template as a real transaction,
    updates the account (and division, if tagged) balance, and runs the
    same low-balance/budget-threshold checks a normally-processed
    occurrence gets. Does NOT advance the template's schedule - callers
    do that themselves afterward via advance_schedule, since
    recurring_processor may post several occurrences from the same
    template before advancing once, while a manual mark-paid always does
    exactly one of each. Returns the written transaction item and the
    signed balance delta actually applied (positive for income, negative
    for an expense)."""
    account_id = template["accountId"]
    is_income = template.get("isIncome", False)

    overrides = template.get("occurrenceOverrides") or {}
    override = overrides.get(occurrence_date)
    amount = decimal.Decimal(str(override)) if override is not None else decimal.Decimal(str(template["estimatedAmount"]))

    # A date override moves when this ONE occurrence actually posts,
    # without touching the schedule itself - the next occurrence is still
    # computed from occurrence_date (the original scheduled date), never
    # from effective_date.
    date_overrides = template.get("occurrenceDateOverrides") or {}
    effective_date = date_overrides.get(occurrence_date, occurrence_date)

    txn_id = str(uuid.uuid4())
    item = {
        "accountId": account_id,
        "sk": f"{effective_date}#{txn_id}",
        "txnId": txn_id,
        "userId": template["userId"],
        "amount": amount,  # NET - what actually posts to the balance
        "category": template.get("category", "Uncategorized"),
        "description": template.get("description", ""),
        "direction": "credit" if is_income else "debit",
        "createdAt": effective_date,
        "source": source,
        "recurringId": template["recurringId"],
        "wasOverridden": override is not None,
    }
    if is_income and template.get("grossAmount") is not None:
        item["grossAmount"] = decimal.Decimal(str(template["grossAmount"]))
    if not is_income and template.get("externalBankAccountId"):
        item["externalBankAccountId"] = template["externalBankAccountId"]

    _transactions_table().put_item(Item=item)

    balance_delta = amount if is_income else -amount
    balance_result = _accounts_table().update_item(
        Key={"userId": template["userId"], "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": balance_delta},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(template["userId"], account_id, balance_result["Attributes"]["balance"])

    if template.get("divisionId"):
        adjust_division_balance(account_id, template["divisionId"], balance_delta)

    if not is_income:
        trigger_budget_check(template["userId"], account_id, template.get("category", "Uncategorized"), amount)

    return item, balance_delta


def advance_schedule(template, next_due, posted_dates):
    """Moves a template's nextDueDate forward to next_due (the caller's
    job to compute, via schedule.next_date_after, since a caller
    advancing past a single occurrence and one catching up several at
    once both compute it the same way but from different starting
    points), clearing whichever of posted_dates had a pending occurrence
    override (amount or date) - they're spent now, whether the occurrence
    was actually posted or explicitly skipped."""
    remaining_overrides = {
        k: v for k, v in (template.get("occurrenceOverrides") or {}).items() if k not in posted_dates
    }
    remaining_date_overrides = {
        k: v for k, v in (template.get("occurrenceDateOverrides") or {}).items() if k not in posted_dates
    }
    _recurring_table().update_item(
        Key={"accountId": template["accountId"], "recurringId": template["recurringId"]},
        UpdateExpression="SET nextDueDate = :next, lastProcessedDate = :today, occurrenceOverrides = :overrides, occurrenceDateOverrides = :dateOverrides",
        ExpressionAttributeValues={
            ":next": next_due,
            ":today": date.today().isoformat(),
            ":overrides": remaining_overrides,
            ":dateOverrides": remaining_date_overrides,
        },
    )
