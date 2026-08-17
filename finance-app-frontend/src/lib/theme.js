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
