import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ses from "aws-cdk-lib/aws-ses";
import * as logs from "aws-cdk-lib/aws-logs";
import { EnvironmentConfig } from "../../config/environments";
import { DataTables } from "./data-tables";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Observability } from "./observability";
import { SharedLayer } from "./shared-layer";

interface LambdasProps {
  cfg: EnvironmentConfig;
  tables: DataTables;
  userPool: cognito.UserPool;
}

export class Lambdas extends Construct {
  public readonly accountsFn: lambda.Function;
  public readonly transactionsFn: lambda.Function;
  public readonly budgetsFn: lambda.Function;
  public readonly notificationsFn: lambda.Function;
  public readonly csvFn: lambda.Function;
  public readonly deletionFn: lambda.Function;
  public readonly sharingFn: lambda.Function;
  public readonly recurringFn: lambda.Function;
  public readonly divisionsFn: lambda.Function;
  public readonly recurringProcessorFn: lambda.Function;
  public readonly reconcileFn: lambda.Function;
  public readonly paydayFn: lambda.Function;
  public readonly plannedExpensesFn: lambda.Function;
  public readonly externalBankAccountsFn: lambda.Function;
  public readonly scenariosFn: lambda.Function;
  public readonly peerAgreementsFn: lambda.Function;
  public readonly peerNotificationsFn: lambda.Function;
  public readonly userPreferencesFn: lambda.Function;
  public readonly contactFn: lambda.Function;
  public readonly observability: Observability;
  public readonly sharedLayer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, props: LambdasProps) {
    super(scope, id);
    const { cfg, tables } = props;

    const commonEnv = {
      ENVIRONMENT: cfg.envName,
      ACCOUNTS_TABLE: tables.accountsTable.tableName,
      TRANSACTIONS_TABLE: tables.transactionsTable.tableName,
      BUDGETS_TABLE: tables.budgetsTable.tableName,
      RECURRING_TABLE: tables.recurringTable.tableName,
      DIVISIONS_TABLE: tables.divisionsTable.tableName,
      AUDIT_LOG_TABLE: tables.auditLogTable.tableName,
      SHARING_TABLE: tables.sharingTable.tableName,
      PLANNED_EXPENSES_TABLE: tables.plannedExpensesTable.tableName,
      PAYDAY_HISTORY_TABLE: tables.paydayHistoryTable.tableName,
      EXTERNAL_BANK_ACCOUNTS_TABLE: tables.externalBankAccountsTable.tableName,
      SCENARIOS_TABLE: tables.scenariosTable.tableName,
      PEER_AGREEMENTS_TABLE: tables.peerAgreementsTable.tableName,
      PEER_NOTIFICATIONS_TABLE: tables.peerNotificationsTable.tableName,
      USER_PREFERENCES_TABLE: tables.userPreferencesTable.tableName,
      USER_POOL_ID: props.userPool.userPoolId,
      SES_FROM_ADDRESS: cfg.sesFromAddress,
    };

    const sharedLayer = new SharedLayer(this, "SharedLayer", cfg);
    this.sharedLayer = sharedLayer.layer;

    // logRetention (a Lambda function prop) is deprecated in favor of
    // creating the LogGroup explicitly and passing it as `logGroup` -
    // functionally identical, just the currently-recommended CDK API.
    const logRetentionDays = cfg.envName === "prod" ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.TWO_WEEKS;

    const baseFnProps = (name: string, codePath: string, description: string, useSharedLayer = false) => {
      const functionName = `${cfg.resourcePrefix}-${name}`;
      const logGroup = new logs.LogGroup(this, `${name}-LogGroup`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logRetentionDays,
        removalPolicy: cfg.retainDataOnDestroy ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      });
      return new lambda.Function(this, name, {
        functionName,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.handler",
        code: lambda.Code.fromAsset(codePath),
        timeout: Duration.seconds(15),
        memorySize: 256,
        environment: commonEnv,
        description,
        logGroup,
        layers: useSharedLayer ? [sharedLayer.layer] : undefined,
      });
    };

    // --- Accounts: CRUD accounts/balances, sharing invites live in a separate fn ---
    this.accountsFn = baseFnProps(
      "accounts-fn",
      "lambda/accounts",
      "Create/edit/remove accounts and balances",
      true
    );
    tables.accountsTable.grantReadWriteData(this.accountsFn);
    tables.sharingTable.grantReadData(this.accountsFn); // merge in accounts shared with the caller
    tables.recurringTable.grantReadData(this.accountsFn); // block deleting an account that still has recurring templates tied to it
    tables.budgetsTable.grantReadWriteData(this.accountsFn); // clear a stale accountId reference when its destination account is deleted
    tables.plannedExpensesTable.grantReadWriteData(this.accountsFn); // same, for linkedAccountId

    // --- Transactions: add/split expense, debit/credit, recurring templates ---
    this.transactionsFn = baseFnProps(
      "transactions-fn",
      "lambda/transactions",
      "Add/split expenses, transfers, recurring transaction processing",
      true
    );
    tables.transactionsTable.grantReadWriteData(this.transactionsFn);
    tables.accountsTable.grantReadWriteData(this.transactionsFn); // balance updates
    tables.recurringTable.grantReadWriteData(this.transactionsFn);
    tables.auditLogTable.grantWriteData(this.transactionsFn);
    tables.budgetsTable.grantReadData(this.transactionsFn); // for budget-threshold checks after add/CSV-import
    tables.sharingTable.grantReadData(this.transactionsFn); // resolve_account_access - shared-account authorization
    tables.userPreferencesTable.grantReadData(this.transactionsFn); // shared-activity alert opt-out check
    tables.divisionsTable.grantReadWriteData(this.transactionsFn); // adjust a division's balance when a manual expense/transfer is tagged with one
    this.transactionsFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress)); // shared-activity alert email

    // --- Budgets/Projections: % to budget, trends, net worth, income-based projections ---
    this.budgetsFn = baseFnProps(
      "budgets-fn",
      "lambda/budgets",
      "Budget tracking, projections, net worth, savings goals",
      true
    );
    tables.budgetsTable.grantReadWriteData(this.budgetsFn);
    tables.transactionsTable.grantReadData(this.budgetsFn); // incl. GSI for cross-account aggregation
    tables.accountsTable.grantReadData(this.budgetsFn);
    tables.recurringTable.grantReadData(this.budgetsFn); // income schedule for projections
    tables.plannedExpensesTable.grantReadData(this.budgetsFn); // annual/future expense contributions

    // --- Notifications: threshold checks -> SES ---
    this.notificationsFn = baseFnProps(
      "notifications-fn",
      "lambda/notifications",
      "Checks 80%/100%/repeat-over-budget and low-balance thresholds, sends SES alerts"
    );
    tables.budgetsTable.grantReadData(this.notificationsFn);
    tables.transactionsTable.grantReadData(this.notificationsFn);
    tables.accountsTable.grantReadData(this.notificationsFn);
    this.notificationsFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress));

    // --- Contact: public form -> SES to the site owner ---
    if (!cfg.alertEmail) {
      throw new Error("cfg.alertEmail must be set to deploy the contact form - it's the destination address for every message sent through it.");
    }
    this.contactFn = baseFnProps(
      "contact-fn",
      "lambda/contact",
      "Public contact form - emails the site owner via SES, no auth required"
    );
    this.contactFn.addEnvironment("CONTACT_TO_ADDRESS", cfg.alertEmail);
    this.contactFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress));

    // transactionsFn was created before notificationsFn existed, so its
    // NOTIFICATIONS_FN_NAME env var and invoke grant are added here instead
    // of at creation time.
    this.transactionsFn.addEnvironment("NOTIFICATIONS_FN_NAME", this.notificationsFn.functionName);
    this.notificationsFn.grantInvoke(this.transactionsFn);
    this.transactionsFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn));

    // --- CSV import/export ---
    this.csvFn = baseFnProps(
      "csv-fn",
      "lambda/csv_import_export",
      "Generates the export template and parses/validates imported CSVs",
      true
    );
    tables.accountsTable.grantReadWriteData(this.csvFn);
    tables.transactionsTable.grantReadWriteData(this.csvFn);
    tables.budgetsTable.grantReadData(this.csvFn); // for budget-threshold checks after import
    tables.recurringTable.grantReadWriteData(this.csvFn); // recurring template import
    tables.externalBankAccountsTable.grantReadData(this.csvFn); // resolve external account names on import
    this.csvFn.addEnvironment("NOTIFICATIONS_FN_NAME", this.notificationsFn.functionName);
    this.notificationsFn.grantInvoke(this.csvFn);
    this.csvFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn));

    // --- Account deletion: purge all data for a user on request ---
    this.deletionFn = baseFnProps(
      "deletion-fn",
      "lambda/account_deletion",
      "Deletes all data for a user across every table, and the Cognito user itself",
      true
    );
    tables.accountsTable.grantReadWriteData(this.deletionFn);
    tables.transactionsTable.grantReadWriteData(this.deletionFn);
    tables.budgetsTable.grantReadWriteData(this.deletionFn);
    tables.recurringTable.grantReadWriteData(this.deletionFn);
    tables.auditLogTable.grantReadWriteData(this.deletionFn);
    tables.sharingTable.grantReadWriteData(this.deletionFn);
    this.deletionFn.addToRolePolicy(cognitoAdminDeletePolicy(props.userPool.userPoolArn));

    // --- Sharing: invite/accept/decline, permission levels ---
    this.sharingFn = baseFnProps(
      "sharing-fn",
      "lambda/sharing",
      "Account share invites (accept-required), view/edit permission levels",
      true
    );
    tables.sharingTable.grantReadWriteData(this.sharingFn);
    tables.accountsTable.grantReadData(this.sharingFn);
    this.sharingFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn)); // was missing - _lookup_user_id_by_email needs this
    this.sharingFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress)); // invite-received email

    // --- Recurring (API-facing): CRUD templates + per-occurrence overrides ---
    this.recurringFn = baseFnProps(
      "recurring-fn",
      "lambda/recurring",
      "CRUD recurring transaction templates; set one-time occurrence overrides",
      true
    );
    tables.recurringTable.grantReadWriteData(this.recurringFn);
    tables.accountsTable.grantReadData(this.recurringFn); // resolve_account_access checks ownership
    tables.sharingTable.grantReadData(this.recurringFn); // resolve_account_access - shared-account authorization
    tables.userPreferencesTable.grantReadData(this.recurringFn); // shared-activity alert opt-out check
    tables.transactionsTable.grantWriteData(this.recurringFn); // retroactive backfill entries (trend-only, no balance impact)
    tables.divisionsTable.grantReadData(this.recurringFn); // validate a provided divisionId belongs to the same account
    this.recurringFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress)); // shared-activity alert email
    this.recurringFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn)); // resolve owner/actor emails

    // --- Divisions: named sub-allocations within one account's balance ---
    this.divisionsFn = baseFnProps(
      "divisions-fn",
      "lambda/divisions",
      "CRUD for account divisions - named sub-allocations within one account's balance",
      true
    );
    tables.divisionsTable.grantReadWriteData(this.divisionsFn);
    tables.accountsTable.grantReadData(this.divisionsFn); // resolve_account_access checks ownership
    tables.sharingTable.grantReadData(this.divisionsFn); // resolve_account_access - shared-account authorization

    // --- Recurring processor (scheduled): posts due occurrences daily, backfills gaps ---
    const recurringProcessorLogGroup = new logs.LogGroup(this, "recurring-processor-fn-LogGroup", {
      logGroupName: `/aws/lambda/${cfg.resourcePrefix}-recurring-processor-fn`,
      retention: logRetentionDays,
      removalPolicy: cfg.retainDataOnDestroy ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    this.recurringProcessorFn = new lambda.Function(this, "recurring-processor-fn", {
      functionName: `${cfg.resourcePrefix}-recurring-processor-fn`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/recurring_processor"),
      timeout: Duration.seconds(60), // may process many templates/backfilled occurrences
      memorySize: 256,
      environment: {
        ...commonEnv,
        NOTIFICATIONS_FN_NAME: this.notificationsFn.functionName,
      },
      description: "Daily job: posts due recurring transactions, backfills missed occurrences",
      logGroup: recurringProcessorLogGroup,
      layers: [sharedLayer.layer],
    });
    tables.recurringTable.grantReadWriteData(this.recurringProcessorFn);
    tables.transactionsTable.grantReadWriteData(this.recurringProcessorFn);
    tables.accountsTable.grantReadWriteData(this.recurringProcessorFn);
    tables.budgetsTable.grantReadData(this.recurringProcessorFn);
    tables.divisionsTable.grantReadWriteData(this.recurringProcessorFn); // adjust a division's own balance when a division-tagged item posts
    this.notificationsFn.grantInvoke(this.recurringProcessorFn);
    this.recurringProcessorFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn));
    this.recurringProcessorFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress)); // for the "couldn't process your payment" failure email
    tables.userPreferencesTable.grantReadData(this.recurringProcessorFn); // low-balance alert preference check

    this.observability = new Observability(this, "Observability", {
      cfg,
      unattendedFunctions: [
        { name: "recurring-processor-fn", fn: this.recurringProcessorFn },
        { name: "notifications-fn", fn: this.notificationsFn },
      ],
    });

    new events.Rule(this, "RecurringDailySchedule", {
      ruleName: `${cfg.resourcePrefix}-recurring-daily`,
      schedule: events.Schedule.cron({ hour: "7", minute: "0" }), // 7am UTC daily
      targets: [
        new targets.LambdaFunction(this.recurringProcessorFn, {
          deadLetterQueue: this.observability.recurringProcessorDlq,
          retryAttempts: 2,
        }),
      ],
    });

    // --- Reconciliation: bulk balance-matching wizard across all accounts ---
    this.reconcileFn = baseFnProps(
      "reconcile-fn",
      "lambda/reconcile",
      "Bulk balance reconciliation across all accounts, logs adjustments to the audit trail",
      true
    );
    tables.accountsTable.grantReadWriteData(this.reconcileFn);
    tables.transactionsTable.grantReadWriteData(this.reconcileFn);
    tables.auditLogTable.grantWriteData(this.reconcileFn);

    // --- Payday wizard: preview + adjust + submit upcoming recurring money movement ---
    this.paydayFn = baseFnProps(
      "payday-fn",
      "lambda/payday",
      "Payday wizard - preview upcoming recurring amounts, adjust, add unpredicted amounts, submit as a batch",
      true
    );
    tables.recurringTable.grantReadWriteData(this.paydayFn);
    tables.transactionsTable.grantReadWriteData(this.paydayFn);
    tables.accountsTable.grantReadWriteData(this.paydayFn);
    tables.externalBankAccountsTable.grantReadData(this.paydayFn);
    tables.sharingTable.grantReadData(this.paydayFn);
    tables.peerAgreementsTable.grantReadData(this.paydayFn); // must confirm an accepted agreement before sending
    tables.peerNotificationsTable.grantWriteData(this.paydayFn);
    tables.paydayHistoryTable.grantReadWriteData(this.paydayFn);
    tables.budgetsTable.grantReadData(this.paydayFn); // budgeted-expense reminders now shown on Payday
    tables.plannedExpensesTable.grantReadData(this.paydayFn); // planned-expense contributions folded into "unpredicted" per the user's own definition
    tables.divisionsTable.grantReadWriteData(this.paydayFn); // adjust a division's own balance when a division-tagged item posts during submit
    this.paydayFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn)); // resolve recipient/sender emails for the notification email
    this.paydayFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress));

    // --- Planned expenses: annual/future savings targets (birthdays, anniversaries, etc.) ---
    this.plannedExpensesFn = baseFnProps(
      "planned-expenses-fn",
      "lambda/planned_expenses",
      "CRUD for planned/annual future expenses and their suggested per-period contribution",
      true
    );
    tables.plannedExpensesTable.grantReadWriteData(this.plannedExpensesFn);

    // --- External bank accounts: small user-maintained list, labels only, no linkage to real banking ---
    this.externalBankAccountsFn = baseFnProps(
      "external-bank-accounts-fn",
      "lambda/external_bank_accounts",
      "CRUD for the user-maintained list of external (non-app-tracked) bank account labels",
      true
    );
    tables.externalBankAccountsTable.grantReadWriteData(this.externalBankAccountsFn);

    // --- Scenarios: what-if planning, both throwaway and saved, always calculated against live data ---
    this.scenariosFn = baseFnProps(
      "scenarios-fn",
      "lambda/scenarios",
      "Saved and throwaway 'what-if' scenario calculations, layered on top of live income/budget/planned-expense data",
      true
    );
    tables.scenariosTable.grantReadWriteData(this.scenariosFn);
    tables.recurringTable.grantReadData(this.scenariosFn);
    tables.budgetsTable.grantReadData(this.scenariosFn);
    tables.plannedExpensesTable.grantReadData(this.scenariosFn);

    // --- Peer agreements: mutual consent to send/receive fund-movement notifications ---
    this.peerAgreementsFn = baseFnProps(
      "peer-agreements-fn",
      "lambda/peer_agreements",
      "Propose/accept/decline/revoke agreements to send another user fund-movement notifications",
      true
    );
    tables.peerAgreementsTable.grantReadWriteData(this.peerAgreementsFn);
    this.peerAgreementsFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress));
    this.peerAgreementsFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn));

    // --- Peer notifications: the fund-movement alerts themselves ---
    this.peerNotificationsFn = baseFnProps(
      "peer-notifications-fn",
      "lambda/peer_notifications",
      "Create/list/dismiss fund-movement notifications between users with an accepted agreement",
      true
    );
    tables.peerNotificationsTable.grantReadWriteData(this.peerNotificationsFn);
    tables.peerAgreementsTable.grantReadData(this.peerNotificationsFn); // must check for an accepted agreement before sending
    this.peerNotificationsFn.addToRolePolicy(cognitoListUsersPolicy(props.userPool.userPoolArn));
    this.peerNotificationsFn.addToRolePolicy(sesSendPolicy(this, cfg.sesFromAddress)); // email the recipient when a notification is sent

    // --- User preferences: notification toggles, starting with shared-activity alerts ---
    this.userPreferencesFn = baseFnProps(
      "user-preferences-fn",
      "lambda/user_preferences",
      "Get/update per-user notification preferences",
      true
    );
    tables.userPreferencesTable.grantReadWriteData(this.userPreferencesFn);
  }
}

import * as iam from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib";

function sesSendPolicy(scope: Construct, fromAddress: string): iam.PolicyStatement {
  const stack = Stack.of(scope);
  const domain = fromAddress.split("@")[1];
  return new iam.PolicyStatement({
    actions: ["ses:SendEmail", "ses:SendRawEmail"],
    // Scoped to the specific verified domain identity rather than "*" -
    // this role can only send FROM this domain, nothing else in the
    // account's SES setup (if there ever is anything else).
    resources: [`arn:aws:ses:${stack.region}:${stack.account}:identity/${domain}`],
  });
}

function cognitoAdminDeletePolicy(userPoolArn: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: ["cognito-idp:AdminDeleteUser"],
    resources: [userPoolArn],
  });
}

function cognitoListUsersPolicy(userPoolArn: string): iam.PolicyStatement {
  return new iam.PolicyStatement({
    actions: ["cognito-idp:ListUsers"],
    resources: [userPoolArn],
  });
}
