"""
Peer Notifications Lambda
Routes:
  POST   /peer-notifications                 -> sender creates a fund-movement
                                                 alert for a recipient who has
                                                 an ACCEPTED agreement with them
  GET    /peer-notifications                 -> recipient lists their alerts;
                                                 each item includes isExpanded
                                                 (true until its due date passes)
  DELETE /peer-notifications/{notificationId} -> recipient dismisses one

An alert stays as a fully-expanded banner (frontend concern - this just
computes and returns isExpanded) until the day after its dueDate, at which
point it's still returned but the frontend should render it collapsed/
archived rather than deleting it outright - the recipient may still want a
record of past fund movements.
"""
import os
import json
import uuid
import decimal
from datetime import date, datetime, timezone
import boto3
from finance_common.cognito_lookup import lookup_user_id_by_email, lookup_email_by_sub
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
ses_client = boto3.client("ses")
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS", "alerts@example.com")
peer_notifications_table = dynamodb.Table(os.environ["PEER_NOTIFICATIONS_TABLE"])
peer_agreements_table = dynamodb.Table(os.environ["PEER_AGREEMENTS_TABLE"])


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if method == "POST":
        return _create(user_id, json.loads(event.get("body") or "{}"))
    if method == "GET":
        return _list(user_id)
    if method == "DELETE":
        notification_id = event["pathParameters"]["notificationId"]
        return _delete(user_id, notification_id)

    return _response(405, {"error": "Method not allowed"})


def _create(sender_id, body):
    recipient_email = (body.get("recipientEmail") or "").strip()
    amount = body.get("amount")
    due_date = (body.get("dueDate") or "").strip()
    message = (body.get("message") or "").strip()[:500]

    if not recipient_email or amount is None or not due_date or not message:
        return _response(400, {"error": "recipientEmail, amount, dueDate, and message are all required"})

    recipient_id = lookup_user_id_by_email(recipient_email)
    if not recipient_id:
        return _response(404, {"error": "No user found with that email"})

    agreement = peer_agreements_table.get_item(
        Key={"recipientUserId": recipient_id, "senderUserId": sender_id}
    ).get("Item")
    if not agreement or agreement.get("status") != "accepted":
        return _response(
            403,
            {"error": "No accepted agreement with this recipient - they must accept your agreement request first"},
        )

    notification_id = str(uuid.uuid4())
    item = {
        "recipientUserId": recipient_id,
        "sk": f"{due_date}#{notification_id}",
        "notificationId": notification_id,
        "senderUserId": sender_id,
        "amount": decimal.Decimal(str(amount)),
        "dueDate": due_date,
        "message": message,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    peer_notifications_table.put_item(Item=item)
    _send_notification_email(sender_id, recipient_email, amount, due_date, message)
    return _response(201, item, default=_decimal_default)


def _send_notification_email(sender_id, recipient_email, amount, due_date, message):
    """Best-effort - the in-app notification record above is the actual
    source of truth; a failed email should never block that from being
    created, since it already succeeded by this point."""
    try:
        sender_email = lookup_email_by_sub(sender_id)
        ses_client.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [recipient_email]},
            Message={
                "Subject": {"Data": f"{sender_email or 'Someone'} sent you a fund-movement notification"},
                "Body": {
                    "Text": {
                        "Data": (
                            f"{sender_email or 'Someone'} says: \"{message}\"\n\n"
                            f"Amount: ${amount}\nDue: {due_date}\n\n"
                            "Sign in to view this notification."
                        )
                    }
                },
            },
        )
    except Exception:
        pass


def _list(recipient_id):
    result = peer_notifications_table.query(
        KeyConditionExpression="recipientUserId = :uid",
        ExpressionAttributeValues={":uid": recipient_id},
        ScanIndexForward=True,  # soonest due date first
    )
    today = date.today().isoformat()
    items = result.get("Items", [])
    for item in items:
        # Fully expanded through and including the due date itself - it
        # collapses the day AFTER, not the moment the date arrives.
        item["isExpanded"] = item["dueDate"] >= today
    return _response(200, {"notifications": items}, default=_decimal_default)


def _delete(recipient_id, notification_id):
    # notificationId alone isn't the sort key (sk is "dueDate#notificationId"),
    # so find the matching item first via a bounded query on the recipient's
    # own notifications rather than requiring the client to know the dueDate.
    result = peer_notifications_table.query(
        KeyConditionExpression="recipientUserId = :uid",
        FilterExpression="notificationId = :nid",
        ExpressionAttributeValues={":uid": recipient_id, ":nid": notification_id},
    )
    items = result.get("Items", [])
    if not items:
        return _response(404, {"error": "notification not found"})

    peer_notifications_table.delete_item(Key={"recipientUserId": recipient_id, "sk": items[0]["sk"]})
    return _response(204, None)


