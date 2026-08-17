"""
Planned Expenses Lambda
Routes:
  GET    /planned-expenses               -> list this user's planned expenses
  POST   /planned-expenses               -> create one
  PUT    /planned-expenses/{id}          -> edit (amount, date, contributions)
  DELETE /planned-expenses/{id}          -> remove

A planned expense is a known future cost the user wants to save toward
gradually - a birthday gift, an anniversary, an annual insurance premium,
a car repair they're expecting. Distinct from:
  - Recurring: auto-posts an actual transaction on schedule
  - Budgets: caps ongoing category spend
Planned expenses instead compute a suggested per-period contribution
(targetAmount / periods remaining until targetDate) so it can feed into
projections ("you should be setting aside $X/period for this").

recurrenceType: "one_time" (a single future date) or "annual" (recurs every
year on the same month/day, e.g. a birthday - after the date passes, the
target rolls forward to next year and amountSaved resets).
"""
import os
import json
import uuid
import decimal
from datetime import date
import boto3
from finance_common.http_response import response as _response, decimal_default as _decimal_default
from finance_common.planned_expenses import suggested_contribution as _suggested_contribution
from finance_common.schedule import add_months

dynamodb = boto3.resource("dynamodb")
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])

VALID_RECURRENCE_TYPES = {"one_time", "annual"}


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
    resource = event.get("resource", "")

    if method == "GET":
        return _list(user_id)
    if method == "POST" and resource.endswith("/complete"):
        planned_expense_id = event["pathParameters"]["plannedExpenseId"]
        return _mark_complete(user_id, planned_expense_id)
    if method == "POST":
        return _create(user_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        planned_expense_id = event["pathParameters"]["plannedExpenseId"]
        return _update(user_id, planned_expense_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        planned_expense_id = event["pathParameters"]["plannedExpenseId"]
        return _delete(user_id, planned_expense_id)

    return _response(405, {"error": "Method not allowed"})


def _list(user_id):
    result = planned_expenses_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    items = result.get("Items", [])
    for item in items:
        item["suggestedContribution"] = _suggested_contribution(item)
    return _response(200, items, default=_decimal_default)


def _create(user_id, body):
    recurrence_type = body.get("recurrenceType", "one_time")
    if recurrence_type not in VALID_RECURRENCE_TYPES:
        return _response(400, {"error": f"recurrenceType must be one of {sorted(VALID_RECURRENCE_TYPES)}"})

    target_date = body["targetDate"]
    if target_date < date.today().isoformat():
        return _response(400, {"error": "targetDate can't be in the past - a planned expense saves toward a future cost."})

    planned_expense_id = str(uuid.uuid4())
    item = {
        "userId": user_id,
        "plannedExpenseId": planned_expense_id,
        "name": body.get("name", "Untitled"),
        "category": body.get("category", "Uncategorized"),
        "targetAmount": decimal.Decimal(str(body["targetAmount"])),
        "targetDate": body["targetDate"],  # "YYYY-MM-DD"
        "recurrenceType": recurrence_type,
        "amountSaved": decimal.Decimal(str(body.get("amountSaved", 0))),
        "contributionFrequency": body.get("contributionFrequency", "monthly"),  # for the suggested-contribution calc
        "linkedAccountId": body.get("linkedAccountId"),  # optional - where savings accumulate
        "divisionId": body.get("divisionId"),  # optional - a division within linkedAccountId, if savings should be tracked as going into a specific sub-allocation rather than just the account as a whole
        "notes": (body.get("notes") or "")[:250],
        "completed": False,
    }
    planned_expenses_table.put_item(Item=item)
    item["suggestedContribution"] = _suggested_contribution(item)
    return _response(201, item, default=_decimal_default)


def _update(user_id, planned_expense_id, body):
    if "targetDate" in body and body["targetDate"] < date.today().isoformat():
        existing = planned_expenses_table.get_item(
            Key={"userId": user_id, "plannedExpenseId": planned_expense_id}
        ).get("Item")
        # Only reject if this is an actual change to a new past date -
        # the frontend resends targetDate on every save regardless of
        # whether it changed, so a still-active item whose date already
        # passed (expected and fine - it just hasn't been marked done
        # yet) must stay editable for every other field.
        if not existing or body["targetDate"] != existing.get("targetDate"):
            return _response(400, {"error": "targetDate can't be in the past - a planned expense saves toward a future cost."})

    if body.get("completed") is False:
        existing_for_revive = planned_expenses_table.get_item(
            Key={"userId": user_id, "plannedExpenseId": planned_expense_id}
        ).get("Item")
        if not existing_for_revive:
            return _response(404, {"error": "planned expense not found"})
        if existing_for_revive.get("recurrenceType") == "annual":
            return _response(400, {"error": "An annual planned expense can't be revived - a fresh card was already created for next year."})

    editable_fields = {}
    for field in ("name", "category", "targetAmount", "targetDate", "amountSaved", "linkedAccountId", "divisionId", "notes"):
        if field in body:
            value = body[field]
            if field in ("targetAmount", "amountSaved"):
                value = decimal.Decimal(str(value))
            editable_fields[field] = value
    if body.get("completed") is False:
        editable_fields["completed"] = False

    if not editable_fields:
        return _response(400, {"error": "no editable fields provided"})

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in editable_fields)
    result = planned_expenses_table.update_item(
        Key={"userId": user_id, "plannedExpenseId": planned_expense_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in editable_fields},
        ExpressionAttributeValues={f":{k}": v for k, v in editable_fields.items()},
        ReturnValues="ALL_NEW",
    )
    updated = result.get("Attributes", {})
    updated["suggestedContribution"] = _suggested_contribution(updated)
    return _response(200, updated, default=_decimal_default)


def _delete(user_id, planned_expense_id):
    planned_expenses_table.delete_item(Key={"userId": user_id, "plannedExpenseId": planned_expense_id})
    return _response(204, None)


def _mark_complete(user_id, planned_expense_id):
    """Marks this one done. For an annual item, also rolls a fresh card
    forward to next year's occurrence - completing this year's birthday
    fund shouldn't lose the recurring commitment to save for next
    year's. A one-time item just gets marked complete with no
    replacement; it was a single future cost, not an ongoing one."""
    existing = planned_expenses_table.get_item(
        Key={"userId": user_id, "plannedExpenseId": planned_expense_id}
    ).get("Item")
    if not existing:
        return _response(404, {"error": "planned expense not found"})

    planned_expenses_table.update_item(
        Key={"userId": user_id, "plannedExpenseId": planned_expense_id},
        UpdateExpression="SET completed = :true",
        ExpressionAttributeValues={":true": True},
    )

    new_item = None
    if existing.get("recurrenceType") == "annual":
        next_target_date = existing["targetDate"]
        today = date.today().isoformat()
        for _ in range(20):
            next_target_date = add_months(date.fromisoformat(next_target_date), 12).isoformat()
            if next_target_date >= today:
                break
        new_item = {
            "userId": user_id,
            "plannedExpenseId": str(uuid.uuid4()),
            "name": existing.get("name", "Untitled"),
            "category": existing.get("category", "Uncategorized"),
            "targetAmount": existing["targetAmount"],
            "targetDate": next_target_date,
            "recurrenceType": "annual",
            "amountSaved": decimal.Decimal(0),
            "contributionFrequency": existing.get("contributionFrequency", "monthly"),
            "linkedAccountId": existing.get("linkedAccountId"),
            "divisionId": existing.get("divisionId"),
            "notes": existing.get("notes", ""),
            "completed": False,
        }
        planned_expenses_table.put_item(Item=new_item)
        new_item["suggestedContribution"] = _suggested_contribution(new_item)

    return _response(200, {"completedId": planned_expense_id, "newItem": new_item}, default=_decimal_default)


