"""
Moves real money for budgeted categories and planned-expense
contributions - the one thing recurring_processor's daily auto-post
still didn't cover (unlike income/expenses, budgets and planned
expenses have no nextDueDate-shaped field to query on; "due" is purely
a function of whatever (previous_payday, payday_date) window a caller
hands in). Shared between payday-fn's manual/early submit and
recurring_processor's daily auto-sweep so both move money through the
exact same logic - a caller only has to resolve WHICH account funds it
and WHAT window applies; this is the "given that, go move the money"
half.

Only categories/planned expenses with a destination account set
actually move anything - anything without one stays purely
informational, same as before this was extracted.
"""
import os
import decimal
import boto3

from finance_common.transfers import execute_transfer
from finance_common.divisions import adjust_division_balance
from finance_common.budget_notify import get_active_budgets, category_spend_all_accounts
from finance_common.budget_frequency import budget_amount_due_on_payday
from finance_common.planned_expenses import classify_planned_expenses, is_funded, complete_planned_expense

_dynamodb = boto3.resource("dynamodb")


def _accounts_table():
    return _dynamodb.Table(os.environ["ACCOUNTS_TABLE"])


def _transactions_table():
    return _dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])


def _planned_expenses_table():
    return _dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])


def sweep_budgets_and_planned_expenses(user_id, source_account_id, previous_payday, payday_date,
                                        budget_overrides=None, planned_expense_overrides=None):
    """Returns (transfers, errors). budget_overrides/planned_expense_overrides
    are optional {key: amount} dicts for a manual submit's user-adjusted
    amounts - the auto-sweep never has any (nobody's looking at a screen
    when the cron runs), so it always uses the freshly-computed suggested
    amount."""
    accounts_table = _accounts_table()
    transactions_table = _transactions_table()
    planned_expenses_table = _planned_expenses_table()

    transfers = []
    errors = []

    active_budgets = get_active_budgets(user_id, payday_date)
    budget_overrides = budget_overrides or {}
    for b in active_budgets:
        dest = b.get("accountId")
        if not dest:
            continue
        if b["category"] in budget_overrides:
            amount = decimal.Decimal(str(budget_overrides[b["category"]]))
        else:
            prorated_cap = budget_amount_due_on_payday(b, previous_payday, payday_date)
            spent_this_period = float(category_spend_all_accounts(user_id, b["category"], previous_payday))
            amount = decimal.Decimal(str(round(max(prorated_cap - spent_this_period, 0), 2)))
        if amount <= 0:
            continue
        try:
            result = execute_transfer(
                accounts_table, transactions_table, user_id, source_account_id, dest, amount,
                description=f"Budget set-aside: {b['category']}",
            )
        except Exception as e:
            print(f"payday_sweep: budget transfer failed for user {user_id}, category={b['category']}: {e}")
            errors.append({"type": "budgetTransfer", "category": b["category"], "toAccountId": dest, "error": str(e)})
            continue
        if result:
            transfers.append({
                "category": b["category"], "amount": amount,
                "fromAccountId": source_account_id, "toAccountId": dest,
                "transferId": result["transferId"], "divisionId": b.get("divisionId"),
            })
            if b.get("divisionId"):
                adjust_division_balance(dest, b["divisionId"], amount)

    planned_items = planned_expenses_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    planned_upcoming, planned_overdue = classify_planned_expenses(planned_items, payday_date, previous_payday, payday_date)
    planned_expense_overrides = planned_expense_overrides or {}
    planned_by_id = {pe["plannedExpenseId"]: pe for pe in planned_items}
    for pe_summary in planned_upcoming + planned_overdue:
        pe = planned_by_id[pe_summary["plannedExpenseId"]]
        dest = pe.get("linkedAccountId")
        if not dest:
            continue
        if pe_summary["plannedExpenseId"] in planned_expense_overrides:
            amount = decimal.Decimal(str(planned_expense_overrides[pe_summary["plannedExpenseId"]]))
        else:
            amount = decimal.Decimal(str(pe_summary["amount"]))
        if amount <= 0:
            continue
        try:
            result = execute_transfer(
                accounts_table, transactions_table, user_id, source_account_id, dest, amount,
                description=f"Planned expense: {pe.get('name', '')}",
            )
        except Exception as e:
            print(f"payday_sweep: planned expense transfer failed for user {user_id}, plannedExpenseId={pe['plannedExpenseId']}: {e}")
            errors.append({"type": "plannedTransfer", "plannedExpenseId": pe["plannedExpenseId"], "name": pe.get("name", ""), "error": str(e)})
            continue
        if result:
            transfers.append({
                "plannedExpenseId": pe["plannedExpenseId"], "name": pe.get("name", ""), "amount": amount,
                "fromAccountId": source_account_id, "toAccountId": dest,
                "transferId": result["transferId"], "divisionId": pe.get("divisionId"),
            })
            if pe.get("divisionId"):
                adjust_division_balance(dest, pe["divisionId"], amount)
            # Real money actually moved toward this (already recorded in
            # transfers above, so it's tracked even if this update fails)
            # - reflect it in amountSaved so Planned Expenses' progress
            # matches what's genuinely been set aside.
            try:
                pe_result = planned_expenses_table.update_item(
                    Key={"userId": user_id, "plannedExpenseId": pe["plannedExpenseId"]},
                    UpdateExpression="ADD amountSaved :amt",
                    ExpressionAttributeValues={":amt": amount},
                    ReturnValues="ALL_NEW",
                )
                pe_updated = pe_result.get("Attributes", {})
                if not pe_updated.get("completed", False) and is_funded(pe_updated):
                    complete_planned_expense(planned_expenses_table, user_id, pe_updated)
            except Exception as e:
                print(f"payday_sweep: planned expense progress update failed for user {user_id}, plannedExpenseId={pe['plannedExpenseId']}: {e}")
                errors.append({"type": "plannedExpenseUpdate", "plannedExpenseId": pe["plannedExpenseId"], "name": pe.get("name", ""), "error": str(e)})

    return transfers, errors
