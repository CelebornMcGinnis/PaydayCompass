import React, { useEffect, useState } from "react";
import { ArrowLeft, Plus, Pencil, Trash2, Check, X, Landmark, ChevronDown, Link2, Unlink } from "lucide-react";
import { externalBankAccountsApi, accountsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import InfoBubble from "../components/InfoBubble";


function PerfEdge() {
  return <div className="absolute top-0 left-0 right-0 h-px" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${colors.borderStrong} 0, ${colors.borderStrong} 5px, transparent 5px, transparent 11px)` }} />;
}

function AccountRow({ account, onSave, onDelete, saving, linkedAccount, availableAccounts, onConnect, onDisconnect, connecting, connectError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.name);
  const [connecting_, setConnecting_] = useState(false); // showing the picker, distinct from the `connecting` busy-request prop

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== account.name) await onSave(trimmed);
    setEditing(false);
  }

  return (
    <div className="py-3 px-1" style={{ borderBottom: `1px solid ${colors.border}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: colors.surfaceRaised, color: colors.accentLight }}>
            <Landmark size={15} strokeWidth={1.75} />
          </div>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              className="flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.accentLight}`, color: colors.text }}
            />
          ) : (
            <span className="text-sm truncate" style={{ color: colors.text }}>{account.name}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 pl-2">
          {editing ? (
            <>
              <button onClick={commit} disabled={saving} aria-label="Save" className="p-1.5 rounded-lg" style={{ color: colors.accentLight }}>
                <Check size={16} />
              </button>
              <button onClick={() => { setDraft(account.name); setEditing(false); }} aria-label="Cancel" className="p-1.5 rounded-lg" style={{ color: colors.textMuted }}>
                <X size={16} />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} aria-label="Rename" className="p-1.5 rounded-lg" style={{ color: colors.textMuted }}>
                <Pencil size={15} />
              </button>
              <button onClick={onDelete} aria-label="Delete" className="p-1.5 rounded-lg" style={{ color: colors.alert }}>
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="pl-11 mt-1.5">
        {linkedAccount ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs flex items-center gap-1" style={{ color: colors.textMuted }}>
              <Link2 size={11} /> Connected to <span style={{ color: colors.text }}>{linkedAccount.name}</span>
            </span>
            <button onClick={onDisconnect} disabled={connecting} className="text-xs underline flex items-center gap-1" style={{ color: colors.alert, opacity: connecting ? 0.5 : 1 }}>
              <Unlink size={11} /> Disconnect
            </button>
          </div>
        ) : connecting_ ? (
          <div className="relative inline-block">
            <select
              autoFocus
              defaultValue=""
              onChange={(e) => { if (e.target.value) { onConnect(e.target.value); setConnecting_(false); } }}
              onBlur={() => setConnecting_(false)}
              disabled={connecting}
              className="appearance-none rounded-lg pl-2.5 pr-7 py-1.5 text-xs focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            >
              <option value="" disabled>Choose an account…</option>
              {availableAccounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
          </div>
        ) : (
          <button
            onClick={() => setConnecting_(true)}
            disabled={availableAccounts.length === 0}
            className="text-xs underline flex items-center gap-1"
            style={{ color: availableAccounts.length === 0 ? colors.border : colors.accentLight }}
          >
            <Link2 size={11} /> {availableAccounts.length === 0 ? "No accounts available to connect" : "Connect to an account…"}
          </button>
        )}
        {connectError && <p className="text-xs mt-1" style={{ color: colors.alert }}>{connectError}</p>}
      </div>
    </div>
  );
}

export default function ExternalBankAccountsPage() {
  const [accounts, setAccounts] = useState(null);
  const [inAppAccounts, setInAppAccounts] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectingId, setConnectingId] = useState(null); // externalBankAccountId currently mid-request
  const [connectError, setConnectError] = useState(null); // { externalBankAccountId, message } | null - scoped to one row

  function refresh() {
    externalBankAccountsApi
      .list()
      .then(setAccounts)
      .catch(() => setError("Couldn't load your external bank accounts."));
    // Only the user's own accounts can be connected - a shared account
    // isn't theirs to relabel, and its externalBankAccountId lives on the
    // owner's own record regardless.
    accountsApi
      .list()
      .then((list) => setInAppAccounts(list.filter((a) => !a.sharedFromUserId)))
      .catch(() => {}); // best-effort - connecting is a bonus feature, not core to this page
  }

  useEffect(refresh, []);

  // One-to-one: an in-app account already connected to a DIFFERENT
  // external account isn't offered as a choice for this one, enforced
  // client-side to match the backend's real enforcement in accounts-fn.
  const linkedAccountByExternalId = Object.fromEntries(
    inAppAccounts.filter((a) => a.externalBankAccountId).map((a) => [a.externalBankAccountId, a])
  );
  function availableAccountsFor(externalBankAccountId) {
    return inAppAccounts.filter((a) => !a.externalBankAccountId || a.externalBankAccountId === externalBankAccountId);
  }

  async function connectAccount(externalBankAccountId, accountId) {
    setConnectingId(externalBankAccountId);
    setConnectError(null);
    try {
      await accountsApi.update(accountId, { externalBankAccountId });
      refresh();
    } catch (err) {
      setConnectError({ externalBankAccountId, message: err.message || "Couldn't connect that account." });
    } finally {
      setConnectingId(null);
    }
  }

  async function disconnectAccount(externalBankAccountId) {
    const linked = linkedAccountByExternalId[externalBankAccountId];
    if (!linked) return;
    setConnectingId(externalBankAccountId);
    setConnectError(null);
    try {
      await accountsApi.update(linked.accountId, { externalBankAccountId: null });
      refresh();
    } catch (err) {
      setConnectError({ externalBankAccountId, message: err.message || "Couldn't disconnect that account." });
    } finally {
      setConnectingId(null);
    }
  }

  async function addAccount() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await externalBankAccountsApi.create({ name: trimmed });
      setNewName("");
      setAdding(false);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't add that account.");
    } finally {
      setSaving(false);
    }
  }

  async function renameAccount(id, name) {
    setSaving(true);
    try {
      await externalBankAccountsApi.update(id, { name });
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't rename that account.");
    } finally {
      setSaving(false);
    }
  }

  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteAccount() {
    if (!confirmDeleteAccount) return;
    setDeleting(true);
    setError(null);
    try {
      await externalBankAccountsApi.remove(confirmDeleteAccount.externalBankAccountId);
      setConfirmDeleteAccount(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't delete that account.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="External bank accounts" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Label your real-world bank accounts so recurring bills can be grouped by which one pays for them.</PageBlurb>
        <div className="flex items-start mb-4 px-1">
          <p className="text-xs leading-relaxed" style={{ color: colors.textMuted }}>
            Real-world bank accounts you haven't added to this app, used only to label which
            account a recurring expense actually comes out of.
          </p>
          <InfoBubble text="These aren't linked to real banking in any way — just names you choose, so recurring bills can be grouped by which of your real accounts pays for them." />
        </div>

        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        <div className="rounded-2xl px-4 relative overflow-hidden mb-4" data-wizard-target="wizard-extbank-list" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <PerfEdge />
          <div className="pt-1">
            {accounts === null && !error ? (
              <p className="text-sm py-6 text-center" style={{ color: colors.textMuted }}>Loading…</p>
            ) : accounts && accounts.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: colors.textMuted }}>No external accounts yet.</p>
            ) : (
              (accounts || []).map((a) => (
                <AccountRow
                  key={a.externalBankAccountId}
                  account={a}
                  saving={saving}
                  onSave={(name) => renameAccount(a.externalBankAccountId, name)}
                  onDelete={() => setConfirmDeleteAccount(a)}
                  linkedAccount={linkedAccountByExternalId[a.externalBankAccountId]}
                  availableAccounts={availableAccountsFor(a.externalBankAccountId)}
                  onConnect={(accountId) => connectAccount(a.externalBankAccountId, accountId)}
                  onDisconnect={() => disconnectAccount(a.externalBankAccountId)}
                  connecting={connectingId === a.externalBankAccountId}
                  connectError={connectError && connectError.externalBankAccountId === a.externalBankAccountId ? connectError.message : null}
                />
              ))
            )}
          </div>
        </div>

        {adding ? (
          <div className="rounded-2xl p-3 flex items-center gap-2" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAccount()}
              placeholder="e.g. Chase Checking ...4821"
              className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />
            <button onClick={addAccount} disabled={saving} className="p-2 rounded-lg" style={{ color: colors.accentLight }} aria-label="Add">
              <Check size={18} />
            </button>
            <button onClick={() => { setAdding(false); setNewName(""); }} className="p-2 rounded-lg" style={{ color: colors.textMuted }} aria-label="Cancel">
              <X size={18} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            data-wizard-target="wizard-extbank-add"
            className="w-full rounded-2xl py-3 text-sm font-medium flex items-center justify-center gap-2"
            style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
          >
            <Plus size={16} />
            Add an external bank account
          </button>
        )}
      </div>

      <ConfirmDeleteDialog
        open={!!confirmDeleteAccount}
        title={`Delete "${confirmDeleteAccount?.name}"?`}
        body="Any recurring expenses tagged with this external bank account will show as unassigned."
        busy={deleting}
        error={error}
        onCancel={() => { setConfirmDeleteAccount(null); setError(null); }}
        onConfirm={deleteAccount}
      />
    </div>
  );
}
