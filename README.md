<p align="center">
  <img src="Assets/Full%20Logo_Dark%20Mode.png#gh-dark-mode-only" width="360" alt="Ledgerline">
  <img src="Assets/Full%20Logo_Light%20Mode.png#gh-light-mode-only" width="360" alt="Ledgerline">
</p>

<p align="center">
  A serverless personal finance app: accounts, budgets, recurring bills, a
  payday calculator, and shared/family money management.
</p>

## What it does

- **Accounts & divisions** — track balances across accounts, and split an
  account's balance into named sub-allocations (e.g. a "Vacation fund"
  inside a checking account) that only move via real transactions.
- **Transactions** — split-purchase entry (one purchase across multiple
  categories/divisions), edit/delete with full balance reversal.
- **Budgets** — monthly/weekly/biweekly amounts, proration against real pay
  periods, 80%/100% threshold email alerts.
- **Recurring income & expenses** — weekly/biweekly/semimonthly/monthly/
  annual/custom-interval/"nth weekday of the month" schedules, processed
  automatically each day.
- **Payday calculator** — see what a paycheck covers before it lands:
  recurring bills, budgeted set-asides, and planned expenses together, with
  a full submit + reversal system and history of past paydays.
- **Planned expenses** — save toward a specific future cost, auto-completing
  once fully funded.
- **Scenarios** — model hypothetical income/expense changes against your
  real numbers without touching live data.
- **Sharing** — invite another user to an account with granular, per-data-
  type permissions (view/edit account, recurring, budgets, transactions).
- **Peer notifications** — mutual-consent alerts when money moves between
  people who share access.
- **Security & alerts** — Cognito auth with TOTP MFA, low-balance alerts,
  shared-activity transparency emails.
- **Dark / light mode**, CSV import/export, category & division trend
  charts.

Stripe and Plaid integration are intentionally not started yet.

## Tech stack

| | |
|---|---|
| Frontend | React (Vite), Tailwind CSS, react-router-dom |
| Backend | AWS CDK (TypeScript), API Gateway, Lambda (Python 3.12) |
| Data | DynamoDB |
| Auth | Amazon Cognito (Plus tier, TOTP MFA) |
| Email | Amazon SES |
| Hosting | S3 + CloudFront |

## Repo structure

```
finance-app-frontend/   React app — see its own README.md and CLAUDE.md
finance-app-cdk/        CDK infrastructure + Lambda source — see its own README.md and CLAUDE.md
Assets/                 Source logo/favicon artwork
DEPLOY.md               Step-by-step beta deployment checklist
```

The frontend and backend are two independently deployed projects, coupled
only through an HTTP API contract — each has its own `README.md` with
setup instructions and a `CLAUDE.md` with architecture notes for anyone
(human or AI) working in that code.

## Getting started

Backend:

```bash
cd finance-app-cdk
npm install
npx cdk bootstrap   # first time only, per AWS account/region
npm run deploy:beta
```

Frontend:

```bash
cd finance-app-frontend
npm install
cp .env.example .env.local   # fill in with the CDK deploy output
npm run dev
```

For the full first-time deployment walkthrough (bootstrapping, verifying
the AWS console, wiring the frontend env, and an end-to-end smoke test),
see [`DEPLOY.md`](DEPLOY.md).

## License

MIT — see [`LICENSE`](LICENSE).
