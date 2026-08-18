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
from finance_common.budget_frequency import to_monthly_equivalent, recurring_item_monthly_equivalent
from finance_common.payday_periods import previous_real_payday, next_real_payday_after
from finance_common.http_response import response as _response, decimal_default as _decimal_default
from finance_common.decimal_utils import floats_to_decimal

dynamodb = boto3.resource("dynamodb")
scenarios_table = dynamodb.Table(os.environ["SCENARIOS_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource.endswith("/compare") and method == "POST":
        return _compare(user_id, json.loads(event.get("body") or "{}"))
    if resource.endswith("/trend") and method == "POST":
        return _get_trend(user_id, json.loads(event.get("body") or "{}"))
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
        "incomeAdjustments": floats_to_decimal(body.get("incomeAdjustments", [])),
        "expenseAdjustments": floats_to_decimal(body.get("expenseAdjustments", [])),
        "newExpenses": floats_to_decimal(body.get("newExpenses", [])),
        "newIncome": floats_to_decimal(body.get("newIncome", [])),
        "oneTimeExpenses": floats_to_decimal(body.get("oneTimeExpenses", [])),
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


def _get_trend(user_id, body):
    """Cumulative leftover over real pay periods (not calendar months) -
    baseline vs one or more scenarios, so the chart shows how far ahead
    or behind each scenario puts you over time, not just a single
    static "once fully in effect" snapshot. Each adjustment only starts
    counting once its own startDate has been reached (undated
    adjustments count from period 1, same as the static calculation
    already does); one-time expenses hit exactly the one period whose
    real payday they're snapped to, as a lump sum, not prorated."""
    entries = body.get("scenarios", [])
    num_periods = min(int(body.get("numPeriods", 12)), 26)  # capped - this walks real schedule math per period, not free

    baseline = _get_baseline(user_id)
    income_templates = _get_income_templates(user_id)
    today = date.today().isoformat()

    periods = []
    cursor = today
    for _ in range(num_periods):
        period_end = next_real_payday_after(income_templates, cursor)
        periods.append((cursor, period_end))
        cursor = period_end

    def compute_series(adjustments):
        cumulative = decimal.Decimal(0)
        series = []
        for period_start, period_end in periods:
            days = (date.fromisoformat(period_end) - date.fromisoformat(period_start)).days

            def active(a):
                sd = a.get("startDate")
                return not sd or sd <= period_end

            income_delta = sum(decimal.Decimal(str(a["monthlyDelta"])) for a in adjustments.get("incomeAdjustments", []) if active(a))
            expense_delta = sum(decimal.Decimal(str(a["monthlyDelta"])) for a in adjustments.get("expenseAdjustments", []) if active(a))
            new_income_total = sum(decimal.Decimal(str(i["monthlyAmount"])) for i in adjustments.get("newIncome", []) if active(i))
            new_expenses_total = sum(decimal.Decimal(str(e["monthlyAmount"])) for e in adjustments.get("newExpenses", []) if active(e))

            period_monthly_leftover = baseline["projectedLeftover"] + income_delta - expense_delta + new_income_total - new_expenses_total
            daily_rate = period_monthly_leftover / decimal.Decimal("30.4375")  # 365.25/12 - average month length, avoids drift across a year of uneven months
            period_leftover = daily_rate * days

            one_time_hit = sum(
                decimal.Decimal(str(e["amount"])) for e in adjustments.get("oneTimeExpenses", [])
                if previous_real_payday(income_templates, e["date"]) == period_start
            )

            cumulative += period_leftover - one_time_hit
            series.append({"date": period_end, "cumulative": float(cumulative)})
        return series

    baseline_series = compute_series({})
    scenario_results = []
    for entry in entries:
        if "scenarioId" in entry:
            scenario = scenarios_table.get_item(Key={"userId": user_id, "scenarioId": entry["scenarioId"]}).get("Item")
            if not scenario:
                scenario_results.append({"scenarioId": entry["scenarioId"], "error": "scenario not found"})
                continue
            scenario_results.append({"scenarioId": entry["scenarioId"], "name": scenario["name"], "series": compute_series(scenario)})
        else:
            scenario_results.append({"scenarioId": None, "name": entry.get("name", "Untitled"), "series": compute_series(entry)})

    return _response(200, {"baseline": baseline_series, "scenarios": scenario_results}, default=_decimal_default)


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
    income = sum(recurring_item_monthly_equivalent(t) for t in income_templates)

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
    new_income_total = sum(
        decimal.Decimal(str(i["monthlyAmount"])) for i in adjustments.get("newIncome", [])
    )

    adjusted_income = baseline["monthlyIncome"] + income_delta + new_income_total
    adjusted_expenses = baseline["totalExpenses"] + expense_delta + new_expenses_total
    adjusted_leftover = adjusted_income - adjusted_expenses - baseline["plannedExpenseContributions"]

    # One-time expenses don't have an ongoing monthly rate, so they
    # deliberately don't factor into the monthly totals above - they're
    # a single hit on one specific pay period, which only matters once
    # the trend (cumulative, period-by-period) is being computed, not
    # this static "once fully in effect" snapshot. Snapped fresh here
    # (never stored pre-computed) since the user's income schedule can
    # change after a scenario is saved - same "never frozen" principle
    # as the rest of this module.
    one_time_expenses = adjustments.get("oneTimeExpenses", [])
    one_time_with_snap = []
    if one_time_expenses:
        income_templates = _get_income_templates(user_id)
        for e in one_time_expenses:
            one_time_with_snap.append({
                **e,
                "snappedToPayday": previous_real_payday(income_templates, e["date"]),
            })

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
        # Raw adjustment details, not just the net totals above - the
        # comparison table needs to show WHAT changed (which income,
        # which expense, by how much, and starting when), not just the
        # bottom-line delta.
        "incomeAdjustments": adjustments.get("incomeAdjustments", []),
        "expenseAdjustments": adjustments.get("expenseAdjustments", []),
        "newExpenses": adjustments.get("newExpenses", []),
        "newIncome": adjustments.get("newIncome", []),
        "oneTimeExpenses": one_time_with_snap,
    }


