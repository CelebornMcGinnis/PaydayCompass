import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, ChevronDown, X } from "lucide-react";
import { plannedExpensesApi, accountsApi, divisionsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import InfoBubble from "../components/InfoBubble";
import { useCustomCategories } from "../lib/useCustomCategories";

const CATEGORY_OPTIONS = ["Gifts", "Travel", "Insurance", "Home", "Auto", "Health", "Other"];
const CONTRIBUTION_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];


function PlannedExpenseCard({ item, onEdit, onDelete, onMarkComplete, onRevive, marking }) {
  const percent = item.targetAmount > 0 ? Math.min((item.amountSaved / item.targetAmount) * 100, 100) : 0;
  return (
    <div className="rounded-2xl p-4 mb-3 relative overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: colors.text }}>{item.name}</p>
          <p className="text-xs" style={{ color: colors.textMuted }}>
            {item.category} · due {item.targetDate}
            {item.recurrenceType === "annual" && " · annual"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pl-2">
          {item.completed ? (
            item.recurrenceType !== "annual" && (
              <button onClick={onRevive} disabled={marking} className="text-xs underline" style={{ color: colors.accentLight, opacity: marking ? 0.5 : 1 }}>
                {marking ? "…" : "Revive"}
              </button>
            )
          ) : (
            <>
              <button onClick={onMarkComplete} disabled={marking} className="text-xs underline" style={{ color: colors.positive, opacity: marking ? 0.5 : 1 }}>
                {marking ? "…" : "Complete"}
              </button>
              <button onClick={() => onEdit(item)} className="text-xs underline" style={{ color: colors.accentLight }}>Edit</button>
            </>
          )}
          <button onClick={() => onDelete(item)} className="text-xs underline" style={{ color: colors.alert }}>Delete</button>
        </div>
      </div>
      <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: colors.surfaceRaised }}>
        <div className="h-full rounded-full" style={{ width: `${percent}%`, background: item.completed ? colors.positive : colors.accentLight }} />
      </div>
      <div className="flex items-center justify-between text-xs" style={{ fontFamily: fontMono, color: colors.textMuted }}>
        <span>{formatMoney(item.amountSaved)} of {formatMoney(item.targetAmount)}</span>
        {!item.completed && (
          <span style={{ color: colors.accentLight }}>{formatMoney(item.suggestedContribution)}/{item.contributionFrequency === "biweekly" ? "2wk" : item.contributionFrequency === "weekly" ? "wk" : "mo"}</span>
        )}
      </div>
    </div>
  );
}

function PlannedExpenseForm({ accounts, initial, onCancel, onSave, saving }) {
  const { theme } = useTheme();
  const isEditing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? CATEGORY_OPTIONS[0]);
  const [categoryOptions, setCategoryOptions] = useState(
    initial?.category && !CATEGORY_OPTIONS.includes(initial.category)
      ? [...CATEGORY_OPTIONS, initial.category]
      : CATEGORY_OPTIONS
  );
  const { customCategories, addCustomCategory } = useCustomCategories();
  useEffect(() => {
    if (customCategories.length === 0) return;
    setCategoryOptions((opts) => [...new Set([...opts, ...customCategories])]);
  }, [customCategories]);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [targetAmount, setTargetAmount] = useState(initial?.targetAmount != null ? String(initial.targetAmount) : "");
  const [amountSaved, setAmountSaved] = useState(initial?.amountSaved != null ? String(initial.amountSaved) : "0");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [recurrenceType, setRecurrenceType] = useState(initial?.recurrenceType ?? "one_time");
  const [contributionFrequency, setContributionFrequency] = useState(initial?.contributionFrequency ?? "monthly");
  const [linkedAccountId, setLinkedAccountId] = useState(initial?.linkedAccountId ?? "");
  const [divisionId, setDivisionId] = useState(initial?.divisionId ?? "");
  const [divisions, setDivisions] = useState([]);
  const [addingDivision, setAddingDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState("");
  const [savingDivision, setSavingDivision] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  useEffect(() => {
    if (!linkedAccountId) {
      setDivisions([]);
      return;
    }
    let cancelled = false;
    divisionsApi
      .list(linkedAccountId)
      .then((list) => {
        if (cancelled) return;
        setDivisions(list);
        if (divisionId && !list.some((d) => d.divisionId === divisionId)) setDivisionId("");
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedAccountId]);

  const canSave = name.trim() && parseFloat(targetAmount) > 0 && targetDate;

  function buildPayload() {
    return {
      name: name.trim(),
      category,
      targetAmount: parseFloat(targetAmount),
      amountSaved: parseFloat(amountSaved) || 0,
      targetDate,
      recurrenceType,
      contributionFrequency,
      linkedAccountId: linkedAccountId || null,
      divisionId: divisionId || null,
      notes: notes.trim(),
    };
  }

  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>{isEditing ? "Edit planned expense" : "New planned expense"}</span>
        <button onClick={onCancel} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
      </div>

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mom's birthday" className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Category</label>
      {addingCategory ? (
        <div className="flex gap-2 mb-3">
          <input
            autoFocus
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
            className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          />
          <button
            type="button"
            disabled={!newCategory.trim()}
            onClick={() => {
              const name = newCategory.trim();
              setCategoryOptions((opts) => (opts.includes(name) ? opts : [...opts, name]));
              addCustomCategory(name);
              setCategory(name);
              setAddingCategory(false);
              setNewCategory("");
            }}
            className="rounded-lg px-3 text-xs font-medium"
            style={{ background: colors.accent, color: colors.bg }}
          >
            Add
          </button>
          <button type="button" onClick={() => { setAddingCategory(false); setNewCategory(""); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
        </div>
      ) : (
        <div className="relative mb-3">
          <select
            value={category}
            onChange={(e) => { if (e.target.value === "__new__") setAddingCategory(true); else setCategory(e.target.value); }}
            className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          >
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">+ Add a new category…</option>
          </select>
          <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <div className="flex-1">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Target amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
            <input type="number" inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
          </div>
        </div>
        <div className="flex-1">
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Already saved</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
            <input type="number" inputMode="decimal" value={amountSaved} onChange={(e) => setAmountSaved(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-2 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
          </div>
        </div>
      </div>

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Target date</label>
      <input type="date" value={targetDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setTargetDate(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme, maxWidth: "100%", boxSizing: "border-box" }} />

      <div className="flex rounded-lg p-1 mb-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
        {[{ key: "one_time", label: "One-time" }, { key: "annual", label: "Annual (e.g. birthday)" }].map((opt) => (
          <button key={opt.key} type="button" onClick={() => setRecurrenceType(opt.key)} className="flex-1 rounded-md py-1.5 text-xs font-medium" style={{ background: recurrenceType === opt.key ? colors.accent : "transparent", color: recurrenceType === opt.key ? colors.bg : colors.textMuted }}>
            {opt.label}
          </button>
        ))}
      </div>

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Contribute</label>
      <div className="relative mb-3">
        <select value={contributionFrequency} onChange={(e) => setContributionFrequency(e.target.value)} className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}>
          {CONTRIBUTION_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
      </div>

      {accounts.length > 0 && (
        <>
          <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Where savings accumulate <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
          <div className="relative mb-3">
            <select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)} className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}>
              <option value="">None</option>
              {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
            </select>
            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
          </div>

          {linkedAccountId && (
            <div className="mb-3">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Division <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
              {addingDivision ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={newDivisionName}
                    onChange={(e) => setNewDivisionName(e.target.value)}
                    placeholder="Division name"
                    className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  />
                  <button
                    type="button"
                    disabled={!newDivisionName.trim() || savingDivision}
                    onClick={async () => {
                      setSavingDivision(true);
                      try {
                        const created = await divisionsApi.create(linkedAccountId, { name: newDivisionName.trim() });
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
                    className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none"
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
        </>
      )}

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Notes <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 250))} rows={2} className="w-full rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none resize-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />

      <button
        type="button"
        disabled={!canSave || saving}
        onClick={() => onSave(buildPayload())}
        className="w-full rounded-lg py-2.5 text-sm font-medium"
        style={{ background: canSave ? colors.accent : colors.surface, color: canSave ? colors.bg : colors.textMuted, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "Saving…" : isEditing ? "Save changes" : "Create"}
      </button>
    </div>
  );
}

export default function PlannedExpensesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);
  const [editingId, setEditingId] = useState(searchParams.get("edit") || null); // null | "new" | a real plannedExpenseId
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (searchParams.get("edit")) navigate("/planned-expenses", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh() {
    Promise.all([plannedExpensesApi.list(), accountsApi.list()])
      .then(([list, accts]) => {
        setItems(list);
        setAccounts(accts);
      })
      .catch(() => setError("Couldn't load your planned expenses."));
  }

  useEffect(refresh, []);

  const activeItems = (items || []).filter((i) => !i.completed);
  const completedItems = (items || []).filter((i) => i.completed);

  const totalSuggestedMonthly = activeItems.reduce((sum, i) => {
    const monthly = i.contributionFrequency === "weekly" ? i.suggestedContribution * 4.33 : i.contributionFrequency === "biweekly" ? i.suggestedContribution * 2.17 : i.suggestedContribution;
    return sum + monthly;
  }, 0);

  async function saveItem(payload) {
    setSaving(true);
    setError(null);
    try {
      if (editingId && editingId !== "new") {
        await plannedExpensesApi.update(editingId, payload);
      } else {
        await plannedExpensesApi.create(payload);
      }
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't save that planned expense.");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [markingId, setMarkingId] = useState(null);

  async function markComplete(item) {
    setMarkingId(item.plannedExpenseId);
    setError(null);
    try {
      await plannedExpensesApi.markComplete(item.plannedExpenseId);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't mark that complete.");
    } finally {
      setMarkingId(null);
    }
  }

  async function revive(item) {
    setMarkingId(item.plannedExpenseId);
    setError(null);
    try {
      await plannedExpensesApi.update(item.plannedExpenseId, { completed: false });
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't revive that.");
    } finally {
      setMarkingId(null);
    }
  }

  async function deleteItem() {
    if (!confirmDeleteItem) return;
    setDeleting(true);
    setError(null);
    try {
      await plannedExpensesApi.remove(confirmDeleteItem.plannedExpenseId);
      setConfirmDeleteItem(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't delete that.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Planned expenses" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Save toward known future costs — a birthday, an annual premium — with a suggested monthly contribution.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        {activeItems.length > 0 && (
          <div className="rounded-2xl p-4 mb-5 relative overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center mb-1">
              <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Suggested monthly total</p>
              <InfoBubble text="All your suggested contributions, normalized to a monthly figure, added together — this is roughly what to set aside each month across everything you're planning for." />
            </div>
            <p style={{ fontFamily: fontMono, fontSize: 22, color: colors.accentLight }}>{formatMoney(totalSuggestedMonthly)}</p>
          </div>
        )}

        {editingId === "new" ? (
          <PlannedExpenseForm
            key="new"
            accounts={accounts}
            initial={null}
            saving={saving}
            onCancel={() => setEditingId(null)}
            onSave={saveItem}
          />
        ) : (
          <button type="button" onClick={() => setEditingId("new")} className="w-full rounded-2xl py-3 mb-5 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
            <Plus size={16} />
            Add a planned expense
          </button>
        )}

        {items === null && !error && <p className="text-sm" style={{ color: colors.textMuted }}>Loading…</p>}
        {items !== null && items.length === 0 && <p className="text-sm" style={{ color: colors.textMuted }}>Nothing planned yet.</p>}

        {activeItems.length > 0 && (
          <p className="text-xs uppercase tracking-wide mb-2 px-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Active</p>
        )}
        {activeItems.map((item) =>
          editingId === item.plannedExpenseId ? (
            <PlannedExpenseForm
              key={item.plannedExpenseId}
              accounts={accounts}
              initial={item}
              saving={saving}
              onCancel={() => setEditingId(null)}
              onSave={saveItem}
            />
          ) : (
            <PlannedExpenseCard
              key={item.plannedExpenseId}
              item={item}
              marking={markingId === item.plannedExpenseId}
              onEdit={(i) => setEditingId(i.plannedExpenseId)}
              onDelete={setConfirmDeleteItem}
              onMarkComplete={() => markComplete(item)}
              onRevive={() => revive(item)}
            />
          )
        )}

        {completedItems.length > 0 && (
          <>
            <p className="text-xs uppercase tracking-wide mb-2 mt-5 px-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Completed</p>
            {completedItems.map((item) => (
              <PlannedExpenseCard
                key={item.plannedExpenseId}
                item={item}
                marking={markingId === item.plannedExpenseId}
                onEdit={(i) => setEditingId(i.plannedExpenseId)}
                onDelete={setConfirmDeleteItem}
                onMarkComplete={() => markComplete(item)}
                onRevive={() => revive(item)}
              />
            ))}
          </>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!confirmDeleteItem}
        title={`Delete "${confirmDeleteItem?.name}"?`}
        body="This can't be undone."
        busy={deleting}
        error={error}
        onCancel={() => { setConfirmDeleteItem(null); setError(null); }}
        onConfirm={deleteItem}
      />
    </div>
  );
}
