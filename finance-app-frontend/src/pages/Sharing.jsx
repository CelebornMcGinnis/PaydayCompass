import React, { useEffect, useState } from "react";
import { Plus, ChevronDown, X, Check, UserMinus } from "lucide-react";
import { accountsApi, sharingApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";

const DATA_TYPES = [
  { key: "recurring", label: "Recurring bills & income" },
  { key: "income", label: "Income schedule" },
  { key: "budgets", label: "Budgets" },
  { key: "projections", label: "Projections" },
  { key: "plannedExpenses", label: "Planned expenses" },
  {
    key: "modifyTransactions",
    label: "Modify or delete transactions",
    info: "Lets them change or completely remove expenses you've already recorded - not just add their own. This is different from the account access above, which already lets an editor add new transactions; this specifically covers rewriting or erasing existing ones. Off by default, since it's a meaningfully bigger trust step than adding entries.",
  },
];
const PERMISSION_OPTIONS = [
  { value: "not_shared", label: "Not shared" },
  { value: "view", label: "View only" },
  { value: "edit", label: "Can edit" },
];


function SectionHeader({ children }) {
  return <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-2 px-1">{children}</h3>;
}

function Card({ children }) {
  return <div className="rounded-2xl mb-6 overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>{children}</div>;
}

function InviteForm({ accounts, onCancel, onSave, saving }) {
  const [email, setEmail] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState(accounts[0] ? [accounts[0].accountId] : []);
  const [accountPermission, setAccountPermission] = useState("view");
  const [dataPermissions, setDataPermissions] = useState(Object.fromEntries(DATA_TYPES.map((d) => [d.key, "not_shared"])));

  const canSave = email.trim() && selectedAccountIds.length > 0;

  function toggleAccount(accountId) {
    setSelectedAccountIds((ids) => (ids.includes(accountId) ? ids.filter((id) => id !== accountId) : [...ids, accountId]));
  }

  return (
    <div className="rounded-2xl p-4 mb-5" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Share account(s)</span>
        <button onClick={onCancel} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
      </div>

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Their email</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="someone@example.com" className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />

      <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
        Accounts <span style={{ opacity: 0.6, textTransform: "none" }}>(pick one or more — one invite, one email either way)</span>
      </label>
      <div className="rounded-lg mb-3" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
        {accounts.map((a, i) => {
          const checked = selectedAccountIds.includes(a.accountId);
          return (
            <button
              key={a.accountId}
              type="button"
              onClick={() => toggleAccount(a.accountId)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-opacity hover:opacity-80"
              style={{ borderBottom: i < accounts.length - 1 ? `1px solid ${colors.border}` : "none" }}
            >
              <span className="flex items-center justify-center rounded shrink-0" style={{ width: 16, height: 16, border: `1.5px solid ${checked ? colors.accentLight : colors.borderStrong}`, background: checked ? colors.accentLight : "transparent" }}>
                {checked && <Check size={11} style={{ color: colors.bg }} />}
              </span>
              <span className="text-sm" style={{ color: colors.text }}>{a.name}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center mb-1.5">
        <label className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Account access</label>
        <InfoBubble text="View only lets them see this account's transactions and balance but never change anything. Can edit lets them add, edit, and delete transactions on it too - this is enforced on every request, not just hidden in the UI." />
      </div>
      <div className="flex rounded-lg p-1 mb-4" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
        {[{ key: "view", label: "View only" }, { key: "edit", label: "Can edit" }].map((opt) => (
          <button key={opt.key} type="button" onClick={() => setAccountPermission(opt.key)} className="flex-1 rounded-md py-1.5 text-xs font-medium" style={{ background: accountPermission === opt.key ? colors.accent : "transparent", color: accountPermission === opt.key ? colors.bg : colors.textMuted }}>
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center mb-2">
        <p className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Also share</p>
        <InfoBubble text="Each of these is independent of the account access above and of each other — sharing the account view-only doesn't mean any of this is shared too, unless you set it here. Applies the same way to every account selected above." />
      </div>
      {DATA_TYPES.map((dt) => (
        <div key={dt.key} className="flex items-center justify-between mb-2.5">
          <div className="flex items-center">
            <span className="text-sm" style={{ color: colors.text }}>{dt.label}</span>
            {dt.info && <InfoBubble text={dt.info} />}
          </div>
          <div className="relative" style={{ width: 130 }}>
            <select
              value={dataPermissions[dt.key]}
              onChange={(e) => setDataPermissions((p) => ({ ...p, [dt.key]: e.target.value }))}
              className="w-full appearance-none rounded-lg px-2.5 py-1.5 text-xs focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            >
              {PERMISSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
          </div>
        </div>
      ))}

      <button
        type="button"
        disabled={!canSave || saving}
        onClick={() => onSave({ invitedEmail: email.trim(), accountIds: selectedAccountIds, accountPermission, dataPermissions })}
        className="w-full rounded-lg py-2.5 text-sm font-medium mt-2"
        style={{ background: canSave ? colors.accent : colors.surface, color: canSave ? colors.bg : colors.textMuted, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "Sending…" : selectedAccountIds.length > 1 ? `Send invite (${selectedAccountIds.length} accounts)` : "Send invite"}
      </button>
    </div>
  );
}

/** Groups flat share rows by the other person (ownerUserId or
 * invitedUserId, depending on direction) - a single invite can now cover
 * several accounts, which means several rows sharing that same person. */
function groupByPerson(shares, personKey) {
  const groups = new Map();
  for (const s of shares) {
    const key = s[personKey];
    if (!groups.has(key)) groups.set(key, { ...s, accountIds: [], accountsDetail: [], statuses: new Set() });
    const group = groups.get(key);
    group.accountIds.push(s.accountId);
    group.accountsDetail.push(s);
    group.statuses.add(s.status);
  }
  return [...groups.values()];
}

function PermissionEditor({ share, accountName, onSave, saving }) {
  const [accountPermission, setAccountPermission] = useState(share.accountPermission);
  const [dataPermissions, setDataPermissions] = useState({ ...share.dataPermissions });
  const dirty = accountPermission !== share.accountPermission || JSON.stringify(dataPermissions) !== JSON.stringify(share.dataPermissions);

  return (
    <div className="rounded-lg p-3 mt-2" style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
      <p className="text-xs mb-2" style={{ color: colors.textMuted }}>{accountName}</p>
      <div className="flex rounded-lg p-1 mb-3" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        {[{ key: "view", label: "View only" }, { key: "edit", label: "Can edit" }].map((opt) => (
          <button key={opt.key} type="button" onClick={() => setAccountPermission(opt.key)} className="flex-1 rounded-md py-1.5 text-xs font-medium" style={{ background: accountPermission === opt.key ? colors.accent : "transparent", color: accountPermission === opt.key ? colors.bg : colors.textMuted }}>
            {opt.label}
          </button>
        ))}
      </div>
      {DATA_TYPES.map((dt) => (
        <div key={dt.key} className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <span className="text-xs" style={{ color: colors.text }}>{dt.label}</span>
            {dt.info && <InfoBubble text={dt.info} />}
          </div>
          <div className="relative" style={{ width: 120 }}>
            <select
              value={dataPermissions[dt.key] || "not_shared"}
              onChange={(e) => setDataPermissions((p) => ({ ...p, [dt.key]: e.target.value }))}
              className="w-full appearance-none rounded-lg px-2 py-1 text-xs focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            >
              {PERMISSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
          </div>
        </div>
      ))}
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={() => onSave({ accountPermission, dataPermissions })}
        className="w-full rounded-lg py-2 text-xs font-medium mt-1"
        style={{ background: dirty ? colors.accent : colors.surface, color: dirty ? colors.bg : colors.textMuted, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
      </button>
    </div>
  );
}

function PersonShareGroup({ group, accountNames, onRevoke, revoking, onUpdatePermissions }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState(null);
  const [savingAccountId, setSavingAccountId] = useState(null);
  const allAccepted = ![...group.statuses].includes("pending");

  return (
    <div style={{ borderBottom: `1px solid ${colors.border}` }}>
      <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-opacity hover:opacity-80">
        <div className="min-w-0 pr-3">
          <p className="text-sm truncate" style={{ color: colors.text }}>{group.invitedEmail}</p>
          <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>
            {group.accountIds.length} account{group.accountIds.length > 1 ? "s" : ""} shared
            {!allAccepted && " · pending"}
          </p>
        </div>
        <ChevronDown size={16} style={{ color: colors.textMuted, transform: expanded ? "rotate(180deg)" : "none" }} className="transition-transform shrink-0" />
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          {group.accountsDetail.map((share) => (
            <div key={share.accountId} className="mb-2">
              <button
                type="button"
                onClick={() => setExpandedAccountId((id) => (id === share.accountId ? null : share.accountId))}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-opacity hover:opacity-80"
                style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}
              >
                <span className="text-sm truncate" style={{ color: colors.text }}>{accountNames[share.accountId] || share.accountId}</span>
                <span className="text-xs shrink-0 pl-2" style={{ color: colors.textMuted }}>{share.accountPermission}</span>
              </button>
              {expandedAccountId === share.accountId && (
                <PermissionEditor
                  share={share}
                  accountName={accountNames[share.accountId] || share.accountId}
                  saving={savingAccountId === share.accountId}
                  onSave={async (updates) => {
                    setSavingAccountId(share.accountId);
                    await onUpdatePermissions(group.invitedUserId, share.accountId, updates);
                    setSavingAccountId(null);
                  }}
                />
              )}
            </div>
          ))}
          <button onClick={() => onRevoke(group.invitedUserId)} disabled={revoking === group.invitedUserId} className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium mt-1" style={{ color: colors.alert, border: `1px solid ${colors.border}` }}>
            <UserMinus size={13} />
            {revoking === group.invitedUserId ? "Revoking…" : "Revoke all access"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SharingPage() {
  const [accounts, setAccounts] = useState([]);
  const [shares, setShares] = useState(null); // { asOwner, asInvited }
  const [accountNames, setAccountNames] = useState({});
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [respondingTo, setRespondingTo] = useState(null);
  const [revoking, setRevoking] = useState(null);

  function refresh() {
    Promise.all([accountsApi.list(), sharingApi.list()])
      .then(([accts, shareData]) => {
        setAccounts(accts.filter((a) => !a.sharedFromUserId)); // only accounts THEY own can be shared out
        setAccountNames(Object.fromEntries(accts.map((a) => [a.accountId, a.name])));
        setShares(shareData);
      })
      .catch(() => setError("Couldn't load sharing info."));
  }

  useEffect(refresh, []);

  async function sendInvite(payload) {
    setSaving(true);
    setError(null);
    try {
      await sharingApi.create(payload);
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't send that invite.");
    } finally {
      setSaving(false);
    }
  }

  async function respond(ownerUserId, status) {
    setRespondingTo(ownerUserId);
    try {
      await sharingApi.respond(ownerUserId, status);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't respond to that invite.");
    } finally {
      setRespondingTo(null);
    }
  }

  async function revoke(invitedUserId) {
    setRevoking(invitedUserId);
    try {
      await sharingApi.revoke(invitedUserId);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't revoke that share.");
    } finally {
      setRevoking(null);
    }
  }

  async function updatePermissions(invitedUserId, accountId, updates) {
    try {
      await sharingApi.updatePermissions(invitedUserId, accountId, updates);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't update those permissions.");
    }
  }

  const asInvited = shares?.asInvited || [];
  const pendingInvitesForMe = groupByPerson(asInvited.filter((s) => s.status === "pending"), "ownerUserId");
  const acceptedSharesToMe = groupByPerson(asInvited.filter((s) => s.status === "accepted"), "ownerUserId");
  const mySharesOut = groupByPerson(shares?.asOwner || [], "invitedUserId");

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Sharing" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Share an account with someone else — you choose exactly what they can see or edit, down to individual data types.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        {pendingInvitesForMe.length > 0 && (
          <>
            <SectionHeader>Waiting on you</SectionHeader>
            <Card>
              {pendingInvitesForMe.map((s, i) => {
                const extendedGrants = Object.entries(s.dataPermissions || {}).filter(([, v]) => v !== "not_shared");
                const accountLabel = s.accountIds.length > 1 ? `${s.accountIds.length} accounts` : (accountNames[s.accountIds[0]] || "an account");
                return (
                  <div key={s.ownerUserId} className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: i < pendingInvitesForMe.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                    <div className="min-w-0 pr-3">
                      <p className="text-sm truncate" style={{ color: colors.text }}>{s.ownerEmail || "Someone"} wants to share {accountLabel}</p>
                      <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>Account access: {s.accountPermission}</p>
                      {extendedGrants.length > 0 && (
                        <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>
                          Also: {extendedGrants.map(([k, v]) => `${k} (${v})`).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => respond(s.ownerUserId, "accepted")} disabled={respondingTo === s.ownerUserId} className="p-1.5 rounded-lg" style={{ background: colors.accent, color: colors.bg }} aria-label="Accept"><Check size={14} /></button>
                      <button onClick={() => respond(s.ownerUserId, "declined")} disabled={respondingTo === s.ownerUserId} className="p-1.5 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} aria-label="Decline"><X size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </Card>
          </>
        )}

        {showForm ? (
          <InviteForm accounts={accounts} onCancel={() => setShowForm(false)} onSave={sendInvite} saving={saving} />
        ) : (
          <button type="button" onClick={() => setShowForm(true)} disabled={accounts.length === 0} className="w-full rounded-2xl py-3 mb-6 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
            <Plus size={16} />
            Share an account
          </button>
        )}

        <SectionHeader>People you've shared with</SectionHeader>
        <Card>
          {mySharesOut.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>You haven't shared any accounts yet.</p>
          ) : (
            mySharesOut.map((group) => (
              <PersonShareGroup
                key={group.invitedUserId}
                group={group}
                accountNames={accountNames}
                onRevoke={revoke}
                revoking={revoking}
                onUpdatePermissions={updatePermissions}
              />
            ))
          )}
        </Card>

        {acceptedSharesToMe.length > 0 && (
          <>
            <SectionHeader>Shared with you</SectionHeader>
            <Card>
              {acceptedSharesToMe.map((s, i) => (
                <div key={s.ownerUserId} className="px-4 py-3.5" style={{ borderBottom: i < acceptedSharesToMe.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                  <p className="text-sm" style={{ color: colors.text }}>{s.accountIds.map((id) => accountNames[id] || "An account").join(", ")} · {s.accountPermission}</p>
                  {s.ownerEmail && <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>Shared by {s.ownerEmail}</p>}
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
