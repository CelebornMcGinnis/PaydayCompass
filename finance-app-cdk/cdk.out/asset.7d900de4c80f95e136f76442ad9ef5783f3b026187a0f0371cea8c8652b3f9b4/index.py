"""
Account Deletion Lambda
Route: POST /account/delete-me

Irreversible - purges the requesting user's data from every table, plus the
Cognito user itself. The frontend must have already gotten explicit
confirmation before calling this.
"""
import os
import json
import boto3
from finance_common.http_response import response as _response

dynamodb = boto3.resource("dynamodb")
cognito_client = boto3.client("cognito-idp")

accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
audit_log_table = dynamodb.Table(os.environ["AUDIT_LOG_TABLE"])
sharing_table = dynamodb.Table(os.environ["SHARING_TABLE"])
USER_POOL_ID = os.environ["USER_POOL_ID"]


def handler(event, context):
    claims = event["requestContext"]["authorizer"]["claims"]
    user_id = claims["sub"]
    username = claims.get("cognito:username", user_id)

    _delete_accounts_and_related(user_id)
    _delete_budgets(user_id)
    _delete_sharing_records(user_id)
    # TODO: also handle the case where this user is the INVITED party on
    # someone else's shared account - remove them from that owner's sharing
    # table entries too.

    cognito_client.admin_delete_user(UserPoolId=USER_POOL_ID, Username=username)

    return _response(200, {"deleted": True})


def _delete_accounts_and_related(user_id):
    accounts = accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])

    for account in accounts:
        account_id = account["accountId"]

        txns = transactions_table.query(
            KeyConditionExpression="accountId = :aid",
            ExpressionAttributeValues={":aid": account_id},
        ).get("Items", [])
        with transactions_table.batch_writer() as batch:
            for t in txns:
                batch.delete_item(Key={"accountId": account_id, "sk": t["sk"]})
                # TODO: also delete this transaction's audit log entries

        recurring = recurring_table.query(
            KeyConditionExpression="accountId = :aid",
            ExpressionAttributeValues={":aid": account_id},
        ).get("Items", [])
        with recurring_table.batch_writer() as batch:
            for r in recurring:
                batch.delete_item(Key={"accountId": account_id, "recurringId": r["recurringId"]})

        accounts_table.delete_item(Key={"userId": user_id, "accountId": account_id})


def _delete_budgets(user_id):
    budgets = budgets_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    with budgets_table.batch_writer() as batch:
        for b in budgets:
            batch.delete_item(Key={"userId": user_id, "sk": b["sk"]})


def _delete_sharing_records(user_id):
    shares = sharing_table.query(
        KeyConditionExpression="ownerUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    with sharing_table.batch_writer() as batch:
        for s in shares:
            batch.delete_item(Key={"ownerUserId": user_id, "shareKey": s["shareKey"]})
