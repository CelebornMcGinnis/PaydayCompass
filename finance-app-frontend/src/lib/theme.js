// Every value here is a CSS custom property reference, not a literal
// color - see index.css for the actual light/dark values, toggled via
// the data-theme attribute on <html> (see ThemeContext.jsx). This means
// every existing page using colors.x directly in a style={{}} prop keeps
// working completely unchanged - it was always just consuming a string,
// and the string still resolves to a real color, just a dynamic one now.
export const colors = {
  bg: "var(--color-bg)",
  surface: "var(--color-surface)",
  surfaceRaised: "var(--color-surface-raised)",
  border: "var(--color-border)",
  borderStrong: "var(--color-border-strong)",
  text: "var(--color-text)",
  textMuted: "var(--color-text-muted)",
  accent: "var(--color-accent)",
  accentLight: "var(--color-accent-light)",
  positive: "var(--color-positive)",
  alert: "var(--color-alert)",
  warning: "var(--color-warning)",
  bgTranslucent: "var(--color-bg-translucent)",
};

export const fontDisplay = "'Fraunces', serif";
export const fontBody = "'Inter', sans-serif";
export const fontMono = "'IBM Plex Mono', monospace";

export function formatMoney(n) {
  const negative = n < 0;
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? "\u2212" : ""}$${abs}`;
}

// Whether any of the given numeric keys, across any row of chart data,
// has actually dipped below zero - used to decide whether a chart needs
// its red zero-line at all, rather than showing one unconditionally on
// every chart even when the underlying numbers never go negative.
export function chartCrossesZero(data, keys) {
  if (!data || data.length === 0) return false;
  return data.some((row) => keys.some((k) => typeof row[k] === "number" && row[k] < 0));
}

// Formats a dollar chart-axis tick with adaptive precision - plain
// dollars under $1000 ("$412"), "k" with trailing ".0" stripped above
// that ("$1.5k", "$2k"). Originally local to AccountDetail.jsx's Balance
// Trend chart (to fix duplicate "$0k" labels a naive fixed-precision
// formatter produced for small ranges); Category Trends hit the exact
// same issue with its own naive formatter, so this moved here to share.
export function formatChartTick(v) {
  const negative = v < 0;
  const abs = Math.abs(v);
  if (abs < 1000) return `${negative ? "−" : ""}$${Math.round(abs)}`;
  const thousands = (abs / 1000).toFixed(1).replace(/\.0$/, "");
  return `${negative ? "−" : ""}$${thousands}k`;
}

// Mirrors finance_common.budget_frequency.MONTHLY_EQUIVALENT_FACTOR - a
// budget's `amount` is a cap for one period of its `frequency`, and
// charts that bucket spending by calendar month (Category Trends) need
// that normalized onto the same monthly basis to overlay it.
const BUDGET_MONTHLY_EQUIVALENT_FACTOR = { monthly: 1, weekly: 4.348, biweekly: 2.174 };
export function budgetMonthlyEquivalent(amount, frequency) {
  return amount * (BUDGET_MONTHLY_EQUIVALENT_FACTOR[frequency] ?? 1);
}
