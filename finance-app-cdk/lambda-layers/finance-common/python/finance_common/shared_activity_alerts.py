"""
Notifies an account's OWNER when someone they've shared it with (a shared
editor) adds, edits, or deletes something on it. Transparency-first: alerts
default ON for every user, no explicit opt-in required - a preference row
only needs to exist once someone actually turns this off.

Requires USER_PREFERENCES_TABLE and SES_FROM_ADDRESS environment variables.
"""
import os
import boto3

from .cognito_lookup import lookup_email_by_sub
from .user_preferences import get_preference

_ses_client = boto3.client("ses")


def are_shared_activity_alerts_enabled(user_id):
    """Defaults to True (transparency-first) when no preference row exists -
    an absent row is not the same as an explicit opt-out."""
    return get_preference(user_id, "sharedActivityAlertsEnabled", True)


def notify_owner_of_shared_activity(owner_id, actor_id, summary):
    """summary is a short, human-readable description of what happened,
    e.g. "added a $42.50 expense (Groceries) to Everyday Checking" - this
    function only sends when actor_id != owner_id (i.e. only for activity
    that wasn't the owner acting on their own account) and only when the
    owner hasn't turned these alerts off. Best-effort: any failure here is
    swallowed rather than raised, since a notification email failing
    should never break the underlying write that triggered it."""
    if actor_id == owner_id:
        return
    if not are_shared_activity_alerts_enabled(owner_id):
        return

    try:
        owner_email = lookup_email_by_sub(owner_id)
        if not owner_email:
            return
        actor_email = lookup_email_by_sub(actor_id) or "Someone you've shared an account with"

        _ses_client.send_email(
            Source=os.environ.get("SES_FROM_ADDRESS", "alerts@example.com"),
            Destination={"ToAddresses": [owner_email]},
            Message={
                "Subject": {"Data": "Activity on your shared account"},
                "Body": {"Text": {"Data": f"{actor_email} {summary}."}},
            },
        )
    except Exception:
        pass
