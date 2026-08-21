import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { accountsApi, recurringApi } from "../lib/apiClient";
import { occurrencesUntil } from "../lib/scheduleMath";
import { colors, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";

const RANGE_OPTIONS = [
  { key: 30, label: "30 days" },
  { key: 60, label: "60 days" },
  { key: 90, label: "90 days" },
];

function addDaysISO(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export default function UpcomingRecurringPage() {
  const { theme } = useTheme();
  const [items, setItems] = useState(null);
  const [accountNames, setAccountNames] = useState({});
  const [rangeDays, setRangeDays] = useState(30);
  const [error, setError] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [actioningKey, setActioningKey] = useState(null);
  const [actionError, setActionError] = useState(null);

  function refresh() {
    return accountsApi.list().then(async (accts) => {
      setAccountNames(Object.fromEntries(accts.map((a) => [a.accountId, a.name])));
      const perAccount = await Promise.all(
        accts.map((a) => recurringApi.list(a.accountId).catch(() => []))
      );
      const flat = perAccount.flat().filter((i) => i.activeFlag === "true" && !i.isIncome);
      setItems(flat);
    });
  }

  useEffect(() => {
    refresh().catch(() => setError("Couldn't load your recurring expenses."));
  }, []);

  async function saveOccurrenceEdit(occ) {
    const amount = parseFloat(editAmount);
    if (!(amount > 0)) {
      setEditError("Enter a valid amount.");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const body = { occurrenceDate: occ.occurrenceDate, amount, newDate: editDate };
      await recurringApi.setOccurrence(occ.accountId, occ.recurringId, body);
      setEditingKey(null);
      await refresh();
    } catch (err) {
      setEditError(err.message || "Couldn't save that change.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function markPaid(occ, rowKey) {
    setActioningKey(rowKey);
    setActionError(null);
    try {
      await recurringApi.markPaid(occ.accountId, occ.recurringId);
      setEditingKey(null);
      await refresh();
    } catch (err) {
      setActionError(err.message || "Couldn't mark that as paid.");
    } finally {
      setActioningKey(null);
    }
  }

  async function skipOccurrence(occ, rowKey) {
    setActioningKey(rowKey);
    setActionError(null);
    try {
      await recurringApi.skip(occ.accountId, occ.recurringId);
      setEditingKey(null);
      await refresh();
    } catch (err) {
      setActionError(err.message || "Couldn't skip that occurrence.");
    } finally {
      setActioningKey(null);
    }
  }

  const timeline = useMemo(() => {
    if (!items) return [];
    const today = new Date().toISOString().slice(0, 10);
    const endDate = addDaysISO(today, rangeDays);

    const occurrences = [];
    for (const item of items) {
      for (const date of occurrencesUntil(item, endDate)) {
        const override = item.occurrenceOverrides?.[date];
        const amount = override != null ? parseFloat(override) : parseFloat(item.estimatedAmount);
        const dateOverride = item.occurrenceDateOverrides?.[date];
        const displayDate = dateOverride || date;
        occurrences.push({ ...item, occurrenceDate: date, displayDate, displayAmount: amount });
      }
    }
    occurrences.sort((a, b) => a.displayDate.localeCompare(b.displayDate));

    // Group into date buckets for display - each bucket is one calendar
    // day with one or more occurrences due that day.
    const byDate = new Map();
    for (const occ of occurrences) {
      if (!byDate.has(occ.displayDate)) byDate.set(occ.displayDate, []);
      byDate.get(occ.displayDate).push(occ);
    }
    return [...byDate.entries()];
  }, [items, rangeDays]);

  const totalUpcoming = useMemo(
    () => timeline.reduce((sum, [, occs]) => sum + occs.reduce((s, o) => s + o.displayAmount, 0), 0),
    [timeline]
  );

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Upcoming expenses" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Every recurring expense's upcoming occurrences, chronologically - not just the next one, so you can see what's actually coming.</PageBlurb>

        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        <div className="flex gap-1.5 mb-5" data-wizard-target="wizard-upcoming-range">
          {RANGE_OPTIONS.map((opt) => {
            const active = rangeDays === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRangeDays(opt.key)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                style={{ background: active ? colors.accent : "transparent", color: active ? colors.bg : colors.textMuted, border: `1px solid ${active ? colors.accent : colors.border}` }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {items === null && !error && <p className="text-sm" style={{ color: colors.textMuted }}>Loading…</p>}

        {items !== null && (
          <>
            <div className="rounded-2xl p-4 mb-5" data-wizard-target="wizard-upcoming-total" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Total due in the next {rangeDays} days</p>
              <p style={{ fontFamily: fontMono, fontSize: 22, color: colors.text }}>{formatMoney(totalUpcoming)}</p>
            </div>

            {timeline.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: colors.textMuted }}>Nothing due in this range.</p>
            ) : (
              timeline.map(([date, occs]) => (
                <div key={date} className="mb-5">
                  <p className="text-xs uppercase tracking-wide mb-2 px-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>{date}</p>
                  <div className="rounded-2xl px-4" data-wizard-target="wizard-upcoming-timeline" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                    {occs.map((occ, i) => {
                      const rowKey = `${occ.accountId}-${occ.recurringId}-${occ.occurrenceDate}`;
                      const isEditing = editingKey === rowKey;
                      return (
                        <div key={rowKey} style={{ borderBottom: i < occs.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                          <div
                            className="flex items-center justify-between py-3 transition-opacity hover:opacity-80"
                            style={{ cursor: "pointer" }}
                            onClick={() => {
                              if (isEditing) {
                                setEditingKey(null);
                              } else {
                                setEditingKey(rowKey);
                                setEditAmount(String(occ.displayAmount));
                                setEditDate(occ.displayDate);
                                setEditError(null);
                              }
                            }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: colors.surfaceRaised, color: colors.alert }}>
                                <ArrowUpRight size={15} strokeWidth={2} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm truncate" style={{ color: colors.text }}>{occ.description || occ.category}</p>
                                <p className="text-xs truncate" style={{ color: colors.textMuted }}>
                                  {occ.category} · {accountNames[occ.accountId] || "Unknown account"}
                                  {occ.displayDate !== occ.occurrenceDate && " · date adjusted"}
                                </p>
                              </div>
                            </div>
                            <span className="shrink-0" style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(occ.displayAmount)}</span>
                          </div>
                          {isEditing && (
                            <div className="pb-3">
                              {editError && <p className="text-xs mb-2" style={{ color: colors.alert }}>{editError}</p>}
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={editAmount}
                                  onChange={(e) => setEditAmount(e.target.value)}
                                  placeholder="Amount"
                                  className="flex-1 rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                                  style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                                />
                                <input
                                  type="date"
                                  value={editDate}
                                  onChange={(e) => setEditDate(e.target.value)}
                                  className="rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                                  style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }}
                                />
                              </div>
                              <div className="flex gap-2 mt-2">
                                <button
                                  type="button"
                                  onClick={() => saveOccurrenceEdit(occ)}
                                  disabled={savingEdit}
                                  className="flex-1 rounded-lg py-2 text-xs font-medium"
                                  style={{ background: colors.accent, color: colors.bg, opacity: savingEdit ? 0.6 : 1 }}
                                >
                                  {savingEdit ? "Saving…" : "Save"}
                                </button>
                                <button type="button" onClick={() => setEditingKey(null)} className="flex-1 rounded-lg py-2 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                              </div>
                              {occ.occurrenceDate === occ.nextDueDate && (
                                <>
                                  {actionError && <p className="text-xs mt-2" style={{ color: colors.alert }}>{actionError}</p>}
                                  <div className="flex gap-2 mt-2 pt-2" data-wizard-target="wizard-upcoming-markpaid" style={{ borderTop: `1px solid ${colors.border}` }}>
                                    <button
                                      type="button"
                                      onClick={() => markPaid(occ, rowKey)}
                                      disabled={actioningKey === rowKey}
                                      className="flex-1 rounded-lg py-2 text-xs font-medium"
                                      style={{ background: colors.positive, color: colors.bg, opacity: actioningKey === rowKey ? 0.6 : 1 }}
                                    >
                                      {actioningKey === rowKey ? "Working…" : "Mark as paid"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => skipOccurrence(occ, rowKey)}
                                      disabled={actioningKey === rowKey}
                                      className="flex-1 rounded-lg py-2 text-xs"
                                      style={{ border: `1px solid ${colors.border}`, color: colors.textMuted, opacity: actioningKey === rowKey ? 0.6 : 1 }}
                                    >
                                      Skip this one
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
