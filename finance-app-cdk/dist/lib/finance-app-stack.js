"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinanceAppStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const data_tables_1 = require("./constructs/data-tables");
const auth_1 = require("./constructs/auth");
const lambdas_1 = require("./constructs/lambdas");
const api_1 = require("./constructs/api");
const frontend_1 = require("./constructs/frontend");
class FinanceAppStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { cfg } = props;
        const tables = new data_tables_1.DataTables(this, "DataTables", cfg);
        const auth = new auth_1.Auth(this, "Auth", cfg);
        const lambdas = new lambdas_1.Lambdas(this, "Lambdas", {
            cfg,
            tables,
            userPool: auth.userPool,
        });
        const api = new api_1.Api(this, "Api", {
            cfg,
            userPool: auth.userPool,
            lambdas,
        });
        const frontend = new frontend_1.Frontend(this, "Frontend", {
            cfg,
            restApi: api.restApi,
        });
        // Apply Environment/Project tags to every resource in this stack
        Object.entries(cfg.tags).forEach(([key, value]) => {
            aws_cdk_lib_1.Tags.of(this).add(key, value);
        });
        new aws_cdk_lib_1.CfnOutput(this, "SiteUrl", {
            value: `https://${frontend.distribution.distributionDomainName}`,
            description: "Unified CloudFront URL for the app (frontend + /api/*)",
        });
        new aws_cdk_lib_1.CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
        new aws_cdk_lib_1.CfnOutput(this, "UserPoolClientId", { value: auth.userPoolClient.userPoolClientId });
        new aws_cdk_lib_1.CfnOutput(this, "SiteBucketName", { value: frontend.siteBucket.bucketName });
    }
}
exports.FinanceAppStack = FinanceAppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmluYW5jZS1hcHAtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9saWIvZmluYW5jZS1hcHAtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsNkNBQWlFO0FBRWpFLDBEQUFzRDtBQUN0RCw0Q0FBeUM7QUFDekMsa0RBQStDO0FBQy9DLDBDQUF1QztBQUN2QyxvREFBaUQ7QUFNakQsTUFBYSxlQUFnQixTQUFRLG1CQUFLO0lBQ3hDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBMkI7UUFDbkUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDeEIsTUFBTSxFQUFFLEdBQUcsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUV0QixNQUFNLE1BQU0sR0FBRyxJQUFJLHdCQUFVLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRSxHQUFHLENBQUMsQ0FBQztRQUN2RCxNQUFNLElBQUksR0FBRyxJQUFJLFdBQUksQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3pDLE1BQU0sT0FBTyxHQUFHLElBQUksaUJBQU8sQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFO1lBQzNDLEdBQUc7WUFDSCxNQUFNO1lBQ04sUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1NBQ3hCLENBQUMsQ0FBQztRQUNILE1BQU0sR0FBRyxHQUFHLElBQUksU0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDL0IsR0FBRztZQUNILFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixPQUFPO1NBQ1IsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsSUFBSSxtQkFBUSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDOUMsR0FBRztZQUNILE9BQU8sRUFBRSxHQUFHLENBQUMsT0FBTztTQUNyQixDQUFDLENBQUM7UUFFSCxpRUFBaUU7UUFDakUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUUsRUFBRTtZQUNoRCxrQkFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2hDLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSx1QkFBUyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDN0IsS0FBSyxFQUFFLFdBQVcsUUFBUSxDQUFDLFlBQVksQ0FBQyxzQkFBc0IsRUFBRTtZQUNoRSxXQUFXLEVBQUUsd0RBQXdEO1NBQ3RFLENBQUMsQ0FBQztRQUNILElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUN2RSxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDO1FBQ3pGLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLFVBQVUsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBQ25GLENBQUM7Q0FDRjtBQW5DRCwwQ0FtQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIENmbk91dHB1dCwgVGFncyB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgRW52aXJvbm1lbnRDb25maWcgfSBmcm9tIFwiLi4vY29uZmlnL2Vudmlyb25tZW50c1wiO1xuaW1wb3J0IHsgRGF0YVRhYmxlcyB9IGZyb20gXCIuL2NvbnN0cnVjdHMvZGF0YS10YWJsZXNcIjtcbmltcG9ydCB7IEF1dGggfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL2F1dGhcIjtcbmltcG9ydCB7IExhbWJkYXMgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL2xhbWJkYXNcIjtcbmltcG9ydCB7IEFwaSB9IGZyb20gXCIuL2NvbnN0cnVjdHMvYXBpXCI7XG5pbXBvcnQgeyBGcm9udGVuZCB9IGZyb20gXCIuL2NvbnN0cnVjdHMvZnJvbnRlbmRcIjtcblxuZXhwb3J0IGludGVyZmFjZSBGaW5hbmNlQXBwU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICBjZmc6IEVudmlyb25tZW50Q29uZmlnO1xufVxuXG5leHBvcnQgY2xhc3MgRmluYW5jZUFwcFN0YWNrIGV4dGVuZHMgU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRmluYW5jZUFwcFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcbiAgICBjb25zdCB7IGNmZyB9ID0gcHJvcHM7XG5cbiAgICBjb25zdCB0YWJsZXMgPSBuZXcgRGF0YVRhYmxlcyh0aGlzLCBcIkRhdGFUYWJsZXNcIiwgY2ZnKTtcbiAgICBjb25zdCBhdXRoID0gbmV3IEF1dGgodGhpcywgXCJBdXRoXCIsIGNmZyk7XG4gICAgY29uc3QgbGFtYmRhcyA9IG5ldyBMYW1iZGFzKHRoaXMsIFwiTGFtYmRhc1wiLCB7XG4gICAgICBjZmcsXG4gICAgICB0YWJsZXMsXG4gICAgICB1c2VyUG9vbDogYXV0aC51c2VyUG9vbCxcbiAgICB9KTtcbiAgICBjb25zdCBhcGkgPSBuZXcgQXBpKHRoaXMsIFwiQXBpXCIsIHtcbiAgICAgIGNmZyxcbiAgICAgIHVzZXJQb29sOiBhdXRoLnVzZXJQb29sLFxuICAgICAgbGFtYmRhcyxcbiAgICB9KTtcbiAgICBjb25zdCBmcm9udGVuZCA9IG5ldyBGcm9udGVuZCh0aGlzLCBcIkZyb250ZW5kXCIsIHtcbiAgICAgIGNmZyxcbiAgICAgIHJlc3RBcGk6IGFwaS5yZXN0QXBpLFxuICAgIH0pO1xuXG4gICAgLy8gQXBwbHkgRW52aXJvbm1lbnQvUHJvamVjdCB0YWdzIHRvIGV2ZXJ5IHJlc291cmNlIGluIHRoaXMgc3RhY2tcbiAgICBPYmplY3QuZW50cmllcyhjZmcudGFncykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBUYWdzLm9mKHRoaXMpLmFkZChrZXksIHZhbHVlKTtcbiAgICB9KTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJTaXRlVXJsXCIsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Zyb250ZW5kLmRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogXCJVbmlmaWVkIENsb3VkRnJvbnQgVVJMIGZvciB0aGUgYXBwIChmcm9udGVuZCArIC9hcGkvKilcIixcbiAgICB9KTtcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7IHZhbHVlOiBhdXRoLnVzZXJQb29sLnVzZXJQb29sSWQgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcIlVzZXJQb29sQ2xpZW50SWRcIiwgeyB2YWx1ZTogYXV0aC51c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkIH0pO1xuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJTaXRlQnVja2V0TmFtZVwiLCB7IHZhbHVlOiBmcm9udGVuZC5zaXRlQnVja2V0LmJ1Y2tldE5hbWUgfSk7XG4gIH1cbn1cbiJdfQ==