"""
Contact Lambda
POST /contact - public, no auth required (reachable from the pre-login
Landing page as well as the in-app menu). Sends the message to the site
owner via SES, with the visitor's own address set as Reply-To so a
normal "reply" in the owner's email client goes straight back to them -
no separate reply mechanism needed in the app itself.
"""
import os
import re
import json
import boto3

from finance_common.http_response import response as _response

ses_client = boto3.client("ses")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def handler(event, context):
    if event["httpMethod"] != "POST":
        return _response(405, {"error": "Method not allowed"})

    body = json.loads(event.get("body") or "{}")

    name = (body.get("name") or "").strip()[:200]
    email = (body.get("email") or "").strip()[:200]
    subject = (body.get("subject") or "").strip()[:200]
    message = (body.get("message") or "").strip()[:5000]

    if not name:
        return _response(400, {"error": "name is required"})
    if not email or not EMAIL_RE.match(email):
        return _response(400, {"error": "a valid email is required"})
    if not message:
        return _response(400, {"error": "message is required"})

    display_subject = f"[Ledgerline contact] {subject}" if subject else "[Ledgerline contact] New message"

    ses_client.send_email(
        Source=os.environ["SES_FROM_ADDRESS"],
        Destination={"ToAddresses": [os.environ["CONTACT_TO_ADDRESS"]]},
        ReplyToAddresses=[email],
        Message={
            "Subject": {"Data": display_subject},
            "Body": {"Text": {"Data": f"From: {name} <{email}>\n\n{message}"}},
        },
    )

    return _response(200, {"sent": True})
