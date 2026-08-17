"""
Scenarios Lambda ("what-if" planning)
Routes:
  GET    /scenarios                     -> list this user's saved scenarios
  POST   /scenarios                     -> save a named scenario (stores the
                                            adjustments only, not a calculated result)
  DELETE /scenarios/{scenarioId}        -> remove a saved scenario
  POST   /scenarios/calculate           -> throwaway calculation: body IS the
                                            adjustment set, nothing is saved
  GET    /scenarios/{scenarioId}/calculate -> recalculate a SAVED scenario
                                            fresh against today's real data
  POST   /scenarios/compare             -> calculate up to 6 scenarios side by
                                            side in one call - each entry is
                                            EITHER {"scenarioId": "..."} for a
                                            saved scenario, or an inline
                                            adjustment set (same shape as
                                            /calculate) for an unsaved one

A scenario is never a frozen snapshot. Both calculate routes layer the same
adjustments on top of whatever the user's actual current income, budgets,
and planned expenses are AT CALCULATION TIME - so a scenario saved months
ago still reflects today's real numbers when recalculated, not the numbers
that were true when it was created.

Adjustment shape (used identically for throwaway calc, saved scenario body,
and stored scenario items):
{
  "name": "If I got a raise",                       # required only when saving
  "incomeAdjustments": [
    {"label": "Raise", "monthlyDelta": 200}          # flat monthly delta, +/-
  ],
  "expenseAdjustments": [
    {"recurringId": "r1", "monthlyDelta": 50}        # adjusts an EXISTING recurring
  ],                                                  # expense's effective monthly amount
  "newExpenses": [
    {"description": "Gym membership", "category": "Health", "monthlyAmount": 45}
  ]                                                   # brand-new hypothetical expenses,
}                                                      # not tied to any real recurring item

/scenarios/compare body:
{
  "scenarios": [
    {"scenarioId": "abc123"},                         # a saved one, recalculated fresh
    {"name": "Draft", "incomeAdjustments": [...], ...} # an unsaved inline set
  ]
}
Capped at 6 entries - the baseline (today's real numbers) is computed once
and shared across every entry in the response, since it doesn't depend on
any scenario's adjustments.
"""
import os
import json
import uuid
import decimal
from datetime import date, datetime, timezone
import boto3
from finance_common.budget_notify import get_active_budgets
from finance_common.budget_frequency import to_monthly_equivalent
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
scenarios_table = dynamodb.Table(os.environ["SCENARIOS_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])

FREQUENCY_TO_MONTHLY_MULTIPLIER = {
    "weekly": decimal.Decimal(52) / decimal.Decimal(12),
    "biweekly": decimal.Decimal(26) / decimal.Decimal(12),
    "semimonthly": decimal.Decimal(2),
    "monthly": decimal.Decimal(1),
    "annual": decimal.Decimal(1) / decimal.Decimal(12),
}


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource.endswith("/compare") and method == "POST":
        return _compare(user_id, json.loads(event.get("body") or "{}"))
    if resource.endswith("/calculate") and method == "POST":
        return _calculate_throwaway(user_id, json.loads(event.get("body") or "{}"))
    if resource.endswith("/calculate") and method == "GET":
        scenario_id = event["pathParameters"]["scenarioId"]
        return _calculate_saved(user_id, scenario_id)

    if method == "GET":
        return _list_scenarios(user_id)
    if method == "POST":
        return _save_scenario(user_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        scenario_id = event["pathParameters"]["scenarioId"]
        return _delete_scenario(user_id, scenario_id)

    return _response(405, {"error": "Method not allowed"})


def _list_scenarios(user_id):
    result = scenarios_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    )
    return _response(200, result.get("Items", []), default=_decimal_default)


def _save_scenario(user_id, body):
    name = (body.get("name") or "").strip()
    if not name:
        return _response(400, {"error": "name is required to save a scenario"})

    item = {
        "userId": user_id,
        "scenarioId": str(uuid.uuid4()),
        "name": name,
        "incomeAdjustments": body.get("incomeAdjustments", []),
        "expenseAdjustments": body.get("expenseAdjustments", []),
        "newExpenses": body.get("newExpenses", []),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    scenarios_table.put_item(Item=item)
    return _response(201, item, default=_decimal_default)


def _delete_scenario(user_id, scenario_id):
    scenarios_table.delete_item(Key={"userId": user_id, "scenarioId": scenario_id})
    return _response(204, None)


def _calculate_throwaway(user_id, adjustments):
    baseline = _get_baseline(user_id)
    result = _apply_adjustments(user_id, baseline, adjustments)
    return _response(200, result, default=_decimal_default)


def _calculate_saved(user_id, scenario_id):
    scenario = scenarios_table.get_item(Key={"userId": user_id, "scenarioId": scenario_id}).get("Item")
    if not scenario:
        return _response(404, {"error": "scenario not found"})
    baseline = _get_baseline(user_id)
    result = _apply_adjustments(user_id, baseline, scenario)
    result["scenarioName"] = scenario["name"]
    return _response(200, result, default=_decimal_default)


MAX_COMPARE = 6


def _compare(user_id, body):
    entries = body.get("scenarios", [])
    if not entries:
        return _response(400, {"error": "scenarios must be a non-empty list"})
    if len(entries) > MAX_COMPARE:
        return _response(400, {"error": f"at most {MAX_COMPARE} scenarios can be compared at once"})

    # Computed ONCE and shared across every entry - none of the adjustments
    # change what today's real income/budgets/planned expenses actually are.
    baseline = _get_baseline(user_id)

    results = []
    for entry in entries:
        if "scenarioId" in entry:
            scenario = scenarios_table.get_item(
                Key={"userId": user_id, "scenarioId": entry["scenarioId"]}
            ).get("Item")
            if not scenario:
                results.append({"scenarioId": entry["scenarioId"], "error": "scenario not found"})
                continue
            calc = _apply_adjustments(user_id, baseline, scenario)
            calc["scenarioId"] = entry["scenarioId"]
            calc["name"] = scenario["name"]
        else:
            calc = _apply_adjustments(user_id, baseline, entry)
            calc["scenarioId"] = None
            calc["name"] = entry.get("name", "Untitled")
        results.append(calc)

    return _response(
        200,
        {"baseline": _serialize_baseline(baseline), "scenarios": results},
        default=_decimal_default,
    )


def _get_income_templates(user_id):
    items = recurring_table.query(
        IndexName="byUserAndNextDue",
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    return [i for i in items if i.get("isIncome") and i.get("activeFlag") == "true"]


def _get_planned_expense_monthly_total(user_id):
    items = planned_expenses_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    today = date.today()
    total = decimal.Decimal(0)
    for item in items:
        remaining = decimal.Decimal(str(item["targetAmount"])) - decimal.Decimal(str(item.get("amountSaved", 0)))
        if remaining <= 0:
            continue
        target = date.fromisoformat(item["targetDate"])
        months_remaining = max((target.year - today.year) * 12 + (target.month - today.month), 1)
        total += remaining / decimal.Decimal(months_remaining)
    return total


def _get_baseline(user_id):
    """Today's real numbers - independent of any scenario's adjustments,
    so this only needs to be computed once even when comparing several
    scenarios at once."""
    today = date.today().isoformat()

    income_templates = _get_income_templates(user_id)
    income = sum(
        decimal.Decimal(str(t["estimatedAmount"])) * FREQUENCY_TO_MONTHLY_MULTIPLIER.get(t["frequency"], decimal.Decimal(1))
        for t in income_templates
    )

    active_budgets = get_active_budgets(user_id, today)
    expenses = sum(decimal.Decimal(str(to_monthly_equivalent(b["amount"], b.get("frequency", "monthly")))) for b in active_budgets)

    planned = _get_planned_expense_monthly_total(user_id)

    return {
        "asOfDate": today,
        "monthlyIncome": income,
        "totalExpenses": expenses,
        "plannedExpenseContributions": planned,
        "projectedLeftover": income - expenses - planned,
    }


def _serialize_baseline(baseline):
    return {k: v for k, v in baseline.items()}


def _apply_adjustments(user_id, baseline, adjustments):
    """Layers one scenario's adjustments on top of the shared baseline."""
    income_delta = sum(decimal.Decimal(str(a["monthlyDelta"])) for a in adjustments.get("incomeAdjustments", []))

    # expenseAdjustments.monthlyDelta is already a flat monthly figure
    # regardless of the referenced recurring item's own frequency - e.g.
    # "+$50/mo" on a weekly bill means $50/mo, not $50 added per week.
    expense_delta = sum(decimal.Decimal(str(a["monthlyDelta"])) for a in adjustments.get("expenseAdjustments", []))

    new_expenses_total = sum(
        decimal.Decimal(str(e["monthlyAmount"])) for e in adjustments.get("newExpenses", [])
    )

    adjusted_income = baseline["monthlyIncome"] + income_delta
    adjusted_expenses = baseline["totalExpenses"] + expense_delta + new_expenses_total
    adjusted_leftover = adjusted_income - adjusted_expenses - baseline["plannedExpenseContributions"]

    return {
        "asOfDate": baseline["asOfDate"],
        "baseline": {
            "monthlyIncome": baseline["monthlyIncome"],
            "totalExpenses": baseline["totalExpenses"],
            "plannedExpenseContributions": baseline["plannedExpenseContributions"],
            "projectedLeftover": baseline["projectedLeftover"],
        },
        "adjusted": {
            "monthlyIncome": adjusted_income,
            "totalExpenses": adjusted_expenses,
            "plannedExpenseContributions": baseline["plannedExpenseContributions"],
            "projectedLeftover": adjusted_leftover,
        },
        "leftoverDelta": adjusted_leftover - baseline["projectedLeftover"],
        "newExpenses": adjustments.get("newExpenses", []),
    }


