import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Wallet, PiggyBank, CreditCard, TrendingUp, Landmark, Menu, X, Plus, ChevronRight, ChevronDown, ChevronUp, LogOut, Sun, Moon, ArrowDownLeft, PieChart, Repeat, Target, ArrowLeftRight, ListPlus } from "lucide-react";
import { accountsApi, sharingApi, peerNotificationsApi, divisionsApi, paydayApi, preferencesApi, externalBankAccountsApi, ApiError } from "../lib/apiClient";
import { colors, fontDisplay, fontBody, fontMono, formatMoney } from "../lib/theme";
import { useAuth } from "../lib/authContext";
import { useTheme } from "../lib/ThemeContext";
import { useIsDesktop } from "../lib/useIsDesktop";
import { useHeaderScrollShrink } from "../lib/useHeaderScrollShrink";
import Walkthrough from "../components/Walkthrough";
import PageBlurb from "../components/PageBlurb";
import InfoBubble from "../components/InfoBubble";

const ICONS = { checking: Wallet, savings: PiggyBank, credit: CreditCard, investment: TrendingUp, other: Landmark };
const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  // credit/investment/other intentionally hidden for now - re-add when ready
];
import { NAV_LINKS, NAV_SECTIONS } from "../lib/navLinks";

const QUICK_ACTIONS = [
  { label: "Add expense/deposit", icon: Plus, to: "/add-expense" },
  { label: "Add multiple", icon: ListPlus, to: "/add-multiple" },
  { label: "Add income", icon: ArrowDownLeft, to: "/recurring?new=income" },
  { label: "Transfer funds", icon: ArrowLeftRight, to: "/transfer" },
  { label: "Budgets", icon: PieChart, to: "/budgets" },
  { label: "Recurring", icon: Repeat, to: "/recurring" },
  { label: "Planned expenses", icon: Target, to: "/planned-expenses" },
];

// The full catalog a user can choose quick actions from - the default 7
// above, plus every other in-app destination (NAV_LINKS), deduped by
// route so an item that appears in both keeps QUICK_ACTIONS' own label.
const AVAILABLE_ACTIONS = (() => {
  const byRoute = new Map();
  QUICK_ACTIONS.forEach((a) => byRoute.set(a.to, { id: a.to, label: a.label, icon: a.icon, to: a.to }));
  NAV_LINKS.forEach((l) => {
    if (!byRoute.has(l.to)) byRoute.set(l.to, { id: l.to, label: l.label, icon: l.icon, to: l.to });
  });
  return Array.from(byRoute.values());
})();


function AccountCard({ account, divisions, expanded, onToggleExpand, onClick, availableBalance, linkedExternalName }) {
  const Icon = ICONS[account.type] || Landmark;
  const negative = account.balance < 0;
  const hasDivisions = divisions && divisions.length > 0;
  const showAvailable = availableBalance !== undefined && Math.abs(availableBalance - account.balance) > 0.005;
  return (
    <div className="w-full rounded-2xl relative overflow-hidden mb-3" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
      <button onClick={onClick} type="button" className="w-full text-left p-4 transition-transform active:scale-[0.99]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: colors.surfaceRaised, color: colors.accentLight }}>
              <Icon size={18} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: colors.text }}>{account.name}</p>
              <p className="text-xs capitalize" style={{ color: colors.textMuted }}>
                {account.type}
                {linkedExternalName && <span className="normal-case"> · Connected to {linkedExternalName}</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0 pl-3">
            <div className="flex items-center gap-2">
              <span style={{ fontFamily: fontMono, fontSize: 15, color: negative ? colors.alert : colors.text }}>{formatMoney(account.balance)}</span>
              <ChevronRight size={16} style={{ color: colors.textMuted }} />
            </div>
            {showAvailable && (
              <span className="text-xs" style={{ fontFamily: fontMono, color: colors.textMuted }}>({formatMoney(availableBalance)} available)</span>
            )}
          </div>
        </div>
      </button>
      {hasDivisions && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs transition-opacity hover:opacity-80"
            style={{ color: colors.textMuted, borderTop: `1px solid ${colors.border}` }}
          >
            {expanded ? "Hide divisions" : `Show ${divisions.length} division${divisions.length === 1 ? "" : "s"}`}
            <ChevronDown size={13} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {expanded && (
            <div className="px-4 pb-3" style={{ borderTop: `1px solid ${colors.border}` }}>
              {divisions.map((d, i) => (
                <div key={d.divisionId} className="flex items-center justify-between py-2" style={{ borderTop: i > 0 ? `1px solid ${colors.border}` : "none" }}>
                  <span className="text-xs truncate pr-2" style={{ color: colors.textMuted }}>{d.name}</span>
                  <span className="text-xs shrink-0" style={{ fontFamily: fontMono, color: colors.text }}>{formatMoney(d.balance)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDesktop = useIsDesktop();
  const scrolled = useHeaderScrollShrink(isDesktop);
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState(null); // null = loading
  const [paydayData, setPaydayData] = useState(null);
  const [divisionsByAccount, setDivisionsByAccount] = useState({});
  const [expandedAccountId, setExpandedAccountId] = useState(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasPendingShares, setHasPendingShares] = useState(false);
  const [hasNotifications, setHasNotifications] = useState(false);
  const [externalAccountsById, setExternalAccountsById] = useState({});
  const [quickActionIds, setQuickActionIds] = useState(null); // null until loaded (either from preferences or the built-in default)
  const [customizedActions, setCustomizedActions] = useState(false);
  const [editingActions, setEditingActions] = useState(false);
  const [actionsError, setActionsError] = useState(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("checking");
  const [newAccountBalance, setNewAccountBalance] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(searchParams.get("tour") === "1");

  const netWorthRef = useRef(null);
  const quickActionsRef = useRef(null);
  const accountsListRef = useRef(null);
  const addAccountRef = useRef(null);
  const menuButtonRef = useRef(null);
  const menuContainerRef = useRef(null);
  const navItemEls = useRef({}); // { [link.to]: HTMLElement } - populated as the menu renders
  function navItemRef(key) {
    // A ref-like object whose .current always reflects the latest
    // element for this nav item, even though the item only exists in the
    // DOM while the menu is open - a plain useRef per item isn't possible
    // here since NAV_LINKS is dynamic-length.
    return { get current() { return navItemEls.current[key] || null; } };
  }

  const walkthroughSteps = [
    { ref: netWorthRef, title: "Your net worth", body: "This stamp totals every account you own (not accounts shared with you). It updates the moment a balance changes." },
    { ref: quickActionsRef, title: "Quick actions", body: "The fastest way to add an expense or income, or jump straight to Budgets, Recurring, or Planned Expenses - all of these are also in the menu, so use whichever you prefer." },
    { ref: accountsListRef, title: "Your accounts", body: "Tap any account to see its transactions, spending trends, and category breakdown." },
    { ref: addAccountRef, title: "Adding an account", body: "Add as many as you actually use — checking, savings, credit cards, whatever's real for you." },
    { ref: menuButtonRef, title: "Getting around", body: "Everything else lives behind this menu. Let's take a quick look at what's here." },
    ...NAV_LINKS.map((link) => ({ ref: navItemRef(link.to), title: link.label, body: link.description })),
  ];

  // The menu only needs to be open for the "Getting around" step and
  // every nav-item step after it - open right when that section starts,
  // close again once the tour moves past the last nav item (or ends).
  function handleWalkthroughStepChange(stepIndex) {
    const menuSectionStart = 3; // index of the "Getting around" step above
    const inMenuSection = stepIndex >= menuSectionStart && stepIndex < walkthroughSteps.length;
    setMenuOpen(inMenuSection);
  }

  function endWalkthrough() {
    setShowWalkthrough(false);
    setMenuOpen(false);
    searchParams.delete("tour");
    setSearchParams(searchParams, { replace: true });
  }

  function loadAccounts() {
    accountsApi
      .list()
      .then((data) => {
        setAccounts(data);
        setError(null);
        const owned = data.filter((a) => !a.sharedFromUserId);
        Promise.all(owned.map((a) => divisionsApi.list(a.accountId).catch(() => [])))
          .then((perAccount) => {
            setDivisionsByAccount(Object.fromEntries(owned.map((a, i) => [a.accountId, perAccount[i]])));
          })
          .catch(() => {}); // best-effort - divisions are a nice-to-have on this page, not core account data
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          signOut(); // token expired/invalid - back to login
        } else {
          setError("Couldn't load your accounts. Pull to refresh, or try again shortly.");
        }
      });
  }

  useEffect(() => {
    loadAccounts();
    paydayApi.upcoming().then(setPaydayData).catch(() => setPaydayData(null)); // best-effort - available balance is an enhancement, not core account data
    sharingApi
      .list()
      .then((d) => setHasPendingShares((d.asInvited || []).some((s) => s.status === "pending")))
      .catch(() => {}); // best-effort - a failed check just means no dot, not a broken dashboard
    peerNotificationsApi
      .list()
      .then((d) => setHasNotifications((d.notifications || []).length > 0))
      .catch(() => {});
    externalBankAccountsApi
      .list()
      .then((list) => setExternalAccountsById(Object.fromEntries(list.map((e) => [e.externalBankAccountId, e.name]))))
      .catch(() => {}); // best-effort - the "connected to" label is a nice-to-have, not core account data
    preferencesApi
      .get()
      .then((prefs) => {
        if (prefs.dashboardQuickActions) {
          setQuickActionIds(prefs.dashboardQuickActions);
          setCustomizedActions(true);
        }
      })
      .catch(() => {}); // best-effort - falls back to the default set below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Computed default, never itself persisted - keeps re-deriving from the
  // built-in QUICK_ACTIONS list until the user actually customizes,
  // matching the same pattern CategoryTrends.jsx uses for its charts.
  useEffect(() => {
    if (customizedActions || quickActionIds !== null) return;
    setQuickActionIds(QUICK_ACTIONS.map((a) => a.to));
  }, [customizedActions, quickActionIds]);

  const resolvedActions = (quickActionIds || []).map((id) => AVAILABLE_ACTIONS.find((a) => a.id === id)).filter(Boolean);
  const remainingActions = AVAILABLE_ACTIONS.filter((a) => !(quickActionIds || []).includes(a.id));

  function saveQuickActions(next) {
    setQuickActionIds(next);
    setCustomizedActions(true);
    preferencesApi.update({ dashboardQuickActions: next }).catch(() => setActionsError("Couldn't save your quick actions - your change is showing but may not persist."));
  }
  function removeQuickAction(id) {
    if (resolvedActions.length <= 1) return;
    saveQuickActions((quickActionIds || []).filter((qid) => qid !== id));
  }
  function addQuickAction(id) {
    if (!id) return;
    saveQuickActions([...(quickActionIds || []), id]);
  }
  function moveQuickAction(index, direction) {
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= resolvedActions.length) return;
    const next = resolvedActions.map((a) => a.id);
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    saveQuickActions(next);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e) {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const netWorth = (accounts || []).filter((a) => !a.sharedFromUserId).reduce((sum, a) => sum + a.balance, 0);
  const ownedAccountsSorted = (accounts || [])
    .filter((a) => !a.sharedFromUserId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const dueByAccount = useMemo(() => {
    if (!paydayData || paydayData.mode !== "preview") return {};
    const totals = {};
    for (const e of paydayData.upcomingExpenses || []) {
      totals[e.accountId] = (totals[e.accountId] || 0) + e.estimatedAmount;
    }
    for (const b of paydayData.budgetedExpenses || []) {
      if (b.accountId) totals[b.accountId] = (totals[b.accountId] || 0) + b.amount;
    }
    for (const pe of [...(paydayData.plannedExpenseContributions || []), ...(paydayData.overduePlannedExpenses || [])]) {
      if (pe.linkedAccountId) totals[pe.linkedAccountId] = (totals[pe.linkedAccountId] || 0) + pe.amount;
    }
    return totals;
  }, [paydayData]);

  const checkingAccounts = ownedAccountsSorted.filter((a) => a.type === "checking");
  const savingsAccounts = ownedAccountsSorted.filter((a) => a.type === "savings");
  const otherAccounts = ownedAccountsSorted.filter((a) => a.type !== "checking" && a.type !== "savings");
  const ownedAccounts = ownedAccountsSorted;
  const sharedAccounts = (accounts || []).filter((a) => a.sharedFromUserId);

  async function moveAccount(section, index, direction) {
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= section.length) return;
    const reordered = [...section];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    // Reconstruct the full cross-section order (checking, then savings,
    // then other) with just this one section's new arrangement swapped
    // in - the backend assigns sortOrder by position in the whole list,
    // so every account needs to be included, not just the ones that moved.
    const newSections = {
      checking: section === checkingAccounts ? reordered : checkingAccounts,
      savings: section === savingsAccounts ? reordered : savingsAccounts,
      other: section === otherAccounts ? reordered : otherAccounts,
    };
    const fullOrder = [...newSections.checking, ...newSections.savings, ...newSections.other].map((a) => a.accountId);

    // Optimistic local update - the account list itself carries sortOrder,
    // so re-deriving the sections from an updated `accounts` array keeps
    // the UI in sync without waiting on the network round-trip.
    setAccounts((list) =>
      (list || []).map((a) => {
        const newIndex = fullOrder.indexOf(a.accountId);
        return newIndex === -1 ? a : { ...a, sortOrder: newIndex };
      })
    );

    setReordering(true);
    try {
      await accountsApi.reorder(fullOrder);
    } catch {
      loadAccounts(); // best-effort - if persisting failed, re-sync with the server's actual order rather than leave a locally-drifted view
    } finally {
      setReordering(false);
    }
  }

  async function resetAccountOrder() {
    // Alphabetical within each section is the most predictable "reset"
    // available - there's no separately preserved "original" order to
    // go back to, since sortOrder has been the only ordering all along.
    const alphabetical = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name));
    const fullOrder = [...alphabetical(checkingAccounts), ...alphabetical(savingsAccounts), ...alphabetical(otherAccounts)].map((a) => a.accountId);

    setAccounts((list) =>
      (list || []).map((a) => {
        const newIndex = fullOrder.indexOf(a.accountId);
        return newIndex === -1 ? a : { ...a, sortOrder: newIndex };
      })
    );

    setReordering(true);
    try {
      await accountsApi.reorder(fullOrder);
    } catch {
      loadAccounts();
    } finally {
      setReordering(false);
    }
  }

  async function createAccount() {
    if (!newAccountName.trim()) return;
    setSavingAccount(true);
    setError(null);
    try {
      await accountsApi.create({
        name: newAccountName.trim(),
        type: newAccountType,
        balance: parseFloat(newAccountBalance) || 0,
      });
      setNewAccountName("");
      setNewAccountBalance("");
      setAddingAccount(false);
      loadAccounts();
    } catch (err) {
      setError(err.message || "Couldn't create that account.");
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: colors.bg, fontFamily: fontBody }}>
      <div className="sticky top-0 z-30 flex items-center justify-between px-5 transition-all" style={{ paddingTop: scrolled ? 10 : 16, paddingBottom: scrolled ? 10 : 16, background: colors.bgTranslucent, backdropFilter: "blur(8px)", borderBottom: `1px solid ${colors.border}` }}>
        <div className="flex items-center gap-2">
          {isDesktop ? (
            <img src={theme === "dark" ? "/paydaycompass-logo-dark.png" : "/paydaycompass-logo-light.png"} alt="PaydayCompass" style={{ width: scrolled ? 240 : 350, height: "auto", transition: "width 0.2s ease" }} />
          ) : (
            <>
              <img src={theme === "dark" ? "/paydaycompass-favicon-dark.png" : "/paydaycompass-favicon-light.png"} alt="" style={{ width: 22, height: 22 }} />
              <span style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 20, fontWeight: 600 }}>PaydayCompass</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleTheme} aria-label="Toggle dark/light mode" style={{ color: colors.text }} className="p-1 transition-opacity hover:opacity-70">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="relative" ref={menuContainerRef}>
          <button ref={menuButtonRef} onClick={() => setMenuOpen((o) => !o)} aria-label="Menu" style={{ color: colors.text }} className="relative transition-opacity hover:opacity-70">
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
            {(hasPendingShares || hasNotifications) && !menuOpen && (
              <span className="absolute rounded-full" style={{ width: 8, height: 8, top: -1, right: -1, background: colors.alert, border: `1.5px solid ${colors.bg}` }} />
            )}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 w-60 max-h-[80vh] overflow-y-auto rounded-xl p-1.5 shadow-2xl z-40" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
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
                        ref={(el) => (navItemEls.current[link.to] = el)}
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
        </div>
      </div>

      <div className="px-5 pt-6 max-w-md mx-auto">
        <PageBlurb>Your home base — every account you own or have been shared, your net worth, and quick access to everything else.</PageBlurb>
        {accounts !== null && (
          <div ref={netWorthRef} className="flex flex-col items-center mb-8">
            <div
              className="flex flex-col items-center justify-center rounded-full"
              style={{ width: 148, height: 148, background: theme === "light" ? colors.surface : "transparent", border: `2px solid ${colors.accentLight}`, transform: "rotate(-3deg)", boxShadow: `0 0 0 4px ${colors.bg}, 0 0 0 5px ${colors.border}` }}
            >
              <span className="text-[10px] uppercase tracking-widest mb-1" style={{ color: colors.accentLight, letterSpacing: "0.15em" }}>Net worth</span>
              <span style={{ fontFamily: fontMono, fontSize: 22, color: colors.text }}>{formatMoney(netWorth)}</span>
            </div>
          </div>
        )}

        <div ref={quickActionsRef} className="mb-8">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs uppercase tracking-wide" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>Quick actions</span>
            <button type="button" onClick={() => setEditingActions((v) => !v)} className="text-xs underline" style={{ color: colors.accentLight }}>
              {editingActions ? "Done" : "Customize"}
            </button>
          </div>

          {editingActions ? (
            <div className="rounded-2xl p-3" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
              {resolvedActions.map((action, i) => {
                const Icon = action.icon;
                return (
                  <div key={action.id} className="flex items-center gap-2 py-1.5" style={{ borderTop: i > 0 ? `1px solid ${colors.border}` : "none" }}>
                    <div className="flex flex-col shrink-0">
                      <button type="button" disabled={i === 0} onClick={() => moveQuickAction(i, -1)} aria-label="Move up" className="p-0.5" style={{ color: i === 0 ? colors.border : colors.textMuted }}>
                        <ChevronUp size={14} />
                      </button>
                      <button type="button" disabled={i === resolvedActions.length - 1} onClick={() => moveQuickAction(i, 1)} aria-label="Move down" className="p-0.5" style={{ color: i === resolvedActions.length - 1 ? colors.border : colors.textMuted }}>
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <Icon size={15} style={{ color: colors.accentLight }} />
                    <span className="text-sm flex-1" style={{ color: colors.text }}>{action.label}</span>
                    <button
                      type="button"
                      onClick={() => removeQuickAction(action.id)}
                      disabled={resolvedActions.length <= 1}
                      aria-label="Remove"
                      className="p-1"
                      style={{ color: resolvedActions.length <= 1 ? colors.border : colors.alert }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
              {remainingActions.length > 0 && (
                <div className="relative mt-2">
                  <select
                    value=""
                    onChange={(e) => addQuickAction(e.target.value)}
                    className="w-full appearance-none rounded-lg px-2.5 py-2 text-xs focus:outline-none"
                    style={{ background: colors.bg, border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
                  >
                    <option value="">+ Add a quick action…</option>
                    {remainingActions.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
              )}
              {actionsError && <p className="text-xs mt-2" style={{ color: colors.alert }}>{actionsError}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {resolvedActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => navigate(action.to)}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-2xl py-3 transition-opacity hover:opacity-80"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
                  >
                    <Icon size={17} style={{ color: colors.accentLight }} />
                    <span className="text-xs text-center leading-tight" style={{ color: colors.text }}>{action.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center">
            <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }}>Your accounts</h2>
            <InfoBubble text="Tap any account to see its transactions, spending trends, and category breakdown." />
          </div>
          {ownedAccounts.length > 1 && (
            <div className="flex items-center gap-3">
              {reorderMode && (
                <button type="button" onClick={resetAccountOrder} disabled={reordering} className="text-xs underline" style={{ color: colors.textMuted, opacity: reordering ? 0.5 : 1 }}>
                  Reset order
                </button>
              )}
              <button type="button" onClick={() => setReorderMode((v) => !v)} className="text-xs underline" style={{ color: colors.accentLight }}>
                {reorderMode ? "Done" : "Edit order"}
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm mb-4" style={{ color: colors.alert }}>{error}</p>
        )}

        {accounts === null && !error && (
          <p className="text-sm" style={{ color: colors.textMuted }}>Loading your accounts…</p>
        )}

        {accounts !== null && ownedAccounts.length === 0 && (
          <p className="text-sm mb-4" style={{ color: colors.textMuted }}>No accounts yet — add your first one below.</p>
        )}

        <div ref={accountsListRef}>
          {(() => {
            const groups = [
              { label: "Checking", list: checkingAccounts },
              { label: "Savings", list: savingsAccounts },
              { label: "Other", list: otherAccounts },
            ].filter((g) => g.list.length > 0);
            const showLabels = groups.length > 1;
            return groups.map(({ label, list }) => (
              <div key={label} className="mb-4">
                {showLabels && (
                  <p className="text-xs uppercase tracking-wide mb-1.5 px-1" style={{ color: colors.textMuted, letterSpacing: "0.08em" }}>{label}</p>
                )}
                {list.map((a, i) => (
                  <div key={a.accountId} className="flex items-center gap-2">
                    {reorderMode && (
                      <div className="flex flex-col shrink-0">
                        <button
                          type="button"
                          disabled={i === 0 || reordering}
                          onClick={() => moveAccount(list, i, -1)}
                          aria-label="Move up"
                          className="p-1"
                          style={{ color: i === 0 ? colors.border : colors.textMuted, opacity: reordering ? 0.5 : 1 }}
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          disabled={i === list.length - 1 || reordering}
                          onClick={() => moveAccount(list, i, 1)}
                          aria-label="Move down"
                          className="p-1"
                          style={{ color: i === list.length - 1 ? colors.border : colors.textMuted, opacity: reordering ? 0.5 : 1 }}
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <AccountCard
                        account={a}
                        divisions={divisionsByAccount[a.accountId]}
                        expanded={expandedAccountId === a.accountId}
                        onToggleExpand={() => setExpandedAccountId((id) => (id === a.accountId ? null : a.accountId))}
                        onClick={() => { if (!reorderMode) navigate(`/accounts/${a.accountId}`); }}
                        availableBalance={dueByAccount[a.accountId] !== undefined ? a.balance - dueByAccount[a.accountId] : undefined}
                        linkedExternalName={a.externalBankAccountId ? externalAccountsById[a.externalBankAccountId] : null}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>

        {sharedAccounts.length > 0 && (
          <>
            <div className="flex items-center mb-3 mt-6 px-1">
              <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }}>Shared with you</h2>
              <InfoBubble text="Accounts someone else owns and has shared with you - not counted in your net worth above." />
            </div>
            {sharedAccounts.map((a) => (
              <AccountCard key={a.accountId} account={a} onClick={() => navigate(`/accounts/${a.accountId}`)} availableBalance={dueByAccount[a.accountId] !== undefined ? a.balance - dueByAccount[a.accountId] : undefined} />
            ))}
          </>
        )}

        <div ref={addAccountRef}>
          {addingAccount ? (
            <div className="rounded-2xl p-4 mt-1" style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}>
              <input
                autoFocus
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="e.g. Everyday Checking"
                className="w-full rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none"
                style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
              />
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <select
                    value={newAccountType}
                    onChange={(e) => setNewAccountType(e.target.value)}
                    className="w-full appearance-none rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text }}
                  >
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: colors.textMuted }} />
                </div>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: colors.textMuted, fontFamily: fontMono }}>$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={newAccountBalance}
                    onChange={(e) => setNewAccountBalance(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg pl-5 pr-2 py-2 text-sm focus:outline-none"
                    style={{ background: colors.surface, border: `1px solid ${colors.border}`, color: colors.text, fontFamily: fontMono }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAddingAccount(false)} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ border: `1px solid ${colors.border}`, color: colors.textMuted }}>Cancel</button>
                <button onClick={createAccount} disabled={!newAccountName.trim() || savingAccount} className="flex-1 rounded-lg py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg, opacity: savingAccount ? 0.6 : 1 }}>
                  {savingAccount ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingAccount(true)}
              className="w-full rounded-2xl py-3.5 mt-1 text-sm font-medium flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
              style={{ border: `1px dashed ${colors.borderStrong}`, color: colors.textMuted }}
            >
              <Plus size={16} />
              Add an account
            </button>
          )}
        </div>
      </div>

      {showWalkthrough && <Walkthrough steps={walkthroughSteps} onFinish={endWalkthrough} onStepChange={handleWalkthroughStepChange} />}
    </div>
  );
}
