import { Construct } from "constructs";
import { Stack, StackProps } from "aws-cdk-lib";
import { EnvironmentConfig } from "../config/environments";
export interface FinanceAppStackProps extends StackProps {
    cfg: EnvironmentConfig;
}
export declare class FinanceAppStack extends Stack {
    constructor(scope: Construct, id: string, props: FinanceAppStackProps);
}
