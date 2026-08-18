import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Home, Menu, X, LogOut, Sun, Moon } from "lucide-react";
import { NAV_SECTIONS } from "../lib/navLinks";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import { useAuth } from "../lib/authContext";
import { useTheme } from "../lib/ThemeContext";
import { sharingApi, peerNotificationsApi } from "../lib/apiClient";
import { useIsDesktop } from "../lib/useIsDesktop";
import { useHeaderScrollShrink } from "../lib/useHeaderScrollShrink";

/**
 * The standard header for every page except Dashboard (which has its own
 * richer version with the net-worth stamp and walkthrough integration,
 * but shares this same NAV_LINKS list for its menu). Shows a back button
 * (browser-history back, for "where I actually came from"), a home
 * button (always the dashboard specifically), the logo, the current
 * page's title, and the same nav menu Dashboard has.
 */
export default function PageHeader({ title, subtitle, onBack }) {
  const navigate = useNavigate();
  const { signOut, status } = useAuth();
  const signedIn = status === "signedIn";
  const { theme, toggleTheme } = useTheme();
  const isDesktop = useIsDesktop();
  const scrolled = useHeaderScrollShrink(isDesktop);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasPendingShares, setHasPendingShares] = useState(false);
  const [hasNotifications, setHasNotifications] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    // Contact is reachable signed-out (linked from the Landing page) and
    // reuses this same header for visual consistency - skip the
    // authenticated-only lookups entirely rather than firing requests
    // that can only 401 for a guest.
    if (!signedIn) return;
    sharingApi
      .list()
      .then((d) => setHasPendingShares((d.asInvited || []).some((s) => s.status === "pending")))
      .catch(() => {}); // best-effort - a failed check just means no dot, not a broken header
    peerNotificationsApi
      .list()
      // Only a currently-active notification (isExpanded, per the
      // backend's own due-date logic) should light the dot - a past-due
      // one is deliberately kept around as an archived record rather
      // than deleted (see peer_notifications-fn's docstring), so
      // counting the raw list length here would leave the dot stuck on
      // forever once even one notification's due date passes, regardless
      // of what the user actually deletes.
      .then((d) => setHasNotifications((d.notifications || []).some((n) => n.isExpanded)))
      .catch(() => {});
  }, [signedIn]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  if (isDesktop) {
    return (
      <div className="sticky top-0 z-30" style={{ background: colors.bgTranslucent, backdropFilter: "blur(8px)", borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center justify-between px-5 transition-all" style={{ paddingTop: scrolled ? 10 : 16, paddingBottom: scrolled ? 10 : 12 }}>
          <img src={theme === "dark" ? "/paydaycompass-logo-dark.png" : "/paydaycompass-logo-light.png"} alt="PaydayCompass" style={{ width: scrolled ? 240 : 350, height: "auto", transition: "width 0.2s ease" }} className="shrink-0" />
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={toggleTheme} aria-label="Toggle dark/light mode" style={{ color: colors.text }} className="p-1 transition-opacity hover:opacity-70">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {signedIn && (
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" style={{ color: colors.text }} className="relative transition-opacity hover:opacity-70">
                {menuOpen ? <X size={22} /> : <Menu size={22} />}
                {(hasPendingShares || hasNotifications) && !menuOpen && (
                  <span className="absolute rounded-full" style={{ width: 8, height: 8, top: -1, right: -1, background: colors.alert, border: `1.5px solid ${colors.bg}` }} />
                )}
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-9 w-60 max-h-[80vh] overflow-y-auto rounded-xl p-1.5 shadow-2xl z-40" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
                  <button
                    onClick={() => { setMenuOpen(false); navigate("/"); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-opacity hover:opacity-80"
                    style={{ color: colors.text }}
                  >
                    <Home size={15} style={{ color: colors.textMuted }} />
                    Home
                  </button>
                  <div className="my-1" style={{ borderTop: `1px solid ${colors.border}` }} />
                  {NAV_SECTIONS.map((section, i) => (
                    <div key={section.label}>
                      {i > 0 && <div className="my-1" style={{ borderTop: `1px solid ${colors.border}` }} />}
                      <p className="px-3 pt-1.5 pb-0.5 text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.06em" }}>{section.label}</p>
                      {section.links.map((link) => {
                        const Icon = link.icon;
                        const showDot = (link.to === "/sharing" && hasPendingShares) || (link.to === "/notifications" && hasNotifications);
                        return (
                          <button
                            key={link.to}
                            onClick={() => { setMenuOpen(false); navigate(link.to); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-opacity hover:opacity-80"
                            style={{ color: colors.text }}
                          >
                            <span className="relative">
                              <Icon size={15} style={{ color: colors.textMuted }} />
                              {showDot && <span className="absolute rounded-full" style={{ width: 6, height: 6, top: -2, right: -2, background: colors.alert }} />}
                            </span>
                            {link.label}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  <div className="my-1" style={{ borderTop: `1px solid ${colors.border}` }} />
                  <button onClick={signOut} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-opacity hover:opacity-80" style={{ color: colors.alert }}>
                    <LogOut size={15} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${colors.border}` }} />
        <div className="flex items-center gap-2 px-5 min-w-0 transition-all" style={{ paddingTop: scrolled ? 8 : 12, paddingBottom: scrolled ? 8 : 12 }}>
          <button onClick={onBack || (() => navigate(-1))} aria-label="Back" className="p-1 -ml-1 shrink-0 transition-opacity hover:opacity-70" style={{ color: colors.text }}>
            <ArrowLeft size={20} />
          </button>
          <button onClick={() => navigate("/")} aria-label="Back to dashboard" className="p-1 shrink-0 transition-opacity hover:opacity-70" style={{ color: colors.text }}>
            <Home size={18} />
          </button>
          <div className="min-w-0 ml-1">
            <span className="truncate block" style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }}>{title}</span>
            {subtitle && <span className="text-xs" style={{ color: colors.textMuted }}>{subtitle}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between px-5 py-4" style={{ background: colors.bgTranslucent, backdropFilter: "blur(8px)", borderBottom: `1px solid ${colors.border}` }}>
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onBack || (() => navigate(-1))} aria-label="Back" className="p-1 -ml-1 shrink-0 transition-opacity hover:opacity-70" style={{ color: colors.text }}>
          <ArrowLeft size={20} />
        </button>
        <button onClick={() => navigate("/")} aria-label="Back to dashboard" className="p-1 shrink-0 transition-opacity hover:opacity-70" style={{ color: colors.text }}>
          <Home size={18} />
        </button>
        <img src={theme === "dark" ? "/paydaycompass-favicon-dark.png" : "/paydaycompass-favicon-light.png"} alt="PaydayCompass" style={{ width: 26, height: 26 }} className="shrink-0 ml-1" />
        <div className="min-w-0">
          <span className="truncate block" style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }}>{title}</span>
          {subtitle && <span className="text-xs" style={{ color: colors.textMuted }}>{subtitle}</span>}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button onClick={toggleTheme} aria-label="Toggle dark/light mode" style={{ color: colors.text }} className="p-1 transition-opacity hover:opacity-70">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {signedIn && (
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" style={{ color: colors.text }} className="relative transition-opacity hover:opacity-70">
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
            {(hasPendingShares || hasNotifications) && !menuOpen && (
              <span className="absolute rounded-full" style={{ width: 8, height: 8, top: -1, right: -1, background: colors.alert, border: `1.5px solid ${colors.bg}` }} />
            )}
          </button>

        {menuOpen && (
          <div className="absolute right-0 top-9 w-60 max-h-[80vh] overflow-y-auto rounded-xl p-1.5 shadow-2xl z-40" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
            <button
              onClick={() => { setMenuOpen(false); navigate("/"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-opacity hover:opacity-80"
              style={{ color: colors.text }}
            >
              <Home size={15} style={{ color: colors.textMuted }} />
              Home
            </button>
            <div className="my-1" style={{ borderTop: `1px solid ${colors.border}` }} />
            {NAV_SECTIONS.map((section, i) => (
              <div key={section.label}>
                {i > 0 && <div className="my-1" style={{ borderTop: `1px solid ${colors.border}` }} />}
                <p className="px-3 pt-1.5 pb-0.5 text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.06em" }}>{section.label}</p>
                {section.links.map((link) => {
                  const Icon = link.icon;
                  const showDot = (link.to === "/sharing" && hasPendingShares) || (link.to === "/notifications" && hasNotifications);
                  return (
                    <button
                      key={link.to}
                      onClick={() => { setMenuOpen(false); navigate(link.to); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-opacity hover:opacity-80"
                      style={{ color: colors.text }}
                    >
                      <span className="relative">
                        <Icon size={15} style={{ color: colors.textMuted }} />
                        {showDot && <span className="absolute rounded-full" style={{ width: 6, height: 6, top: -2, right: -2, background: colors.alert }} />}
                      </span>
                      {link.label}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="my-1" style={{ borderTop: `1px solid ${colors.border}` }} />
            <button onClick={signOut} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-opacity hover:opacity-80" style={{ color: colors.alert }}>
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        )}
      </div>
        )}
      </div>
    </div>
  );
}
