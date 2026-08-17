"""
Divisions Lambda
Routes:
  GET    /accounts/{accountId}/divisions               -> list this account's divisions
  POST   /accounts/{accountId}/divisions               -> create a division
  PUT    /accounts/{accountId}/divisions/{divisionId}   -> rename, or manually adjust balance
  DELETE /accounts/{accountId}/divisions/{divisionId}   -> remove

A division is a named sub-allocation within one account's overall balance -
e.g. an account with $500 total might have a "Vacation fund" division
holding $200 of that and a "Car maintenance" division holding $150, with
the remainder unallocated. Distinct from Budgets (a spending CAP per
category, not tied to one specific account) and Planned Expenses (a
savings target with a deadline).

A division's balance updates two ways:
  1. Automatically, when a recurring income/expense tagged with this
     division posts (see recurring_processor and payday's handling of
     divisionId) - same as how the account's own balance updates.
  2. Manually, via PUT here - e.g. to set an initial starting balance, or
     correct drift.

Divisions are informational sub-tracking, not a hard constraint: the sum
of an account's divisions isn't enforced to stay within the account's
actual balance. A user tracking intent ("I mean to set aside $200 for
this") shouldn't be blocked by a hard validation error over a temporary
mismatch.
"""
import os
import json
import uuid
import decimal
import boto3
from finance_common.http_response import response as _response, decimal_default as _decimal_default
from finance_common.sharing_access import resolve_account_access

dynamodb = boto3.resource("dynamodb")
divisions_table = dynamodb.Table(os.environ["DIVISIONS_TABLE"])


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
    account_id = event["pathParameters"]["accountId"]

    access = resolve_account_access(user_id, account_id)
    if not access:
        return _response(404, {"error": "account not found"})

    if method == "GET":
        return _list(account_id)

    # Everything past here writes - shared access needs edit permission,
    # same bar as recurring items on a shared account.
    if not access["isOwner"] and access["permission"] != "edit":
        return _response(403, {"error": "view-only access to this account"})

    if method == "POST":
        return _create(account_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        division_id = event["pathParameters"]["divisionId"]
        return _update(account_id, division_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        division_id = event["pathParameters"]["divisionId"]
        return _delete(account_id, division_id)

    return _response(405, {"error": "Method not allowed"})


def _list(account_id):
    items = divisions_table.query(
        KeyConditionExpression="accountId = :aid",
        ExpressionAttributeValues={":aid": account_id},
    ).get("Items", [])
    items.sort(key=lambda d: d.get("name", ""))
    return _response(200, items, default=_decimal_default)


def _create(account_id, body):
    name = (body.get("name") or "").strip()
    if not name:
        return _response(400, {"error": "name is required"})

    division_id = str(uuid.uuid4())
    item = {
        "accountId": account_id,
        "divisionId": division_id,
        "name": name[:100],
        "balance": decimal.Decimal(str(body.get("startingBalance", 0))),
    }
    divisions_table.put_item(Item=item)
    return _response(201, item, default=_decimal_default)


def _update(account_id, division_id, body):
    existing = divisions_table.get_item(Key={"accountId": account_id, "divisionId": division_id}).get("Item")
    if not existing:
        return _response(404, {"error": "division not found"})

    updates = {}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return _response(400, {"error": "name can't be empty"})
        updates["name"] = name[:100]
    if "balance" in body:
        updates["balance"] = decimal.Decimal(str(body["balance"]))

    if not updates:
        return _response(400, {"error": "nothing to update - provide name and/or balance"})

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    result = divisions_table.update_item(
        Key={"accountId": account_id, "divisionId": division_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
        ReturnValues="ALL_NEW",
    )
    return _response(200, result["Attributes"], default=_decimal_default)


def _delete(account_id, division_id):
    divisions_table.delete_item(Key={"accountId": account_id, "divisionId": division_id})
    # Recurring items tagged with this division simply stop updating a
    # division balance once it's gone (see finance_common/divisions.py,
    # used by recurring_processor and payday - both skip the division-
    # balance update, not the whole posting, if it's missing) - the item
    # itself and its account-level posting are unaffected.
    return _response(204, None)
