import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Sun, Moon } from "lucide-react";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useIsDesktop } from "../lib/useIsDesktop";
import { contactApi } from "../lib/apiClient";
import PageBlurb from "../components/PageBlurb";

export default function ContactPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isDesktop = useIsDesktop();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const canSend = name.trim() && email.trim() && message.trim() && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await contactApi.send({ name: name.trim(), email: email.trim(), subject: subject.trim(), message: message.trim() });
      setSent(true);
    } catch (err) {
      setError(err.message || "Couldn't send that - try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ background: colors.bg, fontFamily: fontBody }}>
      <div className="flex items-center justify-between px-5 py-4 max-w-2xl mx-auto">
        <button onClick={() => navigate(-1)} aria-label="Back" className="p-1 -ml-1 transition-opacity hover:opacity-70" style={{ color: colors.text }}>
          <ArrowLeft size={20} />
        </button>
        <img src={theme === "dark" ? (isDesktop ? "/ledgerline-logo-dark.png" : "/ledgerline-favicon-dark.png") : (isDesktop ? "/ledgerline-logo-light.png" : "/ledgerline-favicon-light.png")} alt="Ledgerline" style={{ width: isDesktop ? 130 : 24, height: isDesktop ? "auto" : 24 }} />
        <button onClick={toggleTheme} aria-label="Toggle dark/light mode" style={{ color: colors.text }} className="p-1 transition-opacity hover:opacity-70">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-5 pb-10">
        <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 26, fontWeight: 600 }} className="mb-2">Get in touch</h1>
        <PageBlurb>Questions, comments, or concerns - send a message and it'll come straight through.</PageBlurb>

        {sent ? (
          <div className="rounded-2xl p-5 flex items-start gap-3" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
            <Check size={20} style={{ color: colors.positive }} className="shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: colors.text }}>Message sent</p>
              <p className="text-sm" style={{ color: colors.textMuted }}>Thanks for reaching out - you should hear back at the email you provided.</p>
            </div>
          </div>
        ) : (
          <>
            {error && <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>}

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="So we can reply to you"
              className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Subject <span style={{ opacity: 0.6, textTransform: "none" }}>(optional)</span></label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />

            <label className="text-xs uppercase tracking-wide block mb-1.5" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 5000))}
              rows={6}
              className="w-full rounded-lg px-3 py-2.5 text-sm mb-5 focus:outline-none resize-none"
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
            />

            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="w-full rounded-xl py-3 text-sm font-medium transition-opacity"
              style={{ background: canSend ? colors.accent : colors.surfaceRaised, color: canSend ? colors.bg : colors.textMuted }}
            >
              {sending ? "Sending…" : "Send message"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
