# Personal Finance App — CDK Infrastructure

Serverless architecture: S3 + CloudFront (unified domain, fronting both the
static site and API Gateway) → API Gateway → Lambda (Python) → DynamoDB,
with Cognito (Plus tier) for auth and SES for threshold-based email alerts.

## Sharing: modify permissions on an existing share (items 11/12)

New `PUT /sharing/{invitationId}/accounts/{accountId}` lets the owner
change an already-shared account's permissions (base access + each data
type) without revoking and re-inviting from scratch. Confirmed as a real
resource in the synthesized template. Frontend: the "People you've
shared with" list is now expandable per person, and per account within
that person - each account's current permissions are editable inline.

## Peer notification emails (item 16)

Both places a fund-movement notification gets created (`peer-notifications-fn`'s
own endpoint, and `payday-fn`'s wizard-embedded path) now send a real SES
email to the recipient, best-effort (never blocks the in-app record,
which remains the actual source of truth). Both functions needed new
Cognito-lookup and SES-send IAM grants they didn't have before.

## Payday history (item 4/11)

New `PaydayHistoryTable`: `userId` (PK) + `paydayDate` (SK), with native
DynamoDB TTL enabled (`expiresAt`, 1.5 years out from submission), per
confirmed design - deliberately different from real transactions, which
are never auto-deleted and remain the actual source of truth. Every
`_submit` call now also writes a best-effort snapshot of exactly what was
posted (never blocks the real submit if this write fails). New
`GET /payday/history` returns every snapshot still within the TTL window,
newest first. Confirmed directly in the synthesized template: the TTL
specification (`expiresAt`, enabled) and the new route both exist as real
resources, not just assumed from source.

Frontend: a collapsible "Past paydays" browser on the Payday page, with a
date dropdown showing exactly what was posted that day. Deliberately kept
simple for this first pass - a real feature investment (a next/future
paydays *view*, versus this history of already-submitted ones) is a
reasonable next iteration if wanted.

## Real bug found via live testing: budget delete "silently" not working

Root cause wasn't the delete call itself - it was `_upsert_budget`
leaving orphaned rows behind. Editing a budget always resends today's
date (the Start Date field is hidden during edit), and
`_next_paycheck_on_or_after(user_id, today)` computes a different result
on virtually every different day - so **any edit at all created a brand
new row and left the old one sitting in the table**. `_list_budgets`
correctly shows only the latest row per category, but delete only ever
removed that one row - the moment it was gone, the next-newest orphaned
row for that category quietly took its place, making delete look broken.

Fixed both directions: `_upsert_budget` now cleans up every other row
for that category before writing the new one (so exactly one row per
category ever exists going forward), and `_delete_budget` now removes
every row for the category, not just the `sk` it was called with.

**Known simplification, not a silent decision**: a category can no
longer have two rows coexisting (e.g. a current budget plus a
future-scheduled amount change) - any new submission for a category now
replaces whatever was there. That "schedule a future change without
losing today's" use case was never actually reachable through the UI
before this fix either, so nothing that worked is being removed - but
if that's wanted later, it needs a deliberately different design (an
explicit "schedule for later" action distinct from editing).

## Real bug found via live testing: GET /transactions crashing on every real transaction

`_list_transactions` was missing `default=_decimal_default` on its
`_response(200, items)` call - the exact same class of bug found and
fixed in `accounts-fn`/`peer-notifications-fn` earlier in this project,
but this instance was **older and never actually caught**: it predates
even the CORS fix. Before CORS was fixed, the browser blocked every
response before ever reaching this crash; once CORS started working,
this specific route (which was never re-exercised by the earlier
reproduction-test pass, since that pass checked file-level presence of
`_decimal_default`, not per-call-site) started actually failing for the
first time on any account with real transaction data - which is most of
them, since `amount` is always a `Decimal` once it's round-tripped
through DynamoDB.

Re-audited every `_response(200/201, ...)` call across every Lambda
individually this time (not just file-level `_decimal_default`
presence) to make sure this was the only instance - confirmed the rest
either return plain counts/booleans/strings, echo values that never
round-tripped through DynamoDB, or are already covered by a local
wrapper (`user_preferences-fn`).

Verified with an actual reproduction test, not just reasoned about:
confirmed the exact crash reproduces against the old code and resolves
with the fix, using a fake DynamoDB-shaped transaction item with a real
`Decimal` amount.

## Projected vs Actual spending page

New `GET /budgets/{sk}/projected-vs-actual?range=X` (nested under the
existing `{sk}` resource rather than a new sibling - API Gateway doesn't
allow two differently-named path parameters at the same position, so
this reuses the `sk` parameter name for what's really just a plain
category value). For a given budgeted category, projects two
trajectories forward: what the budget says (`monthlyAmount x months`),
and what real recent spending pace says (average of the last 6 months of
actual spend x months) - so the gap between them is visible early rather
than only in hindsight. Verified empirically, not just reasoned about:
reproduced the user's own $700-budgeted/$600-actual example and confirmed
the projected gap matches exactly.

**A real routing bug caught before it shipped**: the new route was
initially placed after the generic `if method == "GET": return
_list_budgets(...)` fallback, which would have swallowed every request to
it - moved above the fallback, matching the existing `/projections`
route's placement for the same reason.

Frontend: new `ProjectedVsActual.jsx`, its own page for now per earlier
discussion (may move later), with a category picker, the same 3M/6M/1Y/5Y
range pattern as Category Trends, and a two-line comparison chart.

## A public contact form

New `contact-fn` Lambda behind a public, unauthenticated `POST /contact`
route - the only endpoint in the API with no Cognito authorizer, since
it needs to be reachable from the pre-login Landing page. Sends the
message to the site owner via SES with the visitor's own address set
as Reply-To, so a normal email reply goes straight back to them.
Confirmed explicitly in the synthesized template that this route has
no authorizer attached, rather than assuming omitting the auth options
argument was sufficient.

Also: Stripe/Plaid integration is on hold at the user's request,
pending a decision on target scale (personal/family use vs. genuinely
public) - see the chat thread for the fuller discussion of what that
decision changes.

## A new recurring frequency: "2nd Tuesday of every month" and similar

Added `monthly_weekday` - the nth occurrence of a weekday each month
(1st-4th, or -1 for "the last one"), verified against the tricky case
of a month with 5 of a given weekday (the last Friday should always be
the actual last one, not skip to what would be the 4th). Searched the
whole backend for every other place frequency logic lives, since a new
frequency is exactly the kind of change that breaks silently in a spot
nobody thought to check - found two real gaps: `previous_date_before`
(used to find a pay period's start) had no case for it at all and
would have thrown an unhandled error the first time anyone used it for
income paid this way; the monthly-equivalent calculation relied on an
implicit fallback that happened to be numerically correct by
coincidence rather than being explicit about it. Fixed both, then
verified the backward calculation is the *exact* mathematical inverse
of the forward one, not just plausible-looking. CSV import/export
doesn't support this new frequency, but that's consistent with it
already not supporting "custom" either - a pre-existing gap, not a new
regression.

## Auto-completing planned expenses, and same-account division transfers

**Planned expenses now auto-complete when fully funded**, without
waiting for an explicit click - checked on both the manual edit path
and Payday's real-transfer path, since amountSaved can change from
either. Extracted the annual-rollover completion logic (previously
only in planned_expenses-fn) into the shared layer so both Lambdas use
the identical behavior rather than risking two implementations
drifting apart - a mistake this codebase has made before. Caught a
real edge case before shipping: an explicit "revive" on a still-funded
item would otherwise immediately auto-complete it again, defeating the
whole point of reviving.

**Transfers can now move money between two divisions of the same
account.** The actual blocker turned out to be the backend, not the
frontend - `execute_transfer` rejected any transfer where the source
and destination account matched, unconditionally, so fixing only the
UI would have done nothing. Relaxed this to reject only a true no-op
(same account *and* same division), and confirmed the balance math is
correct for a same-account transfer (the two updates net to zero on
the account itself, which is right - the money never left, only
shifted which division it's tagged under). Also added negative-balance
prevention, checked against whichever balance is actually the money's
source - the specific division if one was chosen, otherwise the whole
account.

## Submit confirmation, a real reversal system, and network-error handling

**Payday submissions can now be genuinely undone.** New `/payday/reverse`
endpoint deletes every transaction a specific submission created and
reverses every balance/division impact using the *exact* delta that
was originally applied (not recomputed, since prices or budgets could
have changed since) - including restoring a recurring item's schedule
to precisely what it was before that occurrence advanced it, and
backing out any planned-expense progress that was credited. Required
enriching what several posting functions return, since none of them
previously captured enough to reverse themselves.

**Found and fixed the actual gap behind "submit shouldn't be clickable
twice."** The already-submitted check only ran when a past date was
explicitly browsed via the date picker - viewing the default "your
next payday" view after already submitting it never checked at all,
so a second submission was always silently possible. Now always
checks, with a reversed submission correctly falling back to allowing
resubmission.

**"Load failed" errors, traced to their real source.** This string
doesn't exist anywhere in the app's own code - it's Safari's generic
message for a `fetch()` that fails at the network level, completely
different from a real HTTP error response and confusing when shown
directly. The shared request function now catches this specific
failure mode and gives a clear, honest message instead - including
that it's genuinely uncertain whether the request went through, since
a client-side network failure doesn't guarantee nothing happened
server-side.

Also: a real gap in category-list defaults closed - a category typed
while adding a planned expense had nowhere to persist across the
session before this, unlike the equivalent flow on every other form
in the app.

## Deposits can now split across divisions, and Payday shows what actually changed

**Finished the division-balance fix from last round.** `_add_expense`
already accepted a `divisionId` per split; wired up the actual frontend
UI for it - a deposit can now genuinely be split across multiple
divisions, with the top-level division selector becoming the primary
(unsplit) portion's division once splits exist. Verified the
undefined-vs-omitted-key JSON serialization the backend's per-split
fallback depends on works exactly as expected before trusting it.

**Payday submit now returns real updated balances**, not just the
list of transfers - collects every account actually touched across
recurring postings, manual entries, budget transfers, and planned
expense transfers, then re-fetches each one fresh (with all its
divisions) after every write completes, so what comes back is
genuinely the new state, not a computed guess.

## Planned expenses overhaul, mark-complete with annual renewal, and division-balance root cause fixed

**Planned expenses gained a real `completed` state and a `/complete`
endpoint** - for an annual item, completing it also creates a fresh
card for next year automatically (verified the date math holds even
if an item was years overdue). Payday now splits planned expenses
into upcoming (normal prorated contribution) and overdue (the genuine
remaining gap, not a further-prorated fraction of it - verified with
a four-item scenario covering every case: fully-reached-but-past,
overdue-and-incomplete, explicitly-completed, and genuinely-upcoming,
all classified correctly at once). Submit-time logic now accepts
manual amount overrides and updates `amountSaved` after every real
transfer - previously actual money movement wasn't reflected in saved
progress at all. Projections had the same completed-item gap fixed.

**The account-total/unassigned mixup, root-caused rather than
patched.** Traced the screenshot's numbers and found the display math
was actually correct - the real problem was that a division's balance
could be set directly via PUT, completely disconnected from any real
transaction, letting it drift out of sync with what the account
balance actually reflects. Removed manual balance editing at the
model level (creation always starts at zero, update only allows a
rename) - a division's balance can now only ever move via a real,
signed transaction. `_add_expense` now supports a `divisionId` per
split, not just one for the whole purchase, so a deposit can
genuinely be split across multiple divisions.

## Payday requires income now, and a real fix for unpaid items disappearing

**Root-caused the exact Payday amount-inflation bug from two rounds
back**, which had been left as an open question. With zero income
sources, `previous_real_payday` was silently falling back to an
arbitrary ~30-day placeholder window - a $700 biweekly budget prorated
over that fake 30-day span instead of the real 14 comes out to almost
exactly $1,500, matching the screenshots precisely. Rather than trying
to make a meaningless fallback window "correct," Payday now returns a
plain `noIncome` signal when there's no income source at all (scoped
to the default "next payday" view specifically - a past date that
already has a submitted history record still works even without
current income, since that record doesn't depend on today's income
setup).

**A real, previously-invisible bug in the "mark as still unpaid"
feature**: an item flagged as still overdue would correctly show on
the payday it was created for, then silently vanish from every later
payday - directly contradicting the point of marking it unpaid in the
first place. The occurrence-relevance check required a due date to
fall strictly within the currently-viewed pay window; once a later
payday came into view, an unpaid item's date no longer fell in that
window and got walked right past. Since an item's due date only ever
sits in the past when it genuinely hasn't been submitted yet (nothing
else moves it there), the fix is simpler than the original logic: an
unpaid occurrence is relevant to every payday view through and
including its own date, not just the one it originally fell into.
Verified against the exact reported scenario (due 8/11, marked
unpaid, correctly persists on both the 8/13 and 8/27 payday views) and
against a genuinely future item to confirm that still correctly stays
hidden.

The "still unpaid and overdue" checkbox itself no longer shows for
income - income arrives, it isn't something that can be unpaid, so a
past paycheck date now always just advances to the next real payday
without needing an opt-out.

## Expenses can now be deposits, and a real fix for "delete does nothing"

**Manual transactions now support a direction**, not just expenses -
`_add_expense` accepts an optional `direction` ("debit" or "credit"),
correctly flips the sign on the division adjustment and account
balance update for a deposit, and skips budget-threshold alerts for
deposits (a deposit isn't spending against a category budget).
`_edit_purchase_splits` (editing an existing manual transaction) got
the same treatment - previously hardcoded `"direction": "debit"` on
every rewrite, which would have silently converted a deposit back
into an expense the first time it was edited. Now reverses each old
row using its own actual recorded direction and applies the new
splits using the resolved direction, verified against three cases
including a full expense-to-deposit flip (the net balance math comes
out exactly right in all three).

**The "delete does nothing" pattern, actually explained this time.**
`ConfirmDeleteDialog` is a full-screen overlay with no way to display
an error - if a delete call failed, the error message was being set
on the page *behind* the still-open dialog, completely invisible.
That's indistinguishable from nothing happening at all. Added error
display to the shared dialog and wired it into every one of its six
usages across the app. This doesn't claim to fix whatever's actually
causing budget deletion to fail underneath - static review of the
route, the query, and the response handling all looked correct - but
it means the real error will be visible on the next attempt instead
of silently disappearing, which is the fastest path to actually
finding it.

Also: removed a decorative dashed line from three more places on the
Budgets page (both budget card variants and the "This period" summary
box) matching the same cleanup done elsewhere before.

## New logo/favicon artwork, and a large round of real bugs found and fixed

**New brand artwork** installed - the uploaded files were 8000x4266px
(logos) and 2400x2400px (favicons), print-resolution originals rather
than web-ready assets. Resized to 900px-wide logos and 128x128
favicons (generous margin for retina displays) before using them -
otherwise every page load would have pulled ~1.6MB of image for
something displayed at 130-260px wide. About a 25x file-size
reduction, no code changes needed since these replace the existing
files at the same paths.

**A real structural bug class, found via a concrete symptom and then
found again elsewhere.** A "Delete" button that visibly did nothing,
followed by a broken confirmation dialog appearing only after
clicking Cancel, traced to the dialog being rendered only in the
list-view's return block - a completely separate code path from the
edit view where the delete trigger actually lives. The same pattern
(delete confirmed but not deleted, no error) suspected but not fully
resolved for budgets - added a defensive check so a failed delete at
least surfaces a real error now instead of silently succeeding.

**Payday's "money to move out" window, actually root-caused this
time.** Traced my own inline comment against my own code and found a
real confusion I'd introduced two rounds back: the window was
extending to the payday *after* the one being viewed, not stopping at
the one being viewed. Removed the over-extension entirely and merged
the two sections into one, as explicitly requested. Screenshots with
exact dollar amounts ($700 budget showing as $1,550, $10 showing as
$22.14) gave an exact mathematical fingerprint of a ~31-day window
being used instead of the correct 14-day one - traced as far as
possible but couldn't fully confirm whether the #8 fix also resolves
this, flagged as needing a recheck rather than claimed as fixed.

**Category "not saving" bug, diagnosed before touching anything.**
Traced carefully and found the save was never actually broken - a
typed category was always persisted correctly. The real gap was
display-only (missing from the list, dropdown couldn't show a
category not tied to an existing budget on reopen) - fixed both
without touching the save path.

**New features:** flexible recurrence (`"custom"` frequency, every N
days/weeks/months) - caught and fixed the same "monthly-equivalent"
duplication bug in four separate places (two backend Lambdas, two
frontend files) while wiring it through, none of which would have
handled the new frequency correctly. Budget amounts on Payday now
account for real spend already made this period rather than always
showing the full period cap, with a manual override option. Accounts
gained a `sortOrder` field and a `/accounts/reorder` endpoint, a
connection to an external bank account reference, and duplicate-name
rejection extended to external bank accounts too (same pattern as
accounts). Notes field on recurring items. Division-creation support
added to the Budgets destination-account dropdown, and account
creation to the same form.

## Flexible recurrence intervals, and a real diagnosis of the Payday "money to move out" report

**Custom recurrence** - "every N days/weeks/months," not just the fixed
weekly/biweekly/semimonthly/monthly/annual set. New `"custom"`
frequency in the core schedule math (both directions), with
`intervalCount`/`intervalUnit` validated on both create and update.
Found the same duplicated-and-now-wrong pattern **three separate
times** while wiring this through: a "convert a recurring item to a
monthly-equivalent amount" helper existed as an identical dictionary in
two different backend Lambdas, plus two more independent copies on the
frontend (Upcoming Expenses' schedule math, Scenarios' own conversion
helper) - none of the four would have handled a custom-interval item
correctly without this fix, all four now share one source of truth
(or, for the two frontend copies, are verified byte-for-byte against
the real Python backend with matching test cases).

**The Payday "money to move out" report, actually diagnosed rather than
guessed at.** Got the user's real income configuration (biweekly, next
due today) and traced the exact window math against it - confirmed the
boundary calculation was correct the whole time, not a bug. The real
gap: `nextDueDate` was "trusted as given" at creation time with no
distinction between "here's my ongoing schedule" and "this specific
past occurrence is still unpaid" - so a brand-new item entered with a
due date earlier in the current month showed up as owed on day one.
Fixed with a sensible default (auto-advance to the next occurrence
going forward) plus an explicit opt-out checkbox for genuinely overdue
bills. Verified against every item from the user's own screenshots by
name.

**"Unassigned account" mislabeling**, fixed everywhere it appeared
(Recurring's list, Payday's expense rows, Payday's "by bank account"
aggregation) - all three were showing only the external bank account
reference and falling back to a scary red "Unassigned" when it was
empty, never actually showing the real internal account, which every
item always has. Now shows the internal account always, with the
external one as supplementary "drafted from" detail.

**Category-creation "bug" that wasn't actually a save failure** - traced
carefully before touching anything. A custom category typed while
adding a recurring expense was always being saved correctly; the
category just had nowhere to visibly confirm it (missing from the
list, and the edit-reopen dropdown couldn't display a category that
wasn't tied to an existing budget). Fixed both display gaps rather
than touching the save path, which was never broken.

Also: a real "add new category" option on Add Expense (previously
missing entirely), a `notes` field on recurring items (separate from
the title), and division-creation support on the Budgets dropdown,
matching the pattern already used elsewhere.

## Duplicate account names now rejected

New `_name_already_used` check, case-insensitive (so "Checking" and
"checking" collide too) and whitespace-trimmed, scoped to the caller's
own accounts only - not accounts shared with them by someone else.
Wired into both account creation and rename. Found and fixed a real
gap while wiring this in: `ManageRecurring`'s inline "add a new account"
flow was silently swallowing every error from account creation - fine
when creation essentially never failed, but this validation is now an
expected, common rejection path that needs to actually reach the user.

## Projected vs Actual: redesigned around real pay periods, not categories

Full replacement of the old category-specific endpoint - dropped the
category selection entirely (Category Trends already covers per-category
breakdowns) in favor of total money in minus total money out, per real
pay period. Moved the route out from under `/budgets/{sk}` (previously
nested there only to dodge an API Gateway same-position path-parameter
conflict, since a category no longer needs a path segment at all) to a
direct sibling, `/budgets/projected-vs-actual`.

"Actual" is computed directly from real transaction history across every
account the user owns for that period - which means fund movement made
through the Payday calculator (transfers are real transactions) and any
expense added during the period are automatically included with no
special-casing needed, since they're just part of the same transaction
table everything else already draws from.

Caught a real boundary bug of my own before it shipped, not after:
initially assumed `sk > period_start` would correctly exclude that
date's own transactions from a period, but DynamoDB/Python string
comparison treats a longer string sharing a prefix as "greater than"
the bare prefix - so `"2026-08-13#abc" > "2026-08-13"` is true, meaning
period_start's own transactions were leaking into the wrong period.
Verified this explicitly with the exact mixed date/timestamp `sk`
formats this table actually uses, then fixed it with a `\uffff`
sentinel on both boundaries and re-verified all six test cases behaved
correctly - a mistake that's easy to make and easy to miss without
testing the actual string comparison, not just reasoning about it.

## Division trend charts on Account Detail

New `divisionTrendCharts` user preference, keyed by accountId (divisions
belong to one specific account, unlike categories which span all of
them) - same customization pattern as the existing `categoryTrendCharts`
preference. Preferences has an explicit field allowlist, not an
open schema, so this needed adding there deliberately or it would have
been silently dropped on every save.

## Upcoming Expenses: editable amount and due date per occurrence

Generalized `_set_occurrence_override` (previously hardcoded to only
ever adjust a recurring item's *immediate next* occurrence) to accept
an explicit `occurrenceDate`, so any future occurrence shown on the
Upcoming Expenses page can be edited, not just the very next one.

New parallel `occurrenceDateOverrides` map alongside the existing
`occurrenceOverrides` (amount) - a one-time date change for a single
occurrence, following the exact same principle: the schedule itself is
never disturbed. The occurrence *after* a moved one is still computed
from its original scheduled date, not the overridden one, so nudging
one payment doesn't silently drag every future occurrence along with
it. Verified this explicitly - traced what the next occurrence would
incorrectly become if the override leaked into the schedule walk,
confirmed it differs from the correct (unaffected) result, and confirmed
the actual implementation returns the correct one.

Threaded through everywhere an occurrence's date actually matters: both
`recurring_processor` (the daily automated poster) and payday-fn's own
occurrence-posting path now post using the *effective* (possibly
overridden) date for the transaction record itself - not just show it
differently while quietly posting on the original date. Payday's own
preview of upcoming expenses was also updated to display the effective
date and correctly evaluate whether an occurrence counts as "after
payday" against it, not the original schedule.

## Scenarios: real income adjustments, timed changes, and a trend over real pay periods

**"Adjust an existing income" now a real dropdown**, matching the
existing expense pattern exactly - shows the item's current amount
right in the option label. Selecting an item pre-fills the amount field
with its current monthly-equivalent value; the user edits toward the
*new* total rather than typing a raw delta, which gets computed
automatically before saving.

**Every adjustment type can now carry a start date** - when a recurring
change or new hypothetical item actually begins, for the trend below to
use. **New one-time-expense type** (a single cost on a specific date,
not an ongoing bill) - snapped to whichever real payday comes
immediately before it, on the reasoning that's when the money would
actually need to be set aside, matching how Payday itself already
thinks about timing. Snapped fresh every time it's calculated, never
baked in at save time - consistent with how a scenario here is never a
frozen snapshot.

**Comparison table now shows a real breakdown**, not just a net dollar
figure - every individual adjustment, resolved to its actual name for
income/expense items previously only identified by `recurringId`.
Caught two of my own sign-logic mistakes while building this: an
expense adjustment's delta was being flipped to show the opposite of
what the user actually typed, and a new expense was coloring green (as
if it helped) because I was coloring off the raw displayed number
instead of its actual effect on leftover.

**New trend chart** - cumulative leftover across real future pay
periods (not calendar months), baseline plotted against every selected
scenario. Required moving `next_real_payday_after`/`previous_real_payday`
out of payday-fn into `finance_common/payday_periods.py`, since
scenarios-fn needed the identical "find the real paycheck boundary"
logic and, same lesson as divisions and planned-expenses before this,
a separate Lambda can't import another function's own code. Re-ran the
exact test cases from the original functions after the move to confirm
nothing broke in the migration. The trend math itself - each adjustment
only starts counting once its own start date is reached, one-time
expenses hit exactly their snapped period as a lump sum - was traced by
hand against a real multi-period example before trusting it.

Caught a real gap of my own during final verification: the new
`/scenarios/trend` endpoint was fully wired in the Lambda but I'd
forgotten the actual API Gateway route entirely. Not caught by any
syntax or import check - only visible because the CloudFormation
resource count didn't move after adding a supposedly-new endpoint,
which is exactly why that count gets checked after every route
addition, not just glanced at once.

## Modifying and deleting existing expenses, and a new shareable permission

**Real gap in my own earlier division work, found while building this.**
When division support was added to Add Expense, the division balance got
adjusted at creation time, but the transaction record itself never
actually stored which division it belonged to - meaning there was no way
to correctly reverse that division's balance later on edit or delete.
Fixed by persisting `divisionId` per transaction row (per split, not just
once for the whole purchase, so a specific split can later be reversed
independently of its siblings), and updated the existing delete function
to actually reverse it.

**New whole-purchase edit and delete.** `_edit_transaction` already
existed but only edited one row's fields - it had no way to add/remove
splits or change how an expense is divided. New `_edit_purchase_splits`
replaces a purchase's entire split structure (reverse the old rows,
apply the new ones), computing only the *net* balance difference rather
than reversing the full old amount and reapplying the full new one -
verified this arithmetic empirically in both directions (total goes
down → balance goes up; total goes up → balance goes down). New
`_delete_purchase` removes every row belonging to a split expense as one
action, correctly reversing each row's own account and division impact
individually rather than assuming they're uniform.

**New `modifyTransactions` sharing permission**, deliberately separate
from the base "edit" account permission - a shared editor can still add
new transactions with plain edit access, but modifying or deleting
*existing* ones (rewriting or erasing something the owner already
recorded) now requires this specific, additional permission. Defaults to
`not_shared` automatically, same as every other granular permission, so
it's genuinely off by default with no extra logic needed. Also exposed
the account object's `dataPermissions` to the frontend for the first
time - it existed on the backend already but was never actually sent
down, so there was no way for the UI to check a granular permission like
this one at all before now.

New routes: `PUT`/`DELETE /accounts/{accountId}/transactions/purchase/{purchaseId}`
- nested under a literal `purchase` segment rather than sharing the
`{txnId}` path position, since API Gateway doesn't allow two
differently-named path parameters at the same spot.

## Three real, confirmed bugs found and fixed this round

**Planned expenses could crash Payday entirely.** `suggestedContribution`
is deliberately never persisted on the DynamoDB item - it's computed
fresh at read time by `planned_expenses-fn`'s own list/create/update
functions, attached to the response, never written back to the table.
`payday-fn` reads planned expenses directly from the table (a separate
Lambda package, so it can't call `planned_expenses-fn`'s function
directly) and was accessing `pe["suggestedContribution"]` as if it were
already there - a guaranteed `KeyError` the moment any planned expense
existed, in both the preview endpoint and, more seriously, inside
`_submit` itself. Fixed by moving the calculation into
`finance_common/planned_expenses.py` so both Lambdas share the exact
same logic - same lesson as the earlier divisions cross-Lambda mistake,
now caught faster. Verified the fix runs cleanly against a raw stored
item with no `suggestedContribution` field at all, matching exactly
what `payday-fn` actually reads.

**A newly-surfaced side effect of last round's window fix.** Widening
Payday's "due soon" window (previous round) to extend to the user's
actual next payday, rather than a fixed 5 days, meant many more items
now show in that section - but the *submit* payload still only posted
the subset due before the exact payday date, silently dropping
everything else shown on the page. Fixed by posting everything
displayed, not just that subset - each occurrence still records its own
true due date regardless of when it's actually posted, so nothing about
the historical record becomes inaccurate.

**The iOS zoom-on-tap fix from a couple rounds back was only partially
effective.** Root cause: a plain `input { font-size: 16px }` rule is
silently beaten by any Tailwind text-size class (`text-sm`, `text-xs`,
etc.) on the element, since CSS class selectors always win over
element-type selectors regardless of source order - and nearly every
input in the app has one, so the original fix did almost nothing.
Switched to `!important`, with a targeted override preserving the
handful of inputs that are deliberately large (MFA code entry, big
dollar-amount fields) and were never actually part of the problem.

Also removed a leftover Settings.jsx section (per-recurring-item budget
alert toggles) that should have been cleaned up when alert ownership
moved to Budgets a couple rounds back - it was calling a backend field
that no longer exists, so the toggle appeared to work but never
persisted anything.

## Payday's window was too narrow - the real cause of the missing-expenses report

Two rounds back, a report that specific recurring expenses weren't
showing on Payday couldn't be reproduced against the exact scenario as
initially described. Screenshots this round revealed what was actually
happening: the payday being viewed was *today's* payday, and "due within
5 days after" cut off exactly 5 days out - so anything due later in a
longer pay period (a biweekly gap, in this case) was correctly excluded
by that fixed window, even though the underlying date math was right all
along. Not a bug in the calculation - a window that was too narrow for
what the page needed to show.

Fixed by replacing the fixed 5-day window with a new
`_next_real_payday_after()` (the forward-looking counterpart to the
existing `_previous_real_payday()`) - the window now extends to the
user's actual next real payday, however far out that is, rather than an
arbitrary fixed number of days. Verified against the exact reported
scenario (payday 8/13, biweekly income, bills due 8/18/8/19/8/26) -
all three now show correctly, and confirmed the fix doesn't overreach
past the real next payday either.

## Account divisions, alerts moved to budgets, and a round of real-usage fixes

**Divisions** - a new concept: a named sub-allocation within one account's
balance (e.g. an account with $500 total might have a "Vacation fund"
division holding $200 of that). New `DivisionsTable` (scoped per-account,
same key shape as Recurring), new `divisions-fn` Lambda for CRUD, and an
optional `divisionId` on Recurring items - when a division-tagged item
posts (via the daily processor or a Payday submission), both the
account's balance AND the division's own running balance update. A real
architecture mistake caught mid-build: the balance-adjustment helper was
initially placed inside `divisions-fn`'s own code, then realized
`recurring_processor` and `payday` are separate Lambda packages that
can't import from another function's deployment package - moved it into
`finance_common/divisions.py` instead. Every new table/Lambda/route
confirmed as a real resource in the synthesized CloudFormation template.

**Budget alerts moved from recurring items to budgets themselves.** The
old per-recurring-item "notifications enabled" toggle is gone entirely
(backend and frontend, including CSV import/export and its docs); Budgets
gained a real `alertsEnabled` field instead, wired into the actual
threshold-check logic.

**Real bugs found and fixed from live testing:**
- Payday's leftover total was silently excluding recurring expenses due
  within 5 days after payday - they were visible on the page but never
  subtracted from the math.
- `_update_account` was a stub returning 501; `_delete_account` didn't
  account for recurring templates or budget/planned-expense destinations
  still pointing at the account being deleted. Both fully implemented -
  delete now blocks if recurring items still reference the account
  (rather than risk DynamoDB silently creating an orphaned record later)
  and clears any budget/planned-expense transfer destinations that
  pointed to it.
- The reported mobile "zoom in when tapping a field" behavior was iOS
  Safari's standard auto-zoom on a focused input under 16px font -
  fixed with one global CSS rule rather than editing every input
  individually.

## Payday actually moves money now, and the proportional-scaling bug fix

Real user testing surfaced a genuine bug in the frequency work from the
previous round: a weekly budget against biweekly paychecks wasn't
doubling like it should. Root cause - the original implementation only
handled proportional splitting for "monthly" budgets; weekly/biweekly
just returned the flat amount regardless of how many actual days had
passed. Rewritten to a general proportional daily-rate model instead
of a special-cased one: `budget_amount_due_on_payday(budget,
previous_payday, next_payday)` converts the budget's amount to a
daily rate based on its own frequency, then scales by however many
real days actually elapsed in that specific pay period - so a weekly
budget correctly shows double on a 14-day gap, a monthly budget shows
roughly a quarter on a 7-day gap, and so on, for any combination.
Verified against the exact reported scenario, not just reasoned about.
This also simplified `budget_frequency.py` considerably - the previous
month-bucketing approach (walking real paydays within a calendar
month) is no longer needed at all.

**Budgets and Planned Expenses can now actually move money, not just
remind you to.** Budgets gained an `accountId` field (Planned Expenses
already had `linkedAccountId`) - either destination account, if set,
now receives a real transfer when Payday is submitted, sourced from
wherever the paycheck lands. New shared `finance_common/transfers.py`
extracts the transfer logic out of `transactions-fn`'s direct
`/transactions/transfer` endpoint so both paths use the exact same
tested code rather than duplicating it - `transactions-fn` was
refactored to use it too, not just `payday-fn`.

**Found and fixed a serious, separate, pre-existing bug while building
this - genuinely reproduced, not just suspected.** `_save_payday_history`
was passing plain Python floats into a DynamoDB `put_item` call, which
boto3 rejects outright with a `TypeError` - and the surrounding code
wrapped the whole thing in a bare `except: pass`, silently swallowing
every failure. This means payday history has likely never actually
saved successfully, ever. Reproduced the exact failure against a real
mocked DynamoDB table (via `moto`), verified the fix the same way, and
changed the exception handler to log instead of silently hiding
failures like this in the future.

Payday's leftover calculation was also updated to actually subtract
budgeted and planned-expense amounts - previously they were shown on
the page but never affected the "left over after this payday" figure.

## Payday redesign: budgeted expenses, browse any payday, real frequency support

A substantial rework based on how the user actually wants Payday to
function: every payday should show recurring expenses, unpredicted
amounts, AND budgeted expenses together, for whichever payday is being
looked at - past, present, or future.

**Budgets gained a `frequency` field** ("monthly" | "weekly" |
"biweekly"), and `monthlyAmount` was renamed to `amount` throughout -
this rippled further than just budgets-fn and payday-fn:
- `scenarios-fn`'s expense-total summing now converts each budget to a
  monthly-equivalent before summing, since budgets can have different
  frequencies now (previously assumed everything was monthly).
- `budget_notify.py`'s 80%/100% threshold alert was a real, newly-
  introduced bug waiting to happen: it compares *cumulative* spend
  since the budget's effectiveStartDate against the raw cap. A weekly
  budget's raw amount is far smaller than a month's worth of cumulative
  spend, so without converting to a monthly-equivalent basis first, a
  weekly budget's "over budget" alert would fire almost immediately and
  stay perpetually stuck on "over" for the life of the budget. Fixed
  before it ever shipped.
- The Projected-vs-Actual page's `monthlyBudgeted` figure now converts
  properly too.

**New `finance_common/budget_frequency.py`** computes real paydays
falling within a given calendar month, from the user's *actual* income
schedule (not an assumed one) - used to split a monthly budget's amount
across however many real paydays land in that month, which varies
month to month. This needed genuinely *exact* bidirectional date
stepping, not an approximation - caught and fixed a real correctness
bug in my own first draft (an approximate backward step that would
have silently produced wrong dates for monthly/semimonthly income
schedules) before it ever reached the codebase for real, and verified
every frequency combination empirically: biweekly, semimonthly, and
monthly income, walking both forward and backward across month/year
boundaries, phase-correct with zero drift in every case tested.

**`payday-fn`'s `_get_upcoming` rebuilt** to accept `?date=YYYY-MM-DD`:
- A date that was already submitted returns the real historical
  record instead of a stale live computation.
- Any other date (including one further out than an item's immediate
  next occurrence) computes a live preview as if that were the
  payday - via a new general occurrence-finding walk, verified
  empirically against the existing "next upcoming" behavior (zero
  regressions) and the new far-future case.
- Budgeted expenses and planned-expense contributions are computed
  fresh for *both* branches (history and live preview) - purely
  informational reminders, never posted as transactions, since a
  budget's real spend already comes from actual purchases and a
  planned expense's saved amount is tracked separately; posting a
  synthetic amount for either would double-count.
- Found and fixed a real gap while building this: both transaction-
  posting functions' return values - which become the *permanent*
  historical record for a payday - were missing `description`/
  `category` entirely. Browsing a past payday would have shown bare
  dollar amounts with no way to tell what they were even for.

New IAM grants for `payday-fn` (BudgetsTable, PlannedExpensesTable read
access) confirmed as real resources in the synthesized CloudFormation
template, not just assumed from source.

## Recurring: separated "next occurrence" from "backfill start date"

Previously one field (`startDate`) did double duty: a future/today value
became `nextDueDate` directly, but a past value triggered backfill *and*
then `nextDueDate` was whatever the forward-walking schedule math landed
on after today - which could silently drift from the real next occurrence
if actual real-world dates don't align perfectly with the pure math (a
holiday shifting a payday, say). Split into two independent fields:
`nextDueDate` (trusted exactly as given, never derived) and optional
`backfillFromDate` (past-only, for trend history, completely separate
from what the real next occurrence is). Verified empirically, not just
reasoned about: reproduced a case where the two dates deliberately don't
align and confirmed `nextDueDate` is never overwritten by the backfill
walk. Applied to the general recurring creation endpoint, not scoped to
any one caller, so every entry point benefits - including the new
Dashboard quick-actions "Add income" flow.

## Item 13: retroactive date entry with confirmation

**Recurring** (income/expense): a past `startDate` (up to 1 year back)
generates real transaction records for every missed occurrence between
that date and today, tagged `isRetroactiveEntry: true`, requiring explicit
opt-in via a `backfillForTrends: true` flag - the frontend only sets this
after the user confirms a dialog explaining exactly what happens. The
template's `nextDueDate` is set to the first occurrence on/after today,
so the normal daily processor never re-touches the backfilled dates.
Deliberately does NOT touch the account balance - the whole point is
describing history that's already reflected in today's real balance, not
new money moving. Verified the occurrence-generation logic empirically
(not just reasoned about): reproduced a real backfill sequence and
asserted every generated date is before today and the resulting
`nextDueDate` is on/after today.

**Budgets**: needed far less new logic than it looked like - budget
spend was already computed live from real transaction history starting
at `effectiveStartDate`, so a past date already pulled in real historical
spend with zero backfill needed. Just added the same 1-year cap and
confirmation-required pattern for consistency and to set expectations
accurately (budgets never touch balance either way, past or present).

**One real design tension, resolved and documented in code, not silently
decided**: Account Detail's balance-trend chart is reconstructed backward
from the real current balance through transaction history. Retroactive
entries are excluded from that specific reconstruction (they'd otherwise
show balance dips/gains that never happened) but still count normally in
Category Trends and Budget spend calculations, which are about real
historical spend, not balance reconstruction. Backfilled transactions are
also visibly tagged "· backfilled for trends" in the transaction list.

## Feedback-round fixes (backend), round 3 — real Sharing table schema bug

Found while implementing "share multiple accounts with one person, one
email": the Sharing table's key was `(ownerUserId, invitedUserId)` with
**no account in the key at all**. This meant at most ONE share could ever
exist between a given owner and invited user - sharing a *second* account
with the same person would silently `put_item` over (and destroy) the
first share, with no error, no warning. This was a pre-existing bug, not
something the batch-sharing feature introduced - it just surfaced it.

**Fixed**: sort key changed to `shareKey = "{invitedUserId}#{accountId}"`.
`invitedUserId` remains a plain attribute (not part of the key) so the
`byInvitedUser` GSI is unaffected. This is a genuine table replacement
(DynamoDB can't change key schema in place) - confirmed safe given no real
users/data exist yet, matching the same situation as the earlier
`hasCompletedSetup` Cognito attribute change.

Also added:
- `_create_invites` now accepts `accountIds` (a list) instead of a single
  `accountId`, creating one row per account but sending exactly ONE email
  (via new `_send_invite_email`, using `sharingFn`'s new SES permission)
  regardless of how many accounts were included.
- `_respond_to_invites` (PUT) now accepts/declines every pending share
  from that owner to the caller at once, not one row at a time - the
  batch-accept counterpart to the batch-invite.
- `DELETE /sharing/{invitationId}` (owner revokes every share, any
  status, extended to that invited user) - didn't exist at all before.
- Found and fixed one more place still using the old key shape:
  `account_deletion/index.py`'s sharing-record cleanup.

Confirmed directly in the synthesized CloudFormation template (not just
assumed from source): the new `shareKey` sort key, and the new DELETE
method resource.

## Feedback-round fixes (backend), round 2

- **`budgets-fn`**: added `DELETE /budgets/{sk}` - there was no way to
  delete a budget at all before this (only create/upsert existed).
  `{sk}` is `category#effectiveStartDate`, which contains a literal `#`,
  so the frontend must `encodeURIComponent` it - confirmed present as a
  real API Gateway Method resource in the synthesized template, not just
  assumed from the CDK source.
- **`payday-fn`**: `_get_upcoming`'s expense window now extends 5 days
  past the next payday (previously cut off exactly at payday), tagging
  each expense `isAfterPayday` so the frontend can show it separately as
  informational rather than folding it into what actually gets submitted
  and paid this cycle.

## Feedback-round fixes (backend)

- **`sharing-fn`**: `GET /sharing` now resolves and includes the account
  owner's email on every `asInvited` entry (`ownerEmail`, via the same
  `lookup_email_by_sub` used elsewhere). Previously an invited user had
  no way to know who was sharing an account with them at all - not even
  an email - since the record only ever stored the owner's raw Cognito
  user id.
- **`budgets-fn`**: `_list_budgets` now returns every category's latest
  budget regardless of whether its (paycheck-snapped) start date has
  arrived yet, tagged `isUpcoming` when it hasn't. Previously a
  newly-created budget was invisible in the list until its effective
  start date arrived - which is often days away - making a successful
  save indistinguishable from a silent failure. `spentAmount` is only
  computed for budgets actually in effect; `get_active_budgets` (used by
  projections/notifications, which correctly should only count budgets
  actually in effect) is unchanged.

## Structure

```
bin/finance-app.ts       Entry point — instantiates FinanceApp-Beta and FinanceApp-Prod
config/environments.ts   Per-environment config (naming prefix, tags, retention, Cognito tier)
lib/finance-app-stack.ts Main stack — wires all constructs together, applies tags
lib/constructs/
  data-tables.ts          DynamoDB tables (Accounts, Transactions, Budgets, Recurring, AuditLog, Sharing, ...)
  auth.ts                 Cognito User Pool (Plus tier toggle per environment)
  lambdas.ts              All Lambda functions, least-privilege IAM per function
  api.ts                  API Gateway routes + Cognito authorizer
  frontend.ts             S3 bucket + CloudFront (routes /api/* to API Gateway, else to S3)
  observability.ts        CloudWatch alarms, SNS alert topic, DLQ for the daily job
  shared-layer.ts         The finance_common Lambda Layer construct
lambda/                   Python handler source per function
lambda-layers/finance-common/python/finance_common/
                          Shared logic used by multiple functions - see below
```

## Shared Lambda Layer

Three near-identical implementations of the recurring-schedule math (in
`budgets/`, `payday/`, `recurring_processor/`) and three of the budget-
notification-check logic (in `csv_import_export/`, `recurring_processor/`,
`transactions/`) used to be copy-pasted independently, with nothing
enforcing they stayed in sync. That logic now lives once, in
`lambda-layers/finance-common/python/finance_common/`, as a Lambda Layer
attached to every function that needs it:

- `schedule.py` — recurring-transaction date math (pure functions)
- `cognito_lookup.py` — email ↔ Cognito sub lookups
- `budget_notify.py` — active-budget lookup, cross-account category spend,
  and the "invoke notifications-fn" trigger

Two real bugs surfaced while consolidating this:
1. `sharing-fn` called Cognito's `list_users` but never had the IAM
   permission to do so - the sharing invite flow would have failed at
   runtime. Fixed.
2. `budgets/index.py`'s local copy of the spend-aggregation query never
   filtered to `direction == "debit"`, unlike every other copy - meaning
   budget "spent" totals and `spentSoFarThisPeriod` in projections could
   have been inflated by credits (refunds, one-time income) landing in
   that category. Fixed by consolidating onto the shared (correct) version.

## Observability & Reliability

- **`lib/constructs/observability.ts`** — CloudWatch alarms on the two
  functions that run unattended (`recurring-processor-fn`,
  `notifications-fn`), an SNS topic that emails `cfg.alertEmail` when
  either errors, and a dead-letter queue on the daily recurring schedule
  so a failed run is captured for inspection instead of vanishing.
- **User-facing failure notification:** each recurring template is now
  processed in its own try/except inside `recurring_processor/index.py` -
  one bad template no longer aborts every other user's due payments for
  the day. The affected user gets a direct "we couldn't process your
  recurring payment" email same-day; the function still re-raises after
  the loop if anything failed, so the CloudWatch alarm/DLQ above still
  fire too - the user finding out and you finding out are two separate,
  both-necessary things.
- **REQUIRED before your first prod deploy:** set `alertEmail` in
  `config/environments.ts` to a real address you monitor. It ships with a
  placeholder (`you@example.com`) that won't receive anything.
- Every Lambda has log retention configured (2 weeks in beta, 3 months in
  prod) instead of the previous unbounded default.

## CI/CD

`.github/workflows/deploy.yml` — validates (type-check + synth both
stacks) on every push/PR, auto-deploys beta on push to `main`, and deploys
prod behind a required manual approval (configure reviewers under repo
Settings → Environments → `production`). Needs `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` repo secrets (or swap for OIDC role assumption —
see the comment at the top of the workflow file).

## Shared-Account Authorization & Activity Alerts

Sharing an account with "edit" permission was, until recently, stored but
not actually enforced or usable:
- `GET /accounts/{id}/transactions` had no ownership check at all - any
  signed-in user who knew an accountId could read its history
- Every write keyed its balance update by the CALLER's own user id rather
  than the account's real owner - a shared "edit" user attempting to use
  that access would have silently created a phantom Accounts-table item
  instead of updating the real account

Fixed via `finance_common.sharing_access.resolve_account_access` (owns-it
or has-an-accepted-share, at what permission), applied to every
`/accounts/{id}/transactions` route, `/accounts/{id}/income`, and
`GET /accounts` (which now also returns accounts shared *with* the caller,
previously invisible to them). `transactions-fn`'s writes are also
correctly keyed by the resolved owner now, not the actor.

**Provenance & transparency:** when the acting user differs from the
account owner, transactions are stamped `addedByUserId`
(`GET /transactions` resolves this to `addedByEmail`), and the owner gets
an email via `finance_common.shared_activity_alerts` whenever a shared
editor adds, edits, or deletes something. Defaults ON for every user
(transparency-first) - opt-out is a `PUT /preferences` call
(`sharedActivityAlertsEnabled: false`), backed by the new
`user-preferences-fn` / UserPreferences table. No frontend UI for this
toggle exists yet; when Settings gets wired, add it there. Also worth
adding to the Getting Setup wizard once it's wired: a step or link that
takes the user to communication/notification settings, so they know this
exists and can adjust it early rather than discovering it later.

`_transfer` (between a user's own accounts) was deliberately left
untouched - it still requires ownership of both accounts, which is
correct as designed; a transfer involving someone else's shared account is
a different feature (closer to the peer fund-movement notifications) and
wasn't part of this fix.

**Recurring templates had the identical gap** (`recurring-fn`'s list,
update, delete, and occurrence-override routes had no ownership check;
create stamped the caller's own id instead of the account owner's) - fixed
the same way, plus the same provenance stamping and shared-activity alerts.
While in there, `PUT /accounts/{id}/recurring/{id}` was also still a
`501 not implemented` stub from earlier in the project - implemented
properly (partial-update semantics, sticky externalBankAccountId/
grossAmount fields, no silent nextDueDate recomputation on a frequency
change - the caller must set that explicitly if they're changing the
schedule).

**Budget-threshold and low-balance alert preferences**: budget-threshold
alerts (the existing 80%/100%/repeat-over-100% emails) can now actually be
turned off (`budgetAlertsEnabled` in `/preferences` - previously always-on
with no opt-out). Low-balance alerts are a genuinely new feature, not
previously built at all: `finance_common.low_balance_alerts` checks every
balance-changing operation in `transactions-fn` (add expense, add income,
edit, delete, transfer) and `recurring-processor-fn` against a per-user
threshold (`lowBalanceThresholdAmount`), off by default and a no-op until
a threshold is actually set. Not yet wired into `reconcile-fn`,
`csv_import_export`, or `payday-fn`'s submit path - left open, not ruled
out.

## Recurring-Expense Sharing

The Sharing table already fully modeled per-data-type sharing at the data
layer (`dataPermissions.recurring`, set at invite time via
`sharing-fn`'s `POST /sharing`), but two things stood between that and it
actually working:

1. **`recurring-fn` never checked it** - it gated everything on the flat
   base `accountPermission` instead, which is a different, independent
   knob by design (a user could have view-only access to an account's
   transactions while having full edit access to its recurring templates,
   or the reverse). Fixed: `resolve_account_access` now also returns the
   raw `dataPermissions` map, and `recurring-fn` gates on
   `dataPermissions.recurring` specifically for non-owners, defaulting to
   `not_shared` (404) if that extension was never explicitly granted.
2. **There was no `GET /sharing` at all** - no way to list existing
   shares from either side (owner or invited user), so even with correct
   enforcement, nobody had a way to see or manage what they'd shared or
   been offered. Added, returning `{asOwner: [...], asInvited: [...]}`.

Wiring the frontend side of this surfaced a real bug: `ManageRecurring.jsx`
and `Settings.jsx` both fetched every account's recurring items with
`Promise.all`, which rejects entirely if ANY single request fails - so a
shared account with no recurring access (a legitimate, expected 404 now)
would have silently broken the recurring list for every OTHER account too.
Fixed with per-account `.catch(() => [])`.

## Custom Cognito Attribute: hasCompletedSetup

`lib/constructs/auth.ts` now defines a custom User Pool attribute,
`hasCompletedSetup`, used by the frontend to send a brand-new user to the
Getting Setup wizard automatically on their first sign-in, then never
again once they've been through it (or explicitly skipped it).

**Important if either environment has already been deployed**: Cognito
does not allow adding a new custom attribute to an existing User Pool -
only at creation time. If `FinanceApp-Beta` or `FinanceApp-Prod` have
already been through a real `cdk deploy`, this change will force CloudFormation
to replace the User Pool entirely, which means every existing user account
in that pool is gone and everyone has to sign up again. There's no
in-place migration path around this - it's a hard Cognito limitation, not
a mistake in this code. If real users already exist, this needs a
deliberate migration plan (e.g. export/re-invite users) rather than a
routine `cdk deploy`, and is worth confirming before running it.

## Beta vs. Prod

Same CDK code deployed twice via `bin/finance-app.ts`, parameterized by
`config/environments.ts`. Every resource is name-prefixed
(`finance-app-beta-*` / `finance-app-prod-*`) and tagged with
`Project`, `Environment`, and `ManagedBy` for cost tracking and console
filtering. Prod retains data on stack deletion (`RemovalPolicy.RETAIN`);
beta does not.

## Deploying

See `DEPLOY.md` for the full step-by-step beta deployment checklist -
bootstrap, deploy, verify, configure the frontend, and a first real
end-to-end pass covering everything built this project (MFA, sharing,
alerts, the recurring processor, account deletion).

## Commands

```bash
npm install
npx cdk bootstrap        # first time only, per AWS account/region
npm run diff:beta        # preview changes before deploying
npm run deploy:beta
npm run diff:prod
npm run deploy:prod
```

## What's implemented vs. stubbed

The infrastructure (tables, indexes, Cognito, API routes, IAM roles,
CloudFront routing) is fully wired and synthesizes cleanly. The Lambda
business logic reflects everything we designed — split-purchase entry,
budget threshold rules, cross-account category aggregation, CSV template
format — but several handlers have explicit `TODO`s where full logic still
needs to be written:

- Transaction edit/delete (with audit log writes)
- Account-to-account transfers
- Full projections calculation (income normalization, one-time credit handling)
- Budget start-date snapping to next paycheck (needs an income-schedule lookup)
- CSV import → transaction write (parsing/validation is done; the write-through isn't)
- Sharing invite accept/decline (invite lookup by composite key)
- Recurring transaction processing (no handler yet — likely a scheduled Lambda)

## Not yet in this scaffold

- Frontend app itself (React) — this only builds infrastructure to host it
- Getting Setup wizard / Walkthrough tour (frontend-only)
- Custom domain + ACM certificate wiring (commented placeholders in `frontend.ts`/`environments.ts`)
- SES sender identity verification (required before `ses:SendEmail` will actually deliver)
