"""
Low-balance alert: emails an account owner when a balance-changing
operation leaves one of their accounts below a threshold they've set.

Off by default (lowBalanceAlertsEnabled=False) and a no-op if no threshold
has been set - turning the toggle on without setting a threshold does
nothing, rather than alerting on every account that happens to be low or
erroring out. Requires ACCOUNTS_TABLE, USER_PREFERENCES_TABLE, USER_POOL_ID,
SES_FROM_ADDRESS.
"""
import os
import boto3

from .cognito_lookup import lookup_email_by_sub
from .user_preferences import get_preference

_dynamodb = boto3.resource("dynamodb")
_ses_client = boto3.client("ses")


def check_low_balance_alert(owner_id, account_id, new_balance):
    """Call this after any operation that changes an account's balance,
    with the balance AFTER the change. Best-effort: any failure here is
    swallowed, never raised - a notification check failing (including the
    preference lookups below, not just the email send) should never break
    the underlying write that triggered it. The whole body is wrapped, not
    just the email-sending tail, since a caller like Payday's batch submit
    depends on this never raising partway through an already-committed
    balance update."""
    try:
        if not get_preference(owner_id, "lowBalanceAlertsEnabled", False):
            return
        threshold = get_preference(owner_id, "lowBalanceThresholdAmount", None)
        if threshold is None:
            return
        if float(new_balance) >= float(threshold):
            return

        owner_email = lookup_email_by_sub(owner_id)
        if not owner_email:
            return
        account_name = _lookup_account_name(owner_id, account_id)

        _ses_client.send_email(
            Source=os.environ.get("SES_FROM_ADDRESS", "alerts@example.com"),
            Destination={"ToAddresses": [owner_email]},
            Message={
                "Subject": {"Data": f"Low balance: {account_name}"},
                "Body": {
                    "Text": {
                        "Data": (
                            f"{account_name} is now at ${float(new_balance):.2f}, "
                            f"below your ${float(threshold):.2f} alert threshold."
                        )
                    }
                },
            },
        )
    except Exception:
        pass


def _lookup_account_name(owner_id, account_id):
    table = _dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
    item = table.get_item(Key={"userId": owner_id, "accountId": account_id}).get("Item")
    return item["name"] if item else "one of your accounts"
