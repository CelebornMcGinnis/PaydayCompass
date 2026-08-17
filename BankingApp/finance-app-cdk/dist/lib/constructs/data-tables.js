"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataTables = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
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
 */
class DataTables extends constructs_1.Construct {
    constructor(scope, id, cfg) {
        super(scope, id);
        const removalPolicy = cfg.retainDataOnDestroy
            ? aws_cdk_lib_1.RemovalPolicy.RETAIN
            : aws_cdk_lib_1.RemovalPolicy.DESTROY;
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
            tableName: `${cfg.resourcePrefix}-sharing`,
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
    }
}
exports.DataTables = DataTables;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YS10YWJsZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvY29uc3RydWN0cy9kYXRhLXRhYmxlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBdUM7QUFDdkMsNkNBQTRDO0FBQzVDLHFEQUFxRDtBQUdyRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXNCRztBQUNILE1BQWEsVUFBVyxTQUFRLHNCQUFTO0lBY3ZDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsR0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLGFBQWEsR0FBRyxHQUFHLENBQUMsbUJBQW1CO1lBQzNDLENBQUMsQ0FBQywyQkFBYSxDQUFDLE1BQU07WUFDdEIsQ0FBQyxDQUFDLDJCQUFhLENBQUMsT0FBTyxDQUFDO1FBRTFCLE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZSxDQUFDLENBQUMsNENBQTRDO1FBRWxHLElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDN0QsU0FBUyxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsV0FBVztZQUMzQyxZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNyRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNuRSxXQUFXLEVBQUUsT0FBTztZQUNwQixhQUFhO1lBQ2IsZ0NBQWdDLEVBQUUsRUFBRSwwQkFBMEIsRUFBRSxHQUFHLENBQUMsT0FBTyxLQUFLLE1BQU0sRUFBRTtTQUN6RixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsaUJBQWlCLEdBQUcsSUFBSSxRQUFR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dGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgUmVtb3ZhbFBvbGljeSB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xuaW1wb3J0IHsgRW52aXJvbm1lbnRDb25maWcgfSBmcm9tIFwiLi4vLi4vY29uZmlnL2Vudmlyb25tZW50c1wiO1xuXG4vKipcbiAqIEFsbCBEeW5hbW9EQiB0YWJsZXMgZm9yIHRoZSBmaW5hbmNlIGFwcCwgb25lIHNldCBwZXIgZW52aXJvbm1lbnQuXG4gKlxuICogRGVzaWduIG5vdGVzIChtYXRjaGluZyB3aGF0IHdlIGRpc2N1c3NlZCk6XG4gKiAtIEFjY291bnRzOiAgICAgIFBLIHVzZXJJZCAoQ29nbml0byBzdWIpICBTSyBhY2NvdW50SWRcbiAqIC0gVHJhbnNhY3Rpb25zOiAgUEsgYWNjb3VudElkICAgICAgICAgICAgIFNLIHRpbWVzdGFtcCN0eG5JZFxuICogICAgICAgICAgICAgICAgICBHU0kxOiB1c2VySWQgKyBjYXRlZ29yeSAgLT4gbGV0cyBidWRnZXQgbG9naWMgYWdncmVnYXRlXG4gKiAgICAgICAgICAgICAgICAgIHNwZW5kaW5nIGZvciBhIGNhdGVnb3J5IGFjcm9zcyBBTEwgb2YgYSB1c2VyJ3MgYWNjb3VudHMsXG4gKiAgICAgICAgICAgICAgICAgIG5vdCBqdXN0IG9uZS5cbiAqIC0gQnVkZ2V0czogICAgICAgUEsgdXNlcklkICAgICAgICAgICAgICAgIFNLIGNhdGVnb3J5I3N0YXJ0RGF0ZVxuICogLSBSZWN1cnJpbmc6ICAgICBQSyBhY2NvdW50SWQgICAgICAgICAgICAgU0sgcmVjdXJyaW5nSWQgKHRyYW5zYWN0aW9uICYgaW5jb21lIHRlbXBsYXRlcylcbiAqIC0gQXVkaXRMb2c6ICAgICAgUEsgdHJhbnNhY3Rpb25JZCAgICAgICAgIFNLIHRpbWVzdGFtcCAoZWRpdC9kZWxldGUgaGlzdG9yeSlcbiAqIC0gU2hhcmluZzogICAgICAgUEsgb3duZXJVc2VySWQgICAgICAgICAgIFNLIGludml0ZWRVc2VySWQgKHBlbmRpbmcvYWNjZXB0ZWQsIHBlcm1pc3Npb24gbGV2ZWwpXG4gKiAtIFBsYW5uZWRFeHBlbnNlczogUEsgdXNlcklkICAgICAgICAgICAgICBTSyBwbGFubmVkRXhwZW5zZUlkIChhbm51YWwvZnV0dXJlIHNhdmluZ3MgdGFyZ2V0cylcbiAqIC0gRXh0ZXJuYWxCYW5rQWNjb3VudHM6IFBLIHVzZXJJZCAgICAgICAgIFNLIGV4dGVybmFsQmFua0FjY291bnRJZCAodXNlci1tYWludGFpbmVkIGxpc3Qgb2ZcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVhbCBiYW5rIGFjY291bnRzIG91dHNpZGUgdGhlIGFwcCwgZm9yIGxhYmVsaW5nXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlY3VycmluZyBleHBlbnNlcyBhbmQgYWdncmVnYXRpbmcgYnkgc291cmNlIGFjY291bnQpXG4gKiAtIFNjZW5hcmlvczogICAgICAgUEsgdXNlcklkICAgICAgICAgICAgICBTSyBzY2VuYXJpb0lkIChzYXZlZCB3aGF0LWlmIGFkanVzdG1lbnRzLCBhcHBsaWVkXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFnYWluc3QgbGl2ZSBkYXRhIGF0IGNhbGN1bGF0aW9uIHRpbWUpXG4gKiAtIFBlZXJBZ3JlZW1lbnRzOiAgUEsgcmVjaXBpZW50VXNlcklkICAgICBTSyBzZW5kZXJVc2VySWQgKG11dHVhbCBjb25zZW50IHRvIHNlbmQvcmVjZWl2ZVxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmdW5kLW1vdmVtZW50IG5vdGlmaWNhdGlvbnMpXG4gKiAtIFBlZXJOb3RpZmljYXRpb25zOiBQSyByZWNpcGllbnRVc2VySWQgICBTSyBkdWVEYXRlI25vdGlmaWNhdGlvbklkIChmdW5kLW1vdmVtZW50IGFsZXJ0cylcbiAqL1xuZXhwb3J0IGNsYXNzIERhdGFUYWJsZXMgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgYWNjb3VudHNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSB0cmFuc2FjdGlvbnNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBidWRnZXRzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgcmVjdXJyaW5nVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgYXVkaXRMb2dUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBzaGFyaW5nVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgcGxhbm5lZEV4cGVuc2VzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgZXh0ZXJuYWxCYW5rQWNjb3VudHNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBzY2VuYXJpb3NUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBwZWVyQWdyZWVtZW50c1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IHBlZXJOb3RpZmljYXRpb25zVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclByZWZlcmVuY2VzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGNmZzogRW52aXJvbm1lbnRDb25maWcpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgcmVtb3ZhbFBvbGljeSA9IGNmZy5yZXRhaW5EYXRhT25EZXN0cm95XG4gICAgICA/IFJlbW92YWxQb2xpY3kuUkVUQUlOXG4gICAgICA6IFJlbW92YWxQb2xpY3kuREVTVFJPWTtcblxuICAgIGNvbnN0IGJpbGxpbmcgPSBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1Q7IC8vIG5vIGNhcGFjaXR5IHBsYW5uaW5nIG5lZWRlZCBhdCB0aGlzIHNjYWxlXG5cbiAgICB0aGlzLmFjY291bnRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJBY2NvdW50c1RhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS1hY2NvdW50c2AsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJ1c2VySWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJhY2NvdW50SWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBiaWxsaW5nLFxuICAgICAgcmVtb3ZhbFBvbGljeSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlTcGVjaWZpY2F0aW9uOiB7IHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiBjZmcuZW52TmFtZSA9PT0gXCJwcm9kXCIgfSxcbiAgICB9KTtcblxuICAgIHRoaXMudHJhbnNhY3Rpb25zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJUcmFuc2FjdGlvbnNUYWJsZVwiLCB7XG4gICAgICB0YWJsZU5hbWU6IGAke2NmZy5yZXNvdXJjZVByZWZpeH0tdHJhbnNhY3Rpb25zYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImFjY291bnRJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiBcInNrXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sIC8vIFwidGltZXN0YW1wI3R4bklkXCJcbiAgICAgIGJpbGxpbmdNb2RlOiBiaWxsaW5nLFxuICAgICAgcmVtb3ZhbFBvbGljeSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlTcGVjaWZpY2F0aW9uOiB7IHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiBjZmcuZW52TmFtZSA9PT0gXCJwcm9kXCIgfSxcbiAgICB9KTtcblxuICAgIC8vIENyb3NzLWFjY291bnQgY2F0ZWdvcnkgYWdncmVnYXRpb24gZm9yIGJ1ZGdldCB0cmFja2luZ1xuICAgIHRoaXMudHJhbnNhY3Rpb25zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcImJ5VXNlckFuZENhdGVnb3J5XCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJ1c2VySWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJjYXRlZ29yeVwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIERpcmVjdCBPKDEpIGxvb2t1cCBvZiBhIHNpbmdsZSB0cmFuc2FjdGlvbiBieSBpdHMgdHhuSWQgKHVzZWQgYnlcbiAgICAvLyBlZGl0L2RlbGV0ZSksIGluc3RlYWQgb2Ygc2Nhbm5pbmcgYW4gYWNjb3VudCdzIGZ1bGwgdHJhbnNhY3Rpb25cbiAgICAvLyBoaXN0b3J5IGFuZCBmaWx0ZXJpbmcgaW4gTGFtYmRhLlxuICAgIHRoaXMudHJhbnNhY3Rpb25zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcImJ5VHhuSWRcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcInR4bklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gU3BhcnNlIGluZGV4OiBvbmVUaW1lQ3JlZGl0VXNlcklkIGlzIG9ubHkgc2V0IG9uIG1hbnVhbCBvbmUtdGltZVxuICAgIC8vIGNyZWRpdHMgKGJvbnVzZXMvZ2lmdHMpIHRoZSB1c2VyIGhhcyBOT1QgZXhjbHVkZWQgZnJvbSBhZ2dyZWdhdGlvbiAtXG4gICAgLy8gaXRlbXMgd2l0aCB0aGUgXCJkb24ndCBpbmNsdWRlXCIgY2hlY2tib3ggY2hlY2tlZCBzaW1wbHkgbmV2ZXIgYXBwZWFyXG4gICAgLy8gaGVyZSwgc28gcHJvamVjdGlvbnMgY2FuIHF1ZXJ5IHRoaXMgaW5kZXggZGlyZWN0bHkgaW5zdGVhZCBvZlxuICAgIC8vIGZpbHRlcmluZyBieSBjYXRlZ29yeSBvciBhIGJvb2xlYW4gZmxhZyBvbiBldmVyeSByZWFkLlxuICAgIHRoaXMudHJhbnNhY3Rpb25zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBcImJ5T25lVGltZUNyZWRpdEluY2x1ZGVkXCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJvbmVUaW1lQ3JlZGl0VXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwiY3JlYXRlZEF0XCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgdGhpcy5idWRnZXRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJCdWRnZXRzVGFibGVcIiwge1xuICAgICAgdGFibGVOYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LWJ1ZGdldHNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwidXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwic2tcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gXCJjYXRlZ29yeSNzdGFydERhdGVcIlxuICAgICAgYmlsbGluZ01vZGU6IGJpbGxpbmcsXG4gICAgICByZW1vdmFsUG9saWN5LFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeVNwZWNpZmljYXRpb246IHsgcG9pbnRJblRpbWVSZWNvdmVyeUVuYWJsZWQ6IGNmZy5lbnZOYW1lID09PSBcInByb2RcIiB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZWN1cnJpbmdUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIlJlY3VycmluZ1RhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS1yZWN1cnJpbmdgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwiYWNjb3VudElkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwicmVjdXJyaW5nSWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBiaWxsaW5nLFxuICAgICAgcmVtb3ZhbFBvbGljeSxcbiAgICB9KTtcblxuICAgIC8vIExldHMgdGhlIGRhaWx5IHByb2Nlc3NvciBmaW5kIGV2ZXJ5IGFjdGl2ZSB0ZW1wbGF0ZSBhY3Jvc3MgYWxsIHVzZXJzL1xuICAgIC8vIGFjY291bnRzIHdpdGhvdXQgc2Nhbm5pbmcgdGhlIHdob2xlIHRhYmxlLiBcImFjdGl2ZVwiIGlzIHRoZSBsaXRlcmFsXG4gICAgLy8gc3RyaW5nIFwidHJ1ZVwiIHNvIGl0ZW1zIGdldCBleGNsdWRlZCBmcm9tIHRoZSBpbmRleCBlbnRpcmVseSBvbmNlXG4gICAgLy8gcGF1c2VkIChzcGFyc2UgaW5kZXgpLCBrZWVwaW5nIGl0IGNoZWFwIHRvIHF1ZXJ5LiBPbmx5IHRoZSBTWVNURU1cbiAgICAvLyAoc2NoZWR1bGVkIHByb2Nlc3Nvcikgam9iIHNob3VsZCB1c2UgdGhpcyAtIGl0J3MgaW50ZW50aW9uYWxseSBnbG9iYWwuXG4gICAgdGhpcy5yZWN1cnJpbmdUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6IFwiYnlBY3RpdmVTdGF0dXNcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcImFjdGl2ZUZsYWdcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJuZXh0RHVlRGF0ZVwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIFVzZXItZmFjaW5nIHF1ZXJpZXMgKGUuZy4gdGhlIHBheWRheSB3aXphcmQpIG11c3QgdXNlIFRISVMgaW5kZXhcbiAgICAvLyBpbnN0ZWFkIC0gcGFydGl0aW9uZWQgYnkgdXNlcklkIHNvIGEgcXVlcnkgY2FuIG9ubHkgZXZlciByZXR1cm4gdGhhdFxuICAgIC8vIG9uZSB1c2VyJ3Mgb3duIHRlbXBsYXRlcywgbmV2ZXIgYW5vdGhlciB1c2VyJ3MgZGF0YSwgcmVnYXJkbGVzcyBvZlxuICAgIC8vIHdoYXQgYXBwbGljYXRpb24gY29kZSBkb2VzIG9yIGRvZXNuJ3QgZmlsdGVyIGFmdGVyd2FyZC5cbiAgICB0aGlzLnJlY3VycmluZ1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJieVVzZXJBbmROZXh0RHVlXCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJ1c2VySWRcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJuZXh0RHVlRGF0ZVwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIHRoaXMuYXVkaXRMb2dUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIkF1ZGl0TG9nVGFibGVcIiwge1xuICAgICAgdGFibGVOYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LWF1ZGl0LWxvZ2AsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJ0cmFuc2FjdGlvbklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwidGltZXN0YW1wXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogYmlsbGluZyxcbiAgICAgIHJlbW92YWxQb2xpY3ksXG4gICAgfSk7XG5cbiAgICB0aGlzLnNoYXJpbmdUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIlNoYXJpbmdUYWJsZVwiLCB7XG4gICAgICB0YWJsZU5hbWU6IGAke2NmZy5yZXNvdXJjZVByZWZpeH0tc2hhcmluZ2AsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJvd25lclVzZXJJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgLy8gUHJldmlvdXNseSB0aGUgc29ydCBrZXkgd2FzIGludml0ZWRVc2VySWQgYWxvbmUsIG1lYW5pbmcgYXQgbW9zdFxuICAgICAgLy8gT05FIHNoYXJlIGNvdWxkIGV2ZXIgZXhpc3QgYmV0d2VlbiBhIGdpdmVuIG93bmVyIGFuZCBpbnZpdGVkXG4gICAgICAvLyB1c2VyIC0gc2hhcmluZyBhIHNlY29uZCBhY2NvdW50IHdpdGggdGhlIHNhbWUgcGVyc29uIHNpbGVudGx5XG4gICAgICAvLyBvdmVyd3JvdGUgKGFuZCBkZXN0cm95ZWQpIHRoZSBmaXJzdCBzaGFyZSB2aWEgcHV0X2l0ZW0sIHdpdGggbm9cbiAgICAgIC8vIHdhcm5pbmcuIHNoYXJlS2V5ID0gXCJ7aW52aXRlZFVzZXJJZH0je2FjY291bnRJZH1cIiBzbyBlYWNoXG4gICAgICAvLyAob3duZXIsIGludml0ZWQgdXNlciwgYWNjb3VudCkgY29tYmluYXRpb24gZ2V0cyBpdHMgb3duIHJvdy5cbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogXCJzaGFyZUtleVwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGJpbGxpbmcsXG4gICAgICByZW1vdmFsUG9saWN5LFxuICAgIH0pO1xuXG4gICAgLy8gVGhlIGJhc2UgdGFibGUgb25seSBzdXBwb3J0cyBcInNoYXJlcyBJIG93blwiIGxvb2t1cHMgKHF1ZXJ5IGJ5XG4gICAgLy8gb3duZXJVc2VySWQpLiBUaGlzIEdTSSBzdXBwb3J0cyB0aGUgb3RoZXIgZGlyZWN0aW9uIC0gXCJzaGFyZXNcbiAgICAvLyBkaXJlY3RlZCBhdCBtZVwiIC0gbmVlZGVkIHNvIGFuIGludml0ZWQgdXNlcidzIG93biB2aWV3cyAoZS5nLiB0aGVcbiAgICAvLyBwYXlkYXkgd2l6YXJkKSBjYW4gZmluZCB3aGF0J3MgYmVlbiBzaGFyZWQgd2l0aCB0aGVtIHdpdGhvdXQgYSBzY2FuLlxuICAgIHRoaXMuc2hhcmluZ1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogXCJieUludml0ZWRVc2VyXCIsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogXCJpbnZpdGVkVXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwic3RhdHVzXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gUGxhbm5lZEV4cGVuc2VzOiBrbm93biBmdXR1cmUvYW5udWFsIGNvc3RzIChiaXJ0aGRheXMsIGFubml2ZXJzYXJpZXMsXG4gICAgLy8gaW5zdXJhbmNlIHByZW1pdW1zLCBldGMuKSB0aGF0IHRoZSB1c2VyIHdhbnRzIHRvIHNhdmUgdG93YXJkIGFoZWFkIG9mXG4gICAgLy8gdGltZSwgZGlzdGluY3QgZnJvbSBSZWN1cnJpbmcgKHdoaWNoIGF1dG8tcG9zdHMgYSB0cmFuc2FjdGlvbikgYW5kXG4gICAgLy8gQnVkZ2V0cyAod2hpY2ggY2FwcyBvbmdvaW5nIGNhdGVnb3J5IHNwZW5kKS5cbiAgICB0aGlzLnBsYW5uZWRFeHBlbnNlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiUGxhbm5lZEV4cGVuc2VzVGFibGVcIiwge1xuICAgICAgdGFibGVOYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LXBsYW5uZWQtZXhwZW5zZXNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwidXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwicGxhbm5lZEV4cGVuc2VJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGJpbGxpbmcsXG4gICAgICByZW1vdmFsUG9saWN5LFxuICAgIH0pO1xuXG4gICAgLy8gRXh0ZXJuYWxCYW5rQWNjb3VudHM6IGEgc21hbGwgdXNlci1tYWludGFpbmVkIGxpc3Qgb2YgUkVBTCBiYW5rXG4gICAgLy8gYWNjb3VudHMgdGhhdCBsaXZlIG91dHNpZGUgdGhlIGFwcCBlbnRpcmVseSAoZS5nLiBhIGpvaW50IGFjY291bnRcbiAgICAvLyBub3Qgb3RoZXJ3aXNlIHRyYWNrZWQpIC0gcHVyZWx5IGEgbGFiZWwgYSByZWN1cnJpbmcgZXhwZW5zZSBjYW4gYmVcbiAgICAvLyB0YWdnZWQgd2l0aCwgbmV2ZXIgbGlua2VkIHRvIHRoZSBhcHAncyBvd24gQWNjb3VudHMgdGFibGUuIExldHMgdGhlXG4gICAgLy8gcGF5ZGF5IHdpemFyZCBhZ2dyZWdhdGUgXCJob3cgbXVjaCBuZWVkcyB0byBjb21lIG91dCBvZiBlYWNoIHJlYWxcbiAgICAvLyBhY2NvdW50XCIgd2l0aG91dCByZXF1aXJpbmcgZXZlcnkgcmVhbCBhY2NvdW50IHRvIGJlIGZ1bGx5IG9uYm9hcmRlZC5cbiAgICB0aGlzLmV4dGVybmFsQmFua0FjY291bnRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJFeHRlcm5hbEJhbmtBY2NvdW50c1RhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS1leHRlcm5hbC1iYW5rLWFjY291bnRzYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcInVzZXJJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiBcImV4dGVybmFsQmFua0FjY291bnRJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGJpbGxpbmcsXG4gICAgICByZW1vdmFsUG9saWN5LFxuICAgIH0pO1xuXG4gICAgLy8gU2NlbmFyaW9zOiBzYXZlZCBcIndoYXQtaWZcIiBhZGp1c3RtZW50cyAoaW5jb21lIGRlbHRhcywgZXhwZW5zZVxuICAgIC8vIGRlbHRhcyBvbiBleGlzdGluZyByZWN1cnJpbmcgaXRlbXMsIGFuZCBicmFuZC1uZXcgaHlwb3RoZXRpY2FsXG4gICAgLy8gZXhwZW5zZXMpIHRoYXQgZ2V0IGxheWVyZWQgb24gdG9wIG9mIHRoZSB1c2VyJ3MgUkVBTCBjdXJyZW50IGRhdGEgYXRcbiAgICAvLyBjYWxjdWxhdGlvbiB0aW1lIC0gbmV2ZXIgYSBmcm96ZW4gc25hcHNob3QsIHNvIGEgc2F2ZWQgc2NlbmFyaW9cbiAgICAvLyBhbHdheXMgcmVmbGVjdHMgdG9kYXkncyBhY3R1YWwgYnVkZ2V0cy9pbmNvbWUgd2hlbiByZWNhbGN1bGF0ZWQuXG4gICAgdGhpcy5zY2VuYXJpb3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCBcIlNjZW5hcmlvc1RhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS1zY2VuYXJpb3NgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwidXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwic2NlbmFyaW9JZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGJpbGxpbmcsXG4gICAgICByZW1vdmFsUG9saWN5LFxuICAgIH0pO1xuXG4gICAgLy8gUGVlckFncmVlbWVudHM6IG11dHVhbCBjb25zZW50IGJldHdlZW4gdHdvIHVzZXJzIGJlZm9yZSBvbmUgY2FuIHNlbmRcbiAgICAvLyB0aGUgb3RoZXIgZnVuZC1tb3ZlbWVudCBub3RpZmljYXRpb25zLiBEaXJlY3RlZCBieSBkZXNpZ24gLSBQSyBpc1xuICAgIC8vIHRoZSBSRUNJUElFTlQgKHdobyBtdXN0IGFjY2VwdCksIFNLIGlzIHRoZSBTRU5ERVIgKHdobyBwcm9wb3NlZCBpdCkuXG4gICAgLy8gc3RhdHVzOiBcInBlbmRpbmdcIiB8IFwiYWNjZXB0ZWRcIiB8IHJldm9rZWQgZW50cmllcyBhcmUgZGVsZXRlZCBvdXRyaWdodFxuICAgIC8vIHJhdGhlciB0aGFuIGtlcHQgYXMgYSB0aGlyZCBzdGF0dXMsIHNpbmNlIFwiYSBuZXcgYWdyZWVtZW50XCIgYWZ0ZXJcbiAgICAvLyByZXZva2luZyBpcyBqdXN0IGEgZnJlc2ggcHJvcG9zYWwsIG5vdCBhIHJlYWN0aXZhdGlvbi5cbiAgICB0aGlzLnBlZXJBZ3JlZW1lbnRzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJQZWVyQWdyZWVtZW50c1RhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS1wZWVyLWFncmVlbWVudHNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwicmVjaXBpZW50VXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwic2VuZGVyVXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogYmlsbGluZyxcbiAgICAgIHJlbW92YWxQb2xpY3ksXG4gICAgfSk7XG5cbiAgICAvLyBMZXRzIGEgc2VuZGVyIGZpbmQgYWdyZWVtZW50cyBhZGRyZXNzZWQgdG8gVEhFTSBhcyBzZW5kZXIgKGUuZy4gXCJ3aG9cbiAgICAvLyBoYXZlIEkgcHJvcG9zZWQgdG8gLyB3aG8gaGFzIGFjY2VwdGVkIG1lXCIpIHdpdGhvdXQgc2Nhbm5pbmcsIHNpbmNlXG4gICAgLy8gdGhlIGJhc2UgdGFibGUgaXMga2V5ZWQgYnkgcmVjaXBpZW50IGZpcnN0LlxuICAgIHRoaXMucGVlckFncmVlbWVudHNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6IFwiYnlTZW5kZXJcIixcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiBcInNlbmRlclVzZXJJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiBcInJlY2lwaWVudFVzZXJJZFwiLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIFBlZXJOb3RpZmljYXRpb25zOiB0aGUgYWN0dWFsIGZ1bmQtbW92ZW1lbnQgYWxlcnRzLiBQSyBpcyB0aGVcbiAgICAvLyByZWNpcGllbnQgKHRoZSBvbmx5IHBhcnR5IHdobyBsaXN0cyB0aGVzZSk7IHNrIHNvcnRzIGJ5IGR1ZSBkYXRlIHNvXG4gICAgLy8gdGhlIHNvb25lc3QtZHVlIC8gbW9zdC1yZWNlbnRseS1vdmVyZHVlIHJlbWluZGVycyBhcmUgY29udGlndW91cy5cbiAgICB0aGlzLnBlZXJOb3RpZmljYXRpb25zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgXCJQZWVyTm90aWZpY2F0aW9uc1RhYmxlXCIsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS1wZWVyLW5vdGlmaWNhdGlvbnNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwicmVjaXBpZW50VXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6IFwic2tcIiwgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSwgLy8gXCJkdWVEYXRlI25vdGlmaWNhdGlvbklkXCJcbiAgICAgIGJpbGxpbmdNb2RlOiBiaWxsaW5nLFxuICAgICAgcmVtb3ZhbFBvbGljeSxcbiAgICB9KTtcblxuICAgIC8vIFVzZXJQcmVmZXJlbmNlczogc21hbGwgcGVyLXVzZXIgbm90aWZpY2F0aW9uIHRvZ2dsZXMgKHN0YXJ0aW5nIHdpdGhcbiAgICAvLyBzaGFyZWQtYWNjb3VudC1hY3Rpdml0eSBhbGVydHMpLiBBYnNlbnQgPSBkZWZhdWx0cyBhcHBseSAodHJhbnNwYXJlbmN5LVxuICAgIC8vIGZpcnN0OiBzaGFyZWQgYWN0aXZpdHkgYWxlcnRzIGRlZmF1bHQgT04pIC0gYSByb3cgb25seSBleGlzdHMgb25jZSBhXG4gICAgLy8gdXNlciBoYXMgYWN0dWFsbHkgY2hhbmdlZCBzb21ldGhpbmcgZnJvbSBpdHMgZGVmYXVsdC5cbiAgICB0aGlzLnVzZXJQcmVmZXJlbmNlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsIFwiVXNlclByZWZlcmVuY2VzVGFibGVcIiwge1xuICAgICAgdGFibGVOYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LXVzZXItcHJlZmVyZW5jZXNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6IFwidXNlcklkXCIsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogYmlsbGluZyxcbiAgICAgIHJlbW92YWxQb2xpY3ksXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==