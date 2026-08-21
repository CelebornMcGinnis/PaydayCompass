import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Trash2, Check, ArrowDownLeft, ArrowUpRight, UserX, ChevronDown, AlertTriangle } from "lucide-react";
import { paydayApi, accountsApi, budgetsApi, divisionsApi, recurringApi, plannedExpensesApi } from "../lib/apiClient";
import { getCurrentUserEmail } from "../lib/cognito";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";

const DEFAULT_CATEGORY_OPTIONS = ["Groceries", "Dining", "Utilities", "Transportation", "Household", "Uncategorized"];

function draftStorageKey() {
  return `payday-unpredicted-draft:${getCurrentUserEmail() || "anonymous"}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// Labels for the per-item failure types payday-fn's _submit can report -
// everything else in the batch still posted normally (see the backend's
// per-item try/except in _submit), this is just naming which specific
// piece needs a manual follow-up.
function describePaydayError(e) {
  switch (e.type) {
    case "recurring":
      return `A recurring expense didn't post${e.error ? ` (${e.error})` : ""} - it's still showing as due, try marking it paid from Upcoming expenses.`;
    case "additional":
      return `"${e.description || "An extra transaction"}" didn't post${e.error ? ` (${e.error})` : ""} - add it manually if it should count.`;
    case "budgetTransfer":
      return `The ${e.category} budget set-aside didn't transfer${e.error ? ` (${e.error})` : ""} - move it manually if needed.`;
    case "plannedTransfer":
      return `The transfer toward "${e.name || "a planned expense"}" didn't go through${e.error ? ` (${e.error})` : ""}.`;
    case "plannedExpenseUpdate":
      return `"${e.name || "A planned expense"}"'s transfer went through, but its progress total didn't update - check it on Planned Expenses.`;
    default:
      return e.error || "Something in this batch didn't complete.";
  }
}

function ExpenseRow({ item, accountName, amount, onAmountChange, readOnly, onNavigate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(amount));

  function commit() {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0) onAmountChange(n);
    setEditing(false);
  }

  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
      <div className="flex items-center gap-3 min-w-0" style={{ cursor: onNavigate ? "pointer" : "default" }} onClick={onNavigate}>
        <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: colors.surfaceRaised, color: colors.alert }}>
          <ArrowUpRight size={15} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm truncate" style={{ color: colors.text }}>{item.description}</p>
          <p className="text-xs truncate" style={{ color: colors.textMuted }}>
            {item.category} · due {item.dueDate} · {accountName || "Unknown account"}
            {item.externalBankAccountName && (
              <span style={{ color: colors.textMuted }}> · drafted from {item.externalBankAccountName}</span>
            )}
          </p>
        </div>
      </div>
      {readOnly ? (
        <span className="shrink-0 pl-2" style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(amount)}</span>
      ) : editing ? (
        <div className="flex items-center gap-1.5 shrink-0 pl-2">
          <span className="text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            className="w-20 rounded-md px-2 py-1 text-sm text-right focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.accentLight}`, color: colors.text, fontFamily: fontMono }}
          />
        </div>
      ) : (
        <button type="button" onClick={() => { setDraft(String(amount)); setEditing(true); }} className="flex items-center gap-1.5 shrink-0 pl-2">
          <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(amount)}</span>
          <Pencil size={13} style={{ color: colors.textMuted }} />
        </button>
      )}
    </div>
  );
}


function PaydaySelector({ viewDate, onSelectDate, onReset }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [customDate, setCustomDate] = useState("");

  function load() {
    if (history === null) {
      paydayApi.history().then((d) => setHistory(d.history)).catch(() => setHistory([]));
    }
    setOpen((o) => !o);
  }

  return (
    <div className="rounded-2xl mb-5 overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
      <button type="button" onClick={load} className="w-full flex items-center justify-between px-4 py-3 text-sm transition-opacity hover:opacity-80" style={{ color: colors.text }}>
        {viewDate ? `Viewing ${viewDate}` : "Viewing your next payday"}
        <span style={{ color: colors.textMuted }}>{open ? "Hide" : "Change"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {viewDate && (
            <button type="button" onClick={() => { onReset(); setOpen(false); }} className="text-xs underline mb-3" style={{ color: colors.accentLight }}>
              ← Back to next payday
            </button>
          )}
          {history === null && <p className="text-xs mb-2" style={{ color: colors.textMuted }}>Loading past paydays…</p>}
          {history && history.length > 0 && (
            <div className="relative mb-3">
              <select
                value=""
                onChange={(e) => { if (e.target.value) { onSelectDate(e.target.value); setOpen(false); } }}
                className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                <option value="">Choose a past payday…</option>
                {history.map((h) => <option key={h.paydayDate} value={h.paydayDate}>{h.paydayDate}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
            </div>
          )}
          <p className="text-xs mb-1.5" style={{ color: colors.textMuted }}>Or pick any other date - past or future:</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }}
            />
            <button
              type="button"
              disabled={!customDate}
              onClick={() => { onSelectDate(customDate); setOpen(false); setCustomDate(""); }}
              className="rounded-lg px-4 text-xs font-medium"
              style={{ background: customDate ? colors.accent : colors.surfaceRaised, color: customDate ? colors.bg : colors.textMuted }}
            >
              Go
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PaydayPage() {
  const navigate = useNavigate();
  const [viewDate, setViewDate] = useState(null); // null = default: the real next (not-yet-submitted) payday
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  // Which account budget/planned-expense transfers draw from. Defaults to
  // whichever income is listed first, matching the old implicit behavior,
  // but is only ever user-relevant (and only shown) when income this
  // payday actually spans more than one account - see the selector below.
  const [selectedSourceAccountId, setSelectedSourceAccountId] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [incomeEditAmount, setIncomeEditAmount] = useState("");
  const [incomeEditError, setIncomeEditError] = useState(null);
  const [savingIncomeEdit, setSavingIncomeEdit] = useState(false);
  const [budgetAmounts, setBudgetAmounts] = useState({});
  const [plannedExpenseAmounts, setPlannedExpenseAmounts] = useState({});
  const [markingComplete, setMarkingComplete] = useState(null);
  const [completeError, setCompleteError] = useState(null);
  const [categoryOptions, setCategoryOptions] = useState(DEFAULT_CATEGORY_OPTIONS);
  const [expenseAmounts, setExpenseAmounts] = useState({});
  // Restored from localStorage so navigating away and back (or an
  // accidental reload) doesn't lose unsubmitted unpredicted amounts -
  // these should only ever clear on a successful submit, never just from
  // leaving the page.
  const [unpredicted, setUnpredicted] = useState(() => {
    try {
      const raw = localStorage.getItem(draftStorageKey());
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [recipientMessages, setRecipientMessages] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [updatedBalances, setUpdatedBalances] = useState([]);
  const [submitErrors, setSubmitErrors] = useState([]);
  const newBalancesRef = useRef(null);

  useEffect(() => {
    if (updatedBalances.length > 0 && newBalancesRef.current) {
      newBalancesRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [updatedBalances]);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [confirmNavigate, setConfirmNavigate] = useState(null); // { label, url } | null
  const [error, setError] = useState(null);

  // What actually posted for a past payday (seeded from data.transfers,
  // not the freshly-recomputed budgetedExpenses/plannedExpenseContributions
  // above, which can have since drifted) - edited here, then Update
  // pushes just the difference out as a real correction.
  const [transferAmounts, setTransferAmounts] = useState({});
  const [updatingPayday, setUpdatingPayday] = useState(false);
  const [updateError, setUpdateError] = useState(null);

  const [divisionsByAccount, setDivisionsByAccount] = useState({});

  useEffect(() => {
    Promise.all([accountsApi.list(), budgetsApi.list()])
      .then(async ([accts, budgets]) => {
        setAccounts(accts);
        // Real categories the user has actually created budgets for,
        // merged with the defaults - previously this was a hardcoded
        // list unrelated to what the user set up in Budgets at all.
        const realCategories = budgets.map((b) => b.category);
        setCategoryOptions([...new Set([...DEFAULT_CATEGORY_OPTIONS, ...realCategories])]);

        // Fetched once, upfront, for every account - each unpredicted
        // row has its own account selector, so a per-row fetch would
        // mean re-fetching every time any row's account changes.
        const perAccount = await Promise.all(accts.map((a) => divisionsApi.list(a.accountId).catch(() => [])));
        setDivisionsByAccount(Object.fromEntries(accts.map((a, i) => [a.accountId, perAccount[i]])));
      })
      .catch(() => {}); // best-effort - the main payday fetch below still shows its own error if it fails
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshPayday() {
    return paydayApi.upcoming(viewDate).then((d) => {
      setData(d);
      if (d.mode === "preview") {
        setExpenseAmounts(Object.fromEntries(d.upcomingExpenses.map((e) => [e.recurringId, e.estimatedAmount])));
        setBudgetAmounts(Object.fromEntries((d.budgetedExpenses || []).map((b) => [b.category, b.amount])));
        setPlannedExpenseAmounts(Object.fromEntries(
          [...(d.plannedExpenseContributions || []), ...(d.overduePlannedExpenses || [])].map((pe) => [pe.plannedExpenseId, pe.amount])
        ));
        // Defaults to whichever income is listed first - same as the old
        // implicit behavior - but stays user-adjustable via the selector
        // below when income this payday spans more than one account.
        setSelectedSourceAccountId(d.income[0]?.accountId || null);
      }
      if (d.mode === "history") {
        setTransferAmounts(Object.fromEntries(
          (d.transfers || []).map((t) => [t.category || t.plannedExpenseId, t.amount])
        ));
      }
      return d;
    });
  }

  useEffect(() => {
    setData(null);
    setError(null);
    refreshPayday().catch(() => setError(viewDate ? "Couldn't load that payday." : "Couldn't load your upcoming payday."));
  }, [viewDate]);

  async function saveIncomeEdit(inc) {
    const amount = parseFloat(incomeEditAmount);
    if (!(amount > 0)) {
      setIncomeEditError("Enter a valid amount.");
      return;
    }
    setSavingIncomeEdit(true);
    setIncomeEditError(null);
    try {
      await recurringApi.setOccurrence(inc.accountId, inc.recurringId, { occurrenceDate: inc.dueDate, amount });
      setEditingKey(null);
      await refreshPayday();
    } catch (err) {
      setIncomeEditError(err.message || "Couldn't save that change.");
    } finally {
      setSavingIncomeEdit(false);
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(draftStorageKey(), JSON.stringify(unpredicted));
    } catch {
      // best-effort - if storage is unavailable, the draft just won't
      // persist across navigation, but the page still works
    }
  }, [unpredicted]);

  const isEditable = data?.mode === "preview" && !viewDate;
  const totalIncomeNet = (data?.income || []).reduce((s, i) => s + i.netAmount, 0);
  const totalExpenses = useMemo(
    () => Object.values(expenseAmounts).reduce((s, v) => s + v, 0),
    [expenseAmounts]
  );
  const totalUnpredicted = useMemo(() => unpredicted.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [unpredicted]);
  const totalBudgeted = useMemo(() => (data?.budgetedExpenses || []).reduce((s, b) => s + (budgetAmounts[b.category] ?? b.amount), 0), [data, budgetAmounts]);
  const totalPlannedContributions = useMemo(
    () => [...(data?.plannedExpenseContributions || []), ...(data?.overduePlannedExpenses || [])]
      .reduce((s, pe) => s + (plannedExpenseAmounts[pe.plannedExpenseId] ?? pe.amount), 0),
    [data, plannedExpenseAmounts]
  );
  const leftover = totalIncomeNet - totalExpenses - totalUnpredicted - totalBudgeted - totalPlannedContributions;

  function addUnpredicted() {
    setUnpredicted((r) => [...r, { id: uid(), description: "", amount: "", category: "Uncategorized", accountId: accounts[0]?.accountId || "", divisionId: "" }]);
  }
  function updateUnpredicted(id, next) {
    setUnpredicted((r) =>
      r.map((row) => {
        if (row.id !== id) return row;
        // A division belongs to one specific account - if the account
        // changed, whatever division was picked no longer applies.
        if (next.accountId !== row.accountId) return { ...next, divisionId: "" };
        return next;
      })
    );
  }
  function removeUnpredicted(id) {
    setUnpredicted((r) => r.filter((row) => row.id !== id));
  }
  function toggleRecipient(userId) {
    setSelectedRecipients((ids) => {
      if (ids.includes(userId)) return ids.filter((i) => i !== userId);
      setRecipientMessages((m) => ({ ...m, [userId]: m[userId] || { amount: "", message: "" } }));
      return [...ids, userId];
    });
  }
  function updateRecipientMessage(userId, field, value) {
    setRecipientMessages((m) => ({ ...m, [userId]: { ...m[userId], [field]: value } }));
  }

  const hasTransferChanges = (data?.transfers || []).some((t) => {
    const key = t.category || t.plannedExpenseId;
    return transferAmounts[key] !== undefined && transferAmounts[key] !== t.amount;
  });

  async function handleUpdatePayday() {
    if (!data?.paydayDate) return;
    setUpdatingPayday(true);
    setUpdateError(null);
    try {
      await paydayApi.update({
        paydayDate: data.paydayDate,
        budgetAdjustments: (data.transfers || [])
          .filter((t) => t.category && transferAmounts[t.category] !== undefined && transferAmounts[t.category] !== t.amount)
          .map((t) => ({ category: t.category, amount: transferAmounts[t.category] })),
        plannedExpenseAdjustments: (data.transfers || [])
          .filter((t) => t.plannedExpenseId && transferAmounts[t.plannedExpenseId] !== undefined && transferAmounts[t.plannedExpenseId] !== t.amount)
          .map((t) => ({ plannedExpenseId: t.plannedExpenseId, amount: transferAmounts[t.plannedExpenseId] })),
      });
      await refreshPayday();
    } catch (err) {
      setUpdateError(err.message || "Couldn't push that correction.");
    } finally {
      setUpdatingPayday(false);
    }
  }

  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await paydayApi.submit({
        sourceAccountId: selectedSourceAccountId || data.income[0]?.accountId,
        recurringAdjustments: data.upcomingExpenses
          .map((e) => ({
            recurringId: e.recurringId,
            accountId: e.accountId,
            amount: expenseAmounts[e.recurringId],
          })),
        additionalTransactions: unpredicted
          .filter((r) => parseFloat(r.amount) > 0 && r.accountId)
          .map((r) => ({ accountId: r.accountId, amount: parseFloat(r.amount), category: r.category, description: r.description, direction: "debit", divisionId: r.divisionId || undefined })),
        budgetAdjustments: (data.budgetedExpenses || []).map((b) => ({
          category: b.category,
          amount: budgetAmounts[b.category] ?? b.amount,
        })),
        plannedExpenseAdjustments: [...(data.plannedExpenseContributions || []), ...(data.overduePlannedExpenses || [])].map((pe) => ({
          plannedExpenseId: pe.plannedExpenseId,
          amount: plannedExpenseAmounts[pe.plannedExpenseId] ?? pe.amount,
        })),
        peerNotifications: selectedRecipients.map((userId) => ({
          recipientUserId: userId,
          amount: parseFloat(recipientMessages[userId]?.amount) || 0,
          dueDate: data.nextPayday,
          message: recipientMessages[userId]?.message || "",
        })),
      });
      setSubmitted(true);
      setUpdatedBalances(result?.updatedBalances || []);
      setSubmitErrors(result?.errors || []);
      try {
        localStorage.removeItem(draftStorageKey());
      } catch {
        // non-fatal - worst case a stale draft reappears next visit
      }
    } catch (err) {
      setError(err.message || "Couldn't submit - try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const accountsById = Object.fromEntries(accounts.map((a) => [a.accountId, a.name]));
  // Only worth showing/choosing when this payday's income actually spans
  // more than one account - the common single-income-account case stays
  // exactly as simple as before.
  const incomeAccountIds = data?.income ? [...new Set(data.income.map((i) => i.accountId))] : [];

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: colors.bg }}>
        <p className="text-sm" style={{ color: colors.alert }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader
        title="Payday Review"
        subtitle={data && data.mode !== "noIncome" ? (data.mode === "history" ? `submitted ${data.paydayDate}` : `due ${data.nextPayday}`) : undefined}
        wizardBlocked={data?.mode === "noIncome" ? {
          message: "Payday works off your income schedule - you'll need at least one income source set up before there's anything real to walk through here.",
          guideTo: "/recurring?new=income",
        } : null}
      />

      {!data ? (
        <p className="text-sm px-5 pt-6" style={{ color: colors.textMuted }}>Loading…</p>
      ) : data.mode === "noIncome" ? (
        <div className="px-5 pt-6 max-w-md mx-auto text-center">
          <div className="rounded-2xl p-6 mt-4" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }} className="mb-2">
              Add your income to unlock this
            </p>
            <p className="text-sm mb-5" style={{ color: colors.textMuted }}>
              Payday Review works out real pay periods from your income schedule - without at least one
              income source set up, there's no real period to work from, so this stays off rather than
              show you numbers that would just be wrong.
            </p>
            <button
              type="button"
              onClick={() => navigate("/recurring?new=income")}
              className="w-full rounded-lg py-2.5 text-sm font-medium"
              style={{ background: colors.accent, color: colors.bg }}
            >
              Add your income
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 pt-6 max-w-md mx-auto">
          <PageBlurb>Budgets and planned expenses set themselves aside on your real payday - review what moved here, and correct it if something was off.</PageBlurb>
          <div data-wizard-target="wizard-payday-selector">
            <PaydaySelector viewDate={viewDate} onSelectDate={setViewDate} onReset={() => setViewDate(null)} />
          </div>

          {data.mode === "history" && (data.errors || []).length > 0 && (
            <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.alert}` }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} color={colors.alert} />
                <p className="text-sm font-medium" style={{ color: colors.text }}>
                  {data.errors.length === 1 ? "One item" : `${data.errors.length} items`} in this payday didn't go through
                </p>
              </div>
              <ul className="text-xs" style={{ color: colors.textMuted }}>
                {data.errors.map((e, i) => (
                  <li key={i} className="py-1" style={{ borderTop: i > 0 ? `1px solid ${colors.border}` : "none" }}>{describePaydayError(e)}</li>
                ))}
              </ul>
            </div>
          )}

          {data.mode === "history" && (
            <div className="rounded-2xl px-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              {(data.posted || []).length === 0 ? (
                <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>Nothing was posted for this payday.</p>
              ) : (
                data.posted.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-3" style={{ borderBottom: i < data.posted.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                    <div className="min-w-0 pr-2">
                      <p className="text-sm truncate" style={{ color: colors.text }}>{p.description || p.category || "—"}</p>
                      {p.category && p.description && <p className="text-xs" style={{ color: colors.textMuted }}>{p.category}</p>}
                    </div>
                    <span className="shrink-0" style={{ fontFamily: fontMono, fontSize: 14, color: (p.direction === "credit" || p.isIncome) ? colors.positive : colors.text }}>
                      {(p.direction === "credit" || p.isIncome) ? "+" : "-"}{formatMoney(p.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {data.mode === "history" && (
            <div className="mb-5">
              <div className="flex items-center mb-2 px-1">
                <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>What got set aside</h3>
                <InfoBubble text="Budgeted categories and planned expenses that auto-posted (or were submitted early) for this payday. Edit an amount and Update pushes just the difference out as a correction - the original transfer stays on record as it happened." />
              </div>
              {(data.transfers || []).length === 0 ? (
                <p className="text-sm px-1" style={{ color: colors.textMuted }}>Nothing was set aside for this payday.</p>
              ) : (
                <div className="rounded-2xl px-4 mb-3" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                  {data.transfers.map((t, i) => {
                    const key = t.category || t.plannedExpenseId;
                    const rowKey = `transfer-${key}`;
                    const isEditingTransfer = editingKey === rowKey;
                    const currentAmount = transferAmounts[key] ?? t.amount;
                    return (
                      <div key={rowKey} style={{ borderBottom: i < data.transfers.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                        <div className="flex items-center justify-between py-2.5">
                          <div
                            style={{ cursor: "pointer" }}
                            onClick={() => setConfirmNavigate(t.category
                              ? { label: t.category, url: `/budgets?category=${encodeURIComponent(t.category)}` }
                              : { label: t.name, url: `/planned-expenses?edit=${t.plannedExpenseId}` })}
                          >
                            <span className="text-sm" style={{ color: colors.text }}>{t.category || t.name}</span>
                          </div>
                          <span
                            className="flex items-center gap-1.5 shrink-0 pl-2 transition-opacity hover:opacity-80"
                            style={{ cursor: "pointer" }}
                            onClick={() => setEditingKey(isEditingTransfer ? null : rowKey)}
                          >
                            <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(currentAmount)}</span>
                            <Pencil size={13} style={{ color: colors.textMuted }} />
                          </span>
                        </div>
                        {isEditingTransfer && (
                          <div className="pb-3">
                            <div className="flex gap-2">
                              <input
                                type="number"
                                inputMode="decimal"
                                value={currentAmount}
                                onChange={(e) => setTransferAmounts((a) => ({ ...a, [key]: parseFloat(e.target.value) || 0 }))}
                                className="flex-1 rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                                style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                              />
                              <button type="button" onClick={() => setEditingKey(null)} className="rounded-lg px-3 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>Done</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {updateError && <p className="text-sm mb-2 px-1" style={{ color: colors.alert }}>{updateError}</p>}
              {hasTransferChanges && (
                <button
                  type="button"
                  onClick={handleUpdatePayday}
                  disabled={updatingPayday}
                  className="w-full rounded-lg py-2.5 text-sm font-medium"
                  style={{ background: colors.accent, color: colors.bg, opacity: updatingPayday ? 0.6 : 1 }}
                >
                  {updatingPayday ? "Updating…" : "Update"}
                </button>
              )}
            </div>
          )}

          {data.mode === "preview" && (
          <div className="rounded-2xl p-4 mb-5" data-wizard-target="wizard-payday-income" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            {data.income.map((inc, i) => {
              const rowKey = `income-${inc.accountId}-${inc.recurringId}`;
              const isEditingIncome = editingKey === rowKey;
              return (
                <div key={inc.recurringId} style={{ borderBottom: i < data.income.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                  <div
                    className="flex items-center justify-between py-2 transition-opacity hover:opacity-80"
                    style={{ cursor: isEditable ? "pointer" : "default" }}
                    onClick={() => {
                      if (!isEditable) return;
                      if (isEditingIncome) {
                        setEditingKey(null);
                      } else {
                        setEditingKey(rowKey);
                        setIncomeEditAmount(String(inc.netAmount));
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: colors.surfaceRaised, color: colors.positive }}>
                        <ArrowDownLeft size={15} strokeWidth={2} />
                      </div>
                      <div>
                        <p className="text-sm" style={{ color: colors.text }}>{inc.description}</p>
                        <p className="text-xs" style={{ color: colors.textMuted }}>
                          arriving {inc.dueDate}
                          {inc.grossAmount != null && ` · gross ${formatMoney(inc.grossAmount)}`}
                        </p>
                      </div>
                    </div>
                    <span style={{ fontFamily: fontMono, fontSize: 15, color: colors.positive }}>+{formatMoney(inc.netAmount)}</span>
                  </div>
                  {isEditingIncome && (
                    <div className="pb-3">
                      {incomeEditError && <p className="text-xs mb-2" style={{ color: colors.alert }}>{incomeEditError}</p>}
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={incomeEditAmount}
                          onChange={(e) => setIncomeEditAmount(e.target.value)}
                          placeholder="Amount"
                          className="flex-1 rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                          style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                        />
                        <button
                          type="button"
                          onClick={() => saveIncomeEdit(inc)}
                          disabled={savingIncomeEdit}
                          className="rounded-lg px-3 text-xs font-medium"
                          style={{ background: colors.accent, color: colors.bg, opacity: savingIncomeEdit ? 0.6 : 1 }}
                        >
                          {savingIncomeEdit ? "…" : "Save"}
                        </button>
                        <button type="button" onClick={() => setEditingKey(null)} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}

          {data.mode === "preview" && isEditable && incomeAccountIds.length > 1 && (
            <div className="rounded-2xl p-4 mb-5" data-wizard-target="wizard-payday-source-account" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <div className="flex items-center mb-2">
                <span className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Move budgeted &amp; planned money from</span>
                <InfoBubble text="Your income this payday lands in more than one account. Budget set-asides and planned-expense contributions below all transfer from whichever account you pick here - pick the one your paycheck actually lands in, not just any account with income." />
              </div>
              <div className="relative">
                <select
                  value={selectedSourceAccountId || ""}
                  onChange={(e) => setSelectedSourceAccountId(e.target.value)}
                  className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  {incomeAccountIds.map((id) => <option key={id} value={id}>{accountsById[id] || "Unknown account"}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
              </div>
            </div>
          )}

          {data.mode === "preview" && (
          <>
          <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-2 px-1">Recurring expenses</h3>
          <div className="rounded-2xl px-4 mb-5" data-wizard-target="wizard-payday-expenses" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            {data.upcomingExpenses.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>Nothing due before payday.</p>
            ) : (
              data.upcomingExpenses.map((e) => (
                <ExpenseRow
                  key={e.recurringId}
                  item={e}
                  accountName={accountsById[e.accountId]}
                  amount={expenseAmounts[e.recurringId]}
                  onAmountChange={(n) => setExpenseAmounts((a) => ({ ...a, [e.recurringId]: n }))}
                  readOnly={!isEditable}
                  onNavigate={() => setConfirmNavigate({ label: e.description || e.category, url: `/recurring?edit=${e.recurringId}` })}
                />
              ))
            )}
          </div>

          {isEditable && (
          <>
          <h3 data-wizard-target="wizard-payday-unpredicted" style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-2 px-1">
            Unpredicted amounts <span className="text-xs font-normal" style={{ color: colors.textMuted }}>(optional)</span>
          </h3>
          {unpredicted.map((row) => (
            <div key={row.id} className="rounded-xl p-3 mb-2.5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
              <input
                value={row.description}
                onChange={(e) => updateUnpredicted(row.id, { ...row, description: e.target.value })}
                placeholder="Description"
                className="w-full rounded-lg px-2.5 py-2 text-sm mb-2 focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => updateUnpredicted(row.id, { ...row, amount: e.target.value })}
                  placeholder="0.00"
                  className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                />
                <select
                  value={row.category}
                  onChange={(e) => updateUnpredicted(row.id, { ...row, category: e.target.value })}
                  className="flex-1 rounded-lg px-2 py-2 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button type="button" onClick={() => removeUnpredicted(row.id)} aria-label="Remove" style={{ color: colors.alert }}>
                  <Trash2 size={16} />
                </button>
              </div>
              <select
                value={row.accountId}
                onChange={(e) => updateUnpredicted(row.id, { ...row, accountId: e.target.value })}
                className="w-full rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
              </select>
              {(divisionsByAccount[row.accountId] || []).length > 0 && (
                <select
                  value={row.divisionId || ""}
                  onChange={(e) => updateUnpredicted(row.id, { ...row, divisionId: e.target.value })}
                  className="w-full rounded-lg px-2.5 py-2 text-xs mt-2 focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  <option value="">Don't deduct from a division</option>
                  {divisionsByAccount[row.accountId].map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
                </select>
              )}
            </div>
          ))}
          <button type="button" onClick={addUnpredicted} className="w-full rounded-xl py-2.5 mb-5 text-sm font-medium flex items-center justify-center gap-2" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
            <Plus size={15} /> Add unpredicted amount
          </button>
          </>
          )}
          </>
          )}

          {(data.budgetedExpenses?.length > 0 || data.plannedExpenseContributions?.length > 0) && (
            <>
              <div className="flex items-center mb-2 px-1" data-wizard-target="wizard-payday-budgeted">
                <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Budgeted &amp; planned</h3>
                <InfoBubble text="What to set aside this payday - budget categories and planned-expense contributions. Ones with a destination account (set in Budgets or Planned Expenses) actually get transferred there when you submit; ones without stay purely informational." />
              </div>
              <div className="rounded-2xl px-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                {(data.budgetedExpenses || []).map((b) => {
                  const rowKey = `budget-${b.category}`;
                  const isEditingBudget = editingKey === rowKey;
                  const currentAmount = budgetAmounts[b.category] ?? b.amount;
                  return (
                    <div key={rowKey} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <div className="flex items-center justify-between py-2.5">
                        <div style={{ cursor: "pointer" }} onClick={() => setConfirmNavigate({ label: b.category, url: `/budgets?category=${encodeURIComponent(b.category)}` })}>
                          <span className="text-sm" style={{ color: colors.text }}>{b.category}</span>
                          <span className="text-xs ml-1.5" style={{ color: b.accountId ? colors.accentLight : colors.textMuted }}>
                            {b.accountId ? "will transfer" : "budget · reminder only"}
                          </span>
                          {b.spentThisPeriod > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>
                              {formatMoney(b.spentThisPeriod)} already spent this period of {formatMoney(b.fullPeriodAmount)}
                            </p>
                          )}
                        </div>
                        <span
                          className="flex items-center gap-1.5 shrink-0 pl-2 transition-opacity hover:opacity-80"
                          style={{ cursor: isEditable ? "pointer" : "default" }}
                          onClick={() => { if (isEditable) setEditingKey(isEditingBudget ? null : rowKey); }}
                        >
                          <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(currentAmount)}</span>
                          {isEditable && <Pencil size={13} style={{ color: colors.textMuted }} />}
                        </span>
                      </div>
                      {isEditingBudget && (
                        <div className="pb-3">
                          <div className="flex gap-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={currentAmount}
                              onChange={(e) => setBudgetAmounts((a) => ({ ...a, [b.category]: parseFloat(e.target.value) || 0 }))}
                              className="flex-1 rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                            />
                            <button type="button" onClick={() => setEditingKey(null)} className="rounded-lg px-3 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>Done</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(data.plannedExpenseContributions || []).map((pe) => {
                  const rowKey = `planned-${pe.plannedExpenseId}`;
                  const isEditingPlanned = editingKey === rowKey;
                  const currentAmount = plannedExpenseAmounts[pe.plannedExpenseId] ?? pe.amount;
                  return (
                    <div key={rowKey} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <div className="flex items-center justify-between py-2.5">
                        <div style={{ cursor: "pointer" }} onClick={() => setConfirmNavigate({ label: pe.name, url: `/planned-expenses?edit=${pe.plannedExpenseId}` })}>
                          <span className="text-sm" style={{ color: colors.text }}>{pe.name}</span>
                          <span className="text-xs ml-1.5" style={{ color: pe.linkedAccountId ? colors.accentLight : colors.textMuted }}>
                            {pe.linkedAccountId ? "will transfer" : "planned · reminder only"}
                          </span>
                        </div>
                        <span
                          className="flex items-center gap-1.5 shrink-0 pl-2 transition-opacity hover:opacity-80"
                          style={{ cursor: isEditable ? "pointer" : "default" }}
                          onClick={() => { if (isEditable) setEditingKey(isEditingPlanned ? null : rowKey); }}
                        >
                          <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(currentAmount)}</span>
                          {isEditable && <Pencil size={13} style={{ color: colors.textMuted }} />}
                        </span>
                      </div>
                      {isEditingPlanned && (
                        <div className="pb-3">
                          <div className="flex gap-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              value={currentAmount}
                              onChange={(e) => setPlannedExpenseAmounts((a) => ({ ...a, [pe.plannedExpenseId]: parseFloat(e.target.value) || 0 }))}
                              className="flex-1 rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                            />
                            <button type="button" onClick={() => setEditingKey(null)} className="rounded-lg px-3 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>Done</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {data.overduePlannedExpenses?.length > 0 && (
            <>
              <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-1 px-1">Overdue planned expenses</h3>
              <p className="text-xs mb-2 px-1" style={{ color: colors.textMuted }}>
                Past their target date and not yet fully funded - still counted in your total below, and won't
                disappear on their own until you either finish funding them or mark them complete.
              </p>
              {completeError && <p className="text-xs mb-2 px-1" style={{ color: colors.alert }}>{completeError}</p>}
              <div className="rounded-2xl px-4 mb-5" style={{ background: colors.surface, border: `1px dashed ${colors.borderStrong}` }}>
                {data.overduePlannedExpenses.map((pe) => {
                  const rowKey = `overdue-${pe.plannedExpenseId}`;
                  const isEditingOverdue = editingKey === rowKey;
                  const currentAmount = plannedExpenseAmounts[pe.plannedExpenseId] ?? pe.amount;
                  return (
                    <div key={rowKey} className="py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <p className="text-sm truncate" style={{ color: colors.text }}>{pe.name}</p>
                          <p className="text-xs" style={{ color: colors.alert }}>was due {pe.targetDate}</p>
                        </div>
                        <span className="shrink-0" style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(currentAmount)}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingKey(isEditingOverdue ? null : rowKey)}
                          className="text-xs underline"
                          style={{ color: colors.accentLight }}
                        >
                          {isEditingOverdue ? "Done editing" : "Edit amount"}
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/planned-expenses?edit=${pe.plannedExpenseId}`)}
                          className="text-xs underline"
                          style={{ color: colors.accentLight }}
                        >
                          Go update it
                        </button>
                        <button
                          type="button"
                          disabled={markingComplete === pe.plannedExpenseId}
                          onClick={async () => {
                            setMarkingComplete(pe.plannedExpenseId);
                            setCompleteError(null);
                            try {
                              await plannedExpensesApi.markComplete(pe.plannedExpenseId);
                              await refreshPayday();
                            } catch (err) {
                              setCompleteError(err.message || "Couldn't mark that complete.");
                            } finally {
                              setMarkingComplete(null);
                            }
                          }}
                          className="text-xs underline"
                          style={{ color: colors.positive, opacity: markingComplete === pe.plannedExpenseId ? 0.5 : 1 }}
                        >
                          {markingComplete === pe.plannedExpenseId ? "Marking…" : "Mark complete"}
                        </button>
                      </div>
                      {isEditingOverdue && (
                        <div className="flex gap-2 mt-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={currentAmount}
                            onChange={(e) => setPlannedExpenseAmounts((a) => ({ ...a, [pe.plannedExpenseId]: parseFloat(e.target.value) || 0 }))}
                            className="flex-1 rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {data.aggregateByExternalBankAccount?.length > 0 && (
            <>
              <h3 data-wizard-target="wizard-payday-bybank" style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-1 px-1">By bank account</h3>
              <p className="text-xs mb-2 px-1" style={{ color: colors.textMuted }}>
                Total money to move, grouped by which real account it's on and which real-world bank account (if any) it's set up to draft from.
              </p>
              <div className="rounded-2xl px-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                {data.aggregateByExternalBankAccount.map((row) => (
                  <div key={`${row.accountName}-${row.externalAccountName || ""}`} className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <div className="min-w-0 pr-3">
                      <p className="text-sm truncate" style={{ color: colors.text }}>{row.accountName}</p>
                      {row.externalAccountName && (
                        <p className="text-xs truncate" style={{ color: colors.textMuted }}>({row.externalAccountName})</p>
                      )}
                    </div>
                    <span className="shrink-0" style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(row.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {isEditable && data.shareableRecipients?.length > 0 && (
            <>
              <div className="flex items-center mb-2 px-1" data-wizard-target="wizard-payday-notify">
                <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Let someone know</h3>
                <InfoBubble text="Send someone you trust a heads-up that money is moving - they'll get an email and see it in their own Notifications page. Requires a mutual fund-movement agreement first: if someone shows 'not invited,' send them one from the Notifications page before they'll be selectable here." />
              </div>
              <div className="rounded-2xl px-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                {data.shareableRecipients.map((r) => {
                  const eligible = r.agreementStatus === "accepted";
                  const selected = selectedRecipients.includes(r.userId);
                  return (
                    <div key={r.userId}>
                      <div className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <button
                            type="button"
                            disabled={!eligible}
                            onClick={() => toggleRecipient(r.userId)}
                            className="flex items-center justify-center rounded-full shrink-0"
                            style={{ width: 18, height: 18, border: `1.5px solid ${selected ? colors.accentLight : colors.borderStrong}`, background: selected ? colors.accentLight : "transparent", opacity: eligible ? 1 : 0.4 }}
                          >
                            {selected && <Check size={11} style={{ color: colors.bg }} />}
                          </button>
                          <span className="text-sm truncate" style={{ color: eligible ? colors.text : colors.textMuted }}>{r.email}</span>
                        </div>
                        {!eligible && (
                          <span className="flex items-center gap-1 text-xs shrink-0 pl-2" style={{ color: colors.textMuted }}>
                            <UserX size={12} /> {r.agreementStatus === "pending" ? "invite pending" : "not invited"}
                          </span>
                        )}
                      </div>
                      {selected && (
                        <div className="pb-3 flex gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={recipientMessages[r.userId]?.amount || ""}
                            onChange={(e) => updateRecipientMessage(r.userId, "amount", e.target.value)}
                            placeholder="$0.00"
                            style={{ width: 90, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                            className="rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                          />
                          <input
                            value={recipientMessages[r.userId]?.message || ""}
                            onChange={(e) => updateRecipientMessage(r.userId, "message", e.target.value)}
                            placeholder="Message"
                            className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                            style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}`, color: colors.text }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

          <div className="rounded-2xl p-4 flex items-center justify-between mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <span className="text-xs" style={{ color: colors.textMuted }}>Left over after this payday</span>
            <span style={{ fontFamily: fontMono, fontSize: 17, color: leftover >= 0 ? colors.positive : colors.alert }}>{formatMoney(leftover)}</span>
          </div>

          {submitted && submitErrors.length > 0 && (
            <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.alert}` }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} color={colors.alert} />
                <p className="text-sm font-medium" style={{ color: colors.text }}>
                  Everything else posted, but {submitErrors.length === 1 ? "one item" : `${submitErrors.length} items`} didn't go through
                </p>
              </div>
              <ul className="text-xs" style={{ color: colors.textMuted }}>
                {submitErrors.map((e, i) => (
                  <li key={i} className="py-1" style={{ borderTop: i > 0 ? `1px solid ${colors.border}` : "none" }}>{describePaydayError(e)}</li>
                ))}
              </ul>
            </div>
          )}

          {submitted && updatedBalances.length > 0 && (
            <div className="mb-5" ref={newBalancesRef}>
              <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }} className="mb-2 px-1">New balances</h3>
              <div className="rounded-2xl px-4" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                {updatedBalances.map((acct) => (
                  <div key={acct.accountId} className="py-2.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm" style={{ color: colors.text }}>{acct.accountName}</span>
                      <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(acct.balance)}</span>
                    </div>
                    {acct.divisions.length > 0 && (
                      <div className="pl-3 mt-1">
                        {acct.divisions.map((div) => (
                          <div key={div.divisionId} className="flex items-center justify-between py-0.5">
                            <span className="text-xs" style={{ color: colors.textMuted }}>{div.name}</span>
                            <span className="text-xs" style={{ fontFamily: fontMono, color: colors.textMuted }}>{formatMoney(div.balance)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isEditable && (
      <div className="fixed bottom-0 left-0 right-0 px-5 py-4 z-30" style={{ background: colors.surface, borderTop: `1px solid ${colors.border}` }}>
        <div className="max-w-md mx-auto">
          {confirmingSubmit && !submitted ? (
            <div className="rounded-xl p-3 mb-2" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
              <p className="text-xs mb-2" style={{ color: colors.textMuted }}>
                This moves real money between your accounts and can't be submitted again for this payday. Sure
                this is right?
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmingSubmit(false)} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button type="button" onClick={() => { setConfirmingSubmit(false); handleSubmit(); }} disabled={submitting} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg, opacity: submitting ? 0.6 : 1 }}>
                  {submitting ? "Submitting…" : "Yes, submit"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-wizard-target="wizard-payday-submit"
              onClick={submitted ? () => navigate("/") : () => setConfirmingSubmit(true)}
              disabled={!data || submitting}
              className="w-full rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: colors.accent, color: colors.bg, opacity: submitting ? 0.6 : 1 }}
            >
              {submitted ? (<><Check size={16} /> Done</>) : submitting ? "Submitting…" : "I've moved the money \u2014 submit"}
            </button>
          )}
        </div>
      </div>
      )}

      {data?.mode === "history" && !viewDate && (
        <div className="fixed bottom-0 left-0 right-0 px-5 py-4 z-30" style={{ background: colors.surface, borderTop: `1px solid ${colors.border}` }}>
          <div className="max-w-md mx-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled
              className="flex-1 rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: colors.border, color: colors.textMuted }}
            >
              <Check size={16} /> Already posted
            </button>
            <InfoBubble text="This payday's budgeted/planned money already moved - edit an amount above and hit Update if something needs correcting." />
          </div>
        </div>
      )}

      {confirmNavigate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-5" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setConfirmNavigate(null)}>
          <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }} onClick={(e) => e.stopPropagation()}>
            <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }} className="mb-1.5">Go to "{confirmNavigate.label}"?</p>
            <p className="text-sm mb-4" style={{ color: colors.textMuted }}>
              This leaves Payday Review - anything you haven't submitted yet on this page stays as you left it.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmNavigate(null)} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
              <button onClick={() => navigate(confirmNavigate.url)} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ background: colors.accent, color: colors.bg }}>Go there</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
