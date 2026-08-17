"""
Resolves whether a caller has access to an account - either because they
own it, or because its owner has shared it with them via an ACCEPTED
Sharing invite - and at what permission level.

This closes a real gap: before this existed, transactions-fn's
_list_transactions had NO ownership/sharing check at all (any signed-in
user who knew an accountId could read its transactions), and every write
path updated the account balance keyed by the CALLER's own user id rather
than the account's actual owner - meaning a shared "edit" user attempting
to use that access would silently create a phantom Accounts-table item
under their own id rather than updating the real account.

Requires ACCOUNTS_TABLE and SHARING_TABLE environment variables (both
already present in every function's commonEnv).
"""
import os
import boto3

_dynamodb = boto3.resource("dynamodb")


def _accounts_table():
    return _dynamodb.Table(os.environ["ACCOUNTS_TABLE"])


def _sharing_table():
    return _dynamodb.Table(os.environ["SHARING_TABLE"])


def resolve_account_access(caller_id, account_id):
    """Returns {"ownerUserId": ..., "permission": "edit"|"view", "isOwner": bool,
    "dataPermissions": dict|None} if the caller can access this account at
    all, or None if they can't.

    dataPermissions is the raw {"income": "view", "recurring": "edit", ...}
    map from the Sharing row when the caller is a shared (non-owner) user,
    or None when they're the owner - an owner's access to every data type
    is implicitly full, so there's nothing meaningful to look up. Callers
    that need a data-type-specific permission (recurring, income, etc. -
    see sharing/index.py's DATA_PERMISSION_TYPES) should check
    dataPermissions themselves rather than the flat `permission` field,
    which only reflects the base account-level share.

    Callers should treat isOwner=True as always edit-level, and otherwise
    check permission against what the operation requires (a GET only needs
    SOME access; a write needs permission == "edit")."""
    owned = _accounts_table().get_item(Key={"userId": caller_id, "accountId": account_id}).get("Item")
    if owned:
        return {"ownerUserId": caller_id, "permission": "edit", "isOwner": True, "dataPermissions": None}

    # Not the owner - check for an accepted share granting them access to
    # THIS specific account. byInvitedUser is keyed by (invitedUserId,
    # status), not accountId, so this scans the caller's own accepted
    # shares (typically a handful) rather than the whole table.
    shares = _sharing_table().query(
        IndexName="byInvitedUser",
        KeyConditionExpression="invitedUserId = :uid AND #s = :accepted",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":uid": caller_id, ":accepted": "accepted"},
    ).get("Items", [])

    for share in shares:
        if share.get("accountId") == account_id:
            return {
                "ownerUserId": share["ownerUserId"],
                "permission": share.get("accountPermission", "view"),
                "isOwner": False,
                "dataPermissions": share.get("dataPermissions") or {},
            }

    return None
