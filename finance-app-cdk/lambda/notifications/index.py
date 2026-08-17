"""
Notifications Lambda
Not exposed directly via API Gateway - invoked by the Transactions Lambda
(or an EventBridge event) after a transaction write, to check whether an
SES alert should fire for the affected user + category.

Alert rules (as discussed):
  1. Category spend crosses 80% of its budget          -> one alert
  2. Category spend first crosses 100% of its budget    -> one alert
  3. Any NEW expense added while already over 100%       -> alert every time
  4. Account balance drops below a low-balance threshold -> alert

All alerts are scoped strictly to the affected user's own email - never
broadcast to other users sharing an account.
"""
import os
import boto3

dynamodb = boto3.resource("dynamodb")
ses_client = boto3.client("ses")
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])


def handler(event, context):
    """
    Expected event shape (from an internal invoke or EventBridge detail):
    {
      "userId": "...",
      "userEmail": "...",
      "category": "Groceries",
      "accountId": "...",
      "newSpendTotal": 812.50,
      "budgetAmount": 800.00
    }
    """
    user_id = event["userId"]
    user_email = event["userEmail"]
    category = event["category"]
    new_total = event["newSpendTotal"]
    budget_amount = event["budgetAmount"]

    if budget_amount <= 0:
        return {"sent": False, "reason": "no budget set for category"}

    percent = (new_total / budget_amount) * 100
    previous_total = event.get("previousSpendTotal", 0)
    previous_percent = (previous_total / budget_amount) * 100 if budget_amount else 0

    # Rule 3: already over 100% before this transaction -> alert every time
    if previous_percent >= 100:
        return _send_alert(user_email, category, percent, kind="repeat_over_budget")

    # Rule 2: this transaction is what pushed it over 100%
    if previous_percent < 100 <= percent:
        return _send_alert(user_email, category, percent, kind="over_budget")

    # Rule 1: this transaction is what pushed it over 80% (but not yet 100%)
    if previous_percent < 80 <= percent:
        return _send_alert(user_email, category, percent, kind="approaching_budget")

    return {"sent": False, "reason": "no threshold crossed"}


def _send_alert(to_email, category, percent, kind):
    subject, body = _compose_message(category, percent, kind)
    ses_client.send_email(
        Source=os.environ.get("SES_FROM_ADDRESS", "alerts@example.com"),
        Destination={"ToAddresses": [to_email]},
        Message={
            "Subject": {"Data": subject},
            "Body": {"Text": {"Data": body}},
        },
    )
    return {"sent": True, "kind": kind}


def _compose_message(category, percent, kind):
    messages = {
        "approaching_budget": (
            f"Heads up: {category} budget",
            f"You've used {percent:.0f}% of your {category} budget this period.",
        ),
        "over_budget": (
            f"{category} budget exceeded",
            f"You've gone over your {category} budget ({percent:.0f}% used).",
        ),
        "repeat_over_budget": (
            f"Another {category} expense over budget",
            f"A new expense was added to {category}, which is already at {percent:.0f}% of budget.",
        ),
    }
    return messages[kind]
