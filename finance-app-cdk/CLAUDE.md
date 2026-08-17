# PaydayCompass backend (finance-app-cdk)

Serverless personal finance app backend. AWS CDK (TypeScript) defining
API Gateway + Lambda (Python 3.12) + DynamoDB + Cognito + SES. Two
environments, `FinanceApp-Beta` and `FinanceApp-Prod`, both defined in
`bin/finance-app.ts` via `config/environments.ts`.

There's a companion frontend repo (React + Vite) - see its own
CLAUDE.md. This backend has no knowledge of the frontend at build
time; they're only coupled via the API contract.

## Architecture

- `lambda/<name>/index.py` - one Lambda per resource area (accounts,
  transactions, budgets, recurring, payday, planned_expenses,
  divisions, sharing, contact, etc). Each is a single `handler(event,
  context)` that dispatches on `event["httpMethod"]` and
  `event["resource"]`.
- `lambda-layers/finance-common/python/finance_common/` - shared code
  used by multiple Lambdas: `schedule.py` (recurrence date math),
  `budget_frequency.py` (monthly-equivalent/proration math),
  `transfers.py` (`execute_transfer`, shared by direct transfers and
  Payday's automatic ones), `divisions.py` (`adjust_division_balance`),
  `planned_expenses.py` (`suggested_contribution`,
  `complete_planned_expense`, `is_funded`), `http_response.py` (always
  import `response`/`decimal_default` from here, never redefine
  locally - it's also the only place CORS headers get attached to a
  real response, not just the OPTIONS preflight).
- `lib/constructs/` - the actual CDK constructs: `lambdas.ts` (every
  Lambda definition + IAM grants + env vars), `api.ts` (every route),
  `data-tables.ts`, `observability.ts` (CloudWatch alarms -> SNS ->
  `cfg.alertEmail`).

## The rule that matters most: don't duplicate logic across Lambdas

This has caused real, shipped bugs more than once - a frequency type
or a completion rule implemented in one Lambda, then needed
identically in another, drifting apart because nobody remembered to
update both. If two Lambdas need the same computation, it goes in
`finance_common`, not copy-pasted. Recent examples worth knowing
about: `complete_planned_expense` (annual-rollover logic) lives in
`finance_common.planned_expenses` specifically because both
`planned_expenses-fn`'s own `/complete` endpoint and `payday-fn`'s
auto-complete-when-funded path need the exact same behavior.

When adding a new frequency type (see `monthly_weekday` as the
template), search the *whole* backend for every place frequency logic
lives, not just the obvious one (`schedule.py`). Last time this caught
two real gaps: `budget_frequency.py`'s `previous_date_before` had no
case for the new type and would have thrown an unhandled error, and
its monthly-equivalent factor was relying on an implicit fallback that
only happened to be numerically correct by coincidence.

## Verification - do all of this before considering a change done

1. `find lambda -name "*.py" | xargs -I{} python3 -m py_compile {}` -
   syntax check on every Lambda, not just the one touched.
2. Runtime import check per touched Lambda - `python3 -c` importing
   `index` with `PYTHONPATH` pointing at the shared layer and every
   required env var stubbed with `os.environ.setdefault(...)`. This
   catches import-time errors py_compile can't (e.g. a genuinely
   missing function in a shared module).
3. `npx cdk synth FinanceApp-Beta` and `FinanceApp-Prod` - both, not
   just one. When adding a new API route, don't just trust a clean
   synth - explicitly grep the synthesized template for the new
   resource and confirm its `AuthorizationType` matches intent (`NONE`
   for a deliberately public route like `/contact`, otherwise it
   should have a Cognito authorizer attached). A clean synth doesn't
   prove a route resolved to the path or auth setting you meant.
4. For any nontrivial date/math logic, trace it with concrete numbers
   in a real Python one-liner, not just by reading it. Boundary cases
   worth actually running, not assuming: the last occurrence in a
   5-of-a-weekday month, an item that's years overdue, a value
   crossing exactly zero.
5. If a computation has a forward and backward direction (e.g.
   `next_date_after` / `previous_date_before`), verify they're exact
   inverses of each other, not just individually plausible.

## Design decisions worth knowing before touching related code

- **A division's balance only ever moves via a real transaction.**
  Direct balance editing (`PUT` a `balance` field) was removed after
  it caused the division total and the account's overall balance to
  drift out of sync with no way to reconcile - the display bug that
  looked like a math error was actually this. Creating a division
  always starts it at zero; the only editable field via `PUT` is
  `name`.
- **Payday reversal.** Each Lambda function that posts a real
  transaction as part of a Payday submission returns a `_reversal`
  dict capturing exactly what would be needed to undo it (account,
  sk, the exact balance delta applied, prior schedule state for a
  recurring item). This is captured at write time, not recomputed
  later - recomputing would be wrong once budgets/prices change.
  `_reverse_payday` in `payday/index.py` uses this. Payday history
  records from before this system existed won't have `_reversal` data
  and are skipped per-item rather than failing the whole reversal.
- **Planned expenses auto-complete when fully funded** (no explicit
  click required), on both the manual-edit path and Payday's
  real-transfer path. An explicit revive on a still-funded item is
  guarded against immediately auto-completing again.
- **Network-level failures need explicit handling in every Lambda
  that calls out to something (SES, another AWS service).** Not
  directly a backend pattern, but relevant: the frontend's shared
  request function had to be fixed to distinguish a genuine HTTP error
  response from a raw browser-level network failure (different
  `Error` shapes entirely) - see the frontend CLAUDE.md.

## Known, accepted gaps (not bugs, don't "fix" without discussing)

- CSV import/export doesn't support `custom` or `monthly_weekday`
  recurrence - pre-existing limitation, consistent across both.
- Stripe and Plaid integration are intentionally not started - see
  project history for the open design questions (target scale,
  whether Plaid transactions post immediately vs. wait for review).

## Config

- `config/environments.ts` - `alertEmail` (CloudWatch alarms +
  contact form destination) and `sesFromAddress` per environment. Both
  currently point at the same owner address for beta and prod.
- Lambda env vars are assembled once in `commonEnv` in `lambdas.ts` and
  attached to every Lambda via `baseFnProps` - a Lambda that needs a
  table it doesn't already have access to needs an explicit
  `tables.xTable.grantReadData(this.xFn)` (or `grantReadWriteData`)
  call, not just adding the table name to `commonEnv`.
