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
