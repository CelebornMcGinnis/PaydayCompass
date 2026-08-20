import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Wallet, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, Repeat, Plus, Users, ChevronDown } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, ReferenceLine } from "recharts";
import { accountsApi, transactionsApi, divisionsApi, externalBankAccountsApi, paydayApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney, chartCrossesZero, formatChartTick } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import EditExpenseModal from "../components/EditExpenseModal";
import DivisionTrendCharts from "../components/DivisionTrendCharts";
import InfoBubble from "../components/InfoBubble";


function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-xl" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}`, color: colors.text }}>
      <div style={{ color: colors.textMuted }}>{label}</div>
      <div style={{ fontFamily: fontMono }}>{formatMoney(payload[0].value)}</div>
    </div>
  );
}

function TransactionRow({ txn, canModify, onEdit }) {
  const isCredit = txn.direction === "credit";
  const Icon = txn.isTransfer ? Repeat : isCredit ? ArrowDownLeft : ArrowUpRight;
  const iconColor = txn.isTransfer ? colors.textMuted : isCredit ? colors.positive : colors.alert;
  // Only manually-added expenses can be re-split/deleted here - recurring
  // items are managed from the Recurring page, transfers are a paired
  // double-entry record that editing one side of would desync, and
  // income entries don't have a purchaseId to group by.
  const isEditable = canModify && txn.purchaseId && !txn.isTransfer && txn.direction === "debit";
  return (
    <div
      className="flex items-center justify-between py-3 px-1 transition-opacity hover:opacity-80"
      style={{ borderBottom: `1px solid ${colors.border}`, cursor: isEditable ? "pointer" : "default" }}
      onClick={isEditable ? () => onEdit(txn.purchaseId) : undefined}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: colors.surfaceRaised, color: iconColor }}>
          <Icon size={15} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className="text-sm truncate" style={{ color: colors.text }}>{txn.description || txn.category}</p>
          <p className="text-xs" style={{ color: colors.textMuted }}>
            {txn.createdAt?.slice(0, 10)} · {txn.category}
            {txn.source === "recurring" && " · recurring"}
            {txn.isBalanceAdjustment && " · adjustment"}
            {txn.isRetroactiveEntry && " · backfilled for trends"}
          </p>
        </div>
      </div>
      <span className="shrink-0 pl-3 text-sm" style={{ fontFamily: fontMono, color: isCredit ? colors.positive : colors.text }}>
        {isCredit ? "+" : "\u2212"}{formatMoney(txn.amount)}
      </span>
    </div>
  );
}

export default function AccountDetailPage() {
  const navigate = useNavigate();
  const { accountId } = useParams();
  const [account, setAccount] = useState(null);
  const [allAccounts, setAllAccounts] = useState([]);
  const [paydayData, setPaydayData] = useState(null);
  const [externalAccounts, setExternalAccounts] = useState([]);
  const [addingExternalAccount, setAddingExternalAccount] = useState(false);
  const [newExternalAccountName, setNewExternalAccountName] = useState("");
  const [savingExternalAccount, setSavingExternalAccount] = useState(false);
  const [externalAccountError, setExternalAccountError] = useState(null);
  const [editingPurchaseId, setEditingPurchaseId] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [divisions, setDivisions] = useState(null);
  const [divisionsError, setDivisionsError] = useState(null);
  const [addingDivision, setAddingDivision] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState("");
  const [savingDivision, setSavingDivision] = useState(false);
  const [editingDivisionId, setEditingDivisionId] = useState(null);
  const [divisionNameDraft, setDivisionNameDraft] = useState("");

  async function saveRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === account.name) {
      setRenaming(false);
      return;
    }
    setSavingName(true);
    try {
      const updated = await accountsApi.update(accountId, { name: trimmed });
      setAccount((a) => ({ ...a, ...updated }));
      setRenaming(false);
    } catch (err) {
      setError(err.message || "Couldn't rename this account.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await accountsApi.remove(accountId);
      navigate("/");
    } catch (err) {
      // A 409 here means the account still has recurring items tied to
      // it (see lambda/accounts/index.py _delete_account) - the message
      // from the backend already explains what to do next.
      setDeleteError(err.message || "Couldn't delete this account.");
    } finally {
      setDeleting(false);
    }
  }

  function refresh() {
    return Promise.all([accountsApi.list(), transactionsApi.list(accountId), externalBankAccountsApi.list()]).then(([accounts, txns, externals]) => {
      setAccount(accounts.find((a) => a.accountId === accountId) || null);
      setAllAccounts(accounts);
      setTransactions(txns);
      setExternalAccounts(externals);
    });
  }

  // One-to-one: don't offer an external bank account already connected to
  // a DIFFERENT account as a choice here - matches the real enforcement
  // in accounts-fn (PUT /accounts/{id} rejects it with a 409 regardless,
  // this just keeps the picker from offering an option that would fail).
  const availableExternalAccounts = externalAccounts.filter(
    (e) => !allAccounts.some((a) => a.externalBankAccountId === e.externalBankAccountId && a.accountId !== accountId)
  );

  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => {
      if (!cancelled) setError("Couldn't load this account's data.");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function refreshDivisions() {
    divisionsApi
      .list(accountId)
      .then(setDivisions)
      .catch(() => setDivisionsError("Couldn't load this account's divisions."));
  }

  useEffect(refreshDivisions, [accountId]);

  useEffect(() => {
    paydayApi.upcoming().then(setPaydayData).catch(() => setPaydayData(null));
  }, []);

  async function createDivision() {
    const name = newDivisionName.trim();
    if (!name) return;
    setSavingDivision(true);
    setDivisionsError(null);
    try {
      await divisionsApi.create(accountId, { name });
      setAddingDivision(false);
      setNewDivisionName("");
      refreshDivisions();
    } catch (err) {
      setDivisionsError(err.message || "Couldn't create that division.");
    } finally {
      setSavingDivision(false);
    }
  }

  async function saveDivisionEdit(divisionId) {
    setSavingDivision(true);
    setDivisionsError(null);
    try {
      await divisionsApi.update(accountId, divisionId, {
        name: divisionNameDraft.trim(),
      });
      setEditingDivisionId(null);
      refreshDivisions();
    } catch (err) {
      setDivisionsError(err.message || "Couldn't update that division.");
    } finally {
      setSavingDivision(false);
    }
  }

  const [confirmDeleteDivision, setConfirmDeleteDivision] = useState(null);
  const [deletingDivision, setDeletingDivision] = useState(false);

  async function deleteDivision() {
    if (!confirmDeleteDivision) return;
    setDeletingDivision(true);
    setDivisionsError(null);
    try {
      await divisionsApi.remove(accountId, confirmDeleteDivision.divisionId);
      setConfirmDeleteDivision(null);
      setEditingDivisionId(null);
      refreshDivisions();
    } catch (err) {
      setDivisionsError(err.message || "Couldn't delete that division.");
    } finally {
      setDeletingDivision(false);
    }
  }

  // Derived from REAL transaction history, not fabricated: walk backward
  // from the current balance, undoing each transaction's effect, to
  // reconstruct what the balance was at each prior point in time.
  const trendData = useMemo(() => {
    if (!account || !transactions) return [];
    // Retroactive backfill entries (see ManageRecurring/Budgets' past-date
    // confirmation flow) are explicitly excluded here - they were never
    // reflected in the real balance, so including them would reconstruct
    // balance dips/gains that never actually happened. They still count
    // normally in category breakdown below, which is about real spend,
    // not balance reconstruction.
    const sorted = [...transactions]
      .filter((t) => !t.isRetroactiveEntry)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
    let running = account.balance;
    const points = [{ label: "Now", balance: running }];
    for (const t of sorted) {
      running = t.direction === "credit" ? running - t.amount : running + t.amount;
      points.push({ label: t.createdAt?.slice(5, 10) || "", balance: running });
    }
    return points.reverse().slice(-30); // most recent 30 points, oldest to newest
  }, [account, transactions]);

  // recharts' own auto tick generation (no explicit `ticks`/`domain`) can
  // produce unevenly-spaced ticks for certain data ranges - confirmed by
  // reproducing the reported symptom (a non-monotonic sequence like
  // $0, $0.3k, $0.6k, $0.9k, $0.2k) with a formatter whose own math is
  // correct in isolation, meaning the bug was in which raw values
  // recharts chose to tick, not how they were formatted. Computing our
  // own evenly-spaced "nice" ticks from the actual data range sidesteps
  // that entirely.
  const balanceTicks = useMemo(() => {
    const values = trendData.map((p) => p.balance);
    if (values.length === 0) return [];
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    if (min === max) return [min];
    const rawStep = (max - min) / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalized = rawStep / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = niceNormalized * magnitude;
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v));
    return ticks;
  }, [trendData]);

  const categoryBreakdown = useMemo(() => {
    if (!transactions) return [];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const totals = {};
    for (const t of transactions) {
      if (t.direction !== "debit" || t.isTransfer) continue;
      if (!t.createdAt?.startsWith(thisMonth)) continue;
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    }
    return Object.entries(totals)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [transactions]);

  const totalSpend = categoryBreakdown.reduce((s, c) => s + c.amount, 0);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg }}>
        <p className="text-sm" style={{ color: colors.alert }}>{error}</p>
      </div>
    );
  }

  const canModifyTransactions = account && (!account.sharedFromUserId || account.sharedDataPermissions?.modifyTransactions === "edit");
  const divisionsTotal = (divisions || []).reduce((sum, d) => sum + d.balance, 0);

  const dueFromThisAccount = useMemo(() => {
    if (!paydayData || paydayData.mode !== "preview") return 0;
    let total = 0;
    for (const e of paydayData.upcomingExpenses || []) {
      if (e.accountId === accountId) total += e.estimatedAmount;
    }
    for (const b of paydayData.budgetedExpenses || []) {
      if (b.accountId === accountId) total += b.amount;
    }
    for (const pe of [...(paydayData.plannedExpenseContributions || []), ...(paydayData.overduePlannedExpenses || [])]) {
      if (pe.linkedAccountId === accountId) total += pe.amount;
    }
    return total;
  }, [paydayData, accountId]);

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title={account ? account.name : "Loading…"} />

      {account && (
        <div className="px-5 pt-5 max-w-md mx-auto">
          <PageBlurb>This account's balance, transaction history, spending trend, and category breakdown.</PageBlurb>

          {!account.sharedFromUserId && (
            <div className="flex items-center gap-2 mb-4">
              {renaming ? (
                <>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(false); }}
                    className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  />
                  <button onClick={saveRename} disabled={savingName} className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>
                    {savingName ? "…" : "Save"}
                  </button>
                  <button onClick={() => setRenaming(false)} className="rounded-lg px-3 py-2 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                </>
              ) : (
                <>
                  <button onClick={() => { setNameDraft(account.name); setRenaming(true); }} className="text-xs underline" style={{ color: colors.accentLight }}>Rename</button>
                  <button onClick={() => { setShowDeleteConfirm(true); setDeleteError(null); }} className="text-xs underline" style={{ color: colors.alert }}>Delete account</button>
                </>
              )}
            </div>
          )}

          {!account.sharedFromUserId && (
            <div className="mb-4">
              <p className="text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Connected external account <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></p>
              {addingExternalAccount ? (
                <>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={newExternalAccountName}
                      onChange={(e) => setNewExternalAccountName(e.target.value)}
                      placeholder="Bank account name"
                      className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
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
                          setExternalAccounts((list) => [...list, created]);
                          await accountsApi.update(accountId, { externalBankAccountId: created.externalBankAccountId });
                          setAddingExternalAccount(false);
                          setNewExternalAccountName("");
                          refresh();
                        } catch (err) {
                          setExternalAccountError(err.message || "Couldn't connect that account.");
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
                <div className="relative">
                  <select
                    value={account.externalBankAccountId || ""}
                    onChange={async (e) => {
                      if (e.target.value === "__new__") {
                        setAddingExternalAccount(true);
                        return;
                      }
                      setExternalAccountError(null);
                      try {
                        await accountsApi.update(accountId, { externalBankAccountId: e.target.value || null });
                        refresh();
                      } catch (err) {
                        setExternalAccountError(err.message || "Couldn't update the connection.");
                      }
                    }}
                    className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option value="">Not connected</option>
                    {availableExternalAccounts.map((e) => <option key={e.externalBankAccountId} value={e.externalBankAccountId}>{e.name}</option>)}
                    <option value="__new__">+ Add a new external account…</option>
                  </select>
                  <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
              )}
              {externalAccountError && !addingExternalAccount && <p className="text-xs mt-1.5" style={{ color: colors.alert }}>{externalAccountError}</p>}
            </div>
          )}

          {showDeleteConfirm && (
            <div className="rounded-2xl p-4 mb-4" style={{ background: colors.surface, border: `1px solid ${colors.alert}` }}>
              <p className="text-sm mb-1" style={{ color: colors.text }}>Delete "{account.name}"?</p>
              <p className="text-xs mb-3" style={{ color: colors.textMuted }}>
                This can't be undone. If this account still has recurring income or expenses tied to it, you'll need to remove those first.
              </p>
              {deleteError && <p className="text-xs mb-3" style={{ color: colors.alert }}>{deleteError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button onClick={handleDelete} disabled={deleting} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ background: colors.alert, color: colors.bg, opacity: deleting ? 0.6 : 1 }}>
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          )}

          {account.sharedFromUserId && (
            <div className="flex items-center gap-1.5 mb-3 px-1">
              <Users size={13} style={{ color: colors.accentLight }} />
              <span className="text-xs" style={{ color: colors.accentLight }}>
                Shared with you{account.sharedPermission ? ` · ${account.sharedPermission}` : ""} — not an account you own
              </span>
            </div>
          )}
          <div className="rounded-2xl p-5 mb-5 relative overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <p className="text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Current balance</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p style={{ fontFamily: fontMono, fontSize: 30, color: colors.text }}>{formatMoney(account.balance)}</p>
              {divisions && divisions.length > 0 && (
                <p style={{ fontFamily: fontMono, fontSize: 14, color: colors.textMuted }}>({formatMoney(account.balance - divisionsTotal)} unassigned)</p>
              )}
              {dueFromThisAccount > 0.005 && (
                <p style={{ fontFamily: fontMono, fontSize: 14, color: colors.textMuted }}>({formatMoney(account.balance - dueFromThisAccount)} available after upcoming payments)</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate(`/add-expense?accountId=${accountId}`)}
            className="w-full rounded-2xl py-3 mb-6 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
            style={{ background: colors.accent, color: colors.bg }}
          >
            <Plus size={16} />
            Add an expense or deposit
          </button>

          <button
            type="button"
            onClick={() => navigate(`/transfer?accountId=${accountId}`)}
            className="w-full rounded-2xl py-3 mb-6 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          >
            <ArrowLeftRight size={16} />
            Transfer funds
          </button>

          <div className="flex items-center mb-2 px-1">
            <span className="text-sm font-medium" style={{ color: colors.text }}>Divisions</span>
            <InfoBubble text="Named sub-allocations within this account's balance - track that $200 of your total is set aside for one thing while $150 is set aside for another. A recurring item can optionally be tagged with a division, so it adjusts both the account's balance and that division's own balance when it posts." />
          </div>

          {divisionsError && <p className="text-xs mb-3" style={{ color: colors.alert }}>{divisionsError}</p>}

          {divisions === null && !divisionsError && <p className="text-xs mb-3" style={{ color: colors.textMuted }}>Loading…</p>}

          {divisions && divisions.length === 0 && !addingDivision && (
            <p className="text-xs mb-3" style={{ color: colors.textMuted }}>No divisions yet.</p>
          )}

          {divisions && divisions.map((div) =>
            editingDivisionId === div.divisionId ? (
              <div key={div.divisionId} className="rounded-xl p-3 mb-2" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                <input
                  autoFocus
                  value={divisionNameDraft}
                  onChange={(e) => setDivisionNameDraft(e.target.value)}
                  placeholder="Division name"
                  className="w-full rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                />
                <div className="flex gap-2">
                  <button onClick={() => saveDivisionEdit(div.divisionId)} disabled={savingDivision} className="rounded-lg px-3 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>
                    {savingDivision ? "…" : "Save"}
                  </button>
                  <button onClick={() => setEditingDivisionId(null)} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                </div>
                <button onClick={() => setConfirmDeleteDivision(div)} className="text-xs underline mt-2" style={{ color: colors.alert }}>Delete this division</button>
              </div>
            ) : (
              <button
                key={div.divisionId}
                onClick={() => {
                  setEditingDivisionId(div.divisionId);
                  setDivisionNameDraft(div.name);
                }}
                className="w-full flex items-center justify-between rounded-xl px-4 py-3 mb-2 text-left transition-opacity hover:opacity-80"
                style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
              >
                <span className="text-sm" style={{ color: colors.text }}>{div.name}</span>
                <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(div.balance)}</span>
              </button>
            )
          )}

          {divisions && divisions.length > 0 && (
            <div className="flex items-center justify-between px-1 mb-3">
              <span className="text-xs font-medium" style={{ color: colors.textMuted }}>Total in divisions</span>
              <span style={{ fontFamily: fontMono, fontSize: 14, color: colors.text }}>{formatMoney(divisionsTotal)}</span>
            </div>
          )}

          {addingDivision ? (
            <div className="rounded-xl p-3 mb-4" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <input
                autoFocus
                value={newDivisionName}
                onChange={(e) => setNewDivisionName(e.target.value)}
                placeholder="Division name"
                className="w-full rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              <div className="flex gap-2">
                <button onClick={createDivision} disabled={savingDivision || !newDivisionName.trim()} className="rounded-lg px-3 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>
                  {savingDivision ? "…" : "Add"}
                </button>
                <button onClick={() => { setAddingDivision(false); setNewDivisionName(""); }} className="rounded-lg px-3 text-xs" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
              </div>
            </div>
          ) : (
            !account.sharedFromUserId && (
              <button onClick={() => setAddingDivision(true)} className="w-full rounded-xl py-2.5 mb-4 text-sm font-medium flex items-center justify-center gap-2" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
                <Plus size={15} /> Add division
              </button>
            )
          )}

          <div className="mb-6">
            <div className="flex items-center mb-2 px-1">
              <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Balance trend</h3>
              <InfoBubble text="Reconstructed from your actual transaction history, working backward from today's balance - the last 30 changes on this account." />
            </div>
            {trendData.length > 1 ? (
              <div className="rounded-2xl p-3 pt-4" style={{ background: colors.surface, border: `1px solid ${colors.border}`, height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={colors.border} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: colors.textMuted, fontSize: 10 }} axisLine={{ stroke: colors.border }} tickLine={false} interval={Math.ceil(trendData.length / 6)} />
                    {/* width=56 (not 44) - the chart's negative left margin
                        anchors right-aligned tick text around x = margin.left
                        + width (~8px with the old width), and a 5-character
                        label like "$1.5k" needs more run-up than that leaves
                        before it, so its leading characters fell into
                        negative-x territory outside the SVG viewBox and got
                        clipped (rendered as ".5k") - confirmed via the DOM's
                        own text content being correct while only the visual
                        render was cut off. */}
                    <YAxis tick={{ fill: colors.textMuted, fontSize: 10, fontFamily: fontMono }} axisLine={false} tickLine={false} width={56} domain={[balanceTicks[0], balanceTicks[balanceTicks.length - 1]]} ticks={balanceTicks} tickFormatter={formatChartTick} />
                    <Tooltip content={<CustomTooltip />} />
                    {chartCrossesZero(trendData, ["balance"]) && <ReferenceLine y={0} stroke={colors.alert} strokeWidth={1.5} />}
                    <Line type="monotone" dataKey="balance" stroke={colors.accentLight} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm" style={{ color: colors.textMuted }}>Not enough transaction history yet to chart a trend.</p>
            )}
          </div>

          {divisions && divisions.length > 0 && (
            <DivisionTrendCharts accountId={accountId} divisions={divisions} transactions={transactions || []} />
          )}

          <div className="mb-6">
            <div className="flex items-center mb-2 px-1">
              <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Spending by category</h3>
              <InfoBubble text="This account's debits this calendar month, grouped by category. Transfers aren't counted." />
              <span className="text-xs ml-auto" style={{ color: colors.textMuted }}>{formatMoney(totalSpend)} total</span>
            </div>
            {categoryBreakdown.length > 0 ? (
              <div className="rounded-2xl p-3 pt-4" style={{ background: colors.surface, border: `1px solid ${colors.border}`, height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="category" type="category" tick={{ fill: colors.text, fontSize: 11 }} axisLine={false} tickLine={false} width={92} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: colors.border }} />
                    <Bar dataKey="amount" fill={colors.accent} radius={[0, 6, 6, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm" style={{ color: colors.textMuted }}>No spending on this account yet this month.</p>
            )}
          </div>

          <div>
            <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-1 px-1">Transactions</h3>
            <div className="rounded-2xl px-4 relative overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <div className="pt-1">
                {transactions.length === 0 ? (
                  <p className="text-sm py-6 text-center" style={{ color: colors.textMuted }}>No transactions yet.</p>
                ) : (
                  [...transactions]
                    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                    .map((t) => <TransactionRow key={t.txnId} txn={t} canModify={canModifyTransactions} onEdit={setEditingPurchaseId} />)
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={!!confirmDeleteDivision}
        title={`Delete "${confirmDeleteDivision?.name}"?`}
        body="This can't be undone. Any recurring items tagged with this division will stop updating a division balance, but will keep posting normally otherwise."
        busy={deletingDivision}
        error={divisionsError}
        onCancel={() => { setConfirmDeleteDivision(null); setDivisionsError(null); }}
        onConfirm={deleteDivision}
      />

      {editingPurchaseId && (
        <EditExpenseModal
          accountId={accountId}
          rows={(transactions || []).filter((t) => t.purchaseId === editingPurchaseId)}
          divisions={divisions || []}
          onClose={() => setEditingPurchaseId(null)}
          onSaved={() => {
            setEditingPurchaseId(null);
            refresh();
          }}
          onDeleted={() => {
            setEditingPurchaseId(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
