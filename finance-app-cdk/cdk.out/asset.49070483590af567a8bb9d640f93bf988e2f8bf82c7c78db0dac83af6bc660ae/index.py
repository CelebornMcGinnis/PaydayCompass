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
    # TODO: build an UpdateExpression from whichever fields are present
    # (name, type, balance) rather than overwriting the whole item.
    return _response(501, {"error": "not yet implemented"})


def _delete_account(user_id, account_id):
    accounts_table.delete_item(Key={"userId": user_id, "accountId": account_id})
    # TODO: also consider what happens to that account's transactions/recurring
    # templates/budgets - cascade delete or archive, decide before shipping.
    return _response(204, None)


