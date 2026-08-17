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
import html
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

    display_subject = f"[PaydayCompass contact] {subject}" if subject else "[PaydayCompass contact] New message"

    text_body = f"From: {name} <{email}>\n" + (f"Subject: {subject}\n" if subject else "") + f"\n{message}"

    # User-supplied fields are unauthenticated public-form input - must be
    # HTML-escaped before interpolation, or a visitor could inject arbitrary
    # markup/links into the owner's email client. The plain-text body above
    # doesn't need this (nothing to break out of).
    safe_name = html.escape(name)
    safe_email = html.escape(email)
    safe_subject = html.escape(subject)
    safe_message = html.escape(message).replace("\n", "<br>")
    html_body = f"""\
<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="margin: 0 0 16px; font-size: 18px; color: #1a1a1a;">New message from the PaydayCompass contact form</h2>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
    <tr>
      <td style="padding: 4px 12px 4px 0; color: #666; font-size: 13px; white-space: nowrap;">Name</td>
      <td style="padding: 4px 0; font-size: 14px;">{safe_name}</td>
    </tr>
    <tr>
      <td style="padding: 4px 12px 4px 0; color: #666; font-size: 13px; white-space: nowrap;">Email</td>
      <td style="padding: 4px 0; font-size: 14px;"><a href="mailto:{safe_email}" style="color: #1a1a1a;">{safe_email}</a></td>
    </tr>
    {f'<tr><td style="padding: 4px 12px 4px 0; color: #666; font-size: 13px; white-space: nowrap;">Subject</td><td style="padding: 4px 0; font-size: 14px;">{safe_subject}</td></tr>' if subject else ""}
  </table>
  <div style="padding: 16px; background: #f5f5f5; border-radius: 8px; font-size: 14px; line-height: 1.5;">
    {safe_message}
  </div>
  <p style="margin-top: 20px; font-size: 12px; color: #999;">Reply directly to this email to respond to {safe_name}.</p>
</div>
"""

    ses_client.send_email(
        Source=os.environ["SES_FROM_ADDRESS"],
        Destination={"ToAddresses": [os.environ["CONTACT_TO_ADDRESS"]]},
        ReplyToAddresses=[email],
        Message={
            "Subject": {"Data": display_subject},
            "Body": {
                "Text": {"Data": text_body},
                "Html": {"Data": html_body},
            },
        },
    )

    return _response(200, {"sent": True})
