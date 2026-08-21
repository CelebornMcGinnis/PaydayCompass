"""
Best-effort "this posted" email for a recurring income/expense - mirrors
budget_notify.trigger_budget_check's two-gate shape exactly: a global
Settings preference checked first (recurringPostEmailEnabled, off by
default), then the specific item's own notifyOnPost flag (also off by
default) - both required, neither one overrides the other. Whole body
wrapped in try/except so a notification failure can never affect the
posting that already happened by the time this is called.
"""
import os
import boto3

from .cognito_lookup import lookup_email_by_sub
from .user_preferences import get_preference

_ses_client = boto3.client("ses")


def notify_recurring_posted(user_id, template, posted_item, balance_delta):
    try:
        if not get_preference(user_id, "recurringPostEmailEnabled", False):
            return
        if not template.get("notifyOnPost", False):
            return

        user_email = lookup_email_by_sub(user_id)
        if not user_email:
            return

        description = template.get("description") or "A recurring item"
        is_income = template.get("isIncome", False)
        amount = float(posted_item.get("amount", abs(float(balance_delta))))
        verb = "deposited" if is_income else "charged"

        _ses_client.send_email(
            Source=os.environ.get("SES_FROM_ADDRESS", "alerts@example.com"),
            Destination={"ToAddresses": [user_email]},
            Message={
                "Subject": {"Data": f'"{description}" just posted'},
                "Body": {
                    "Text": {
                        "Data": (
                            f'${amount:.2f} was just {verb} for "{description}" '
                            f"on {posted_item.get('createdAt', '')}."
                        )
                    }
                },
            },
        )
    except Exception as e:
        print(f"recurring_notify failed for user {user_id}, recurringId={template.get('recurringId')}: {e}")
