import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { EnvironmentConfig } from "../../config/environments";
interface FrontendProps {
    cfg: EnvironmentConfig;
    restApi: apigateway.RestApi;
}
export declare class Frontend extends Construct {
    readonly siteBucket: s3.Bucket;
    readonly distribution: cloudfront.Distribution;
    constructor(scope: Construct, id: string, props: FrontendProps);
}
export {};
