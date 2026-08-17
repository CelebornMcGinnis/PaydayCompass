import React, { useEffect, useState } from "react";
import { Plus, Trash2, ChevronDown, Check, AlertTriangle } from "lucide-react";
import { accountsApi, divisionsApi, transactionsApi } from "../lib/apiClient";
import { colors, fontBody, fontMono } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";

const CATEGORIES = ["Uncategorized", "Deposit", "Groceries", "Household", "Dining", "Transportation", "Utilities", "Entertainment", "Health", "Rent/Mortgage"];

function uid() {
  return Math.random().toString(36).slice(2);
}

function blankRow() {
  return {
    id: uid(),
    date: new Date().toISOString().slice(0, 10),
    accountId: "",
    direction: "debit",
    amount: "",
    category: "Uncategorized",
    description: "",
    divisionId: "",
    addingCategory: false,
    newCategory: "",
    status: null, // null | "sending" | "sent" | "error"
    error: null,
  };
}

export default function MassAddTransactionsPage() {
  const [accounts, setAccounts] = useState(null);
  const [divisionsByAccount, setDivisionsByAccount] = useState({});
  const [categoryOptions, setCategoryOptions] = useState(CATEGORIES);
  const [rows, setRows] = useState([blankRow()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    accountsApi.list().then((data) => {
      const owned = data.filter((a) => !a.sharedFromUserId || a.sharedPermission === "edit");
      setAccounts(owned);
    });
  }, []);

  function updateRow(id, next) {
    setRows((r) => r.map((row) => (row.id === id ? next : row)));
  }

  function addRow() {
    setRows((r) => [...r, blankRow()]);
  }

  function removeRow(id) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.id !== id) : r));
  }

  function ensureDivisionsLoaded(accountId) {
    if (!accountId || divisionsByAccount[accountId]) return;
    divisionsApi.list(accountId).then((d) => {
      setDivisionsByAccount((m) => ({ ...m, [accountId]: d }));
    }).catch(() => {});
  }

  const readyRows = rows.filter((r) => r.accountId && parseFloat(r.amount) > 0);
  const canSubmit = readyRows.length > 0 && !submitting;

  async function handleSubmitAll() {
    if (!canSubmit) return;
    setSubmitting(true);

    const toSubmit = rows.filter((r) => r.accountId && parseFloat(r.amount) > 0);
    setRows((r) => r.map((row) => (toSubmit.some((t) => t.id === row.id) ? { ...row, status: "sending", error: null } : row)));

    const results = await Promise.allSettled(
      toSubmit.map((row) =>
        transactionsApi.addExpense(row.accountId, {
          totalAmount: parseFloat(row.amount),
          direction: row.direction,
          date: `${row.date}T12:00:00.000Z`,
          splits: [{ amount: parseFloat(row.amount), category: row.category, description: row.description, divisionId: row.divisionId || undefined }],
          divisionId: row.divisionId || undefined,
        }).then(() => row.id)
      )
    );

    const succeededIds = new Set();
    const failures = {};
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        succeededIds.add(toSubmit[i].id);
      } else {
        failures[toSubmit[i].id] = result.reason?.message || "Couldn't save this row.";
      }
    });

    setRows((r) => {
      const remaining = r.filter((row) => !succeededIds.has(row.id)).map((row) =>
        failures[row.id] ? { ...row, status: "error", error: failures[row.id] } : { ...row, status: null }
      );
      return remaining.length > 0 ? remaining : [blankRow()];
    });
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Add multiple transactions" />
      <div className="max-w-2xl mx-auto px-5 pt-4">
        <PageBlurb>Enter several transactions at once, across any of your accounts, then submit them all together.</PageBlurb>

        {rows.map((row, i) => (
          <div key={row.id} className="rounded-2xl p-4 mb-3" style={{ background: colors.surface, border: `1px solid ${row.status === "error" ? colors.alert : colors.border}` }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Row {i + 1}</span>
              <div className="flex items-center gap-2">
                {row.status === "sending" && <span className="text-xs" style={{ color: colors.textMuted }}>Saving…</span>}
                <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove row" style={{ color: colors.textMuted }}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {row.error && (
              <p className="text-xs mb-3 flex items-center gap-1.5" style={{ color: colors.alert }}>
                <AlertTriangle size={13} /> {row.error}
              </p>
            )}

            <div className="flex gap-1.5 mb-3">
              {[{ key: "debit", label: "Expense", activeColor: colors.alert }, { key: "credit", label: "Deposit", activeColor: colors.positive }].map((opt) => {
                const active = row.direction === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => updateRow(row.id, { ...row, direction: opt.key, category: opt.key === "credit" && row.category === "Uncategorized" ? "Deposit" : opt.key === "debit" && row.category === "Deposit" ? "Uncategorized" : row.category })}
                    className="flex-1 rounded-full py-1.5 text-xs font-medium transition-colors"
                    style={{ background: active ? opt.activeColor : "transparent", color: active ? colors.bg : colors.textMuted, border: `1px solid ${active ? opt.activeColor : colors.border}` }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>Account</label>
                <div className="relative">
                  <select
                    value={row.accountId}
                    onChange={(e) => { updateRow(row.id, { ...row, accountId: e.target.value, divisionId: "" }); ensureDivisionsLoaded(e.target.value); }}
                    className="w-full appearance-none rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                    style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option value="">Choose…</option>
                    {(accounts || []).map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>Amount</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => updateRow(row.id, { ...row, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                  style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>Date</label>
                <input
                  type="date"
                  value={row.date}
                  onChange={(e) => updateRow(row.id, { ...row, date: e.target.value })}
                  className="w-full rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                  style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: "auto", maxWidth: "100%", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>Category</label>
                {row.addingCategory ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={row.newCategory}
                      onChange={(e) => updateRow(row.id, { ...row, newCategory: e.target.value })}
                      className="flex-1 min-w-0 rounded-lg px-2 py-2 text-xs focus:outline-none"
                      style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                    />
                    <button
                      type="button"
                      disabled={!row.newCategory.trim()}
                      onClick={() => {
                        const name = row.newCategory.trim();
                        setCategoryOptions((opts) => (opts.includes(name) ? opts : [...opts, name]));
                        updateRow(row.id, { ...row, category: name, addingCategory: false, newCategory: "" });
                      }}
                      className="rounded-lg px-2 text-xs font-medium shrink-0"
                      style={{ background: colors.accent, color: colors.bg }}
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={row.category}
                      onChange={(e) => { if (e.target.value === "__new__") updateRow(row.id, { ...row, addingCategory: true }); else updateRow(row.id, { ...row, category: e.target.value }); }}
                      className="w-full appearance-none rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                      style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                    >
                      {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__new__">+ Add new…</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                  </div>
                )}
              </div>
            </div>

            {row.accountId && (divisionsByAccount[row.accountId] || []).length > 0 && (
              <div className="mb-2">
                <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>Division <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
                <div className="relative">
                  <select
                    value={row.divisionId}
                    onChange={(e) => updateRow(row.id, { ...row, divisionId: e.target.value })}
                    className="w-full appearance-none rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                    style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option value="">Whole account, no specific division</option>
                    {divisionsByAccount[row.accountId].map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
              </div>
            )}

            <input
              type="text"
              value={row.description}
              onChange={(e) => updateRow(row.id, { ...row, description: e.target.value.slice(0, 250) })}
              placeholder="Description (optional)"
              className="w-full rounded-lg px-2.5 py-2 text-xs focus:outline-none"
              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={addRow}
          className="w-full rounded-2xl py-3 mb-5 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
          style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
        >
          <Plus size={16} />
          Add another row
        </button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-5 py-4 z-30" style={{ background: colors.surface, borderTop: `1px solid ${colors.border}` }}>
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={handleSubmitAll}
            disabled={!canSubmit}
            className="w-full rounded-xl py-3 text-sm font-medium transition-opacity"
            style={{ background: canSubmit ? colors.accent : colors.surfaceRaised, color: canSubmit ? colors.bg : colors.textMuted }}
          >
            {submitting ? "Saving…" : `Submit ${readyRows.length || ""} transaction${readyRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
