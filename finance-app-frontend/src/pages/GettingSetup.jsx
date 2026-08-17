import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wallet, Bell, Check, ChevronDown } from "lucide-react";
import { accountsApi, preferencesApi } from "../lib/apiClient";
import { getCurrentCognitoUser, markSetupComplete } from "../lib/cognito";
import { useAuth } from "../lib/authContext";
import { colors, fontDisplay, fontBody, fontMono } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";

const STEPS = ["welcome", "account", "communication", "done"];
const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  // credit/investment/other intentionally hidden for now - re-add when ready
];

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

function ProgressDots({ index, count }) {
  return (
    <div className="flex items-center justify-center gap-1.5 mb-8">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-full transition-colors" style={{ width: i === index ? 18 : 6, height: 6, background: i <= index ? colors.accent : colors.border }} />
      ))}
    </div>
  );
}

export default function GettingSetupPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { refreshSetupStatus } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  // Account step
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("checking");
  const [startingBalance, setStartingBalance] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountError, setAccountError] = useState(null);
  const [addedAccounts, setAddedAccounts] = useState([]); // names of accounts saved so far this session

  // Communication step
  const [prefs, setPrefs] = useState(null);
  const [savingPref, setSavingPref] = useState(false);
  const [prefError, setPrefError] = useState(null);

  function next() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }
  async function finish() {
    try {
      const user = await getCurrentCognitoUser();
      await markSetupComplete(user);
      await refreshSetupStatus();
    } catch {
      // best-effort - if this fails, the user just sees the wizard again
      // next time rather than getting stuck on it right now
    }
    navigate("/?tour=1");
  }

  async function createAccount(andContinue) {
    if (!accountName.trim()) {
      next();
      return;
    }
    setSavingAccount(true);
    setAccountError(null);
    try {
      await accountsApi.create({
        name: accountName.trim(),
        type: accountType,
        balance: parseFloat(startingBalance) || 0,
      });
      setAddedAccounts((list) => [...list, accountName.trim()]);
      setAccountName("");
      setStartingBalance("");
      setAccountType("checking");
      if (andContinue) next();
    } catch (err) {
      setAccountError(err.message || "Couldn't create that account - you can add it later from the dashboard.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function loadPrefsIfNeeded() {
    if (prefs) return;
    try {
      const p = await preferencesApi.get();
      setPrefs(p);
    } catch {
      setPrefs({ sharedActivityAlertsEnabled: true, budgetAlertsEnabled: true, lowBalanceAlertsEnabled: false, lowBalanceThresholdAmount: null });
    }
  }

  async function updatePref(patch) {
    const previous = prefs;
    setPrefs((p) => ({ ...p, ...patch })); // optimistic - toggle responds immediately
    setSavingPref(true);
    try {
      const updated = await preferencesApi.update(patch);
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous); // revert - this is the one place a failed save should be visible
      setPrefError(err.message || "Couldn't save that preference - try again.");
    } finally {
      setSavingPref(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: colors.bg, fontFamily: fontBody }}>
      <div className="flex-1 flex flex-col justify-center px-6 py-10 max-w-sm mx-auto w-full">
        <ProgressDots index={stepIndex} count={STEPS.length} />

        {step === "welcome" && (
          <div className="text-center">
            <img
              src={theme === "dark" ? "/ledgerline-logo-dark.png" : "/ledgerline-logo-light.png"}
              alt="Ledgerline"
              className="mx-auto mb-5"
              style={{ width: 200, height: "auto" }}
            />
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 26, fontWeight: 600 }} className="mb-2">Welcome</h1>
            <p className="text-sm mb-8" style={{ color: colors.textMuted }}>
              Two quick things and you'll be set — add your first account, and choose how you want to hear from us. Both take under a minute, and you can change everything later.
            </p>
            <button onClick={next} className="w-full rounded-xl py-3 text-sm font-medium mb-3" style={{ background: colors.accent, color: colors.bg }}>
              Get started
            </button>
            <button onClick={finish} className="w-full text-xs" style={{ color: colors.textMuted }}>
              Skip setup
            </button>
          </div>
        )}

        {step === "account" && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={16} style={{ color: colors.accentLight }} />
              <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 19, fontWeight: 600 }}>Add your first account</h2>
            </div>
            <p className="text-sm mb-5" style={{ color: colors.textMuted }}>Checking, savings, whatever you actually use day to day. Add as many as you want, one at a time.</p>

            {addedAccounts.length > 0 && (
              <div className="rounded-lg px-3 py-2.5 mb-4" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Added so far</p>
                {addedAccounts.map((name, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-sm" style={{ color: colors.text }}>
                    <Check size={12} style={{ color: colors.positive }} />
                    {name}
                  </div>
                ))}
              </div>
            )}

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Name</label>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g. Everyday Checking"
              className="w-full rounded-lg px-3 py-2.5 mb-4 text-sm focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Type</label>
            <div className="relative mb-4">
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value)}
                className="w-full appearance-none rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              >
                {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
            </div>

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Current balance</label>
            <div className="relative mb-5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
              <input
                type="number"
                inputMode="decimal"
                value={startingBalance}
                onChange={(e) => setStartingBalance(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg pl-6 pr-3 py-2.5 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
              />
            </div>

            {accountError && <p className="text-xs mb-3" style={{ color: colors.alert }}>{accountError}</p>}

            {accountName.trim() ? (
              <div className="flex gap-2 mb-3">
                <button onClick={() => createAccount(false)} disabled={savingAccount} className="flex-1 rounded-xl py-3 text-sm font-medium" style={{ border: `1px solid ${colors.borderStrong}`, color: colors.text, opacity: savingAccount ? 0.6 : 1 }}>
                  {savingAccount ? "Saving…" : "Save, add another"}
                </button>
                <button onClick={() => createAccount(true)} disabled={savingAccount} className="flex-1 rounded-xl py-3 text-sm font-medium" style={{ background: colors.accent, color: colors.bg, opacity: savingAccount ? 0.6 : 1 }}>
                  {savingAccount ? "Saving…" : "Save and continue"}
                </button>
              </div>
            ) : (
              <button onClick={next} disabled={addedAccounts.length === 0} className="w-full rounded-xl py-3 text-sm font-medium mb-3" style={{ background: colors.accent, color: colors.bg, opacity: addedAccounts.length === 0 ? 0.5 : 1 }}>
                Continue
              </button>
            )}
            <button onClick={next} className="w-full text-xs" style={{ color: colors.textMuted }}>
              {addedAccounts.length > 0 ? "Skip adding more" : "I'll add this later"}
            </button>
          </div>
        )}

        {step === "communication" && (
          <CommunicationStep prefs={prefs} loadPrefsIfNeeded={loadPrefsIfNeeded} updatePref={updatePref} savingPref={savingPref} prefError={prefError} onNext={next} />
        )}

        {step === "done" && (
          <div className="text-center">
            <div className="inline-flex items-center justify-center rounded-full mb-5" style={{ width: 64, height: 64, background: colors.surfaceRaised, border: `1px solid ${colors.positive}` }}>
              <Check size={28} style={{ color: colors.positive }} />
            </div>
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 24, fontWeight: 600 }} className="mb-2">You're all set</h1>
            <p className="text-sm mb-8" style={{ color: colors.textMuted }}>
              Everything here can be changed anytime from Settings.
            </p>
            <button onClick={finish} className="w-full rounded-xl py-3 text-sm font-medium" style={{ background: colors.accent, color: colors.bg }}>
              Go to dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CommunicationStep({ prefs, loadPrefsIfNeeded, updatePref, savingPref, prefError, onNext }) {
  React.useEffect(() => {
    loadPrefsIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Bell size={16} style={{ color: colors.accentLight }} />
        <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 19, fontWeight: 600 }}>How should we reach you?</h2>
      </div>
      <p className="text-sm mb-3" style={{ color: colors.textMuted }}>
        All of this lives in Settings too, so nothing here is final.
      </p>
      {prefError && <p className="text-xs mb-3" style={{ color: colors.alert }}>{prefError}</p>}

      {!prefs ? (
        <p className="text-sm mb-5" style={{ color: colors.textMuted }}>Loading…</p>
      ) : (
        <div className="rounded-2xl mb-6 overflow-hidden" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${colors.border}` }}>
            <div className="pr-3">
              <p className="text-sm" style={{ color: colors.text }}>Budget threshold alerts</p>
              <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>At 80% of a budget, and when you go over</p>
            </div>
            <Toggle on={prefs.budgetAlertsEnabled} onClick={() => updatePref({ budgetAlertsEnabled: !prefs.budgetAlertsEnabled })} disabled={savingPref} />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="pr-3">
              <p className="text-sm" style={{ color: colors.text }}>Shared-account activity</p>
              <p className="text-xs mt-0.5" style={{ color: colors.textMuted }}>When someone you've shared with adds or changes something</p>
            </div>
            <Toggle on={prefs.sharedActivityAlertsEnabled} onClick={() => updatePref({ sharedActivityAlertsEnabled: !prefs.sharedActivityAlertsEnabled })} disabled={savingPref} />
          </div>
        </div>
      )}

      <p className="text-xs mb-5" style={{ color: colors.textMuted }}>
        Low-balance alerts need a threshold amount, so those are set up in Settings once you know what number makes sense for you.
      </p>

      <button onClick={onNext} className="w-full rounded-xl py-3 text-sm font-medium" style={{ background: colors.accent, color: colors.bg }}>
        Continue
      </button>
    </div>
  );
}
