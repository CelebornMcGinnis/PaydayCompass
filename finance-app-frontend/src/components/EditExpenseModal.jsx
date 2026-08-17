import React, { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { transactionsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontMono, formatMoney } from "../lib/theme";

const CATEGORY_OPTIONS = ["Groceries", "Dining", "Utilities", "Transportation", "Household", "Entertainment", "Health", "Rent/Mortgage", "Uncategorized"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export default function EditExpenseModal({ accountId, rows, divisions, onClose, onSaved, onDeleted }) {
  const [description, setDescription] = useState(rows.find((r) => r.description)?.description || "");
  const [splits, setSplits] = useState(
    rows.map((r) => ({ id: uid(), amount: String(r.amount), category: r.category, description: r.description || "" }))
  );
  const [divisionId, setDivisionId] = useState(rows.find((r) => r.divisionId)?.divisionId || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState(null);

  const total = splits.reduce((s, sp) => s + (parseFloat(sp.amount) || 0), 0);
  const canSave = total > 0 && splits.every((s) => parseFloat(s.amount) > 0);

  function updateSplit(id, next) {
    setSplits((s) => s.map((sp) => (sp.id === id ? next : sp)));
  }
  function addSplit() {
    setSplits((s) => [...s, { id: uid(), amount: "", category: "Uncategorized", description: "" }]);
  }
  function removeSplit(id) {
    if (splits.length <= 1) return; // always at least one split
    setSplits((s) => s.filter((sp) => sp.id !== id));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await transactionsApi.editPurchase(accountId, rows[0].purchaseId, {
        totalAmount: total,
        splits: splits.map((s) => ({ amount: parseFloat(s.amount), category: s.category, description: s.description || description })),
        divisionId: divisionId || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Couldn't save these changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await transactionsApi.removePurchase(accountId, rows[0].purchaseId);
      onDeleted();
    } catch (err) {
      setError(err.message || "Couldn't delete this expense.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5"
        style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 17, fontWeight: 600 }}>Edit expense</span>
          <button onClick={onClose} aria-label="Close" style={{ color: colors.textMuted }}><X size={18} /></button>
        </div>

        {error && <p className="text-sm mb-3" style={{ color: colors.alert }}>{error}</p>}

        <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none"
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
        />

        <div className="flex items-center justify-between mb-2 px-1">
          <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Split into categories</label>
          <span style={{ fontFamily: fontMono, fontSize: 13, color: colors.text }}>{formatMoney(total)}</span>
        </div>

        {splits.map((s) => (
          <div key={s.id} className="rounded-xl p-3 mb-2.5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="number"
                inputMode="decimal"
                value={s.amount}
                onChange={(e) => updateSplit(s.id, { ...s, amount: e.target.value })}
                placeholder="0.00"
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
              />
              <select
                value={s.category}
                onChange={(e) => updateSplit(s.id, { ...s, category: e.target.value })}
                className="flex-1 rounded-lg px-2 py-2 text-sm focus:outline-none"
                style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {splits.length > 1 && (
                <button type="button" onClick={() => removeSplit(s.id)} aria-label="Remove split" style={{ color: colors.alert }}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
            <input
              value={s.description}
              onChange={(e) => updateSplit(s.id, { ...s, description: e.target.value })}
              placeholder="Description for this split (optional)"
              className="w-full rounded-lg px-3 py-2 text-xs focus:outline-none"
              style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={addSplit}
          className="w-full rounded-xl py-2.5 mb-4 text-sm font-medium flex items-center justify-center gap-2"
          style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
        >
          <Plus size={15} /> Add category split
        </button>

        {divisions.length > 0 && (
          <div className="mb-4">
            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Division <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            >
              <option value="">Whole account, no specific division</option>
              {divisions.map((d) => <option key={d.divisionId} value={d.divisionId}>{d.name}</option>)}
            </select>
          </div>
        )}

        {confirmingDelete ? (
          <div className="rounded-xl p-3 mb-3" style={{ background: colors.surface, border: `1px solid ${colors.alert}` }}>
            <p className="text-sm mb-3" style={{ color: colors.text }}>Delete this expense? This can't be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDelete(false)} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ background: colors.alert, color: colors.bg, opacity: deleting ? 0.6 : 1 }}>
                {deleting ? "…" : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="w-full text-xs underline mb-4" style={{ color: colors.alert }}>Delete this expense entirely</button>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="w-full rounded-xl py-3 text-sm font-medium"
          style={{ background: canSave ? colors.accent : colors.surface, color: canSave ? colors.bg : colors.textMuted, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
