# Finance App — Frontend

![Ledgerline](./public/ledgerline-logo-dark.png)

Real, buildable React app (Vite) that talks to the deployed backend from the
`finance-app-cdk` project. This replaces the mock-data chat-preview artifacts
with actual authenticated API calls.

## Why this is a separate downloadable project, not a chat artifact

The interactive previews built earlier in this project (Dashboard, Add Expense,
etc.) run in a sandboxed browser preview that can't install the Cognito SDK or
make authenticated calls to an external API. To actually connect to the
backend, this needed to be real, `npm install`-able project code you build and
run yourself (or deploy to the S3 bucket the CDK stack already provisions).

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with the values CDK printed after deploying
(`npm run deploy:beta` in the CDK project):

| CDK output | .env.local variable |
|---|---|
| `UserPoolId` | `VITE_COGNITO_USER_POOL_ID` |
| `UserPoolClientId` | `VITE_COGNITO_CLIENT_ID` |
| (same CloudFront URL as `SiteUrl`, + `/api`) | `VITE_API_BASE_URL` |

```bash
npm run dev       # local dev server, http://localhost:5173
npm run build     # production build -> dist/
```

To deploy: upload the contents of `dist/` to the `SiteBucketName` CDK printed
(the S3 bucket CloudFront serves from). `aws s3 sync dist/ s3://<bucket-name>`.

## What's wired so far

- **Login** (`src/pages/Login.jsx`) — real Cognito SRP sign-in via
  `amazon-cognito-identity-js`, including a real MFA challenge step (TOTP
  code entry) for when Cognito Plus tier's adaptive auth challenges a
  sign-in.
- **MFA Setup** (`src/pages/MfaSetup.jsx`, route `/settings/mfa`) — full
  TOTP enrollment: generates a QR code (via `qrcode.react`) plus a manual
  entry code, verifies the first code the user's authenticator app
  produces, then sets TOTP as the account's preferred/enabled MFA method.
  Not yet linked from anywhere in the UI since Settings itself isn't wired
  up - navigate to `/settings/mfa` directly for now.
- **Dashboard** (`src/pages/Dashboard.jsx`) — real `GET /accounts`
- **Add Expense** (`src/pages/AddExpense.jsx`) — real `POST
  /accounts/{id}/transactions`, matching the split-purchase contract
- **Account Detail** (`src/pages/AccountDetail.jsx`) — real account +
  transaction fetch; trend chart and category breakdown are derived from
  that real history, not fabricated
- **Budgets** (`src/pages/Budgets.jsx`) — real budgets/projections. Per-
  category spend is now returned directly by `GET /budgets`
  (`spentAmount` field) — the earlier N+1 client-side workaround was
  removed once that was fixed server-side.
- **Payday** (`src/pages/Payday.jsx`) — real `GET /payday/upcoming` /
  `POST /payday/submit`, including editable per-occurrence overrides, the
  bank-account aggregate table, unpredicted amounts (with a real account
  picker per row), and sending fund-movement notifications to eligible
  shared recipients
- **Category Trends** (`src/pages/CategoryTrends.jsx`, route `/trends`) —
  spending by category over time across every account, with a 3M/6M/1Y/5Y
  range selector. Computed client-side from real transaction history
  (there's no dedicated backend endpoint for this yet); top 5 categories
  by spend get their own line, everything else groups into "Other"
- **External Bank Accounts** (`src/pages/ExternalBankAccounts.jsx`, route
  `/external-bank-accounts`) — real CRUD (list, add, rename, delete)
  against the deployed API
- **Manage Recurring** (`src/pages/ManageRecurring.jsx`, route
  `/recurring`) — real CRUD for recurring income/expense templates,
  including the external-bank-account dropdown. Wiring this surfaced that
  the backend's edit endpoint was still a `501 not implemented` stub - it's
  been implemented in the CDK repo (see that repo's README) as part of
  this work, not just the frontend.
- **Settings** (`src/pages/Settings.jsx`, route `/settings`) — real
  password change (`changePassword`), email change (two-step: request +
  confirm code, via `requestEmailChange`/`confirmEmailChange`), real
  toggles for budget-threshold alerts, low-balance alerts (with a
  threshold amount input), and shared-activity alerts (all backed by
  `/preferences`), per-recurring-item alert toggles, a link to MFA setup,
  and account deletion (type "DELETE" to confirm, then
  `POST /account/delete-me`).
- **Getting Setup** (`src/pages/GettingSetup.jsx`, route
  `/getting-setup`) — real first-account creation and a communication-
  preferences step, skippable at every step. **Now automatically shown to
  brand-new users**: `App.jsx`'s route guard checks the
  `custom:hasCompletedSetup` Cognito attribute and redirects there if it
  isn't `"true"` yet, and the wizard sets it (via `markSetupComplete` in
  `cognito.js`) on finish or skip so it's never shown again after that.
  This required a new custom attribute on the User Pool - see the CDK
  repo's README for an important caveat if either environment has
  already been deployed with real users in it.
- **Walkthrough** (`src/components/Walkthrough.jsx`) — a spotlight tour
  over the REAL Dashboard's real rendered elements (net worth stamp,
  account list, add-account control, nav menu), measured live via
  `getBoundingClientRect` on refs - not a fake replica of the screen like
  the original mock. Triggered by `?tour=1` on the Dashboard route
  (Getting Setup launches it automatically on finish), and replayable
  anytime from Settings → Help → "Replay app tour". A step whose target
  isn't currently on the page (e.g. the account list with zero accounts)
  is skipped rather than spotlighting nothing.
- **Dashboard navigation fix**: wiring the walkthrough surfaced that
  Dashboard's menu only had "Sign out" in it - no way to reach Budgets,
  Payday, Recurring, Trends, External Bank Accounts, or Settings from the
  main screen at all, and "Add an account" linked to `/accounts/new`,
  which has no matching route. Both fixed: the menu now links to every
  wired screen, and "Add an account" is a real inline form.
- **Planned Expenses** (`src/pages/PlannedExpenses.jsx`, route
  `/planned-expenses`) — real CRUD, server-computed suggested
  contribution per item, and a client-side normalized-monthly total
  across everything planned. **Known gap surfaced while wiring this**: the
  original design called for planned expenses to be independently
  shareable (`dataPermissions.plannedExpenses` in the Sharing table), but
  `planned-expenses-fn` has zero sharing awareness - it's strictly
  owner-only, unlike accounts/transactions/recurring which now go through
  `resolve_account_access`. Wired against what the backend actually does
  rather than build UI implying sharing works here; a real follow-up if
  that feature still matters.

## What's next

When Settings gets wired (next in the remaining-screens list), add a link
to `/settings/mfa` there so enrollment is actually discoverable instead of
requiring a direct URL visit.

## Architecture

```
src/
  lib/
    cognito.js       real Cognito auth (sign in, token refresh, sign out)
    apiClient.js      fetch wrapper - attaches the ID token, throws ApiError
    authContext.jsx   React context: are we signed in, as whom
    theme.js          the ledger/passbook design tokens, shared by every page
  pages/
    Login.jsx         wired
    Dashboard.jsx      wired
    AddExpense.jsx      wired
  App.jsx             routing + auth-gating
```

- **Sharing** (`src/pages/Sharing.jsx`, route `/sharing`) — **the first
  real UI for this feature at all.** Backend `sharing-fn` already fully
  supported creating invites with per-data-type permissions, but there
  was no `GET /sharing` (added in this pass) and no frontend screen to
  create, view, accept, or decline shares - the feature existed only as
  raw API calls nobody could reach. This screen: sends invites (account
  permission + independent per-data-type permissions, including
  recurring), shows pending invites waiting on your response, lists
  accounts you've shared out and their status, and lists accounts shared
  with you. No revoke-by-owner yet - only accept/decline by the invited
  user.
- **Recurring sharing now actually enforced**: `recurring-fn` previously
  gated everything on the flat account-level permission; it now checks
  `dataPermissions.recurring` specifically, matching the original
  independent-sharing design. Once `dataPermissions.recurring` is set on
  a share, `ManageRecurring.jsx` and `Settings.jsx` pick up those items
  automatically (no per-screen changes needed there) since they already
  iterate every account `GET /accounts` returns, which includes shared
  accounts. Fixed a real bug surfaced by this: both screens used to fetch
  every account's recurring items with `Promise.all`, which would have
  broken the ENTIRE list the moment one shared account legitimately had
  no recurring access (a 404) - now tolerant of per-account failures.
- **Scenarios** (`src/pages/Scenarios.jsx`, route `/scenarios`) — real
  throwaway preview calculations, saving named scenarios, and comparing
  up to 6 saved scenarios side by side against a shared baseline. Every
  calculation happens server-side against today's real income/budgets/
  planned expenses - nothing here is a frozen snapshot.
- **Notifications** (`src/pages/Notifications.jsx`, route
  `/notifications`) — the peer fund-movement feature: mutual-consent
  agreement management (propose, accept/decline, revoke with a
  confirmation dialog) and sending/viewing actual fund-movement alerts.
  One real backend limitation surfaced and left as-is rather than worked
  around: `GET /peer-notifications` only returns alerts where the caller
  is the RECIPIENT - a sender has no way to view a history of alerts
  they've sent, since the table's only queryable by recipient. Not
  something this screen tries to fake.
- **Terms & Privacy** (`src/pages/Legal.jsx`, route `/legal`) — static
  content, ported faithfully from the original placeholder draft
  (including the prominent "not reviewed by an attorney" disclaimer).
  Currently behind the same auth guard as every other route; ideally
  Terms should be visible before someone creates an account, not only
  after signing in - worth revisiting once there's an actual signup flow
  to link it from.

- **Sign Up** (`src/pages/SignUp.jsx`, route `/signup`, public - not
  behind `RequireAuth`) — **a real, previously-missing gap**: despite the
  Cognito pool having `selfSignUpEnabled: true` since early in this
  project, no frontend sign-up flow was ever built. The only way to get a
  user into the app was an admin manually creating one via the Cognito
  console/CLI - there was no actual self-service path, which was only
  discovered when someone tried to load the real deployed Login screen
  and found no way to create an account. Fixed: real account creation
  (`signUp`), email confirmation with the code Cognito sends
  (`confirmSignUp`), a resend option, and client-side password-policy
  validation matching the pool's actual rules (10+ chars, upper/lower/
  digit/symbol) so a new user sees what's required before submitting
  rather than getting a raw Cognito rejection. Cross-linked with Login.

**All 18 screens are now wired to the real backend** (17 app screens +
Sign Up). See the CDK repo's
`DEPLOY.md` for the beta deployment checklist.

## Real logo and favicons

`public/ledgerline-logo-{light,dark}.png` (full lockup with wordmark) and
`public/ledgerline-favicon-{light,dark}.png` (mark only) replace the
placeholder "$" glyph used everywhere during earlier development.
`index.html` wires both favicon variants via `prefers-color-scheme` media
queries (dark-mode browsers get the light-linework-on-dark version, and
vice versa), plus an `apple-touch-icon`. Since the app's UI is dark-navy
everywhere, Login/SignUp/Getting Setup/Dashboard all use the `-dark`
favicon variant (light linework, visible against the dark background) -
the `-light` variant is used for the browser favicon in light mode and
the README header image.

## Custom Category Trends charts

Users can now add and remove their own charts, and combine multiple
categories onto a single chart, instead of a fixed auto-computed top-5.
Starts with the top 5 categories by spend (each its own chart, matching
the prior default) until the user makes any change - the first add/remove
saves the resulting full layout to `categoryTrendCharts` in
`user_preferences` (new field, `null` by default), so it's consistent
across sessions and devices, same as every other preference in the app.
The "Other" bucket concept is gone - each chart shows exactly the
categories the user chose, and nothing else, rather than folding
unselected categories together.

## Real fund movement: Budgets/Planned Expenses accounts, Transfer Funds, and fixes from live testing

- **Budgets** gained a "Move money to" account selector - if set,
  submitting Payday actually transfers that budget's set-aside amount
  there, not just shows it as a reminder. Planned Expenses already had
  this via its existing "linked account" field.
- **Payday's "Budgeted & planned" section** now shows "will transfer"
  vs "reminder only" per item, and the leftover figure actually
  subtracts budgeted/planned amounts now (previously shown but not
  subtracted). Submit now sends `sourceAccountId` (the account the
  paycheck landed in) so the backend can execute the real transfers.
- **New "Transfer Funds" page** - move money between two of your own
  accounts, added to the Dashboard quick-actions and the menu.
  Filters out shared accounts you don't have edit access to, since a
  view-only share would let you "move" money you can't actually touch.
- **Dashboard**: the Net Worth circle's interior now matches the
  account cards' white background in light mode specifically (dark
  mode unchanged); the one dashed border on the page (the "Add an
  account" placeholder) is now solid, matching every other card.

See the CDK repo's README for the backend side of this - the
proportional-scaling bug fix (a weekly budget wasn't doubling against
biweekly paychecks) and a serious pre-existing bug found and fixed
along the way (payday history had likely never actually saved,
silently, until now).

## Full logo now actually used, not just the favicon

Replaced both `ledgerline-logo-*.png` files with the freshly-provided
versions, and wired them into the real branding moments that were
previously hand-recreating the wordmark with a small icon badge plus
separately-typed "Ledgerline" text: Login, Sign Up, and Getting Setup's
welcome screen now show the actual full logo image. Landing's hero
section also gained it, since it had no logo at all before, just the
tagline. Left the favicon in the three genuinely compact contexts
(PageHeader, used on every app page; Dashboard's own header; Landing's
top nav bar) - a wide logo lockup doesn't fit a 22-26px slot next to
other header content, and those spots already pair the small icon with
separately-typed text, which reads fine at that size.

## Mass-add transactions

New standalone page (Dashboard's "Add multiple" quick action) for
entering several transactions at once, each with its own account,
so a single session can cover multiple accounts rather than being
locked to one like the regular Add Expense flow. Submits every row
independently via `Promise.allSettled` - a failure on one row doesn't
block the rest, and only the failed rows stay in the form afterward,
each with its own specific error.

## A contact page, and available balance after upcoming payments

New Contact page, reachable from both Landing's footer (pre-login) and
the in-app Account menu (post-login) - deliberately not built on the
shared PageHeader component, since that assumes a logged-in context
(menu, sign-out) that doesn't make sense for a visitor who hasn't
signed up yet. See the CDK repo's README for the backend side.

Dashboard's account cards and Account Detail's balance box now show
"(available after upcoming payments)" alongside the raw balance -
raw balance minus everything Payday would classify as due before your
next payday (recurring expenses, budgeted amounts, planned expense
contributions) for that specific account. Built by reusing the
existing `/payday/upcoming` computation client-side rather than
duplicating that cross-cutting logic into a new backend endpoint -
avoids any risk to the reversal-enabled Payday system, at the cost of
one extra API call on page load. Verified the aggregation with
concrete numbers covering multiple items landing on the same account
and a reminder-only budget with no destination account, and verified
the display logic separately so it only shows when there's a genuine,
meaningful difference from the raw balance - not for floating-point
noise or when payday data isn't available yet.

## "2nd Tuesday of every month" scheduling, and Payday reorganized

Recurring's frequency picker now supports "the nth weekday of every
month" - pick which occurrence (1st through 4th, or "Last") and which
day, with a live preview showing the plain-English result. Existing
items with this frequency display it the same readable way in the
list ("2nd Tuesday of every month") rather than generic placeholder
text. See the CDK repo's README for the backend side, including two
real gaps a new frequency type surfaced elsewhere in the codebase.

Payday's "By bank account" section moved under "Budgeted & planned"
as requested, and now actually includes those accounts in its totals
- previously it only ever covered recurring expenses despite budget
and planned-expense transfers moving real money too.

## Payday click-to-navigate, pencil edits everywhere, and Transfer Funds fixed

Budgeted and planned items on Payday now show the same pencil-edit
pattern already used for recurring expenses. Clicking a row's label
(recurring, budgeted, or planned) now offers to navigate to that
item's real page to view or edit it, with a confirmation first - built
genuine deep-link support for both Recurring and Budgets to make this
possible, since neither had any before (Budgets had no router hooks
imported at all).

Transfer Funds now allows the same account on both sides when the
divisions differ, shows the specific division's own balance (not just
the account's) once one is selected, and warns clearly before
submission if an amount would exceed what's actually available. See
the CDK repo's README for the backend side - the frontend alone
couldn't have fixed this, since the API rejected same-account
transfers unconditionally.

Payday's "New balances" summary now auto-scrolls into view with a
larger header. Add Expense/Deposit gained a "save and add another"
option that resets the form for a fresh entry while keeping the
selected account and expense/deposit mode. "Deposit" is now a standard
category, auto-selected when switching to deposit mode.

## Payday reversal system, and a batch of real UI bugs fixed

Payday submit now asks for confirmation, locks once genuinely
submitted (a disabled button with an info bubble explaining why,
rather than just quietly disappearing), and can be reversed - with its
own confirmation and a clear explanation of what reversing actually
does. See the CDK repo's README for the backend side and the real gap
in the "already submitted" check this closes.

**A batch of real, traced bugs**, not guesses: the Recurring page's
create/edit screen had never used the shared header component,
explaining a missing logo and missing menu on that one screen
specifically - fixed by giving `PageHeader` a reusable `onBack`
override rather than patching around it. Adding an account from that
same screen with zero existing accounts silently did nothing, because
a select element's only option doesn't fire a change event when the
browser's fallback already visually "selects" it - fixed, and caught
a real timing bug in my own first attempt (checking the accounts list
before it finished loading would have made this fire for every user
on that entry point, not just ones who genuinely have no accounts).
`EditExpenseModal` assumed the first transaction row in an array
always held the description and division, with no guarantee that's
actually true for a multi-split purchase - fixed to search for
whichever row has one.

Desktop header now shrinks smoothly past a scroll threshold, applied
consistently to both the shared `PageHeader` and Dashboard's own
separate header implementation. Dashboard reordering gained a "Reset
order" option (alphabetical - there's no separately preserved original
order to restore, since sortOrder has been the only ordering all
along). Every remaining native date input on Scenarios and Planned
Expenses got the same defensive width fix as before, after the first
round only closed part of the gap (a flexbox issue) - this closes the
other part (native date inputs have their own intrinsic-width quirk
that can push past a constrained parent independent of any flex
layout around it).

## Deposit-split-across-divisions, and a real post-submit balance summary

Add Expense's split rows now get their own division selector when
adding a deposit, so a single deposit can be divided across several
divisions at once - not just one for the whole transaction. See the
CDK repo's README for the backend side.

Payday's submit flow no longer redirects away after 1.5 seconds -
that was never enough time to actually read anything. It now shows a
real "New balances" summary (every account and division actually
touched by the submission, with their genuinely-current balances)
and waits for the user to hit Done before navigating away.

## Planned Expenses overhaul, and direct division-balance editing removed

Planned Expenses page now has real Active/Completed sections, with
Complete and Revive actions (Revive restricted to one-time items,
matching the backend rule - an annual item already has a fresh card
waiting for next year). Payday's planned-expense rows are editable,
plus a new "Overdue planned expenses" section with its own edit
control, a link that deep-links straight to that specific item's edit
form (real query-param support added to Planned Expenses for this -
it didn't exist before), and a mark-complete action. Category
selection on planned expenses now supports adding a new one inline.

Account Detail's division editing no longer lets you set a balance
directly - only rename remains. See the CDK repo's README for why:
the account-total/unassigned display bug traced back to divisions
being editable independent of any real transaction, letting them
drift out of sync with the account's actual balance.

## Payday now requires income, and unpaid items actually stay unpaid

Payday shows a real redirect prompt instead of the calculator when no
income source exists yet, explaining why and linking straight into
Recurring with the income form pre-opened (reusing the same
`?new=income` query param Dashboard's quick actions already use). See
the CDK repo's README for the root cause this closes out - the exact
Payday amount-inflation bug reported two rounds back, now actually
explained rather than left as an open question.

Also closes out a real bug in the "mark as still unpaid" feature: an
item flagged as overdue would show once, then silently disappear from
every later payday - the opposite of what marking something unpaid is
for. Fixed at the root in the CDK repo. The unpaid checkbox itself no
longer appears when adding income, since income isn't something that
can be "unpaid."

## Expense/Deposit toggle, and dialog error visibility fixed everywhere

Add Expense now has a real Expense/Deposit toggle at the top, with the
page title, blurb, and submit button label all adapting to match.
Both entry points (Dashboard's quick action, Account Detail's own
button) renamed to reflect the new dual purpose. See the CDK repo's
README for the backend math behind this, including a bug caught in
the edit-transaction path that would have silently converted an
edited deposit back into an expense.

`ConfirmDeleteDialog` (used in six places across the app) now
displays an error message when one's set, instead of the error being
set on the page behind the dialog where it's completely invisible
while the dialog is still open - which is exactly what "clicking
delete does nothing" looks like from the outside. Wired into every
usage, each clearing its error at the start of a fresh attempt.

## New logo artwork, desktop SignUp, Dashboard reordering, and a large bug-fix round

New brand artwork throughout (resized from print-resolution originals
to web-appropriate sizes - see the CDK repo's README for the size
reduction). SignUp rebuilt to mirror Login's desktop two-panel layout
exactly, keeping the confirmation-code step simple and centered on
both. Dashboard accounts now group into Checking/Savings/Other
sections with an "Edit order" mode (move up/down within a section,
persisted via the backend's sortOrder field) - built as up/down
buttons rather than drag-and-drop, since the app had no drag library
and touch-based drag inside a scrolling container is fragile to get
right for a financial app.

Account Detail gained a division-total display, an "unassigned"
figure (balance minus division total) in the same box as the current
balance, and a real "connect an external bank account" selector with
inline creation. Payday income amounts are now editable (reusing the
per-occurrence override endpoint already built for expenses), and
budget amounts there now reflect real spend already made this period
rather than the full period cap, with spend-so-far shown for context
and a manual override available.

A real structural bug (a confirmation dialog rendered in the wrong
view's code path, so a delete button visibly did nothing until a
later, unrelated click revealed a broken dialog) is detailed in the
CDK repo's README, along with several other fixes from this round -
Add Expense category creation, Recurring's own category-add flow
(missing a confirm button entirely, inconsistent with every other
inline-add pattern in the app), and the exact same silently-swallowed
account-creation error bug caught twice more in different inline-add
flows.

## Flexible recurrence, and a round of real fixes across Recurring/Payday/Budgets

New "Custom interval" frequency option on the Recurring form (every N
days/weeks/months), with count+unit fields that only appear when
relevant. See the CDK repo's README for the full story on this one,
including three separate copies of the same now-incomplete conversion
logic caught and fixed while wiring it through.

Payday's "money to move out" report was properly diagnosed this round,
not guessed at - got the user's real income setup and traced the exact
math against it before touching anything. Fixed the real gap (new
recurring items with a past due date now default to starting from the
next occurrence, with an explicit opt-out for genuinely overdue bills).
"Unassigned account" fixed everywhere it showed up incorrectly
(Recurring, Payday's rows, Payday's bank-account summary) to always
show the real internal account. The "leftover after this payday" box
moved to the true bottom of the page with the standard white card
background, and a header/blurb added above the bank-account table.

Add Expense gained a real "add new category" option (previously
missing), a `notes` field landed on recurring items, and Budgets'
division dropdown now supports creating a new division inline,
matching the pattern already used everywhere else division selection
happens.

## Expandable divisions on Dashboard, and duplicate account names blocked

Each owned account card on the Dashboard can now expand in place to
show its divisions and their balances, without navigating away -
restructured the card from one big button into a button (navigates to
Account Detail) plus a separate toggle (expands/collapses inline), since
a button can't nest inside another button. Divisions for every owned
account are fetched once alongside the account list itself.

Account creation and rename now reject a name that collides
(case-insensitively) with one of the user's own existing accounts. See
the CDK repo's README for a real silent-failure bug this surfaced and
fixed in `ManageRecurring`'s inline account-creation flow.

## Projected vs Actual redesigned

No more category selection - shows total money in minus total money
out across every real pay period instead, with Projected and Actual as
two lines on one chart. See the CDK repo's README for how "actual" is
computed (real transaction history, so Payday movements and manually
added expenses are automatically included) and a real date-boundary
bug caught before it shipped.

## Division trend charts on Account Detail

New `DivisionTrendCharts` component, added right below each account's
Divisions section - same customizable add/remove/combine-charts pattern
as Category Trends, but reconstructing each division's real balance
over time (a running total, walked backward through its own tagged
transactions from the current balance) rather than a monthly spend sum,
since a division tracks what it's holding, not a flow. Verified the
merge logic for combined charts handles divisions with very different
transaction counts safely (JS's out-of-range array access returns
`undefined` rather than wrapping or throwing) before trusting it.

## Real responsive layout: desktop vs mobile

The app had no breakpoint system at all before this round - "desktop"
and "mobile" rendered identically everywhere. New `useIsDesktop` hook
(768px breakpoint, matches `window.matchMedia`) is the foundation now
used across the pages that needed to differ:

- **PageHeader** (every logged-in page) and **Dashboard's own header**
  now show the full logo on desktop instead of the small icon; mobile
  is unchanged.
- **Login** rebuilt with a genuine desktop layout - a two-panel split
  (branding panel with the full logo and tagline at real size, form in
  its own focused panel) instead of the old mobile card just centered
  in a lot of empty space. Mobile keeps its existing centered-card
  layout, with the logo rendering slightly more robustly (explicit
  `display: block`, a touch smaller for breathing room) since a report
  said it wasn't showing there, though no code-level cause was found.
- **Landing**'s desktop nav now shows the full logo top-left instead of
  the small icon + typed name; the hero section's own large logo is
  hidden on desktop specifically (the nav carries it now, so a second
  one directly below would just be a redundant stack) but kept exactly
  as-is on mobile, which was already confirmed working well.

## Mobile zoom-on-tap: added a second layer of defense

The existing `font-size: 16px !important` fix (from two rounds back) was
re-verified intact and structurally correct - no regression found
through static review. Since the report says it's still happening,
added `maximum-scale=1.0` to the viewport meta tag as a well-documented
complementary fix for this exact class of iOS behavior, rather than
just re-asserting the same rule. Deliberately not using
`user-scalable=no`, which would also block legitimate pinch-zoom.
Worth knowing this is unverified without a real device test - if it's
still happening after this, knowing which specific field would help
narrow it down further.

## Two real bugs fixed

- **Adding a recurring income with zero accounts didn't work** - the
  "Add recurring" button on the list page was disabled whenever the
  account list was empty, even though the form it opens already has a
  working "create an account inline" flow. The guard was blocking
  access to the exact feature meant to solve the problem. Now only
  disabled while genuinely still loading.
- **A duplicate-account-name error on Dashboard never went away** -
  `setError` was being set on failure but never cleared anywhere.
  Fixed at both points: cleared at the start of every creation attempt
  (so retrying starts clean) and cleared on any successful account
  list refresh (so a later successful creation doesn't leave a stale
  error sitting on screen).

## Removed the dashed line on Account Detail

Both the balance box and the transactions box had a decorative dashed
"perforation" line at the top - removed from both, and cleaned up the
now-unused component that generated it.

## Upcoming Expenses: editable amount and due date

Tap any occurrence to edit its amount and/or due date inline - not just
the very next one, which is all the underlying endpoint used to support
before this round. Editing the date doesn't shift the item's overall
schedule; only that one occurrence moves, everything after it stays on
its original track. See the CDK repo's README for how that's actually
enforced, including a hand-traced check that a naive implementation
would have silently drifted every future occurrence.

## Scenarios: income dropdown, timed changes, one-time expenses, and a trend chart

New "adjust an existing income" dropdown mirroring the expense pattern,
pre-filling the current amount rather than asking for a blind delta.
Start-date fields on every recurring adjustment type, plus a new
one-time-expense section (snapped to the preceding real paycheck - see
the CDK repo's README for why that's the right call, not just a
convenience). Comparison table now itemizes every adjustment instead of
just showing a net number.

New trend chart plotting cumulative leftover across real future pay
periods, baseline against every selected scenario.

**Caught a real bug via the no-undef check that a clean Vite build did
not catch**: the recharts import (`LineChart`, `ResponsiveContainer`,
etc.) was missing entirely by the time the chart was wired up - a
straightforward runtime crash the first time anyone selected scenarios
to compare, invisible to `npm run build` because JSX identifiers aren't
always caught by the bundler the way a plain missing import would be.
Exactly the failure mode this project's verification step exists to
catch, and exactly why it runs on every touched file, not just the ones
that feel risky.

## Modifying and deleting existing expenses

Account Detail transactions are now tappable when eligible - manually-
added expenses only (not recurring items, transfers, or income, which
each have their own management flow). Opens a new modal to re-split
across categories and an optional division, or delete the whole expense
entirely. Gated behind a new permission for shared accounts - only the
owner or a share with `modifyTransactions` explicitly enabled can do
this; a plain editor can still add new expenses but not touch existing
ones. New info bubble on Sharing explains exactly what the permission
does and why it's a bigger trust step than the account access above it.
See the CDK repo's README for the backend side, including a real gap
found in the division work from a couple rounds back.

## Real bugs fixed this round

- **Payday submit was silently dropping items.** Fixed to post
  everything shown, not just the subset before the exact payday date -
  see the CDK repo's README for why this only started mattering after
  last round's window-widening fix.
- **Settings had a whole leftover section** (per-recurring-item alert
  toggles) that should have been removed when alert control moved to
  Budgets a couple rounds back - it called a backend field that no
  longer exists, so it looked functional but never actually persisted
  anything. Removed, along with its now-dead state, fetch, and imports.
- **The mobile zoom-on-tap fix was only partially effective.** See the
  CDK repo's README for the real cause (CSS specificity, not the fix
  itself being wrong) and how it's actually fixed now.

## Payday's "due soon" section relabeled

Updated to "Due before your next payday" - the underlying window changed
from a fixed 5 days to the user's actual next real payday (see the CDK
repo's README for the real root cause behind the missing-expenses
report from two rounds back).

## Account divisions, and a round of real-usage fixes

- **Divisions**: new UI on Account Detail - view/create/rename/adjust/
  delete named sub-allocations within an account's balance, read-only
  for shared accounts. The Recurring form now has an optional Division
  selector, plus true inline creation of both a new account *and* a new
  division without leaving that screen - matching the same inline-add
  pattern already used there for categories and external bank accounts.
- **Account rename/delete**: full UI on Account Detail.
- **New "Upcoming expenses" page**: a real chronological timeline of
  every recurring expense's upcoming occurrences (not just the next
  one), over a 30/60/90-day window. Needed forward-walking each item's
  schedule client-side - ported the backend's date math to JS rather
  than adding a new endpoint, and verified the port against the real
  Python backend with identical test cases (including semimonthly and
  year-boundary edge cases) before trusting it.
- **InfoBubble consolidated**: found 11 duplicated implementations
  across the app, replaced with one real shared component that's
  actually viewport-aware (verified the positioning math against a
  realistic mobile screen width) and dismisses on outside click or
  scroll - fixing the "shows off-screen" issue everywhere at once.
- **Budget alerts toggle** moved from Recurring items to Budgets.
- **Mobile zoom-on-tap** fixed globally - one CSS rule (iOS's
  auto-zoom-on-focused-small-input behavior), not a per-screen patch.
- **Form input backgrounds** made visually distinct (white in light
  mode) everywhere, not just the one screen shown - 66 real form fields
  across 14 files. This needed care: a first attempt matched nothing
  because arrow functions like `onChange={(e) => ...}` contain a literal
  `>` that broke a naive tag-boundary regex; rewrote it as a proper
  brace-depth-aware scanner and verified real diffs before trusting it.
- **Payday's leftover total** was silently excluding recurring expenses
  due shortly after payday - fixed.
- **Dashed borders removed** from the Recurring page's content boxes,
  matching the earlier Dashboard fix; kept them on the actual "add new"
  placeholder buttons, which are supposed to look different from real
  entries.

See the CDK repo's README for the backend side - divisions' data model,
the alerts-ownership move, and the account update/delete implementation
(both were previously a stub and an incomplete cascade, respectively).

## Payday redesign

Payday now shows recurring expenses, unpredicted amounts, and budgeted
expenses together, for whichever payday you're looking at:

- New date selector (`PaydaySelector`, replacing the old self-contained
  `PastPaydayBrowser`) - browse past submitted paydays from a dropdown,
  or type any other date, past or future.
- A past submitted date shows the real historical record. Any other
  date shows a live preview. Only the actual default view (your real
  next, not-yet-submitted payday) is editable/submittable - browsing
  anything else is read-only, since you can't submit for a payday
  that's already happened differently or hasn't happened yet.
- New "Budgeted & planned" section - a category-by-category and
  planned-expense-by-planned-expense reminder of what to set aside,
  shown regardless of which payday you're viewing.

Caught two real bugs myself while building this, verified rather than
assumed fixed:
- After renaming the old browser component, one stale JSX reference to
  its old name was still in the render. The build passed anyway -
  bundlers don't fully resolve every JS identifier at build time, so
  this would have been a silent runtime crash the moment anyone opened
  the page. Caught by checking the actual reference, not by trusting
  a green build.
- A newly-introduced `isEditable` variable was used in four places but
  never declared - same failure class, same fix. After finding this
  twice in one session, added a temporary ESLint `no-undef`/
  `react/jsx-no-undef` check across every file touched this session as
  a more reliable verification than manual inspection - confirmed
  clean, then removed the temporary config.

## Budgets: frequency selector

New monthly/biweekly/weekly toggle in the budget form, replacing the
old monthly-only "Monthly amount" field (now just "Amount"). See the
CDK repo's README for the backend model change this required.

## Projected vs Actual spending page

New page, new nav entry. Pick a budgeted category, pick a range
(3M/6M/1Y/5Y), see two lines: what the budget projects forward, and
what your recent real spending pace projects forward - with a plain-
language summary of the gap ("at this pace, you'd be $X under/over
budget by the end of this range"). See the CDK repo's README for the
backend calculation and a real routing bug caught before it shipped.

## Dashboard quick-action buttons

Add expense, Add income, Budgets, Recurring, Planned expenses - all
added per request, left in the menu too (not removed, per explicit
instruction this round). "Add income" jumps straight into the Recurring
page's create-income form via `?new=income`, reusing the real form
rather than duplicating it. New walkthrough step covers this section.

Building this surfaced a real request worth getting right rather than
patching narrowly: "next paycheck date" and "backfill start date for
trends" needed to be genuinely independent fields, not the same
overloaded one - see the CDK repo's README for the backend design. The
general Recurring form (not just this new quick-add flow) now has both
fields separately.

## Remaining hardcoded dark-only logo instances

Found 3 more places still hardcoded to the dark logo variant (Login,
Sign Up, Getting Setup) that the earlier dark/light mode pass missed -
these pages' backgrounds already responded to the theme, just not the
logo mark, which would've had poor contrast in light mode. Confirmed via
a final broad search that zero hardcoded references remain anywhere in
the codebase.

## Dark/light mode

Implemented via CSS custom properties rather than a JS-level rewrite -
`theme.js`'s `colors` object now holds `var(--color-x)` references
instead of literal hex, with both palettes defined in `index.css`
(dark matches the app's original look exactly; light is a new
coherent palette using the same brand colors, with `positive`/`alert`
darkened for proper contrast against a light background). This means
every existing page kept working completely unchanged - they were
always just consuming a string value in a `style={{}}` prop, and it
still resolves to a real color, just a dynamic one now. New
`ThemeContext.jsx` (persists to localStorage, defaults to OS
preference) and a toggle button in both headers.

**Three real issues this refactor exposed and fixed, not just
theorized about:**
- Three places used a hex-alpha-suffix trick (`` `${colors.bg}E6` ``)
  for a translucent header backdrop - this produces invalid CSS once
  `colors.bg` is a variable reference rather than a literal hex string.
  Fixed with a dedicated `colors.bgTranslucent` variable.
- The logo mark image was hardcoded to the dark variant in three
  places - now theme-aware, so it stays legible against a light
  background.
- Four date inputs hardcoded `colorScheme: "dark"`, which would make
  the native browser date-picker widget look visually wrong in light
  mode - all four now use the live theme value.
- The "near-limit" warning amber (`#D6A24C`) was tuned for a dark
  background and would have had weak contrast on the new light one -
  promoted to a proper `colors.warning` with a darker light-mode value.

## Per-page blurbs

New `PageBlurb.jsx` component, added to all 15 pages where a "what is
this page for" description makes sense (skipped: Login/SignUp/404,
which don't need one; Getting Setup, which already explains each
wizard step inline). Reused the existing `navLinks.js` descriptions
as the source of truth wherever a page has a nav entry, rather than
writing the text twice - and fixed a stale one found in the process
(Category Trends still said "5 years" after the range was capped to
2Y a few rounds back).

## Payday rename

Renamed to "Payday calculator" everywhere it appears as user-facing
text - confirmed via a broad search across the whole frontend, not
just the two spots expected going in.

## Landing page

New `Landing.jsx`, wired as the public root: signed-out visitors now
see it directly at `/` instead of being redirected straight to
`/login`; signed-in users still see the Dashboard at the same URL,
handled by a new `RootRoute` component that checks auth status without
a flash of the wrong page during the initial load. Includes the
requested "used cases" pitch (the Walmart/Target category-precision
differentiator from an earlier conversation) and a feature overview.

**One thing worth flagging honestly**: the page doesn't include actual
app screenshots - I don't have a way to capture real screenshots of the
live deployed app from here, and fabricating fake ones would be
actively misleading. Used icon-based feature cards instead. If you want
real screenshots included, that would need to be a follow-up pass with
actual images.

## Backlog cleanup round (items 6-16)

- **White page on adding a recurring expense**: no bug found via code
  review with no console error to go on - likely already resolved by the
  transactions-fn Decimal fix, since several similar symptoms were.
- **Add Expense**: reorganized per spec (description moved under the
  total-amount card, "Remaining from total" only shows once a split
  exists, per-split description fields added). Found and fixed a real
  related bug in the process: the top-level description was being
  silently discarded server-side - the backend only ever reads
  description *per split*, never a top-level one.
- **External bank account "add new"** added inline to the recurring form,
  same pattern as category "add new."
- **Recurring's category dropdown** now pulls real budget categories
  instead of a static list (item 7).
- **Net worth** now excludes shared accounts (item 14); Dashboard has a
  separate "Shared with you" section (item 12/13).
- **Notifications**: found the actual gap for item 9 - pending *sent*
  proposals had no cancel button at all (only accepted ones did). Fixed.
  Item 10 (Sharing cancel regardless of status) was already correct, no
  fix needed.
- **Payday's "Let someone know"**: added the requested info bubble, and
  clarified that the unselectable "not invited" state isn't a bug - it's
  the intended mutual-consent design (matches the peer-agreement model
  everywhere else in the app).
- **Planned Expenses**: editing now expands the card in place instead of
  showing a separate, confusing duplicate-looking panel (item 8).
- **Sharing**: "People you've shared with" is now expandable per person
  and per account, with inline permission editing (items 11/12) and a
  proper "revoke all" per person.
- **Blank account on dashboard after payday submit** (item 15): no code
  path can produce a blank account name (confirmed - `_create_account`
  always sets a real name). Very likely another symptom of the same
  transactions-fn Decimal bug, given the timing lines up. Flagged for
  retest rather than guessed at further.

## Payday history

A collapsible "Past paydays" section on the Payday page, with a date
dropdown showing exactly what was posted that day (income, expenses,
unpredicted amounts). See the CDK repo's README for the backend design
(new TTL'd table, 1.5-year retention).

## Category Trends: per-category charts, 2-year cap

Each of the top 5 categories now gets its own dedicated small chart
(stacked vertically) instead of all being combined into one multi-line
chart. Max range changed from 5Y to 2Y, per confirmation. Worth being
precise about what this actually caps: the underlying transaction data
has no retention limit at all - transactions are kept indefinitely
unless explicitly deleted - this only limits how far back *this specific
chart's* range selector can look.

## Feedback-driven fixes, round 6

- **Header staying visible on scroll**: found the real cause - an earlier
  fix for the mobile "zoomed in" bug set `overflow-x: hidden` on both
  `html` and `body`, and `overflow-x` on `html` specifically (the true
  root scrolling box) is a known way to break `position: sticky` for
  descendants in some browsers. Moved it to `body`-only, which keeps the
  mobile fix without breaking every page's sticky header.
- **Add Expense from Account Detail**: added - `AddExpense.jsx` already
  supported a `?accountId=` query param, this just needed a button
  pointing at it.
- **Menu closes on outside click**: implemented in both `PageHeader` and
  Dashboard's separate menu implementation, via a ref + document
  `mousedown` listener.
- **Clickable-item hover affordance**: added transition/hover-opacity to
  header buttons as a start - not an exhaustive pass across all 18 pages.
- **Pending-share notification dot**: a small red dot on the hamburger
  icon and the "Sharing" nav item when there's a pending invite waiting
  on the user, in both `PageHeader` and Dashboard's menu.
- **Shared-account indicator**: Account Detail now shows "Shared with
  you · [permission]" when viewing an account you don't own.
- **Sharing page rewritten** for the new backend (see the CDK repo's
  README for the schema bug this surfaced and fixed): the invite form is
  now a multi-select checklist of accounts instead of one dropdown, and
  every list on the page (pending invites, sent shares, accepted shares)
  now groups rows by the other person rather than keying by
  `ownerUserId`/`invitedUserId` alone - which would have produced
  duplicate React keys and only shown one of several accounts per person
  once batch invites were possible. Added a real revoke button (owner
  side) and an info bubble explaining View vs. Edit access, confirming
  it's actually enforced server-side, not just a UI toggle with no effect.



- **PageHeader**: restored the "back to previous screen" button
  (browser-history back) alongside the "back to dashboard" one - the
  header rollout had replaced it entirely with just the dashboard
  shortcut, losing the ability to return to wherever you actually came
  from. Also bumped the logo mark's size (20px → 26px) for better
  recognizability, since the uploaded "correct" logo files turned out to
  be byte-for-byte identical (confirmed via md5sum) to what was already
  integrated - the files were never wrong, the mark was just small enough
  to read as a generic icon rather than a logo.
- **Budgets**: real delete, via a "Delete this budget" button inside the
  edit form (the whole card is a click target for editing, so a separate
  delete affordance couldn't live on the card itself without conflicting
  with that).
- **Payday**, three real fixes:
  - The "unpredicted amount" category dropdown was a hardcoded list
    unrelated to the user's actual budget categories. Now pulls real
    categories from `budgetsApi.list()`, merged with a small default set.
  - Unpredicted amounts now persist to `localStorage` (keyed per user
    email) and survive navigating away, only clearing after a real
    successful submit - previously held only in React state, gone the
    moment you left the page.
  - Expenses due within 5 days after payday now show in their own
    "Due within 5 days after" section, informational only - explicitly
    excluded from the actual submit payload and the leftover-money total,
    since including them would have posted bills before their real due
    date and misstated how much is actually left over this cycle.

## Feedback-driven fixes, round 4 — global header rollout complete

- **Global header, fully rolled out** to every page that should have one:
  `src/components/PageHeader.jsx` (logo, back-to-dashboard button, page
  title, optional subtitle, and the same nav menu as Dashboard) is now
  used on all 14 non-Dashboard pages that have a header at all. Correctly
  left alone: Login/SignUp (pre-auth, a dashboard link makes no sense),
  Getting Setup (mid-wizard, navigating away is disruptive), NotFound
  (already has its own way back), and ManageRecurring's create/edit
  *sub-view* (which intentionally goes back to the list, not the
  dashboard, since it's a nested step within the page, not a top-level
  page itself — swapping it to PageHeader was tried and reverted once
  this was noticed). `NAV_LINKS` extracted to `src/lib/navLinks.js` as
  the single source of truth Dashboard and PageHeader both use, instead
  of Dashboard's copy being the only one. AccountDetail's small icon
  badge and Payday's dynamic "due [date]" subtitle were preserved via a
  `subtitle` prop rather than silently dropped for consistency's sake.
  Cleaned up every now-unused `useNavigate`/icon import left behind by
  the swap - confirmed via a rebuild producing an identical bundle hash,
  proving the cleanup was behavior-neutral.
- **Sharing invite display**: previously showed literally nothing about
  who was sharing an account with you - not even an email. Backend now
  resolves the owner's email via the same Cognito lookup used elsewhere
  (`lookup_email_by_sub`) and returns it on every `asInvited` share;
  frontend shows it on both the pending-invite card and the "shared with
  you" list, plus which extended data types (recurring, budgets, etc.)
  were included beyond the base account access.
- **Recurring's category field** now has the same inline "+ Add a new
  category" affordance as Budgets.
- **Budgets "new category doesn't save" - root-caused, not just
  patched**: it genuinely was saving. `_list_budgets` only ever returned
  budgets already in effect, and a new budget's start date gets snapped
  forward to the user's next paycheck (often days away) - so a
  just-created budget was completely invisible until that future date
  arrived, indistinguishable from a silent failure. Fixed to show
  not-yet-started budgets immediately, clearly labeled "Starts [date]"
  instead of a spend bar with nothing to show yet.

**Not done**: dark/light mode, landing page, per-page purpose blurbs,
chart/graph placeholders, retroactive-date-entry-with-confirmation
(Budgets/Recurring/Scenarios), Scenarios UX improvements, Payday
rename+history, import/export - see prior round's notes for the full
remaining list and reasoning.



- **Found and fixed the real cause of "Loading…" showing as literal
  text** (`Loading\u2026`) - a JSX quirk, and the answer to an earlier
  open question from the big feedback round. `\u2026` is a valid escape
  sequence inside a JS string (`{loading ? "Saving\u2026" : "Save"}`
  correctly renders "Saving…"), but JSX text content written directly
  between tags (not inside `{}`) is NOT parsed for JS escapes at all - it
  renders literally. This exact mistake was present in 18 files across
  the app, not just the one reported instance (Budgets' "Add a new
  category" option) - found via a project-wide grep and fixed everywhere
  in one pass by replacing the literal escape-sequence text with the
  actual Unicode ellipsis character, which is valid and correct in both
  contexts.
- **Recurring form layout shift when toggling Expense/Income**: not a
  component-level issue - the page's total height changes between the two
  modes (different fields shown), which crosses the viewport threshold
  and toggles the browser's own page scrollbar on/off, shifting available
  content width either way. Fixed globally in `index.css` with
  `scrollbar-gutter: stable` on `html`, which always reserves the
  scrollbar's space whether or not it's actually needed - this fixes the
  Recurring form specifically and prevents the same shift on any other
  page with a similar height-changing-on-toggle pattern.



- **Mobile horizontal-overflow fix**: `index.css` had no guard against a
  single element exceeding the viewport width dragging the whole page
  into horizontal scroll (the "appears zoomed in" symptom). Added
  `overflow-x: hidden` + `max-width: 100vw` at the `html, body` level -
  the standard fix for this symptom class. Caveat: this is a safety net,
  not a guarantee every individual element is perfectly responsive: if a
  specific element still visibly clips after this, that's a real,
  separate bug worth reporting with the specific page/element.
- **Found and fixed a systemic bug, not just the one reported instance**:
  Planned Expenses' "Edit" populating stale/blank fields was a React gotcha
  - the create form and the edit form are the same mounted component
  instance (the list stays visible below the form, so clicking Edit on a
  different item just changes props on an already-mounted form), and
  `useState()`'s initial value only runs on first mount, so the fields
  never updated to match the new item. Fixed with a `key` prop that
  changes per item, forcing a real remount. Audited every other page with
  the same list-plus-form pattern: `Budgets.jsx` had the identical latent
  bug (not yet reported, but confirmed present) and got the same fix;
  `ManageRecurring.jsx` uses a different pattern (full-page swap, form and
  list never both mounted) so it isn't affected; `Sharing.jsx`'s form has
  no edit capability at all so the bug can't manifest there.
- **Budgets**: budget cards are now clickable and open a pre-filled edit
  form (previously had zero click handler at all). Category dropdown now
  has an inline "+ Add a new category" option.
- **Recurring**: the Expense/Income toggle is now red for Expense, green
  for Income (was the same accent-teal color for both).
- **Getting Setup**: now supports adding multiple accounts in one pass -
  "Save, add another" vs "Save and continue," with a running list of
  what's been added so far.

**Not done in this round** (deliberately deferred - see the chat for the
full sequencing plan): dark/light mode toggle, global header component
(logo + menu + theme toggle on every page), a landing page, per-page
"what is this page for" blurbs, replacing "Loading…" text with a real
loading indicator, trend/graph placeholders anywhere, the
retroactive-date-entry-with-confirmation-dialog feature (Budgets/
Recurring/Scenarios), Scenarios improvements, renaming Payday, import/
export, and the Account Detail / Category Trends error reports (likely
already resolved by the CORS fix from last session, pending confirmation
after a real redeploy + retest).



- **Account types restricted to checking/savings only** (Dashboard,
  Getting Setup) - "for now," per feedback; credit/investment/other still
  exist in the backend's valid-type set, just hidden from the UI.
- **Verification screen now auto-signs-in and redirects straight to the
  dashboard** after confirming the code, rather than showing a separate
  "you're all set, now go sign in" screen - a brand-new user lands
  straight in Getting Setup via the existing `hasCompletedSetup` redirect
  logic. This also resolves what to put on the old confirmation screen,
  since that screen no longer exists.
- **Getting Setup's notification toggles fixed** - they only visually
  updated after a successful backend save; a failed save (for any reason)
  left them looking unresponsive with no error shown. Now optimistic
  (toggles immediately) with a visible revert + error message if the save
  actually fails.
- **Budgets form** now has explanatory info bubbles on Category, Monthly
  amount, and Start date, each describing what that field actually
  affects elsewhere in the app (grounded in the real backend behavior,
  not generic text).
- **Custom 404 page** added as a catch-all route.
- **Walkthrough enhancement**: the Dashboard tour now actually opens the
  menu and walks through every item in it with a real description,
  instead of just pointing at the closed hamburger icon. Fixed a real
  timing bug in `Walkthrough.jsx` in the process - a step's target
  element (like a menu item) may not exist in the DOM yet if opening it
  is an async side effect of the tour itself; the component now retries
  briefly before concluding a target is genuinely absent. **Not done**:
  the broader ask for a full walkthrough on every individual page (~18
  screens) - flagged as a larger follow-up, not attempted here.
- **Not yet resolved**: "Failed to fetch" when creating an account during
  Getting Setup, and "Couldn't load your budgets"/"your upcoming payday."
  Leading theory is testing against a stale backend deployment (several
  fixes this session, including the accounts-fn/peer-notifications-fn
  Decimal bugs, may not be live) - `budgets-fn` and `payday-fn` were
  re-checked and already have the correct Decimal handling, so if these
  persist after a fresh `npm run deploy:beta`, they need their own
  diagnosis (browser Network tab detail for the exact failing request).

## The wiring pattern (for reference / future screens)

Every screen above followed the same five steps, in case new screens get
added later:

1. **Copy or write the visual code** — JSX, styling, and component
   structure don't need to change from a mock, if one exists.
2. **Replace mock constants** with `useState(null)` (or `[]` where a mock
   array was the default) plus a `useEffect` that calls the right
   function from `src/lib/apiClient.js`. If the endpoint isn't in
   `apiClient.js` yet, add a typed helper there first rather than calling
   `api.get(...)` directly in the component.
2. **Add loading/error/empty states** — a moment where `data === null`
   (loading), a moment where the fetch failed, and a moment where the
   list is genuinely empty. `Dashboard.jsx` shows all three.
3. **Real calls, not `console.log`**, inside a `try/catch` that surfaces
   `err.message` to the user rather than throwing silently.
4. **Wrap the route in `<RequireAuth>`** in `App.jsx` and add it to the
   `<Routes>` list, plus a link in Dashboard's nav menu if it should be
   reachable from there.
5. **Handle 401s** by calling `signOut()` from `useAuth()` — an
   expired/invalid token should return the user to the login screen, not
   show a raw error.

The API route each screen needs is documented in the CDK project's
`lib/constructs/api.ts` and in the full documentation's API Route Reference
section.
