import { Construct } from "constructs";
import { RemovalPolicy, Duration } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { EnvironmentConfig } from "../../config/environments";

interface FrontendProps {
  cfg: EnvironmentConfig;
  restApi: apigateway.RestApi;
}

export class Frontend extends Construct {
  public readonly siteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendProps) {
    super(scope, id);
    const { cfg, restApi } = props;

    this.siteBucket = new s3.Bucket(this, "SiteBucket", {
      bucketName: `${cfg.resourcePrefix}-site-${cfg.envName}`.toLowerCase(),
      publicReadAccess: false, // CloudFront reaches it via Origin Access Control
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cfg.retainDataOnDestroy
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      autoDeleteObjects: !cfg.retainDataOnDestroy,
      versioned: cfg.envName === "prod",
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket);

    // API Gateway's default execute-api origin, path-routed under /api/*
    const apiOrigin = new origins.RestApiOrigin(restApi);

    // The frontend must call paths like /api/accounts so CloudFront's "api/*"
    // behavior pattern below picks them out and routes to API Gateway rather
    // than S3 - but API Gateway's own routes have no /api prefix (they're
    // just /accounts, /budgets, etc). This function strips it at the edge
    // before the request reaches the origin, so both sides can use the path
    // shape that's natural for them.
    const stripApiPrefixFn = new cloudfront.Function(this, "StripApiPrefixFn", {
      functionName: `${cfg.resourcePrefix}-strip-api-prefix`,
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          request.uri = request.uri.replace(/^\\/api/, '') || '/';
          return request;
        }
      `),
    });

    // Pricing plan: this distribution is subscribed to CloudFront's
    // flat-rate FREE plan (launched Nov 2025 - $0/month, 100GB transfer +
    // 1M requests, bundles WAF/DDoS protection/Route 53/a TLS cert), set
    // manually via the AWS Console rather than here in CDK.
    //
    // CDK has NO native support for this as of this writing - confirmed
    // via the open feature request at
    // https://github.com/aws/aws-cdk/issues/37857. The only programmatic
    // path is a custom resource calling pricingplanmanager:CreateSubscription
    // directly, which wasn't implemented here because that API is new
    // enough that its exact request/response shape hasn't been verified
    // against a real account from this environment - shipping unverified
    // IAM-permissioned API calls felt like the wrong tradeoff versus one
    // manual Console step per environment. Revisit once CDK ships native
    // support, or if this becomes worth the verification effort.
    //
    // Operational implication worth remembering: since the subscription
    // isn't CDK-managed, `cdk destroy` on this stack will NOT cancel it -
    // if you ever tear down and recreate this distribution, check whether
    // the old subscription needs manual cancellation first, and
    // re-subscribe the new one after deploy.
    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${cfg.resourcePrefix} unified distribution`,
      defaultRootObject: "index.html",
      domainNames: cfg.domainName ? [cfg.domainName] : undefined,
      // certificate: pass an ACM cert here once a custom domain is set up
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          // API responses are per-user/personalized - do not cache
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            { function: stripApiPrefixFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          ],
        },
      },
      errorResponses: [
        // SPA client-side routing: unknown paths fall back to index.html
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
  }
}
