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
from datetime import date
import boto3
from finance_common.schedule import next_date_after
from finance_common.cognito_lookup import lookup_email_by_sub
from finance_common.recurring_posting import post_occurrence, advance_schedule
from finance_common.payday_periods import previous_real_payday
from finance_common.payday_sweep import sweep_budgets_and_planned_expenses
from finance_common.payday_history import save_payday_history, get_payday_history
from finance_common.payday_review_notify import notify_payday_posted

dynamodb = boto3.resource("dynamodb")
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
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
                post_occurrence(template, occurrence_date, source="recurring")
                processed += 1
                if template.get("isIncome"):
                    _sweep_budgets_and_planned_expenses_for_payday(template, occurrence_date)

            next_due = next_date_after(template, occurrence_dates[-1])
            advance_schedule(template, next_due, occurrence_dates)
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


def _sweep_budgets_and_planned_expenses_for_payday(income_template, payday_date):
    """An income occurrence posting IS a real payday for this user - budgets
    and planned expenses have no due-date field of their own (unlike
    recurring items, see payday_sweep's module docstring), so this is the
    only signal that triggers their auto-sweep. Every real payday gets its
    own slice, sourced from THAT income's own account - a household with
    two income sources due on different days sees two independent,
    smaller sweeps rather than one lump sum, which is more accurate to
    when the money actually lands.

    Guarded by payday_history_table already having a record for this
    (user, date) - either a manual early-submit already covered it, or
    another income source due the same calendar date already triggered
    the sweep first. Either way, one sweep per real distinct payday date
    per user, not one per income source that happens to share it (their
    windows would be identical, so a second sweep would double-post)."""
    user_id = income_template["userId"]
    if get_payday_history(user_id, payday_date):
        return

    income_items = [
        i for i in recurring_table.query(
            IndexName="byUserAndNextDue",
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        ).get("Items", [])
        if i.get("activeFlag") == "true" and i.get("isIncome")
    ]
    previous_payday = previous_real_payday(income_items, payday_date)

    transfers, errors = sweep_budgets_and_planned_expenses(
        user_id, income_template["accountId"], previous_payday, payday_date,
    )
    if transfers or errors:
        save_payday_history(user_id, payday_date, [], transfers, errors, reviewed=False)
        notify_payday_posted(user_id, payday_date, transfers)


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


# Posting a single occurrence and advancing the schedule afterward now
# live in finance_common.recurring_posting, shared with recurring-fn's
# manual "mark as paid"/"skip" actions - see that module's docstring for
# why this used to be a separate, independently-drifted copy here.
