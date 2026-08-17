# Beta Deployment Checklist

## READ THIS FIRST — the CORS bug that's been blocking every real API call

If you're coming back to this after "Failed to fetch" / "Couldn't load"
errors: the root cause has been found and fixed, and it explains
**everything** you've been seeing, not just one screen.

API Gateway's `defaultCorsPreflightOptions` (see `lib/constructs/api.ts`)
only auto-configures the `OPTIONS` preflight request for each route - it
does NOT add `Access-Control-Allow-Origin` to the actual GET/POST/PUT/
DELETE responses. That's entirely up to what the Lambda itself returns.
Every Lambda in this project built its own local `_response()` helper,
and none of them ever included that header. The preflight check always
passed (giving the browser the green light to send the real request), but
the real response then came back without the required header every single
time, and the browser discarded it before your JavaScript ever saw it -
regardless of which screen, which environment, or which domain you used
to access the site. This has been true since the very first Lambda was
written in this project. It was never caught earlier because every
verification method used throughout this project (`cdk synth`,
`py_compile`, reproduction scripts) tests logic, not real browser CORS
enforcement - only an actual browser hitting a real deployed endpoint
exercises this at all.

**Fixed**: added `lambda-layers/finance-common/python/finance_common/http_response.py`,
a shared `response()` helper that includes the CORS headers, and migrated
every API-Gateway-facing Lambda (15 of the 17 - `notifications-fn` and
`recurring-processor-fn` are invoked internally, never by a browser, so
they were correctly left alone) to use it instead of their own local
copy. Along the way, found and fixed a related, separate gap: 6 of those
Lambdas (`accounts-fn`, `external-bank-accounts-fn`, `planned-expenses-fn`,
`reconcile-fn`, `user-preferences-fn`, `deletion-fn`) had never had the
shared Lambda Layer attached at all, because they'd never needed anything
from it before this fix - would have crashed with `ModuleNotFoundError`
had that been missed. All of this was verified concretely, not just
reasoned about: Python syntax, a runtime import simulation with the layer
on the path for every affected function, an actual reproduction test
confirming `Access-Control-Allow-Origin` is present in a real response,
and confirmation directly in the synthesized CloudFormation template that
all 6 previously-missing functions now have the layer attached.

**This requires a full backend redeploy** - `npm run deploy:beta`. Given
the scope (a new shared-layer file, 17 Lambda source files touched, 6
functions gaining a layer attachment for the first time), this deploy
should NOT come back `(no changes)` - if it does, something is wrong and
worth stopping to investigate before assuming this is fixed.

## Everything below this point is the original step-by-step checklist



Everything needed to get beta running for real, in order. Written for
someone doing this for the first time - each step says what to run and
what to check before moving to the next one.

## 0. Before you start

- [x] AWS credentials configured locally (`aws configure` or equivalent) for
      whichever AWS account this deploys into
- [x] Confirm `config/environments.ts` has your real values:
  - `alertEmail` is set on both `beta` and `prod` (Celeborn.mcginnis@gmail.com)
    - CloudWatch alarms from either environment now reach the same inbox
  - `sesFromAddress` is `no-reply@mcginnisarchitecture.com` on both
    environments - domain-verified with DKIM in an earlier session, so this
    should just work
- [ ] Node 22+ installed - see "Installing Node 22 locally" further down
      if you need to set this up (also matches the CI/CD workflow's
      `node-version: "22"`)

## Real bugs found via live testing (first real user session)

Two Lambdas were missing the Decimal-serialization pattern every other
Lambda in this project has (a `_decimal_default` helper passed as
`json.dumps`'s `default=`) - boto3's DynamoDB resource always returns
numeric attributes as Python `Decimal`, which the standard `json` module
cannot serialize without it. Both crashed on real data despite passing
every synth/compile/unit check, because those checks never exercised a
live DynamoDB round-trip:

- **`accounts-fn`** - `GET /accounts` crashed (500) for any account, since
  boto3 returns `balance` as `Decimal` even when it's zero. Discovered
  because a real user completed Getting Setup (account creation via
  `POST`, which never round-trips through DynamoDB before responding, so
  it never hit this) and then saw the Dashboard's account list (`GET`,
  which does) fail immediately. Also fixed a second bug in the same file:
  `_create_account` read `body.get("startingBalance", 0)`, but the
  frontend has always sent the field as `balance` - every account was
  silently created with a $0 balance regardless of what was entered,
  and separately, an entered decimal amount (e.g. $250.75) would have
  crashed `put_item` outright (boto3 rejects raw Python floats) had the
  field name matched.
- **`peer-notifications-fn`** - the identical read-side bug on
  `GET /peer-notifications` (the `amount` field), found by auditing every
  other Lambda for the same missing pattern rather than waiting to
  rediscover it screen by screen. Also had the write-side version of the
  accounts-fn bug: `_create` never converted the incoming `amount` to
  `Decimal` before `put_item`, which would have crashed outright on any
  non-whole-dollar amount (e.g. $42.50).

Both fixes verified with an actual reproduction test (not just re-running
synth) - confirmed the exact `TypeError: Object of type Decimal is not
JSON serializable` reproduces against the old code and is resolved by the
fix, using a fake DynamoDB-shaped item with a real `Decimal` field.

**This requires a backend redeploy** (`npm run deploy:beta`) - a frontend
rebuild alone won't pick this up, since the bug is in Lambda code.

## 1. Bootstrap CDK (one-time per AWS account/region, skip if already done)

```bash
cd finance-app-cdk
npm install
npx cdk bootstrap
```

## 2. Deploy the backend to beta

```bash
npm run deploy:beta
```

This takes several minutes - it's creating the User Pool, all 12 DynamoDB
tables, 21 Lambda functions plus the shared layer, API Gateway, CloudFront,
S3, the observability stack (SNS/alarms/DLQ), and the SES IAM policy.

**Watch for this specifically:** if `finance-app-beta` has ever been
deployed before (even without real users), Cognito will REPLACE the User
Pool because of the `hasCompletedSetup` custom attribute added this
session - that's expected and fine here since there's no real user data
yet, but the deploy output will show a new `UserPoolId` and
`UserPoolClientId`, not the old ones. Use the NEW ones in step 4.

**Expected noisy output that is NOT an error** - the deploy is only
actually broken if you don't see a green `✅  FinanceApp-Beta` with a
full `Outputs:` block at the end. The `npm audit`/`npm install -g
aws-cdk` items below are still expected; the `logRetention` deprecation
warnings that used to appear here are gone as of this fix (see
"Node 22 and the logRetention fix" below) - if you see them again, something
regressed.
- `npm audit`: a high-severity finding in `brace-expansion` - this is
  bundled INSIDE `aws-cdk-lib` itself (CDK's own build tooling), not a
  direct dependency and not part of anything deployed to Lambda. `npm
  audit fix` correctly reports it can't fix this automatically - the only
  real fix is a future `aws-cdk-lib` release with a patched bundle. Low
  real-world risk; not worth blocking on.
- `npm install -g aws-cdk` failing with `EACCES` in CloudShell - that's
  trying to upgrade the GLOBAL CDK CLI, which CloudShell's default user
  can't write to without `sudo`. Irrelevant either way: `npm run
  deploy:beta` runs `npx cdk`, which uses the PROJECT-LOCAL CDK version
  from `node_modules`, not the global one.

## Node 22 and the logRetention fix

Two things fixed after the first real deploy attempt:

- **Node version**: both `package.json`s now declare `"engines": {
  "node": ">=22" }`, and both GitHub Actions workflows deploy on Node 22.
  The AWS SDK v3 (which the CDK CLI and Lambda tooling depend on) stops
  receiving updates on Node <22 starting January 2027, so this was worth
  fixing now rather than later. **Install Node 22 locally before your
  next deploy** - see below.
- **`logRetention` deprecation**: every Lambda's log retention is now set
  via an explicit `logs.LogGroup` + the `logGroup` prop, instead of the
  deprecated `logRetention` prop. Functionally identical (same retention
  periods: 2 weeks beta, 3 months prod) - this was purely to stop the
  ~34 repeated deprecation warnings that cluttered every synth/deploy.
  Confirmed via `cdk synth`: zero deprecation warnings now, 17 LogGroup
  resources present (one per Lambda function) in both environments.

### Installing Node 22 locally

If `node --version` shows anything below 22, or `npm` isn't found at all
(`zsh: command not found: npm` means Node was never installed on this
machine, not just an old version):

```bash
# Install nvm (Node Version Manager) if you don't have it - lets you
# switch Node versions per-project without fighting your system installer
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Restart your terminal, then:
nvm install 22
nvm use 22
node --version   # should print v22.x.x
npm --version    # npm comes bundled with Node - if this still fails
                  # after nvm install, something's wrong with the nvm
                  # install itself, not with this project
```

nvm is the recommended route over a system package manager install
(`brew install node`, etc.) specifically because it makes bumping the
Node version later (when 22 itself eventually ages out) a one-line change
instead of an OS-level reinstall.

### Known one-time issue: "LogGroup already exists" on the first deploy after this fix

If you deployed beta *before* the `logRetention` → `logGroup` fix and are
now deploying again, CloudFormation will fail with something like:

```
Resource of type 'AWS::Logs::LogGroup' with identifier
'/aws/lambda/finance-app-beta-accounts-fn' already exists.
```

This isn't a bug - `logRetention` never created a CloudFormation-managed
log group; Lambda auto-creates `/aws/lambda/<function-name>` on first
invocation, and the old approach just set retention on it after the fact
via a background custom resource. The new code creates an *explicit*
`AWS::Logs::LogGroup` with that same name, and CloudFormation won't
silently adopt a resource it doesn't already track.

**One-time fix** (safe - only removes log history, not the functions or
any application data):

```bash
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/finance-app-beta-" \
  --query 'logGroups[].logGroupName' \
  --output text | tr '\t' '\n' | xargs -I{} aws logs delete-log-group --log-group-name {}
```

Then `npm run deploy:beta` again. This only ever needs doing once for
beta - prod's first deploy creates these fresh with no conflict, since
it's never been deployed under the old approach.

- [x] Deploy completes without errors (deprecation/npm-audit noise is
      expected - see above; the real signal is the `✅  FinanceApp-Beta`
      line with a full `Outputs:` block, which you got)
- [x] Note the CloudFormation outputs - you need `UserPoolId`,
      `UserPoolClientId`, and the CloudFront URL (`SiteUrl` or similar)

## 3. Verify the backend deployed correctly (AWS Console spot-check)

- [ ] Cognito → User Pool exists, has the `hasCompletedSetup` custom
      attribute under "Sign-up experience" → "Custom attributes"
- [ ] DynamoDB → all 12 tables exist with the `finance-app-beta-*` prefix
- [ ] Lambda → 21 functions exist, each `finance-app-beta-*`; spot-check
      one function's configuration to confirm the `finance_common` layer
      is attached
- [ ] CloudWatch → Alarms → the two alarms exist
      (`Finance App (BETA) - recurring-processor-fn is failing` and
      the notifications-fn equivalent) - only if you set `alertEmail` for
      beta in step 0
- [ ] SES → sending identity `no-reply@mcginnisarchitecture.com` shows
      Verified with DKIM Verified (should already be true from the earlier
      domain verification)
- [ ] API Gateway → the REST API exists with routes matching what's in
      this README's route reference

## 4. Configure and build the frontend

```bash
cd ../finance-app-frontend
npm install
cp .env.example .env.local
```

**Expected noise from `npm install`, verified not to need action:**
- A `recharts@2.x` deprecation warning - cosmetic, 2.x still works fine
- `4 vulnerabilities (3 moderate, 1 high)` from `npm audit` - all in
  `esbuild`/`vite` (dev-server only, never affects the deployed build) and
  `react-router` (both CVEs require usage patterns - user-controlled
  redirect targets, SSR - this app doesn't have). The "fix" was actually
  tested and found to trade these for a *higher-severity* CVE in a
  react-router line that isn't fully stable yet - don't run `npm audit fix
  --force` here. Revisit as its own deliberate task once the ecosystem
  settles, not as part of a routine deploy.
- On newer npm versions: a warning that `esbuild`'s and `fsevents`'
  install scripts were blocked. If `npm run build` then fails, run
  `npm install-scripts approve esbuild`, `npm install-scripts approve
  fsevents`, then `npm install` again.

Fill in `.env.local` with the values from step 2's deploy output:

| `.env.local` variable | Where it comes from |
|---|---|
| `VITE_COGNITO_USER_POOL_ID` | CDK output `UserPoolId` |
| `VITE_COGNITO_CLIENT_ID` | CDK output `UserPoolClientId` |
| `VITE_API_BASE_URL` | The CloudFront URL + `/api` |

```bash
npm run build
```

- [ ] Build completes with no errors (should match what's already been
      verified locally throughout this project)

## 5. Deploy the frontend to S3 + invalidate CloudFront

```bash
aws s3 sync dist/ s3://<SiteBucketName from CDK output> --delete
aws cloudfront create-invalidation --distribution-id <CloudFront distribution ID> --paths "/*"
```

(Or trigger the frontend repo's GitHub Actions workflow instead - it does
exactly this, but needs the repo secrets listed in
`.github/workflows/deploy.yml` set first: `S3_BUCKET_NAME`,
`CLOUDFRONT_DISTRIBUTION_ID`, the three `VITE_*` values, plus AWS
credentials.)

- [ ] **CloudFront pricing plan (manual, one-time per environment):**
      after the distribution exists, subscribe it to the flat-rate FREE
      plan via AWS Console → CloudFront → your distribution → Pricing
      Plan. CDK doesn't manage this (see the comment in
      `lib/constructs/frontend.ts` for why) - if you ever `cdk destroy`
      and recreate this distribution, redo this step for the new one.

## 6. First real end-to-end pass

This is the part local builds and `cdk synth` can't verify - actually
exercising it as a real user, on real AWS.

- [ ] Load the CloudFront URL, sign up a real test account
- [ ] Confirm you land in the Getting Setup wizard automatically (tests
      `hasCompletedSetup` end-to-end)
- [ ] Add an account, add an expense, confirm the balance updates
- [ ] Set a budget low enough to trigger the 80% alert email - confirm it
      arrives from `no-reply@mcginnisarchitecture.com`
- [ ] Turn on low-balance alerts with a threshold, trigger it, confirm
      that email arrives too
- [ ] Set up MFA in Settings, sign out, sign back in, confirm the code
      challenge actually appears
- [ ] Create a second test account (different email), share an account
      with it from the first, accept from the second, confirm the shared
      account and its recurring items show up correctly
- [ ] Try the Payday wizard end-to-end
- [ ] Confirm the daily recurring processor actually runs the next day
      (EventBridge rule; check CloudWatch Logs for `recurring-processor-fn`
      the following morning, or manually invoke it once via the Lambda
      console to test sooner)
- [ ] Delete the test account from Settings, confirm the type-to-confirm
      flow works and data is actually gone

## 7. Known things to expect / not worry about

- The chunk-size build warning ("Some chunks are larger than 500 kB") is
  cosmetic - doesn't block anything, just a bundling optimization
  suggestion for later
- If email delivery seems slow the first time, SES sandbox mode limits
  may apply depending on whether production access has been requested -
  check the SES console's "Account dashboard" for sending limits
- MFA enrollment (Settings → Two-factor authentication) works, but there's
  no enforcement forcing every user to set it up - it's opt-in per user
