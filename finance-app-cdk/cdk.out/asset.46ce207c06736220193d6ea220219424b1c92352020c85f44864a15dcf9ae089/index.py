"""
Peer Agreements Lambda
Routes:
  POST   /peer-agreements                 -> propose an agreement: caller
                                              (sender) asks recipientEmail
                                              for permission to send them
                                              fund-movement notifications
  GET    /peer-agreements                 -> list the caller's agreements,
                                              both as sender and recipient
  PUT    /peer-agreements/{senderUserId}  -> recipient accepts or declines
                                              a pending proposal
  DELETE /peer-agreements/{otherUserId}   -> either party ends an accepted
                                              agreement ("opt out"). If the
                                              RECIPIENT is the one revoking,
                                              the sender gets an SES alert -
                                              they should know their
                                              notifications will stop
                                              landing anywhere, not just
                                              silently disappear.

An agreement must be accepted before any /peer-notifications can be sent
under it. Revoking deletes the row outright rather than marking it
"revoked" - a fresh agreement afterward is just a new POST, not a
reactivation of history.
"""
import os
import json
import boto3
from finance_common.cognito_lookup import lookup_user_id_by_email, lookup_email_by_sub
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
peer_agreements_table = dynamodb.Table(os.environ["PEER_AGREEMENTS_TABLE"])
ses_client = boto3.client("ses")
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS", "alerts@example.com")


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if method == "POST":
        return _propose(user_id, json.loads(event.get("body") or "{}"))
    if method == "GET":
        return _list(user_id)
    if method == "PUT":
        sender_id = event["pathParameters"]["senderUserId"]
        return _respond(user_id, sender_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        other_id = event["pathParameters"]["otherUserId"]
        return _revoke(user_id, other_id)

    return _response(405, {"error": "Method not allowed"})


def _propose(sender_id, body):
    recipient_email = (body.get("recipientEmail") or "").strip()
    if not recipient_email:
        return _response(400, {"error": "recipientEmail is required"})

    recipient_id = lookup_user_id_by_email(recipient_email)
    if not recipient_id:
        return _response(404, {"error": "No user found with that email"})
    if recipient_id == sender_id:
        return _response(400, {"error": "Cannot propose an agreement with yourself"})

    item = {
        "recipientUserId": recipient_id,
        "senderUserId": sender_id,
        "recipientEmail": recipient_email,
        "status": "pending",
    }
    peer_agreements_table.put_item(Item=item)
    return _response(201, item)


def _list(user_id):
    as_recipient = peer_agreements_table.query(
        KeyConditionExpression="recipientUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    as_sender = peer_agreements_table.query(
        IndexName="bySender",
        KeyConditionExpression="senderUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])

    for item in as_recipient:
        item["role"] = "recipient"
    for item in as_sender:
        item["role"] = "sender"

    return _response(200, {"agreements": as_recipient + as_sender})


def _respond(recipient_id, sender_id, body):
    status = body.get("status")
    if status not in ("accepted", "declined"):
        return _response(400, {"error": "status must be 'accepted' or 'declined'"})

    existing = peer_agreements_table.get_item(
        Key={"recipientUserId": recipient_id, "senderUserId": sender_id}
    ).get("Item")
    if not existing:
        return _response(404, {"error": "agreement not found"})
    if existing["status"] != "pending":
        return _response(409, {"error": f"agreement already {existing['status']}"})

    if status == "declined":
        peer_agreements_table.delete_item(Key={"recipientUserId": recipient_id, "senderUserId": sender_id})
        return _response(200, {"status": "declined"})

    peer_agreements_table.update_item(
        Key={"recipientUserId": recipient_id, "senderUserId": sender_id},
        UpdateExpression="SET #s = :status",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":status": "accepted"},
    )
    return _response(200, {"status": "accepted"})


def _revoke(caller_id, other_id):
    # caller could be the recipient (other_id = sender) or the sender
    # (other_id = recipient) - try both key orientations.
    as_recipient_key = {"recipientUserId": caller_id, "senderUserId": other_id}
    as_sender_key = {"recipientUserId": other_id, "senderUserId": caller_id}

    if peer_agreements_table.get_item(Key=as_recipient_key).get("Item"):
        peer_agreements_table.delete_item(Key=as_recipient_key)
        _alert_sender_of_revocation(sender_id=other_id, recipient_id=caller_id)
        return _response(200, {"revokedBy": "recipient"})

    if peer_agreements_table.get_item(Key=as_sender_key).get("Item"):
        peer_agreements_table.delete_item(Key=as_sender_key)
        return _response(200, {"revokedBy": "sender"})

    return _response(404, {"error": "agreement not found"})


def _alert_sender_of_revocation(sender_id, recipient_id):
    """The recipient opted out - the sender needs to know their fund-
    movement notifications will no longer reach anyone, not discover it by
    silence. Best-effort: a failed email here shouldn't fail the revoke."""
    sender_email = lookup_email_by_sub(sender_id)
    if not sender_email:
        return
    try:
        ses_client.send_email(
            Source=SES_FROM_ADDRESS,
            Destination={"ToAddresses": [sender_email]},
            Message={
                "Subject": {"Data": "A recipient has opted out of your fund-movement notifications"},
                "Body": {
                    "Text": {
                        "Data": (
                            "Someone you were sending fund-movement notifications to has opted "
                            "out. They won't receive any further alerts from you unless you "
                            "propose a new agreement and they accept it again."
                        )
                    }
                },
            },
        )
    except Exception:
        pass


