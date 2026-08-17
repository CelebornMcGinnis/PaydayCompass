import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { EnvironmentConfig } from "../../config/environments";
import { DataTables } from "./data-tables";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Observability } from "./observability";
interface LambdasProps {
    cfg: EnvironmentConfig;
    tables: DataTables;
    userPool: cognito.UserPool;
}
export declare class Lambdas extends Construct {
    readonly accountsFn: lambda.Function;
    readonly transactionsFn: lambda.Function;
    readonly budgetsFn: lambda.Function;
    readonly notificationsFn: lambda.Function;
    readonly csvFn: lambda.Function;
    readonly deletionFn: lambda.Function;
    readonly sharingFn: lambda.Function;
    readonly recurringFn: lambda.Function;
    readonly recurringProcessorFn: lambda.Function;
    readonly reconcileFn: lambda.Function;
    readonly paydayFn: lambda.Function;
    readonly plannedExpensesFn: lambda.Function;
    readonly externalBankAccountsFn: lambda.Function;
    readonly scenariosFn: lambda.Function;
    readonly peerAgreementsFn: lambda.Function;
    readonly peerNotificationsFn: lambda.Function;
    readonly userPreferencesFn: lambda.Function;
    readonly observability: Observability;
    readonly sharedLayer: lambda.LayerVersion;
    constructor(scope: Construct, id: string, props: LambdasProps);
}
export {};
