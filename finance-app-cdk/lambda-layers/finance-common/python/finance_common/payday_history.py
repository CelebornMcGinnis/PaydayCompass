"""
Payday history: a disposable (TTL'd 1.5yr) per-user, per-date snapshot of
what actually moved on a given real payday - the real transactions/
transfers remain the actual source of truth indefinitely; this is just
what lets Payday Review browse past paydays without re-deriving them.

Shared between payday-fn (a manual/early submit) and recurring_processor
(the daily auto-sweep) - both write the same shape, distinguished only by
`reviewed`: a manual submit is reviewed by definition (the user just
directly interacted with it); an auto-sweep starts unreviewed, which is
what drives the "needs review" badge until the user browses to that date.
"""
import os
from datetime import datetime, timedelta, timezone
import boto3

_dynamodb = boto3.resource("dynamodb")


def _payday_history_table():
    return _dynamodb.Table(os.environ["PAYDAY_HISTORY_TABLE"])


def _to_decimal(value):
    import decimal
    if isinstance(value, float):
        return decimal.Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_decimal(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal(v) for v in value]
    return value


def save_payday_history(user_id, payday_date, posted, transfers=None, errors=None, reviewed=True,
                         corrections=None, submitted_at=None):
    """Best-effort: a failure here should never block the real money
    movement above it, which has already happened by this point.
    submitted_at defaults to now (a fresh record); pass the original
    record's value through when re-saving after a correction, so the
    record keeps remembering when the money first actually moved."""
    try:
        expires_at = int((datetime.now(timezone.utc) + timedelta(days=548)).timestamp())
        _payday_history_table().put_item(Item={
            "userId": user_id,
            "paydayDate": payday_date,
            "submittedAt": submitted_at or datetime.now(timezone.utc).isoformat(),
            "posted": _to_decimal(posted or []),
            "transfers": _to_decimal(transfers or []),
            "errors": _to_decimal(errors or []),
            "corrections": _to_decimal(corrections or []),
            "reviewed": reviewed,
            "expiresAt": expires_at,
        })
    except Exception as e:
        print(f"payday history save failed for user {user_id}, paydayDate={payday_date}: {e}")


def get_payday_history(user_id, payday_date):
    return _payday_history_table().get_item(Key={"userId": user_id, "paydayDate": payday_date}).get("Item")


def mark_reviewed(user_id, payday_date):
    """Best-effort: called when the user explicitly browses to this date
    in Payday Review - never worth failing the page load over."""
    try:
        _payday_history_table().update_item(
            Key={"userId": user_id, "paydayDate": payday_date},
            UpdateExpression="SET reviewed = :true",
            ExpressionAttributeValues={":true": True},
        )
    except Exception as e:
        print(f"payday history mark-reviewed failed for user {user_id}, paydayDate={payday_date}: {e}")
