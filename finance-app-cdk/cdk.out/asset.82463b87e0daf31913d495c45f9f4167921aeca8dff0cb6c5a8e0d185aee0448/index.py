"""
Recurring Transaction Processor Lambda
Not exposed via API - invoked on a daily EventBridge schedule (see
lib/constructs/lambdas.ts for the rule).

For every active recurring template whose nextDueDate has arrived (today or
earlier), this:
  1. Computes EVERY occurrence date from nextDueDate through today
     (backfills all missed ones if the app/schedule was untouched for a while)
  2. For each occurrence, uses a one-time override amount if one was set for
     that specific date (via PUT /recurring/{id}/occurrence), otherwise the
     template's estimatedAmount - the override never changes the baseline.
  3. Writes one transaction per occurrence and adjusts the account balance
     (credit for income, debit for expenses).
  4. Advances nextDueDate to the first occurrence AFTER today, clears any
     used overrides, and stamps lastProcessedDate.
  5. Triggers a budget-threshold check for each posted expense.

Failure isolation: each template is processed in its own try/except. If
one template throws (a malformed anchor date, a transient DynamoDB error,
whatever), that failure does NOT abort the whole run - every other user's
due templates still get processed. The affected user is emailed directly
("we couldn't process X today") so they find out same-day rather than
just seeing a bill silently not post. After the loop, if anything failed,
the function still raises - the CloudWatch alarm and DLQ (see
lib/constructs/observability.ts) need to fire so a human also finds out,
separately from the per-user email.
"""
import os
import json
import uuid
import decimal
from datetime import date
import boto3
from finance_common.schedule import next_date_after
from finance_common.budget_notify import trigger_budget_check
from finance_common.cognito_lookup import lookup_email_by_sub
from finance_common.low_balance_alerts import check_low_balance_alert
from finance_common.divisions import adjust_division_balance

dynamodb = boto3.resource("dynamodb")
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
ses_client = boto3.client("ses")
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS", "alerts@example.com")


def handler(event, context):
    today = date.today().isoformat()
    due_templates = _get_due_templates(today)

    processed = 0
    failures = []
    for template in due_templates:
        try:
            occurrence_dates = _compute_occurrences(template, today)
            if not occurrence_dates:
                continue

            for occurrence_date in occurrence_dates:
                _post_occurrence(template, occurrence_date)
                processed += 1

            next_due = next_date_after(template, occurrence_dates[-1])
            _advance_template(template, next_due, occurrence_dates)
        except Exception as e:
            failures.append({"recurringId": template.get("recurringId"), "error": str(e)})
            _notify_user_of_processing_failure(template)

    if failures:
        # Re-raised after every template got its own attempt - this marks
        # the Lambda invocation as failed so the CloudWatch alarm/DLQ pick
        # it up, without that failure having blocked anyone else's
        # templates from processing above.
        raise Exception(f"{len(failures)} recurring template(s) failed to process: {json.dumps(failures)}")

    return {"templatesProcessed": len(due_templates), "occurrencesPosted": processed}


def _notify_user_of_processing_failure(template):
    """Best-effort - a failure to send this notification should never mask
    or replace the original processing error, which is why this is called
    from inside the except block but never itself re-raises."""
    try:
        user_email = lookup_email_by_sub(template["userId"])
        if not user_email:
            return
        description = template.get("description") or "a recurring payment"
        ses_client.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [user_email]},
            Message={
                "Subject": {"Data": f"We couldn't process your recurring payment: {description}"},
                "Body": {
                    "Text": {
                        "Data": (
                            f'We ran into a problem processing "{description}" today, and it did not post. '
                            "Your account balance was not changed for this occurrence. Please check it "
                            "manually if needed - we'll automatically retry tomorrow."
                        )
                    }
                },
            },
        )
    except Exception:
        pass


def _get_due_templates(today):
    result = recurring_table.query(
        IndexName="byActiveStatus",
        KeyConditionExpression="activeFlag = :active AND nextDueDate <= :today",
        ExpressionAttributeValues={":active": "true", ":today": today},
    )
    return result.get("Items", [])


def _compute_occurrences(template, today):
    """All due dates from the template's nextDueDate through today, inclusive."""
    occurrences = []
    current = template["nextDueDate"]
    while current <= today:
        occurrences.append(current)
        current = next_date_after(template, current)
    return occurrences


def _post_occurrence(template, occurrence_date):
    account_id = template["accountId"]
    is_income = template.get("isIncome", False)

    overrides = template.get("occurrenceOverrides") or {}
    override = overrides.get(occurrence_date)
    amount = decimal.Decimal(str(override)) if override is not None else decimal.Decimal(str(template["estimatedAmount"]))

    txn_id = str(uuid.uuid4())
    item = {
        "accountId": account_id,
        "sk": f"{occurrence_date}#{txn_id}",
        "userId": template["userId"],
        "amount": amount,  # NET - what actually posts to the balance
        "category": template.get("category", "Uncategorized"),
        "description": template.get("description", ""),
        "direction": "credit" if is_income else "debit",
        "createdAt": occurrence_date,
        "source": "recurring",
        "recurringId": template["recurringId"],
        "wasOverridden": override is not None,
    }
    if is_income and template.get("grossAmount") is not None:
        item["grossAmount"] = decimal.Decimal(str(template["grossAmount"]))  # reference only, not used for balance
    if not is_income and template.get("externalBankAccountId"):
        item["externalBankAccountId"] = template["externalBankAccountId"]

    transactions_table.put_item(Item=item)

    balance_delta = amount if is_income else -amount
    balance_result = accounts_table.update_item(
        Key={"userId": template["userId"], "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": balance_delta},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(template["userId"], account_id, balance_result["Attributes"]["balance"])

    if template.get("divisionId"):
        adjust_division_balance(account_id, template["divisionId"], balance_delta)

    if not is_income:
        trigger_budget_check(template["userId"], account_id, template.get("category", "Uncategorized"), amount)


def _advance_template(template, next_due, posted_dates):
    remaining_overrides = {
        k: v for k, v in (template.get("occurrenceOverrides") or {}).items()
        if k not in posted_dates
    }
    recurring_table.update_item(
        Key={"accountId": template["accountId"], "recurringId": template["recurringId"]},
        UpdateExpression="SET nextDueDate = :next, lastProcessedDate = :today, occurrenceOverrides = :overrides",
        ExpressionAttributeValues={
            ":next": next_due,
            ":today": date.today().isoformat(),
            ":overrides": remaining_overrides,
        },
    )
