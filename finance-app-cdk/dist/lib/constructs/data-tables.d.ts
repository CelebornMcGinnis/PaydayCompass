import { Construct } from "constructs";
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
 */
export declare class DataTables extends Construct {
    readonly accountsTable: dynamodb.Table;
    readonly transactionsTable: dynamodb.Table;
    readonly budgetsTable: dynamodb.Table;
    readonly recurringTable: dynamodb.Table;
    readonly auditLogTable: dynamodb.Table;
    readonly sharingTable: dynamodb.Table;
    readonly plannedExpensesTable: dynamodb.Table;
    readonly externalBankAccountsTable: dynamodb.Table;
    readonly scenariosTable: dynamodb.Table;
    readonly peerAgreementsTable: dynamodb.Table;
    readonly peerNotificationsTable: dynamodb.Table;
    readonly userPreferencesTable: dynamodb.Table;
    constructor(scope: Construct, id: string, cfg: EnvironmentConfig);
}
