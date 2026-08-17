import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ShieldCheck, ChevronRight, Mail, Lock, AlertTriangle, Check, Compass, CreditCard, Sparkles } from "lucide-react";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";
import { preferencesApi, accountDeletionApi, billingApi } from "../lib/apiClient";
import { getCurrentCognitoUser, requestEmailChange, confirmEmailChange, changePassword } from "../lib/cognito";
import { useAuth } from "../lib/authContext";
import { useSubscription } from "../lib/useSubscription";
import { colors, fontDisplay, fontBody } from "../lib/theme";

function SectionHeader({ children }) {
  return (
    <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 15, fontWeight: 600 }} className="mb-2 px-1">
      {children}
    </h3>
  );
}

function Card({ children }) {
  return (
    <div className="rounded-2xl mb-6 overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative rounded-full transition-colors shrink-0"
      style={{ width: 40, height: 22, background: on ? colors.accent : colors.border, opacity: disabled ? 0.5 : 1 }}
      aria-label="Toggle"
    >
      <span className="absolute rounded-full transition-transform" style={{ width: 18, height: 18, top: 2, left: 2, background: colors.text, transform: on ? "translateX(18px)" : "translateX(0)" }} />
    </button>
  );
}

function Row({ children, onClick, last }) {
  const El = onClick ? "button" : "div";
  return (
    <El
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3.5 text-left"
      style={{ borderBottom: last ? "none" : `1px solid ${colors.border}` }}
    >
      {children}
    </El>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { email, signOut } = useAuth();
  const subscription = useSubscription();

  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  const [savingPref, setSavingPref] = useState(false);

  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState(null);
  const billingBanner = searchParams.get("billing"); // "success" | "canceled" | null, set by Stripe's redirect

  useEffect(() => {
    if (!billingBanner) return;
    const t = setTimeout(() => {
      searchParams.delete("billing");
      setSearchParams(searchParams, { replace: true });
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingBanner]);

  async function startCheckout() {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { checkoutUrl } = await billingApi.createCheckoutSession({
        successUrl: `${window.location.origin}/upgrade-success`,
        cancelUrl: `${window.location.origin}/settings?billing=canceled`,
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      setBillingError(err.message || "Couldn't start checkout - try again.");
      setBillingBusy(false);
    }
  }

  async function openBillingPortal() {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { portalUrl } = await billingApi.createPortalSession({
        returnUrl: `${window.location.origin}/settings`,
      });
      window.location.href = portalUrl;
    } catch (err) {
      setBillingError(err.message || "Couldn't open billing management - try again.");
      setBillingBusy(false);
    }
  }

  const [emailStep, setEmailStep] = useState("idle"); // "idle" | "editing" | "confirming"
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailError, setEmailError] = useState(null);
  const [pendingCognitoUser, setPendingCognitoUser] = useState(null);
  const [emailBusy, setEmailBusy] = useState(false);

  const [pwStep, setPwStep] = useState("idle"); // "idle" | "editing"
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  const [deleteStep, setDeleteStep] = useState("idle"); // "idle" | "confirming"
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    preferencesApi.get().then(setPrefs).catch(() => setError("Couldn't load your preferences."));
  }, []);

  async function updatePref(patch) {
    setSavingPref(true);
    try {
      const updated = await preferencesApi.update(patch);
      setPrefs(updated);
    } catch (err) {
      setError(err.message || "Couldn't update that preference.");
    } finally {
      setSavingPref(false);
    }
  }

  async function startEmailChange() {
    setEmailBusy(true);
    setEmailError(null);
    try {
      const user = await getCurrentCognitoUser();
      await requestEmailChange(user, newEmail.trim());
      setPendingCognitoUser(user);
      setEmailStep("confirming");
    } catch (err) {
      setEmailError(err.message || "Couldn't start the email change.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function confirmEmailChangeCode() {
    setEmailBusy(true);
    setEmailError(null);
    try {
      await confirmEmailChange(pendingCognitoUser, emailCode);
      setEmailStep("idle");
      setNewEmail("");
      setEmailCode("");
    } catch (err) {
      setEmailError(err.message || "That code didn't work.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function submitPasswordChange() {
    setPwBusy(true);
    setPwError(null);
    try {
      const user = await getCurrentCognitoUser();
      await changePassword(user, oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setPwStep("idle");
      setPwDone(true);
      setTimeout(() => setPwDone(false), 3000);
    } catch (err) {
      setPwError(err.message || "Couldn't change your password.");
    } finally {
      setPwBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    try {
      await accountDeletionApi.deleteMe();
      signOut();
      navigate("/login");
    } catch (err) {
      setDeleteBusy(false);
      setError(err.message || "Couldn't delete your account - try again.");
    }
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Settings" />

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Change your password or email, turn alerts on or off, set up two-factor authentication, or delete your account.</PageBlurb>
        {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}
        {email && <p className="text-xs mb-6 px-1" style={{ color: colors.textMuted }}>Signed in as {email}</p>}

        <SectionHeader>Security</SectionHeader>
        <Card>
          <Row onClick={() => navigate("/settings/mfa")} last>
            <div className="flex items-center gap-3">
              <ShieldCheck size={16} style={{ color: colors.accentLight }} />
              <span className="text-sm" style={{ color: colors.text }}>Two-factor authentication</span>
            </div>
            <ChevronRight size={16} style={{ color: colors.textMuted }} />
          </Row>
        </Card>

        <SectionHeader>Help</SectionHeader>
        <Card>
          <Row onClick={() => navigate("/?tour=1")} last>
            <div className="flex items-center gap-3">
              <Compass size={16} style={{ color: colors.accentLight }} />
              <span className="text-sm" style={{ color: colors.text }}>Replay app tour</span>
            </div>
            <ChevronRight size={16} style={{ color: colors.textMuted }} />
          </Row>
        </Card>

        <SectionHeader>Notifications</SectionHeader>
        <Card>
          <Row>
            <div className="min-w-0 pr-3">
              <p className="text-sm" style={{ color: colors.text }}>Budget threshold alerts</p>
              <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>Email me at 80% of a budget, when I first go over, and on every purchase while I'm over</p>
            </div>
            {prefs && <Toggle on={prefs.budgetAlertsEnabled} onClick={() => updatePref({ budgetAlertsEnabled: !prefs.budgetAlertsEnabled })} disabled={savingPref} />}
          </Row>
          <Row>
            <div className="min-w-0 pr-3">
              <p className="text-sm" style={{ color: colors.text }}>Low balance alerts</p>
              <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>Email me when any account drops below the amount below</p>
            </div>
            {prefs && <Toggle on={prefs.lowBalanceAlertsEnabled} onClick={() => updatePref({ lowBalanceAlertsEnabled: !prefs.lowBalanceAlertsEnabled })} disabled={savingPref} />}
          </Row>
          {prefs && prefs.lowBalanceAlertsEnabled && (
            <div className="px-4 pb-3.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
              <p className="text-xs mb-1.5" style={{ color: colors.textMuted }}>Alert threshold (applies to every account)</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: "monospace" }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  defaultValue={prefs.lowBalanceThresholdAmount ?? ""}
                  onBlur={(e) => {
                    const val = e.target.value === "" ? null : parseFloat(e.target.value);
                    if (val !== prefs.lowBalanceThresholdAmount) updatePref({ lowBalanceThresholdAmount: val });
                  }}
                  placeholder="100.00"
                  className="w-full rounded-lg pl-6 pr-3 py-2 text-sm focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: "monospace" }}
                />
              </div>
              {prefs.lowBalanceThresholdAmount == null && (
                <p className="text-xs mt-1.5" style={{ color: colors.alert }}>Set an amount above, or this alert won't do anything yet.</p>
              )}
            </div>
          )}
          <Row last>
            <div className="min-w-0 pr-3">
              <p className="text-sm" style={{ color: colors.text }}>Shared-account activity alerts</p>
              <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>Email me when someone I've shared an account with adds, edits, or deletes something</p>
            </div>
            {prefs && <Toggle on={prefs.sharedActivityAlertsEnabled} onClick={() => updatePref({ sharedActivityAlertsEnabled: !prefs.sharedActivityAlertsEnabled })} disabled={savingPref} />}
          </Row>
        </Card>

        <SectionHeader>Billing</SectionHeader>
        {billingBanner === "canceled" && (
          <p className="text-sm mb-3 px-1" style={{ color: colors.textMuted }}>Checkout canceled - no changes made.</p>
        )}
        {billingError && <p className="text-sm mb-3 px-1" style={{ color: colors.alert }}>{billingError}</p>}
        <Card>
          <Row last>
            <div className="flex items-center gap-3 min-w-0">
              {subscription.isPremium ? <Sparkles size={16} style={{ color: colors.accentLight }} /> : <CreditCard size={16} style={{ color: colors.textMuted }} />}
              <div className="min-w-0">
                <p className="text-sm" style={{ color: colors.text }}>
                  {subscription.loading ? "Loading…" : subscription.isPremium ? "Premium" : "Free plan"}
                </p>
                {subscription.isPremium && subscription.cancelAtPeriodEnd && (
                  <p className="text-xs mt-0.5" style={{ color: colors.warning }}>Cancels at the end of the current period</p>
                )}
                {!subscription.isPremium && !subscription.loading && (
                  <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>Upgrade to unlock Scenarios and more</p>
                )}
              </div>
            </div>
            {!subscription.loading && (
              <button
                onClick={subscription.isPremium ? openBillingPortal : startCheckout}
                disabled={billingBusy}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: subscription.isPremium ? "transparent" : colors.accent, border: subscription.isPremium ? `1px solid ${colors.border}` : "none", color: subscription.isPremium ? colors.text : colors.bg, opacity: billingBusy ? 0.6 : 1 }}
              >
                {billingBusy ? "Loading…" : subscription.isPremium ? "Manage billing" : "Upgrade"}
              </button>
            )}
          </Row>
        </Card>
        {subscription.isPremium && (
          <p className="text-xs mb-6 px-1 -mt-4" style={{ color: colors.textMuted }}>
            "Manage billing" opens Stripe's billing page in this tab - look for the back arrow near the top to return here when you're done.
          </p>
        )}

        <SectionHeader>Account</SectionHeader>
        <Card>
          {emailStep === "idle" && (
            <Row onClick={() => setEmailStep("editing")} last={pwStep === "idle" ? false : true}>
              <div className="flex items-center gap-3">
                <Mail size={16} style={{ color: colors.accentLight }} />
                <span className="text-sm" style={{ color: colors.text }}>Change email</span>
              </div>
              <ChevronRight size={16} style={{ color: colors.textMuted }} />
            </Row>
          )}
          {emailStep === "editing" && (
            <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
              <p className="text-xs mb-2" style={{ color: colors.textMuted }}>New email address</p>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              {emailError && <p className="text-xs mb-2" style={{ color: colors.alert }}>{emailError}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setEmailStep("idle"); setNewEmail(""); setEmailError(null); }} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button onClick={startEmailChange} disabled={!newEmail.trim() || emailBusy} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg, opacity: emailBusy ? 0.6 : 1 }}>
                  {emailBusy ? "Sending…" : "Send code"}
                </button>
              </div>
            </div>
          )}
          {emailStep === "confirming" && (
            <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
              <p className="text-xs mb-2" style={{ color: colors.textMuted }}>Enter the code sent to {newEmail}</p>
              <input
                type="text"
                inputMode="numeric"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full rounded-lg px-3 py-2 text-sm mb-2 text-center tracking-[0.3em] focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: "monospace" }}
              />
              {emailError && <p className="text-xs mb-2" style={{ color: colors.alert }}>{emailError}</p>}
              <button onClick={confirmEmailChangeCode} disabled={emailCode.length !== 6 || emailBusy} className="w-full rounded-lg py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg, opacity: emailBusy ? 0.6 : 1 }}>
                {emailBusy ? "Confirming…" : "Confirm"}
              </button>
            </div>
          )}

          {pwStep === "idle" && (
            <Row onClick={() => setPwStep("editing")} last>
              <div className="flex items-center gap-3">
                <Lock size={16} style={{ color: colors.accentLight }} />
                <span className="text-sm" style={{ color: colors.text }}>Change password</span>
              </div>
              {pwDone ? <Check size={16} style={{ color: colors.positive }} /> : <ChevronRight size={16} style={{ color: colors.textMuted }} />}
            </Row>
          )}
          {pwStep === "editing" && (
            <div className="px-4 py-3.5">
              <p className="text-xs mb-2" style={{ color: colors.textMuted }}>Current password</p>
              <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
              <p className="text-xs mb-2" style={{ color: colors.textMuted }}>New password</p>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none" style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }} />
              {pwError && <p className="text-xs mb-2" style={{ color: colors.alert }}>{pwError}</p>}
              <div className="flex gap-2">
                <button onClick={() => { setPwStep("idle"); setOldPw(""); setNewPw(""); setPwError(null); }} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button onClick={submitPasswordChange} disabled={!oldPw || !newPw || pwBusy} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg, opacity: pwBusy ? 0.6 : 1 }}>
                  {pwBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </Card>

        <SectionHeader>Danger zone</SectionHeader>
        <Card>
          {deleteStep === "idle" ? (
            <Row onClick={() => setDeleteStep("confirming")} last>
              <div className="flex items-center gap-3">
                <AlertTriangle size={16} style={{ color: colors.alert }} />
                <span className="text-sm" style={{ color: colors.alert }}>Delete account &amp; all data</span>
              </div>
            </Row>
          ) : (
            <div className="px-4 py-3.5">
              <p className="text-xs mb-3" style={{ color: colors.textMuted }}>
                This permanently deletes every account, transaction, budget, and setting -
                there's no undo. Type <strong style={{ color: colors.text }}>DELETE</strong> to confirm.
              </p>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.alert}`, color: colors.text }}
              />
              <div className="flex gap-2">
                <button onClick={() => { setDeleteStep("idle"); setDeleteConfirmText(""); }} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button
                  onClick={confirmDelete}
                  disabled={deleteConfirmText !== "DELETE" || deleteBusy}
                  className="flex-1 rounded-lg py-2 text-xs font-medium"
                  style={{ background: colors.alert, color: colors.bg, opacity: deleteConfirmText !== "DELETE" || deleteBusy ? 0.5 : 1 }}
                >
                  {deleteBusy ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
