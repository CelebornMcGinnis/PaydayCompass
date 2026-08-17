"""
Transactions Lambda
Routes:
  GET    /accounts/{accountId}/transactions       -> list transactions for an account
  POST   /accounts/{accountId}/transactions        -> add one expense, possibly split
                                                       across multiple categories
  POST   /accounts/{accountId}/income               -> add a manual income/one-time
                                                       credit (bonus, gift, etc.) -
                                                       recurring templates cover
                                                       SCHEDULED income; this covers
                                                       one-off amounts that aren't on
                                                       a schedule
  PUT    /accounts/{accountId}/transactions/{id}   -> edit a transaction (writes audit log)
  DELETE /accounts/{accountId}/transactions/{id}   -> delete a transaction (writes audit log)
  POST   /transactions/transfer                    -> move funds between two of the
                                                       user's own accounts

Split-purchase contract (matches the "Add Expense" UI):
  body = {
    "totalAmount": 100.00,
    "date": "2026-08-01",          # optional
    "splits": [
      {"amount": 60.00, "category": "Groceries"},
      {"amount": 40.00, "category": "Household"}
    ]
  }
  Sum of splits must equal totalAmount. One transaction item is written per split,
  all sharing a common purchaseId so they can be displayed as one purchase in the UI.

Manual income/one-time credit contract:
  body = { "amount": 500.00, "date": "2026-08-01", "description": "Birthday gift",
            "category": "One-Time Income",           # optional, default shown
            "excludeFromAggregation": false }         # optional checkbox, defaults to false (included)
  Written with isOneTimeCredit: true. Included in projections/aggregation by
  default regardless of category - check "don't include in aggregations" on
  the entry form to opt a specific one out (e.g. a gift the user doesn't want
  counted toward projected available funds). Inclusion is tracked via a
  sparse GSI attribute (oneTimeCreditUserId), not by category name, so
  recategorizing a credit never silently changes whether it's counted.

After every write, this function should invoke (or enqueue an event for) the
Notifications Lambda to re-check budget thresholds for the affected category.

Authorization: every {accountId} route resolves access via
finance_common.sharing_access.resolve_account_access before doing anything
else - the caller must own the account, or have an ACCEPTED share with at
least "view" permission (GET) or "edit" permission (everything else). This
closes a real gap: previously GET had no ownership check at all, and every
write keyed its balance update by the CALLER's own user id rather than the
account's actual owner - meaning a shared "edit" user attempting to use
that access would have silently created a phantom Accounts-table item
under their own id instead of updating the real account.

Provenance: when the acting user differs from the account's owner (a
shared editor made the change), the written item is stamped with
addedByUserId. GET /transactions resolves that to an email and includes it
as addedByEmail, so whoever's looking at a shared account's history - owner
or shared editor - can tell which entries came from someone else. The
transaction's own `userId` field is always the ACCOUNT OWNER's id (not the
actor's), since that's what the byUserAndCategory GSI uses to aggregate
spend against the right person's budgets.
"""
import os
import json
import uuid
import decimal
from datetime import datetime, timezone
import boto3
from finance_common.budget_notify import trigger_budget_check
from finance_common.sharing_access import resolve_account_access
from finance_common.cognito_lookup import lookup_email_by_sub
from finance_common.shared_activity_alerts import notify_owner_of_shared_activity
from finance_common.low_balance_alerts import check_low_balance_alert
from finance_common.transfers import execute_transfer
from finance_common.divisions import adjust_division_balance
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])

DEFAULT_ONE_TIME_CREDIT_CATEGORY = "One-Time Income"


def handler(event, context):
    method = event["httpMethod"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]
    resource = event["resource"]

    if resource.endswith("/transfer") and method == "POST":
        return _transfer(user_id, json.loads(event.get("body") or "{}"))

    account_id = event["pathParameters"]["accountId"]
    access = resolve_account_access(user_id, account_id)
    if not access:
        # Same response whether the account doesn't exist or just isn't
        # shared with this caller - not distinguishing avoids confirming
        # an accountId is valid to someone probing for one.
        return _response(404, {"error": "account not found"})

    write_methods = {"POST", "PUT", "DELETE"}
    if method in write_methods and access["permission"] != "edit":
        return _response(403, {"error": "you have view-only access to this account"})

    # Modifying or deleting an EXISTING transaction is a separate,
    # stricter permission from the base "edit" account access above,
    # which only covers adding new ones - disabled by default even for
    # a shared editor, since it's a materially different (and riskier)
    # capability: rewriting or erasing something the owner already
    # recorded, not just adding their own entries.
    if method in ("PUT", "DELETE") and not access["isOwner"]:
        if (access["dataPermissions"] or {}).get("modifyTransactions") != "edit":
            return _response(403, {"error": "you don't have permission to modify or delete existing transactions on this account"})

    if resource.endswith("/income") and method == "POST":
        return _add_income(user_id, access, account_id, json.loads(event.get("body") or "{}"))

    if "purchase" in resource:
        purchase_id = event["pathParameters"]["purchaseId"]
        if method == "PUT":
            return _edit_purchase_splits(user_id, access, account_id, purchase_id, json.loads(event.get("body") or "{}"))
        if method == "DELETE":
            return _delete_purchase(user_id, access, account_id, purchase_id)

    if method == "GET":
        return _list_transactions(account_id)
    if method == "POST":
        return _add_expense(user_id, access, account_id, json.loads(event.get("body") or "{}"))
    if method == "PUT":
        txn_id = event["pathParameters"]["txnId"]
        return _edit_transaction(user_id, access, account_id, txn_id, json.loads(event.get("body") or "{}"))
    if method == "DELETE":
        txn_id = event["pathParameters"]["txnId"]
        return _delete_transaction(user_id, access, account_id, txn_id)

    return _response(405, {"error": "Method not allowed"})


def _list_transactions(account_id):
    result = transactions_table.query(
        KeyConditionExpression="accountId = :aid",
        ExpressionAttributeValues={":aid": account_id},
        ScanIndexForward=False,  # most recent first
    )
    items = result.get("Items", [])
    for item in items:
        added_by = item.get("addedByUserId")
        if added_by:
            email = lookup_email_by_sub(added_by)
            if email:
                item["addedByEmail"] = email
    return _response(200, items, default=_decimal_default)


def _add_expense(user_id, access, account_id, body):
    total_amount = decimal.Decimal(str(body.get("totalAmount", 0)))
    direction = body.get("direction", "debit")
    if direction not in ("debit", "credit"):
        return _response(400, {"error": "direction must be 'debit' or 'credit'"})
    splits = body.get("splits") or [{"amount": total_amount, "category": body.get("category", "Uncategorized")}]

    split_sum = sum(decimal.Decimal(str(s["amount"])) for s in splits)
    if split_sum != total_amount:
        return _response(400, {"error": f"splits sum to {split_sum}, expected {total_amount}"})

    owner_id = access["ownerUserId"]
    purchase_id = str(uuid.uuid4())
    ts = body.get("date") or datetime.now(timezone.utc).isoformat()
    default_division_id = body.get("divisionId")  # fallback when a split doesn't specify its own - lets an expense (usually one category, one division) stay simple while a deposit can split across several
    written = []
    # A deposit increases the account/division balance; an expense decreases
    # it - same math either way, just the sign of what actually moved.
    signed_split = (lambda amt: amt) if direction == "credit" else (lambda amt: -amt)

    with transactions_table.batch_writer() as batch:
        for split in splits:
            txn_id = str(uuid.uuid4())
            split_amount = decimal.Decimal(str(split["amount"]))
            division_id = split.get("divisionId", default_division_id)
            item = {
                "accountId": account_id,
                "sk": f"{ts}#{txn_id}",
                "txnId": txn_id,
                "userId": owner_id,  # the account owner - budgets/GSI aggregation belongs to them, not the actor
                "purchaseId": purchase_id,
                "amount": split_amount,
                "category": split.get("category", "Uncategorized"),
                "description": (split.get("description") or "")[:250],
                "direction": direction,
                "createdAt": ts,
                "divisionId": division_id,  # persisted per-row (not just applied once) so an edit/delete on this specific row can correctly reverse its own share later
            }
            if user_id != owner_id:
                item["addedByUserId"] = user_id  # a shared editor made this entry, not the owner
            batch.put_item(Item=item)
            written.append(item)
            if division_id:
                adjust_division_balance(account_id, division_id, signed_split(split_amount))

    # Update the account balance - keyed by the OWNER's id, since that's
    # the account's actual DynamoDB key regardless of who triggered this
    balance_result = accounts_table.update_item(
        Key={"userId": owner_id, "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": signed_split(total_amount)},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(owner_id, account_id, balance_result["Attributes"]["balance"])

    # One check per distinct category in the splits, not per split line -
    # two splits in the same category shouldn't fire two separate alerts
    # for what's really one crossing.
    # Budget alerts track spending, not deposits - only relevant for
    # debits (expenses), never for a credit adding money to an account.
    if direction == "debit":
        category_totals = {}
        for split in splits:
            cat = split.get("category", "Uncategorized")
            category_totals[cat] = category_totals.get(cat, decimal.Decimal(0)) + decimal.Decimal(str(split["amount"]))
        for cat, amt in category_totals.items():
            trigger_budget_check(owner_id, account_id, cat, amt)
    else:
        category_totals = {split.get("category", "Uncategorized"): None for split in splits}

    notify_owner_of_shared_activity(
        owner_id, user_id, f"added a ${total_amount:.2f} {'deposit' if direction == 'credit' else 'expense'} ({', '.join(category_totals.keys())})"
    )

    return _response(201, written, default=_decimal_default)


def _find_transaction_by_txn_id(account_id, txn_id):
    """O(1) lookup via the byTxnId GSI, regardless of how much transaction
    history the account has - avoids scanning/filtering per account."""
    result = transactions_table.query(
        IndexName="byTxnId",
        KeyConditionExpression="txnId = :tid",
        ExpressionAttributeValues={":tid": txn_id},
    )
    items = result.get("Items", [])
    return items[0] if items else None


def _add_income(user_id, access, account_id, body):
    """Manual one-time credit (bonus, gift, etc.). Included in aggregation/
    projections by default - regardless of what category is chosen - unless
    the user checks "don't include in aggregations" on the entry form."""
    amount = decimal.Decimal(str(body["amount"]))
    ts = body.get("date") or datetime.now(timezone.utc).isoformat()
    txn_id = str(uuid.uuid4())
    exclude_from_aggregation = body.get("excludeFromAggregation", False)  # checkbox, defaults unchecked
    owner_id = access["ownerUserId"]

    item = {
        "accountId": account_id,
        "sk": f"{ts}#{txn_id}",
        "txnId": txn_id,
        "userId": owner_id,  # the account owner - one-time-credit aggregation belongs to them
        "amount": amount,
        "category": body.get("category", DEFAULT_ONE_TIME_CREDIT_CATEGORY),
        "description": (body.get("description") or "")[:250],
        "direction": "credit",
        "createdAt": ts,
        "isOneTimeCredit": True,
        "excludeFromAggregation": exclude_from_aggregation,
        "source": "manual",
    }
    if user_id != owner_id:
        item["addedByUserId"] = user_id  # a shared editor logged this, not the owner

    # oneTimeCreditUserId is ONLY set when this credit should count toward
    # projections - the byOneTimeCreditIncluded GSI is sparse, so unchecked
    # (excluded) items simply never appear in that index at all, rather than
    # needing to be filtered out on every read.
    if not exclude_from_aggregation:
        item["oneTimeCreditUserId"] = owner_id

    transactions_table.put_item(Item=item)

    balance_result = accounts_table.update_item(
        Key={"userId": owner_id, "accountId": account_id},
        UpdateExpression="ADD balance :amt",
        ExpressionAttributeValues={":amt": amount},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(owner_id, account_id, balance_result["Attributes"]["balance"])

    notify_owner_of_shared_activity(owner_id, user_id, f"added a ${amount:.2f} deposit")

    return _response(201, item, default=_decimal_default)


def _edit_transaction(user_id, access, account_id, txn_id, body):
    existing = _find_transaction_by_txn_id(account_id, txn_id)
    if not existing:
        return _response(404, {"error": "transaction not found"})

    owner_id = access["ownerUserId"]

    editable_fields = {}
    if "amount" in body:
        editable_fields["amount"] = decimal.Decimal(str(body["amount"]))
    if "category" in body:
        editable_fields["category"] = body["category"]
    if "description" in body:
        editable_fields["description"] = body["description"][:250]

    if not editable_fields:
        return _response(400, {"error": "no editable fields provided"})

    # If the amount changed, reverse the old balance impact and apply the
    # new one - keyed by the account's OWNER, not the caller, so an edit
    # made by a shared editor updates the real account rather than
    # creating a phantom item under the editor's own id.
    if "amount" in editable_fields:
        old_amount = decimal.Decimal(str(existing["amount"]))
        new_amount = editable_fields["amount"]
        direction = existing["direction"]
        delta = (new_amount - old_amount) if direction == "credit" else (old_amount - new_amount)
        balance_result = accounts_table.update_item(
            Key={"userId": owner_id, "accountId": account_id},
            UpdateExpression="ADD balance :delta",
            ExpressionAttributeValues={":delta": delta},
            ReturnValues="UPDATED_NEW",
        )
        check_low_balance_alert(owner_id, account_id, balance_result["Attributes"]["balance"])

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in editable_fields)
    transactions_table.update_item(
        Key={"accountId": account_id, "sk": existing["sk"]},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={f"#{k}": k for k in editable_fields},
        ExpressionAttributeValues={f":{k}": v for k, v in editable_fields.items()},
    )

    # The audit log's userId is always the ACTOR (whoever made this edit),
    # not the owner - that's the whole point of an audit trail. This is
    # deliberately different from the transaction item's own userId field.
    _write_audit_log(txn_id, action="edit", before=existing, changes=editable_fields, user_id=user_id)

    notify_owner_of_shared_activity(owner_id, user_id, "edited a transaction")

    updated = {**existing, **editable_fields}
    return _response(200, updated, default=_decimal_default)


def _delete_transaction(user_id, access, account_id, txn_id):
    existing = _find_transaction_by_txn_id(account_id, txn_id)
    if not existing:
        return _response(404, {"error": "transaction not found"})

    owner_id = access["ownerUserId"]

    transactions_table.delete_item(Key={"accountId": account_id, "sk": existing["sk"]})

    # Reverse the balance impact this transaction had - keyed by the
    # account's OWNER, not the caller (same reasoning as _edit_transaction).
    amount = decimal.Decimal(str(existing["amount"]))
    reversal = -amount if existing["direction"] == "credit" else amount
    balance_result = accounts_table.update_item(
        Key={"userId": owner_id, "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": reversal},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(owner_id, account_id, balance_result["Attributes"]["balance"])

    if existing.get("divisionId"):
        division_reversal = -amount if existing["direction"] == "credit" else amount
        adjust_division_balance(account_id, existing["divisionId"], division_reversal)

    _write_audit_log(txn_id, action="delete", before=existing, changes=None, user_id=user_id)

    notify_owner_of_shared_activity(owner_id, user_id, "deleted a transaction")

    return _response(204, None)


def _edit_purchase_splits(user_id, access, account_id, purchase_id, body):
    """Replaces an existing purchase's whole split structure - add/remove
    splits, change amounts/categories/divisions - not just editing one
    row's fields (see _edit_transaction for that). Implemented as
    reverse-the-old + apply-the-new rather than diffing row by row: this
    is simpler and provably correct, since it's exactly the same math
    _delete_transaction and _add_expense already use individually, just
    combined into one operation so the account balance only moves by the
    net difference, not the full old and new amounts separately.
    """
    existing_rows = [
        t for t in transactions_table.query(
            KeyConditionExpression="accountId = :aid",
            ExpressionAttributeValues={":aid": account_id},
        ).get("Items", [])
        if t.get("purchaseId") == purchase_id
    ]
    if not existing_rows:
        return _response(404, {"error": "purchase not found"})

    owner_id = access["ownerUserId"]
    old_total = sum(decimal.Decimal(str(r["amount"])) for r in existing_rows)
    old_direction = existing_rows[0].get("direction", "debit")
    ts = existing_rows[0]["createdAt"]  # keep the original date - this is an edit, not a new purchase

    new_total = decimal.Decimal(str(body.get("totalAmount", 0)))
    # Direction defaults to whatever this purchase already was - the
    # edit-expense flow doesn't currently offer a way to flip a purchase
    # between expense and deposit, but resolving it explicitly here means
    # the math stays correct if that ever changes, rather than silently
    # assuming debit the way this used to.
    new_direction = body.get("direction", old_direction)
    if new_direction not in ("debit", "credit"):
        return _response(400, {"error": "direction must be 'debit' or 'credit'"})
    splits = body.get("splits") or [{"amount": new_total, "category": body.get("category", "Uncategorized")}]
    split_sum = sum(decimal.Decimal(str(s["amount"])) for s in splits)
    if split_sum != new_total:
        return _response(400, {"error": f"splits sum to {split_sum}, expected {new_total}"})

    def signed(amount, direction):
        return amount if direction == "credit" else -amount

    # Reverse every old row's division impact before deleting it - using
    # THIS row's own recorded direction, not an assumption, so reversing
    # a deposit's division impact correctly subtracts rather than adds.
    for row in existing_rows:
        if row.get("divisionId"):
            row_direction = row.get("direction", "debit")
            adjust_division_balance(account_id, row["divisionId"], -signed(decimal.Decimal(str(row["amount"])), row_direction))
        transactions_table.delete_item(Key={"accountId": account_id, "sk": row["sk"]})

    division_id = body.get("divisionId")
    written = []
    with transactions_table.batch_writer() as batch:
        for split in splits:
            txn_id = str(uuid.uuid4())
            split_amount = decimal.Decimal(str(split["amount"]))
            item = {
                "accountId": account_id,
                "sk": f"{ts}#{txn_id}",
                "txnId": txn_id,
                "userId": owner_id,
                "purchaseId": purchase_id,
                "amount": split_amount,
                "category": split.get("category", "Uncategorized"),
                "description": (split.get("description") or "")[:250],
                "direction": new_direction,
                "createdAt": ts,
                "divisionId": division_id,
            }
            if user_id != owner_id:
                item["addedByUserId"] = user_id
            batch.put_item(Item=item)
            written.append(item)
            if division_id:
                adjust_division_balance(account_id, division_id, signed(split_amount, new_direction))

    # Net balance impact = undo whatever the old rows actually did, then
    # apply whatever the new rows actually do - correct regardless of
    # whether direction changed, not just when both are the same.
    net_delta = -signed(old_total, old_direction) + signed(new_total, new_direction)
    if net_delta != 0:
        balance_result = accounts_table.update_item(
            Key={"userId": owner_id, "accountId": account_id},
            UpdateExpression="ADD balance :delta",
            ExpressionAttributeValues={":delta": net_delta},
            ReturnValues="UPDATED_NEW",
        )
        check_low_balance_alert(owner_id, account_id, balance_result["Attributes"]["balance"])

    category_totals = {}
    for split in splits:
        cat = split.get("category", "Uncategorized")
        category_totals[cat] = category_totals.get(cat, decimal.Decimal(0)) + decimal.Decimal(str(split["amount"]))
    for cat, amt in category_totals.items():
        trigger_budget_check(owner_id, account_id, cat, amt)

    _write_audit_log(purchase_id, action="edit-splits", before={"rows": existing_rows}, changes={"splits": splits, "totalAmount": float(new_total)}, user_id=user_id)
    notify_owner_of_shared_activity(owner_id, user_id, "edited an expense's category split")

    return _response(200, {"purchaseId": purchase_id, "splits": written}, default=_decimal_default)


def _delete_purchase(user_id, access, account_id, purchase_id):
    """Deletes every row belonging to a purchase (a split expense may
    have several) as one action - reversing each row's account balance
    and division impact individually, same math as _delete_transaction,
    just applied to the whole purchase instead of one row at a time."""
    existing_rows = [
        t for t in transactions_table.query(
            KeyConditionExpression="accountId = :aid",
            ExpressionAttributeValues={":aid": account_id},
        ).get("Items", [])
        if t.get("purchaseId") == purchase_id
    ]
    if not existing_rows:
        return _response(404, {"error": "purchase not found"})

    owner_id = access["ownerUserId"]
    total_reversal = decimal.Decimal(0)
    for row in existing_rows:
        amount = decimal.Decimal(str(row["amount"]))
        reversal = -amount if row["direction"] == "credit" else amount
        total_reversal += reversal
        if row.get("divisionId"):
            adjust_division_balance(account_id, row["divisionId"], reversal)
        transactions_table.delete_item(Key={"accountId": account_id, "sk": row["sk"]})

    balance_result = accounts_table.update_item(
        Key={"userId": owner_id, "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": total_reversal},
        ReturnValues="UPDATED_NEW",
    )
    check_low_balance_alert(owner_id, account_id, balance_result["Attributes"]["balance"])

    _write_audit_log(purchase_id, action="delete-purchase", before={"rows": existing_rows}, changes=None, user_id=user_id)
    notify_owner_of_shared_activity(owner_id, user_id, "deleted an expense")

    return _response(204, None)


def _write_audit_log(txn_id, action, before, changes, user_id):
    audit_log_table.put_item(
        Item={
            "transactionId": txn_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,  # "edit" | "delete"
            "userId": user_id,
            "before": {k: (str(v) if isinstance(v, decimal.Decimal) else v) for k, v in before.items()},
            "changes": (
                {k: (str(v) if isinstance(v, decimal.Decimal) else v) for k, v in changes.items()}
                if changes
                else None
            ),
        }
    )


def _transfer(user_id, body):
    from_account_id = body["fromAccountId"]
    to_account_id = body["toAccountId"]
    amount = decimal.Decimal(str(body["amount"]))
    ts = body.get("date") or datetime.now(timezone.utc).isoformat()
    description = (body.get("description") or "")[:250]

    if from_account_id == to_account_id:
        return _response(400, {"error": "fromAccountId and toAccountId must differ"})

    # Confirm both accounts belong to this user before moving any money -
    # execute_transfer also checks this, but checking here first lets us
    # return a specific 404 instead of a generic "transfer failed".
    for acct_id in (from_account_id, to_account_id):
        owned = accounts_table.get_item(Key={"userId": user_id, "accountId": acct_id}).get("Item")
        if not owned:
            return _response(404, {"error": f"account {acct_id} not found for this user"})

    result = execute_transfer(accounts_table, transactions_table, user_id, from_account_id, to_account_id, amount, description, ts)
    if not result:
        return _response(400, {"error": "transfer could not be completed"})

    from_division_id = body.get("fromDivisionId")
    if from_division_id:
        adjust_division_balance(from_account_id, from_division_id, -amount)
    to_division_id = body.get("toDivisionId")
    if to_division_id:
        adjust_division_balance(to_account_id, to_division_id, amount)

    return _response(201, result, default=_decimal_default)


