"""
Sharing Lambda
Routes:
  GET    /sharing                 -> list shares involving the caller, both
                                      as the owner (accounts they've shared
                                      out) and as the invited user (shares
                                      directed at them, pending or accepted)
  POST   /sharing                 -> primary user invites another user by
                                      email to one or more accounts at once,
                                      with an account-level permission plus
                                      an independent permission for each
                                      associated data type - applied
                                      identically to every account in the
                                      request. One row is created per
                                      account, but only ONE email is sent
                                      covering all of them.
  PUT    /sharing/{invitationId}  -> invited user accepts or declines.
                                      {invitationId} is the OWNER's user id.
                                      Applies to EVERY pending share from
                                      that owner to the caller at once (the
                                      batch-accept counterpart to the
                                      batch-invite above) - not just one
                                      account at a time.
  DELETE /sharing/{invitationId}  -> owner revokes every share (any status)
                                      they've extended to that invited user.
                                      {invitationId} here is the INVITED
                                      user's id, since it's the owner acting.

Sharing is accept-required: a share has no effect until status = "accepted".

Data model note: the table's sort key is shareKey =
"{invitedUserId}#{accountId}", NOT invitedUserId alone - this is what
makes sharing multiple accounts with the same person possible at all.
invitedUserId remains a plain attribute (not part of the key) so the
byInvitedUser GSI can still find "shares directed at me" without a scan.

Permissions are granted per data type, each independently one of:
  "not_shared" | "view" | "edit"
Data types: income, budgets, projections, recurring, plannedExpenses.
Any type omitted from the request defaults to "not_shared" - nothing is
implicitly shared just because the account itself was shared.
"""
import os
import json
import boto3
from finance_common.cognito_lookup import lookup_user_id_by_email, lookup_email_by_sub
from finance_common.http_response import response as _response

dynamodb = boto3.resource("dynamodb")
sharing_table = dynamodb.Table(os.environ["SHARING_TABLE"])
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
ses_client = boto3.client("ses")
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS", "alerts@example.com")

VALID_ACCOUNT_PERMISSIONS = {"view", "edit"}  # the account share itself always grants at least view
VALID_DATA_PERMISSIONS = {"not_shared", "view", "edit"}
DATA_PERMISSION_TYPES = ("income", "budgets", "projections", "recurring", "plannedExpenses", "modifyTransactions")


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if method == "GET":
        return _list_shares(user_id)
    if method == "POST":
        return _create_invites(user_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        path_parts = event["resource"].split("/")
        if "accounts" in path_parts:
            invited_user_id = event["pathParameters"]["invitationId"]
            account_id = event["pathParameters"]["accountId"]
            return _update_share_permissions(user_id, invited_user_id, account_id, json.loads(event.get("body") or "{}"))
        owner_user_id = event["pathParameters"]["invitationId"]
        return _respond_to_invites(user_id, owner_user_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        invited_user_id = event["pathParameters"]["invitationId"]
        return _revoke_shares(user_id, invited_user_id)

    return _response(405, {"error": "Method not allowed"})


def _update_share_permissions(owner_user_id, invited_user_id, account_id, body):
    """Lets the owner modify an existing (any status) share's permissions
    for one specific account, without having to revoke and re-invite from
    scratch. Only fields actually present in the body are changed."""
    share_key = f"{invited_user_id}#{account_id}"
    existing = sharing_table.get_item(Key={"ownerUserId": owner_user_id, "shareKey": share_key}).get("Item")
    if not existing:
        return _response(404, {"error": "no share found for that user and account"})

    updates = {}
    if "accountPermission" in body:
        if body["accountPermission"] not in VALID_ACCOUNT_PERMISSIONS:
            return _response(400, {"error": f"accountPermission must be one of {sorted(VALID_ACCOUNT_PERMISSIONS)}"})
        updates["accountPermission"] = body["accountPermission"]
    if "dataPermissions" in body:
        data_permissions = {}
        for data_type in DATA_PERMISSION_TYPES:
            value = body["dataPermissions"].get(data_type, existing.get("dataPermissions", {}).get(data_type, "not_shared"))
            if value not in VALID_DATA_PERMISSIONS:
                return _response(400, {"error": f"dataPermissions.{data_type} must be one of {sorted(VALID_DATA_PERMISSIONS)}"})
            data_permissions[data_type] = value
        updates["dataPermissions"] = data_permissions

    if not updates:
        return _response(400, {"error": "nothing to update - provide accountPermission and/or dataPermissions"})

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    sharing_table.update_item(
        Key={"ownerUserId": owner_user_id, "shareKey": share_key},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )
    return _response(200, {**existing, **updates})


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


def _create_invites(owner_user_id, body):
    invited_email = body.get("invitedEmail")
    account_permission = body.get("accountPermission")
    # Accept either a single accountId (back-compat with the original
    # one-account-per-request shape) or a list, for sharing several
    # accounts with the same person in one action.
    account_ids = body.get("accountIds")
    if account_ids is None:
        account_ids = [body["accountId"]] if body.get("accountId") else []

    if not account_ids:
        return _response(400, {"error": "at least one accountId is required"})
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

    created_items = []
    account_names = []
    for account_id in account_ids:
        item = {
            "ownerUserId": owner_user_id,
            "shareKey": f"{invited_user_id}#{account_id}",
            "invitedUserId": invited_user_id,
            "invitedEmail": invited_email,
            "accountId": account_id,
            "accountPermission": account_permission,
            "dataPermissions": data_permissions,  # {"income": "view", "recurring": "edit", ...}
            "status": "pending",
        }
        sharing_table.put_item(Item=item)
        created_items.append(item)

        account = accounts_table.get_item(Key={"userId": owner_user_id, "accountId": account_id}).get("Item")
        account_names.append(account["name"] if account else "an account")

    _send_invite_email(owner_user_id, invited_email, account_names, account_permission)

    return _response(201, {"shares": created_items})


def _send_invite_email(owner_user_id, invited_email, account_names, account_permission):
    """Best-effort - a failed email should never block the invite itself
    from being created, since the invite is still visible/actionable from
    inside the app regardless of whether this email arrives."""
    try:
        owner_email = lookup_email_by_sub(owner_user_id)
        accounts_list = ", ".join(account_names)
        plural = "s" if len(account_names) > 1 else ""
        ses_client.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [invited_email]},
            Message={
                "Subject": {"Data": f"{owner_email or 'Someone'} wants to share {len(account_names)} account{plural} with you"},
                "Body": {
                    "Text": {
                        "Data": (
                            f"{owner_email or 'Someone'} has invited you to access "
                            f"the following account{plural} ({account_permission} access): {accounts_list}.\n\n"
                            "Sign in to accept or decline this invitation."
                        )
                    }
                },
            },
        )
    except Exception:
        pass


def _respond_to_invites(invited_user_id, owner_user_id, body):
    """Accepts or declines every PENDING share this owner has extended to
    the caller at once - the batch counterpart to _create_invites sending
    one invite across several accounts. Responding doesn't require every
    account in the batch to still be pending; it just applies to whichever
    ones are."""
    new_status = body.get("status")
    if new_status not in {"accepted", "declined"}:
        return _response(400, {"error": "status must be 'accepted' or 'declined'"})

    # byInvitedUser's actual key schema is invitedUserId (hash) + status
    # (range) - shareKey isn't part of this index at all, so a
    # begins_with(shareKey, ...) key condition against it is invalid.
    # ownerUserId also isn't part of the key, so once narrowed to this
    # invited user's pending shares, the specific owner is filtered in
    # Python - fine at this scale (one owner's shares to one invited user
    # is never a large set).
    shares = sharing_table.query(
        IndexName="byInvitedUser",
        KeyConditionExpression="invitedUserId = :uid AND #s = :pending",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":uid": invited_user_id, ":pending": "pending"},
    ).get("Items", [])
    pending_from_owner = [s for s in shares if s.get("ownerUserId") == owner_user_id]

    if not pending_from_owner:
        return _response(404, {"error": "no pending invitation found from that owner"})

    for share in pending_from_owner:
        sharing_table.update_item(
            Key={"ownerUserId": owner_user_id, "shareKey": share["shareKey"]},
            UpdateExpression="SET #s = :status",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":status": new_status},
        )

    return _response(200, {"ownerUserId": owner_user_id, "status": new_status, "accountsAffected": len(pending_from_owner)})


def _revoke_shares(owner_user_id, invited_user_id):
    """Owner revokes every share (pending or accepted) they've extended to
    a given invited user - all accounts at once, matching how they were
    likely granted (in a batch) in the first place."""
    shares = sharing_table.query(
        KeyConditionExpression="ownerUserId = :owner AND begins_with(shareKey, :prefix)",
        ExpressionAttributeValues={":owner": owner_user_id, ":prefix": f"{invited_user_id}#"},
    ).get("Items", [])

    if not shares:
        return _response(404, {"error": "no shares found for that user"})

    for share in shares:
        sharing_table.delete_item(Key={"ownerUserId": owner_user_id, "shareKey": share["shareKey"]})

    return _response(204, None)
