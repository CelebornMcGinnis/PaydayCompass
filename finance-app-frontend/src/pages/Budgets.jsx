import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, ChevronDown, X, AlertTriangle, Bell, BellOff } from "lucide-react";
import { budgetsApi, projectionsApi, accountsApi, divisionsApi } from "../lib/apiClient";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import InfoBubble from "../components/InfoBubble";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useCustomCategories } from "../lib/useCustomCategories";


const BASE_CATEGORY_OPTIONS = ["Groceries", "Dining", "Utilities", "Transportation", "Household", "Entertainment", "Health", "Rent/Mortgage"];
const FREQUENCY_OPTIONS = [
  { key: "monthly", label: "Monthly" },
  { key: "biweekly", label: "Biweekly" },
  { key: "weekly", label: "Weekly" },
];
const FREQUENCY_SUFFIX = { monthly: "mo", biweekly: "2wk", weekly: "wk" };

function BudgetCard({ budget, onClick }) {
  if (budget.isUpcoming) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-2xl p-4 mb-3 relative overflow-hidden"
        style={{ background: colors.surface, border: `1px dashed ${colors.borderStrong}` }}
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: colors.text }}>{budget.category}</span>
          <span className="text-xs" style={{ fontFamily: fontMono, color: colors.textMuted }}>{formatMoney(budget.amount)}/{FREQUENCY_SUFFIX[budget.frequency || "monthly"]}</span>
        </div>
        <p className="text-xs mt-1" style={{ color: colors.accentLight }}>Starts {budget.effectiveStartDate}</p>
      </button>
    );
  }

  const spent = budget.spentAmount || 0;
  const percent = (spent / budget.amount) * 100;
  const over = percent >= 100;
  const near = percent >= 80 && percent < 100;
  const barColor = over ? colors.alert : near ? colors.warning : colors.accentLight;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl p-4 mb-3 relative overflow-hidden"
      style={{ background: colors.surface, border: `1px solid ${over ? colors.alert : colors.border}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium" style={{ color: colors.text }}>{budget.category}</span>
          {over && <AlertTriangle size={13} style={{ color: colors.alert }} />}
        </div>
        <span className="text-xs" style={{ fontFamily: fontMono, color: colors.textMuted }}>
          {formatMoney(spent)} / {formatMoney(budget.amount)}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: colors.surfaceRaised }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(percent, 100)}%`, background: barColor }} />
      </div>
      <span className="text-xs" style={{ color: over ? colors.alert : near ? colors.warning : colors.textMuted, fontFamily: fontMono }}>
        {over ? `${(percent - 100).toFixed(0)}% over budget` : `${percent.toFixed(0)}% used`}
      </span>
    </button>
  );
}

function NewBudgetForm({ initial, accounts, onAccountAdded, onCancel, onSave, onDelete, saving }) {
  const { theme } = useTheme();
  const isEditing = !!initial;
  const [category, setCategory] = useState(initial?.category ?? BASE_CATEGORY_OPTIONS[0]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const [categoryOptions, setCategoryOptions] = useState(BASE_CATEGORY_OPTIONS);
  const { customCategories, addCustomCategory } = useCustomCategories();
  useEffect(() => {
    if (customCategories.length === 0) return;
    setCategoryOptions((opts) => [...new Set([...opts, ...customCategories])]);
  }, [customCategories]);
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "monthly");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [accountsList, setAccountsList] = useState(accounts);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState(null);
  const [divisionId, setDivisionId] = useState(initial?.divisionId ?? "");
  const [addingDivision, setAddingDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState("");
  const [savingDivision, setSavingDivision] = useState(false);
  const [divisions, setDivisions] = useState([]);
  const [alertsEnabled, setAlertsEnabled] = useState(initial?.alertsEnabled ?? true);

  // Divisions are scoped to whichever account is currently selected -
  // refetch whenever that changes, and clear any division that no
  // longer belongs to the newly-selected account.
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
        if (divisionId && !list.some((d) => d.divisionId === divisionId)) {
          setDivisionId("");
        }
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);
  const [startDate, setStartDate] = useState(initial?.startDate ?? new Date().toISOString().slice(0, 10));
  const [showBackfillConfirm, setShowBackfillConfirm] = useState(false);

  const effectiveCategory = addingCategory ? customCategory.trim() : category;

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>{isEditing ? "Edit budget" : "New budget"}</span>
        <button onClick={onCancel} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
      </div>
      <div className="flex items-center mb-1.5">
        <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Category</label>
        <InfoBubble text="Budgets aggregate across every account you have — the same category is tracked together regardless of which account a purchase was made on. This also determines which transactions count toward this budget on the Dashboard and in Projections." />
      </div>
      {isEditing ? (
        <p className="text-sm mb-3 px-3 py-2.5 rounded-lg" style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.textMuted }}>
          {category} <span className="text-xs">(category can't be changed once created)</span>
        </p>
      ) : addingCategory ? (
        <div className="flex gap-2 mb-3">
          <input
            autoFocus
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            placeholder="New category name"
            className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          />
          <button onClick={() => { setAddingCategory(false); setCustomCategory(""); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
        </div>
      ) : (
        <div className="relative mb-3">
          <select
            value={category}
            onChange={(e) => {
              if (e.target.value === "__new__") { setAddingCategory(true); }
              else { setCategory(e.target.value); }
            }}
            className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          >
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">+ Add a new category…</option>
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
        </div>
      )}
      <div className="flex items-center mb-1.5">
        <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Amount</label>
        <InfoBubble text="This is what triggers your budget alerts: an email at 80% spent, when you first go over, and again on every new purchase while you're still over — if those alerts are turned on in Settings." />
      </div>
      <div className="relative mb-3">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
        <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-3 py-2.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
      </div>
      <div className="flex items-center mb-1.5">
        <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Frequency</label>
        <InfoBubble text="How often this amount applies. On the Payday page, this scales proportionally to however many days are actually in that pay period - a weekly budget shows double on a biweekly payday, for example." />
      </div>
      <div className="flex rounded-lg p-1 mb-4" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
        {FREQUENCY_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setFrequency(opt.key)}
            className="flex-1 rounded-md py-1.5 text-xs font-medium"
            style={{ background: frequency === opt.key ? colors.accent : "transparent", color: frequency === opt.key ? colors.bg : colors.textMuted }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center mb-1.5">
        <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Move money to <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
        <InfoBubble text="If set, submitting a payday on the Payday page will actually transfer this budget's set-aside amount from wherever your paycheck lands into this account - not just show it as a reminder." />
      </div>
      {addingAccount ? (
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              autoFocus
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder="Account name"
              className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />
            <button
              type="button"
              disabled={!newAccountName.trim() || savingAccount}
              onClick={async () => {
                setSavingAccount(true);
                setAccountError(null);
                try {
                  const created = await accountsApi.create({ name: newAccountName.trim(), type: "checking" });
                  setAccountsList((list) => [...list, created]);
                  onAccountAdded?.(created);
                  setAccountId(created.accountId);
                  setAddingAccount(false);
                  setNewAccountName("");
                } catch (err) {
                  setAccountError(err.message || "Couldn't create that account.");
                } finally {
                  setSavingAccount(false);
                }
              }}
              className="rounded-lg px-3 text-xs font-medium"
              style={{ background: colors.accent, color: colors.bg }}
            >
              {savingAccount ? "…" : "Add"}
            </button>
            <button type="button" onClick={() => { setAddingAccount(false); setNewAccountName(""); setAccountError(null); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
          </div>
          {accountError && <p className="text-xs mt-1.5" style={{ color: colors.alert }}>{accountError}</p>}
        </div>
      ) : (
        <div className="relative mb-4">
          <select
            value={accountId}
            onChange={(e) => { if (e.target.value === "__new__") setAddingAccount(true); else setAccountId(e.target.value); }}
            className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          >
            <option value="">Don't move money automatically</option>
            {accountsList.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
            <option value="__new__">+ Add a new account…</option>
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
        </div>
      )}

      {accountId && (
        <div className="mb-4">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Division <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
          {addingDivision ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newDivisionName}
                onChange={(e) => setNewDivisionName(e.target.value)}
                placeholder="Division name"
                className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              <button
                type="button"
                disabled={!newDivisionName.trim() || savingDivision}
                onClick={async () => {
                  setSavingDivision(true);
                  try {
                    const created = await divisionsApi.create(accountId, { name: newDivisionName.trim() });
                    setDivisions((list) => [...list, created]);
                    setDivisionId(created.divisionId);
                    setAddingDivision(false);
                    setNewDivisionName("");
                  } catch {
                    // best-effort - the field just stays open so they can retry
                  } finally {
                    setSavingDivision(false);
                  }
                }}
                className="rounded-lg px-3 text-xs font-medium"
                style={{ background: colors.accent, color: colors.bg }}
              >
                {savingDivision ? "…" : "Add"}
              </button>
              <button type="button" onClick={() => { setAddingDivision(false); setNewDivisionName(""); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
            </div>
          ) : (
            <div className="relative">
              <select
                value={divisionId}
                onChange={(e) => { if (e.target.value === "__new__") setAddingDivision(true); else setDivisionId(e.target.value); }}
                className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                <option value="">Whole account, no specific division</option>
                {divisions.map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
                <option value="__new__">+ Add a new division…</option>
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl px-4 py-3 mb-4" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
        <div className="flex items-center gap-2">
          {alertsEnabled ? <Bell size={15} style={{ color: colors.accentLight }} /> : <BellOff size={15} style={{ color: colors.textMuted }} />}
          <span className="text-sm" style={{ color: colors.text }}>Budget alerts</span>
        </div>
        <button type="button" onClick={() => setAlertsEnabled((v) => !v)} className="relative rounded-full transition-colors" style={{ width: 40, height: 22, background: alertsEnabled ? colors.accent : colors.border }} aria-label="Toggle budget alerts">
          <span className="absolute rounded-full transition-transform" style={{ width: 18, height: 18, top: 2, left: 2, background: colors.text, transform: alertsEnabled ? "translateX(18px)" : "translateX(0)" }} />
        </button>
      </div>

      {!isEditing && (
        <>
          <div className="flex items-center mb-1.5">
            <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Start date</label>
            <InfoBubble text="Snapped forward to your next scheduled paycheck automatically, so a budget period never splits a pay period in half. If you don't have recurring income set up yet, it starts on the date you pick." />
          </div>
          <input type="date" value={startDate} min={new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg px-3 py-2.5 mb-4 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }} />
        </>
      )}
      <button
        type="button"
        disabled={!amount || parseFloat(amount) <= 0 || !effectiveCategory || saving}
        onClick={() => {
          if (addingCategory) addCustomCategory(effectiveCategory);
          const isPastDate = !isEditing && startDate < new Date().toISOString().slice(0, 10);
          if (isPastDate) setShowBackfillConfirm(true);
          else onSave({ category: effectiveCategory, amount: parseFloat(amount), frequency, accountId: accountId || null, divisionId: divisionId || null, alertsEnabled, startDate });
        }}
        className="w-full rounded-lg py-2.5 text-sm font-medium"
        style={{ background: !amount || parseFloat(amount) <= 0 || !effectiveCategory ? colors.surface : colors.accent, color: !amount || parseFloat(amount) <= 0 || !effectiveCategory ? colors.textMuted : colors.bg, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "Saving…" : isEditing ? "Save changes" : "Save budget"}
      </button>

      {showBackfillConfirm && (
        <div className="fixed inset-0 flex items-center justify-center px-6 z-50" style={{ background: "rgba(15,27,45,0.8)" }}>
          <div className="rounded-2xl p-5 max-w-sm w-full" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }}>Start this budget from {startDate}?</span>
            <p className="text-sm mt-2 mb-4" style={{ color: colors.textMuted }}>
              This budget will use your real spending history for {effectiveCategory} starting from {startDate}, instead
              of starting fresh today. <strong style={{ color: colors.text }}>Your account balance is never affected by
              budgets</strong> either way.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowBackfillConfirm(false)} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
              <button
                type="button"
                onClick={() => { if (addingCategory) addCustomCategory(effectiveCategory); setShowBackfillConfirm(false); onSave({ category: effectiveCategory, amount: parseFloat(amount), frequency, accountId: accountId || null, divisionId: divisionId || null, alertsEnabled, startDate, backfillForTrends: true }); }}
                className="flex-1 rounded-lg py-2 text-sm font-medium"
                style={{ background: colors.accent, color: colors.bg }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditing && (
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="w-full rounded-lg py-2.5 text-sm font-medium mt-2"
          style={{ color: colors.alert }}
        >
          Delete this budget
        </button>
      )}
    </div>
  );
}

export default function BudgetsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const categoryParam = searchParams.get("category"); // jumps straight into editing that budget, from Payday's "view this item" links
  const [budgets, setBudgets] = useState(null);
  const [projections, setProjections] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingBudget, setEditingBudget] = useState(null);

  useEffect(() => {
    if (!categoryParam || !budgets) return;
    const match = budgets.find((b) => b.category === categoryParam);
    if (match) {
      setEditingBudget(match);
      setShowForm(true);
    }
    navigate("/budgets", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryParam, budgets]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      // GET /budgets now returns spentAmount per category directly (see
      // lambda/budgets/index.py _list_budgets) - no need to pull every
      // account's transactions client-side just to render a progress bar.
      const [b, p, a] = await Promise.all([budgetsApi.list(), projectionsApi.get(), accountsApi.list()]);
      setBudgets(b);
      setProjections(p);
      setAccounts(a);
    } catch {
      setError("Couldn't load your budgets.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveBudget(payload) {
    setSaving(true);
    try {
      // POST /budgets is an upsert keyed by category - editing an existing
      // budget uses the exact same call as creating a new one.
      await budgetsApi.upsert(payload);
      setShowForm(false);
      setEditingBudget(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't save that budget.");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDeleteBudget, setConfirmDeleteBudget] = useState(false);

  async function deleteBudget() {
    if (!editingBudget) return;
    setSaving(true);
    setError(null);
    try {
      await budgetsApi.remove(editingBudget.sk);
      setConfirmDeleteBudget(false);
      setShowForm(false);
      setEditingBudget(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't delete that budget.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Budgets" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Set monthly limits per category — get alerted at 80%, when you go over, and on every purchase while you're still over.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        {projections && (
          <div className="rounded-2xl p-4 mb-5 relative overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <p className="text-xs uppercase tracking-wide mb-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>This period</p>
            <p style={{ fontFamily: fontMono, fontSize: 20, color: colors.text }}>
              {formatMoney(projections.spentSoFarThisPeriod)}{" "}
              <span style={{ color: colors.textMuted, fontSize: 14 }}>of {formatMoney(projections.totalBudgeted)}</span>
            </p>
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${colors.border}` }}>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: colors.textMuted }}>Projected leftover this month</span>
                <span style={{ fontFamily: fontMono, fontSize: 15, color: projections.projectedLeftover >= 0 ? colors.positive : colors.alert }}>
                  {formatMoney(projections.projectedLeftover)}
                </span>
              </div>
              {projections.plannedExpenses?.totalMonthlyContribution > 0 && (
                <p className="text-xs mt-1" style={{ color: colors.textMuted }}>
                  Includes {formatMoney(projections.plannedExpenses.totalMonthlyContribution)}/mo set aside across{" "}
                  {projections.plannedExpenses.items.length} planned expense{projections.plannedExpenses.items.length === 1 ? "" : "s"}
                </p>
              )}
            </div>
          </div>
        )}

        {showForm ? (
          <NewBudgetForm
            key={editingBudget?.sk ?? "new"}
            initial={editingBudget}
            accounts={accounts}
            onAccountAdded={(acct) => setAccounts((list) => [...list, acct])}
            onCancel={() => { setShowForm(false); setEditingBudget(null); }}
            onSave={saveBudget}
            onDelete={() => setConfirmDeleteBudget(true)}
            saving={saving}
          />
        ) : (
          <button onClick={() => { setEditingBudget(null); setShowForm(true); }} className="w-full rounded-2xl py-3 mb-5 text-sm font-medium flex items-center justify-center gap-2" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
            <Plus size={16} />
            Add a budget
          </button>
        )}

        <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-1 px-1">By category</h3>

        {budgets === null && !error && <p className="text-sm" style={{ color: colors.textMuted }}>Loading…</p>}
        {budgets !== null && budgets.length === 0 && <p className="text-sm" style={{ color: colors.textMuted }}>No budgets yet.</p>}
        {(budgets || []).map((b) => (
          <BudgetCard key={b.sk} budget={b} onClick={() => { setEditingBudget(b); setShowForm(true); }} />
        ))}
      </div>

      <ConfirmDeleteDialog
        open={confirmDeleteBudget}
        title={`Delete the ${editingBudget?.category} budget?`}
        body="This can't be undone."
        busy={saving}
        error={error}
        onCancel={() => { setConfirmDeleteBudget(false); setError(null); }}
        onConfirm={deleteBudget}
      />
    </div>
  );
}
