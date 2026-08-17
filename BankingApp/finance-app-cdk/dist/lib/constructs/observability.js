"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Observability = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const sqs = require("aws-cdk-lib/aws-sqs");
const sns = require("aws-cdk-lib/aws-sns");
const snsSubscriptions = require("aws-cdk-lib/aws-sns-subscriptions");
const cloudwatch = require("aws-cdk-lib/aws-cloudwatch");
const cwActions = require("aws-cdk-lib/aws-cloudwatch-actions");
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
class Observability extends constructs_1.Construct {
    constructor(scope, id, props) {
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
            retentionPeriod: aws_cdk_lib_1.Duration.days(14),
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
                metric: fn.metricErrors({ period: aws_cdk_lib_1.Duration.minutes(5) }),
                threshold: 1,
                evaluationPeriods: 1,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            alarm.addAlarmAction(new cwActions.SnsAction(this.alarmTopic));
        }
    }
}
exports.Observability = Observability;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9jb25zdHJ1Y3RzL29ic2VydmFiaWxpdHkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXVDO0FBQ3ZDLDZDQUF1QztBQUV2QywyQ0FBMkM7QUFDM0MsMkNBQTJDO0FBQzNDLHNFQUFzRTtBQUN0RSx5REFBeUQ7QUFDekQsZ0VBQWdFO0FBWWhFOzs7Ozs7Ozs7O0dBVUc7QUFDSCxNQUFhLGFBQWMsU0FBUSxzQkFBUztJQUkxQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXlCO1FBQ2pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsTUFBTSxFQUFFLEdBQUcsRUFBRSxtQkFBbUIsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUzQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ2xELFNBQVMsRUFBRSxHQUFHLEdBQUcsQ0FBQyxjQUFjLFNBQVM7WUFDekMsV0FBVyxFQUFFLGdCQUFnQixHQUFHLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxVQUFVO1NBQ2pFLENBQUMsQ0FBQztRQUNILElBQUksR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ25CLElBQUksQ0FBQyxVQUFVLENBQUMsZUFBZSxDQUFDLElBQUksZ0JBQWdCLENBQUMsaUJBQWlCLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7UUFDMUYsQ0FBQztRQUNELHFFQUFxRTtRQUNyRSxxRUFBcUU7UUFDckUsOERBQThEO1FBQzlELDRDQUE0QztRQUU1QyxzRUFBc0U7UUFDdEUscUVBQXFFO1FBQ3JFLGtFQUFrRTtRQUNsRSw0QkFBNEI7UUFDNUIsSUFBSSxDQUFDLHFCQUFxQixHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDeEUsU0FBUyxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsMEJBQTBCO1lBQzFELGVBQWUsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7U0FDbkMsQ0FBQyxDQUFDO1FBRUgsS0FBSyxNQUFNLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxJQUFJLG1CQUFtQixFQUFFLENBQUM7WUFDL0MscUVBQXFFO1lBQ3JFLDJEQUEyRDtZQUMzRCxrRUFBa0U7WUFDbEUscUVBQXFFO1lBQ3JFLG9FQUFvRTtZQUNwRSxxRUFBcUU7WUFDckUsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUMzQyxNQUFNLEtBQUssR0FBRyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsSUFBSSxjQUFjLEVBQUU7Z0JBQzlELFNBQVMsRUFBRSxnQkFBZ0IsUUFBUSxPQUFPLElBQUksYUFBYTtnQkFDM0QsZ0JBQWdCLEVBQUUsR0FBRyxJQUFJLDJCQUEyQixRQUFRLGlGQUFpRjtnQkFDN0ksTUFBTSxFQUFFLEVBQUUsQ0FBQyxZQUFZLENBQUMsRUFBRSxNQUFNLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDeEQsU0FBUyxFQUFFLENBQUM7Z0JBQ1osaUJBQWlCLEVBQUUsQ0FBQztnQkFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7YUFDNUQsQ0FBQyxDQUFDO1lBQ0gsS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJLFNBQVMsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7UUFDakUsQ0FBQztJQUNILENBQUM7Q0FDRjtBQWhERCxzQ0FnREMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgRHVyYXRpb24gfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnNcIjtcbmltcG9ydCAqIGFzIHNuc1N1YnNjcmlwdGlvbnMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zbnMtc3Vic2NyaXB0aW9uc1wiO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2hcIjtcbmltcG9ydCAqIGFzIGN3QWN0aW9ucyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9uc1wiO1xuaW1wb3J0IHsgRW52aXJvbm1lbnRDb25maWcgfSBmcm9tIFwiLi4vLi4vY29uZmlnL2Vudmlyb25tZW50c1wiO1xuXG5pbnRlcmZhY2UgT2JzZXJ2YWJpbGl0eVByb3BzIHtcbiAgY2ZnOiBFbnZpcm9ubWVudENvbmZpZztcbiAgLyoqIEZ1bmN0aW9ucyB0aGF0IHJ1biB1bmF0dGVuZGVkIChzY2hlZHVsZWQgam9icywgYXN5bmMgaW52b2tlcykgLSBhXG4gICAqIGZhaWx1cmUgaGVyZSBoYXMgbm8gdXNlciB3YXRjaGluZyBhIHNjcmVlbiB0byBub3RpY2UgaXQsIHNvIHRoZXNlIGFyZVxuICAgKiB0aGUgb25lcyB0aGF0IGdldCBhbiBhbGFybS4gVXNlci1mYWNpbmcgZnVuY3Rpb25zIHN1cmZhY2UgdGhlaXIgb3duXG4gICAqIGVycm9ycyB0byB3aG9ldmVyJ3MgdXNpbmcgdGhlIGFwcCBhdCB0aGF0IG1vbWVudCBhbmQgZG9uJ3QgbmVlZCBvbmUuICovXG4gIHVuYXR0ZW5kZWRGdW5jdGlvbnM6IHsgbmFtZTogc3RyaW5nOyBmbjogbGFtYmRhLkZ1bmN0aW9uIH1bXTtcbn1cblxuLyoqXG4gKiBBZGRyZXNzZXMgdGhlIFdlbGwtQXJjaGl0ZWN0ZWQgUmVsaWFiaWxpdHkgYW5kIE9wZXJhdGlvbmFsIEV4Y2VsbGVuY2VcbiAqIGdhcHMgbm90ZWQgaW4gdGhlIHByb2plY3QgZG9jdW1lbnRhdGlvbjogcHJldmlvdXNseSBub3RoaW5nIHRvbGQgYW55b25lXG4gKiB3aGVuIHRoZSBkYWlseSByZWN1cnJpbmcgcHJvY2Vzc29yIG9yIHRoZSBub3RpZmljYXRpb25zIHNlbmRlciBmYWlsZWQgLVxuICogaXQgd291bGQganVzdCBzaWxlbnRseSBub3QgcnVuLCBvciBzaWxlbnRseSBub3Qgc2VuZC4gVGhpcyB3aXJlczpcbiAqICAgLSBBbiBTTlMgdG9waWMgZW1haWxpbmcgY2ZnLmFsZXJ0RW1haWwgd2hlbiBhbnkgd2F0Y2hlZCBmdW5jdGlvbiBlcnJvcnNcbiAqICAgLSBBIENsb3VkV2F0Y2ggQWxhcm0gcGVyIHdhdGNoZWQgZnVuY3Rpb24gb24gaXRzIEVycm9ycyBtZXRyaWNcbiAqICAgLSBBIGRlYWQtbGV0dGVyIHF1ZXVlIGZvciB0aGUgRXZlbnRCcmlkZ2UtdHJpZ2dlcmVkIHJlY3VycmluZyBwcm9jZXNzb3IsXG4gKiAgICAgc28gYSBmYWlsZWQgaW52b2NhdGlvbiBpcyBjYXB0dXJlZCBmb3IgaW5zcGVjdGlvbi9yZXRyeSBpbnN0ZWFkIG9mXG4gKiAgICAganVzdCB2YW5pc2hpbmdcbiAqL1xuZXhwb3J0IGNsYXNzIE9ic2VydmFiaWxpdHkgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgYWxhcm1Ub3BpYzogc25zLlRvcGljO1xuICBwdWJsaWMgcmVhZG9ubHkgcmVjdXJyaW5nUHJvY2Vzc29yRGxxOiBzcXMuUXVldWU7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE9ic2VydmFiaWxpdHlQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgY29uc3QgeyBjZmcsIHVuYXR0ZW5kZWRGdW5jdGlvbnMgfSA9IHByb3BzO1xuXG4gICAgdGhpcy5hbGFybVRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCBcIkFsYXJtVG9waWNcIiwge1xuICAgICAgdG9waWNOYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LWFsYXJtc2AsXG4gICAgICBkaXNwbGF5TmFtZTogYEZpbmFuY2UgQXBwICgke2NmZy5lbnZOYW1lLnRvVXBwZXJDYXNlKCl9KSBBbGFybXNgLFxuICAgIH0pO1xuICAgIGlmIChjZmcuYWxlcnRFbWFpbCkge1xuICAgICAgdGhpcy5hbGFybVRvcGljLmFkZFN1YnNjcmlwdGlvbihuZXcgc25zU3Vic2NyaXB0aW9ucy5FbWFpbFN1YnNjcmlwdGlvbihjZmcuYWxlcnRFbWFpbCkpO1xuICAgIH1cbiAgICAvLyBJZiBhbGVydEVtYWlsIGlzbid0IHNldCwgdGhlIHRvcGljIHN0aWxsIGV4aXN0cyAoYWxhcm1zIHN0aWxsIGZpcmVcbiAgICAvLyBpbnRvIGl0KSBidXQgbm9ib2R5J3Mgc3Vic2NyaWJlZCAtIENESyBkZXBsb3kgc3VjY2VlZHMgZWl0aGVyIHdheSxcbiAgICAvLyBidXQgc2lsZW50bHkgbm9ib2R5IGdldHMgcGFnZWQuIFNlZSB0aGUgUkVRVUlSRUQgY29tbWVudCBvblxuICAgIC8vIGNmZy5hbGVydEVtYWlsIGluIGNvbmZpZy9lbnZpcm9ubWVudHMudHMuXG5cbiAgICAvLyBEZWFkLWxldHRlciBxdWV1ZSBmb3IgdGhlIHJlY3VycmluZyBwcm9jZXNzb3IncyBFdmVudEJyaWRnZSB0YXJnZXQuXG4gICAgLy8gSWYgdGhlIHNjaGVkdWxlZCBpbnZvY2F0aW9uIGZhaWxzIGFsbCBpdHMgcmV0cmllcywgdGhlIGV2ZW50IGxhbmRzXG4gICAgLy8gaGVyZSBpbnN0ZWFkIG9mIGRpc2FwcGVhcmluZyAtIGluc3BlY3QgaXQgdG8gc2VlIHdoYXQgd2FzIGJlaW5nXG4gICAgLy8gcHJvY2Vzc2VkIHdoZW4gaXQgZmFpbGVkLlxuICAgIHRoaXMucmVjdXJyaW5nUHJvY2Vzc29yRGxxID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCBcIlJlY3VycmluZ1Byb2Nlc3NvckRscVwiLCB7XG4gICAgICBxdWV1ZU5hbWU6IGAke2NmZy5yZXNvdXJjZVByZWZpeH0tcmVjdXJyaW5nLXByb2Nlc3Nvci1kbHFgLFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBEdXJhdGlvbi5kYXlzKDE0KSxcbiAgICB9KTtcblxuICAgIGZvciAoY29uc3QgeyBuYW1lLCBmbiB9IG9mIHVuYXR0ZW5kZWRGdW5jdGlvbnMpIHtcbiAgICAgIC8vIENsb3VkV2F0Y2gncyBkZWZhdWx0IFNOUyBlbWFpbCBzdWJqZWN0IGlzIGBBTEFSTTogXCI8QWxhcm1OYW1lPlwiIGluXG4gICAgICAvLyA8cmVnaW9uPmAgLSBzbyB0aGUgYWxhcm0gbmFtZSBJUyB0aGUgZW1haWwgc3ViamVjdC4gTWFkZVxuICAgICAgLy8gaHVtYW4tcmVhZGFibGUgKGFwcCBuYW1lLCBlbnZpcm9ubWVudCwgd2hpY2ggam9iKSByYXRoZXIgdGhhbiBhXG4gICAgICAvLyBiYXJlIHJlc291cmNlIHNsdWcsIHNpbmNlIHRoYXQncyB0aGUgb25lIHRoaW5nIFNOUyBsZXRzIHVzIGNvbnRyb2xcbiAgICAgIC8vIGFib3V0IGhvdyB0aGlzIHNob3dzIHVwIGluIGFuIGluYm94IC0gaXQgY2FuJ3QgcmVicmFuZCB0aGUgXCJGcm9tXCJcbiAgICAgIC8vIGFkZHJlc3MgKGFsd2F5cyBhIGdlbmVyaWMgQVdTIG9uZSBmb3IgYSBwbGFpbiBlbWFpbCBzdWJzY3JpcHRpb24pLlxuICAgICAgY29uc3QgZW52TGFiZWwgPSBjZmcuZW52TmFtZS50b1VwcGVyQ2FzZSgpO1xuICAgICAgY29uc3QgYWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCBgJHtuYW1lfS1FcnJvcnNBbGFybWAsIHtcbiAgICAgICAgYWxhcm1OYW1lOiBgRmluYW5jZSBBcHAgKCR7ZW52TGFiZWx9KSAtICR7bmFtZX0gaXMgZmFpbGluZ2AsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGAke25hbWV9IHJhaXNlZCBhbiBlcnJvciBpbiB0aGUgJHtlbnZMYWJlbH0gZW52aXJvbm1lbnQgLSB0aGlzIGZ1bmN0aW9uIHJ1bnMgdW5hdHRlbmRlZCwgc28gbm9ib2R5IHdvdWxkIG90aGVyd2lzZSBub3RpY2UuYCxcbiAgICAgICAgbWV0cmljOiBmbi5tZXRyaWNFcnJvcnMoeyBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgfSk7XG4gICAgICBhbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY3dBY3Rpb25zLlNuc0FjdGlvbih0aGlzLmFsYXJtVG9waWMpKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==