import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { EnvironmentConfig } from "../../config/environments";

/**
 * All DynamoDB tables for the finance app, one set per environment.
 *
 * Design notes (matching what we discussed):
 * - Accounts:      PK userId (Cognito sub)  SK accountId
 * - Transactions:  PK accountId             SK timestamp#txnId
 *                  GSI1: userId + category  -> lets budget logic aggregate
 *                  spending for a category across ALL of a user's accounts,
 *                  not just one.
 * - Budgets:       PK userId                SK category#startDate
 * - Recurring:     PK accountId             SK recurringId (transaction & income templates)
 * - AuditLog:      PK transactionId         SK timestamp (edit/delete history)
 * - Sharing:       PK ownerUserId           SK invitedUserId (pending/accepted, permission level)
 * - PlannedExpenses: PK userId              SK plannedExpenseId (annual/future savings targets)
 * - ExternalBankAccounts: PK userId         SK externalBankAccountId (user-maintained list of
 *                                             real bank accounts outside the app, for labeling
 *                                             recurring expenses and aggregating by source account)
 * - Scenarios:       PK userId              SK scenarioId (saved what-if adjustments, applied
 *                                             against live data at calculation time)
 * - PeerAgreements:  PK recipientUserId     SK senderUserId (mutual consent to send/receive
 *                                             fund-movement notifications)
 * - PeerNotifications: PK recipientUserId   SK dueDate#notificationId (fund-movement alerts)
 * - Subscriptions:   PK userId              (single item per user, same shape as UserPreferences)
 *                    GSI byStripeCustomerId -> reverse lookup for Stripe webhook events, which
 *                    carry a Stripe customer/subscription id, not our userId
 */
export class DataTables extends Construct {
  public readonly accountsTable: dynamodb.Table;
  public readonly transactionsTable: dynamodb.Table;
  public readonly budgetsTable: dynamodb.Table;
  public readonly recurringTable: dynamodb.Table;
  public readonly divisionsTable: dynamodb.Table;
  public readonly auditLogTable: dynamodb.Table;
  public readonly sharingTable: dynamodb.Table;
  public readonly plannedExpensesTable: dynamodb.Table;
  public readonly externalBankAccountsTable: dynamodb.Table;
  public readonly scenariosTable: dynamodb.Table;
  public readonly peerAgreementsTable: dynamodb.Table;
  public readonly peerNotificationsTable: dynamodb.Table;
  public readonly userPreferencesTable: dynamodb.Table;
  public readonly paydayHistoryTable: dynamodb.Table;
  public readonly subscriptionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, cfg: EnvironmentConfig) {
    super(scope, id);

    const removalPolicy = cfg.retainDataOnDestroy
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const billing = dynamodb.BillingMode.PAY_PER_REQUEST; // no capacity planning needed at this scale

    this.accountsTable = new dynamodb.Table(this, "AccountsTable", {
      tableName: `${cfg.resourcePrefix}-accounts`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: cfg.envName === "prod" },
    });

    this.transactionsTable = new dynamodb.Table(this, "TransactionsTable", {
      tableName: `${cfg.resourcePrefix}-transactions`,
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING }, // "timestamp#txnId"
      billingMode: billing,
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: cfg.envName === "prod" },
    });

    // Cross-account category aggregation for budget tracking
    this.transactionsTable.addGlobalSecondaryIndex({
      indexName: "byUserAndCategory",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "category", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Direct O(1) lookup of a single transaction by its txnId (used by
    // edit/delete), instead of scanning an account's full transaction
    // history and filtering in Lambda.
    this.transactionsTable.addGlobalSecondaryIndex({
      indexName: "byTxnId",
      partitionKey: { name: "txnId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Sparse index: oneTimeCreditUserId is only set on manual one-time
    // credits (bonuses/gifts) the user has NOT excluded from aggregation -
    // items with the "don't include" checkbox checked simply never appear
    // here, so projections can query this index directly instead of
    // filtering by category or a boolean flag on every read.
    this.transactionsTable.addGlobalSecondaryIndex({
      indexName: "byOneTimeCreditIncluded",
      partitionKey: { name: "oneTimeCreditUserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.budgetsTable = new dynamodb.Table(this, "BudgetsTable", {
      tableName: `${cfg.resourcePrefix}-budgets`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING }, // "category#startDate"
      billingMode: billing,
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: cfg.envName === "prod" },
    });

    this.recurringTable = new dynamodb.Table(this, "RecurringTable", {
      tableName: `${cfg.resourcePrefix}-recurring`,
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "recurringId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // A division is a named sub-allocation within one account's balance
    // (e.g. "Vacation fund: $200" inside a "Personal Spending" account) -
    // scoped per-account, same key shape as RecurringTable, since a
    // division never makes sense outside the account it belongs to.
    this.divisionsTable = new dynamodb.Table(this, "DivisionsTable", {
      tableName: `${cfg.resourcePrefix}-divisions`,
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "divisionId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // Lets the daily processor find every active template across all users/
    // accounts without scanning the whole table. "active" is the literal
    // string "true" so items get excluded from the index entirely once
    // paused (sparse index), keeping it cheap to query. Only the SYSTEM
    // (scheduled processor) job should use this - it's intentionally global.
    this.recurringTable.addGlobalSecondaryIndex({
      indexName: "byActiveStatus",
      partitionKey: { name: "activeFlag", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "nextDueDate", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // User-facing queries (e.g. the payday wizard) must use THIS index
    // instead - partitioned by userId so a query can only ever return that
    // one user's own templates, never another user's data, regardless of
    // what application code does or doesn't filter afterward.
    this.recurringTable.addGlobalSecondaryIndex({
      indexName: "byUserAndNextDue",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "nextDueDate", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.auditLogTable = new dynamodb.Table(this, "AuditLogTable", {
      tableName: `${cfg.resourcePrefix}-audit-log`,
      partitionKey: { name: "transactionId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    this.sharingTable = new dynamodb.Table(this, "SharingTable", {
      // Renamed (v2) after the shareKey schema change - CloudFormation
      // categorically refuses to replace a custom-named resource during
      // an UPDATE, regardless of whether the old physical table still
      // exists. Renaming makes this a create-new + delete-old instead,
      // which is allowed. No need to rename back - this name is never
      // user-facing.
      tableName: `${cfg.resourcePrefix}-sharing-v2`,
      partitionKey: { name: "ownerUserId", type: dynamodb.AttributeType.STRING },
      // Previously the sort key was invitedUserId alone, meaning at most
      // ONE share could ever exist between a given owner and invited
      // user - sharing a second account with the same person silently
      // overwrote (and destroyed) the first share via put_item, with no
      // warning. shareKey = "{invitedUserId}#{accountId}" so each
      // (owner, invited user, account) combination gets its own row.
      sortKey: { name: "shareKey", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // The base table only supports "shares I own" lookups (query by
    // ownerUserId). This GSI supports the other direction - "shares
    // directed at me" - needed so an invited user's own views (e.g. the
    // payday wizard) can find what's been shared with them without a scan.
    this.sharingTable.addGlobalSecondaryIndex({
      indexName: "byInvitedUser",
      partitionKey: { name: "invitedUserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // PlannedExpenses: known future/annual costs (birthdays, anniversaries,
    // insurance premiums, etc.) that the user wants to save toward ahead of
    // time, distinct from Recurring (which auto-posts a transaction) and
    // Budgets (which caps ongoing category spend).
    this.plannedExpensesTable = new dynamodb.Table(this, "PlannedExpensesTable", {
      tableName: `${cfg.resourcePrefix}-planned-expenses`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "plannedExpenseId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // ExternalBankAccounts: a small user-maintained list of REAL bank
    // accounts that live outside the app entirely (e.g. a joint account
    // not otherwise tracked) - purely a label a recurring expense can be
    // tagged with, never linked to the app's own Accounts table. Lets the
    // payday wizard aggregate "how much needs to come out of each real
    // account" without requiring every real account to be fully onboarded.
    this.externalBankAccountsTable = new dynamodb.Table(this, "ExternalBankAccountsTable", {
      tableName: `${cfg.resourcePrefix}-external-bank-accounts`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "externalBankAccountId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // Scenarios: saved "what-if" adjustments (income deltas, expense
    // deltas on existing recurring items, and brand-new hypothetical
    // expenses) that get layered on top of the user's REAL current data at
    // calculation time - never a frozen snapshot, so a saved scenario
    // always reflects today's actual budgets/income when recalculated.
    this.scenariosTable = new dynamodb.Table(this, "ScenariosTable", {
      tableName: `${cfg.resourcePrefix}-scenarios`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "scenarioId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // PeerAgreements: mutual consent between two users before one can send
    // the other fund-movement notifications. Directed by design - PK is
    // the RECIPIENT (who must accept), SK is the SENDER (who proposed it).
    // status: "pending" | "accepted" | revoked entries are deleted outright
    // rather than kept as a third status, since "a new agreement" after
    // revoking is just a fresh proposal, not a reactivation.
    this.peerAgreementsTable = new dynamodb.Table(this, "PeerAgreementsTable", {
      tableName: `${cfg.resourcePrefix}-peer-agreements`,
      partitionKey: { name: "recipientUserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "senderUserId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // Lets a sender find agreements addressed to THEM as sender (e.g. "who
    // have I proposed to / who has accepted me") without scanning, since
    // the base table is keyed by recipient first.
    this.peerAgreementsTable.addGlobalSecondaryIndex({
      indexName: "bySender",
      partitionKey: { name: "senderUserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "recipientUserId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // PeerNotifications: the actual fund-movement alerts. PK is the
    // recipient (the only party who lists these); sk sorts by due date so
    // the soonest-due / most-recently-overdue reminders are contiguous.
    this.peerNotificationsTable = new dynamodb.Table(this, "PeerNotificationsTable", {
      tableName: `${cfg.resourcePrefix}-peer-notifications`,
      partitionKey: { name: "recipientUserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING }, // "dueDate#notificationId"
      billingMode: billing,
      removalPolicy,
    });

    // UserPreferences: small per-user notification toggles (starting with
    // shared-account-activity alerts). Absent = defaults apply (transparency-
    // first: shared activity alerts default ON) - a row only exists once a
    // user has actually changed something from its default.
    this.userPreferencesTable = new dynamodb.Table(this, "UserPreferencesTable", {
      tableName: `${cfg.resourcePrefix}-user-preferences`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });

    // A snapshot of what was submitted each payday - deliberately
    // TTL'd (1.5 years, per user confirmation), unlike real transaction
    // data which is never auto-deleted. This is disposable history for
    // browsing past paydays, not a financial record of its own - the
    // real transactions it corresponds to are the source of truth and
    // are kept indefinitely regardless of this table's retention.
    this.paydayHistoryTable = new dynamodb.Table(this, "PaydayHistoryTable", {
      tableName: `${cfg.resourcePrefix}-payday-history`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "paydayDate", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
      billingMode: billing,
      removalPolicy,
    });

    // Subscriptions: one row per user, same absent-means-default shape as
    // UserPreferences (no row = free tier). GSI supports the reverse
    // lookup a Stripe webhook needs - subscription-updated/-deleted
    // events identify the customer/subscription by Stripe's own ids, not
    // our userId, so there's no way to find the right row by primary key
    // alone for those events (only checkout.session.completed carries our
    // userId directly, via client_reference_id).
    this.subscriptionsTable = new dynamodb.Table(this, "SubscriptionsTable", {
      tableName: `${cfg.resourcePrefix}-subscriptions`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: billing,
      removalPolicy,
    });
    this.subscriptionsTable.addGlobalSecondaryIndex({
      indexName: "byStripeCustomerId",
      partitionKey: { name: "stripeCustomerId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
