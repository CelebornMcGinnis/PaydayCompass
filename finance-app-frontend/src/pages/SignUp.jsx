import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, Check } from "lucide-react";
import { signUp, confirmSignUp, resendConfirmationCode } from "../lib/cognito";
import { useAuth } from "../lib/authContext";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useIsDesktop } from "../lib/useIsDesktop";
import { PASSWORD_RULES, EMAIL_RE } from "../lib/passwordRules";

export default function SignUpPage() {
  const { theme } = useTheme();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [step, setStep] = useState("form"); // "form" | "confirm"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);

  const passwordOk = PASSWORD_RULES.every((r) => r.test(password));
  const emailOk = EMAIL_RE.test(email.trim());
  const canSubmit = emailOk && passwordOk && password === confirmPassword;

  async function handleSignUp(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await signUp(email.trim(), password);
      setStep("confirm");
    } catch (err) {
      setError(err.message || "Couldn't create that account.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await confirmSignUp(email.trim(), code);
      // Confirming the code doesn't establish a session by itself - sign
      // in immediately with the same credentials so the user lands
      // straight on the dashboard, which auto-redirects a brand-new user
      // into Getting Setup rather than making them sign in a second time.
      await signIn(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(err.message || "That code didn't work.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    try {
      await resendConfirmationCode(email.trim());
      setCode(""); // the old code is a fresh one's been sent - stale/invalid input shouldn't linger
      setResent(true);
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      setError(err.message || "Couldn't resend the code.");
    }
  }

  const logoSrc = theme === "dark" ? "/paydaycompass-logo-dark.png" : "/paydaycompass-logo-light.png";

  // The confirmation-code step stays a simple centered layout even on
  // desktop, same as Login's MFA step - it's a quick, transient step,
  // not a moment that benefits from the full branding treatment.
  if (step === "confirm") {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 26, fontWeight: 600 }}>Check your email</h1>
            <p className="text-sm mt-1" style={{ color: colors.textMuted }}>We sent a code to {email}</p>
          </div>

          <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <form onSubmit={handleConfirm}>
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
              {resent && <p className="text-xs mb-3" style={{ color: colors.positive }}>Code resent.</p>}
              <button
                type="submit"
                disabled={code.length !== 6 || loading}
                className="w-full rounded-lg py-2.5 text-sm font-medium mb-3"
                style={{ background: colors.accent, color: colors.bg, opacity: code.length !== 6 || loading ? 0.6 : 1 }}
              >
                {loading ? "Confirming…" : "Confirm"}
              </button>
              <button type="button" onClick={handleResend} className="w-full text-xs" style={{ color: colors.textMuted }}>
                Resend code
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
          <img src={logoSrc} alt="PaydayCompass" className="mx-auto mb-4" style={{ width: 180, height: "auto", display: "block" }} />
        </div>
      )}

      <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 26, fontWeight: 600 }} className={isDesktop ? "mb-6" : "text-center mb-8"}>
        Create your account
      </h1>

      <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        <form onSubmit={handleSignUp}>
          <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg px-3 py-2.5 mb-3 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${email && !emailOk ? colors.alert : colors.border}`, color: colors.text }}
          />
          {email && !emailOk && (
            <p className="text-xs mb-3" style={{ color: colors.alert }}>Enter a valid email address</p>
          )}

          <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
            className="w-full rounded-lg px-3 py-2.5 mb-2 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
          />

          {password.length > 0 && (
            <div className="mb-3 space-y-1">
              {PASSWORD_RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <div key={r.label} className="flex items-center gap-1.5 text-xs" style={{ color: ok ? colors.positive : colors.textMuted }}>
                    <Check size={11} style={{ opacity: ok ? 1 : 0.3 }} />
                    {r.label}
                  </div>
                );
              })}
            </div>
          )}

          <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Confirm password</label>
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••••"
            className="w-full rounded-lg px-3 py-2.5 mb-3 text-sm focus:outline-none"
            style={{ background: colors.surface, border: `1px solid ${confirmPassword && confirmPassword !== password ? colors.alert : colors.border}`, color: colors.text }}
          />
          {confirmPassword && confirmPassword !== password && (
            <p className="text-xs mb-3" style={{ color: colors.alert }}>Passwords don't match</p>
          )}

          {error && <p className="text-xs mb-3" style={{ color: colors.alert }}>{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit || loading}
            className="w-full rounded-lg py-2.5 text-sm font-medium transition-opacity"
            style={{ background: colors.accent, color: colors.bg, opacity: !canSubmit || loading ? 0.6 : 1 }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-xs" style={{ color: colors.textMuted }}>
          <Lock size={12} />
          <span>Your data stays private to your account</span>
        </div>
      </div>

      <p className="text-center text-sm mt-5" style={{ color: colors.textMuted }}>
        Already have an account?{" "}
        <button onClick={() => navigate("/login")} className="underline" style={{ color: colors.accentLight }}>
          Sign in
        </button>
      </p>
    </div>
  );

  if (!isDesktop) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
        {formCard}
      </div>
    );
  }

  // Desktop: the same two-panel layout as Login - a branding panel with
  // the full logo and tagline at real size, the form in its own panel.
  return (
    <div className="min-h-screen flex" style={{ background: colors.bg, fontFamily: fontBody }}>
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
