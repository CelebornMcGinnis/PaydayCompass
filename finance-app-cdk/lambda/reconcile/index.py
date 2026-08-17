"""
Reconciliation Lambda
Route: POST /reconcile

Bulk wizard: the user enters what their bank actually shows for EVERY
account at once (no clicking into each account individually). For any
account where the actual balance differs from what the app has tracked,
this writes a single "Balance Adjustment" transaction closing the gap,
updates the account balance to match, and logs it in the audit trail.

Request body:
{
  "adjustments": [
    {"accountId": "...", "actualBalance": 1042.17, "category": "Groceries"},  # category optional
    {"accountId": "...", "actualBalance": 88.40}
  ]
}

"Balance Adjustment" is intentionally excluded from budget category totals
by default (same convention as Transfers) unless the user opts to assign a
real category to it, in which case it's treated like a normal expense/income
for budget purposes.
"""
import os
import json
import uuid
import decimal
from datetime import datetime, timezone
import boto3
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
audit_log_table = dynamodb.Table(os.environ["AUDIT_LOG_TABLE"])


def handler(event, context):
    if event["httpMethod"] != "POST":
        return _response(405, {"error": "Method not allowed"})

    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
    body = json.loads(event.get("body") or "{}")
    adjustments = body.get("adjustments", [])

    results = []
    for adj in adjustments:
        results.append(_reconcile_one(user_id, adj))

    return _response(200, {"results": results}, default=_decimal_default)


def _reconcile_one(user_id, adj):
    account_id = adj["accountId"]
    actual_balance = decimal.Decimal(str(adj["actualBalance"]))
    category = adj.get("category")  # None -> excluded from budget totals

    account = accounts_table.get_item(Key={"userId": user_id, "accountId": account_id}).get("Item")
    if not account:
        return {"accountId": account_id, "status": "error", "error": "account not found"}

    tracked_balance = decimal.Decimal(str(account["balance"]))
    delta = actual_balance - tracked_balance

    if delta == 0:
        return {"accountId": account_id, "status": "already_matched", "balance": float(actual_balance)}

    txn_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()
    item = {
        "accountId": account_id,
        "sk": f"{ts}#{txn_id}",
        "txnId": txn_id,
        "userId": user_id,
        "amount": abs(delta),
        "category": category or "Balance Adjustment",
        "description": "Reconciliation adjustment",
        "direction": "credit" if delta > 0 else "debit",
        "createdAt": ts,
        "isBalanceAdjustment": True,
        "categorizedByUser": category is not None,
    }
    transactions_table.put_item(Item=item)

    accounts_table.update_item(
        Key={"userId": user_id, "accountId": account_id},
        UpdateExpression="SET balance = :bal",
        ExpressionAttributeValues={":bal": actual_balance},
    )

    audit_log_table.put_item(
        Item={
            "transactionId": txn_id,
            "timestamp": ts,
            "action": "reconcile",
            "userId": user_id,
            "before": {"trackedBalance": str(tracked_balance)},
            "changes": {"actualBalance": str(actual_balance), "delta": str(delta)},
        }
    )

    return {
        "accountId": account_id,
        "status": "adjusted",
        "delta": float(delta),
        "newBalance": float(actual_balance),
        "transactionId": txn_id,
    }


