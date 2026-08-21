import React, { useEffect, useState } from "react";
import { Plus, Trash2, ChevronDown, Check, AlertTriangle, SplitSquareHorizontal } from "lucide-react";
import { accountsApi, divisionsApi, transactionsApi, recurringApi } from "../lib/apiClient";
import { colors, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useIsDesktop } from "../lib/useIsDesktop";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";
import { useCustomCategories } from "../lib/useCustomCategories";

const CATEGORIES = ["Uncategorized", "Deposit", "Groceries", "Household", "Dining", "Transportation", "Utilities", "Entertainment", "Health", "Rent/Mortgage"];

// Simplified subset of ManageRecurring.jsx's own FREQUENCIES - "custom"
// (interval count/unit) and "monthly_weekday" (nth-weekday-of-month) each
// need extra sub-fields that don't fit a compact row here, same boundary
// CSV import/export already draws for the same reason. Anyone needing
// those uses the full Recurring form.
const FREQUENCIES = [
  { key: "weekly", label: "Weekly" },
  { key: "biweekly", label: "Every 2 weeks" },
  { key: "semimonthly", label: "Twice a month" },
  { key: "monthly", label: "Monthly" },
  { key: "annual", label: "Annually" },
];

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
    splits: [], // additional category splits beyond the primary category/amount above - not used when recurring is checked
    showSplits: false,
    recurring: false,
    frequency: "monthly",
    status: null, // null | "sending" | "sent" | "error"
    error: null,
  };
}

// Matches AddExpense.jsx's exact contract: splits (including the unsplit
// remainder under the row's primary category) must sum to the row's total -
// see lambda/transactions/index.py _add_expense. The remainder omits its
// own divisionId (the top-level divisionId is the primary/default), same
// as AddExpense. Only relevant for one-time (non-recurring) rows.
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

// A row is ready to submit under different rules depending on its kind:
// one-time rows just need an account/amount and can't be over-allocated;
// recurring rows also need a description (matches ManageRecurring.jsx's
// own canSave rule) and, for expenses, a category.
function isRowReady(r) {
  if (!r.accountId || r.total <= 0) return false;
  if (r.recurring) return !!r.description.trim() && (r.direction === "credit" || !!r.category);
  return !r.overAllocated;
}

// Shared split-editing block, used inside both the desktop table's
// expandable sub-row and the mobile card - same content, different
// container around it. Never shown for a recurring row - recurring
// templates have no split-contribution concept in the data model.
function SplitEditor({ row, updateRow, categoryOptions, setCategoryOptions, addCustomCategory, divisions }) {
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
                    addCustomCategory(name);
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

// The Category/Division/Description/Frequency/Split "detail" fields for
// one entry - shared between the desktop table's second row and the
// mobile card, same content laid out differently by the caller.
function DetailFields({ row, updateRow, categoryOptions, setCategoryOptions, addCustomCategory, divisions, compact, hideFrequency }) {
  const showCategory = !row.recurring || row.direction === "debit"; // recurring income has no category concept at all
  const inputStyle = { background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text };
  const w = compact ? "" : "w-full";

  // Desktop's compact mini-row leans on the shared header-row labels above
  // the whole table; the mobile card has no such shared header, so each
  // field gets its own label there, matching every other field on the card.
  function Field({ label, children }) {
    if (compact) return children;
    return (
      <div className="w-full mb-2">
        <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>{label}</label>
        {children}
      </div>
    );
  }

  return (
    <>
      {showCategory && (
        <Field label="Category">
          {row.addingCategory ? (
            <div className={`flex gap-1 ${compact ? "" : "flex-1 min-w-0"}`}>
              <input
                autoFocus
                value={row.newCategory}
                onChange={(e) => updateRow(row.id, { ...row, newCategory: e.target.value })}
                placeholder="New category"
                className={`${compact ? "w-24" : "flex-1 min-w-0"} rounded-lg px-2 py-1.5 text-xs focus:outline-none`}
                style={inputStyle}
              />
              <button
                type="button"
                disabled={!row.newCategory.trim()}
                onClick={() => {
                  const name = row.newCategory.trim();
                  setCategoryOptions((opts) => (opts.includes(name) ? opts : [...opts, name]));
                  addCustomCategory(name);
                  updateRow(row.id, { ...row, category: name, addingCategory: false, newCategory: "" });
                }}
                className="rounded-lg px-2 text-xs font-medium shrink-0"
                style={{ background: colors.accent, color: colors.bg }}
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <select
              value={row.category}
              onChange={(e) => { if (e.target.value === "__new__") updateRow(row.id, { ...row, addingCategory: true }); else updateRow(row.id, { ...row, category: e.target.value }); }}
              className={`${w} appearance-none rounded-lg px-2 py-1.5 text-xs focus:outline-none`}
              style={{ ...inputStyle, maxWidth: compact ? 130 : undefined }}
            >
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__new__">+ Add new…</option>
            </select>
          )}
        </Field>
      )}

      {divisions.length > 0 && (
        <Field label="Division">
          <select
            value={row.divisionId}
            onChange={(e) => updateRow(row.id, { ...row, divisionId: e.target.value })}
            className={`${w} appearance-none rounded-lg px-2 py-1.5 text-xs focus:outline-none`}
            style={{ ...inputStyle, maxWidth: compact ? 130 : undefined }}
          >
            <option value="">{compact ? "No division" : "Whole account, no specific division"}</option>
            {divisions.map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Description">
        <input
          type="text"
          value={row.description}
          onChange={(e) => updateRow(row.id, { ...row, description: e.target.value.slice(0, 250) })}
          placeholder="Description (optional)"
          className={`${w} rounded-lg px-2 py-1.5 text-xs focus:outline-none`}
          style={{ ...inputStyle, width: compact ? 140 : undefined }}
        />
      </Field>

      {!hideFrequency && (
        <select
          value={row.frequency}
          disabled={!row.recurring}
          onChange={(e) => updateRow(row.id, { ...row, frequency: e.target.value })}
          className={`${w} appearance-none rounded-lg px-2 py-1.5 text-xs focus:outline-none`}
          style={{ ...inputStyle, opacity: row.recurring ? 1 : 0.4, maxWidth: compact ? 130 : undefined }}
        >
          {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      )}

      {!row.recurring && (
        row.showSplits ? (
          <SplitEditor row={row} updateRow={updateRow} categoryOptions={categoryOptions} setCategoryOptions={setCategoryOptions} addCustomCategory={addCustomCategory} divisions={divisions} />
        ) : (
          <button
            type="button"
            onClick={() => updateRow(row.id, { ...row, showSplits: true })}
            aria-label="Split into categories"
            className={compact ? "p-1.5 rounded-lg" : "rounded-lg py-1.5 px-3 text-xs font-medium flex items-center justify-center gap-1.5"}
            style={{ color: row.splits.length > 0 ? colors.accentLight : colors.textMuted, border: compact ? "none" : `1px dashed ${colors.borderStrong}` }}
          >
            <SplitSquareHorizontal size={compact ? 15 : 13} />
            {!compact && "Split into categories"}
          </button>
        )
      )}
    </>
  );
}

export default function MassAddTransactionsPage() {
  const isDesktop = useIsDesktop();
  const [accounts, setAccounts] = useState(null);
  const [divisionsByAccount, setDivisionsByAccount] = useState({});
  const [categoryOptions, setCategoryOptions] = useState(CATEGORIES);
  const { customCategories, addCustomCategory } = useCustomCategories();
  useEffect(() => {
    if (customCategories.length === 0) return;
    setCategoryOptions((opts) => [...new Set([...opts, ...customCategories])]);
  }, [customCategories]);
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
  const readyRows = rowsWithInfo.filter(isRowReady);
  const canSubmit = readyRows.length > 0 && !submitting;

  async function handleSubmitAll() {
    if (!canSubmit) return;
    setSubmitting(true);

    const toSubmit = readyRows;
    setRows((r) => r.map((row) => (toSubmit.some((t) => t.id === row.id) ? { ...row, status: "sending", error: null } : row)));

    const results = await Promise.allSettled(
      toSubmit.map((row) => {
        if (row.recurring) {
          // A recurring row's external bank account isn't a visible field
          // here - it's silently inherited from the selected account's own
          // connection (see ExternalBankAccounts.jsx / AccountDetail.jsx),
          // same auto-lock rule ManageRecurring.jsx applies on its own form.
          const account = (accounts || []).find((a) => a.accountId === row.accountId);
          return recurringApi.create(row.accountId, {
            isIncome: row.direction === "credit",
            description: row.description.trim(),
            category: row.direction === "debit" ? row.category : undefined,
            estimatedAmount: row.total,
            frequency: row.frequency,
            nextDueDate: row.date,
            divisionId: row.divisionId || null,
            externalBankAccountId: account?.externalBankAccountId || null,
          }).then(() => row.id);
        }
        return transactionsApi.addExpense(row.accountId, {
          totalAmount: row.total,
          direction: row.direction,
          date: `${row.date}T12:00:00.000Z`,
          splits: finalSplitsForRow(row),
          divisionId: row.divisionId || undefined,
        }).then(() => row.id);
      })
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
          data-wizard-target="wizard-massadd-submit"
          onClick={handleSubmitAll}
          disabled={!canSubmit}
          className="w-full rounded-xl py-3 text-sm font-medium transition-opacity"
          style={{ background: canSubmit ? colors.accent : colors.surfaceRaised, color: canSubmit ? colors.bg : colors.textMuted }}
        >
          {submitting ? "Saving…" : `Submit ${readyRows.length || ""} item${readyRows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <div className="min-h-screen pb-28" style={{ background: colors.bg, fontFamily: fontBody }}>
        <PageHeader title="Add multiple" />
        <div className="max-w-5xl mx-auto px-5 pt-4">
          <PageBlurb>Enter several transactions or recurring items at once, across any of your accounts, then submit them all together.</PageBlurb>

          <div className="rounded-2xl overflow-hidden mb-3" style={{ border: `1px solid ${colors.border}` }}>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: colors.surfaceRaised }}>
                  {[
                    ["Type", "Expense or deposit."],
                    ["Recurring", "Check this to create a recurring template instead of a one-time transaction."],
                    ["Date", "The date it happened, or the next due date if Recurring is checked."],
                    ["Account", "Which of your accounts this applies to."],
                    ["Amount", "The transaction amount, or the estimated amount per occurrence if Recurring is checked."],
                    ["", null],
                  ].map(([h, info]) => (
                    <th key={h || "remove"} className="text-left px-2.5 py-2 text-xs font-medium">
                      <span className="flex items-center gap-1" style={{ color: colors.textMuted }}>
                        {h}
                        {info && <InfoBubble text={info} />}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr style={{ background: colors.surfaceRaised, borderTop: `1px solid ${colors.border}` }}>
                  <th colSpan={6} className="px-2.5 py-1.5 text-left">
                    <div className="flex items-center gap-4 flex-wrap text-xs font-medium" style={{ color: colors.textMuted }}>
                      <span className="flex items-center gap-1">Category <InfoBubble text="Hidden for recurring income - recurring templates don't have a category for income." /></span>
                      <span className="flex items-center gap-1">Division <InfoBubble text="Optional - a specific sub-allocation within the account, if it has any." /></span>
                      <span className="flex items-center gap-1">Description <InfoBubble text="A short note - required for recurring items, optional for one-time ones." /></span>
                      <span className="flex items-center gap-1">Frequency <InfoBubble text="Only used when Recurring is checked. For custom intervals or an 'nth weekday of the month' schedule, use the full Recurring page instead." /></span>
                      <span className="flex items-center gap-1">Split <InfoBubble text="Divide a one-time transaction across multiple categories. Not available for recurring items." /></span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rowsWithInfo.map((row) => {
                  const divisions = divisionsByAccount[row.accountId] || [];
                  return (
                    <React.Fragment key={row.id}>
                      <tr data-wizard-target="wizard-massadd-row" style={{ background: row.status === "error" ? `${colors.alert}11` : colors.surface, borderTop: `1px solid ${colors.border}` }}>
                        <td className="px-2.5 py-2">
                          <select
                            value={row.direction}
                            onChange={(e) => {
                              const dir = e.target.value;
                              const category = row.recurring
                                ? row.category
                                : dir === "credit" && row.category === "Uncategorized" ? "Deposit"
                                : dir === "debit" && row.category === "Deposit" ? "Uncategorized"
                                : row.category;
                              updateRow(row.id, { ...row, direction: dir, category });
                            }}
                            className="rounded-lg px-1.5 py-1.5 text-xs focus:outline-none"
                            style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                          >
                            <option value="debit">Expense</option>
                            <option value="credit">Deposit</option>
                          </select>
                        </td>
                        <td className="px-2.5 py-2" data-wizard-target="wizard-massadd-recurring">
                          <input
                            type="checkbox"
                            checked={row.recurring}
                            onChange={(e) => updateRow(row.id, { ...row, recurring: e.target.checked, showSplits: e.target.checked ? false : row.showSplits })}
                            aria-label="Recurring"
                            style={{ width: 16, height: 16 }}
                          />
                        </td>
                        <td className="px-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={row.recurring}
                            onChange={(e) => updateRow(row.id, { ...row, recurring: e.target.checked, showSplits: e.target.checked ? false : row.showSplits })}
                            aria-label="Recurring"
                            style={{ width: 16, height: 16 }}
                          />
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
                        <td className="px-1 py-2">
                          <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove row" style={{ color: colors.textMuted }} className="p-1.5">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      <tr style={{ background: row.status === "error" ? `${colors.alert}11` : colors.surface }} data-wizard-target="wizard-massadd-detail">
                        <td colSpan={6} className="px-2.5 pb-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <DetailFields row={row} updateRow={updateRow} categoryOptions={categoryOptions} setCategoryOptions={setCategoryOptions} addCustomCategory={addCustomCategory} divisions={divisions} compact />
                          </div>
                        </td>
                      </tr>
                      {row.error && (
                        <tr style={{ background: colors.surface }}>
                          <td colSpan={6} className="px-2.5 pb-2">
                            <p className="text-xs flex items-center gap-1.5" style={{ color: colors.alert }}><AlertTriangle size={12} /> {row.error}</p>
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
      <PageHeader title="Add multiple" />
      <div className="max-w-2xl mx-auto px-5 pt-4">
        <PageBlurb>Enter several transactions or recurring items at once, across any of your accounts, then submit them all together.</PageBlurb>

        {rowsWithInfo.map((row, i) => {
          const divisions = divisionsByAccount[row.accountId] || [];
          return (
            <div key={row.id} className="rounded-2xl p-4 mb-3" data-wizard-target="wizard-massadd-row" style={{ background: colors.surface, border: `1px solid ${row.status === "error" ? colors.alert : colors.border}` }}>
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

              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex gap-1.5 flex-1">
                  {[{ key: "debit", label: "Expense", activeColor: colors.alert }, { key: "credit", label: "Deposit", activeColor: colors.positive }].map((opt) => {
                    const active = row.direction === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          const category = row.recurring
                            ? row.category
                            : opt.key === "credit" && row.category === "Uncategorized" ? "Deposit"
                            : opt.key === "debit" && row.category === "Deposit" ? "Uncategorized"
                            : row.category;
                          updateRow(row.id, { ...row, direction: opt.key, category });
                        }}
                        className="flex-1 rounded-full py-1.5 text-xs font-medium transition-colors"
                        style={{ background: active ? opt.activeColor : "transparent", color: active ? colors.bg : colors.textMuted, border: `1px solid ${active ? opt.activeColor : colors.border}` }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-center gap-1.5 text-xs shrink-0" data-wizard-target="wizard-massadd-recurring" style={{ color: colors.textMuted }}>
                  <input
                    type="checkbox"
                    checked={row.recurring}
                    onChange={(e) => updateRow(row.id, { ...row, recurring: e.target.checked, showSplits: e.target.checked ? false : row.showSplits })}
                  />
                  Recurring
                </label>
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
                  <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>{row.recurring ? "Estimated amount" : "Amount"}</label>
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
                  <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>{row.recurring ? "Next due date" : "Date"}</label>
                  <input
                    type="date"
                    value={row.date}
                    onChange={(e) => updateRow(row.id, { ...row, date: e.target.value })}
                    className="w-full rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                    style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: "auto", maxWidth: "100%", boxSizing: "border-box" }}
                  />
                </div>
                {row.recurring && (
                  <div>
                    <label className="text-xs block mb-1" style={{ color: colors.textMuted }}>Frequency</label>
                    <div className="relative">
                      <select
                        value={row.frequency}
                        onChange={(e) => updateRow(row.id, { ...row, frequency: e.target.value })}
                        className="w-full appearance-none rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                        style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
                      >
                        {FREQUENCIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-2" data-wizard-target="wizard-massadd-detail">
                <DetailFields row={row} updateRow={updateRow} categoryOptions={categoryOptions} setCategoryOptions={setCategoryOptions} addCustomCategory={addCustomCategory} divisions={divisions} hideFrequency />
              </div>
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
