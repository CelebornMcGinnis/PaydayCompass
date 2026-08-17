"""
Accounts Lambda
Routes (via API Gateway):
  GET    /accounts                -> list all accounts for the authenticated user,
                                      PLUS any accounts shared with them (accepted only)
  POST   /accounts                -> create a new account (name, type, starting balance)
  PUT    /accounts/{accountId}    -> edit an account (name, type, balance)
  DELETE /accounts/{accountId}    -> remove an account

The Cognito `sub` (user id) comes from the API Gateway authorizer claims,
never trust an id passed in the request body.

Shared accounts: previously a user with an accepted share had no way to
even see the shared account existed - GET only ever queried the caller's
own accounts. Now it also pulls the caller's accepted shares and fetches
each shared account's real record (from the OWNER's row, since Accounts
is keyed by owner), tagged with sharedFromUserId/sharedPermission so the
frontend can distinguish "mine" from "shared with me" and respect
view-only vs. edit accordingly.
"""
import os
import json
import uuid
import decimal
import boto3
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
sharing_table = dynamodb.Table(os.environ["SHARING_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])

VALID_ACCOUNT_TYPES = {"checking", "savings", "credit", "investment", "other"}


def handler(event, context):
    method = event["httpMethod"]
    user_id = _get_user_id(event)

    if method == "GET":
        return _list_accounts(user_id)
    if method == "POST":
        return _create_account(user_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        account_id = event["pathParameters"]["accountId"]
        return _update_account(user_id, account_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        account_id = event["pathParameters"]["accountId"]
        return _delete_account(user_id, account_id)

    return _response(405, {"error": "Method not allowed"})


def _get_user_id(event):
    return event["requestContext"]["authorizer"]["claims"]["sub"]


def _list_accounts(user_id):
    own = accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])

    shared = _get_shared_accounts(user_id)

    return _response(200, own + shared, default=_decimal_default)


def _get_shared_accounts(user_id):
    """Accounts owned by someone else who has shared them with this user,
    via an accepted invite. byInvitedUser is keyed by (invitedUserId,
    status), so this only ever touches the caller's own accepted shares."""
    shares = sharing_table.query(
        IndexName="byInvitedUser",
        KeyConditionExpression="invitedUserId = :uid AND #s = :accepted",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":uid": user_id, ":accepted": "accepted"},
    ).get("Items", [])

    shared_accounts = []
    for share in shares:
        owner_id = share["ownerUserId"]
        account_id = share.get("accountId")
        if not account_id:
            continue
        account = accounts_table.get_item(Key={"userId": owner_id, "accountId": account_id}).get("Item")
        if not account:
            continue  # the owner deleted the account since sharing it
        tagged = dict(account)
        tagged["sharedFromUserId"] = owner_id
        tagged["sharedPermission"] = share.get("accountPermission", "view")
        shared_accounts.append(tagged)
    return shared_accounts


def _create_account(user_id, body):
    account_type = body.get("type")
    if account_type not in VALID_ACCOUNT_TYPES:
        return _response(400, {"error": f"type must be one of {sorted(VALID_ACCOUNT_TYPES)}"})

    account_id = str(uuid.uuid4())
    item = {
        "userId": user_id,
        "accountId": account_id,
        "name": body.get("name", "Untitled Account"),
        "type": account_type,
        "balance": decimal.Decimal(str(body.get("balance", 0))),
        "currency": body.get("currency", "USD"),
    }
    accounts_table.put_item(Item=item)
    return _response(201, item, default=_decimal_default)


def _update_account(user_id, account_id, body):
    existing = accounts_table.get_item(Key={"userId": user_id, "accountId": account_id}).get("Item")
    if not existing:
        return _response(404, {"error": "account not found"})

    updates = {}
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            return _response(400, {"error": "name can't be empty"})
        updates["name"] = name[:100]
    if "type" in body:
        if body["type"] not in VALID_ACCOUNT_TYPES:
            return _response(400, {"error": f"type must be one of {sorted(VALID_ACCOUNT_TYPES)}"})
        updates["type"] = body["type"]

    if not updates:
        return _response(400, {"error": "nothing to update - provide name and/or type"})

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    result = accounts_table.update_item(
        Key={"userId": user_id, "accountId": account_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
        ReturnValues="ALL_NEW",
    )
    return _response(200, result["Attributes"], default=_decimal_default)


def _delete_account(user_id, account_id):
    existing = accounts_table.get_item(Key={"userId": user_id, "accountId": account_id}).get("Item")
    if not existing:
        return _response(404, {"error": "account not found"})

    # Recurring templates actively post real transactions and update this
    # account's balance on their own schedule - deleting the account out
    # from under one would either silently recreate a bare orphan account
    # record (DynamoDB's update_item upserts on a missing key) or fail
    # confusingly later. Block deletion rather than risk either.
    dependent_recurring = recurring_table.query(
        KeyConditionExpression="accountId = :aid",
        ExpressionAttributeValues={":aid": account_id},
        Limit=1,
    ).get("Items", [])
    if dependent_recurring:
        return _response(409, {"error": "This account still has recurring income or expenses tied to it. Delete or reassign those first."})

    # Budgets/Planned Expenses only reference an account as an optional
    # money-movement *destination* (see finance_common/transfers.py) -
    # nothing breaks if that reference goes stale, so clear it rather
    # than block deletion; the budget/planned expense itself is
    # unaffected, it just stops auto-transferring until reassigned.
    budgets = budgets_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    for b in budgets:
        if b.get("accountId") == account_id:
            budgets_table.update_item(
                Key={"userId": user_id, "sk": b["sk"]},
                UpdateExpression="REMOVE accountId",
            )

    planned_items = planned_expenses_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    for pe in planned_items:
        if pe.get("linkedAccountId") == account_id:
            planned_expenses_table.update_item(
                Key={"userId": user_id, "plannedExpenseId": pe["plannedExpenseId"]},
                UpdateExpression="REMOVE linkedAccountId",
            )

    # Historical transactions on this account are left as-is (append-only
    # record, same treatment as everywhere else in the app) - only the
    # account record itself goes away.
    accounts_table.delete_item(Key={"userId": user_id, "accountId": account_id})
    return _response(204, None)


