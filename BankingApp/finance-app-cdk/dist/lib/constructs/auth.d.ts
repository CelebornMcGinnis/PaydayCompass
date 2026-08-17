import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { EnvironmentConfig } from "../../config/environments";
export declare class Auth extends Construct {
    readonly userPool: cognito.UserPool;
    readonly userPoolClient: cognito.UserPoolClient;
    constructor(scope: Construct, id: string, cfg: EnvironmentConfig);
}
