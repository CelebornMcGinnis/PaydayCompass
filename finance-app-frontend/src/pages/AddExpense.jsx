import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { accountsApi, transactionsApi, divisionsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import DivisionSelect from "../components/DivisionSelect";
import { useCustomCategories } from "../lib/useCustomCategories";
import { useTheme } from "../lib/ThemeContext";

const CATEGORIES = ["Uncategorized", "Deposit", "Groceries", "Household", "Dining", "Transportation", "Utilities", "Entertainment", "Health", "Rent/Mortgage"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function AddExpensePage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [searchParams] = useSearchParams();
  const presetAccountId = searchParams.get("accountId");

  const [accounts, setAccounts] = useState(null);
  const [accountId, setAccountId] = useState(presetAccountId || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [divisionId, setDivisionId] = useState("");
  const [divisions, setDivisions] = useState([]);

  useEffect(() => {
    if (!accountId) {
      setDivisions([]);
      return;
    }
    let cancelled = false;
    divisionsApi
      .list(accountId)
      .then((list) => {
        if (cancelled) return;
        setDivisions(list);
        setDivisionId((current) => (current && !list.some((d) => d.divisionId === current) ? "" : current));
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  const [totalAmount, setTotalAmount] = useState("");
  const [direction, setDirection] = useState("debit"); // "debit" = expense, "credit" = deposit
  const [categoryOptions, setCategoryOptions] = useState(CATEGORIES);
  const { customCategories, addCustomCategory } = useCustomCategories();
  useEffect(() => {
    if (customCategories.length === 0) return;
    setCategoryOptions((opts) => [...new Set([...opts, ...customCategories])]);
  }, [customCategories]);
  const [primaryCategory, setPrimaryCategory] = useState("Uncategorized");
  const [addingPrimaryCategory, setAddingPrimaryCategory] = useState(false);
  const [newPrimaryCategory, setNewPrimaryCategory] = useState("");
  const [description, setDescription] = useState("");
  const [splits, setSplits] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    accountsApi.list().then((data) => {
      setAccounts(data);
      if (!accountId && data.length > 0) setAccountId(data[0].accountId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = parseFloat(totalAmount) || 0;
  const splitSum = useMemo(() => splits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0), [splits]);
  const remaining = total - splitSum;
  const overAllocated = remaining < -0.001;

  function addSplit() {
    setSplits((s) => [...s, { id: uid(), amount: "", category: "Uncategorized", description: "" }]);
  }
  function updateSplit(id, next) {
    setSplits((s) => s.map((sp) => (sp.id === id ? next : sp)));
  }
  function removeSplit(id) {
    setSplits((s) => s.filter((sp) => sp.id !== id));
  }

  async function handleSave(andAddAnother) {
    if (total <= 0 || overAllocated || !accountId) return;
    setSaving(true);
    setError(null);

    // Matches the backend contract exactly: splits (including the
    // unsplit remainder under primaryCategory) must sum to totalAmount -
    // see lambda/transactions/index.py _add_expense. The backend only
    // ever reads description PER split, never a top-level one - the
    // primary description applies to the remainder split specifically.
    const finalSplits = [
      ...(remaining > 0.001 ? [{ amount: remaining, category: primaryCategory, description }] : []),
      ...splits.filter((s) => parseFloat(s.amount) > 0).map((s) => ({ amount: parseFloat(s.amount), category: s.category, description: s.description, divisionId: s.divisionId })),
    ];

    try {
      await transactionsApi.addExpense(accountId, {
        totalAmount: total,
        direction,
        date,
        splits: finalSplits,
        divisionId: divisionId || undefined,
      });
      if (andAddAnother) {
        // Keep the account, direction (expense/deposit), and date - the
        // most common case is entering several similar items in a row
        // (often several receipts from the same day) - reset everything
        // else for a genuinely fresh entry.
        setTotalAmount("");
        setPrimaryCategory(direction === "credit" ? "Deposit" : "Uncategorized");
        setDescription("");
        setSplits([]);
        setDivisionId("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        navigate(`/accounts/${accountId}`);
      }
    } catch (err) {
      setError(err.message || "Couldn't save this expense - try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title={direction === "credit" ? "Add deposit" : "Add expense"} />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>
          {direction === "credit"
            ? "Log money coming into one of your accounts — a paycheck outside your normal schedule, a gift, a refund, anything that isn't already tracked as recurring income."
            : "Log a purchase against one of your accounts — split it across multiple categories if it covers more than one kind of expense."}
        </PageBlurb>

        <div className="flex gap-1.5 mb-5">
          {[{ key: "debit", label: "Expense", activeColor: colors.alert }, { key: "credit", label: "Deposit", activeColor: colors.positive }].map((opt) => {
            const active = direction === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setDirection(opt.key);
                  if (opt.key === "credit" && primaryCategory === "Uncategorized") setPrimaryCategory("Deposit");
                  if (opt.key === "debit" && primaryCategory === "Deposit") setPrimaryCategory("Uncategorized");
                }}
                className="flex-1 rounded-full py-2 text-sm font-medium transition-colors"
                style={{ background: active ? opt.activeColor : "transparent", color: active ? colors.bg : colors.textMuted, border: `1px solid ${active ? opt.activeColor : colors.border}` }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {accounts === null ? (
          <p className="text-sm" style={{ color: colors.textMuted }}>Loading your accounts…</p>
        ) : (
          <>
            <div className="mb-5">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Account</label>
              <div className="relative">
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
              </div>
            </div>

            <div className="mb-5">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }}
              />
            </div>

            {accountId && (
              <div className="mb-5">
                <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
                  {direction === "credit" && splits.length > 0 ? "Primary division" : "Division"} <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span>
                </label>
                <DivisionSelect
                  accountId={accountId}
                  divisions={divisions}
                  value={divisionId}
                  onChange={setDivisionId}
                  onDivisionCreated={(division) => {
                    setDivisions((current) => [...current, division]);
                    setDivisionId(division.divisionId);
                  }}
                  wholeLabel={direction === "credit" ? "Don't add to a division" : "Don't deduct from a division"}
                  compact={false}
                />
              </div>
            )}

            <div className="rounded-2xl p-5 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <label className="text-xs uppercase tracking-wide block mb-2" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Total amount</label>
              <div className="relative mb-4">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-2xl" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="w-full pl-6 py-1 text-3xl bg-transparent focus:outline-none"
                  style={{ color: colors.text, fontFamily: fontMono, border: "none" }}
                />
              </div>
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Category</label>
              {addingPrimaryCategory ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newPrimaryCategory}
                    onChange={(e) => setNewPrimaryCategory(e.target.value)}
                    placeholder="New category name"
                    className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  />
                  <button
                    type="button"
                    disabled={!newPrimaryCategory.trim()}
                    onClick={() => {
                      const name = newPrimaryCategory.trim();
                      setCategoryOptions((opts) => (opts.includes(name) ? opts : [...opts, name]));
                      addCustomCategory(name);
                      setPrimaryCategory(name);
                      setAddingPrimaryCategory(false);
                      setNewPrimaryCategory("");
                    }}
                    className="rounded-lg px-3 text-xs font-medium"
                    style={{ background: colors.accent, color: colors.bg }}
                  >
                    Add
                  </button>
                  <button type="button" onClick={() => { setAddingPrimaryCategory(false); setNewPrimaryCategory(""); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={primaryCategory}
                    onChange={(e) => { if (e.target.value === "__new__") setAddingPrimaryCategory(true); else setPrimaryCategory(e.target.value); }}
                    className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="__new__">+ Add a new category…</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
              )}
            </div>

            <div className="mb-6">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
                Description <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 250))}
                rows={2}
                placeholder="What was this for?"
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              <p className="text-[11px] text-right mt-1" style={{ color: colors.textMuted }}>{description.length}/250</p>
            </div>

            <div className="flex items-center mb-3 px-1">
              <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }}>Split into categories</h3>
              <span className="text-xs ml-1.5" style={{ color: colors.textMuted }}>(optional)</span>
            </div>

            {splits.length > 0 && total > 0 && (
              <div className="rounded-xl px-4 py-3 mb-3" style={{ background: colors.surfaceRaised, border: `1px solid ${overAllocated ? colors.alert : colors.border}` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: colors.textMuted }}>{overAllocated ? "Over-allocated by" : "Remaining from total"}</span>
                  <span style={{ fontFamily: fontMono, fontSize: 15, color: overAllocated ? colors.alert : colors.positive }}>
                    {formatMoney(Math.abs(remaining))}
                  </span>
                </div>
              </div>
            )}

            {splits.map((s) => (
              <div key={s.id} className="rounded-xl p-3 mb-2.5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
                <div className="flex items-start gap-2 mb-2">
                  <div className="flex-1">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={s.amount}
                      onChange={(e) => updateSplit(s.id, { ...s, amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                    />
                  </div>
                  <div className="flex-1">
                    {s.addingCategory ? (
                      <div className="flex gap-1.5">
                        <input
                          autoFocus
                          value={s.newCategory || ""}
                          onChange={(e) => updateSplit(s.id, { ...s, newCategory: e.target.value })}
                          placeholder="New category"
                          className="flex-1 rounded-lg px-2 py-2 text-sm focus:outline-none"
                          style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
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
                          Add
                        </button>
                      </div>
                    ) : (
                      <select
                        value={s.category}
                        onChange={(e) => { if (e.target.value === "__new__") updateSplit(s.id, { ...s, addingCategory: true }); else updateSplit(s.id, { ...s, category: e.target.value }); }}
                        className="w-full rounded-lg px-2.5 py-2 text-sm focus:outline-none"
                        style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                      >
                        {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="__new__">+ Add a new category…</option>
                      </select>
                    )}
                  </div>
                  <button type="button" onClick={() => removeSplit(s.id)} aria-label="Remove split" className="mt-1 p-2 rounded-lg shrink-0" style={{ color: colors.alert }}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <input
                  type="text"
                  value={s.description}
                  onChange={(e) => updateSplit(s.id, { ...s, description: e.target.value.slice(0, 250) })}
                  placeholder="Description for this split (optional)"
                  className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                />
                {direction === "credit" && accountId && (
                  <DivisionSelect
                    accountId={accountId}
                    divisions={divisions}
                    value={s.divisionId || ""}
                    onChange={(divisionId) => updateSplit(s.id, { ...s, divisionId: divisionId || undefined })}
                    onDivisionCreated={(division) => {
                      setDivisions((current) => [...current, division]);
                      updateSplit(s.id, { ...s, divisionId: division.divisionId });
                    }}
                    wholeLabel="This split's division (optional)"
                  />
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addSplit}
              className="w-full rounded-xl py-2.5 mb-5 text-sm font-medium flex items-center justify-center gap-2"
              style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
            >
              <Plus size={15} />
              Add category split
            </button>

            {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}
          </>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-5 py-4 z-30" style={{ background: colors.surface, borderTop: `1px solid ${colors.border}` }}>
        <div className="max-w-md mx-auto">
          {saved && <p className="text-xs text-center mb-1.5" style={{ color: colors.positive }}>Saved — add another below.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={total <= 0 || overAllocated || saving || !accountId}
              className="flex-1 rounded-xl py-3 text-sm font-medium transition-opacity"
              style={{
                background: total <= 0 || overAllocated || !accountId ? colors.surfaceRaised : direction === "credit" ? colors.accent : colors.alert,
                color: total <= 0 || overAllocated || !accountId ? colors.textMuted : colors.bg,
                cursor: total <= 0 || overAllocated ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Submitting…" : direction === "credit" ? "Submit deposit" : "Submit expense"}
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={total <= 0 || overAllocated || saving || !accountId}
              className="flex-1 rounded-xl py-3 text-sm font-medium transition-opacity"
              style={{
                background: "transparent",
                border: `1px solid ${total <= 0 || overAllocated || !accountId ? colors.border : colors.accent}`,
                color: total <= 0 || overAllocated || !accountId ? colors.textMuted : colors.accentLight,
                cursor: total <= 0 || overAllocated ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              Save &amp; add another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
