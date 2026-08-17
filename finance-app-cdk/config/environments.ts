export type EnvironmentName = "beta" | "prod";

export interface EnvironmentConfig {
  envName: EnvironmentName;
  /** Used to prefix every resource name, e.g. finance-app-beta-accounts */
  resourcePrefix: string;
  /** Custom domain for this environment's CloudFront distribution, if any */
  domainName?: string;
  /** Whether DynamoDB tables/S3 buckets are retained on stack deletion */
  retainDataOnDestroy: boolean;
  /** Cognito advanced security (Plus tier) - can be toggled per environment for cost control */
  enableAdvancedSecurity: boolean;
  /** Email address that receives CloudWatch alarm notifications (unattended job failures) - a real monitored inbox, NOT the SES from-address below */
  alertEmail?: string;
  /** From-address for emails the app sends TO users (budget alerts, fund-movement notifications) - must be a verified SES identity/domain */
  sesFromAddress: string;
  tags: Record<string, string>;
}

const baseTags = (envName: EnvironmentName) => ({
  Project: "finance-app",
  Environment: envName,
  ManagedBy: "cdk",
});

export const environments: Record<EnvironmentName, EnvironmentConfig> = {
  beta: {
    envName: "beta",
    resourcePrefix: "finance-app-beta",
    // domainName: "beta.yourdomain.com",
    retainDataOnDestroy: false,
    enableAdvancedSecurity: false, // save Cognito Plus cost in beta; flip on to test MFA flows
    alertEmail: "Celeborn.mcginnis@gmail.com", // also gets beta alarm emails now, same address as prod
    sesFromAddress: "no-reply@mcginnisarchitecture.com",
    tags: baseTags("beta"),
  },
  prod: {
    envName: "prod",
    resourcePrefix: "finance-app-prod",
    // domainName: "app.yourdomain.com",
    retainDataOnDestroy: true, // never auto-delete real financial data
    enableAdvancedSecurity: true,
    alertEmail: "Celeborn.mcginnis@gmail.com",
    sesFromAddress: "no-reply@mcginnisarchitecture.com",
    tags: baseTags("prod"),
  },
};
