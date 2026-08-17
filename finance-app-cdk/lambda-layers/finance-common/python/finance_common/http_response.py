"""
Shared API Gateway response helper - the CORS fix.

API Gateway's `defaultCorsPreflightOptions` (see lib/constructs/api.ts)
only auto-configures the OPTIONS preflight request for each resource -
it does NOT add Access-Control-Allow-Origin to the actual GET/POST/PUT/
DELETE responses. That's up to whatever the Lambda itself returns. Every
Lambda in this project built its own local `_response()` helper that
never included it, so every browser call has ALWAYS failed CORS after a
successful preflight, on every environment, since the very first Lambda
was written - the preflight passing gave a false sense that CORS was
handled, but the real request's response was always rejected client-side.
This was never caught by any verification in this project (synth,
py_compile, reproduction scripts) because none of those exercise real
browser CORS enforcement - only an actual browser hitting a real deployed
endpoint does.

Every Lambda should import `response` and `decimal_default` from here
instead of defining its own local copies.
"""
import json
import decimal

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",  # matches api.ts's Cors.ALL_ORIGINS
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
}


def decimal_default(obj):
    """Pass as json.dumps's default= - boto3 always returns DynamoDB
    numeric attributes as Decimal, which the standard json module can't
    serialize without this."""
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    raise TypeError


def response(status_code, body, default=None):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", **CORS_HEADERS},
        "body": json.dumps(body, default=default) if body is not None else "",
    }
