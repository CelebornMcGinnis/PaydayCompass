"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Frontend = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const s3 = require("aws-cdk-lib/aws-s3");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
class Frontend extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { cfg, restApi } = props;
        this.siteBucket = new s3.Bucket(this, "SiteBucket", {
            bucketName: `${cfg.resourcePrefix}-site-${cfg.envName}`.toLowerCase(),
            publicReadAccess: false, // CloudFront reaches it via Origin Access Control
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cfg.retainDataOnDestroy
                ? aws_cdk_lib_1.RemovalPolicy.RETAIN
                : aws_cdk_lib_1.RemovalPolicy.DESTROY,
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
                { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: aws_cdk_lib_1.Duration.seconds(0) },
                { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: aws_cdk_lib_1.Duration.seconds(0) },
            ],
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        });
    }
}
exports.Frontend = Frontend;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9saWIvY29uc3RydWN0cy9mcm9udGVuZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwyQ0FBdUM7QUFDdkMsNkNBQXNEO0FBQ3RELHlDQUF5QztBQUN6Qyx5REFBeUQ7QUFDekQsOERBQThEO0FBUzlELE1BQWEsUUFBUyxTQUFRLHNCQUFTO0lBSXJDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0I7UUFDNUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixNQUFNLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUvQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ2xELFVBQVUsRUFBRSxHQUFHLEdBQUcsQ0FBQyxjQUFjLFNBQVMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDLFdBQVcsRUFBRTtZQUNyRSxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsa0RBQWtEO1lBQzNFLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ2pELGFBQWEsRUFBRSxHQUFHLENBQUMsbUJBQW1CO2dCQUNwQyxDQUFDLENBQUMsMkJBQWEsQ0FBQyxNQUFNO2dCQUN0QixDQUFDLENBQUMsMkJBQWEsQ0FBQyxPQUFPO1lBQ3pCLGlCQUFpQixFQUFFLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtZQUMzQyxTQUFTLEVBQUUsR0FBRyxDQUFDLE9BQU8sS0FBSyxNQUFNO1NBQ2xDLENBQUMsQ0FBQztRQUVILE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxjQUFjLENBQUMsdUJBQXVCLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBRWpGLHFFQUFxRTtRQUNyRSxNQUFNLFNBQVMsR0FBRyxJQUFJLE9BQU8sQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7UUFFckQsMEVBQTBFO1FBQzFFLHlFQUF5RTtRQUN6RSxzRUFBc0U7UUFDdEUsc0VBQXNFO1FBQ3RFLHdFQUF3RTtRQUN4RSxpQ0FBaUM7UUFDakMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLFVBQVUsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQ3pFLFlBQVksRUFBRSxHQUFHLEdBQUcsQ0FBQyxjQUFjLG1CQUFtQjtZQUN0RCxJQUFJLEVBQUUsVUFBVSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUM7Ozs7OztPQU14QyxDQUFDO1NBQ0gsQ0FBQyxDQUFDO1FBRUgsZ0VBQWdFO1FBQ2hFLHNFQUFzRTtRQUN0RSxxRUFBcUU7UUFDckUsd0RBQXdEO1FBQ3hELEVBQUU7UUFDRixvRUFBb0U7UUFDcEUsa0NBQWtDO1FBQ2xDLHFFQUFxRTtRQUNyRSwwRUFBMEU7UUFDMUUsa0VBQWtFO1FBQ2xFLG9FQUFvRTtRQUNwRSxxRUFBcUU7UUFDckUscUVBQXFFO1FBQ3JFLHFFQUFxRTtRQUNyRSw2REFBNkQ7UUFDN0QsRUFBRTtRQUNGLG9FQUFvRTtRQUNwRSxzRUFBc0U7UUFDdEUsc0VBQXNFO1FBQ3RFLDREQUE0RDtRQUM1RCx5Q0FBeUM7UUFDekMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLFVBQVUsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNwRSxPQUFPLEVBQUUsR0FBRyxHQUFHLENBQUMsY0FBYyx1QkFBdUI7WUFDckQsaUJBQWlCLEVBQUUsWUFBWTtZQUMvQixXQUFXLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDMUQsb0VBQW9FO1lBQ3BFLGVBQWUsRUFBRTtnQkFDZixNQUFNLEVBQUUsUUFBUTtnQkFDaEIsb0JBQW9CLEVBQUUsVUFBVSxDQUFDLG9CQUFvQixDQUFDLGlCQUFpQjtnQkFDdkUsV0FBVyxFQUFFLFVBQVUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCO2FBQ3REO1lBQ0QsbUJBQW1CLEVBQUU7Z0JBQ25CLE9BQU8sRUFBRTtvQkFDUCxNQUFNLEVBQUUsU0FBUztvQkFDakIsb0JBQW9CLEVBQUUsVUFBVSxDQUFDLG9CQUFvQixDQUFDLGlCQUFpQjtvQkFDdkUseURBQXlEO29CQUN6RCxXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVcsQ0FBQyxnQkFBZ0I7b0JBQ3BELGNBQWMsRUFBRSxVQUFVLENBQUMsY0FBYyxDQUFDLFNBQVM7b0JBQ25ELG1CQUFtQixFQUFFLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyw2QkFBNkI7b0JBQ2pGLG9CQUFvQixFQUFFO3dCQUNwQixFQUFFLFFBQVEsRUFBRSxnQkFBZ0IsRUFBRSxTQUFTLEVBQUUsVUFBVSxDQUFDLGlCQUFpQixDQUFDLGNBQWMsRUFBRTtxQkFDdkY7aUJBQ0Y7YUFDRjtZQUNELGNBQWMsRUFBRTtnQkFDZCxpRUFBaUU7Z0JBQ2pFLEVBQUUsVUFBVSxFQUFFLEdBQUcsRUFBRSxrQkFBa0IsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCLEVBQUUsYUFBYSxFQUFFLEdBQUcsRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTtnQkFDdkcsRUFBRSxVQUFVLEVBQUUsR0FBRyxFQUFFLGtCQUFrQixFQUFFLEdBQUcsRUFBRSxnQkFBZ0IsRUFBRSxhQUFhLEVBQUUsR0FBRyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFO2FBQ3hHO1lBQ0QsVUFBVSxFQUFFLFVBQVUsQ0FBQyxVQUFVLENBQUMsZUFBZTtTQUNsRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE3RkQsNEJBNkZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFJlbW92YWxQb2xpY3ksIER1cmF0aW9uIH0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgKiBhcyBzMyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xuaW1wb3J0ICogYXMgb3JpZ2lucyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2luc1wiO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXlcIjtcbmltcG9ydCB7IEVudmlyb25tZW50Q29uZmlnIH0gZnJvbSBcIi4uLy4uL2NvbmZpZy9lbnZpcm9ubWVudHNcIjtcblxuaW50ZXJmYWNlIEZyb250ZW5kUHJvcHMge1xuICBjZmc6IEVudmlyb25tZW50Q29uZmlnO1xuICByZXN0QXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG59XG5cbmV4cG9ydCBjbGFzcyBGcm9udGVuZCBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBzaXRlQnVja2V0OiBzMy5CdWNrZXQ7XG4gIHB1YmxpYyByZWFkb25seSBkaXN0cmlidXRpb246IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBGcm9udGVuZFByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICBjb25zdCB7IGNmZywgcmVzdEFwaSB9ID0gcHJvcHM7XG5cbiAgICB0aGlzLnNpdGVCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIFwiU2l0ZUJ1Y2tldFwiLCB7XG4gICAgICBidWNrZXROYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LXNpdGUtJHtjZmcuZW52TmFtZX1gLnRvTG93ZXJDYXNlKCksXG4gICAgICBwdWJsaWNSZWFkQWNjZXNzOiBmYWxzZSwgLy8gQ2xvdWRGcm9udCByZWFjaGVzIGl0IHZpYSBPcmlnaW4gQWNjZXNzIENvbnRyb2xcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZmcucmV0YWluRGF0YU9uRGVzdHJveVxuICAgICAgICA/IFJlbW92YWxQb2xpY3kuUkVUQUlOXG4gICAgICAgIDogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZU9iamVjdHM6ICFjZmcucmV0YWluRGF0YU9uRGVzdHJveSxcbiAgICAgIHZlcnNpb25lZDogY2ZnLmVudk5hbWUgPT09IFwicHJvZFwiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgczNPcmlnaW4gPSBvcmlnaW5zLlMzQnVja2V0T3JpZ2luLndpdGhPcmlnaW5BY2Nlc3NDb250cm9sKHRoaXMuc2l0ZUJ1Y2tldCk7XG5cbiAgICAvLyBBUEkgR2F0ZXdheSdzIGRlZmF1bHQgZXhlY3V0ZS1hcGkgb3JpZ2luLCBwYXRoLXJvdXRlZCB1bmRlciAvYXBpLypcbiAgICBjb25zdCBhcGlPcmlnaW4gPSBuZXcgb3JpZ2lucy5SZXN0QXBpT3JpZ2luKHJlc3RBcGkpO1xuXG4gICAgLy8gVGhlIGZyb250ZW5kIG11c3QgY2FsbCBwYXRocyBsaWtlIC9hcGkvYWNjb3VudHMgc28gQ2xvdWRGcm9udCdzIFwiYXBpLypcIlxuICAgIC8vIGJlaGF2aW9yIHBhdHRlcm4gYmVsb3cgcGlja3MgdGhlbSBvdXQgYW5kIHJvdXRlcyB0byBBUEkgR2F0ZXdheSByYXRoZXJcbiAgICAvLyB0aGFuIFMzIC0gYnV0IEFQSSBHYXRld2F5J3Mgb3duIHJvdXRlcyBoYXZlIG5vIC9hcGkgcHJlZml4ICh0aGV5J3JlXG4gICAgLy8ganVzdCAvYWNjb3VudHMsIC9idWRnZXRzLCBldGMpLiBUaGlzIGZ1bmN0aW9uIHN0cmlwcyBpdCBhdCB0aGUgZWRnZVxuICAgIC8vIGJlZm9yZSB0aGUgcmVxdWVzdCByZWFjaGVzIHRoZSBvcmlnaW4sIHNvIGJvdGggc2lkZXMgY2FuIHVzZSB0aGUgcGF0aFxuICAgIC8vIHNoYXBlIHRoYXQncyBuYXR1cmFsIGZvciB0aGVtLlxuICAgIGNvbnN0IHN0cmlwQXBpUHJlZml4Rm4gPSBuZXcgY2xvdWRmcm9udC5GdW5jdGlvbih0aGlzLCBcIlN0cmlwQXBpUHJlZml4Rm5cIiwge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9LXN0cmlwLWFwaS1wcmVmaXhgLFxuICAgICAgY29kZTogY2xvdWRmcm9udC5GdW5jdGlvbkNvZGUuZnJvbUlubGluZShgXG4gICAgICAgIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQpIHtcbiAgICAgICAgICB2YXIgcmVxdWVzdCA9IGV2ZW50LnJlcXVlc3Q7XG4gICAgICAgICAgcmVxdWVzdC51cmkgPSByZXF1ZXN0LnVyaS5yZXBsYWNlKC9eXFxcXC9hcGkvLCAnJykgfHwgJy8nO1xuICAgICAgICAgIHJldHVybiByZXF1ZXN0O1xuICAgICAgICB9XG4gICAgICBgKSxcbiAgICB9KTtcblxuICAgIC8vIFByaWNpbmcgcGxhbjogdGhpcyBkaXN0cmlidXRpb24gaXMgc3Vic2NyaWJlZCB0byBDbG91ZEZyb250J3NcbiAgICAvLyBmbGF0LXJhdGUgRlJFRSBwbGFuIChsYXVuY2hlZCBOb3YgMjAyNSAtICQwL21vbnRoLCAxMDBHQiB0cmFuc2ZlciArXG4gICAgLy8gMU0gcmVxdWVzdHMsIGJ1bmRsZXMgV0FGL0REb1MgcHJvdGVjdGlvbi9Sb3V0ZSA1My9hIFRMUyBjZXJ0KSwgc2V0XG4gICAgLy8gbWFudWFsbHkgdmlhIHRoZSBBV1MgQ29uc29sZSByYXRoZXIgdGhhbiBoZXJlIGluIENESy5cbiAgICAvL1xuICAgIC8vIENESyBoYXMgTk8gbmF0aXZlIHN1cHBvcnQgZm9yIHRoaXMgYXMgb2YgdGhpcyB3cml0aW5nIC0gY29uZmlybWVkXG4gICAgLy8gdmlhIHRoZSBvcGVuIGZlYXR1cmUgcmVxdWVzdCBhdFxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvMzc4NTcuIFRoZSBvbmx5IHByb2dyYW1tYXRpY1xuICAgIC8vIHBhdGggaXMgYSBjdXN0b20gcmVzb3VyY2UgY2FsbGluZyBwcmljaW5ncGxhbm1hbmFnZXI6Q3JlYXRlU3Vic2NyaXB0aW9uXG4gICAgLy8gZGlyZWN0bHksIHdoaWNoIHdhc24ndCBpbXBsZW1lbnRlZCBoZXJlIGJlY2F1c2UgdGhhdCBBUEkgaXMgbmV3XG4gICAgLy8gZW5vdWdoIHRoYXQgaXRzIGV4YWN0IHJlcXVlc3QvcmVzcG9uc2Ugc2hhcGUgaGFzbid0IGJlZW4gdmVyaWZpZWRcbiAgICAvLyBhZ2FpbnN0IGEgcmVhbCBhY2NvdW50IGZyb20gdGhpcyBlbnZpcm9ubWVudCAtIHNoaXBwaW5nIHVudmVyaWZpZWRcbiAgICAvLyBJQU0tcGVybWlzc2lvbmVkIEFQSSBjYWxscyBmZWx0IGxpa2UgdGhlIHdyb25nIHRyYWRlb2ZmIHZlcnN1cyBvbmVcbiAgICAvLyBtYW51YWwgQ29uc29sZSBzdGVwIHBlciBlbnZpcm9ubWVudC4gUmV2aXNpdCBvbmNlIENESyBzaGlwcyBuYXRpdmVcbiAgICAvLyBzdXBwb3J0LCBvciBpZiB0aGlzIGJlY29tZXMgd29ydGggdGhlIHZlcmlmaWNhdGlvbiBlZmZvcnQuXG4gICAgLy9cbiAgICAvLyBPcGVyYXRpb25hbCBpbXBsaWNhdGlvbiB3b3J0aCByZW1lbWJlcmluZzogc2luY2UgdGhlIHN1YnNjcmlwdGlvblxuICAgIC8vIGlzbid0IENESy1tYW5hZ2VkLCBgY2RrIGRlc3Ryb3lgIG9uIHRoaXMgc3RhY2sgd2lsbCBOT1QgY2FuY2VsIGl0IC1cbiAgICAvLyBpZiB5b3UgZXZlciB0ZWFyIGRvd24gYW5kIHJlY3JlYXRlIHRoaXMgZGlzdHJpYnV0aW9uLCBjaGVjayB3aGV0aGVyXG4gICAgLy8gdGhlIG9sZCBzdWJzY3JpcHRpb24gbmVlZHMgbWFudWFsIGNhbmNlbGxhdGlvbiBmaXJzdCwgYW5kXG4gICAgLy8gcmUtc3Vic2NyaWJlIHRoZSBuZXcgb25lIGFmdGVyIGRlcGxveS5cbiAgICB0aGlzLmRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCBcIkRpc3RyaWJ1dGlvblwiLCB7XG4gICAgICBjb21tZW50OiBgJHtjZmcucmVzb3VyY2VQcmVmaXh9IHVuaWZpZWQgZGlzdHJpYnV0aW9uYCxcbiAgICAgIGRlZmF1bHRSb290T2JqZWN0OiBcImluZGV4Lmh0bWxcIixcbiAgICAgIGRvbWFpbk5hbWVzOiBjZmcuZG9tYWluTmFtZSA/IFtjZmcuZG9tYWluTmFtZV0gOiB1bmRlZmluZWQsXG4gICAgICAvLyBjZXJ0aWZpY2F0ZTogcGFzcyBhbiBBQ00gY2VydCBoZXJlIG9uY2UgYSBjdXN0b20gZG9tYWluIGlzIHNldCB1cFxuICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgIG9yaWdpbjogczNPcmlnaW4sXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgIH0sXG4gICAgICBhZGRpdGlvbmFsQmVoYXZpb3JzOiB7XG4gICAgICAgIFwiYXBpLypcIjoge1xuICAgICAgICAgIG9yaWdpbjogYXBpT3JpZ2luLFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIC8vIEFQSSByZXNwb25zZXMgYXJlIHBlci11c2VyL3BlcnNvbmFsaXplZCAtIGRvIG5vdCBjYWNoZVxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxuICAgICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSX0VYQ0VQVF9IT1NUX0hFQURFUixcbiAgICAgICAgICBmdW5jdGlvbkFzc29jaWF0aW9uczogW1xuICAgICAgICAgICAgeyBmdW5jdGlvbjogc3RyaXBBcGlQcmVmaXhGbiwgZXZlbnRUeXBlOiBjbG91ZGZyb250LkZ1bmN0aW9uRXZlbnRUeXBlLlZJRVdFUl9SRVFVRVNUIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICAvLyBTUEEgY2xpZW50LXNpZGUgcm91dGluZzogdW5rbm93biBwYXRocyBmYWxsIGJhY2sgdG8gaW5kZXguaHRtbFxuICAgICAgICB7IGh0dHBTdGF0dXM6IDQwMywgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsIHJlc3BvbnNlUGFnZVBhdGg6IFwiL2luZGV4Lmh0bWxcIiwgdHRsOiBEdXJhdGlvbi5zZWNvbmRzKDApIH0sXG4gICAgICAgIHsgaHR0cFN0YXR1czogNDA0LCByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCwgcmVzcG9uc2VQYWdlUGF0aDogXCIvaW5kZXguaHRtbFwiLCB0dGw6IER1cmF0aW9uLnNlY29uZHMoMCkgfSxcbiAgICAgIF0sXG4gICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfMTAwLFxuICAgIH0pO1xuICB9XG59XG4iXX0=