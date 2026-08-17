import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, ShieldCheck, Copy, Check } from "lucide-react";
import { getCurrentCognitoUser, beginTotpSetup, verifyTotpSetup, enableTotpMfaPreference } from "../lib/cognito";
import { useAuth } from "../lib/authContext";
import { colors, fontDisplay, fontBody, fontMono } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";

export default function MfaSetupPage() {
  const navigate = useNavigate();
  const { email } = useAuth();
  const [setupInfo, setSetupInfo] = useState(null); // { secretCode, otpauthUrl, cognitoUser }
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurrentCognitoUser()
      .then((cognitoUser) => beginTotpSetup(cognitoUser, email).then((info) => ({ ...info, cognitoUser })))
      .then((info) => {
        if (!cancelled) setSetupInfo(info);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Couldn't start MFA setup - try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function handleVerify(e) {
    e.preventDefault();
    if (!setupInfo) return;
    setVerifying(true);
    setError(null);
    try {
      await verifyTotpSetup(setupInfo.cognitoUser, code);
      // Verifying the code proves the app is generating valid codes, but
      // Cognito won't actually challenge future sign-ins with it until
      // it's also set as the preferred method - both steps are required.
      await enableTotpMfaPreference(setupInfo.cognitoUser);
      setDone(true);
    } catch (err) {
      setError(err.message || "That code didn't verify - check your app and try again.");
      setCode("");
    } finally {
      setVerifying(false);
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(setupInfo.secretCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Two-factor authentication" />

      <div className="px-5 pt-6 max-w-sm mx-auto">
        <PageBlurb>Add a second layer of protection to your account with an authenticator app, on top of your password.</PageBlurb>
        {loading && <p className="text-sm" style={{ color: colors.textMuted }}>Setting up…</p>}

        {error && !done && (
          <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>
        )}

        {done ? (
          <div className="text-center pt-8">
            <div className="inline-flex items-center justify-center rounded-full mb-5" style={{ width: 64, height: 64, background: colors.surfaceRaised, border: `1px solid ${colors.positive}` }}>
              <Check size={28} style={{ color: colors.positive }} />
            </div>
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 22, fontWeight: 600 }}>You're all set</h1>
            <p className="text-sm mt-2 mb-6" style={{ color: colors.textMuted }}>
              From now on, a risky sign-in will ask for a code from your authenticator app.
            </p>
            <button
              onClick={() => navigate("/settings")}
              className="w-full rounded-xl py-3 text-sm font-medium"
              style={{ background: colors.accent, color: colors.bg }}
            >
              Done
            </button>
          </div>
        ) : (
          setupInfo && (
            <>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center rounded-full mb-4" style={{ width: 56, height: 56, background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
                  <ShieldCheck size={22} style={{ color: colors.accentLight }} />
                </div>
                <p className="text-sm" style={{ color: colors.textMuted }}>
                  Scan this with an authenticator app — Google Authenticator, Authy, 1Password, or similar.
                </p>
              </div>

              <div className="flex justify-center mb-5">
                <div className="rounded-2xl p-4" style={{ background: "#FFFFFF" }}>
                  <QRCodeSVG value={setupInfo.otpauthUrl} size={180} />
                </div>
              </div>

              <div className="rounded-xl p-3 mb-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                <p className="text-xs mb-1.5" style={{ color: colors.textMuted }}>Can't scan? Enter this code manually:</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs break-all" style={{ color: colors.text, fontFamily: fontMono }}>{setupInfo.secretCode}</code>
                  <button onClick={copySecret} aria-label="Copy secret" className="shrink-0" style={{ color: colors.accentLight }}>
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
              </div>

              <form onSubmit={handleVerify}>
                <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
                  Enter the 6-digit code from your app
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="w-full rounded-lg px-3 py-3 mb-4 text-center text-2xl tracking-[0.3em] focus:outline-none"
                  style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: "monospace" }}
                />
                {error && <p className="text-xs mb-3" style={{ color: colors.alert }}>{error}</p>}
                <button
                  type="submit"
                  disabled={verifying || code.length !== 6}
                  className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity"
                  style={{ background: colors.accent, color: colors.bg, opacity: verifying || code.length !== 6 ? 0.6 : 1 }}
                >
                  {verifying ? "Verifying…" : "Turn on two-factor authentication"}
                </button>
              </form>
            </>
          )
        )}
      </div>
    </div>
  );
}
