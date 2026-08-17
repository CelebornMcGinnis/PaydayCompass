import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { EnvironmentConfig } from "../../config/environments";

/**
 * The shared Python package used by every function that previously
 * duplicated recurring-schedule math or the budget-notification-check
 * logic. See lambda-layers/finance-common/python/finance_common/__init__.py
 * for the full rationale.
 */
export class SharedLayer extends Construct {
  public readonly layer: lambda.LayerVersion;

  constructor(scope: Construct, id: string, cfg: EnvironmentConfig) {
    super(scope, id);

    this.layer = new lambda.LayerVersion(this, "FinanceCommonLayer", {
      layerVersionName: `${cfg.resourcePrefix}-finance-common`,
      code: lambda.Code.fromAsset("lambda-layers/finance-common"),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "Shared schedule math, Cognito lookups, and budget-notification-check logic",
    });
  }
}
