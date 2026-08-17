"""
Shared division-balance adjustment. A division is a named sub-allocation
within one account's balance (see lambda/divisions/index.py) - when a
recurring income/expense tagged with a divisionId posts, both the
account's own balance AND the division's running balance need updating.
Kept here (not in divisions-fn's own code) since recurring_processor and
payday are separate Lambda packages and can't import from another
function's deployment package directly.
"""
import os
import decimal
import boto3

_divisions_table = None


def _get_divisions_table():
    global _divisions_table
    if _divisions_table is None:
        _divisions_table = boto3.resource("dynamodb").Table(os.environ["DIVISIONS_TABLE"])
    return _divisions_table


def adjust_division_balance(account_id, division_id, delta):
    """Adjusts a division's running balance the same way an account's
    balance updates. Best-effort: a missing division (already deleted,
    or never existed) is silently skipped rather than failing the whole
    posting, since the division is sub-tracking, not the source of truth
    for the actual money movement - that's still the account balance and
    the real transaction record, both of which have already succeeded by
    the time this is called."""
    if not division_id:
        return
    try:
        _get_divisions_table().update_item(
            Key={"accountId": account_id, "divisionId": division_id},
            UpdateExpression="ADD balance :delta",
            ExpressionAttributeValues={":delta": decimal.Decimal(str(delta))},
            ConditionExpression="attribute_exists(divisionId)",
        )
    except Exception:
        pass
