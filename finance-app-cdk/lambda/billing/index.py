"""
Billing Lambda - Stripe subscription tiers (dev-environment exploration).
Routes:
  GET  /billing/status    -> current tier/status for the caller
  POST /billing/checkout  -> create a Stripe Checkout Session (subscribe),
                              returns {checkoutUrl} for the frontend to redirect to
  POST /billing/portal    -> create a Stripe Billing Portal session (manage/
                              cancel an existing subscription), returns {portalUrl}
  POST /billing/webhook   -> public, no auth (same pattern as /contact) - Stripe
                              posts subscription lifecycle events here directly

Stripe secret key, webhook signing secret, and the Premium plan's Price ID
all live in one Secrets Manager secret (name: STRIPE_SECRET_NAME env var,
per-environment), never in code or plain env vars - see stripe_client.py's
module docstring for why this is a hand-rolled HTTP client rather than the
official SDK.

Tier storage: SubscriptionsTable, one row per user, absent row = free tier
(same convention as UserPreferencesTable). checkout.session.completed
carries our own userId (via client_reference_id, set at checkout-creation
time) so the initial upgrade never needs a lookup. subscription.updated/
.deleted events only carry Stripe's own customer/subscription ids, so
those go through the byStripeCustomerId GSI instead.
"""
import base64
import json
import os
import time

import boto3
from boto3.dynamodb.conditions import Key

import stripe_client
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
subscriptions_table = dynamodb.Table(os.environ["SUBSCRIPTIONS_TABLE"])
secrets_client = boto3.client("secretsmanager")

DEFAULT_STATUS = {"tier": "free", "status": None, "currentPeriodEnd": None, "cancelAtPeriodEnd": False}

# Subscription statuses that still count as premium access - "past_due"
# is a deliberate grace period (a failed card retry doesn't instantly
# lock the user out; Stripe's own retry schedule and eventual
# customer.subscription.deleted/updated-to-canceled event handles the
# real cutoff).
PREMIUM_STATUSES = {"active", "trialing", "past_due"}


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]

    if resource == "/billing/webhook" and method == "POST":
        return _handle_webhook(event)

    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource == "/billing/status" and method == "GET":
        return _get_status(user_id)
    if resource == "/billing/checkout" and method == "POST":
        return _create_checkout(user_id, event)
    if resource == "/billing/portal" and method == "POST":
        return _create_portal(user_id, event)

    return _response(404, {"error": "Not found"})


def _get_stripe_config():
    raw = secrets_client.get_secret_value(SecretId=os.environ["STRIPE_SECRET_NAME"])["SecretString"]
    return json.loads(raw)


def _get_status(user_id):
    item = subscriptions_table.get_item(Key={"userId": user_id}).get("Item")
    if not item:
        return _response(200, DEFAULT_STATUS, default=_decimal_default)
    return _response(200, {
        "tier": item.get("tier", "free"),
        "status": item.get("status"),
        "currentPeriodEnd": item.get("currentPeriodEnd"),
        "cancelAtPeriodEnd": item.get("cancelAtPeriodEnd", False),
    }, default=_decimal_default)


def _create_checkout(user_id, event):
    body = json.loads(event.get("body") or "{}")
    success_url = body.get("successUrl")
    cancel_url = body.get("cancelUrl")
    if not success_url or not cancel_url:
        return _response(400, {"error": "successUrl and cancelUrl are required"})

    email = event["requestContext"]["authorizer"]["claims"].get("email")
    cfg = _get_stripe_config()

    try:
        session = stripe_client.create_checkout_session(
            secret_key=cfg["secretKey"],
            price_id=cfg["premiumPriceId"],
            client_reference_id=user_id,
            customer_email=email,
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except stripe_client.StripeError as e:
        return _response(502, {"error": f"Stripe checkout creation failed: {e}"})

    return _response(200, {"checkoutUrl": session["url"]})


def _create_portal(user_id, event):
    body = json.loads(event.get("body") or "{}")
    return_url = body.get("returnUrl")
    if not return_url:
        return _response(400, {"error": "returnUrl is required"})

    item = subscriptions_table.get_item(Key={"userId": user_id}).get("Item")
    if not item or not item.get("stripeCustomerId"):
        return _response(400, {"error": "No billing account found - upgrade to Premium first"})

    cfg = _get_stripe_config()
    try:
        session = stripe_client.create_billing_portal_session(
            secret_key=cfg["secretKey"],
            customer_id=item["stripeCustomerId"],
            return_url=return_url,
        )
    except stripe_client.StripeError as e:
        return _response(502, {"error": f"Stripe portal creation failed: {e}"})

    return _response(200, {"portalUrl": session["url"]})


def _handle_webhook(event):
    cfg = _get_stripe_config()
    raw_body = event.get("body") or ""
    payload_bytes = base64.b64decode(raw_body) if event.get("isBase64Encoded") else raw_body.encode("utf-8")

    headers = event.get("headers") or {}
    sig_header = headers.get("Stripe-Signature") or headers.get("stripe-signature")
    if not stripe_client.verify_webhook_signature(payload_bytes, sig_header, cfg["webhookSecret"]):
        return _response(400, {"error": "Invalid signature"})

    payload = json.loads(payload_bytes)
    event_type = payload.get("type")
    data_object = payload.get("data", {}).get("object", {})

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(cfg, data_object)
    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(data_object)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data_object)
    # Every other event type is a normal, expected no-op - Stripe sends many
    # event types this app doesn't act on. Returning 200 tells Stripe not
    # to retry, which is correct for both "we don't care" and "we handled
    # it" cases.

    return _response(200, {"received": True})


def _get_current_period_end(sub):
    """
    Newer Stripe API versions moved current_period_end off the top-level
    Subscription object onto each subscription item (multi-item
    subscriptions can each bill on a different cycle) - confirmed by
    directly inspecting a real subscription object against this account's
    default API version, where the top-level field is always None.
    Checks top-level first for forward/backward compatibility, falls back
    to the first item's value, which is correct for this app's
    single-price subscriptions.
    """
    top_level = sub.get("current_period_end")
    if top_level is not None:
        return top_level
    items = (sub.get("items") or {}).get("data") or []
    return items[0].get("current_period_end") if items else None


def _handle_checkout_completed(cfg, session):
    user_id = session.get("client_reference_id")
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")
    if not user_id or not subscription_id:
        return  # not a subscription checkout, or missing our own reference - nothing to reconcile

    sub = stripe_client.retrieve_subscription(cfg["secretKey"], subscription_id)
    subscriptions_table.put_item(Item={
        "userId": user_id,
        "tier": "premium" if sub.get("status") in PREMIUM_STATUSES else "free",
        "status": sub.get("status"),
        "stripeCustomerId": customer_id,
        "stripeSubscriptionId": subscription_id,
        "currentPeriodEnd": _get_current_period_end(sub),
        "cancelAtPeriodEnd": sub.get("cancel_at_period_end", False),
        "updatedAt": int(time.time()),
    })


def _find_user_id_by_customer_id(customer_id):
    resp = subscriptions_table.query(
        IndexName="byStripeCustomerId",
        KeyConditionExpression=Key("stripeCustomerId").eq(customer_id),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0]["userId"] if items else None


def _handle_subscription_updated(sub):
    user_id = _find_user_id_by_customer_id(sub.get("customer"))
    if not user_id:
        return  # no local record to reconcile against (e.g. a stray test event)

    status = sub.get("status")
    subscriptions_table.update_item(
        Key={"userId": user_id},
        UpdateExpression="SET #tier = :tier, #status = :status, currentPeriodEnd = :cpe, cancelAtPeriodEnd = :cape, updatedAt = :ua",
        ExpressionAttributeNames={"#tier": "tier", "#status": "status"},
        ExpressionAttributeValues={
            ":tier": "premium" if status in PREMIUM_STATUSES else "free",
            ":status": status,
            ":cpe": _get_current_period_end(sub),
            ":cape": sub.get("cancel_at_period_end", False),
            ":ua": int(time.time()),
        },
    )


def _handle_subscription_deleted(sub):
    user_id = _find_user_id_by_customer_id(sub.get("customer"))
    if not user_id:
        return
    subscriptions_table.update_item(
        Key={"userId": user_id},
        UpdateExpression="SET #tier = :tier, #status = :status, updatedAt = :ua",
        ExpressionAttributeNames={"#tier": "tier", "#status": "status"},
        ExpressionAttributeValues={":tier": "free", ":status": "canceled", ":ua": int(time.time())},
    )
