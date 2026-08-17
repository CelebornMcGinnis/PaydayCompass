import React, { useState } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import PageHeader from "../components/PageHeader";
import PageBlurb from "../components/PageBlurb";

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }} className="mb-2">
        {title}
      </h3>
      <div className="text-sm leading-relaxed" style={{ color: colors.textMuted }}>
        {children}
      </div>
    </div>
  );
}

const TERMS_SECTIONS = [
  { title: "1. Acceptance of Terms", body: "[PLACEHOLDER] By creating an account, you agree to these Terms of Use. If you do not agree, do not use the app." },
  { title: "2. What This App Does", body: "[PLACEHOLDER] This app helps you track personal financial accounts, transactions, budgets, and projections that you enter yourself. It does not connect to your bank, move real money, or provide financial, tax, or investment advice." },
  { title: "3. Your Responsibilities", body: "[PLACEHOLDER] You're responsible for the accuracy of the data you enter, for keeping your login credentials secure, and for reviewing any shared or peer-notification data before acting on it." },
  { title: "4. Sharing & Peer Features", body: "[PLACEHOLDER] Sharing an account or sending fund-movement notifications to another user requires their explicit acceptance. Either party may revoke that consent at any time." },
  { title: "5. No Financial Advice", body: "[PLACEHOLDER] Projections, budgets, and scenario calculations are estimates based on the data you provide. They are not financial, tax, or legal advice." },
  { title: "6. Account Termination", body: "[PLACEHOLDER] You may delete your account and all associated data at any time from Settings. This action is permanent." },
  { title: "7. Changes to These Terms", body: "[PLACEHOLDER] These terms may be updated from time to time. Continued use after a change constitutes acceptance of the revised terms." },
];

const PRIVACY_SECTIONS = [
  { title: "1. What We Collect", body: "[PLACEHOLDER] Account information you provide (email, financial data you enter: accounts, transactions, budgets), and standard technical data (login timestamps, device/browser info) needed to operate the app securely." },
  { title: "2. How We Use It", body: "[PLACEHOLDER] To operate core features (tracking, budgets, projections, notifications), to send account-related emails (budget alerts, fund-movement notifications you've agreed to receive), and to maintain security." },
  { title: "3. What We Don't Do", body: "[PLACEHOLDER] We do not sell your financial data. We do not share your data with third parties for advertising. We do not connect to or access your real bank accounts." },
  { title: "4. Data Sharing Between Users", body: "[PLACEHOLDER] Data is only visible to another user if you explicitly invite them and they accept, at the specific permission level (view or edit) you choose per data type (account, income, budgets, projections, recurring, planned expenses). You can revoke this at any time." },
  { title: "5. Data Retention & Deletion", body: "[PLACEHOLDER] Your data is retained as long as your account is active. Deleting your account permanently removes your data across the app, as described in Settings." },
  { title: "6. Security", body: "[PLACEHOLDER] We use industry-standard practices (encryption in transit, access controls, least-privilege permissions) to protect your data, but no system is 100% secure." },
  { title: "7. Your Choices", body: "[PLACEHOLDER] You can control notification preferences, sharing permissions, and peer-notification agreements at any time from Settings and the Notifications page." },
  { title: "8. Contact", body: "[PLACEHOLDER] Questions about this policy can be directed to [contact email]." },
];

export default function LegalPage() {
  const [tab, setTab] = useState("terms");
  const sections = tab === "terms" ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Terms & Privacy" />

      <div className="px-5 pt-5 max-w-md mx-auto">
        <PageBlurb>The app's legal policies.</PageBlurb>
        <div className="rounded-2xl p-4 mb-5 flex items-start gap-3" style={{ background: "rgba(224,120,79,0.12)", border: `1px solid ${colors.alert}` }}>
          <AlertTriangle size={18} style={{ color: colors.alert, flexShrink: 0, marginTop: 2 }} />
          <p className="text-xs leading-relaxed" style={{ color: colors.text }}>
            <strong>Placeholder content.</strong> Everything below is a draft for structure only and has not been
            reviewed by an attorney. Do not treat this as a real Terms of Use or Privacy Policy until legal review is complete.
          </p>
        </div>

        <div className="flex rounded-xl p-1 mb-6" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.border}` }}>
          {[{ key: "terms", label: "Terms of Use" }, { key: "privacy", label: "Privacy Policy" }].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors"
              style={{ background: tab === t.key ? colors.accent : "transparent", color: tab === t.key ? colors.bg : colors.textMuted }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {sections.map((s) => (
          <Section key={s.title} title={s.title}>
            {s.body}
          </Section>
        ))}
      </div>
    </div>
  );
}
