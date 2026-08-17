import { Construct } from "constructs";
import { Stack, StackProps, CfnOutput, Tags } from "aws-cdk-lib";
import { EnvironmentConfig } from "../config/environments";
import { DataTables } from "./constructs/data-tables";
import { Auth } from "./constructs/auth";
import { Lambdas } from "./constructs/lambdas";
import { Api } from "./constructs/api";
import { Frontend } from "./constructs/frontend";

export interface FinanceAppStackProps extends StackProps {
  cfg: EnvironmentConfig;
}

export class FinanceAppStack extends Stack {
  constructor(scope: Construct, id: string, props: FinanceAppStackProps) {
    super(scope, id, props);
    const { cfg } = props;

    const tables = new DataTables(this, "DataTables", cfg);
    const auth = new Auth(this, "Auth", cfg);
    const lambdas = new Lambdas(this, "Lambdas", {
      cfg,
      tables,
      userPool: auth.userPool,
    });
    const api = new Api(this, "Api", {
      cfg,
      userPool: auth.userPool,
      lambdas,
    });
    const frontend = new Frontend(this, "Frontend", {
      cfg,
      restApi: api.restApi,
    });

    // Apply Environment/Project tags to every resource in this stack
    Object.entries(cfg.tags).forEach(([key, value]) => {
      Tags.of(this).add(key, value);
    });

    new CfnOutput(this, "SiteUrl", {
      value: `https://${frontend.distribution.distributionDomainName}`,
      description: "Unified CloudFront URL for the app (frontend + /api/*)",
    });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: auth.userPoolClient.userPoolClientId });
    new CfnOutput(this, "SiteBucketName", { value: frontend.siteBucket.bucketName });
  }
}
