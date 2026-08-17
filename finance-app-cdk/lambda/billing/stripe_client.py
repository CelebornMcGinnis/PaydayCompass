"""
Minimal Stripe REST API client - hand-rolled, not the official `stripe`
PyPI SDK. The shared Lambda layer (lib/constructs/shared-layer.ts) has no
pip-bundling step anywhere in this repo; Stripe's API is plain HTTP with
form-encoded bodies, and its webhook signature scheme is documented,
standard HMAC-SHA256 - both are stdlib-only (urllib/hmac/hashlib), matching
every other Lambda here. Only the handful of calls billing-fn actually
needs, not a general-purpose client.
"""
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request

STRIPE_API_BASE = "https://api.stripe.com/v1"
WEBHOOK_TOLERANCE_SECONDS = 300  # Stripe's own default replay-protection window


class StripeError(Exception):
    def __init__(self, status_code, body):
        self.status_code = status_code
        self.body = body
        super().__init__(f"Stripe API error {status_code}: {body}")


def _request(secret_key, method, path, params=None):
    url = f"{STRIPE_API_BASE}{path}"
    data = urllib.parse.urlencode(params).encode("utf-8") if params else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {secret_key}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise StripeError(e.code, e.read().decode("utf-8")) from e


def create_checkout_session(secret_key, price_id, client_reference_id, customer_email, success_url, cancel_url):
    params = {
        "mode": "subscription",
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "client_reference_id": client_reference_id,
        "customer_email": customer_email,
        "success_url": success_url,
        "cancel_url": cancel_url,
    }
    return _request(secret_key, "POST", "/checkout/sessions", params)


def create_billing_portal_session(secret_key, customer_id, return_url):
    params = {"customer": customer_id, "return_url": return_url}
    return _request(secret_key, "POST", "/billing_portal/sessions", params)


def retrieve_subscription(secret_key, subscription_id):
    return _request(secret_key, "GET", f"/subscriptions/{subscription_id}")


def verify_webhook_signature(payload_bytes, sig_header, webhook_secret, tolerance=WEBHOOK_TOLERANCE_SECONDS):
    """
    https://stripe.com/docs/webhooks/signatures - never raises, so callers
    always get a clean reject rather than a 500 on a malformed header.
    Checks every v1 signature present (not just the first) since Stripe
    sends more than one during a webhook-secret rotation.
    """
    if not sig_header:
        return False

    timestamp = None
    signatures = []
    for part in sig_header.split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key == "t":
            timestamp = value
        elif key == "v1":
            signatures.append(value)

    if not timestamp or not signatures:
        return False

    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs(time.time() - ts) > tolerance:
        return False  # too old - reject to prevent replay

    signed_payload = f"{timestamp}.".encode("utf-8") + payload_bytes
    expected = hmac.new(webhook_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)
