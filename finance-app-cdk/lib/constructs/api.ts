import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { EnvironmentConfig } from "../../config/environments";
import { Lambdas } from "./lambdas";

interface ApiProps {
  cfg: EnvironmentConfig;
  userPool: cognito.UserPool;
  lambdas: Lambdas;
}

export class Api extends Construct {
  public readonly restApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    const { cfg, userPool, lambdas } = props;

    this.restApi = new apigateway.RestApi(this, "RestApi", {
      restApiName: `${cfg.resourcePrefix}-api`,
      deployOptions: { stageName: cfg.envName },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // tighten to CloudFront domain once known
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // defaultCorsPreflightOptions only covers the OPTIONS preflight and
    // successful responses a Lambda's own _response() helper builds -
    // it does NOT cover a rejection API Gateway itself generates before
    // ever invoking a Lambda (an expired/invalid Cognito token, a
    // throttled request, an unmatched route). Those come back with no
    // CORS headers at all, which the browser then reports as a raw,
    // unexplained network failure ("Couldn't reach the server") instead
    // of surfacing the real 401/403/429 - the same class of bug
    // documented in DEPLOY.md for the Lambda-response side, just at the
    // API Gateway layer instead.
    new apigateway.GatewayResponse(this, "Default4xxCors", {
      restApi: this.restApi,
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": "'*'",
        "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
      },
    });
    new apigateway.GatewayResponse(this, "Default5xxCors", {
      restApi: this.restApi,
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": "'*'",
        "Access-Control-Allow-Headers": "'Content-Type,Authorization'",
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [userPool],
    });

    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // /accounts
    const accounts = this.restApi.root.addResource("accounts");
    accounts.addMethod("GET", new apigateway.LambdaIntegration(lambdas.accountsFn), authOptions);
    accounts.addMethod("POST", new apigateway.LambdaIntegration(lambdas.accountsFn), authOptions);
    // /accounts/reorder - a sibling of {accountId}, not nested under it,
    // since API Gateway doesn't allow two differently-named path
    // parameters at the same position, and "reorder" is a literal
    // segment rather than a dynamic one anyway
    accounts.addResource("reorder").addMethod("PUT", new apigateway.LambdaIntegration(lambdas.accountsFn), authOptions);
    const accountItem = accounts.addResource("{accountId}");
    accountItem.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.accountsFn), authOptions);
    accountItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.accountsFn), authOptions);

    // /accounts/{accountId}/divisions
    const divisions = accountItem.addResource("divisions");
    divisions.addMethod("GET", new apigateway.LambdaIntegration(lambdas.divisionsFn), authOptions);
    divisions.addMethod("POST", new apigateway.LambdaIntegration(lambdas.divisionsFn), authOptions);
    const divisionItem = divisions.addResource("{divisionId}");
    divisionItem.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.divisionsFn), authOptions);
    divisionItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.divisionsFn), authOptions);

    // /accounts/{accountId}/transactions
    const transactions = accountItem.addResource("transactions");
    transactions.addMethod("GET", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);
    transactions.addMethod("POST", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);
    const txnItem = transactions.addResource("{txnId}");
    txnItem.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);
    txnItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);
    // /accounts/{accountId}/transactions/purchase/{purchaseId} - edit/delete
    // a whole split expense's structure at once, distinct from editing one
    // row's fields via {txnId} above.
    const purchaseItem = transactions.addResource("purchase").addResource("{purchaseId}");
    purchaseItem.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);
    purchaseItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);

    // /accounts/{accountId}/income (manual one-time credits: bonuses, gifts)
    accountItem
      .addResource("income")
      .addMethod("POST", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);

    // /accounts/{accountId}/recurring
    const recurring = accountItem.addResource("recurring");
    recurring.addMethod("GET", new apigateway.LambdaIntegration(lambdas.recurringFn), authOptions);
    recurring.addMethod("POST", new apigateway.LambdaIntegration(lambdas.recurringFn), authOptions);
    const recurringItem = recurring.addResource("{recurringId}");
    recurringItem.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.recurringFn), authOptions);
    recurringItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.recurringFn), authOptions);
    recurringItem
      .addResource("occurrence")
      .addMethod("PUT", new apigateway.LambdaIntegration(lambdas.recurringFn), authOptions);

    // /transactions/transfer (between own accounts)
    const transfer = this.restApi.root
      .addResource("transactions")
      .addResource("transfer");
    transfer.addMethod("POST", new apigateway.LambdaIntegration(lambdas.transactionsFn), authOptions);

    // /budgets
    const budgets = this.restApi.root.addResource("budgets");
    budgets.addMethod("GET", new apigateway.LambdaIntegration(lambdas.budgetsFn), authOptions);
    budgets.addMethod("POST", new apigateway.LambdaIntegration(lambdas.budgetsFn), authOptions);
    // sk ("category#effectiveStartDate") travels as a query parameter
    // (?sk=...), not a path parameter - API Gateway does not reliably
    // URL-decode a %23 (#) inside a path segment, so a path param here
    // silently broke every delete (see budgets-fn's own comment on this).
    budgets.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.budgetsFn), authOptions);
    // /budgets/projected-vs-actual - total money in vs out per real pay
    // period, not tied to any one category (Category Trends already
    // covers the per-category breakdown)
    budgets.addResource("projected-vs-actual").addMethod("GET", new apigateway.LambdaIntegration(lambdas.budgetsFn), authOptions);

    // /projections
    const projections = this.restApi.root.addResource("projections");
    projections.addMethod("GET", new apigateway.LambdaIntegration(lambdas.budgetsFn), authOptions);

    // /csv/export-template and /csv/import
    const csv = this.restApi.root.addResource("csv");
    csv.addResource("export-template").addMethod(
      "GET",
      new apigateway.LambdaIntegration(lambdas.csvFn),
      authOptions
    );
    csv.addResource("import").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.csvFn),
      authOptions
    );

    // /csv/recurring/export-template and /csv/recurring/import
    const csvRecurring = csv.addResource("recurring");
    csvRecurring.addResource("export-template").addMethod(
      "GET",
      new apigateway.LambdaIntegration(lambdas.csvFn),
      authOptions
    );
    csvRecurring.addResource("import").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.csvFn),
      authOptions
    );

    // /sharing
    const sharing = this.restApi.root.addResource("sharing");
    sharing.addMethod("GET", new apigateway.LambdaIntegration(lambdas.sharingFn), authOptions); // list, both sides
    sharing.addMethod("POST", new apigateway.LambdaIntegration(lambdas.sharingFn), authOptions); // invite
    const sharingAction = sharing.addResource("{invitationId}");
    sharingAction.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.sharingFn), authOptions); // accept/decline
    sharingAction.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.sharingFn), authOptions); // revoke (owner)
    const sharingAccountAction = sharingAction.addResource("accounts").addResource("{accountId}");
    sharingAccountAction.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.sharingFn), authOptions); // modify permissions (owner)

    // /account/delete-me
    const account = this.restApi.root.addResource("account");
    account.addResource("delete-me").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.deletionFn),
      authOptions
    );

    // /reconcile - bulk, across all accounts at once (no per-account clicking)
    const reconcile = this.restApi.root.addResource("reconcile");
    reconcile.addMethod("POST", new apigateway.LambdaIntegration(lambdas.reconcileFn), authOptions);

    // /payday/upcoming and /payday/submit
    const payday = this.restApi.root.addResource("payday");
    payday.addResource("upcoming").addMethod(
      "GET",
      new apigateway.LambdaIntegration(lambdas.paydayFn),
      authOptions
    );
    payday.addResource("submit").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.paydayFn),
      authOptions
    );
    payday.addResource("history").addMethod(
      "GET",
      new apigateway.LambdaIntegration(lambdas.paydayFn),
      authOptions
    );
    payday.addResource("reverse").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.paydayFn),
      authOptions
    );

    // /contact - public, no auth (reachable from the pre-login Landing page)
    this.restApi.root.addResource("contact").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.contactFn)
    );

    // /billing - Stripe subscription tiers (dev-environment exploration)
    const billing = this.restApi.root.addResource("billing");
    billing.addResource("status").addMethod("GET", new apigateway.LambdaIntegration(lambdas.billingFn), authOptions);
    billing.addResource("checkout").addMethod("POST", new apigateway.LambdaIntegration(lambdas.billingFn), authOptions);
    billing.addResource("portal").addMethod("POST", new apigateway.LambdaIntegration(lambdas.billingFn), authOptions);
    // /billing/webhook - public, no auth (Stripe calls this directly; the
    // Lambda itself verifies the Stripe-Signature header, same trust model
    // as /contact being open but validated inside the handler)
    billing.addResource("webhook").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.billingFn)
    );

    // /planned-expenses
    const plannedExpenses = this.restApi.root.addResource("planned-expenses");
    plannedExpenses.addMethod("GET", new apigateway.LambdaIntegration(lambdas.plannedExpensesFn), authOptions);
    plannedExpenses.addMethod("POST", new apigateway.LambdaIntegration(lambdas.plannedExpensesFn), authOptions);
    const plannedExpenseItem = plannedExpenses.addResource("{plannedExpenseId}");
    plannedExpenseItem.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.plannedExpensesFn), authOptions);
    plannedExpenseItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.plannedExpensesFn), authOptions);
    // /planned-expenses/{plannedExpenseId}/complete - marks it done; for
    // an annual one, also rolls forward a fresh card for next year
    plannedExpenseItem.addResource("complete").addMethod("POST", new apigateway.LambdaIntegration(lambdas.plannedExpensesFn), authOptions);

    // /external-bank-accounts - user-maintained list of real-world bank account labels
    const externalBankAccounts = this.restApi.root.addResource("external-bank-accounts");
    externalBankAccounts.addMethod(
      "GET",
      new apigateway.LambdaIntegration(lambdas.externalBankAccountsFn),
      authOptions
    );
    externalBankAccounts.addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.externalBankAccountsFn),
      authOptions
    );
    const externalBankAccountItem = externalBankAccounts.addResource("{externalBankAccountId}");
    externalBankAccountItem.addMethod(
      "PUT",
      new apigateway.LambdaIntegration(lambdas.externalBankAccountsFn),
      authOptions
    );
    externalBankAccountItem.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(lambdas.externalBankAccountsFn),
      authOptions
    );

    // /scenarios - saved what-if scenarios
    const scenarios = this.restApi.root.addResource("scenarios");
    scenarios.addMethod("GET", new apigateway.LambdaIntegration(lambdas.scenariosFn), authOptions);
    scenarios.addMethod("POST", new apigateway.LambdaIntegration(lambdas.scenariosFn), authOptions);

    // /scenarios/calculate - throwaway calculation, nothing saved
    scenarios.addResource("calculate").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.scenariosFn),
      authOptions
    );

    // /scenarios/compare - up to 6 scenarios (saved and/or inline) side by side
    scenarios.addResource("compare").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.scenariosFn),
      authOptions
    );

    // /scenarios/trend - cumulative leftover over real pay periods,
    // baseline vs one or more scenarios
    scenarios.addResource("trend").addMethod(
      "POST",
      new apigateway.LambdaIntegration(lambdas.scenariosFn),
      authOptions
    );

    const scenarioItem = scenarios.addResource("{scenarioId}");
    scenarioItem.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.scenariosFn), authOptions);
    scenarioItem.addResource("calculate").addMethod(
      "GET",
      new apigateway.LambdaIntegration(lambdas.scenariosFn),
      authOptions
    );

    // /peer-agreements - mutual consent to send/receive fund-movement notifications
    const peerAgreements = this.restApi.root.addResource("peer-agreements");
    peerAgreements.addMethod("POST", new apigateway.LambdaIntegration(lambdas.peerAgreementsFn), authOptions);
    peerAgreements.addMethod("GET", new apigateway.LambdaIntegration(lambdas.peerAgreementsFn), authOptions);

    const peerAgreementBySender = peerAgreements.addResource("{senderUserId}");
    peerAgreementBySender.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.peerAgreementsFn), authOptions);

    // Separate resource path (same underlying data) so DELETE can accept
    // EITHER party's id in the URL without a routing conflict against the
    // PUT-by-senderUserId resource above.
    const peerAgreementByOther = peerAgreements.addResource("revoke").addResource("{otherUserId}");
    peerAgreementByOther.addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.peerAgreementsFn), authOptions);

    // /peer-notifications - the fund-movement alerts themselves
    const peerNotifications = this.restApi.root.addResource("peer-notifications");
    peerNotifications.addMethod("POST", new apigateway.LambdaIntegration(lambdas.peerNotificationsFn), authOptions);
    peerNotifications.addMethod("GET", new apigateway.LambdaIntegration(lambdas.peerNotificationsFn), authOptions);
    peerNotifications
      .addResource("{notificationId}")
      .addMethod("DELETE", new apigateway.LambdaIntegration(lambdas.peerNotificationsFn), authOptions);

    // /preferences - user notification toggles
    const preferences = this.restApi.root.addResource("preferences");
    preferences.addMethod("GET", new apigateway.LambdaIntegration(lambdas.userPreferencesFn), authOptions);
    preferences.addMethod("PUT", new apigateway.LambdaIntegration(lambdas.userPreferencesFn), authOptions);
  }
}
