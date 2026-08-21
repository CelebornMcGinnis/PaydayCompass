import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ShieldCheck, Check, Sun, Moon } from "lucide-react";
import { useAuth } from "../lib/authContext";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useIsDesktop } from "../lib/useIsDesktop";
import { forgotPassword, confirmForgotPassword } from "../lib/cognito";
import { PASSWORD_RULES, EMAIL_RE } from "../lib/passwordRules";

function ThemeToggleButton({ theme, toggleTheme }) {
  return (
    <button onClick={toggleTheme} aria-label="Toggle dark/light mode" style={{ color: colors.text }} className="fixed top-4 right-4 z-10 p-1 transition-opacity hover:opacity-70">
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export default function LoginPage() {
  const { theme, toggleTheme } = useTheme();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { status, signIn, confirmMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // "Forgot password" is entirely local state, separate from useAuth()'s
  // status - it never touches a real session, since the whole point is
  // recovering access without one.
  const [step, setStep] = useState("signIn"); // "signIn" | "forgotRequest" | "forgotConfirm" | "forgotDone"
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resent, setResent] = useState(false);

  const newPasswordOk = PASSWORD_RULES.every((r) => r.test(newPassword));
  const canResetPassword = resetCode.length === 6 && newPasswordOk && newPassword === confirmNewPassword;

  function startForgotPassword() {
    setError(null);
    setForgotEmail(email);
    setStep("forgotRequest");
  }

  function backToSignIn() {
    setError(null);
    setStep("signIn");
    setForgotEmail("");
    setResetCode("");
    setNewPassword("");
    setConfirmNewPassword("");
  }

  async function handleForgotRequest(e) {
    e.preventDefault();
    if (!EMAIL_RE.test(forgotEmail.trim())) return;
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(forgotEmail.trim());
      setStep("forgotConfirm");
    } catch (err) {
      setError(err.message || "Couldn't send a reset code - try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendResetCode() {
    setError(null);
    try {
      await forgotPassword(forgotEmail.trim());
      setResetCode(""); // the old code is stale the moment a fresh one's sent
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      setError(err.message || "Couldn't resend the code.");
    }
  }

  async function handleForgotConfirm(e) {
    e.preventDefault();
    if (!canResetPassword) return;
    setError(null);
    setLoading(true);
    try {
      await confirmForgotPassword(forgotEmail.trim(), resetCode, newPassword);
      setStep("forgotDone");
    } catch (err) {
      setError(err.message || "That code didn't work.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      // If this triggered an MFA challenge, useAuth().status flips to
      // "mfaRequired" and the code-entry form below renders instead -
      // nothing further to do here. Otherwise App.jsx's router redirects.
    } catch (err) {
      setError(err.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await confirmMfa(mfaCode);
    } catch (err) {
      setError(err.message || "That code didn't work - try again");
      setMfaCode("");
    } finally {
      setLoading(false);
    }
  }

  const logoSrc = theme === "dark" ? "/paydaycompass-logo-dark.png" : "/paydaycompass-logo-light.png";
  const forgotEmailOk = EMAIL_RE.test(forgotEmail.trim());

  // Every forgot-password step stays a simple centered layout regardless
  // of desktop, same reasoning as the MFA step below - a quick, transient
  // detour, not a moment that benefits from the full branding treatment.
  if (step === "forgotRequest") {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 24, fontWeight: 600 }}>Reset your password</h1>
            <p className="text-sm mt-1" style={{ color: colors.textMuted }}>Enter your email and we'll send you a code to reset it.</p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <form onSubmit={handleForgotRequest}>
              <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Email</label>
              <input
                type="email"
                autoFocus
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg px-3 py-2.5 mb-4 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              {error && <p className="text-xs mb-3" style={{ color: colors.alert }}>{error}</p>}
              <button
                type="submit"
                disabled={loading || !forgotEmailOk}
                className="w-full rounded-lg py-2.5 text-sm font-medium mb-3 transition-opacity hover:opacity-90"
                style={{ background: colors.accent, color: colors.bg, opacity: loading || !forgotEmailOk ? 0.6 : 1 }}
              >
                {loading ? "Sending…" : "Send reset code"}
              </button>
              <button type="button" onClick={backToSignIn} className="w-full text-xs" style={{ color: colors.textMuted }}>
                Back to sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (step === "forgotConfirm") {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 24, fontWeight: 600 }}>Check your email</h1>
            <p className="text-sm mt-1" style={{ color: colors.textMuted }}>We sent a code to {forgotEmail.trim()}</p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <form onSubmit={handleForgotConfirm}>
              <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Code</label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                required
                maxLength={6}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full rounded-lg px-3 py-3 mb-4 text-center text-2xl tracking-[0.3em] focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: "monospace" }}
              />

              <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>New password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full rounded-lg px-3 py-2.5 mb-2 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />

              {newPassword.length > 0 && (
                <div className="mb-3 space-y-1">
                  {PASSWORD_RULES.map((r) => {
                    const ok = r.test(newPassword);
                    return (
                      <div key={r.label} className="flex items-center gap-1.5 text-xs" style={{ color: ok ? colors.positive : colors.textMuted }}>
                        <Check size={11} style={{ opacity: ok ? 1 : 0.3 }} />
                        {r.label}
                      </div>
                    );
                  })}
                </div>
              )}

              <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Confirm new password</label>
              <input
                type="password"
                required
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full rounded-lg px-3 py-2.5 mb-3 text-sm focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${confirmNewPassword && confirmNewPassword !== newPassword ? colors.alert : colors.border}`, color: colors.text }}
              />
              {confirmNewPassword && confirmNewPassword !== newPassword && (
                <p className="text-xs mb-3" style={{ color: colors.alert }}>Passwords don't match</p>
              )}

              {error && <p className="text-xs mb-3" style={{ color: colors.alert }}>{error}</p>}
              {resent && <p className="text-xs mb-3" style={{ color: colors.positive }}>Code resent.</p>}

              <button
                type="submit"
                disabled={!canResetPassword || loading}
                className="w-full rounded-lg py-2.5 text-sm font-medium mb-3 transition-opacity hover:opacity-90"
                style={{ background: colors.accent, color: colors.bg, opacity: !canResetPassword || loading ? 0.6 : 1 }}
              >
                {loading ? "Resetting…" : "Reset password"}
              </button>
              <button type="button" onClick={handleResendResetCode} className="w-full text-xs mb-1" style={{ color: colors.textMuted }}>
                Resend code
              </button>
              <button type="button" onClick={backToSignIn} className="w-full text-xs" style={{ color: colors.textMuted }}>
                Back to sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  if (step === "forgotDone") {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center rounded-full mb-4"
              style={{ width: 56, height: 56, background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}
            >
              <Check size={22} style={{ color: colors.positive }} />
            </div>
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 24, fontWeight: 600 }}>Password reset</h1>
            <p className="text-sm mt-1" style={{ color: colors.textMuted }}>Sign in with your new password.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEmail(forgotEmail.trim());
              setPassword("");
              backToSignIn();
            }}
            className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: colors.accent, color: colors.bg }}
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (status === "mfaRequired") {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center rounded-full mb-4"
              style={{ width: 56, height: 56, background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}
            >
              <ShieldCheck size={22} style={{ color: colors.accentLight }} />
            </div>
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 24, fontWeight: 600 }}>Enter your code</h1>
            <p className="text-sm mt-1" style={{ color: colors.textMuted }}>
              This sign-in looked a little different than usual, so we need the 6-digit code from your authenticator app.
            </p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <form onSubmit={handleMfaSubmit}>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                required
                maxLength={6}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="w-full rounded-lg px-3 py-3 mb-4 text-center text-2xl tracking-[0.3em] focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: "monospace" }}
              />
              {error && <p className="text-xs mb-3" style={{ color: colors.alert }}>{error}</p>}
              <button
                type="submit"
                disabled={loading || mfaCode.length !== 6}
                className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
                style={{ background: colors.accent, color: colors.bg, opacity: loading || mfaCode.length !== 6 ? 0.6 : 1 }}
              >
                {loading ? "Verifying…" : "Verify"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const formCard = (
    <div className="w-full max-w-sm">
      {!isDesktop && (
        <div className="text-center mb-8">
          <img
            src={logoSrc}
            alt="PaydayCompass"
            className="mx-auto mb-4"
            style={{ width: 190, height: "auto", display: "block" }}
          />
          <p className="text-sm mt-1" style={{ color: colors.textMuted }}>Every account, one honest balance.</p>
        </div>
      )}

      {isDesktop && (
        <h1 className="mb-6" style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 26, fontWeight: 600 }}>Welcome back</h1>
      )}

      <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        <form onSubmit={handleSubmit}>
          <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg px-3 py-2.5 mb-4 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          />
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
              Password
            </label>
            <button type="button" onClick={startForgotPassword} className="text-xs underline" style={{ color: colors.accentLight }}>
              Forgot password?
            </button>
          </div>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
            className="w-full rounded-lg px-3 py-2.5 mb-3 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          />

          {error && (
            <p className="text-xs mb-3" style={{ color: colors.alert }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: colors.accent, color: colors.bg, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-xs" style={{ color: colors.textMuted }}>
          <Lock size={12} />
          <span>Protected with adaptive sign-in checks</span>
        </div>
      </div>

      <p className="text-center text-sm mt-5" style={{ color: colors.textMuted }}>
        New here?{" "}
        <button onClick={() => navigate("/signup")} className="underline" style={{ color: colors.accentLight }}>
          Create an account
        </button>
      </p>
    </div>
  );

  if (!isDesktop) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
        {formCard}
      </div>
    );
  }

  // Desktop: a two-panel layout - a branding panel carrying the full
  // logo and tagline at real size, the form in its own focused panel
  // alongside it. The old layout was just the mobile card stretched
  // into a lot of empty space either side; this actually uses the
  // width instead of ignoring it.
  return (
    <div className="min-h-screen flex" style={{ background: colors.bg, fontFamily: fontBody }}>
      <ThemeToggleButton theme={theme} toggleTheme={toggleTheme} />
      <div
        className="flex-1 flex flex-col justify-between p-12"
        style={{ background: colors.surface, borderRight: `1px solid ${colors.border}` }}
      >
        <img src={logoSrc} alt="PaydayCompass" style={{ width: 200, height: "auto" }} />
        <div>
          <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 28, fontWeight: 600, lineHeight: 1.3 }} className="mb-3">
            Every account,<br />one honest balance.
          </p>
          <p className="text-sm" style={{ color: colors.textMuted, maxWidth: 380 }}>
            Track every account, budget with real numbers, and see exactly where your money's going - all in one place.
          </p>
        </div>
        <div />
      </div>
      <div className="flex-1 flex items-center justify-center px-10">
        {formCard}
      </div>
    </div>
  );
}
