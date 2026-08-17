import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import { EnvironmentConfig } from "../../config/environments";
interface ObservabilityProps {
    cfg: EnvironmentConfig;
    /** Functions that run unattended (scheduled jobs, async invokes) - a
     * failure here has no user watching a screen to notice it, so these are
     * the ones that get an alarm. User-facing functions surface their own
     * errors to whoever's using the app at that moment and don't need one. */
    unattendedFunctions: {
        name: string;
        fn: lambda.Function;
    }[];
}
/**
 * Addresses the Well-Architected Reliability and Operational Excellence
 * gaps noted in the project documentation: previously nothing told anyone
 * when the daily recurring processor or the notifications sender failed -
 * it would just silently not run, or silently not send. This wires:
 *   - An SNS topic emailing cfg.alertEmail when any watched function errors
 *   - A CloudWatch Alarm per watched function on its Errors metric
 *   - A dead-letter queue for the EventBridge-triggered recurring processor,
 *     so a failed invocation is captured for inspection/retry instead of
 *     just vanishing
 */
export declare class Observability extends Construct {
    readonly alarmTopic: sns.Topic;
    readonly recurringProcessorDlq: sqs.Queue;
    constructor(scope: Construct, id: string, props: ObservabilityProps);
}
export {};
