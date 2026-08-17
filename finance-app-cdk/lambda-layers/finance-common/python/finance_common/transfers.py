"""
Shared fund-transfer logic between two of a user's own accounts.
Used by transactions-fn's direct POST /transactions/transfer endpoint
and by payday-fn's automatic budget/planned-expense transfers on
submit - single source of truth so both stay consistent (same
transaction shape, same balance-update behavior, same low-balance
alert check).
"""
import uuid
import decimal
from datetime import datetime, timezone

from .low_balance_alerts import check_low_balance_alert


def execute_transfer(accounts_table, transactions_table, user_id, from_account_id, to_account_id, amount, description="", ts=None):
    """Moves real money between two of the user's own accounts - or, if
    from_account_id equals to_account_id, between two divisions within
    the same account (the two balance updates below net to zero on the
    account itself, which is correct - the money never left the
    account, only shifted which division it's tagged under). Two
    linked transactions (a debit and a credit) plus the corresponding
    balance updates either way. Returns None if either account isn't
    found for this user, or the amount is invalid - callers decide
    whether that's worth surfacing as an error or silently skipping
    (Payday's automatic transfers skip; the direct transfer endpoint
    errors). A true no-op (same account AND same division) is the
    caller's responsibility to reject before calling this."""
    if amount <= 0:
        return None

    for acct_id in (from_account_id, to_account_id):
        owned = accounts_table.get_item(Key={"userId": user_id, "accountId": acct_id}).get("Item")
        if not owned:
            return None

    ts = ts or datetime.now(timezone.utc).isoformat()
    amount = decimal.Decimal(str(amount))
    transfer_id = str(uuid.uuid4())
    out_txn_id = str(uuid.uuid4())
    in_txn_id = str(uuid.uuid4())

    # NOTE: category "Transfer" is intentionally excluded from budget
    # aggregation logic - moving money between your own accounts
    # shouldn't count as spending against a budget.
    out_item = {
        "accountId": from_account_id,
        "sk": f"{ts}#{out_txn_id}",
        "txnId": out_txn_id,
        "userId": user_id,
        "amount": amount,
        "category": "Transfer",
        "description": description[:250],
        "direction": "debit",
        "createdAt": ts,
        "isTransfer": True,
        "transferId": transfer_id,
        "transferCounterpartyAccountId": to_account_id,
    }
    in_item = {
        "accountId": to_account_id,
        "sk": f"{ts}#{in_txn_id}",
        "txnId": in_txn_id,
        "userId": user_id,
        "amount": amount,
        "category": "Transfer",
        "description": description[:250],
        "direction": "credit",
        "createdAt": ts,
        "isTransfer": True,
        "transferId": transfer_id,
        "transferCounterpartyAccountId": from_account_id,
    }

    transactions_table.put_item(Item=out_item)
    transactions_table.put_item(Item=in_item)

    from_result = accounts_table.update_item(
        Key={"userId": user_id, "accountId": from_account_id},
        UpdateExpression="ADD balance :neg",
        ExpressionAttributeValues={":neg": -amount},
        ReturnValues="UPDATED_NEW",
    )
    to_result = accounts_table.update_item(
        Key={"userId": user_id, "accountId": to_account_id},
        UpdateExpression="ADD balance :pos",
        ExpressionAttributeValues={":pos": amount},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(user_id, from_account_id, from_result["Attributes"]["balance"])
    check_low_balance_alert(user_id, to_account_id, to_result["Attributes"]["balance"])

    return {"transferId": transfer_id, "out": out_item, "in": in_item}
