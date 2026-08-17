import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { EnvironmentConfig } from "../../config/environments";
/**
 * The shared Python package used by every function that previously
 * duplicated recurring-schedule math or the budget-notification-check
 * logic. See lambda-layers/finance-common/python/finance_common/__init__.py
 * for the full rationale.
 */
export declare class SharedLayer extends Construct {
    readonly layer: lambda.LayerVersion;
    constructor(scope: Construct, id: string, cfg: EnvironmentConfig);
}
