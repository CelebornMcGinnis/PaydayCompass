"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Auth = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
class Auth extends constructs_1.Construct {
    constructor(scope, id, cfg) {
        super(scope, id);
        this.userPool = new cognito.UserPool(this, "UserPool", {
            userPoolName: `${cfg.resourcePrefix}-users`,
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            standardAttributes: {
                email: { required: true, mutable: true },
            },
            customAttributes: {
                // Tracks whether the user has completed (or explicitly skipped)
                // the Getting Setup wizard, so the app can send a brand-new user
                // there automatically without needing a separate database table
                // just to track this one flag. "true"/"false" as a string, not a
                // real boolean - Cognito custom attributes are string/number only.
                hasCompletedSetup: new cognito.StringAttribute({ mutable: true }),
            },
            passwordPolicy: {
                minLength: 10,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cfg.retainDataOnDestroy
                ? aws_cdk_lib_1.RemovalPolicy.RETAIN
                : aws_cdk_lib_1.RemovalPolicy.DESTROY,
            // MFA: optional so we can require it via adaptive/risk-based auth on Plus tier
            mfa: cognito.Mfa.OPTIONAL,
            mfaSecondFactor: { sms: false, otp: true },
        });
        // NOTE: as of this writing, CDK's L2 construct doesn't yet expose the
        // Lite/Essentials/Plus feature plan directly - set the feature plan via
        // the L1 escape hatch (CfnUserPool) so we can toggle advanced security
        // per environment without hand-writing the whole resource.
        const cfnUserPool = this.userPool.node.defaultChild;
        cfnUserPool.userPoolTier = cfg.enableAdvancedSecurity ? "PLUS" : "ESSENTIALS";
        this.userPoolClient = this.userPool.addClient("WebClient", {
            userPoolClientName: `${cfg.resourcePrefix}-web-client`,
            authFlows: {
                userSrp: true,
            },
            accessTokenValidity: aws_cdk_lib_1.Duration.hours(1),
            idTokenValidity: aws_cdk_lib_1.Duration.hours(1),
            refreshTokenValidity: aws_cdk_lib_1.Duration.days(30),
            preventUserExistenceErrors: true,
            // Custom attributes aren't readable/writable by a client unless
            // explicitly listed here, even ones marked mutable on the pool
            // itself - without this, the frontend's read/update of
            // hasCompletedSetup would fail with a permissions error.
            readAttributes: new cognito.ClientAttributes()
                .withStandardAttributes({ email: true, emailVerified: true })
                .withCustomAttributes("hasCompletedSetup"),
            writeAttributes: new cognito.ClientAttributes()
                .withStandardAttributes({ email: true })
                .withCustomAttributes("hasCompletedSetup"),
        });
    }
}
exports.Auth = Auth;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL2xpYi9jb25zdHJ1Y3RzL2F1dGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXVDO0FBQ3ZDLDZDQUFzRDtBQUN0RCxtREFBbUQ7QUFHbkQsTUFBYSxJQUFLLFNBQVEsc0JBQVM7SUFJakMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxHQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDckQsWUFBWSxFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsUUFBUTtZQUMzQyxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWEsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUU7WUFDOUIsVUFBVSxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRTtZQUMzQixrQkFBa0IsRUFBRTtnQkFDbEIsS0FBSyxFQUFFLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO2FBQ3pDO1lBQ0QsZ0JBQWdCLEVBQUU7Z0JBQ2hCLGdFQUFnRTtnQkFDaEUsaUVBQWlFO2dCQUNqRSxnRUFBZ0U7Z0JBQ2hFLGlFQUFpRTtnQkFDakUsbUVBQW1FO2dCQUNuRSxpQkFBaUIsRUFBRSxJQUFJLE9BQU8sQ0FBQyxlQUFlLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7YUFDbEU7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLEVBQUU7Z0JBQ2IsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsYUFBYSxFQUFFLElBQUk7Z0JBQ25CLGNBQWMsRUFBRSxJQUFJO2FBQ3JCO1lBQ0QsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlLENBQUMsVUFBVTtZQUNuRCxhQUFhLEVBQUUsR0FBRyxDQUFDLG1CQUFtQjtnQkFDcEMsQ0FBQyxDQUFDLDJCQUFhLENBQUMsTUFBTTtnQkFDdEIsQ0FBQyxDQUFDLDJCQUFhLENBQUMsT0FBTztZQUN6QiwrRUFBK0U7WUFDL0UsR0FBRyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUTtZQUN6QixlQUFlLEVBQUUsRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUU7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsc0VBQXNFO1FBQ3RFLHdFQUF3RTtRQUN4RSx1RUFBdUU7UUFDdkUsMkRBQTJEO1FBQzNELE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQW1DLENBQUM7UUFDM0UsV0FBVyxDQUFDLFlBQVksR0FBRyxHQUFHLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDO1FBRTlFLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsV0FBVyxFQUFFO1lBQ3pELGtCQUFrQixFQUFFLEdBQUcsR0FBRyxDQUFDLGNBQWMsYUFBYTtZQUN0RCxTQUFTLEVBQUU7Z0JBQ1QsT0FBTyxFQUFFLElBQUk7YUFDZDtZQUNELG1CQUFtQixFQUFFLHNCQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUN0QyxlQUFlLEVBQUUsc0JBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ2xDLG9CQUFvQixFQUFFLHNCQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN2QywwQkFBMEIsRUFBRSxJQUFJO1lBQ2hDLGdFQUFnRTtZQUNoRSwrREFBK0Q7WUFDL0QsdURBQXVEO1lBQ3ZELHlEQUF5RDtZQUN6RCxjQUFjLEVBQUUsSUFBSSxPQUFPLENBQUMsZ0JBQWdCLEVBQUU7aUJBQzNDLHNCQUFzQixDQUFDLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQzVELG9CQUFvQixDQUFDLG1CQUFtQixDQUFDO1lBQzVDLGVBQWUsRUFBRSxJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRTtpQkFDNUMsc0JBQXNCLENBQUMsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQ3ZDLG9CQUFvQixDQUFDLG1CQUFtQixDQUFDO1NBQzdDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQW5FRCxvQkFtRUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgUmVtb3ZhbFBvbGljeSwgRHVyYXRpb24gfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvXCI7XG5pbXBvcnQgeyBFbnZpcm9ubWVudENvbmZpZyB9IGZyb20gXCIuLi8uLi9jb25maWcvZW52aXJvbm1lbnRzXCI7XG5cbmV4cG9ydCBjbGFzcyBBdXRoIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sOiBjb2duaXRvLlVzZXJQb29sO1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2xDbGllbnQ6IGNvZ25pdG8uVXNlclBvb2xDbGllbnQ7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgY2ZnOiBFbnZpcm9ubWVudENvbmZpZykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgXCJVc2VyUG9vbFwiLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6IGAke2NmZy5yZXNvdXJjZVByZWZpeH0tdXNlcnNgLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBhdXRvVmVyaWZ5OiB7IGVtYWlsOiB0cnVlIH0sXG4gICAgICBzdGFuZGFyZEF0dHJpYnV0ZXM6IHtcbiAgICAgICAgZW1haWw6IHsgcmVxdWlyZWQ6IHRydWUsIG11dGFibGU6IHRydWUgfSxcbiAgICAgIH0sXG4gICAgICBjdXN0b21BdHRyaWJ1dGVzOiB7XG4gICAgICAgIC8vIFRyYWNrcyB3aGV0aGVyIHRoZSB1c2VyIGhhcyBjb21wbGV0ZWQgKG9yIGV4cGxpY2l0bHkgc2tpcHBlZClcbiAgICAgICAgLy8gdGhlIEdldHRpbmcgU2V0dXAgd2l6YXJkLCBzbyB0aGUgYXBwIGNhbiBzZW5kIGEgYnJhbmQtbmV3IHVzZXJcbiAgICAgICAgLy8gdGhlcmUgYXV0b21hdGljYWxseSB3aXRob3V0IG5lZWRpbmcgYSBzZXBhcmF0ZSBkYXRhYmFzZSB0YWJsZVxuICAgICAgICAvLyBqdXN0IHRvIHRyYWNrIHRoaXMgb25lIGZsYWcuIFwidHJ1ZVwiL1wiZmFsc2VcIiBhcyBhIHN0cmluZywgbm90IGFcbiAgICAgICAgLy8gcmVhbCBib29sZWFuIC0gQ29nbml0byBjdXN0b20gYXR0cmlidXRlcyBhcmUgc3RyaW5nL251bWJlciBvbmx5LlxuICAgICAgICBoYXNDb21wbGV0ZWRTZXR1cDogbmV3IGNvZ25pdG8uU3RyaW5nQXR0cmlidXRlKHsgbXV0YWJsZTogdHJ1ZSB9KSxcbiAgICAgIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDEwLFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZmcucmV0YWluRGF0YU9uRGVzdHJveVxuICAgICAgICA/IFJlbW92YWxQb2xpY3kuUkVUQUlOXG4gICAgICAgIDogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgLy8gTUZBOiBvcHRpb25hbCBzbyB3ZSBjYW4gcmVxdWlyZSBpdCB2aWEgYWRhcHRpdmUvcmlzay1iYXNlZCBhdXRoIG9uIFBsdXMgdGllclxuICAgICAgbWZhOiBjb2duaXRvLk1mYS5PUFRJT05BTCxcbiAgICAgIG1mYVNlY29uZEZhY3RvcjogeyBzbXM6IGZhbHNlLCBvdHA6IHRydWUgfSxcbiAgICB9KTtcblxuICAgIC8vIE5PVEU6IGFzIG9mIHRoaXMgd3JpdGluZywgQ0RLJ3MgTDIgY29uc3RydWN0IGRvZXNuJ3QgeWV0IGV4cG9zZSB0aGVcbiAgICAvLyBMaXRlL0Vzc2VudGlhbHMvUGx1cyBmZWF0dXJlIHBsYW4gZGlyZWN0bHkgLSBzZXQgdGhlIGZlYXR1cmUgcGxhbiB2aWFcbiAgICAvLyB0aGUgTDEgZXNjYXBlIGhhdGNoIChDZm5Vc2VyUG9vbCkgc28gd2UgY2FuIHRvZ2dsZSBhZHZhbmNlZCBzZWN1cml0eVxuICAgIC8vIHBlciBlbnZpcm9ubWVudCB3aXRob3V0IGhhbmQtd3JpdGluZyB0aGUgd2hvbGUgcmVzb3VyY2UuXG4gICAgY29uc3QgY2ZuVXNlclBvb2wgPSB0aGlzLnVzZXJQb29sLm5vZGUuZGVmYXVsdENoaWxkIGFzIGNvZ25pdG8uQ2ZuVXNlclBvb2w7XG4gICAgY2ZuVXNlclBvb2wudXNlclBvb2xUaWVyID0gY2ZnLmVuYWJsZUFkdmFuY2VkU2VjdXJpdHkgPyBcIlBMVVNcIiA6IFwiRVNTRU5USUFMU1wiO1xuXG4gICAgdGhpcy51c2VyUG9vbENsaWVudCA9IHRoaXMudXNlclBvb2wuYWRkQ2xpZW50KFwiV2ViQ2xpZW50XCIsIHtcbiAgICAgIHVzZXJQb29sQ2xpZW50TmFtZTogYCR7Y2ZnLnJlc291cmNlUHJlZml4fS13ZWItY2xpZW50YCxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGFjY2Vzc1Rva2VuVmFsaWRpdHk6IER1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgaWRUb2tlblZhbGlkaXR5OiBEdXJhdGlvbi5ob3VycygxKSxcbiAgICAgIHJlZnJlc2hUb2tlblZhbGlkaXR5OiBEdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxuICAgICAgLy8gQ3VzdG9tIGF0dHJpYnV0ZXMgYXJlbid0IHJlYWRhYmxlL3dyaXRhYmxlIGJ5IGEgY2xpZW50IHVubGVzc1xuICAgICAgLy8gZXhwbGljaXRseSBsaXN0ZWQgaGVyZSwgZXZlbiBvbmVzIG1hcmtlZCBtdXRhYmxlIG9uIHRoZSBwb29sXG4gICAgICAvLyBpdHNlbGYgLSB3aXRob3V0IHRoaXMsIHRoZSBmcm9udGVuZCdzIHJlYWQvdXBkYXRlIG9mXG4gICAgICAvLyBoYXNDb21wbGV0ZWRTZXR1cCB3b3VsZCBmYWlsIHdpdGggYSBwZXJtaXNzaW9ucyBlcnJvci5cbiAgICAgIHJlYWRBdHRyaWJ1dGVzOiBuZXcgY29nbml0by5DbGllbnRBdHRyaWJ1dGVzKClcbiAgICAgICAgLndpdGhTdGFuZGFyZEF0dHJpYnV0ZXMoeyBlbWFpbDogdHJ1ZSwgZW1haWxWZXJpZmllZDogdHJ1ZSB9KVxuICAgICAgICAud2l0aEN1c3RvbUF0dHJpYnV0ZXMoXCJoYXNDb21wbGV0ZWRTZXR1cFwiKSxcbiAgICAgIHdyaXRlQXR0cmlidXRlczogbmV3IGNvZ25pdG8uQ2xpZW50QXR0cmlidXRlcygpXG4gICAgICAgIC53aXRoU3RhbmRhcmRBdHRyaWJ1dGVzKHsgZW1haWw6IHRydWUgfSlcbiAgICAgICAgLndpdGhDdXN0b21BdHRyaWJ1dGVzKFwiaGFzQ29tcGxldGVkU2V0dXBcIiksXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==