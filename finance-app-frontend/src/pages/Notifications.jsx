import React, { useEffect, useState } from "react";
import { ArrowLeft, Plus, X, Check, UserMinus, Send, AlertTriangle } from "lucide-react";
import { peerAgreementsApi, peerNotificationsApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";


function SectionHeader({ children, info }) {
  return (
    <div className="flex items-center mb-2 px-1">
      <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>{children}</h3>
      {info && <InfoBubble text={info} />}
    </div>
  );
}

function Card({ children }) {
  return <div className="rounded-2xl mb-6 overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>{children}</div>;
}

export default function NotificationsPage() {
  const { theme } = useTheme();
  const [notifications, setNotifications] = useState(null);
  const [agreements, setAgreements] = useState(null);
  const [error, setError] = useState(null);

  const [showPropose, setShowPropose] = useState(false);
  const [proposeEmail, setProposeEmail] = useState("");
  const [proposing, setProposing] = useState(false);

  const [showSend, setShowSend] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendDueDate, setSendDueDate] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState(null);
  const [busy, setBusy] = useState(null);

  function refresh() {
    peerNotificationsApi.list().then((d) => setNotifications(d.notifications)).catch(() => setError("Couldn't load notifications."));
    peerAgreementsApi.list().then((d) => setAgreements(d.agreements)).catch(() => setError("Couldn't load agreements."));
  }
  useEffect(refresh, []);

  const pendingForMe = (agreements || []).filter((a) => a.role === "recipient" && a.status === "pending");
  const acceptedAsSender = (agreements || []).filter((a) => a.role === "sender" && a.status === "accepted");
  const otherAccepted = (agreements || []).filter((a) => a.role === "recipient" && a.status === "accepted");
  const myPendingProposals = (agreements || []).filter((a) => a.role === "sender" && a.status === "pending");

  async function proposeAgreement() {
    if (!proposeEmail.trim()) return;
    setProposing(true);
    setError(null);
    try {
      await peerAgreementsApi.propose({ recipientEmail: proposeEmail.trim() });
      setProposeEmail("");
      setShowPropose(false);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't send that request.");
    } finally {
      setProposing(false);
    }
  }

  async function respondToAgreement(senderUserId, status) {
    setBusy(senderUserId);
    try {
      await peerAgreementsApi.respond(senderUserId, status);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't respond.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setBusy(revokeTarget);
    try {
      await peerAgreementsApi.revoke(revokeTarget);
      setRevokeTarget(null);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't revoke that.");
    } finally {
      setBusy(null);
    }
  }

  async function sendNotification() {
    setSending(true);
    setError(null);
    try {
      await peerNotificationsApi.create({ recipientEmail: sendEmail, amount: parseFloat(sendAmount), dueDate: sendDueDate, message: sendMessage.trim() });
      setSendEmail("");
      setSendAmount("");
      setSendDueDate("");
      setSendMessage("");
      setShowSend(false);
    } catch (err) {
      setError(err.message || "Couldn't send that notification.");
    } finally {
      setSending(false);
    }
  }

  async function dismissNotification(id) {
    try {
      await peerNotificationsApi.remove(id);
      refresh();
    } catch (err) {
      setError(err.message || "Couldn't dismiss that.");
    }
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Notifications" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Fund-movement alerts between you and people you trust — both sides have to agree before either can send them.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

        {notifications && notifications.filter((n) => n.isExpanded).length > 0 && (
          <>
            <SectionHeader>Fund movements</SectionHeader>
            {notifications.filter((n) => n.isExpanded).map((n) => (
              <div key={n.notificationId} className="rounded-2xl p-4 mb-3" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.accentLight}` }}>
                <div className="flex items-start justify-between mb-1">
                  <span style={{ fontFamily: fontMono, fontSize: 18, color: colors.positive }}>{formatMoney(n.amount)}</span>
                  <button onClick={() => dismissNotification(n.notificationId)} aria-label="Dismiss" style={{ color: colors.textMuted }}><X size={16} /></button>
                </div>
                <p className="text-sm mb-1" style={{ color: colors.text }}>{n.message}</p>
                <p className="text-xs" style={{ color: colors.textMuted }}>Due {n.dueDate}</p>
              </div>
            ))}
          </>
        )}

        {showSend ? (
          <div className="rounded-2xl p-4 mb-6" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Let someone know</span>
              <button onClick={() => setShowSend(false)} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
            </div>
            {acceptedAsSender.length === 0 ? (
              <p className="text-sm" style={{ color: colors.textMuted }}>Nobody's accepted an agreement to receive notifications from you yet.</p>
            ) : (
              <>
                <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>To</label>
                <div className="relative mb-3">
                  <select value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}>
                    <option value="">Choose…</option>
                    {acceptedAsSender.map((a) => <option key={a.recipientUserId} value={a.recipientEmail}>{a.recipientEmail}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 mb-3">
                  <input type="number" inputMode="decimal" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} placeholder="$0.00" className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }} />
                  <input type="date" value={sendDueDate} onChange={(e) => setSendDueDate(e.target.value)} className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, colorScheme: theme }} />
                </div>
                <textarea value={sendMessage} onChange={(e) => setSendMessage(e.target.value.slice(0, 500))} rows={2} placeholder="e.g. Moved this for your Discover payment" className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none resize-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
                <button onClick={sendNotification} disabled={!sendEmail || !sendAmount || !sendDueDate || !sendMessage.trim() || sending} className="w-full rounded-lg py-2.5 text-sm font-medium" style={{ background: colors.accent, color: colors.bg, opacity: sending ? 0.6 : 1 }}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </>
            )}
          </div>
        ) : (
          <button onClick={() => setShowSend(true)} data-wizard-target="wizard-notify-send" className="w-full rounded-2xl py-3 mb-6 text-sm font-medium flex items-center justify-center gap-2" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
            <Send size={15} />
            Let someone know
          </button>
        )}

        {pendingForMe.length > 0 && (
          <>
            <SectionHeader>Waiting on you</SectionHeader>
            <Card>
              {pendingForMe.map((a, i) => (
                <div key={a.senderUserId} className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: i < pendingForMe.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                  <p className="text-sm truncate pr-2" style={{ color: colors.text }}>Someone wants to send you fund-movement alerts</p>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => respondToAgreement(a.senderUserId, "accepted")} disabled={busy === a.senderUserId} className="p-1.5 rounded-lg" style={{ background: colors.accent, color: colors.bg }} aria-label="Accept"><Check size={14} /></button>
                    <button onClick={() => respondToAgreement(a.senderUserId, "declined")} disabled={busy === a.senderUserId} className="p-1.5 rounded-lg" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }} aria-label="Decline"><X size={14} /></button>
                  </div>
                </div>
              ))}
            </Card>
          </>
        )}

        <div data-wizard-target="wizard-notify-agreements">
        <SectionHeader info="Fund-movement notifications require mutual agreement — propose someone, and they have to accept before you can notify them.">
          Notification agreements
        </SectionHeader>
        <Card>
          {myPendingProposals.length === 0 && otherAccepted.length === 0 && acceptedAsSender.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: colors.textMuted }}>No agreements yet.</p>
          ) : (
            <>
              {myPendingProposals.map((a) => (
                <div key={`p-${a.recipientUserId}`} className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <div className="min-w-0 pr-2">
                    <span className="text-sm truncate block" style={{ color: colors.text }}>{a.recipientEmail}</span>
                    <span className="text-xs" style={{ color: colors.textMuted }}>pending</span>
                  </div>
                  <button onClick={() => setRevokeTarget(a.recipientUserId)} aria-label="Cancel" style={{ color: colors.alert }}><UserMinus size={15} /></button>
                </div>
              ))}
              {acceptedAsSender.map((a) => (
                <div key={`s-${a.recipientUserId}`} className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <span className="text-sm truncate" style={{ color: colors.text }}>You notify {a.recipientEmail}</span>
                  <button onClick={() => setRevokeTarget(a.recipientUserId)} aria-label="Revoke" style={{ color: colors.alert }}><UserMinus size={15} /></button>
                </div>
              ))}
              {otherAccepted.map((a, i) => (
                <div key={`r-${a.senderUserId}`} className="flex items-center justify-between px-4 py-3" style={{ borderBottom: i < otherAccepted.length - 1 ? `1px solid ${colors.border}` : "none" }}>
                  <span className="text-sm" style={{ color: colors.text }}>Someone notifies you</span>
                  <button onClick={() => setRevokeTarget(a.senderUserId)} aria-label="Revoke" style={{ color: colors.alert }}><UserMinus size={15} /></button>
                </div>
              ))}
            </>
          )}
        </Card>
        </div>

        {showPropose ? (
          <div className="rounded-2xl p-4" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }}>Propose an agreement</span>
              <button onClick={() => setShowPropose(false)} aria-label="Cancel" style={{ color: colors.textMuted }}><X size={16} /></button>
            </div>
            <input type="email" value={proposeEmail} onChange={(e) => setProposeEmail(e.target.value)} placeholder="their-email@example.com" className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
            <button onClick={proposeAgreement} disabled={!proposeEmail.trim() || proposing} className="w-full rounded-lg py-2.5 text-sm font-medium" style={{ background: colors.accent, color: colors.bg, opacity: proposing ? 0.6 : 1 }}>
              {proposing ? "Sending…" : "Send request"}
            </button>
          </div>
        ) : (
          <button onClick={() => setShowPropose(true)} className="w-full rounded-2xl py-3 text-sm font-medium flex items-center justify-center gap-2" style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}>
            <Plus size={16} />
            Propose an agreement
          </button>
        )}

        {revokeTarget && (
          <div className="fixed inset-0 flex items-center justify-center px-6 z-50" style={{ background: "rgba(15,27,45,0.8)" }}>
            <div className="rounded-2xl p-5 max-w-sm w-full" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} style={{ color: colors.alert }} />
                <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }}>Revoke this agreement?</span>
              </div>
              <p className="text-sm mb-4" style={{ color: colors.textMuted }}>
                They'll be notified this agreement ended. You can propose a new one later if you both want to resume.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setRevokeTarget(null)} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button onClick={confirmRevoke} disabled={busy === revokeTarget} className="flex-1 rounded-lg py-2 text-sm font-medium" style={{ background: colors.alert, color: colors.bg, opacity: busy === revokeTarget ? 0.6 : 1 }}>
                  {busy === revokeTarget ? "Revoking…" : "Revoke"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
