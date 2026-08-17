import React, { useEffect, useState } from "react";
import { Plus, Trash2, ChevronDown, Check, AlertTriangle, SplitSquareHorizontal } from "lucide-react";
import { accountsApi, divisionsApi, transactionsApi } from "../lib/apiClient";
import { colors, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useIsDesktop } from "../lib/useIsDesktop";
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
    splits: [], // additional category splits beyond the primary category/amount above
    showSplits: false,
    status: null, // null | "sending" | "sent" | "error"
    error: null,
  };
}

// Matches AddExpense.jsx's exact contract: splits (including the unsplit
// remainder under the row's primary category) must sum to the row's total -
// see lambda/transactions/index.py _add_expense. The remainder omits its
// own divisionId (the top-level divisionId is the primary/default), same
// as AddExpense.
function finalSplitsForRow(row) {
  const total = parseFloat(row.amount) || 0;
  const splitSum = row.splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const remaining = total - splitSum;
  return [
    ...(remaining > 0.001 ? [{ amount: remaining, category: row.category, description: row.description }] : []),
    ...row.splits.filter((s) => parseFloat(s.amount) > 0).map((s) => ({ amount: parseFloat(s.amount), category: s.category, description: s.description, divisionId: s.divisionId || undefined })),
  ];
}

function rowSplitInfo(row) {
  const total = parseFloat(row.amount) || 0;
  const splitSum = row.splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  const remaining = total - splitSum;
  return { total, splitSum, remaining, overAllocated: remaining < -0.001 };
}

// Shared split-editing block, used inside both the desktop table's
// expandable sub-row and the mobile card - same content, different
// container around it.
function SplitEditor({ row, updateRow, categoryOptions, setCategoryOptions, divisions }) {
  const { remaining, overAllocated } = rowSplitInfo(row);

  function addSplit() {
    updateRow(row.id, { ...row, splits: [...row.splits, { id: uid(), amount: "", category: "Uncategorized", description: "", divisionId: "" }] });
  }
  function updateSplit(splitId, next) {
    updateRow(row.id, { ...row, splits: row.splits.map((s) => (s.id === splitId ? next : s)) });
  }
  function removeSplit(splitId) {
    updateRow(row.id, { ...row, splits: row.splits.filter((s) => s.id !== splitId) });
  }

  return (
    <div className="rounded-xl p-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
      {row.splits.length > 0 && row.amount > 0 && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs" style={{ color: colors.textMuted }}>{overAllocated ? "Over-allocated by" : "Remaining from total"}</span>
          <span style={{ fontFamily: fontMono, fontSize: 13, color: overAllocated ? colors.alert : colors.positive }}>{formatMoney(Math.abs(remaining))}</span>
        </div>
      )}
      {row.splits.map((s) => (
        <div key={s.id} className="rounded-lg p-2.5 mb-2" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
          <div className="flex items-start gap-1.5 mb-1.5">
            <input
              type="number"
              inputMode="decimal"
              value={s.amount}
              onChange={(e) => updateSplit(s.id, { ...s, amount: e.target.value })}
              placeholder="0.00"
              className="w-24 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
            />
            {s.addingCategory ? (
              <div className="flex gap-1 flex-1 min-w-0">
                <input
                  autoFocus
                  value={s.newCategory || ""}
                  onChange={(e) => updateSplit(s.id, { ...s, newCategory: e.target.value })}
                  placeholder="New category"
                  className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                  style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                />
                <button
                  type="button"
                  disabled={!(s.newCategory || "").trim()}
                  onClick={() => {
                    const name = (s.newCategory || "").trim();
                    setCategoryOptions((opts) => (opts.includes(name) ? opts : [...opts, name]));
                    updateSplit(s.id, { ...s, category: name, addingCategory: false, newCategory: "" });
                  }}
                  className="rounded-lg px-2 text-xs font-medium shrink-0"
                  style={{ background: colors.accent, color: colors.bg }}
                >
                  <Check size={12} />
                </button>
              </div>
            ) : (
              <select
                value={s.category}
                onChange={(e) => { if (e.target.value === "__new__") updateSplit(s.id, { ...s, addingCategory: true }); else updateSplit(s.id, { ...s, category: e.target.value }); }}
                className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">+ Add new…</option>
              </select>
            )}
            <button type="button" onClick={() => removeSplit(s.id)} aria-label="Remove split" className="p-1.5 shrink-0" style={{ color: colors.alert }}>
              <Trash2 size={13} />
            </button>
          </div>
          <input
            type="text"
            value={s.description}
            onChange={(e) => updateSplit(s.id, { ...s, description: e.target.value.slice(0, 250) })}
            placeholder="Description (optional)"
            className="w-full rounded-lg px-2 py-1.5 text-xs focus:outline-none mb-1.5"
            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
          />
          {row.direction === "credit" && divisions.length > 0 && (
            <select
              value={s.divisionId || ""}
              onChange={(e) => updateSplit(s.id, { ...s, divisionId: e.target.value })}
              className="w-full appearance-none rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
            >
              <option value="">This split's division (optional)</option>
              {divisions.map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
            </select>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={addSplit}
        className="w-full rounded-lg py-1.5 text-xs font-medium flex items-center justify-center gap-1.5"
        style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
      >
        <Plus size={13} />
        Add category split
      </button>
    </div>
  );
}

export default function MassAddTransactionsPage() {
  const isDesktop = useIsDesktop();
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

  const rowsWithInfo = rows.map((r) => ({ ...r, ...rowSplitInfo(r) }));
  const readyRows = rowsWithInfo.filter((r) => r.accountId && r.total > 0 && !r.overAllocated);
  const canSubmit = readyRows.length > 0 && !submitting;

  async function handleSubmitAll() {
    if (!canSubmit) return;
    setSubmitting(true);

    const toSubmit = readyRows;
    setRows((r) => r.map((row) => (toSubmit.some((t) => t.id === row.id) ? { ...row, status: "sending", error: null } : row)));

    const results = await Promise.allSettled(
      toSubmit.map((row) =>
        transactionsApi.addExpense(row.accountId, {
          totalAmount: row.total,
          direction: row.direction,
          date: `${row.date}T12:00:00.000Z`,
          splits: finalSplitsForRow(row),
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

  const submitBar = (
    <div className="fixed bottom-0 left-0 right-0 px-5 py-4 z-30" style={{ background: colors.surface, borderTop: `1px solid ${colors.border}` }}>
      <div className="max-w-4xl mx-auto">
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
  );

  if (isDesktop) {
    return (
      <div className="min-h-screen pb-28" style={{ background: colors.bg, fontFamily: fontBody }}>
        <PageHeader title="Add multiple transactions" />
        <div className="max-w-5xl mx-auto px-5 pt-4">
          <PageBlurb>Enter several transactions at once, across any of your accounts, then submit them all together.</PageBlurb>

          <div className="rounded-2xl overflow-hidden mb-3" style={{ border: `1px solid ${colors.border}` }}>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: colors.surfaceRaised }}>
                  {["Type", "Date", "Account", "Amount", "Category", "Division", "Description", "", ""].map((h) => (
                    <th key={h} className="text-left px-2.5 py-2 text-xs font-medium" style={{ color: colors.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsWithInfo.map((row) => {
                  const divisions = divisionsByAccount[row.accountId] || [];
                  return (
                    <React.Fragment key={row.id}>
                      <tr style={{ background: row.status === "error" ? `${colors.alert}11` : colors.surface, borderTop: `1px solid ${colors.border}` }}>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.direction}
                            onChange={(e) => updateRow(row.id, { ...row, direction: e.target.value, category: e.target.value === "credit" && row.category === "Uncategorized" ? "Deposit" : e.target.value === "debit" && row.category === "Deposit" ? "Uncategorized" : row.category })}
                            className="rounded-lg px-1.5 py-1.5 text-xs focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                          >
                            <option value="debit">Expense</option>
                            <option value="credit">Deposit</option>
                          </select>
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="date"
                            value={row.date}
                            onChange={(e) => updateRow(row.id, { ...row, date: e.target.value })}
                            className="rounded-lg px-1.5 py-1.5 text-xs focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, maxWidth: 130, boxSizing: "border-box" }}
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.accountId}
                            onChange={(e) => { updateRow(row.id, { ...row, accountId: e.target.value, divisionId: "" }); ensureDivisionsLoaded(e.target.value); }}
                            className="rounded-lg px-1.5 py-1.5 text-xs focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, maxWidth: 140 }}
                          >
                            <option value="">Choose…</option>
                            {(accounts || []).map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={row.amount}
                            onChange={(e) => updateRow(row.id, { ...row, amount: e.target.value })}
                            placeholder="0.00"
                            className="rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono, width: 90 }}
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          {row.addingCategory ? (
                            <div className="flex gap-1">
                              <input
                                autoFocus
                                value={row.newCategory}
                                onChange={(e) => updateRow(row.id, { ...row, newCategory: e.target.value })}
                                className="w-24 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
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
                                className="rounded-lg px-2 text-xs font-medium"
                                style={{ background: colors.accent, color: colors.bg }}
                              >
                                <Check size={12} />
                              </button>
                            </div>
                          ) : (
                            <select
                              value={row.category}
                              onChange={(e) => { if (e.target.value === "__new__") updateRow(row.id, { ...row, addingCategory: true }); else updateRow(row.id, { ...row, category: e.target.value }); }}
                              className="rounded-lg px-1.5 py-1.5 text-xs focus:outline-none"
                              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, maxWidth: 130 }}
                            >
                              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                              <option value="__new__">+ Add new…</option>
                            </select>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          {divisions.length > 0 ? (
                            <select
                              value={row.divisionId}
                              onChange={(e) => updateRow(row.id, { ...row, divisionId: e.target.value })}
                              className="rounded-lg px-1.5 py-1.5 text-xs focus:outline-none"
                              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, maxWidth: 130 }}
                            >
                              <option value="">None</option>
                              {divisions.map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
                            </select>
                          ) : (
                            <span className="text-xs" style={{ color: colors.textMuted }}>—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) => updateRow(row.id, { ...row, description: e.target.value.slice(0, 250) })}
                            placeholder="Optional"
                            className="rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, width: 140 }}
                          />
                        </td>
                        <td className="px-1 py-2">
                          <button
                            type="button"
                            onClick={() => updateRow(row.id, { ...row, showSplits: !row.showSplits })}
                            aria-label="Split into categories"
                            className="p-1.5 rounded-lg"
                            style={{ color: row.splits.length > 0 ? colors.accentLight : colors.textMuted, background: row.showSplits ? colors.surfaceRaised : "transparent" }}
                          >
                            <SplitSquareHorizontal size={15} />
                          </button>
                        </td>
                        <td className="px-1 py-2">
                          <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove row" style={{ color: colors.textMuted }} className="p-1.5">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {row.error && (
                        <tr style={{ background: colors.surface }}>
                          <td colSpan={9} className="px-2.5 pb-2">
                            <p className="text-xs flex items-center gap-1.5" style={{ color: colors.alert }}><AlertTriangle size={12} /> {row.error}</p>
                          </td>
                        </tr>
                      )}
                      {row.showSplits && (
                        <tr style={{ background: colors.surface }}>
                          <td colSpan={9} className="px-2.5 pb-3">
                            <SplitEditor row={row} updateRow={updateRow} categoryOptions={categoryOptions} setCategoryOptions={setCategoryOptions} divisions={divisions} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

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
        {submitBar}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Add multiple transactions" />
      <div className="max-w-2xl mx-auto px-5 pt-4">
        <PageBlurb>Enter several transactions at once, across any of your accounts, then submit them all together.</PageBlurb>

        {rowsWithInfo.map((row, i) => {
          const divisions = divisionsByAccount[row.accountId] || [];
          return (
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

              {row.accountId && divisions.length > 0 && (
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
                      {divisions.map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
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
                className="w-full rounded-lg px-2.5 py-2 text-xs focus:outline-none mb-2"
                style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
              />

              {row.showSplits ? (
                <SplitEditor row={row} updateRow={updateRow} categoryOptions={categoryOptions} setCategoryOptions={setCategoryOptions} divisions={divisions} />
              ) : (
                <button
                  type="button"
                  onClick={() => updateRow(row.id, { ...row, showSplits: true })}
                  className="w-full rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5"
                  style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
                >
                  <Plus size={13} />
                  Add category split
                </button>
              )}
            </div>
          );
        })}

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
      {submitBar}
    </div>
  );
}
