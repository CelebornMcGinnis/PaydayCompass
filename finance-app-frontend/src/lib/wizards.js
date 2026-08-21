/**
 * Single source of truth for every page's teaching wizard - open this
 * file to review or update any wizard's content rather than hunting
 * through the page it belongs to.
 *
 * Each entry is keyed by route and has a `basic` tier and, optionally,
 * an `advanced` tier (omit `advanced` for a page with only enough
 * content for one tier - PageHeader/WizardMenu render a single card in
 * that case, not a special layout). Each tier is:
 *   { minutes, covers: [short label, ...], steps: [{ targetId?, title, body }] }
 *
 * A step with a `targetId` gets spotlit - `targetId` must match a
 * `data-wizard-target="..."` attribute on a real element in that page's
 * JSX. A step with no `targetId` renders as a plain centered card
 * (Walkthrough.jsx already does this for any step whose target can't be
 * found - see its `measure()`), which is exactly the right fallback for
 * a conceptual explanation that doesn't point at one specific control.
 *
 * Pages that are genuinely unusable until something else exists first
 * (e.g. Payday needs at least one income source) pass a `wizardBlocked`
 * prop to <PageHeader> instead of adding anything here - see Payday.jsx
 * and PageHeader.jsx for that wiring. This file only holds the tour
 * content itself.
 */

export const WIZARDS = {
  "/payday": {
    basic: {
      minutes: 4,
      covers: [
        "Viewing a different payday",
        "Your income and recurring expenses",
        "Budgeted & planned set-asides",
        "Submitting",
      ],
      steps: [
        {
          targetId: "wizard-payday-selector",
          title: "Which payday you're looking at",
          body: "This defaults to your very next payday. Use “Change” to look back at one you already submitted, or jump to any other date.",
        },
        {
          targetId: "wizard-payday-income",
          title: "Your income",
          body: "Every income source due before this payday, pulled from your recurring income templates - tap an amount to adjust it for just this one occurrence if it'll differ from the usual.",
        },
        {
          targetId: "wizard-payday-expenses",
          title: "Recurring expenses",
          body: "Everything due before your next paycheck. Adjusting an amount here only changes this one occurrence - the template's regular estimate is untouched for next time.",
        },
        {
          targetId: "wizard-payday-budgeted",
          title: "Budgeted & planned set-asides",
          body: "“Will transfer” means that category or planned expense has a destination account set - submitting will actually move real money there. “Reminder only” ones just show you the number without moving anything.",
        },
        {
          targetId: "wizard-payday-submit",
          title: "Submitting",
          body: "This is the one real, money-moving step - everything above is just preview and adjustment until you tap this. Once submitted, this exact payday can't be submitted again without reversing it first.",
        },
        {
          title: "After you submit",
          body: "Every transaction posts immediately, recurring schedules advance to their next occurrence, and any account-to-account transfers happen for real - not just recorded, actually moved. If something's wrong afterward, you can undo the whole submission from that payday's history entry.",
        },
      ],
    },
    advanced: {
      minutes: 5,
      covers: [
        "Unpredicted amounts",
        "Why some items transfer and others don't",
        "Grouping by real-world bank account",
        "Letting someone know",
        "Reversing a submission",
      ],
      steps: [
        {
          targetId: "wizard-payday-unpredicted",
          title: "Unpredicted amounts",
          body: "For a one-off cost that isn't on your recurring list at all - it posts as a normal transaction alongside everything else when you submit, without you needing to build a whole recurring template just for something that happens once.",
        },
        {
          targetId: "wizard-payday-budgeted",
          title: "Why only some items actually transfer",
          body: "Why: a budget or planned expense with no destination account is a pure spending ceiling - useful on its own, nothing to set up. Add a destination account (in Budgets or Planned Expenses) once you're ready to have Payday actually set that money aside for you, instead of moving it by hand.",
        },
        {
          targetId: "wizard-payday-bybank",
          title: "Grouped by real-world bank account",
          body: "Why: if you're also moving money between your actual bank accounts by hand to match this app, this total tells you exactly how much to move where - grouped by which real-world account (if any) each in-app account is set up to draft from.",
        },
        {
          targetId: "wizard-payday-notify",
          title: "Letting someone know",
          body: "Sends a heads-up email plus an in-app notification. This needs a mutual fund-movement agreement first (set that up from the Notifications page) - a deliberate two-way opt-in, so nobody gets visibility into your money moving without agreeing to it first.",
        },
        {
          title: "Reversing a past submission",
          body: "Every payday you submit is fully reversible from its entry in payday history - deletes every transaction it created and puts every balance and recurring schedule back exactly where it was before. Useful if you catch a mistake after the fact rather than needing to undo it by hand.",
        },
      ],
    },
  },

  "/budgets": {
    basic: {
      minutes: 3,
      covers: ["Creating a budget", "Reading a progress card", "What triggers an alert"],
      steps: [
        {
          targetId: "wizard-budgets-add",
          title: "Creating a budget",
          body: "Pick a category, an amount, and how often it applies. A budget tracks spending in that category across every account you own, not just one - so it stays accurate even if you use more than one card or account for the same kind of spending.",
        },
        {
          targetId: "wizard-budgets-list",
          title: "Reading a progress card",
          body: "Real spend against your amount for the current period. The bar turns amber near 80% and red once you're over - the same thresholds that trigger an email alert, if those are turned on.",
        },
        {
          targetId: "wizard-budgets-summary",
          title: "This period, at a glance",
          body: "A running total across every budget you have, plus a projected leftover for the month - already factoring in whatever you've committed to planned expenses too.",
        },
        {
          title: "Budget alerts",
          body: "With alerts on (Settings), you get an email at 80% spent, when you first go over, and again on every new purchase while you're still over - so a budget you're not actively watching still gets your attention when it matters.",
        },
      ],
    },
    advanced: {
      minutes: 3,
      covers: ["Auto-transfer on payday", "Frequency & proration", "Divisions", "Backdating a budget"],
      steps: [
        {
          targetId: "wizard-budgets-add",
          title: "Moving money automatically",
          body: "Why: on its own, a budget is just a spending ceiling you watch. Set a destination account here (and a division, if you use them) and submitting a payday will actually transfer the set-aside amount there for real, instead of only reminding you to do it yourself.",
        },
        {
          title: "Frequency and proration",
          body: "Set a monthly, biweekly, or weekly amount. On the Payday page, whatever you set here automatically scales to match that specific pay period - a $500/month budget shows as roughly $230 on a biweekly payday, not the full $500.",
        },
        {
          title: "What's a division?",
          body: "Why: most finance apps only track a whole account's balance. A division lets you set aside money for one purpose - a vacation fund, an emergency cushion - inside a single real bank account, without opening a separate account for every goal. A budget's auto-transfer can target one specific division instead of the account's general balance.",
        },
        {
          title: "Starting from a past date",
          body: "Backdating a new budget's start date pulls in your real spending history from that date forward instead of starting tracking fresh today - handy if you're setting this up mid-month. Your account balance is never touched by this either way, only the budget's own tracked total.",
        },
      ],
    },
  },

  "/transfer": {
    basic: {
      minutes: 2,
      covers: ["Choosing accounts", "Sending into a division", "What happens to your balances"],
      steps: [
        {
          targetId: "wizard-transfer-from-to",
          title: "From and to",
          body: "Pick any two accounts you own (or have edit access to, if shared). This posts a real, linked pair of transactions - a debit on one side, a credit on the other - not just a number that quietly changes.",
        },
        {
          targetId: "wizard-transfer-division",
          title: "Sending into a specific division",
          body: "Why: if the destination account has divisions - sub-tracked goals within one real account, like a vacation fund - you can send money straight into one instead of the account's general balance, without a separate transfer step later.",
        },
        {
          targetId: "wizard-transfer-submit",
          title: "Insufficient funds",
          body: "A transfer that would take an account (or division) below zero is blocked before it posts - nothing partially happens, and your balances stay exactly as they were until you fix the amount.",
        },
      ],
    },
  },

  "/upcoming-recurring": {
    basic: {
      minutes: 3,
      covers: ["Choosing a range", "Reading the total", "Editing one occurrence", "Mark as paid / Skip"],
      steps: [
        {
          targetId: "wizard-upcoming-range",
          title: "Choosing a range",
          body: "Shows every occurrence due in the next 30, 60, or 90 days - not just each recurring item's next due date, every one between now and the end of the range.",
        },
        {
          targetId: "wizard-upcoming-total",
          title: "Total due",
          body: "Adds up every occurrence shown in the current range, across all your recurring expenses - a quick answer to \"how much is coming up.\"",
        },
        {
          targetId: "wizard-upcoming-timeline",
          title: "Editing one occurrence",
          body: "Tap an item to adjust just that occurrence's amount or date. The recurring template's normal schedule and estimate are untouched - this only changes the one you tapped.",
        },
        {
          targetId: "wizard-upcoming-markpaid",
          title: "Mark as paid or skip",
          body: "Why: for a template's very next due date only, you can mark it paid right here (posts the transaction and advances the schedule) or skip it (advances the schedule, nothing posted) - without a trip to Payday or the Recurring page.",
        },
      ],
    },
    advanced: {
      minutes: 2,
      covers: ["Date overrides", "Why only the next occurrence gets these buttons"],
      steps: [
        {
          title: "Date overrides",
          body: "Adjust an occurrence's date and it's grouped and shown under the new date going forward, marked \"date adjusted\" - every other occurrence still follows the template's regular pattern untouched.",
        },
        {
          title: "Why only the next occurrence",
          body: "Mark as paid/skip only apply to a template's true next due date. Once you act on it (or it posts naturally on schedule), the occurrence after that becomes the new \"next\" and gets the same options - keeping the schedule from ever getting out of order.",
        },
      ],
    },
  },

  "/csv": {
    basic: {
      minutes: 2,
      covers: ["Transactions", "Recurring items", "What happens if a row is invalid"],
      steps: [
        {
          targetId: "wizard-csv-transactions",
          title: "Transactions",
          body: "Download the template - it's pre-filled with your real account names in the instructions, so you know exactly what to type. Fill it in, upload it back, and each row becomes one transaction.",
        },
        {
          targetId: "wizard-csv-recurring",
          title: "Recurring items",
          body: "Same idea, for bills and income that repeat. Doesn't cover every frequency though - custom intervals and nth-weekday-of-month schedules still need the full Recurring page.",
        },
        {
          title: "If a row is invalid",
          body: "Every row is validated together before anything is imported - if even one row has a problem, nothing gets added until you fix it and re-upload. No partial imports to clean up afterward.",
        },
      ],
    },
  },

  "/add-expense": {
    basic: {
      minutes: 4,
      covers: ["Expense or deposit", "Choosing the account", "Amount and category", "Splitting into categories", "Submit vs. Save & add another"],
      steps: [
        {
          targetId: "wizard-addexpense-direction",
          title: "Expense or deposit",
          body: "Switches what you're logging - an expense debits the account, a deposit credits it. The default category and total-amount label adjust to match.",
        },
        {
          targetId: "wizard-addexpense-account",
          title: "Choose the account",
          body: "Whichever account this actually happened on - the transaction posts directly against its balance.",
        },
        {
          targetId: "wizard-addexpense-amount",
          title: "Amount and category",
          body: "The category groups this transaction for budgets, category trends, and projections - pick the closest match, or add a new one on the fly.",
        },
        {
          targetId: "wizard-addexpense-splits",
          title: "Splitting into categories",
          body: "Optional - if one purchase covers more than one kind of spending (a store run that's part groceries, part household), split the total across categories instead of picking just one.",
        },
        {
          targetId: "wizard-addexpense-submit",
          title: "Submit vs. Save & add another",
          body: "\"Save & add another\" keeps the account, expense/deposit choice, and date, then clears everything else - built for entering several similar items in a row without re-picking the account each time.",
        },
      ],
    },
    advanced: {
      minutes: 2,
      covers: ["Divisions", "Splits must exactly match the total"],
      steps: [
        {
          targetId: "wizard-addexpense-division",
          title: "Sending it to a division",
          body: "Why: same idea as Budgets and Transfer funds - a division lets this expense count against one specific sub-tracked goal within the account instead of its general balance, without a separate transfer afterward.",
        },
        {
          title: "Splits must exactly match the total",
          body: "Whatever's left over after your splits is automatically saved under the main category and description at the top - allocate too much and saving is blocked until the numbers match.",
        },
      ],
    },
  },

  "/trends": {
    basic: {
      minutes: 3,
      covers: ["Choosing a range", "Reading a chart", "Your own layout"],
      steps: [
        {
          targetId: "wizard-trends-range",
          title: "Choosing a range",
          body: "From 3 months back to 2 years. A wider range smooths out month-to-month noise; a narrower one shows recent changes more clearly.",
        },
        {
          targetId: "wizard-trends-chart",
          title: "Reading a chart",
          body: "Spending across every account, month by month. A dashed line in the same color marks that category's budget (normalized to a monthly figure) when one exists, so you can see spend against it at a glance.",
        },
        {
          targetId: "wizard-trends-add",
          title: "Your own layout",
          body: "Starts with your top 5 categories by spend, one chart each - add your own or remove any of them. Once you customize, your layout is saved and stays consistent everywhere you sign in.",
        },
      ],
    },
    advanced: {
      minutes: 2,
      covers: ["Combining categories onto one chart", "The dashed budget line"],
      steps: [
        {
          targetId: "wizard-trends-add",
          title: "Combining categories onto one chart",
          body: "Why: pick more than one category when adding a chart and they share the same axis - useful for comparing two categories directly, like watching Dining trend up while Groceries trends down.",
        },
        {
          title: "The dashed budget line",
          body: "Only appears for a category that actually has a budget set. It's normalized to a monthly figure regardless of that budget's real frequency, so a weekly or biweekly budget still compares fairly against the monthly-bucketed spend line.",
        },
      ],
    },
  },

  "/recurring": {
    basic: {
      minutes: 3,
      covers: ["Creating a recurring item", "Income vs. expense", "Frequency options"],
      steps: [
        {
          targetId: "wizard-recurring-add",
          title: "Creating a recurring item",
          body: "One button for both income and expenses - choose which on the next screen. Once due, it posts automatically on schedule without you touching anything.",
        },
        {
          targetId: "wizard-recurring-income",
          title: "Income",
          body: "Every recurring paycheck or deposit you've set up - tap one to edit it.",
        },
        {
          targetId: "wizard-recurring-expenses",
          title: "Expenses",
          body: "Every recurring bill - same idea, tap to edit.",
        },
        {
          title: "Frequency options",
          body: "Weekly, biweekly, monthly, twice-monthly on fixed days, annually, a specific weekday each month (like \"the 2nd Tuesday\"), or a fully custom interval - pick whichever actually matches how it repeats.",
        },
      ],
    },
    advanced: {
      minutes: 3,
      covers: ["Custom and nth-weekday schedules", "External bank account auto-lock", "Backfilling trend history", "Adding an overdue bill"],
      steps: [
        {
          title: "Custom and nth-weekday schedules",
          body: "Not every real bill runs on a calendar-month cycle - \"every 10 days\" or \"the last Friday of the month\" are both real patterns. These two frequency types cover cases the common options can't.",
        },
        {
          title: "External bank account auto-lock",
          body: "Why: if the account this item belongs to is already connected to a real-world bank account (External bank accounts, under Settings), this field locks to match it automatically - so the two can never quietly disagree about which real account a bill drafts from.",
        },
        {
          title: "Backfilling trend history",
          body: "Why: creating a new recurring item today doesn't retroactively give Category Trends any history for it. Backfilling manufactures that past record (without touching your real balance) so a trend chart doesn't look empty just because you're setting this up today instead of when it actually started.",
        },
        {
          title: "Adding a bill that's already overdue",
          body: "Pick a due date that's already passed and this normally just starts tracking from the next real occurrence after today. Check \"still unpaid and overdue\" if that specific past occurrence genuinely hasn't been paid yet, so it isn't silently skipped.",
        },
      ],
    },
  },

  "/accounts/:accountId": {
    basic: {
      minutes: 4,
      covers: ["Your balance", "Adding an expense or deposit", "The transaction list", "Divisions"],
      steps: [
        {
          targetId: "wizard-accountdetail-balance",
          title: "Your balance",
          body: "The account's real balance, plus how much is \"unassigned\" if you use divisions, and what's actually available once upcoming payments are counted in.",
        },
        {
          targetId: "wizard-accountdetail-addexpense",
          title: "Add an expense or deposit",
          body: "Log something directly against this account. To move money to another account you own instead, use Transfer funds.",
        },
        {
          targetId: "wizard-accountdetail-transactions",
          title: "The transaction list",
          body: "Every transaction on this account, newest first. Tap one you added manually (not recurring, not a transfer) to edit its amount, category, or split.",
        },
        {
          targetId: "wizard-accountdetail-divisions",
          title: "Divisions",
          body: "Why: track that part of this account's balance is set aside for one thing - a vacation fund, an emergency cushion - without opening a separate real bank account. A recurring item tagged with a division updates both the account's and the division's own balance when it posts.",
        },
      ],
    },
    advanced: {
      minutes: 3,
      covers: ["Connecting a real bank account", "How the balance trend is built", "Spending by category", "Editing a split"],
      steps: [
        {
          targetId: "wizard-accountdetail-external",
          title: "Connecting a real-world bank account",
          body: "Optional label for which real bank account this one is set up to draft from - used to group totals on the Payday page. Not linked to real banking in any way, just a name you choose.",
        },
        {
          targetId: "wizard-accountdetail-trend",
          title: "How the balance trend is built",
          body: "Reconstructed by walking backward from today's real balance through your actual transaction history - not a separately stored log, so it's always consistent with what's in the list below.",
        },
        {
          targetId: "wizard-accountdetail-category",
          title: "Spending by category",
          body: "This calendar month's debits on this account only, grouped by category. Transfers between your own accounts never count as spending.",
        },
        {
          title: "Editing a split",
          body: "Tapping an editable transaction opens the same split UI as Add Expense - adjust categories or amounts, or add another split. The pieces always have to add back up to the original total.",
        },
      ],
    },
  },

  "/add-multiple": {
    basic: {
      minutes: 3,
      covers: ["One-time vs recurring rows", "Filling in the basics", "Category, division, and details", "Submitting the batch"],
      steps: [
        {
          targetId: "wizard-massadd-row",
          title: "One row, one entry",
          body: "Each row is either a one-time transaction or, with Recurring checked, a new recurring bill or income template - mix as many of each as you want in a single batch.",
        },
        {
          targetId: "wizard-massadd-recurring",
          title: "Recurring",
          body: "Check this and the row becomes a new recurring template instead of a one-time transaction - the Amount and Date fields switch meaning to estimated amount and next due date.",
        },
        {
          targetId: "wizard-massadd-detail",
          title: "Category, division, and details",
          body: "Category and division work the same as a one-time transaction. Description is optional for one-time rows but required for recurring ones, matching the full Recurring form's own rule.",
        },
        {
          targetId: "wizard-massadd-submit",
          title: "Submitting",
          body: "Submits every ready row at once. Each row succeeds or fails independently - a mistake on one row doesn't block the rest, and only the failed ones stay on screen for you to fix and resubmit.",
        },
      ],
    },
    advanced: {
      minutes: 2,
      covers: ["Splitting a one-time row", "Frequency limits for recurring rows", "External bank account for recurring expenses"],
      steps: [
        {
          title: "Splitting one row across categories",
          body: "Only for one-time rows - recurring templates have no split concept in the data model. Split amounts (plus whatever's left over under the row's main category) must add up to the row's total amount.",
        },
        {
          title: "Frequency limits",
          body: "Recurring rows offer weekly through annual, but not custom intervals or an \"nth weekday of the month\" schedule - those still need the full Recurring page.",
        },
        {
          title: "External bank account, automatically",
          body: "Why: a recurring expense row doesn't show an external-bank-account field here - if the account you picked already has one connected, the new template inherits it automatically, same as the full Recurring form's own auto-lock behavior.",
        },
      ],
    },
  },

  "/scenarios": {
    basic: {
      minutes: 4,
      covers: ["Building a scenario", "Preview vs. Save", "Saved scenarios stay live", "Comparing scenarios"],
      steps: [
        {
          targetId: "wizard-scenarios-build",
          title: "Building a scenario",
          body: "Adjust an existing income or expense, add something hypothetical, or drop in a one-time cost - mix and match as many as you want in one scenario.",
        },
        {
          targetId: "wizard-scenarios-preview",
          title: "Preview vs. Save",
          body: "Preview calculates the impact without saving anything - a quick gut-check. Save keeps it under a name so you can compare it against other scenarios later.",
        },
        {
          targetId: "wizard-scenarios-saved",
          title: "Saved scenarios",
          body: "Why: a scenario is never a frozen snapshot - it recalculates against your real, current income and budgets every time you view it, even one saved months ago.",
        },
        {
          targetId: "wizard-scenarios-compare",
          title: "Comparing scenarios",
          body: "Select up to 6 saved scenarios and compare them side by side against today's real numbers.",
        },
      ],
    },
    advanced: {
      minutes: 3,
      covers: ["Reading the trend chart", "The per-item breakdown", "Why a one-time expense snaps to a payday"],
      steps: [
        {
          title: "Reading the trend chart",
          body: "Each line tracks a scenario's cumulative leftover across your next several paychecks, next to a dashed baseline for your real, current numbers - a fast way to see whether a change compounds well or poorly over time.",
        },
        {
          title: "The per-item breakdown",
          body: "Under each scenario in the comparison list, every adjustment's own dollar impact is broken out - so if a scenario surprises you, you can see exactly which piece is driving it.",
        },
        {
          targetId: "wizard-scenarios-onetime",
          title: "Why a one-time expense snaps to a payday",
          body: "Why: unlike a monthly bill, a one-time cost doesn't have its own schedule - it's attributed to whichever real payday comes right before its date, since that's realistically when you'd need the money set aside for it.",
        },
      ],
    },
  },

  "/sharing": {
    basic: {
      minutes: 3,
      covers: ["Sharing an account", "Choosing what to also share", "Accepting or declining an invite"],
      steps: [
        {
          targetId: "wizard-sharing-invite",
          title: "Sharing an account",
          body: "Pick one or more accounts and an email - one invite covers every account you select, but the person only gets exactly the access you choose for each.",
        },
        {
          targetId: "wizard-sharing-data-types",
          title: "Choosing what to also share",
          body: "Why: account access (view or edit) is separate from these - sharing an account view-only doesn't hand over your recurring bills, budgets, or planned expenses unless you turn each on here too. Nothing is shared by accident.",
        },
        {
          targetId: "wizard-sharing-pending",
          title: "Accepting or declining",
          body: "Invites waiting on you show up here first, before anything else on this page - accept to start seeing that account, decline to turn it down. Either way, the sender finds out.",
        },
      ],
    },
    advanced: {
      minutes: 3,
      covers: ["Why account access and data types are separate", "The 6 independent data grants", "Changing permissions later", "Revoking access"],
      steps: [
        {
          title: "Why two separate permission systems",
          body: "Most finance apps only have one level of sharing - see everything or nothing. Splitting account access from data-type grants means someone can see a shared account's balance and transactions without also seeing your recurring bills or being able to touch budgets - genuinely separate trust decisions, not bundled together.",
        },
        {
          title: "What each data grant actually covers",
          body: "Recurring bills & income, income schedule, budgets, projections, and planned expenses are each independently viewable; modifying or deleting transactions is its own toggle, off by default, since it's a bigger step than just adding entries - letting someone rewrite or erase what's already recorded.",
        },
        {
          targetId: "wizard-sharing-mine",
          title: "Changing permissions later",
          body: "Expand anyone in this list, then expand one of their accounts, to adjust account access or any data grant after the fact - nothing here is locked in at invite time.",
        },
        {
          title: "Revoking access",
          body: "Removes every account and data grant you'd given that person in one action - there's no partial revoke; share it again from scratch if you want to give them something back.",
        },
      ],
    },
  },

  "/external-bank-accounts": {
    basic: {
      minutes: 2,
      covers: ["Adding a label", "Connecting it to an account", "Renaming or removing"],
      steps: [
        {
          targetId: "wizard-extbank-add",
          title: "Adding a label",
          body: "Why: these aren't linked to real banking in any way - just a name you choose, so a recurring bill can note which real-world account it actually drafts from.",
        },
        {
          targetId: "wizard-extbank-list",
          title: "Connecting it to an account",
          body: "Link a label to one of your in-app accounts, one-to-one - a bill on that account can then show its real-world source at a glance.",
        },
        {
          title: "One connection at a time",
          body: "Each label can only be connected to one account, and vice versa - connecting a label already in use elsewhere disconnects it there first. Keeps \"which real account is this\" unambiguous.",
        },
        {
          title: "Renaming or removing",
          body: "Rename anytime. Deleting a label just clears it from anything it was connected to - it never touches real transaction history or the in-app account itself.",
        },
      ],
    },
  },

  "/projected-vs-actual": {
    basic: {
      minutes: 2,
      covers: ["Projected vs actual", "Choosing a range"],
      steps: [
        {
          targetId: "wizard-pva-stats",
          title: "Projected vs actual",
          body: "Projected is your recurring income minus active budgets and planned-expense contributions, prorated to the period. Actual is your real net money movement for that same period - side by side, no guessing whether you're on track.",
        },
        {
          targetId: "wizard-pva-range",
          title: "Choosing a range",
          body: "Look back over 6, 12, or 26 real pay periods - not calendar months, so the comparison always lines up with when you actually got paid.",
        },
      ],
    },
  },

  "/notifications": {
    basic: {
      minutes: 2,
      covers: ["Sending a heads-up", "Why agreements are separate", "Waiting on you"],
      steps: [
        {
          targetId: "wizard-notify-send",
          title: "Sending a heads-up",
          body: "Lets someone you trust know money's moving - they get an email plus a card right here the next time they open this page.",
        },
        {
          targetId: "wizard-notify-agreements",
          title: "Why agreements are separate",
          body: "Why: sending an actual fund-movement alert needs a standing, mutual agreement first - propose someone, they accept, and only then can either of you notify the other. A deliberate consent gate, not a technical hurdle, since this is about someone else's financial visibility, not just yours.",
        },
        {
          title: "Waiting on you",
          body: "If someone's proposed an agreement with you, it shows here to accept or decline - notifications only start flowing once both sides have said yes.",
        },
      ],
    },
  },

  "/planned-expenses": {
    basic: {
      minutes: 3,
      covers: ["Creating a planned expense", "Reading progress", "Marking complete"],
      steps: [
        {
          targetId: "wizard-plannedexpenses-add",
          title: "Creating a planned expense",
          body: "Name it, set a target amount and date, and you get a suggested contribution - how much to set aside each period so you hit the target on time.",
        },
        {
          targetId: "wizard-plannedexpenses-summary",
          title: "Suggested monthly total",
          body: "Every active item's suggested contribution, normalized to a monthly figure and added together - roughly what to set aside each month across everything you're planning for.",
        },
        {
          targetId: "wizard-plannedexpenses-progress",
          title: "Reading progress",
          body: "How much you've saved against the target, plus the suggested contribution for this item specifically - shown per period (weekly, biweekly, or monthly, whichever you picked).",
        },
        {
          targetId: "wizard-plannedexpenses-complete",
          title: "Marking complete",
          body: "Why: an item also completes itself automatically the moment it's fully funded - by a real transfer from Payday or by editing the saved amount yourself - so this reflects reality without you needing to remember to do it.",
        },
      ],
    },
    advanced: {
      minutes: 2,
      covers: ["Annual items and reviving", "Turning this into a real transfer"],
      steps: [
        {
          title: "Annual items and reviving",
          body: "A completed one-time item can be revived if you're not actually done saving - it goes back to active with its progress intact. Annual items (a yearly premium, a birthday) skip that option, since they'll simply come due again on their own next cycle.",
        },
        {
          targetId: "wizard-plannedexpenses-account",
          title: "Turning this into a real transfer",
          body: "Why: on its own, this page only tracks progress. Set a destination account here (and a division, if you use them) and Payday will actually transfer your contribution there when you submit - real money moving toward the goal, not just a number ticking up.",
        },
      ],
    },
  },

  "/settings": {
    basic: {
      minutes: 3,
      covers: ["Notification toggles", "Two-factor authentication", "Change email or password"],
      steps: [
        {
          targetId: "wizard-settings-notifications",
          title: "Notification toggles",
          body: "Budget alerts, low-balance alerts, and shared-account activity alerts - each independent. Budget alerts are on by default; the other two are off until you turn them on.",
        },
        {
          targetId: "wizard-settings-mfa",
          title: "Two-factor authentication",
          body: "Adds a second step at sign-in using an authenticator app, on top of your password - optional, but worth turning on for anything tracking real money.",
        },
        {
          targetId: "wizard-settings-account",
          title: "Change email or password",
          body: "Changing your email sends a confirmation code to the new address - it isn't active until you enter that code. Changing your password needs your current one first.",
        },
      ],
    },
    advanced: {
      minutes: 2,
      covers: ["Setting a low-balance threshold", "Deleting your account"],
      steps: [
        {
          targetId: "wizard-settings-threshold",
          title: "Setting a low-balance threshold",
          body: "Why: the low-balance toggle alone does nothing - it needs this dollar amount too. One threshold applies across every account you own, not per-account.",
        },
        {
          targetId: "wizard-settings-danger",
          title: "Deleting your account",
          body: "Permanently removes every account, transaction, budget, and setting. Typing DELETE to confirm is the only safeguard - there's no undo and no grace period after this.",
        },
      ],
    },
  },
};

/**
 * Resolves a wizard entry for the current route. Static routes match
 * directly; the one dynamic route (/accounts/:accountId) is handled
 * with a prefix check rather than a full path-matching library, since
 * it's the only such case in the app today.
 */
export function getWizardForPath(pathname) {
  if (WIZARDS[pathname]) return WIZARDS[pathname];
  if (pathname.startsWith("/accounts/") && WIZARDS["/accounts/:accountId"]) {
    return WIZARDS["/accounts/:accountId"];
  }
  return null;
}
