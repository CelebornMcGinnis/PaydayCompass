import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { accountsApi, transactionsApi, divisionsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";

export default function TransferFundsPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState(null);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [fromDivisionId, setFromDivisionId] = useState("");
  const [toDivisionId, setToDivisionId] = useState("");
  const [fromDivisions, setFromDivisions] = useState([]);
  const [toDivisions, setToDivisions] = useState([]);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

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
        if (eligible.length >= 2) {
          setFromAccountId(eligible[0].accountId);
          setToAccountId(eligible[1].accountId);
        }
      })
      .catch(() => setError("Couldn't load your accounts."));
  }, []);

  const fromAccount = (accounts || []).find((a) => a.accountId === fromAccountId);
  const toAccount = (accounts || []).find((a) => a.accountId === toAccountId);
  const fromDivision = fromDivisions.find((d) => d.divisionId === fromDivisionId);
  const toDivision = toDivisions.find((d) => d.divisionId === toDivisionId);
  const sameAccountSameDivision = fromAccountId === toAccountId && fromDivisionId === toDivisionId;
  const availableBalance = fromDivisionId ? (fromDivision ? fromDivision.balance : 0) : (fromAccount ? fromAccount.balance : 0);
  const wouldGoNegative = parseFloat(amount) > availableBalance;
  const canSave = fromAccountId && toAccountId && !sameAccountSameDivision && parseFloat(amount) > 0 && !wouldGoNegative;

  async function handleSubmit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await transactionsApi.transfer({
        fromAccountId,
        toAccountId,
        fromDivisionId: fromDivisionId || undefined,
        toDivisionId: toDivisionId || undefined,
        amount: parseFloat(amount),
        description: description.trim(),
      });
      setDone(true);
      setTimeout(() => navigate("/"), 1200);
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
              {fromDivisions.length > 0 && (
                <div className="relative mt-2">
                  <select
                    value={fromDivisionId}
                    onChange={(e) => setFromDivisionId(e.target.value)}
                    className="w-full appearance-none rounded-lg px-3 py-2 text-xs focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option value="">From the whole account, not a specific division</option>
                    {fromDivisions.map((d) => <option key={d.divisionId} value={d.divisionId}>From division: {d.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
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
              {toDivisions.length > 0 && (
                <div className="relative mt-2">
                  <select
                    value={toDivisionId}
                    onChange={(e) => setToDivisionId(e.target.value)}
                    className="w-full appearance-none rounded-lg px-3 py-2 text-xs focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    <option value="">Into the whole account, not a specific division</option>
                    {toDivisions.map((d) => <option key={d.divisionId} value={d.divisionId}>Into division: {d.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
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
              disabled={!canSave || saving || done}
              className="w-full rounded-xl py-3 text-sm font-medium transition-opacity"
              style={{
                background: canSave ? colors.accent : colors.surfaceRaised,
                color: canSave ? colors.bg : colors.textMuted,
                cursor: canSave ? "pointer" : "not-allowed",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {done ? "Transferred" : saving ? "Transferring…" : "Transfer funds"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
