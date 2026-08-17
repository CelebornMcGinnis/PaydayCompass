"""
User Preferences Lambda
Routes:
  GET /preferences   -> current preferences (defaults filled in for anything not yet set)
  PUT /preferences   -> update one or more preferences

Fields:
  sharedActivityAlertsEnabled  bool, default True  - email the account owner
                                when a shared editor adds/edits/deletes something
  budgetAlertsEnabled          bool, default True  - the 80%/100%/repeat-over-100%
                                budget threshold emails (finance_common.budget_notify)
  lowBalanceAlertsEnabled      bool, default False - email when any account's
                                balance drops below lowBalanceThresholdAmount.
                                Off by default since it means nothing without
                                a threshold set - turning it on with no
                                threshold set is a no-op, not an error.
  lowBalanceThresholdAmount    number or null, default null - applies to
                                every account the user owns; there's no
                                per-account override in this pass.
  categoryTrendCharts          list or null, default null - user-customized
                                Category Trends chart layout, e.g.
                                [{"id": "...", "categories": ["Groceries"]},
                                 {"id": "...", "categories": ["Dining", "Entertainment"]}].
                                null means "not customized yet" - the
                                frontend falls back to auto-computing the
                                top 5 categories by spend. Once the user
                                adds or removes any chart, the full
                                resulting list is saved here so it's
                                consistent across sessions/devices, same
                                as every other preference in this file.
  divisionTrendCharts          dict or null, default null - user-customized
                                per-account Account Detail division-balance
                                chart layout, keyed by accountId (divisions
                                belong to one specific account, unlike
                                categories which span all of them), e.g.
                                {"acc123": [{"id": "...", "divisionIds": ["d1"]},
                                             {"id": "...", "divisionIds": ["d2", "d3"]}]}.
                                Same null/customized/fallback semantics as
                                categoryTrendCharts, just scoped per account.
"""
import os
import json
import decimal
import boto3

dynamodb = boto3.resource("dynamodb")
preferences_table = dynamodb.Table(os.environ["USER_PREFERENCES_TABLE"])

DEFAULTS = {
    "sharedActivityAlertsEnabled": True,
    "budgetAlertsEnabled": True,
    "lowBalanceAlertsEnabled": False,
    "lowBalanceThresholdAmount": None,
    "categoryTrendCharts": None,
    "divisionTrendCharts": None,
}


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if method == "GET":
        return _get_preferences(user_id)
    if method == "PUT":
        return _update_preferences(user_id, json.loads(event.get("body") or "{}"))

    return _response(405, {"error": "Method not allowed"})


def _get_preferences(user_id):
    item = preferences_table.get_item(Key={"userId": user_id}).get("Item") or {}
    merged = {**DEFAULTS, **{k: v for k, v in item.items() if k != "userId"}}
    return _response(200, merged)


def _update_preferences(user_id, body):
    updates = {k: v for k, v in body.items() if k in DEFAULTS}
    if not updates:
        return _response(400, {"error": f"no recognized preference fields - valid: {sorted(DEFAULTS)}"})

    if "lowBalanceThresholdAmount" in updates and updates["lowBalanceThresholdAmount"] is not None:
        updates["lowBalanceThresholdAmount"] = decimal.Decimal(str(updates["lowBalanceThresholdAmount"]))

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in updates)
    preferences_table.update_item(
        Key={"userId": user_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in updates},
        ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
    )
    return _get_preferences(user_id)


from finance_common.http_response import response as _base_response, decimal_default as _decimal_default


def _response(status_code, body):
    return _base_response(status_code, body, default=_decimal_default)
