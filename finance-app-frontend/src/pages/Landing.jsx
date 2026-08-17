import React from "react";
import { useNavigate } from "react-router-dom";
import { Sun, Moon, PieChart, Repeat, Users, GitBranch, Target, ShieldCheck } from "lucide-react";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import { useTheme } from "../lib/ThemeContext";
import { useIsDesktop } from "../lib/useIsDesktop";

const FEATURES = [
  { icon: PieChart, title: "Budgets that actually track", body: "Set a limit per category and get alerted at 80%, when you go over, and on every purchase while you're still over." },
  { icon: Repeat, title: "Recurring, handled automatically", body: "Bills and income post on schedule without you lifting a finger - miss a check-in and it backfills what you missed." },
  { icon: Target, title: "Plan for what's coming", body: "Save toward a birthday, a premium, or any known future cost, with a suggested contribution that keeps you on track." },
  { icon: GitBranch, title: "Test before you commit", body: "Try out a raise, a new bill, or a big purchase against your real numbers before it actually happens." },
  { icon: Users, title: "Share on your terms", body: "Give someone else access to an account - you choose exactly what they can see or edit, down to individual data types." },
  { icon: ShieldCheck, title: "Built with real security", body: "Two-factor authentication, encrypted at rest and in transit, and permissions enforced on every request, not just hidden in the UI." },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const isDesktop = useIsDesktop();

  return (
    <div className="min-h-screen" style={{ background: colors.bg, fontFamily: fontBody }}>
      <div className="flex items-center justify-between px-5 py-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-2">
          {isDesktop ? (
            <img src={theme === "dark" ? "/paydaycompass-logo-dark.png" : "/paydaycompass-logo-light.png"} alt="PaydayCompass" style={{ width: 150, height: "auto" }} />
          ) : (
            <>
              <img src={theme === "dark" ? "/paydaycompass-favicon-dark.png" : "/paydaycompass-favicon-light.png"} alt="PaydayCompass" style={{ width: 24, height: 24 }} />
              <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }}>PaydayCompass</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} aria-label="Toggle dark/light mode" style={{ color: colors.text }} className="p-1 transition-opacity hover:opacity-70">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => navigate("/login")}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ border: `1px solid ${colors.borderStrong}`, color: colors.text }}
          >
            Sign in
          </button>
        </div>
      </div>

      <div className="px-5 pt-10 pb-16 max-w-2xl mx-auto text-center">
        {!isDesktop && (
          <img
            src={theme === "dark" ? "/paydaycompass-logo-dark.png" : "/paydaycompass-logo-light.png"}
            alt="PaydayCompass"
            className="mx-auto mb-8"
            style={{ width: 260, height: "auto" }}
          />
        )}
        <h1 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 40, fontWeight: 600, lineHeight: 1.1 }} className="mb-4">
          Every account, one honest balance.
        </h1>
        <p className="text-base mb-8" style={{ color: colors.textMuted }}>
          PaydayCompass pulls your accounts, budgets, bills, and plans into one place - with the kind of category-level
          precision most banking apps don't bother with.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate("/signup")}
            className="rounded-xl px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: colors.accent, color: colors.bg }}
          >
            Create your account
          </button>
          <button
            onClick={() => navigate("/login")}
            className="rounded-xl px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ border: `1px solid ${colors.borderStrong}`, color: colors.text }}
          >
            Sign in
          </button>
        </div>
      </div>

      <div className="px-5 pb-16 max-w-2xl mx-auto">
        <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 20, fontWeight: 600 }} className="mb-3">
            Most budgeting apps stop at the store name
          </h2>
          <p className="text-sm" style={{ color: colors.textMuted }}>
            A single receipt at Walmart or Target might really be groceries, clothing, tools, and kitchen supplies all
            at once - but most apps just label the whole thing "Groceries" because that's the store, not the
            purchase. PaydayCompass tracks by what you actually bought, category by category, transaction by
            transaction - even splitting a single purchase across categories when it covers more than one kind of
            expense. That's the difference between a rough guess at where your money goes and actually knowing.
          </p>
        </div>
      </div>

      <div className="px-5 pb-16 max-w-4xl mx-auto">
        <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 24, fontWeight: 600 }} className="mb-6 text-center">
          Everything you need to actually see where your money goes
        </h2>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="rounded-2xl p-5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
                <div className="flex items-center justify-center rounded-xl mb-3" style={{ width: 40, height: 40, background: colors.surfaceRaised, color: colors.accentLight }}>
                  <Icon size={19} strokeWidth={1.75} />
                </div>
                <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 16, fontWeight: 600 }} className="mb-1.5">{f.title}</h3>
                <p className="text-sm" style={{ color: colors.textMuted }}>{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-5 pb-16 max-w-2xl mx-auto text-center">
        <button
          onClick={() => navigate("/signup")}
          className="rounded-xl px-8 py-3.5 text-sm font-medium transition-opacity hover:opacity-90"
          style={{ background: colors.accent, color: colors.bg }}
        >
          Get started - it's free
        </button>
      </div>

      <div className="px-5 py-6 text-center" style={{ borderTop: `1px solid ${colors.border}` }}>
        <p className="text-xs" style={{ color: colors.textMuted }}>
          A product of McGinnis Architecture ·{" "}
          <button onClick={() => navigate("/login")} className="underline" style={{ color: colors.textMuted }}>Sign in</button>
          {" "}·{" "}
          <button onClick={() => navigate("/contact")} className="underline" style={{ color: colors.textMuted }}>Contact</button>
        </p>
      </div>
    </div>
  );
}
