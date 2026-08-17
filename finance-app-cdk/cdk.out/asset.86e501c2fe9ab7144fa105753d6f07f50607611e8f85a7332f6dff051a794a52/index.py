"""
Sharing Lambda
Routes:
  GET  /sharing                 -> list shares involving the caller, both
                                    as the owner (accounts they've shared
                                    out) and as the invited user (shares
                                    directed at them, pending or accepted)
  POST /sharing                 -> primary user invites another user by email
                                    to an account, with an account-level
                                    permission plus an independent
                                    permission for each associated data type
  PUT  /sharing/{invitationId}  -> invited user accepts or declines.
                                    {invitationId} is the OWNER's user id -
                                    the other half of the sharing table's
                                    composite key (ownerUserId + invitedUserId).
                                    The invited user's half comes from their
                                    own auth token, never from the URL/body -
                                    so a lookup can only ever resolve to an
                                    invite actually addressed to the caller.

Sharing is accept-required: the share has no effect until status = "accepted".

Permissions are granted per data type, each independently one of:
  "not_shared" | "view" | "edit"
Data types: income, budgets, projections, recurring, plannedExpenses.
Any type omitted from the request defaults to "not_shared" - nothing is
implicitly shared just because the account itself was shared. E.g. the
account can be view-only while recurring transactions on it are fully
editable by the invited user, and planned expenses aren't shared at all.
"""
import os
import json
import boto3
from finance_common.cognito_lookup import lookup_user_id_by_email, lookup_email_by_sub
from finance_common.http_response import response as _response

dynamodb = boto3.resource("dynamodb")
sharing_table = dynamodb.Table(os.environ["SHARING_TABLE"])

VALID_ACCOUNT_PERMISSIONS = {"view", "edit"}  # the account share itself always grants at least view
VALID_DATA_PERMISSIONS = {"not_shared", "view", "edit"}
DATA_PERMISSION_TYPES = ("income", "budgets", "projections", "recurring", "plannedExpenses")


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if method == "GET":
        return _list_shares(user_id)
    if method == "POST":
        return _create_invite(user_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        owner_user_id = event["pathParameters"]["invitationId"]
        return _respond_to_invite(user_id, owner_user_id, json.loads(event.get("body") or "{}"))

    return _response(405, {"error": "Method not allowed"})


def _list_shares(user_id):
    as_owner = sharing_table.query(
        KeyConditionExpression="ownerUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])

    as_invited = sharing_table.query(
        IndexName="byInvitedUser",
        KeyConditionExpression="invitedUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])

    # The invited side previously had no identifying info about who was
    # sharing with them at all - just a raw Cognito user id. Resolve it to
    # an email, same lookup already used for shared-activity alerts.
    for share in as_invited:
        share["ownerEmail"] = lookup_email_by_sub(share["ownerUserId"])

    return _response(200, {"asOwner": as_owner, "asInvited": as_invited})


def _create_invite(owner_user_id, body):
    invited_email = body.get("invitedEmail")
    account_permission = body.get("accountPermission")

    if account_permission not in VALID_ACCOUNT_PERMISSIONS:
        return _response(400, {"error": f"accountPermission must be one of {sorted(VALID_ACCOUNT_PERMISSIONS)}"})

    data_permissions_input = body.get("dataPermissions", {})
    data_permissions = {}
    for data_type in DATA_PERMISSION_TYPES:
        value = data_permissions_input.get(data_type, "not_shared")
        if value not in VALID_DATA_PERMISSIONS:
            return _response(
                400,
                {"error": f"dataPermissions.{data_type} must be one of {sorted(VALID_DATA_PERMISSIONS)}"},
            )
        data_permissions[data_type] = value

    invited_user_id = lookup_user_id_by_email(invited_email)
    if not invited_user_id:
        return _response(404, {"error": "No user found with that email"})

    item = {
        "ownerUserId": owner_user_id,
        "invitedUserId": invited_user_id,
        "invitedEmail": invited_email,
        "accountId": body.get("accountId"),
        "accountPermission": account_permission,
        "dataPermissions": data_permissions,  # {"income": "view", "recurring": "edit", "plannedExpenses": "not_shared", ...}
        "status": "pending",
    }
    sharing_table.put_item(Item=item)
    return _response(201, item)


def _respond_to_invite(invited_user_id, owner_user_id, body):
    new_status = body.get("status")
    if new_status not in {"accepted", "declined"}:
        return _response(400, {"error": "status must be 'accepted' or 'declined'"})

    existing = sharing_table.get_item(
        Key={"ownerUserId": owner_user_id, "invitedUserId": invited_user_id}
    ).get("Item")
    if not existing:
        # Either no such invite exists, or it wasn't addressed to this
        # caller - either way, nothing to reveal beyond "not found".
        return _response(404, {"error": "invitation not found"})
    if existing["status"] != "pending":
        return _response(409, {"error": f"invitation already {existing['status']}"})

    sharing_table.update_item(
        Key={"ownerUserId": owner_user_id, "invitedUserId": invited_user_id},
        UpdateExpression="SET #s = :status",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":status": new_status},
    )

    return _response(200, {"ownerUserId": owner_user_id, "status": new_status})



