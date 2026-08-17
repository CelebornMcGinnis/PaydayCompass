"""
CSV Import/Export Lambda
Routes:
  GET  /csv/export-template            -> transaction import template (as before)
  POST /csv/import                     -> parses/validates/writes transactions from that template
  GET  /csv/recurring/export-template  -> recurring income/expense template, pre-filled
                                           with the user's accounts and external bank accounts
  POST /csv/recurring/import           -> parses/validates/creates recurring templates

Transaction template contract (as discussed):
  - Instruction block at the top explaining each field + telling the user to
    delete every row above the header row before uploading.
  - Columns: Date (optional, blank = import date), Amount (required, "$" and
    "," stripped before parsing), Account Name (required, must match an
    existing account exactly), Category (required, or defaults to
    "Uncategorized"), Description (optional, max 250 characters).

Recurring template contract:
  - Same instruction-block convention as the transaction template.
  - Columns: Type (Expense/Income, required), Description (required),
    Category (required for Expense, ignored for Income), Account Name
    (required, must match an existing account), Amount (required - NET
    amount for Income), Gross Amount (optional, Income only, reference-only),
    Frequency (required - weekly/biweekly/semimonthly/monthly/annual),
    Anchor Date (required for weekly/biweekly - any date on the cadence),
    Anchor Day(s) (required for semimonthly as "1,15" / monthly as a single
    day 1-28), Anchor Month (required for annual, 1-12; pairs with a single
    Anchor Day), Start Date (required - first/next due date), External Bank
    Account Name (optional, Expense only, must match an existing entry in
    the user's External Bank Accounts list), Notifications Enabled
    (optional, "yes"/"no", defaults to yes).
  Each valid row becomes one call into the same creation path as
  POST /accounts/{accountId}/recurring - so a CSV-imported template behaves
  identically to one created through the Manage Recurring screen.
"""
import os
import io
import csv
import re
import json
import uuid
import decimal
from collections import defaultdict
from datetime import date, datetime, timezone
import boto3
from finance_common.budget_notify import trigger_budget_check
from finance_common.http_response import response as _response

dynamodb = boto3.resource("dynamodb")
accounts_table = dynamodb.Table(os.environ["ACCOUNTS_TABLE"])
transactions_table = dynamodb.Table(os.environ["TRANSACTIONS_TABLE"])
recurring_table = dynamodb.Table(os.environ["RECURRING_TABLE"])
external_bank_accounts_table = dynamodb.Table(os.environ["EXTERNAL_BANK_ACCOUNTS_TABLE"])

FIELD_SPEC = [
    {"field": "Date", "required": False, "format": "YYYY-MM-DD (blank = import date)"},
    {"field": "Amount", "required": True, "format": 'Decimal; "$" and "," stripped automatically; negative = expense (debit), positive = income (credit)'},
    {"field": "Account Name", "required": True, "format": "Must exactly match an existing account name"},
    {"field": "Category", "required": True, "format": 'Must match an existing category, or "Uncategorized"'},
    {"field": "Description", "required": False, "format": "Free text, max 250 characters"},
]

RECURRING_FIELD_SPEC = [
    {"field": "Type", "required": True, "format": '"Expense" or "Income"'},
    {"field": "Description", "required": True, "format": "Free text, max 250 characters"},
    {"field": "Category", "required": "Expense only", "format": "Required for Expense rows; ignored for Income"},
    {"field": "Account Name", "required": True, "format": "Must exactly match an existing account name"},
    {"field": "Amount", "required": True, "format": 'Decimal; "$" and "," stripped automatically. NET amount for Income'},
    {"field": "Gross Amount", "required": False, "format": "Income only - pre-deduction pay, reference only"},
    {"field": "Frequency", "required": True, "format": "weekly / biweekly / semimonthly / monthly / annual"},
    {"field": "Anchor Date", "required": "weekly/biweekly only", "format": "YYYY-MM-DD - any date on the cadence"},
    {"field": "Anchor Day(s)", "required": "semimonthly/monthly only", "format": 'semimonthly: two days like "1,15" · monthly: one day, 1-28'},
    {"field": "Anchor Month", "required": "annual only", "format": "1-12, paired with a single Anchor Day(s) value"},
    {"field": "Start Date", "required": True, "format": "YYYY-MM-DD - first/next occurrence"},
    {"field": "External Bank Account Name", "required": False, "format": "Expense only; must match an entry in External Bank Accounts, or blank"},
    {"field": "Notifications Enabled", "required": False, "format": '"yes" or "no", defaults to yes'},
]

VALID_FREQUENCIES = {"weekly", "biweekly", "semimonthly", "monthly", "annual"}

AMOUNT_CLEAN_RE = re.compile(r"[$,]")


def handler(event, context):
    method = event["httpMethod"]
    resource = event["resource"]
    user_id = event["requestContext"]["authorizer"]["claims"]["sub"]

    if resource.endswith("recurring/export-template") and method == "GET":
        return _export_recurring_template(user_id)
    if resource.endswith("recurring/import") and method == "POST":
        return _import_recurring_csv(user_id, event)
    if resource.endswith("export-template") and method == "GET":
        return _export_template(user_id)
    if resource.endswith("import") and method == "POST":
        return _import_csv(user_id, event)

    return _response(405, {"error": "Method not allowed"})


def _export_template(user_id):
    accounts = accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    account_names = [a["name"] for a in accounts]

    buf = io.StringIO()
    buf.write("# IMPORT INSTRUCTIONS - delete this instructions block, including this\n")
    buf.write("# and every row above the header row, before uploading this file.\n")
    buf.write(f"# Your accounts: {', '.join(account_names) or '(none yet - create an account first)'}\n")
    for f in FIELD_SPEC:
        req = "required" if f["required"] else "optional"
        buf.write(f"# {f['field']} ({req}): {f['format']}\n")
    buf.write("#\n")

    writer = csv.writer(buf)
    writer.writerow([f["field"] for f in FIELD_SPEC])

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/csv",
            "Content-Disposition": "attachment; filename=finance-app-import-template.csv",
        },
        "body": buf.getvalue(),
    }


def _import_csv(user_id, event):
    body = event.get("body", "")
    reader = csv.DictReader(io.StringIO(body))

    valid_account_names = {
        a["name"]: a["accountId"]
        for a in accounts_table.query(
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        ).get("Items", [])
    }

    errors = []
    rows_to_write = []

    for i, row in enumerate(reader, start=2):  # row 1 is the header
        account_name = (row.get("Account Name") or "").strip()
        if account_name not in valid_account_names:
            errors.append(f"Row {i}: unknown account '{account_name}'")
            continue

        raw_amount = (row.get("Amount") or "").strip()
        cleaned_amount = AMOUNT_CLEAN_RE.sub("", raw_amount)
        try:
            signed_amount = decimal.Decimal(cleaned_amount)
        except decimal.InvalidOperation:
            errors.append(f"Row {i}: invalid amount '{raw_amount}'")
            continue
        if signed_amount == 0:
            errors.append(f"Row {i}: amount cannot be zero")
            continue

        row_date = (row.get("Date") or "").strip() or date.today().isoformat()
        description = (row.get("Description") or "")[:250]
        category = (row.get("Category") or "Uncategorized").strip()

        rows_to_write.append(
            {
                "accountId": valid_account_names[account_name],
                "signedAmount": signed_amount,  # negative = debit, positive = credit
                "date": row_date,
                "category": category,
                "description": description,
            }
        )

    if errors:
        return _response(400, {"errors": errors, "validRows": len(rows_to_write)})

    imported = _write_imported_rows(user_id, rows_to_write)
    _trigger_budget_checks_for_import(user_id, rows_to_write)

    return _response(200, {"imported": imported})


def _export_recurring_template(user_id):
    accounts = accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    account_names = [a["name"] for a in accounts]

    external_accounts = external_bank_accounts_table.query(
        KeyConditionExpression="userId = :uid",
        ExpressionAttributeValues={":uid": user_id},
    ).get("Items", [])
    external_names = [a["name"] for a in external_accounts]

    buf = io.StringIO()
    buf.write("# IMPORT INSTRUCTIONS - delete this instructions block, including this\n")
    buf.write("# and every row above the header row, before uploading this file.\n")
    buf.write(f"# Your accounts: {', '.join(account_names) or '(none yet - create an account first)'}\n")
    buf.write(f"# Your external bank accounts: {', '.join(external_names) or '(none set up)'}\n")
    for f in RECURRING_FIELD_SPEC:
        req = f["required"] if isinstance(f["required"], str) else ("required" if f["required"] else "optional")
        buf.write(f"# {f['field']} ({req}): {f['format']}\n")
    buf.write("#\n")

    writer = csv.writer(buf)
    writer.writerow([f["field"] for f in RECURRING_FIELD_SPEC])

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/csv",
            "Content-Disposition": "attachment; filename=finance-app-recurring-template.csv",
        },
        "body": buf.getvalue(),
    }


def _import_recurring_csv(user_id, event):
    body = event.get("body", "")
    reader = csv.DictReader(io.StringIO(body))

    valid_accounts = {
        a["name"]: a["accountId"]
        for a in accounts_table.query(
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        ).get("Items", [])
    }
    valid_external_accounts = {
        a["name"]: a["externalBankAccountId"]
        for a in external_bank_accounts_table.query(
            KeyConditionExpression="userId = :uid",
            ExpressionAttributeValues={":uid": user_id},
        ).get("Items", [])
    }

    errors = []
    templates_to_create = []

    for i, row in enumerate(reader, start=2):  # row 1 is the header
        row_type = (row.get("Type") or "").strip().lower()
        if row_type not in ("expense", "income"):
            errors.append(f"Row {i}: Type must be 'Expense' or 'Income', got '{row.get('Type')}'")
            continue
        is_income = row_type == "income"

        account_name = (row.get("Account Name") or "").strip()
        if account_name not in valid_accounts:
            errors.append(f"Row {i}: unknown account '{account_name}'")
            continue

        description = (row.get("Description") or "").strip()[:250]
        if not description:
            errors.append(f"Row {i}: Description is required")
            continue

        category = (row.get("Category") or "").strip()
        if not is_income and not category:
            category = "Uncategorized"

        raw_amount = (row.get("Amount") or "").strip()
        cleaned_amount = AMOUNT_CLEAN_RE.sub("", raw_amount)
        try:
            amount = decimal.Decimal(cleaned_amount)
        except decimal.InvalidOperation:
            errors.append(f"Row {i}: invalid Amount '{raw_amount}'")
            continue

        gross_amount = None
        if is_income:
            raw_gross = (row.get("Gross Amount") or "").strip()
            if raw_gross:
                try:
                    gross_amount = decimal.Decimal(AMOUNT_CLEAN_RE.sub("", raw_gross))
                except decimal.InvalidOperation:
                    errors.append(f"Row {i}: invalid Gross Amount '{raw_gross}'")
                    continue

        frequency = (row.get("Frequency") or "").strip().lower()
        if frequency not in VALID_FREQUENCIES:
            errors.append(f"Row {i}: Frequency must be one of {sorted(VALID_FREQUENCIES)}, got '{row.get('Frequency')}'")
            continue

        anchor_date, anchor_days, anchor_month, anchor_error = _parse_anchor_fields(row, frequency, i)
        if anchor_error:
            errors.append(anchor_error)
            continue

        start_date = (row.get("Start Date") or "").strip()
        if not start_date:
            errors.append(f"Row {i}: Start Date is required")
            continue

        external_bank_account_id = None
        if not is_income:
            external_name = (row.get("External Bank Account Name") or "").strip()
            if external_name:
                if external_name not in valid_external_accounts:
                    errors.append(f"Row {i}: unknown external bank account '{external_name}'")
                    continue
                external_bank_account_id = valid_external_accounts[external_name]

        notifications_raw = (row.get("Notifications Enabled") or "yes").strip().lower()
        notifications_enabled = notifications_raw not in ("no", "false", "0")

        templates_to_create.append(
            {
                "accountId": valid_accounts[account_name],
                "isIncome": is_income,
                "description": description,
                "category": category if not is_income else None,
                "estimatedAmount": amount,
                "grossAmount": gross_amount,
                "frequency": frequency,
                "anchorDate": anchor_date,
                "anchorDays": anchor_days,
                "anchorMonth": anchor_month,
                "anchorDay": anchor_days[0] if anchor_days and len(anchor_days) == 1 else None,
                "nextDueDate": start_date,
                "externalBankAccountId": external_bank_account_id,
                "notificationsEnabled": notifications_enabled,
            }
        )

    if errors:
        return _response(400, {"errors": errors, "validRows": len(templates_to_create)})

    created = _write_recurring_templates(user_id, templates_to_create)
    return _response(200, {"created": created})


def _parse_anchor_fields(row, frequency, row_num):
    """Returns (anchorDate, anchorDays, anchorMonth, errorString-or-None)."""
    if frequency in ("weekly", "biweekly"):
        anchor_date = (row.get("Anchor Date") or "").strip()
        if not anchor_date:
            return None, None, None, f"Row {row_num}: Anchor Date is required for {frequency}"
        return anchor_date, None, None, None

    if frequency == "semimonthly":
        raw_days = (row.get("Anchor Day(s)") or "").strip()
        try:
            days = sorted(int(d.strip()) for d in raw_days.split(",") if d.strip())
        except ValueError:
            days = []
        if len(days) != 2:
            return None, None, None, f"Row {row_num}: Anchor Day(s) must be two comma-separated days for semimonthly, got '{raw_days}'"
        return None, days, None, None

    if frequency == "monthly":
        raw_days = (row.get("Anchor Day(s)") or "").strip()
        try:
            day = int(raw_days)
        except ValueError:
            return None, None, None, f"Row {row_num}: Anchor Day(s) must be a single day 1-28 for monthly, got '{raw_days}'"
        if not (1 <= day <= 28):
            return None, None, None, f"Row {row_num}: Anchor Day(s) must be 1-28 for monthly, got {day}"
        return None, [day], None, None

    if frequency == "annual":
        raw_month = (row.get("Anchor Month") or "").strip()
        raw_days = (row.get("Anchor Day(s)") or "").strip()
        try:
            month = int(raw_month)
            day = int(raw_days)
        except ValueError:
            return None, None, None, f"Row {row_num}: Anchor Month and Anchor Day(s) must both be numbers for annual"
        if not (1 <= month <= 12) or not (1 <= day <= 28):
            return None, None, None, f"Row {row_num}: Anchor Month must be 1-12 and Anchor Day(s) 1-28 for annual"
        return None, [day], month, None

    return None, None, None, f"Row {row_num}: unhandled frequency '{frequency}'"


def _write_recurring_templates(user_id, templates):
    """Each row becomes exactly the same shape of item the Recurring
    Lambda's create endpoint would write - a CSV-imported recurring item is
    indistinguishable afterward from one created through the Manage
    Recurring screen."""
    created = 0
    for t in templates:
        recurring_id = str(uuid.uuid4())
        item = {
            "accountId": t["accountId"],
            "recurringId": recurring_id,
            "userId": user_id,
            "activeFlag": "true",
            "description": t["description"],
            "category": t["category"] or "Uncategorized",
            "estimatedAmount": t["estimatedAmount"],
            "frequency": t["frequency"],
            "anchorDate": t["anchorDate"],
            "anchorDays": t["anchorDays"],
            "anchorDay": t["anchorDay"],
            "anchorMonth": t["anchorMonth"],
            "nextDueDate": t["nextDueDate"],
            "lastProcessedDate": None,
            "isIncome": t["isIncome"],
            "isOneTimeCredit": False,
            "notificationsEnabled": t["notificationsEnabled"],
            "externalBankAccountId": t["externalBankAccountId"],
            "occurrenceOverrides": {},
        }
        if t["isIncome"] and t["grossAmount"] is not None:
            item["grossAmount"] = t["grossAmount"]
        recurring_table.put_item(Item=item)
        created += 1
    return created


def _write_imported_rows(user_id, rows):
    balance_deltas = defaultdict(decimal.Decimal)

    with transactions_table.batch_writer() as batch:
        for row in rows:
            account_id = row["accountId"]
            signed_amount = row["signedAmount"]
            txn_id = str(uuid.uuid4())

            batch.put_item(
                Item={
                    "accountId": account_id,
                    "sk": f"{row['date']}#{txn_id}",
                    "txnId": txn_id,
                    "userId": user_id,
                    "amount": abs(signed_amount),
                    "category": row["category"],
                    "description": row["description"],
                    "direction": "credit" if signed_amount > 0 else "debit",
                    "createdAt": row["date"],
                    "source": "csv-import",
                }
            )
            balance_deltas[account_id] += signed_amount

    for account_id, delta in balance_deltas.items():
        accounts_table.update_item(
            Key={"userId": user_id, "accountId": account_id},
            UpdateExpression="ADD balance :delta",
            ExpressionAttributeValues={":delta": delta},
        )

    return len(rows)


def _trigger_budget_checks_for_import(user_id, rows):
    """One notification check per distinct category across the whole
    import, not per row - a 40-row grocery statement shouldn't fire 40
    separate alerts for what's really one crossing. Only debit (expense)
    rows count toward budget spend; credit rows are skipped."""
    category_totals = {}
    representative_account = {}
    for row in rows:
        if row["signedAmount"] >= 0:
            continue  # income row, not expense - doesn't affect budget spend
        category = row["category"]
        category_totals[category] = category_totals.get(category, decimal.Decimal(0)) + abs(row["signedAmount"])
        representative_account[category] = row["accountId"]  # any one is fine - budgets aggregate cross-account anyway

    for category, total_delta in category_totals.items():
        trigger_budget_check(user_id, representative_account[category], category, total_delta)
