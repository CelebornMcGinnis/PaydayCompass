import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock, ShieldCheck } from "lucide-react";
import { useAuth } from "../lib/authContext";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useIsDesktop } from "../lib/useIsDesktop";

export default function LoginPage() {
  const { theme } = useTheme();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { status, signIn, confirmMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

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

  if (status === "mfaRequired") {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: colors.bg, fontFamily: fontBody }}>
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
          <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>
            Password
          </label>
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
