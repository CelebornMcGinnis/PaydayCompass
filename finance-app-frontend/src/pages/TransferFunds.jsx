import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, ChevronDown, Check } from "lucide-react";
import { accountsApi, transactionsApi, divisionsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import DivisionSelect from "../components/DivisionSelect";

export default function TransferFundsPage() {
  const [searchParams] = useSearchParams();
  const presetFromAccountId = searchParams.get("accountId");

  const [accounts, setAccounts] = useState(null);
  const [fromAccountId, setFromAccountId] = useState(presetFromAccountId || "");
  const [toAccountId, setToAccountId] = useState("");
  const [fromDivisionId, setFromDivisionId] = useState("");
  const [toDivisionId, setToDivisionId] = useState("");
  const [fromDivisions, setFromDivisions] = useState([]);
  const [toDivisions, setToDivisions] = useState([]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (!fromAccountId) {
      setFromDivisions([]);
      return;
    }
    let cancelled = false;
    divisionsApi
      .list(fromAccountId)
      .then((list) => {
        if (cancelled) return;
        setFromDivisions(list);
        setFromDivisionId((current) => (current && !list.some((d) => d.divisionId === current) ? "" : current));
      })
      .catch(() => {
        if (!cancelled) setFromDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fromAccountId]);

  useEffect(() => {
    if (!toAccountId) {
      setToDivisions([]);
      return;
    }
    let cancelled = false;
    divisionsApi
      .list(toAccountId)
      .then((list) => {
        if (cancelled) return;
        setToDivisions(list);
        setToDivisionId((current) => (current && !list.some((d) => d.divisionId === current) ? "" : current));
      })
      .catch(() => {
        if (!cancelled) setToDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [toAccountId]);

  useEffect(() => {
    accountsApi
      .list()
      .then((accts) => {
        // Shared accounts can't be transferred to/from unless you have
        // edit access - view-only shares would let you "move" money you
        // can't actually touch.
        const eligible = accts.filter((a) => !a.sharedFromUserId || a.sharedPermission === "edit");
        setAccounts(eligible);
      })
      .catch(() => setError("Couldn't load your accounts."));
  }, []);

  useEffect(() => {
    if (!accounts) return;
    let cancelled = false;
    const byId = {};
    accounts.forEach((a) => {
      byId[a.accountId] = a.name;
    });
    Promise.all(accounts.map((a) => transactionsApi.list(a.accountId).catch(() => [])))
      .then((perAccount) => {
        if (cancelled) return;
        const seen = new Set();
        const rows = [];
        perAccount.flat().forEach((txn) => {
          if (!txn.isTransfer || txn.direction !== "debit" || seen.has(txn.transferId)) return;
          seen.add(txn.transferId);
          rows.push({
            transferId: txn.transferId,
            createdAt: txn.createdAt,
            amount: txn.amount,
            description: txn.description,
            fromName: byId[txn.accountId] || "Unknown account",
            toName: byId[txn.transferCounterpartyAccountId] || "Unknown account",
          });
        });
        rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accounts]);

  const fromAccount = (accounts || []).find((a) => a.accountId === fromAccountId);
  const toAccount = (accounts || []).find((a) => a.accountId === toAccountId);
  const fromDivision = fromDivisions.find((d) => d.divisionId === fromDivisionId);
  const toDivision = toDivisions.find((d) => d.divisionId === toDivisionId);
  // fromAccountId must actually be chosen first - otherwise "" === ""
  // trivially satisfies both equality checks below and this shows a
  // "choose a different account" warning before the user has picked
  // anything at all.
  const sameAccountSameDivision = !!fromAccountId && fromAccountId === toAccountId && fromDivisionId === toDivisionId;
  const availableBalance = fromDivisionId ? (fromDivision ? fromDivision.balance : 0) : (fromAccount ? fromAccount.balance : 0);
  const wouldGoNegative = parseFloat(amount) > availableBalance;
  const canSave = fromAccountId && toAccountId && !sameAccountSameDivision && parseFloat(amount) > 0 && !wouldGoNegative;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await transactionsApi.transfer({
        fromAccountId,
        toAccountId,
        fromDivisionId: fromDivisionId || undefined,
        toDivisionId: toDivisionId || undefined,
        amount: parseFloat(amount),
        description: description.trim(),
      });
      setConfirmation({
        amount: parseFloat(amount),
        description: description.trim(),
        fromName: fromAccount ? fromAccount.name : "",
        toName: toAccount ? toAccount.name : "",
      });
      setHistory((current) => [
        {
          transferId: result.transferId,
          createdAt: result.out.createdAt,
          amount: result.out.amount,
          description: result.out.description,
          fromName: fromAccount ? fromAccount.name : "Unknown account",
          toName: toAccount ? toAccount.name : "Unknown account",
        },
        ...(current || []),
      ]);
      setAmount("");
      setDescription("");
      // The account/division balances shown above (and in their selects'
      // "Balance: $X" labels) just changed server-side, but nothing here
      // re-fetches them automatically - without this they'd keep showing
      // pre-transfer numbers until the next full page load, even though
      // the transfer itself (confirmation banner, history table) is
      // already correctly reflected.
      accountsApi
        .list()
        .then((accts) => setAccounts(accts.filter((a) => !a.sharedFromUserId || a.sharedPermission === "edit")))
        .catch(() => {});
      if (fromDivisionId) divisionsApi.list(fromAccountId).then(setFromDivisions).catch(() => {});
      if (toDivisionId) divisionsApi.list(toAccountId).then(setToDivisions).catch(() => {});
    } catch (err) {
      setError(err.message || "Couldn't complete that transfer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Transfer funds" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Move money between two of your own accounts - this posts real, linked transactions on both sides.</PageBlurb>

        {accounts === null && !error && <p className="text-sm" style={{ color: colors.textMuted }}>Loading your accounts…</p>}
        {accounts !== null && accounts.length < 2 && (
          <p className="text-sm" style={{ color: colors.textMuted }}>You need at least two accounts (that you can edit) to transfer between them.</p>
        )}
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        {confirmation && (
          <div className="rounded-2xl p-5 mb-5 flex items-start gap-3" style={{ background: colors.surface, border: `1px solid ${colors.accent}` }}>
            <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 24, height: 24, background: colors.accent, color: colors.bg }}>
              <Check size={14} />
            </div>
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: colors.text }}>
                Transferred {formatMoney(confirmation.amount)} from {confirmation.fromName} to {confirmation.toName}
              </p>
              {confirmation.description && <p className="text-xs" style={{ color: colors.textMuted }}>{confirmation.description}</p>}
              <button
                type="button"
                onClick={() => setConfirmation(null)}
                className="text-xs underline mt-2"
                style={{ color: colors.accentLight }}
              >
                Make another transfer
              </button>
            </div>
          </div>
        )}

        {accounts && accounts.length >= 2 && (
          <>
            <div className="mb-4">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>From</label>
              <div className="relative">
                <select
                  value={fromAccountId}
                  onChange={(e) => setFromAccountId(e.target.value)}
                  className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
              </div>
              {fromAccount && (
                <p className="text-xs mt-1.5" style={{ color: colors.textMuted }}>
                  Balance: {formatMoney(fromAccount.balance)}
                  {fromDivision && ` · ${fromDivision.name}: ${formatMoney(fromDivision.balance)}`}
                </p>
              )}
              {fromAccountId && (
                <DivisionSelect
                  accountId={fromAccountId}
                  divisions={fromDivisions}
                  value={fromDivisionId}
                  onChange={setFromDivisionId}
                  onDivisionCreated={(division) => {
                    setFromDivisions((current) => [...current, division]);
                    setFromDivisionId(division.divisionId);
                  }}
                  wholeLabel="From the whole account, not a specific division"
                />
              )}
            </div>

            <div className="flex justify-center my-1">
              <div className="flex items-center justify-center rounded-full" style={{ width: 28, height: 28, background: colors.surfaceRaised, color: colors.accentLight }}>
                <ArrowRight size={14} />
              </div>
            </div>

            <div className="mb-5">
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>To</label>
              <div className="relative">
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
              </div>
              {toAccount && (
                <p className="text-xs mt-1.5" style={{ color: colors.textMuted }}>
                  Balance: {formatMoney(toAccount.balance)}
                  {toDivision && ` · ${toDivision.name}: ${formatMoney(toDivision.balance)}`}
                </p>
              )}
              {sameAccountSameDivision && (
                <p className="text-xs mt-1.5" style={{ color: colors.alert }}>
                  {fromAccountId === toAccountId ? "Choose a different division, or a different account." : "Choose two different accounts."}
                </p>
              )}
              {toAccountId && (
                <DivisionSelect
                  accountId={toAccountId}
                  divisions={toDivisions}
                  value={toDivisionId}
                  onChange={setToDivisionId}
                  onDivisionCreated={(division) => {
                    setToDivisions((current) => [...current, division]);
                    setToDivisionId(division.divisionId);
                  }}
                  wholeLabel="Into the whole account, not a specific division"
                />
              )}
            </div>

            <div className="rounded-2xl p-5 mb-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <label className="text-xs uppercase tracking-wide block mb-2" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Amount</label>
              <div className="relative mb-4">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-2xl" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="w-full pl-6 py-1 text-3xl bg-transparent focus:outline-none"
                  style={{ color: colors.text, fontFamily: fontMono, border: "none" }}
                />
              </div>
              {wouldGoNegative && (
                <p className="text-xs mb-4" style={{ color: colors.alert }}>
                  Only {formatMoney(availableBalance)} available {fromDivisionId ? "in that division" : "in that account"} - this would take it negative.
                </p>
              )}
              <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
                Description <span style={{ opacity: 0.6 }}>(optional)</span>
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 250))}
                placeholder="What's this for?"
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSave || saving}
              className="w-full rounded-xl py-3 text-sm font-medium transition-opacity"
              style={{
                background: canSave ? colors.accent : colors.surfaceRaised,
                color: canSave ? colors.bg : colors.textMuted,
                cursor: canSave ? "pointer" : "not-allowed",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Transferring…" : "Transfer funds"}
            </button>
          </>
        )}

        {history && history.length > 0 && (
          <div className="mt-8">
            <p className="text-xs uppercase tracking-wide mb-2 px-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Transfer history</p>
            <div className="rounded-2xl overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: colors.textMuted }}>Date</th>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: colors.textMuted }}>From</th>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: colors.textMuted }}>To</th>
                      <th className="text-right px-3 py-2 font-medium" style={{ color: colors.textMuted }}>Amount</th>
                      <th className="text-left px-3 py-2 font-medium" style={{ color: colors.textMuted }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((t) => (
                      <tr key={t.transferId} style={{ borderTop: `1px solid ${colors.border}` }}>
                        <td className="px-3 py-2" style={{ color: colors.text, fontFamily: fontMono }}>{t.createdAt?.slice(0, 10)}</td>
                        <td className="px-3 py-2" style={{ color: colors.text }}>{t.fromName}</td>
                        <td className="px-3 py-2" style={{ color: colors.text }}>{t.toName}</td>
                        <td className="text-right px-3 py-2" style={{ color: colors.text, fontFamily: fontMono }}>{formatMoney(t.amount)}</td>
                        <td className="px-3 py-2" style={{ color: colors.textMuted }}>{t.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
