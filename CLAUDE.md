# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

This repo ("PaydayCompass") holds two independently-deployed projects for
**PaydayCompass**, a serverless personal finance app. They are coupled only
through an HTTP API contract, never at build time:

- `finance-app-cdk/` - backend: AWS CDK (TypeScript) defining API Gateway +
  Lambda (Python 3.12) + DynamoDB + Cognito + SES. Has its own `CLAUDE.md`
  with the Lambda/shared-layer architecture, the "don't duplicate logic
  across Lambdas" rule, and the full pre-commit verification checklist
  (py_compile, runtime import check, `cdk synth` on both stacks, hand-traced
  date math). **Read it before touching backend code.**
- `finance-app-frontend/` - frontend: React (Vite) + Tailwind +
  react-router-dom. Has its own `CLAUDE.md` with established UI patterns
  (inline "add category", deep-linking into edit forms via query params,
  split click zones) and its verification checklist (`npm run build`, a
  throwaway ESLint no-undef check, hand-traced money math). **Read it
  before touching frontend code.**
- `Assets/` - source logo/favicon artwork (light/dark variants); the
  web-ready copies actually used by the app live in
  `finance-app-frontend/public/`.
- `DEPLOY.md` - the beta deployment checklist (CDK bootstrap → backend
  deploy → AWS-console spot checks → frontend env config/build → S3+
  CloudFront deploy → live end-to-end pass). Also documents real bugs
  found via live testing that pure `cdk synth`/`py_compile`/build checks
  didn't catch (missing CORS headers, missing Decimal serialization,
  Node version) - worth skimming before assuming a backend change is safe
  just because it synthesizes cleanly.
- `BankingApp/` - a **stale, incomplete duplicate** of `finance-app-cdk`
  (only has `bin/`, `config/`, `dist/`, `node_modules/` - no `lib/` or
  `lambda/`). Not the real backend and not referenced by any build/deploy
  command. Ignore it; don't edit code there.

There is no root `package.json` - each project is built, linted, and run
independently from its own directory.

## Commands

Backend (`cd finance-app-cdk`):
```bash
npm install
npx cdk bootstrap        # first time only, per AWS account/region
npm run build             # tsc
npm run synth             # cdk synth (both stacks defined in bin/finance-app.ts)
npm run diff:beta         # cdk diff FinanceApp-Beta
npm run deploy:beta       # cdk deploy FinanceApp-Beta --require-approval never
npm run diff:prod
npm run deploy:prod
```
No test script exists for the backend - correctness is verified via the
multi-step checklist in `finance-app-cdk/CLAUDE.md` (syntax/import checks
per Lambda, `cdk synth` on both environments, hand-traced date math), not
an automated test suite.

Frontend (`cd finance-app-frontend`):
```bash
npm install
npm run dev        # local dev server, http://localhost:5173
npm run build       # production build -> dist/
npm run preview     # preview the production build locally
```
No test script or checked-in ESLint config exists for the frontend either
- `finance-app-frontend/CLAUDE.md` documents a throwaway ESLint
  no-undef/`react/jsx-no-undef` check to run against touched files instead.

## Repo hygiene note

This repo has no `.gitignore` at the root or in either subproject -
`node_modules/`, `dist/`, and `finance-app-cdk/cdk.out/` are all
committed. Be deliberate about `git add` scope (avoid `git add -A`/`git
add .` picking up regenerated build output) rather than assuming the
usual JS-project ignore conventions apply here.

## Architecture at a glance

- Backend: one Lambda per resource area under `finance-app-cdk/lambda/`,
  shared cross-Lambda logic in the `finance_common` Lambda Layer
  (`finance-app-cdk/lambda-layers/finance-common/python/finance_common/`),
  CDK constructs in `finance-app-cdk/lib/constructs/`. Two environments
  (`FinanceApp-Beta`, `FinanceApp-Prod`) from one CDK app, parameterized by
  `finance-app-cdk/config/environments.ts`.
- Frontend: one page per route in `finance-app-frontend/src/pages/`, shared
  API/auth helpers in `finance-app-frontend/src/lib/` (`apiClient.js` for
  authenticated/public requests, `cognito.js` for auth), shared components
  in `finance-app-frontend/src/components/`.
- Auth: Cognito (Plus tier), with a custom `hasCompletedSetup` attribute
  driving first-run redirect to the Getting Setup wizard. See the CDK
  `CLAUDE.md`/README for why this attribute can't be added to an
  already-deployed User Pool without replacing it (and losing real users).
- Money movement is centralized: `finance_common/transfers.py` is the one
  path both direct transfers and Payday's automatic ones use;
  `finance_common/divisions.py` is the only way a division's balance
  moves (never a direct `PUT`). Don't reintroduce a second path for either.
