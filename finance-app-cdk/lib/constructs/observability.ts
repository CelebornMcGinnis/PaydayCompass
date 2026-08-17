import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import { EnvironmentConfig } from "../../config/environments";

interface ObservabilityProps {
  cfg: EnvironmentConfig;
  /** Functions that run unattended (scheduled jobs, async invokes) - a
   * failure here has no user watching a screen to notice it, so these are
   * the ones that get an alarm. User-facing functions surface their own
   * errors to whoever's using the app at that moment and don't need one. */
  unattendedFunctions: { name: string; fn: lambda.Function }[];
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
export class Observability extends Construct {
  public readonly alarmTopic: sns.Topic;
  public readonly recurringProcessorDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);
    const { cfg, unattendedFunctions } = props;

    this.alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: `${cfg.resourcePrefix}-alarms`,
      displayName: `Finance App (${cfg.envName.toUpperCase()}) Alarms`,
    });
    if (cfg.alertEmail) {
      this.alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(cfg.alertEmail));
    }
    // If alertEmail isn't set, the topic still exists (alarms still fire
    // into it) but nobody's subscribed - CDK deploy succeeds either way,
    // but silently nobody gets paged. See the REQUIRED comment on
    // cfg.alertEmail in config/environments.ts.

    // Dead-letter queue for the recurring processor's EventBridge target.
    // If the scheduled invocation fails all its retries, the event lands
    // here instead of disappearing - inspect it to see what was being
    // processed when it failed.
    this.recurringProcessorDlq = new sqs.Queue(this, "RecurringProcessorDlq", {
      queueName: `${cfg.resourcePrefix}-recurring-processor-dlq`,
      retentionPeriod: Duration.days(14),
    });

    for (const { name, fn } of unattendedFunctions) {
      // CloudWatch's default SNS email subject is `ALARM: "<AlarmName>" in
      // <region>` - so the alarm name IS the email subject. Made
      // human-readable (app name, environment, which job) rather than a
      // bare resource slug, since that's the one thing SNS lets us control
      // about how this shows up in an inbox - it can't rebrand the "From"
      // address (always a generic AWS one for a plain email subscription).
      const envLabel = cfg.envName.toUpperCase();
      const alarm = new cloudwatch.Alarm(this, `${name}-ErrorsAlarm`, {
        alarmName: `Finance App (${envLabel}) - ${name} is failing`,
        alarmDescription: `${name} raised an error in the ${envLabel} environment - this function runs unattended, so nobody would otherwise notice.`,
        metric: fn.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cwActions.SnsAction(this.alarmTopic));
    }
  }
}
