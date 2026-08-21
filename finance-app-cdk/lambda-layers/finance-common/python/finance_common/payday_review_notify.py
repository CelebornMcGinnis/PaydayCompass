"""
Best-effort email when Payday Review's daily auto-sweep moves money -
mirrors low_balance_alerts.py's shape exactly: off by default, gated on
a user preference, whole body wrapped so a notification failure can
never affect the real money movement that already happened by the time
this is called.
"""
import os
import boto3

from .cognito_lookup import lookup_email_by_sub
from .user_preferences import get_preference

_ses_client = boto3.client("ses")


def notify_payday_posted(user_id, payday_date, transfers):
    try:
        if not transfers:
            return
        if not get_preference(user_id, "paydayReviewEmailEnabled", False):
            return

        user_email = lookup_email_by_sub(user_id)
        if not user_email:
            return

        lines = [f"  - {t.get('category') or t.get('name', 'Untitled')}: ${float(t['amount']):.2f}" for t in transfers]
        total = sum(float(t["amount"]) for t in transfers)

        _ses_client.send_email(
            Source=os.environ.get("SES_FROM_ADDRESS", "alerts@example.com"),
            Destination={"ToAddresses": [user_email]},
            Message={
                "Subject": {"Data": f"Payday Review: ${total:.2f} set aside for {payday_date}"},
                "Body": {
                    "Text": {
                        "Data": (
                            f"Your budgets and planned expenses for {payday_date} were set aside automatically:\n\n"
                            + "\n".join(lines)
                            + f"\n\nTotal: ${total:.2f}\n\n"
                            "Review or correct any of this in Payday Review."
                        )
                    }
                },
            },
        )
    except Exception as e:
        print(f"payday_review_notify failed for user {user_id}, paydayDate={payday_date}: {e}")
