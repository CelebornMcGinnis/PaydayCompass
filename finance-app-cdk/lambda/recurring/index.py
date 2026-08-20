"""
Recurring Transactions Lambda (API-facing)
Routes:
  GET    /recurring                          -> list this user's recurring templates,
                                                 each showing its next due date and estimate
  POST   /recurring                          -> create a new recurring template
  PUT    /recurring/{recurringId}             -> edit a template (amount, category, schedule, active)
  DELETE /recurring/{recurringId}             -> remove a template
  PUT    /recurring/{recurringId}/occurrence  -> set a ONE-TIME override amount for the
                                                 next upcoming occurrence only - does not
                                                 change the template's baseline estimate
  POST   /recurring/{recurringId}/mark-paid   -> post the template's current nextDueDate
                                                 occurrence right now (same effect as the
                                                 daily processor or a Payday submit
                                                 catching it), then advance the schedule
                                                 one occurrence forward
  POST   /recurring/{recurringId}/skip        -> advance the schedule past the current
                                                 nextDueDate WITHOUT posting anything -
                                                 for a bill that didn't happen this cycle

Frequency options: "weekly", "biweekly", "semimonthly" (two fixed calendar
days, e.g. 1st & 15th), "monthly", "annual". Schedule fields used per type:
  weekly/biweekly -> anchorDate (any date on the cadence; interval computed from it)
  semimonthly     -> anchorDays: [1, 15]
  monthly         -> anchorDay: 1-28 (avoid 29-31 to sidestep short months)
  annual          -> anchorMonth (1-12), anchorDay

externalBankAccountId (expense templates only): an optional reference to a
row in the ExternalBankAccounts table - a real-world bank account the user
maintains a label for outside the app. Sticky by design: once set on a
template, it's carried forward on every edit unless explicitly changed -
there's no special logic for this, it's just a normal field that isn't
touched unless the edit request includes it. Used to group "money to move
out" by real bank account in the payday wizard.

grossAmount (income templates only, isIncome=true): the pre-deduction pay
amount, stored purely for reference/record-keeping. estimatedAmount remains
the NET amount - the actual deposit - since that's what affects the account
balance and feeds projections. A one-time occurrence override (via the
/occurrence endpoint) only ever overrides the net amount, never gross - a
single paycheck's gross figure isn't expected to vary occurrence to
occurrence the way net take-home might (e.g. a bonus withheld differently).

Authorization: every route resolves account access via
finance_common.sharing_access.resolve_account_access, but the actual
permission gating recurring-specific reads/writes is
dataPermissions.recurring on the Sharing row - NOT the base
accountPermission. This is deliberate: recurring sharing is independently
optional from the account share itself (see sharing/index.py) - a user
could have view-only access to an account's transactions while having
full edit access to its recurring templates, or the reverse, or no
recurring access at all despite having full account access. An owner
always has full access to everything regardless. A created/edited/deleted
template's `userId` field is always the account OWNER's id (recurring
items belong to the account, not whoever's editing it), and when the
actor differs from the owner, the item is stamped `addedByUserId` /
`lastEditedByUserId` and the owner gets a shared-activity email, same as
transactions.
"""
import os
import json
import uuid
import decimal
from datetime import date
import boto3
from finance_common.sharing_access import resolve_account_access
from finance_common.schedule import next_date_after
from finance_common.shared_activity_alerts import notify_owner_of_shared_activity
from finance_common.recurring_posting import post_occurrence, advance_schedule
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
divisions_table = dynamodb.Table(os.environ["DIVISIONS_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])

MAX_RETROACTIVE_DAYS = 365

VALID_FREQUENCIES = {"weekly", "biweekly", "semimonthly", "monthly", "annual", "custom", "monthly_weekday"}
VALID_INTERVAL_UNITS = {"days", "weeks", "months"}
VALID_WEEKS_OF_MONTH = {1, 2, 3, 4, -1}
VALID_DAYS_OF_WEEK = {0, 1, 2, 3, 4, 5, 6}


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
    account_id = event["pathParameters"]["accountId"] if event.get("pathParameters") else None

    access = resolve_account_access(user_id, account_id)
    if not access:
        return _response(404, {"error": "account not found"})

    # Recurring sharing is INDEPENDENT of the base account-level
    # permission by design - sharing an account view-only doesn't imply
    # anything about recurring access, and vice versa. An owner always has
    # full access; a shared (non-owner) user's access is whatever
    # dataPermissions.recurring says, defaulting to "not_shared" if that
    # specific extension was never granted.
    if access["isOwner"]:
        recurring_permission = "edit"
    else:
        recurring_permission = (access.get("dataPermissions") or {}).get("recurring", "not_shared")
        if recurring_permission == "not_shared":
            return _response(404, {"error": "account not found"})

    write_methods = {"POST", "PUT", "DELETE"}
    if method in write_methods and recurring_permission != "edit":
        return _response(403, {"error": "you have view-only access to recurring items on this account"})

    if resource.endswith("/occurrence") and method == "PUT":
        recurring_id = event["pathParameters"]["recurringId"]
        return _set_occurrence_override(user_id, access, account_id, recurring_id, json.loads(event.get("body") or "{}"))
    if resource.endswith("/mark-paid") and method == "POST":
        recurring_id = event["pathParameters"]["recurringId"]
        return _mark_occurrence_paid(user_id, access, account_id, recurring_id)
    if resource.endswith("/skip") and method == "POST":
        recurring_id = event["pathParameters"]["recurringId"]
        return _skip_occurrence(user_id, access, account_id, recurring_id)

    if method == "GET":
        return _list_recurring(account_id)
    if method == "POST":
        return _create_recurring(user_id, access, account_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        recurring_id = event["pathParameters"]["recurringId"]
        return _update_recurring(user_id, access, account_id, recurring_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        recurring_id = event["pathParameters"]["recurringId"]
        return _delete_recurring(user_id, access, account_id, recurring_id)

    return _response(405, {"error": "Method not allowed"})


def _list_recurring(account_id):
    result = recurring_table.query(
        KeyConditionExpression="accountId = :aid",
        ExpressionAttributeValues={":aid": account_id},
    )
    return _response(200, result.get("Items", []), default=_decimal_default)


def _create_recurring(user_id, access, account_id, body):
    frequency = body.get("frequency")
    if frequency not in VALID_FREQUENCIES:
        return _response(400, {"error": f"frequency must be one of {sorted(VALID_FREQUENCIES)}"})

    if frequency == "custom":
        interval_count = body.get("intervalCount")
        interval_unit = body.get("intervalUnit")
        if not isinstance(interval_count, int) or interval_count < 1:
            return _response(400, {"error": "intervalCount must be a positive whole number for a custom frequency"})
        if interval_unit not in VALID_INTERVAL_UNITS:
            return _response(400, {"error": f"intervalUnit must be one of {sorted(VALID_INTERVAL_UNITS)}"})

    if frequency == "monthly_weekday":
        week_of_month = body.get("weekOfMonth")
        day_of_week = body.get("dayOfWeek")
        if week_of_month not in VALID_WEEKS_OF_MONTH:
            return _response(400, {"error": f"weekOfMonth must be one of {sorted(VALID_WEEKS_OF_MONTH)} (-1 means the last occurrence in the month)"})
        if day_of_week not in VALID_DAYS_OF_WEEK:
            return _response(400, {"error": "dayOfWeek must be 0-6 (0=Monday .. 6=Sunday)"})

    owner_id = access["ownerUserId"]
    recurring_id = str(uuid.uuid4())
    today = date.today().isoformat()
    # next_due_date is trusted as given UNLESS it's in the past and the
    # caller hasn't explicitly said this occurrence is still unpaid and
    # overdue (keepAsOverdue) - a newly-created item almost always means
    # "here's my ongoing schedule" (e.g. "due on the 3rd"), not "this
    # specific already-passed occurrence still needs to be paid". Without
    # this, every new item entered with a date earlier in the current
    # month would show up as money still owed on day one, which isn't
    # what most people mean when setting up a recurring bill.
    # backfill_from_date is separate and optional: a past date for
    # trend-only history, independent of what the real next occurrence is.
    next_due_date = body.get("nextDueDate") or today
    if next_due_date < today and not body.get("keepAsOverdue"):
        for _ in range(120):
            next_due_date = next_date_after({"frequency": frequency, "anchorDate": body.get("anchorDate"), "anchorDays": body.get("anchorDays"), "anchorDay": body.get("anchorDay"), "anchorMonth": body.get("anchorMonth"), "intervalCount": body.get("intervalCount"), "intervalUnit": body.get("intervalUnit"), "weekOfMonth": body.get("weekOfMonth"), "dayOfWeek": body.get("dayOfWeek")}, next_due_date)
            if next_due_date >= today:
                break
    backfill_from_date = body.get("backfillFromDate")

    if backfill_from_date and backfill_from_date < today:
        days_back = (date.today() - date.fromisoformat(backfill_from_date)).days
        if days_back > MAX_RETROACTIVE_DAYS:
            return _response(400, {"error": f"backfillFromDate can't be more than {MAX_RETROACTIVE_DAYS} days in the past"})
        if not body.get("backfillForTrends"):
            return _response(400, {"error": "a past backfillFromDate requires backfillForTrends: true - see the confirmation dialog"})

    division_id = body.get("divisionId")
    if division_id and not divisions_table.get_item(Key={"accountId": account_id, "divisionId": division_id}).get("Item"):
        return _response(400, {"error": "divisionId does not belong to this account"})

    item = {
        "accountId": account_id,
        "recurringId": recurring_id,
        "userId": owner_id,  # the account owner - budgets/projections aggregate against them, not the actor
        "activeFlag": "true",
        "description": (body.get("description") or "")[:250],
        "notes": (body.get("notes") or "")[:1000],
        "category": body.get("category", "Uncategorized"),
        "estimatedAmount": decimal.Decimal(str(body["estimatedAmount"])),  # NET amount for income templates
        "frequency": frequency,
        "anchorDate": body.get("anchorDate"),
        "anchorDays": body.get("anchorDays"),
        "anchorDay": body.get("anchorDay"),
        "anchorMonth": body.get("anchorMonth"),
        "intervalCount": body.get("intervalCount"),  # for frequency == "custom" - e.g. 3 for "every 3 weeks"
        "intervalUnit": body.get("intervalUnit"),  # "days" | "weeks" | "months", for frequency == "custom"
        "weekOfMonth": body.get("weekOfMonth"),  # 1-4, or -1 for "last" - for frequency == "monthly_weekday"
        "dayOfWeek": body.get("dayOfWeek"),  # 0=Monday..6=Sunday - for frequency == "monthly_weekday"
        "nextDueDate": next_due_date,
        "lastProcessedDate": None,
        "isIncome": body.get("isIncome", False),
        "isOneTimeCredit": body.get("isOneTimeCredit", False),  # bonus/gift flag
        "externalBankAccountId": body.get("externalBankAccountId"),  # expense templates: sticky, user-maintained label
        "divisionId": body.get("divisionId"),  # optional - which division within the account this item posts against, in addition to the account's own balance
        # occurrenceOverrides: {"2026-08-15": "45.30"} - date -> override NET amount only,
        # cleared by the processor once that occurrence has been posted
        "occurrenceOverrides": {},
        # occurrenceDateOverrides: {"2026-08-15": "2026-08-18"} - originally-scheduled
        # date -> actual date this ONE occurrence should post on. Doesn't shift the
        # schedule itself - the occurrence after it is still computed from the
        # original date, not the overridden one, same principle as amount overrides
        # not touching the template's baseline estimatedAmount.
        "occurrenceDateOverrides": {},
    }
    if item["isIncome"] and body.get("grossAmount") is not None:
        item["grossAmount"] = decimal.Decimal(str(body["grossAmount"]))
    if user_id != owner_id:
        item["addedByUserId"] = user_id

    backfilled_count = 0
    if backfill_from_date and backfill_from_date < today:
        # Generate every occurrence from the backfill start date up to
        # (not including) today, and write each as a real transaction for
        # trend visibility - explicitly NOT touching the account balance,
        # since this describes history already reflected in the current
        # real balance, not new money moving. This walk is independent of
        # nextDueDate above (already set to what the user actually said),
        # so a schedule irregularity in the backfilled history (a holiday
        # shifting a real payday, say) never overrides the real answer.
        occurrence = backfill_from_date
        with transactions_table.batch_writer() as batch:
            while occurrence < today:
                txn_id = str(uuid.uuid4())
                batch.put_item(Item={
                    "accountId": account_id,
                    "sk": f"{occurrence}T00:00:00#{txn_id}",
                    "txnId": txn_id,
                    "userId": owner_id,
                    "amount": item["estimatedAmount"],
                    "category": item["category"],
                    "description": item["description"] or ("Income" if item["isIncome"] else "Recurring expense"),
                    "direction": "credit" if item["isIncome"] else "debit",
                    "createdAt": f"{occurrence}T00:00:00+00:00",
                    "isRetroactiveEntry": True,  # trend-only - excluded from Account Detail's balance-trend reconstruction
                    "recurringId": recurring_id,
                })
                backfilled_count += 1
                occurrence = next_date_after(item, occurrence)

    recurring_table.put_item(Item=item)

    notify_owner_of_shared_activity(
        owner_id, user_id, f"added a recurring {'income source' if item['isIncome'] else 'expense'} ({item['description'] or item['category']})"
    )

    response_body = dict(item)
    response_body["backfilledCount"] = backfilled_count
    return _response(201, response_body, default=_decimal_default)


def _update_recurring(user_id, access, account_id, recurring_id, body):
    """Only touches fields explicitly present in the request body -
    omitting externalBankAccountId or grossAmount leaves them exactly as
    they were (the "sticky" behavior), rather than resetting them.
    Frequency/anchor field edits do NOT automatically recompute
    nextDueDate - if the caller is changing the schedule, they should
    include an explicit nextDueDate too, rather than this function
    silently guessing what the next occurrence should be."""
    editable_fields = {}
    for field in (
        "description",
        "notes",
        "category",
        "frequency",
        "anchorDate",
        "anchorDays",
        "anchorDay",
        "anchorMonth",
        "intervalCount",
        "intervalUnit",
        "weekOfMonth",
        "dayOfWeek",
        "nextDueDate",
        "externalBankAccountId",
        "divisionId",
    ):
        if field in body:
            editable_fields[field] = body[field]

    if "estimatedAmount" in body:
        editable_fields["estimatedAmount"] = decimal.Decimal(str(body["estimatedAmount"]))
    if "grossAmount" in body:
        editable_fields["grossAmount"] = (
            decimal.Decimal(str(body["grossAmount"])) if body["grossAmount"] is not None else None
        )

    if not editable_fields:
        return _response(400, {"error": "no editable fields provided"})

    if "frequency" in editable_fields and editable_fields["frequency"] not in VALID_FREQUENCIES:
        return _response(400, {"error": f"frequency must be one of {sorted(VALID_FREQUENCIES)}"})

    if editable_fields.get("frequency") == "custom":
        interval_count = editable_fields.get("intervalCount")
        interval_unit = editable_fields.get("intervalUnit")
        if not isinstance(interval_count, int) or interval_count < 1:
            return _response(400, {"error": "intervalCount must be a positive whole number for a custom frequency"})
        if interval_unit not in VALID_INTERVAL_UNITS:
            return _response(400, {"error": f"intervalUnit must be one of {sorted(VALID_INTERVAL_UNITS)}"})

    if editable_fields.get("frequency") == "monthly_weekday":
        if editable_fields.get("weekOfMonth") not in VALID_WEEKS_OF_MONTH:
            return _response(400, {"error": f"weekOfMonth must be one of {sorted(VALID_WEEKS_OF_MONTH)} (-1 means the last occurrence in the month)"})
        if editable_fields.get("dayOfWeek") not in VALID_DAYS_OF_WEEK:
            return _response(400, {"error": "dayOfWeek must be 0-6 (0=Monday .. 6=Sunday)"})

    if editable_fields.get("divisionId") and not divisions_table.get_item(
        Key={"accountId": account_id, "divisionId": editable_fields["divisionId"]}
    ).get("Item"):
        return _response(400, {"error": "divisionId does not belong to this account"})

    owner_id = access["ownerUserId"]
    if user_id != owner_id:
        editable_fields["lastEditedByUserId"] = user_id

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in editable_fields)
    result = recurring_table.update_item(
        Key={"accountId": account_id, "recurringId": recurring_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in editable_fields},
        ExpressionAttributeValues={f":{k}": v for k, v in editable_fields.items()},
        ReturnValues="ALL_NEW",
    )

    notify_owner_of_shared_activity(owner_id, user_id, "edited a recurring item")

    return _response(200, result.get("Attributes", {}), default=_decimal_default)


def _delete_recurring(user_id, access, account_id, recurring_id):
    recurring_table.delete_item(Key={"accountId": account_id, "recurringId": recurring_id})
    notify_owner_of_shared_activity(access["ownerUserId"], user_id, "deleted a recurring item")
    return _response(204, None)


def _set_occurrence_override(user_id, access, account_id, recurring_id, body):
    """One-time amount and/or date change for a SPECIFIC occurrence -
    doesn't touch the template's baseline estimatedAmount or shift the
    overall schedule. occurrenceDate identifies which occurrence (by its
    ORIGINAL scheduled date, not the overridden one) - defaults to the
    template's current nextDueDate for backward compatibility with
    callers that only ever adjusted the immediate next occurrence."""
    item = recurring_table.get_item(Key={"accountId": account_id, "recurringId": recurring_id}).get("Item")
    if not item:
        return _response(404, {"error": "recurring template not found"})

    occurrence_date = body.get("occurrenceDate", item["nextDueDate"])
    override_amount = body.get("amount")
    override_date = body.get("newDate")
    if override_amount is None and not override_date:
        return _response(400, {"error": "amount and/or newDate is required"})

    update_parts = []
    values = {}
    names = {"#d": occurrence_date}
    if override_amount is not None:
        update_parts.append("occurrenceOverrides.#d = :amt")
        values[":amt"] = decimal.Decimal(str(override_amount))
    if override_date:
        update_parts.append("occurrenceDateOverrides.#d = :nd")
        values[":nd"] = override_date

    recurring_table.update_item(
        Key={"accountId": account_id, "recurringId": recurring_id},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )

    summary = []
    if override_amount is not None:
        summary.append(f"amount to ${override_amount}")
    if override_date:
        summary.append(f"date to {override_date}")
    notify_owner_of_shared_activity(access["ownerUserId"], user_id, f"adjusted an upcoming payment's {' and '.join(summary)}")

    return _response(200, {"occurrenceDate": occurrence_date, "overrideAmount": override_amount, "overrideDate": override_date})


def _mark_occurrence_paid(user_id, access, account_id, recurring_id):
    """Posts the template's current nextDueDate occurrence right now, the
    same way the daily processor or a Payday submit catching it would -
    honors any amount/date override already set for that date via PUT
    .../occurrence - then advances the schedule exactly one occurrence
    forward. For a bill you paid outside the app's normal flow and want
    reflected immediately rather than waiting for tonight's processor run."""
    template = recurring_table.get_item(Key={"accountId": account_id, "recurringId": recurring_id}).get("Item")
    if not template:
        return _response(404, {"error": "recurring template not found"})

    occurrence_date = template["nextDueDate"]
    item, balance_delta = post_occurrence(template, occurrence_date, source="recurring-manual")
    next_due = next_date_after(template, occurrence_date)
    advance_schedule(template, next_due, [occurrence_date])

    notify_owner_of_shared_activity(
        access["ownerUserId"], user_id, f"marked a recurring payment as paid ({template.get('description') or template.get('category')})"
    )

    return _response(
        200,
        {
            "recurringId": recurring_id,
            "occurrenceDate": occurrence_date,
            "amount": float(item["amount"]),
            "balanceDelta": float(balance_delta),
            "nextDueDate": next_due,
        },
        default=_decimal_default,
    )


def _skip_occurrence(user_id, access, account_id, recurring_id):
    """Advances a template's schedule past its current nextDueDate
    WITHOUT posting anything - for a bill that simply didn't happen this
    cycle (a subscription canceled mid-period, a paycheck that didn't
    come, etc). Clears any pending override for the skipped date, the
    same as if it had actually posted, since there's nothing left to
    apply it to."""
    template = recurring_table.get_item(Key={"accountId": account_id, "recurringId": recurring_id}).get("Item")
    if not template:
        return _response(404, {"error": "recurring template not found"})

    occurrence_date = template["nextDueDate"]
    next_due = next_date_after(template, occurrence_date)
    advance_schedule(template, next_due, [occurrence_date])

    notify_owner_of_shared_activity(
        access["ownerUserId"], user_id, f"skipped a recurring payment's upcoming occurrence ({template.get('description') or template.get('category')})"
    )

    return _response(200, {"recurringId": recurring_id, "skippedDate": occurrence_date, "nextDueDate": next_due})


