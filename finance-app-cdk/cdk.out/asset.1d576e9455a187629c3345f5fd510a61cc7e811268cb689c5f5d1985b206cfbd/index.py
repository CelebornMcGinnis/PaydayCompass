"""
External Bank Accounts Lambda
Routes:
  GET    /external-bank-accounts               -> list this user's external bank accounts
  POST   /external-bank-accounts               -> add one
  PUT    /external-bank-accounts/{id}          -> rename/edit one
  DELETE /external-bank-accounts/{id}          -> remove one

These are NOT app-tracked Accounts - just a small user-maintained list of
labels for real-world bank accounts that live outside the app entirely
(e.g. a joint account not otherwise onboarded). A recurring expense can be
tagged with one of these, purely for grouping/aggregation purposes (see the
payday wizard's "money to move out, by bank account" summary).

Deleting an entry here does NOT touch any recurring template that
referenced it - the recurring Lambda is responsible for handling a dangling
reference (e.g. showing "no longer set" rather than failing).
"""
import os
import json
import uuid
import boto3
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
external_bank_accounts_table = dynamodb.Table(os.environ["EXTERNAL_BANK_ACCOUNTS_TABLE"])


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if method == "GET":
        return _list(user_id)
    if method == "POST":
        return _create(user_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        external_id = event["pathParameters"]["externalBankAccountId"]
        return _update(user_id, external_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        external_id = event["pathParameters"]["externalBankAccountId"]
        return _delete(user_id, external_id)

    return _response(405, {"error": "Method not allowed"})


def _list(user_id):
    result = external_bank_accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    return _response(200, result.get("Items", []))


def _create(user_id, body):
    name = (body.get("name") or "").strip()
    if not name:
        return _response(400, {"error": "name is required"})

    item = {
        "userId": user_id,
        "externalBankAccountId": str(uuid.uuid4()),
        "name": name,
    }
    external_bank_accounts_table.put_item(Item=item)
    return _response(201, item)


def _update(user_id, external_id, body):
    name = (body.get("name") or "").strip()
    if not name:
        return _response(400, {"error": "name is required"})

    external_bank_accounts_table.update_item(
        Key={"userId": user_id, "externalBankAccountId": external_id},
        UpdateExpression="SET #n = :name",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={":name": name},
    )
    return _response(200, {"userId": user_id, "externalBankAccountId": external_id, "name": name})


def _delete(user_id, external_id):
    external_bank_accounts_table.delete_item(
        Key={"userId": user_id, "externalBankAccountId": external_id}
    )
    return _response(204, None)


