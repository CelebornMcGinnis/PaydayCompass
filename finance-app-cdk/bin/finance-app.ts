#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { FinanceAppStack } from "../lib/finance-app-stack";
import { environments } from "../config/environments";

const app = new cdk.App();

new FinanceAppStack(app, "FinanceApp-Beta", {
  cfg: environments.beta,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: "Personal finance app - beta environment",
});

new FinanceAppStack(app, "FinanceApp-Prod", {
  cfg: environments.prod,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: "Personal finance app - production environment",
});
