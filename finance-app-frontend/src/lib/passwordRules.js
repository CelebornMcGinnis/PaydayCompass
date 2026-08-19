export const PASSWORD_RULES = [
  { test: (p) => p.length >= 10, label: "At least 10 characters" },
  { test: (p) => /[a-z]/.test(p), label: "A lowercase letter" },
  { test: (p) => /[A-Z]/.test(p), label: "An uppercase letter" },
  { test: (p) => /[0-9]/.test(p), label: "A number" },
  { test: (p) => /[^A-Za-z0-9\s]/.test(p), label: "A symbol" },
  { test: (p) => !/\s/.test(p), label: "No spaces" },
];

// Native <input type="email"> validation deliberately allows a domain
// with no dot at all (e.g. "user@localhost" is spec-valid, for intranet
// use) - too permissive for a real signup. Same pattern as the backend's
// own EMAIL_RE in lambda/contact/index.py, for consistent semantics.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
