"""
finance_common - shared logic used by multiple Lambda functions in this
project, packaged as a Lambda Layer instead of being copy-pasted into each
function's own code asset.

Before this existed, three near-identical implementations of the recurring-
schedule math lived in budgets/, payday/, and recurring_processor/, and
three near-identical implementations of the budget-threshold-notification
check lived in csv_import_export/, recurring_processor/, and transactions/
- a bug fix or behavior change to either had to be made by hand in three
places with nothing enforcing they stayed in sync. This package is the fix:
one implementation, imported everywhere it's needed.

Modules:
  schedule.py        - recurring-transaction date math (pure functions, no AWS calls)
  cognito_lookup.py   - email <-> Cognito sub lookups (needs USER_POOL_ID env var)
  budget_notify.py    - active-budget lookup, cross-account category spend,
                        and the "invoke notifications-fn" trigger (needs
                        BUDGETS_TABLE, TRANSACTIONS_TABLE, NOTIFICATIONS_FN_NAME)
"""
