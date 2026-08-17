# PaydayCompass frontend (finance-app-frontend)

React (Vite) + Tailwind + react-router-dom. Talks to the companion
`finance-app-cdk` backend's API Gateway - see that repo's CLAUDE.md
for the API contract and backend conventions.

## Structure

- `src/pages/` - one file per route, most wrapped in `<RequireAuth>`
  in `App.jsx`. A few (`Landing`, `Login`, `SignUp`, `Contact`) are
  deliberately public and must not depend on anything that assumes a
  signed-in user (no `PageHeader`, no `useAuth`-dependent hooks).
- `src/components/PageHeader.jsx` - the shared header used by every
  authenticated page: logo, back button, menu. Supports an optional
  `onBack` override for a page that needs custom back behavior instead
  of the default `navigate(-1)` (e.g. resetting local form state).
  Desktop and mobile render genuinely different layouts (see
  `useIsDesktop`), including a scroll-triggered shrink on desktop.
- `src/lib/apiClient.js` - `request()` (authenticated, attaches the
  Cognito ID token) and `publicRequest()` (unauthenticated, currently
  only used by `/contact`). Both distinguish a raw network-level
  failure (`fetch` itself throwing - no connectivity, DNS, server
  unreachable) from a real HTTP error response, since a raw network
  failure throws a browser-specific `TypeError` with an unhelpful
  message ("Load failed" on Safari, "Failed to fetch" on Chrome) that
  should never be shown to the user directly.
- `src/lib/navLinks.js` - the in-app menu, grouped into sections. Home
  is not itself an entry here (it's DASHBOARD, the root route);
  everything else the signed-in user can navigate to lives in one of
  the sections.

## Established patterns - follow these rather than inventing new ones

- **Inline "add a new category" on a `<select>`**: a `+ Add new…`
  option that reveals a text input + confirm button, adding to a
  shared `categoryOptions` array. Used on Add Expense, Planned
  Expenses, and the mass-add page. Don't build a separate "manage
  categories" screen - this pattern is intentional and consistent.
- **Deep-linking into an edit form via a query param**
  (`?edit=<id>`, `?category=<name>`, `?new=income`): the target page
  reads the param in a `useEffect`, finds the matching item once its
  own data has loaded, opens it for editing, then replaces the URL to
  clear the param. The "once its own data has loaded" part matters - a
  naive version that checks before the list finishes fetching will
  misfire. See `ManageRecurring.jsx` and `Budgets.jsx` for the
  reference implementation.
- **Split click zones on a row that both navigates and has an inline
  edit control** (Payday's budgeted/planned rows): the label area
  navigates elsewhere (with a confirmation dialog, since it leaves the
  page), the pencil/amount area toggles inline editing in place. These
  need genuinely separate `onClick` handlers on separate elements, not
  one handler with conditional logic.
- **Native `<input type="date">` width**: has a real, separate-from-
  flexbox intrinsic-width quirk (especially mobile Safari) that can
  push past a constrained parent. Always pair `w-full` with explicit
  `maxWidth: "100%", boxSizing: "border-box"` in the style prop - the
  Tailwind class alone isn't sufficient insurance.

## Verification - do all of this before considering a change done

1. `npm run build` - and actually check the output hash/module count
   changed if you added a new file. An unchanged hash after adding a
   page usually means it's not actually wired into a route yet, not
   that the build is somehow smart enough to already include it.
2. No-undef check via a temporary local ESLint config (see below) -
   this has caught real bugs a passing build did not, most often a
   stray reference to a function/variable that got renamed or removed
   during a refactor but was missed in one usage site.
3. For anything computing money (aggregation, thresholds, "is this
   meaningfully different from that"), trace it with concrete
   JavaScript in a `node -e` one-liner using realistic numbers,
   including edge cases (a zero case, a floating-point-noise case, an
   undefined/not-yet-loaded case) - don't just trust it by reading it.

No-undef check (the project has no ESLint config checked in - use a
throwaway one, this is intentional so it never drifts from what's
actually being checked):

```bash
npm install --no-save eslint@8 eslint-plugin-react@7 --silent
cat > .eslintrc.temp.json << 'EOF'
{
  "parserOptions": {"ecmaVersion": 2021, "sourceType": "module", "ecmaFeatures": {"jsx": true}},
  "env": {"browser": true, "es2021": true},
  "plugins": ["react"],
  "rules": {"no-undef": "error", "react/jsx-no-undef": "error"},
  "settings": {"react": {"version": "detect"}}
}
EOF
npx eslint --no-eslintrc -c .eslintrc.temp.json src/path/to/TouchedFile.jsx
rm .eslintrc.temp.json
```

A `Definition for rule 'react-hooks/exhaustive-deps' was not found`
error is expected noise from this minimal config (the plugin isn't
installed) - it doesn't indicate a real problem to fix; every other
error does.

## Known gaps / deliberately deferred

- No code-splitting yet - the build warns about a >500kB chunk. Not
  addressed yet; would need `manualChunks` or dynamic imports.
- Stripe and Plaid are not integrated - see the backend CLAUDE.md and
  project history for the open questions blocking this.
