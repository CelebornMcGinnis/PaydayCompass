import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { divisionsApi } from "../lib/apiClient";
import { colors } from "../lib/theme";

// A division <select> with an inline "+ Add new division..." option -
// same "add new" pattern as categories elsewhere in the app, but this
// one round-trips through divisionsApi.create since divisions are real
// account data, not a locally-saved preference. `compact` renders the
// smaller appendage style used directly under an account picker
// (Transfer Funds); non-compact renders as a standalone full-size field
// (Add Expense/Deposit). `prefixLabel` is optional - when given, options
// read "prefixLabel: name" (useful when two of these appear side by
// side, e.g. From/To); omit it to just show the division's own name.
export default function DivisionSelect({ accountId, divisions, value, onChange, onDivisionCreated, wholeLabel, prefixLabel, compact = true }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const wrapperClass = compact ? "mt-2" : "";
  const selectClass = compact
    ? "w-full appearance-none rounded-lg px-3 py-2 text-xs focus:outline-none"
    : "w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none";
  const chevronSize = compact ? 14 : 16;

  if (adding) {
    return (
      <div className={`rounded-lg p-2 ${wrapperClass}`} style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Division name"
          className="w-full rounded-lg px-2 py-1.5 text-xs mb-2 focus:outline-none"
          style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
        />
        {error && <p className="text-xs mb-2" style={{ color: colors.alert }}>{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                const division = await divisionsApi.create(accountId, { name: name.trim() });
                onDivisionCreated(division);
                setAdding(false);
                setName("");
              } catch (err) {
                setError(err.message || "Couldn't create that division.");
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-lg px-3 py-1 text-xs font-medium"
            style={{ background: colors.accent, color: colors.bg, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setName("");
              setError(null);
            }}
            className="rounded-lg px-3 py-1 text-xs"
            style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${wrapperClass}`}>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__add__") {
            setAdding(true);
            return;
          }
          onChange(e.target.value);
        }}
        className={selectClass}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
      >
        <option value="">{wholeLabel}</option>
        {divisions.map((d) => (
          <option key={d.divisionId} value={d.divisionId}>
            {prefixLabel ? `${prefixLabel}: ${d.name}` : d.name}
          </option>
        ))}
        <option value="__add__">+ Add new division…</option>
      </select>
      <ChevronDown size={chevronSize} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
    </div>
  );
}
