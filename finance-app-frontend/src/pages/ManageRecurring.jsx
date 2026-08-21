import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, ChevronRight, ChevronDown, StickyNote, Lock } from "lucide-react";
import { accountsApi, externalBankAccountsApi, recurringApi, budgetsApi, divisionsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import InfoBubble from "../components/InfoBubble";
import { useCustomCategories } from "../lib/useCustomCategories";

const CATEGORY_OPTIONS = ["Uncategorized", "Groceries", "Dining", "Utilities", "Transportation", "Household", "Entertainment", "Health", "Rent/Mortgage"];
const FREQUENCIES = [
  { key: "weekly", label: "Weekly" },
  { key: "biweekly", label: "Every 2 weeks" },
  { key: "semimonthly", label: "Twice a month (fixed days)" },
  { key: "monthly", label: "Monthly" },
  { key: "monthly_weekday", label: "Monthly (e.g. 2nd Tuesday)" },
  { key: "annual", label: "Annually" },
  { key: "custom", label: "Custom interval" },
];

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEK_ORDINALS = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", "-1": "Last" };

function formatMonthlyWeekday(weekOfMonth, dayOfWeek) {
  const ordinal = WEEK_ORDINALS[weekOfMonth] || `${weekOfMonth}th`;
  const day = WEEKDAY_NAMES[dayOfWeek] || "day";
  return `${ordinal} ${day} of every month`;
}

function FieldLabel({ children }) {
  return (
    <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
      {children}
    </label>
  );
}

function Select({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
      >
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>{opt.label ?? opt}</option>
        ))}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
    </div>
  );
}

function RecurringListRow({ item, externalAccountsById, accountsById, onSelect }) {
  const bankName = item.externalBankAccountId ? externalAccountsById[item.externalBankAccountId] : null;
  const accountName = accountsById[item.accountId] || "Unknown account";
  return (
    <button type="button" onClick={onSelect} className="w-full flex items-center justify-between py-3 text-left" style={{ borderBottom: `1px solid ${colors.border}` }}>
      <div className="min-w-0">
        <p className="text-sm truncate flex items-center gap-1.5" style={{ color: colors.text }}>
          {item.description || "(untitled)"}
          {item.notes && <StickyNote size={11} style={{ color: colors.textMuted }} className="shrink-0" />}
        </p>
        <p className="text-xs truncate" style={{ color: colors.textMuted }}>
          {item.frequency === "custom"
            ? `Every ${item.intervalCount} ${item.intervalUnit}`
            : item.frequency === "monthly_weekday"
            ? formatMonthlyWeekday(item.weekOfMonth, item.dayOfWeek)
            : FREQUENCIES.find((f) => f.key === item.frequency)?.label || item.frequency}
          {!item.isIncome && ` · ${item.category}`}
          {` · ${accountName}`}
          {bankName && (item.isIncome ? ` · deposited to ${bankName}` : ` · drafted from ${bankName}`)}
          {item.sharedFromUserId && " · shared"}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0 pl-3">
        <span style={{ fontFamily: fontMono, fontSize: 14, color: item.isIncome ? colors.positive : colors.text }}>
          {item.isIncome ? "+" : ""}{formatMoney(item.estimatedAmount)}
        </span>
        <ChevronRight size={15} style={{ color: colors.textMuted }} />
      </div>
    </button>
  );
}

function RecurringForm({ accounts, externalAccounts, onExternalAccountAdded, onAccountAdded, categoryOptions, onCustomCategoryAdded, initial, defaultIsIncome, onCancel, onSave, onDelete, saving }) {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isEditing = !!initial;
  const [isIncome, setIsIncome] = useState(initial?.isIncome ?? defaultIsIncome ?? false);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Uncategorized");
  const effectiveCategoryOptions = category && !categoryOptions.includes(category)
    ? [...categoryOptions, category]
    : categoryOptions;
  const [addingCategory, setAddingCategory] = useState(false);
  const [customCategory, setCustomCategory] = useState("");
  const [accountsList, setAccountsList] = useState(accounts);
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.accountId ?? "");
  const [addingAccount, setAddingAccount] = useState(accounts.length === 0);
  const [newAccountName, setNewAccountName] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState(null);
  const [amount, setAmount] = useState(initial?.estimatedAmount != null ? String(initial.estimatedAmount) : "");
  const [grossAmount, setGrossAmount] = useState(initial?.grossAmount != null ? String(initial.grossAmount) : "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "monthly");
  const [intervalCount, setIntervalCount] = useState(initial?.intervalCount ? String(initial.intervalCount) : "1");
  const [intervalUnit, setIntervalUnit] = useState(initial?.intervalUnit ?? "days");
  const [weekOfMonth, setWeekOfMonth] = useState(initial?.weekOfMonth ?? 1);
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek ?? 0);
  const [externalBankAccountId, setExternalBankAccountId] = useState(initial?.externalBankAccountId ?? "");
  const [addingExternalAccount, setAddingExternalAccount] = useState(false);
  const [newExternalAccountName, setNewExternalAccountName] = useState("");
  const [savingExternalAccount, setSavingExternalAccount] = useState(false);
  const [externalAccountError, setExternalAccountError] = useState(null);
  const [divisionId, setDivisionId] = useState(initial?.divisionId ?? "");
  const [divisions, setDivisions] = useState([]);
  const [addingDivision, setAddingDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState("");
  const [savingDivision, setSavingDivision] = useState(false);
  const [nextDueDate, setNextDueDate] = useState(initial?.nextDueDate ?? new Date().toISOString().slice(0, 10));
  const [keepAsOverdue, setKeepAsOverdue] = useState(false);
  const [showBackfillFields, setShowBackfillFields] = useState(false);
  const [backfillFromDate, setBackfillFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [showBackfillConfirm, setShowBackfillConfirm] = useState(false);
  const [pendingAndAddAnother, setPendingAndAddAnother] = useState(false); // remembers which button triggered the backfill-confirm dialog

  // Divisions are scoped to whichever account is currently selected -
  // refetch whenever that changes, and clear any division selection that
  // no longer belongs to the newly-selected account.
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

  // If the selected account is itself connected to an external bank
  // account (see ExternalBankAccounts.jsx / AccountDetail.jsx), this
  // item's own external-bank-account field should just reflect that
  // connection rather than offer a second, independently-editable choice
  // that could silently disagree with it - auto-select it whenever the
  // selected account changes to one that has a connection. An account
  // with no connection leaves this field exactly as the user set it.
  const connectedAccount = accountsList.find((a) => a.accountId === accountId);
  const connectedExternalId = connectedAccount?.externalBankAccountId || null;
  useEffect(() => {
    if (connectedExternalId) setExternalBankAccountId(connectedExternalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedExternalId]);

  const effectiveCategory = addingCategory ? customCategory.trim() : category;
  const canSave = description.trim() && parseFloat(amount) > 0 && accountId && (isIncome || effectiveCategory) && (frequency !== "custom" || parseInt(intervalCount, 10) > 0);
  const today = new Date().toISOString().slice(0, 10);

  function buildPayload() {
    return {
      accountId,
      isIncome,
      description: description.trim(),
      notes: notes.trim(),
      category: isIncome ? undefined : effectiveCategory,
      estimatedAmount: parseFloat(amount),
      grossAmount: isIncome && grossAmount ? parseFloat(grossAmount) : undefined,
      frequency,
      intervalCount: frequency === "custom" ? parseInt(intervalCount, 10) || 1 : undefined,
      intervalUnit: frequency === "custom" ? intervalUnit : undefined,
      weekOfMonth: frequency === "monthly_weekday" ? weekOfMonth : undefined,
      dayOfWeek: frequency === "monthly_weekday" ? dayOfWeek : undefined,
      externalBankAccountId: externalBankAccountId || null,
      divisionId: divisionId || null,
      nextDueDate,
      keepAsOverdue: !isEditing ? keepAsOverdue : undefined,
      backfillFromDate: !isEditing && showBackfillFields && backfillFromDate < today ? backfillFromDate : undefined,
    };
  }

  return (
    <div className="max-w-md mx-auto px-5 pt-6 pb-10">
      <div className="flex rounded-xl p-1 mb-5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
        {[{ key: false, label: "Expense" }, { key: true, label: "Income" }].map((opt) => (
          <button
            key={String(opt.key)}
            type="button"
            disabled={isEditing}
            onClick={() => setIsIncome(opt.key)}
            className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors"
            style={{
              background: isIncome === opt.key ? (opt.key ? colors.accent : colors.alert) : "transparent",
              color: isIncome === opt.key ? colors.bg : colors.textMuted,
              opacity: isEditing && isIncome !== opt.key ? 0.4 : 1,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <FieldLabel>Description</FieldLabel>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={isIncome ? "e.g. Payroll deposit" : "e.g. Electric bill"}
          className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
        />
      </div>

      <div className="mb-4">
        <FieldLabel>Notes <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></FieldLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Account number, contact info, anything worth remembering about this one"
          rows={3}
          maxLength={1000}
          className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none"
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
        />
      </div>

      <div className="mb-4">
        <div className="flex items-center">
          <FieldLabel>Account</FieldLabel>
          <InfoBubble text="The account income is deposited into, or expenses are deducted from." />
        </div>
        {addingAccount ? (
          <>
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
          </>
        ) : (
          <Select
            value={accountId}
            onChange={(v) => { if (v === "__new__") setAddingAccount(true); else setAccountId(v); }}
            options={[...accountsList.map((a) => ({ value: a.accountId, label: a.name })), { value: "__new__", label: "+ Add a new account…" }]}
          />
        )}
      </div>

      <div className="mb-4">
        <FieldLabel>Division <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></FieldLabel>
        {addingDivision ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={newDivisionName}
              onChange={(e) => setNewDivisionName(e.target.value)}
              placeholder="Division name"
              className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              disabled={!accountId}
            />
            <button
              type="button"
              disabled={!newDivisionName.trim() || savingDivision || !accountId}
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
          <Select
            value={divisionId}
            onChange={(v) => { if (v === "__new__") setAddingDivision(true); else setDivisionId(v); }}
            options={[{ value: "", label: "None" }, ...divisions.map((d) => ({ value: d.divisionId, label: d.name })), { value: "__new__", label: "+ Add a new division…" }]}
          />
        )}
      </div>

      {!isIncome && (
        <div className="mb-4">
          <FieldLabel>Category</FieldLabel>
          {addingCategory ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="New category name"
                className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              <button
                type="button"
                disabled={!customCategory.trim()}
                onClick={() => {
                  const name = customCategory.trim();
                  setCategory(name);
                  onCustomCategoryAdded(name);
                  setAddingCategory(false);
                  setCustomCategory("");
                }}
                className="rounded-lg px-3 text-xs font-medium"
                style={{ background: colors.accent, color: colors.bg }}
              >
                Add
              </button>
              <button type="button" onClick={() => { setAddingCategory(false); setCustomCategory(""); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
            </div>
          ) : (
            <Select
              value={category}
              onChange={(v) => { if (v === "__new__") setAddingCategory(true); else setCategory(v); }}
              options={[...effectiveCategoryOptions, { value: "__new__", label: "+ Add a new category…" }]}
            />
          )}
        </div>
      )}

      <div className="mb-4">
        <FieldLabel>{isIncome ? "Net amount" : "Amount"}</FieldLabel>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
          <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-3 py-2.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
        </div>
      </div>

      {isIncome && (
        <div className="mb-4">
          <FieldLabel>Gross amount <span style={{ opacity: 0.6, textTransform: "none" }}>(optional, reference only)</span></FieldLabel>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
            <input type="number" inputMode="decimal" value={grossAmount} onChange={(e) => setGrossAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg pl-6 pr-3 py-2.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
          </div>
        </div>
      )}

      <div className="mb-4">
        <FieldLabel>External bank account <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></FieldLabel>
        {connectedExternalId ? (
          <>
            <div
              className="w-full rounded-lg px-3 py-2.5 text-sm flex items-center justify-between"
              style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}`, color: colors.textMuted }}
            >
              {externalAccounts.find((e) => e.externalBankAccountId === connectedExternalId)?.name || "Connected account"}
              <Lock size={13} />
            </div>
            <p className="text-xs mt-1.5" style={{ color: colors.textMuted }}>
              Set automatically because {connectedAccount?.name} is connected to this external account.{" "}
              <button type="button" onClick={() => navigate("/external-bank-accounts")} className="underline" style={{ color: colors.accentLight }}>
                Manage connections
              </button>
            </p>
          </>
        ) : addingExternalAccount ? (
            <>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newExternalAccountName}
                  onChange={(e) => setNewExternalAccountName(e.target.value)}
                  placeholder="Bank account name"
                  className="flex-1 rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                />
                <button
                  type="button"
                  disabled={!newExternalAccountName.trim() || savingExternalAccount}
                  onClick={async () => {
                    setSavingExternalAccount(true);
                    setExternalAccountError(null);
                    try {
                      const created = await externalBankAccountsApi.create({ name: newExternalAccountName.trim() });
                      onExternalAccountAdded(created);
                      setExternalBankAccountId(created.externalBankAccountId);
                      setAddingExternalAccount(false);
                      setNewExternalAccountName("");
                    } catch (err) {
                      setExternalAccountError(err.message || "Couldn't add that account.");
                    } finally {
                      setSavingExternalAccount(false);
                    }
                  }}
                  className="rounded-lg px-3 text-xs font-medium"
                  style={{ background: colors.accent, color: colors.bg }}
                >
                  {savingExternalAccount ? "…" : "Add"}
                </button>
                <button type="button" onClick={() => { setAddingExternalAccount(false); setNewExternalAccountName(""); setExternalAccountError(null); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
              </div>
              {externalAccountError && <p className="text-xs mt-1.5" style={{ color: colors.alert }}>{externalAccountError}</p>}
            </>
          ) : (
            <Select
              value={externalBankAccountId}
              onChange={(v) => { if (v === "__new__") setAddingExternalAccount(true); else setExternalBankAccountId(v); }}
              options={[{ value: "", label: "Unassigned" }, ...externalAccounts.map((b) => ({ value: b.externalBankAccountId, label: b.name })), { value: "__new__", label: "+ Add a new bank account…" }]}
            />
          )}
      </div>

      <div className="mb-4">
        <FieldLabel>Frequency</FieldLabel>
        <Select value={frequency} onChange={setFrequency} options={FREQUENCIES.map((f) => ({ value: f.key, label: f.label }))} />
      </div>

      {frequency === "custom" && (
        <div className="mb-4">
          <FieldLabel>Repeat every</FieldLabel>
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              step="1"
              value={intervalCount}
              onChange={(e) => setIntervalCount(e.target.value)}
              placeholder="1"
              style={{ width: 90, background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
              className="rounded-lg px-3 py-2.5 text-sm focus:outline-none"
            />
            <div className="flex-1">
              <Select
                value={intervalUnit}
                onChange={setIntervalUnit}
                options={[{ value: "days", label: "Days" }, { value: "weeks", label: "Weeks" }, { value: "months", label: "Months" }]}
              />
            </div>
          </div>
        </div>
      )}

      {frequency === "monthly_weekday" && (
        <div className="mb-4">
          <FieldLabel>Which day</FieldLabel>
          <div className="flex gap-2">
            <div className="flex-1">
              <Select
                value={String(weekOfMonth)}
                onChange={(v) => setWeekOfMonth(parseInt(v, 10))}
                options={[
                  { value: "1", label: "1st" },
                  { value: "2", label: "2nd" },
                  { value: "3", label: "3rd" },
                  { value: "4", label: "4th" },
                  { value: "-1", label: "Last" },
                ]}
              />
            </div>
            <div className="flex-1">
              <Select
                value={String(dayOfWeek)}
                onChange={(v) => setDayOfWeek(parseInt(v, 10))}
                options={WEEKDAY_NAMES.map((name, i) => ({ value: String(i), label: name }))}
              />
            </div>
          </div>
          <p className="text-xs mt-1.5" style={{ color: colors.textMuted }}>
            {formatMonthlyWeekday(weekOfMonth, dayOfWeek)}
          </p>
        </div>
      )}

      <div className="mb-4">
        <FieldLabel>{isIncome ? "Next paycheck date" : "Next due date"}</FieldLabel>
        <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }} />
        {!isEditing && !isIncome && nextDueDate && nextDueDate < today && (
          <div className="mt-2">
            <p className="text-xs mb-1.5" style={{ color: colors.textMuted }}>
              That date's already passed. By default this starts tracking from the next occurrence after today, not this one.
            </p>
            <label className="flex items-center gap-2 text-xs" style={{ color: colors.text }}>
              <input type="checkbox" checked={keepAsOverdue} onChange={(e) => setKeepAsOverdue(e.target.checked)} />
              This specific occurrence is still unpaid and overdue - keep it as-is
            </label>
          </div>
        )}
      </div>

      {!isEditing && (
        <div className="mb-5">
          <button type="button" onClick={() => setShowBackfillFields((v) => !v)} className="text-xs underline mb-2" style={{ color: colors.accentLight }}>
            {showBackfillFields ? "Remove backfill start date" : "+ Also backfill trend history from an earlier date"}
          </button>
          {showBackfillFields && (
            <>
              <FieldLabel>Start reporting from <span style={{ opacity: 0.6, textTransform: "none" }}>(for trends only)</span></FieldLabel>
              <input type="date" value={backfillFromDate} min={new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)} max={today} onChange={(e) => setBackfillFromDate(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }} />
              <p className="text-xs mt-1.5" style={{ color: colors.textMuted }}>
                Independent of {isIncome ? "your next paycheck date" : "the next due date"} above - this only fills in
                past history for Category Trends, and never changes your account balance.
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex gap-3 mb-3">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl py-3 text-sm font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => {
            const needsConfirm = !isEditing && showBackfillFields && backfillFromDate < today;
            if (needsConfirm) { setPendingAndAddAnother(false); setShowBackfillConfirm(true); }
            else onSave(buildPayload());
          }}
          className="flex-1 rounded-xl py-3 text-sm font-medium"
          style={{ background: canSave ? colors.accent : colors.surfaceRaised, color: canSave ? colors.bg : colors.textMuted, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : isEditing ? "Save changes" : "Create"}
        </button>
      </div>

      {!isEditing && (
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => {
            const needsConfirm = showBackfillFields && backfillFromDate < today;
            if (needsConfirm) { setPendingAndAddAnother(true); setShowBackfillConfirm(true); }
            else onSave(buildPayload(), true);
          }}
          className="w-full rounded-xl py-3 mb-3 text-sm font-medium"
          style={{ border: `1px solid ${canSave ? colors.accent : colors.border}`, color: canSave ? colors.accentLight : colors.textMuted, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save & add another"}
        </button>
      )}

      {showBackfillConfirm && (
        <div className="fixed inset-0 flex items-center justify-center px-6 z-50" style={{ background: "rgba(15,27,45,0.8)" }}>
          <div className="rounded-2xl p-5 max-w-sm w-full" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }}>Backfill history from {backfillFromDate}?</span>
            <p className="text-sm mt-2 mb-4" style={{ color: colors.textMuted }}>
              This creates a historical record for every occurrence between {backfillFromDate} and today, so Category Trends
              reflects it properly. <strong style={{ color: colors.text }}>Your account balance will not change</strong> —
              this is for trend visibility only, not new money moving.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowBackfillConfirm(false)} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
              <button
                type="button"
                onClick={() => { const andAddAnother = pendingAndAddAnother; setShowBackfillConfirm(false); setPendingAndAddAnother(false); onSave({ ...buildPayload(), backfillForTrends: true }, andAddAnother); }}
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
        <button type="button" onClick={onDelete} disabled={saving} className="w-full rounded-xl py-2.5 text-sm font-medium" style={{ color: colors.alert }}>
          Delete
        </button>
      )}
    </div>
  );
}

export default function ManageRecurringPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState(null);
  const [externalAccounts, setExternalAccounts] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState(CATEGORY_OPTIONS);
  const { customCategories, addCustomCategory } = useCustomCategories();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const newParam = searchParams.get("new"); // "income" | "expense" | null - jumps straight into create, from Dashboard's quick-action buttons
  const editParam = searchParams.get("edit"); // a recurringId - jumps straight into editing that item, from Payday's "view this item" links
  const [view, setView] = useState(newParam ? "create" : "list"); // "list" | "create" | "edit"
  const [editingItem, setEditingItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0); // bumped after "Save & add another" to force RecurringForm to remount with blank fields
  const [savedAndReady, setSavedAndReady] = useState(false);

  useEffect(() => {
    if (!editParam || !items) return;
    const match = items.find((i) => i.recurringId === editParam);
    if (match) {
      setEditingItem(match);
      setView("edit");
    }
    navigate("/recurring", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, items]);

  async function refresh() {
    try {
      const [accts, extAccts, budgets] = await Promise.all([accountsApi.list(), externalBankAccountsApi.list(), budgetsApi.list()]);
      setAccounts(accts);
      setExternalAccounts(extAccts);
      setCategoryOptions([...new Set([...CATEGORY_OPTIONS, ...budgets.map((b) => b.category)])]);
      // A shared account's recurring-item access is independent of the
      // base account share - the caller might see the account but have
      // no recurring access to it at all (404). Don't let that account's
      // failure wipe out everyone else's recurring items. Also tag each
      // item with whether ITS account is shared (accts[i].sharedFromUserId),
      // since recurring items themselves never carry that field - only
      // the account object does.
      const perAccount = await Promise.all(
        accts.map((a) => recurringApi.list(a.accountId).catch(() => []))
      );
      const flattened = accts.flatMap((a, i) =>
        perAccount[i].map((item) => ({ ...item, accountId: a.accountId, sharedFromUserId: a.sharedFromUserId }))
      );
      setItems(flattened);
    } catch {
      setError("Couldn't load your recurring items.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const externalAccountsById = Object.fromEntries(externalAccounts.map((a) => [a.externalBankAccountId, a.name]));
  const accountsById = Object.fromEntries((accounts || []).map((a) => [a.accountId, a.name]));
  const income = (items || []).filter((i) => i.isIncome);
  const expenses = (items || []).filter((i) => !i.isIncome);

  async function saveItem(payload, andAddAnother) {
    setSaving(true);
    setError(null);
    try {
      const { accountId, ...body } = payload;
      const targetAccountId = editingItem ? editingItem.accountId : accountId;
      if (editingItem) {
        await recurringApi.update(targetAccountId, editingItem.recurringId, body);
      } else {
        await recurringApi.create(targetAccountId, body);
      }
      refresh();
      if (andAddAnother && !editingItem) {
        // Stay on the create form instead of returning to the list -
        // bumping the key forces RecurringForm to remount with fresh
        // blank state, same "remount via key" fix already used elsewhere
        // in this app for a form that must reset between items.
        setFormResetKey((k) => k + 1);
        setSavedAndReady(true);
        setTimeout(() => setSavedAndReady(false), 2500);
      } else {
        setView("list");
        setEditingItem(null);
        if (newParam) navigate("/recurring", { replace: true });
      }
    } catch (err) {
      setError(err.message || "Couldn't save that recurring item.");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDeleteRecurring, setConfirmDeleteRecurring] = useState(false);

  async function deleteItem() {
    if (!editingItem) return;
    setSaving(true);
    setError(null);
    try {
      await recurringApi.remove(editingItem.accountId, editingItem.recurringId);
      setConfirmDeleteRecurring(false);
      setView("list");
      setEditingItem(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't delete that item.");
    } finally {
      setSaving(false);
    }
  }

  if (view !== "list") {
    return (
      <div className="min-h-screen" style={{ background: colors.bg, fontFamily: fontBody }}>
        <PageHeader
          title={editingItem ? "Edit recurring" : "New recurring"}
          onBack={() => { setView("list"); setEditingItem(null); if (newParam) navigate("/recurring", { replace: true }); }}
        />
        {error && <p className="text-sm px-5 pt-4" style={{ color: colors.alert }}>{error}</p>}
        {savedAndReady && <p className="text-sm px-5 pt-4" style={{ color: colors.positive }}>Saved — add another below.</p>}
        {accounts === null ? (
          <p className="text-sm px-5 pt-4" style={{ color: colors.textMuted }}>Loading…</p>
        ) : (
        <RecurringForm
          key={formResetKey}
          accounts={accounts}
          externalAccounts={externalAccounts}
          onExternalAccountAdded={(acct) => setExternalAccounts((list) => [...list, acct])}
          onAccountAdded={(acct) => setAccounts((list) => [...(list || []), acct])}
          categoryOptions={[...new Set([...categoryOptions, ...customCategories])]}
          onCustomCategoryAdded={addCustomCategory}
          initial={editingItem}
          defaultIsIncome={newParam === "income"}
          saving={saving}
          onCancel={() => { setView("list"); setEditingItem(null); if (newParam) navigate("/recurring", { replace: true }); }}
          onSave={saveItem}
          onDelete={() => setConfirmDeleteRecurring(true)}
        />
        )}

        <ConfirmDeleteDialog
          open={confirmDeleteRecurring}
          title={`Delete "${editingItem?.description}"?`}
          body="This can't be undone."
          busy={saving}
          error={error}
          onCancel={() => { setConfirmDeleteRecurring(false); setError(null); }}
          onConfirm={deleteItem}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Recurring" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Create, edit, or delete recurring bills and income that post automatically on schedule.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        <button type="button" data-wizard-target="wizard-recurring-add" onClick={() => setView("create")} disabled={!accounts} className="w-full rounded-2xl py-3 mb-6 text-sm font-medium flex items-center justify-center gap-2" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
          <Plus size={16} />
          Add recurring income or expense
        </button>

        <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-1 px-1">Income</h3>
        <div className="rounded-2xl px-4 mb-6 relative overflow-hidden" data-wizard-target="wizard-recurring-income" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <div className="pt-1">
            {items === null && !error ? (
              <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>Loading…</p>
            ) : income.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>No recurring income yet.</p>
            ) : (
              income.map((item) => (
                <RecurringListRow key={item.recurringId} item={item} externalAccountsById={externalAccountsById} accountsById={accountsById} onSelect={() => { setEditingItem(item); setView("edit"); }} />
              ))
            )}
          </div>
        </div>

        <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-1 px-1">Expenses</h3>
        <div className="rounded-2xl px-4 relative overflow-hidden" data-wizard-target="wizard-recurring-expenses" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <div className="pt-1">
            {items === null && !error ? (
              <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>Loading…</p>
            ) : expenses.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>No recurring expenses yet.</p>
            ) : (
              expenses.map((item) => (
                <RecurringListRow key={item.recurringId} item={item} externalAccountsById={externalAccountsById} accountsById={accountsById} onSelect={() => { setEditingItem(item); setView("edit"); }} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
