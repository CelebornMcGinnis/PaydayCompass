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
export declare class Api extends Construct {
    readonly restApi: apigateway.RestApi;
    constructor(scope: Construct, id: string, props: ApiProps);
}
export {};
