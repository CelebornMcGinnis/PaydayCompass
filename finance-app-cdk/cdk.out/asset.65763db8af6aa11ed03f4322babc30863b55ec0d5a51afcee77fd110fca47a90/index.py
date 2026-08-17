"""
Payday Wizard Lambda
Routes:
  GET  /payday/upcoming  -> preview: income due next, plus every recurring
                            expense due on or before that payday, across
                            ALL accounts (not scoped to one account)
  POST /payday/submit    -> the user has moved money in their real bank
                            accounts and finalized amounts here - post
                            everything now (adjusted recurring occurrences
                            + any unpredicted one-off amounts) in one batch

This does NOT wait for the daily recurring processor. Submitting here posts
the transactions immediately and advances each template's nextDueDate, so
the daily job won't double-post the same occurrence later.

POST /payday/submit body:
{
  "recurringAdjustments": [
    {"recurringId": "...", "accountId": "...", "amount": 142.50}  # overrides
    # estimate for just this occurrence; omit "amount" to use the template's
    # normal estimatedAmount as-is
  ],
  "additionalTransactions": [
    {"accountId": "...", "amount": 25.00, "category": "Misc", "direction": "debit", "description": "..."}
  ],
  "peerNotifications": [
    {"recipientUserId": "...", "amount": 55.00, "dueDate": "2026-08-15", "message": "..."}
    # sends a fund-movement alert to someone the caller has an ACCEPTED
    # PeerAgreement with (see the Peer Agreements Lambda) - this is
    # deliberately a separate consent from account-data sharing, so
    # candidates are drawn from GET /payday/upcoming's shareableRecipients
    # list, filtered by the frontend to those with agreementStatus="accepted"
  ]
}

GET /payday/upcoming also returns "shareableRecipients": everyone the
caller shares an account with (accepted shares only), each tagged with
their fund-movement agreementStatus ("accepted" | "pending" | "none") so
the frontend can show the full list but only enable sending to the ones
who've actually consented to receive these alerts.
"""
import os
import json
import uuid
import decimal
from datetime import date, datetime, timedelta, timezone
import boto3
from finance_common.schedule import next_date_after
from finance_common.cognito_lookup import lookup_email_by_sub
from finance_common.budget_frequency import budget_amount_due_on_payday, previous_date_before
from finance_common.budget_notify import get_active_budgets
ses_client = boto3.client("ses")
SES_FROM_ADDRESS = os.environ.get("SES_FROM_ADDRESS", "alerts@example.com")
from finance_common.http_response import response as _response, decimal_default as _decimal_default

dynamodb = boto3.resource("dynamodb")
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
external_bank_accounts_table = dynamodb.Table(os.environ["EXTERNAL_BANK_ACCOUNTS_TABLE"])
sharing_table = dynamodb.Table(os.environ["SHARING_TABLE"])
peer_agreements_table = dynamodb.Table(os.environ["PEER_AGREEMENTS_TABLE"])
peer_notifications_table = dynamodb.Table(os.environ["PEER_NOTIFICATIONS_TABLE"])
payday_history_table = dynamodb.Table(os.environ["PAYDAY_HISTORY_TABLE"])
budgets_table = dynamodb.Table(os.environ["BUDGETS_TABLE"])
planned_expenses_table = dynamodb.Table(os.environ["PLANNED_EXPENSES_TABLE"])


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource.endswith("/upcoming") and method == "GET":
        return _get_upcoming(user_id, event.get("queryStringParameters") or {})
    if resource.endswith("/submit") and method == "POST":
        return _submit(user_id, json.loads(event.get("body") or "{}"))
    if resource.endswith("/history") and method == "GET":
        return _get_history(user_id)

    return _response(405, {"error": "Method not allowed"})


def _get_history(user_id):
    """Every past submitted payday still within the 1.5-year TTL window,
    most recent first. Note this only ever contains paydays that were
    actually SUBMITTED - there's nothing to show for a future one until
    it's been through the normal submit flow."""
    items = payday_history_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
        ScanIndexForward=False,  # newest paydayDate first
    ).get("Items", [])
    return _response(200, {"history": items}, default=_decimal_default)


def _previous_real_payday(income_items, target_date):
    """The real payday immediately before target_date, across every
    income template - the start of the pay period ending at
    target_date. Falls back to 30 days before if there's no income
    schedule at all, so a brand-new user without income set up yet
    still gets a workable (if approximate) window rather than a crash."""
    candidates = []
    for item in income_items:
        d = item["nextDueDate"]
        if d >= target_date:
            for _ in range(60):
                d = previous_date_before(item, d)
                if d < target_date:
                    break
        else:
            for _ in range(60):
                nxt = next_date_after(item, d)
                if nxt >= target_date:
                    break
                d = nxt
        candidates.append(d)
    if candidates:
        return max(candidates)
    return (date.fromisoformat(target_date) - timedelta(days=30)).isoformat()


def _relevant_occurrence(item, period_start, period_end):
    """Walks item's own schedule forward from its current nextDueDate to
    find whichever occurrence falls in (period_start, period_end] - the
    one occurrence that "belongs" to this specific pay period. Returns
    that date, or None if nothing in this item's schedule lands there.
    When period_end is the very next real payday (the common case),
    this resolves in zero extra steps, same as before this function
    existed - the walk only matters when browsing a payday further out
    than the item's immediate next occurrence."""
    current = item["nextDueDate"]
    for _ in range(60):
        if current > period_end:
            return None
        if current > period_start:
            return current
        current = next_date_after(item, current)
    return None


def _get_upcoming(user_id, query_params):
    requested_date = query_params.get("date")
    today = date.today().isoformat()

    # byUserAndNextDue is partitioned by userId - this query can only ever
    # return this user's own templates, regardless of anything else.
    own_items = [
        i for i in recurring_table.query(
            IndexName="byUserAndNextDue",
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        ).get("Items", [])
        if i.get("activeFlag") == "true"
    ]

    shared_items = _get_shared_recurring_items(user_id)
    active_items = own_items + shared_items

    income_items = [i for i in active_items if i.get("isIncome")]
    next_payday = requested_date or min((i["nextDueDate"] for i in income_items), default=today)

    # Budgeted expenses and planned-expense contributions are purely
    # informational reminders, computed fresh regardless of whether this
    # payday was already submitted - a budget's cap or a planned expense's
    # target can change over time, so "what would apply now" is more
    # useful when looking back than trying to freeze a stale snapshot.
    active_budgets = get_active_budgets(user_id, next_payday)
    budgeted_expenses = [
        {
            "category": b["category"],
            "amount": budget_amount_due_on_payday(b, next_payday, income_items),
            "frequency": b.get("frequency", "monthly"),
        }
        for b in active_budgets
    ]
    planned_items = planned_expenses_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    planned_expense_contributions = [
        {
            "plannedExpenseId": pe["plannedExpenseId"],
            "name": pe.get("name", ""),
            "category": pe.get("category"),
            "amount": budget_amount_due_on_payday(
                {"amount": pe["suggestedContribution"], "frequency": pe.get("contributionFrequency", "monthly")},
                next_payday,
                income_items,
            ),
        }
        for pe in planned_items
    ]

    # A date the user already submitted for - show what actually
    # happened for income/expenses (the real transactions posted), but
    # still include the freshly-computed budgeted/planned reminders above.
    if requested_date:
        history_item = payday_history_table.get_item(
            Key={"userId": user_id, "paydayDate": requested_date}
        ).get("Item")
        if history_item:
            return _response(
                200,
                {
                    "mode": "history",
                    "budgetedExpenses": budgeted_expenses,
                    "plannedExpenseContributions": planned_expense_contributions,
                    **history_item,
                },
                default=_decimal_default,
            )

    previous_payday = _previous_real_payday(income_items, next_payday)

    # Bills due a few days after payday still matter for this decision -
    # you're moving money now for what's coming, not just what's already
    # overdue. 5 days out, not further, so this stays "what's relevant to
    # this payday" rather than turning into a general expense list.
    window_end = (date.fromisoformat(next_payday) + timedelta(days=5)).isoformat()

    due_expenses = []
    for i in active_items:
        if i.get("isIncome"):
            continue
        occurrence = _relevant_occurrence(i, previous_payday, window_end)
        if occurrence is not None:
            item_copy = dict(i)
            item_copy["nextDueDate"] = occurrence  # the occurrence for THIS pay period, which may differ from the item's literal current nextDueDate when browsing a future payday
            due_expenses.append(item_copy)

    due_income = []
    for i in income_items:
        occurrence = _relevant_occurrence(i, previous_payday, next_payday)
        if occurrence is not None:
            item_copy = dict(i)
            item_copy["nextDueDate"] = occurrence
            due_income.append(item_copy)
    if not due_income:
        due_income = income_items

    def _current_estimate(item):
        overrides = item.get("occurrenceOverrides") or {}
        override = overrides.get(item["nextDueDate"])
        return float(override) if override is not None else float(item["estimatedAmount"])

    # Resolve names across every owner whose expenses appear here - a
    # shared expense's externalBankAccountId refers to an entry in the
    # SHARER's own external-accounts list, not the caller's, so looking it
    # up against only the caller's list would always come back empty for
    # shared items.
    owner_ids = {user_id} | {i["sharedFromUserId"] for i in due_expenses if i.get("sharedFromUserId")}
    external_account_names = _get_external_account_names_for_owners(owner_ids)

    # Budgeted expenses and planned-expense contributions were already
    # computed above (before the history check), so both branches get
    # them - nothing further needed here.

    return _response(
        200,
        {
            "mode": "preview",
            "nextPayday": next_payday,
            "income": [
                {
                    "recurringId": i["recurringId"],
                    "accountId": i["accountId"],
                    "description": i.get("description", ""),
                    "netAmount": _current_estimate(i),
                    "grossAmount": float(i["grossAmount"]) if i.get("grossAmount") is not None else None,
                    "dueDate": i["nextDueDate"],
                    "sharedFromUserId": i.get("sharedFromUserId"),
                    "sharedPermission": i.get("sharedPermission"),
                }
                for i in due_income
            ],
            "upcomingExpenses": [
                {
                    "recurringId": i["recurringId"],
                    "accountId": i["accountId"],
                    "description": i.get("description", ""),
                    "category": i.get("category", "Uncategorized"),
                    "estimatedAmount": _current_estimate(i),
                    "dueDate": i["nextDueDate"],
                    "isAfterPayday": i["nextDueDate"] > next_payday,
                    "externalBankAccountId": i.get("externalBankAccountId"),
                    "externalBankAccountName": _format_external_account_name(i, external_account_names, user_id),
                    "sharedFromUserId": i.get("sharedFromUserId"),
                    "sharedPermission": i.get("sharedPermission"),
                }
                for i in due_expenses
            ],
            "budgetedExpenses": budgeted_expenses,
            "plannedExpenseContributions": planned_expense_contributions,
            "aggregateByExternalBankAccount": _aggregate_by_external_account(
                due_expenses, external_account_names, _current_estimate, user_id
            ),
            "shareableRecipients": _get_shareable_recipients(user_id),
        },
    )


def _get_shareable_recipients(user_id):
    """Everyone the caller shares an account with (accepted shares, caller
    as owner), each tagged with their separate fund-movement notification
    agreement status. Sharing an account does NOT imply consent to receive
    notifications - that's its own accept-required agreement - so this
    list lets the frontend show every shareable person while only letting
    the wizard actually notify the ones who've said yes to that too."""
    shares = sharing_table.query(
        KeyConditionExpression="ownerUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    accepted_people = {
        s["invitedUserId"]: s.get("invitedEmail") for s in shares if s.get("status") == "accepted"
    }
    if not accepted_people:
        return []

    agreements = peer_agreements_table.query(
        IndexName="bySender",
        KeyConditionExpression="senderUserId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    agreement_status_by_recipient = {a["recipientUserId"]: a["status"] for a in agreements}

    return [
        {
            "userId": recipient_id,
            "email": email,
            "agreementStatus": agreement_status_by_recipient.get(recipient_id, "none"),
        }
        for recipient_id, email in accepted_people.items()
    ]


def _get_shared_recurring_items(user_id):
    """Templates from OTHER users' recurring items, where they've shared
    "income" and/or "recurring" (expense) data with this user via an
    ACCEPTED invite. income and recurring are shared independently - a
    user might share their bills but not their income, or vice versa.
    Uses the byInvitedUser GSI so this lookup only ever touches shares
    actually directed at the caller, never scans the whole table."""
    shares = sharing_table.query(
        IndexName="byInvitedUser",
        KeyConditionExpression="invitedUserId = :uid AND #s = :accepted",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":uid": user_id, ":accepted": "accepted"},
    ).get("Items", [])

    shared_items = []
    for share in shares:
        account_id = share.get("accountId")
        if not account_id:
            continue
        data_perms = share.get("dataPermissions", {})
        income_perm = data_perms.get("income", "not_shared")
        recurring_perm = data_perms.get("recurring", "not_shared")
        if income_perm == "not_shared" and recurring_perm == "not_shared":
            continue

        items = recurring_table.query(
            KeyConditionExpression="accountId = :aid",
            ExpressionAttributeValues={":aid": account_id},
        ).get("Items", [])

        for item in items:
            if item.get("activeFlag") != "true":
                continue
            is_income = item.get("isIncome", False)
            permission = income_perm if is_income else recurring_perm
            if permission == "not_shared":
                continue
            tagged = dict(item)
            tagged["sharedFromUserId"] = share["ownerUserId"]
            tagged["sharedPermission"] = permission  # "view" or "edit" - frontend should disable
            shared_items.append(tagged)          # edit controls for "view"

    return shared_items


def _get_external_account_names(user_id):
    items = external_bank_accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    return {i["externalBankAccountId"]: i["name"] for i in items}


def _get_external_account_names_for_owners(owner_user_ids):
    """Merges each owner's external-account name list into one lookup dict,
    keyed by (ownerUserId, externalBankAccountId) rather than by
    externalBankAccountId alone. externalBankAccountId is a UUID, so a
    collision between two different owners' lists is astronomically
    unlikely - but relying on that likelihood rather than just eliminating
    the possibility outright was the gap here. Namespacing by owner closes
    it completely, at effectively no extra cost."""
    result = {}
    for owner_id in owner_user_ids:
        for external_id, name in _get_external_account_names(owner_id).items():
            result[(owner_id, external_id)] = name
    return result


def _resolve_owner_id(item, caller_user_id):
    """The item's real owner: sharedFromUserId for a shared item, or the
    caller themselves for their own item (sharedFromUserId is only ever set
    on merged-in shared items, never on the caller's own)."""
    return item.get("sharedFromUserId") or caller_user_id


def _format_external_account_name(item, external_account_names, caller_user_id):
    external_id = item.get("externalBankAccountId")
    if not external_id:
        return None
    owner_id = _resolve_owner_id(item, caller_user_id)
    name = external_account_names.get((owner_id, external_id))
    if not name:
        return None
    return f"{name} (shared)" if item.get("sharedFromUserId") else name


def _aggregate_by_external_account(due_expenses, external_account_names, current_estimate_fn, caller_user_id):
    """Sums 'money to move out' across due expenses, grouped by which
    real-world bank account they're tagged as coming from. Expenses with no
    external bank account set are grouped under "Unassigned" rather than
    silently dropped, so the total is always reconcilable against the sum
    of individual expense amounts.

    Grouped internally by (ownerUserId, externalBankAccountId) rather than
    by display name alone - two different people's accounts could
    coincidentally share a name (e.g. both call one "Chase Checking"), and
    grouping by name text would incorrectly merge those into one total."""
    totals = {}
    labels = {}
    for item in due_expenses:
        external_id = item.get("externalBankAccountId")
        owner_id = item.get("sharedFromUserId")
        group_key = (owner_id, external_id) if external_id else (owner_id, None)
        label = _format_external_account_name(item, external_account_names, caller_user_id) or "Unassigned"

        totals[group_key] = totals.get(group_key, 0) + current_estimate_fn(item)
        labels[group_key] = label

    rows = [{"bankAccountName": labels[key], "total": total} for key, total in totals.items()]
    return sorted(rows, key=lambda r: r["bankAccountName"])


def _submit(user_id, body):
    posted = []

    for adj in body.get("recurringAdjustments", []):
        posted.append(_post_recurring_occurrence(user_id, adj))

    for extra in body.get("additionalTransactions", []):
        posted.append(_post_additional_transaction(user_id, extra))

    # TODO: trigger budget threshold notifications per affected category,
    # same as the daily recurring processor and manual expense entry do.

    notification_results = [
        _send_peer_notification(user_id, n) for n in body.get("peerNotifications", [])
    ]

    _save_payday_history(user_id, posted)

    return _response(
        201,
        {"posted": posted, "peerNotifications": notification_results},
        default=_decimal_default,
    )


def _save_payday_history(user_id, posted):
    """A snapshot for browsing past paydays - deliberately disposable
    (TTL'd after 1.5 years), unlike the real transactions it corresponds
    to, which are kept indefinitely and remain the actual source of
    truth. Best-effort: a failure here should never block the real
    submit, which has already happened by this point."""
    try:
        today = date.today().isoformat()
        expires_at = int((datetime.now(timezone.utc) + timedelta(days=548)).timestamp())
        payday_history_table.put_item(Item={
            "userId": user_id,
            "paydayDate": today,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
            "posted": posted,
            "expiresAt": expires_at,
        })
    except Exception:
        pass


def _send_peer_notification(sender_id, entry):
    recipient_id = entry.get("recipientUserId")
    amount = entry.get("amount")
    due_date = entry.get("dueDate")
    message = (entry.get("message") or "").strip()[:500]

    if not recipient_id or amount is None or not due_date or not message:
        return {"recipientUserId": recipient_id, "status": "error", "error": "recipientUserId, amount, dueDate, and message are all required"}

    agreement = peer_agreements_table.get_item(
        Key={"recipientUserId": recipient_id, "senderUserId": sender_id}
    ).get("Item")
    if not agreement or agreement.get("status") != "accepted":
        return {
            "recipientUserId": recipient_id,
            "status": "error",
            "error": "no accepted fund-movement agreement with this person - invite them first",
        }

    notification_id = str(uuid.uuid4())
    peer_notifications_table.put_item(
        Item={
            "recipientUserId": recipient_id,
            "sk": f"{due_date}#{notification_id}",
            "notificationId": notification_id,
            "senderUserId": sender_id,
            "amount": decimal.Decimal(str(amount)),
            "dueDate": due_date,
            "message": message,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "source": "payday-wizard",
        }
    )
    _send_notification_email(sender_id, recipient_id, amount, due_date, message)
    return {"recipientUserId": recipient_id, "status": "sent", "notificationId": notification_id}


def _send_notification_email(sender_id, recipient_id, amount, due_date, message):
    """Best-effort - the in-app notification record above is the actual
    source of truth; a failed email should never block that."""
    try:
        recipient_email = lookup_email_by_sub(recipient_id)
        sender_email = lookup_email_by_sub(sender_id)
        if not recipient_email:
            return
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


def _post_recurring_occurrence(user_id, adj):
    account_id = adj["accountId"]
    recurring_id = adj["recurringId"]

    template = recurring_table.get_item(Key={"accountId": account_id, "recurringId": recurring_id}).get("Item")
    if not template:
        return {"recurringId": recurring_id, "status": "error", "error": "template not found"}

    occurrence_date = template["nextDueDate"]
    is_income = template.get("isIncome", False)
    amount = decimal.Decimal(str(adj["amount"])) if "amount" in adj else decimal.Decimal(str(template["estimatedAmount"]))

    txn_id = str(uuid.uuid4())
    txn_item = {
        "accountId": account_id,
        "sk": f"{occurrence_date}#{txn_id}",
        "txnId": txn_id,
        "userId": user_id,
        "amount": amount,  # NET - what actually posts to the balance
        "category": template.get("category", "Uncategorized"),
        "description": template.get("description", ""),
        "direction": "credit" if is_income else "debit",
        "createdAt": occurrence_date,
        "source": "recurring-payday-wizard",
        "recurringId": recurring_id,
        "wasOverridden": "amount" in adj,
    }
    if is_income and template.get("grossAmount") is not None:
        txn_item["grossAmount"] = decimal.Decimal(str(template["grossAmount"]))
    if not is_income and template.get("externalBankAccountId"):
        txn_item["externalBankAccountId"] = template["externalBankAccountId"]

    transactions_table.put_item(Item=txn_item)

    balance_delta = amount if is_income else -amount
    accounts_table.update_item(
        Key={"userId": user_id, "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": balance_delta},
    )

    next_due = next_date_after(template, occurrence_date)
    remaining_overrides = {
        k: v for k, v in (template.get("occurrenceOverrides") or {}).items() if k != occurrence_date
    }
    recurring_table.update_item(
        Key={"accountId": account_id, "recurringId": recurring_id},
        UpdateExpression="SET nextDueDate = :next, lastProcessedDate = :today, occurrenceOverrides = :overrides",
        ExpressionAttributeValues={
            ":next": next_due,
            ":today": date.today().isoformat(),
            ":overrides": remaining_overrides,
        },
    )

    return {
        "recurringId": recurring_id,
        "status": "posted",
        "amount": float(amount),
        "nextDueDate": next_due,
        "description": template.get("description", ""),
        "category": template.get("category", "Uncategorized"),
        "isIncome": is_income,
    }


def _post_additional_transaction(user_id, extra):
    account_id = extra["accountId"]
    amount = decimal.Decimal(str(extra["amount"]))
    direction = extra.get("direction", "debit")
    ts = datetime.now(timezone.utc).isoformat()
    txn_id = str(uuid.uuid4())

    transactions_table.put_item(
        Item={
            "accountId": account_id,
            "sk": f"{ts}#{txn_id}",
            "txnId": txn_id,
            "userId": user_id,
            "amount": amount,
            "category": extra.get("category", "Uncategorized"),
            "description": (extra.get("description") or "")[:250],
            "direction": direction,
            "createdAt": ts,
            "source": "payday-wizard-unpredicted",
        }
    )

    delta = amount if direction == "credit" else -amount
    accounts_table.update_item(
        Key={"userId": user_id, "accountId": account_id},
        UpdateExpression="ADD balance :delta",
        ExpressionAttributeValues={":delta": delta},
    )

    return {
        "accountId": account_id,
        "status": "posted",
        "amount": float(amount),
        "direction": direction,
        "description": (extra.get("description") or "")[:250],
        "category": extra.get("category", "Uncategorized"),
    }


