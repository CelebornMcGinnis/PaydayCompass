import { Construct } from "constructs";
import { RemovalPolicy, Duration } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { EnvironmentConfig } from "../../config/environments";

export class Auth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, cfg: EnvironmentConfig) {
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
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      // MFA: optional so we can require it via adaptive/risk-based auth on Plus tier
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
    });

    // NOTE: as of this writing, CDK's L2 construct doesn't yet expose the
    // Lite/Essentials/Plus feature plan directly - set the feature plan via
    // the L1 escape hatch (CfnUserPool) so we can toggle advanced security
    // per environment without hand-writing the whole resource.
    const cfnUserPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.userPoolTier = cfg.enableAdvancedSecurity ? "PLUS" : "ESSENTIALS";

    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: `${cfg.resourcePrefix}-web-client`,
      authFlows: {
        userSrp: true,
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
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
