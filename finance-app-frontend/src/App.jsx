import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/authContext";
import { ThemeProvider } from "./lib/ThemeContext";
import LoginPage from "./pages/Login";
import SignUpPage from "./pages/SignUp";
import LandingPage from "./pages/Landing";
import DashboardPage from "./pages/Dashboard";
import AddExpensePage from "./pages/AddExpense";
import MassAddTransactionsPage from "./pages/MassAddTransactions";
import AccountDetailPage from "./pages/AccountDetail";
import BudgetsPage from "./pages/Budgets";
import PaydayPage from "./pages/Payday";
import CategoryTrendsPage from "./pages/CategoryTrends";
import MfaSetupPage from "./pages/MfaSetup";
import ExternalBankAccountsPage from "./pages/ExternalBankAccounts";
import ManageRecurringPage from "./pages/ManageRecurring";
import SettingsPage from "./pages/Settings";
import GettingSetupPage from "./pages/GettingSetup";
import PlannedExpensesPage from "./pages/PlannedExpenses";
import SharingPage from "./pages/Sharing";
import ScenariosPage from "./pages/Scenarios";
import NotificationsPage from "./pages/Notifications";
import LegalPage from "./pages/Legal";
import ContactPage from "./pages/Contact";
import ProjectedVsActualPage from "./pages/ProjectedVsActual";
import TransferFundsPage from "./pages/TransferFunds";
import UpcomingRecurringPage from "./pages/UpcomingRecurring";
import CsvImportExportPage from "./pages/CsvImportExport";
import NotFoundPage from "./pages/NotFound";
import { colors, fontBody } from "./lib/theme";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: colors.bg, fontFamily: fontBody }}>
      <p style={{ color: colors.textMuted, fontSize: 14 }}>Loading…</p>
    </div>
  );
}

function RequireAuth({ children }) {
  const { status, needsSetup } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <LoadingScreen />;
  }
  if (status === "signedOut") {
    return <Navigate to="/login" replace />;
  }
  // A brand-new user (hasCompletedSetup != "true") gets sent to the
  // wizard automatically - except when they're already on it, which
  // would otherwise be an infinite redirect.
  if (needsSetup && location.pathname !== "/getting-setup") {
    return <Navigate to="/getting-setup" replace />;
  }
  return children;
}

// "/" is the one route that isn't purely "signed in" or "signed out" -
// it's the public landing page for visitors, but the dashboard for
// signed-in users. Handled here instead of via RequireAuth so a
// signed-out visitor sees the landing page directly, not a redirect to
// /login.
function RootRoute() {
  const { status, needsSetup } = useAuth();

  if (status === "checking") {
    return <LoadingScreen />;
  }
  if (status === "signedOut") {
    return <LandingPage />;
  }
  if (needsSetup) {
    return <Navigate to="/getting-setup" replace />;
  }
  return <DashboardPage />;
}

function AppRoutes() {
  const { status } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={status === "signedIn" ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/signup" element={status === "signedIn" ? <Navigate to="/" replace /> : <SignUpPage />} />
      <Route path="/" element={<RootRoute />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/add-expense" element={<RequireAuth><AddExpensePage /></RequireAuth>} />
      <Route path="/add-multiple" element={<RequireAuth><MassAddTransactionsPage /></RequireAuth>} />
      <Route path="/accounts/:accountId" element={<RequireAuth><AccountDetailPage /></RequireAuth>} />
      <Route path="/budgets" element={<RequireAuth><BudgetsPage /></RequireAuth>} />
      <Route path="/payday" element={<RequireAuth><PaydayPage /></RequireAuth>} />
      <Route path="/trends" element={<RequireAuth><CategoryTrendsPage /></RequireAuth>} />
      <Route path="/settings/mfa" element={<RequireAuth><MfaSetupPage /></RequireAuth>} />
      <Route path="/external-bank-accounts" element={<RequireAuth><ExternalBankAccountsPage /></RequireAuth>} />
      <Route path="/recurring" element={<RequireAuth><ManageRecurringPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/getting-setup" element={<RequireAuth><GettingSetupPage /></RequireAuth>} />
      <Route path="/planned-expenses" element={<RequireAuth><PlannedExpensesPage /></RequireAuth>} />
      <Route path="/sharing" element={<RequireAuth><SharingPage /></RequireAuth>} />
      <Route path="/scenarios" element={<RequireAuth><ScenariosPage /></RequireAuth>} />
      <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
      <Route path="/legal" element={<RequireAuth><LegalPage /></RequireAuth>} />
      <Route path="/projected-vs-actual" element={<RequireAuth><ProjectedVsActualPage /></RequireAuth>} />
      <Route path="/transfer" element={<RequireAuth><TransferFundsPage /></RequireAuth>} />
      <Route path="/upcoming-recurring" element={<RequireAuth><UpcomingRecurringPage /></RequireAuth>} />
      <Route path="/csv" element={<RequireAuth><CsvImportExportPage /></RequireAuth>} />
      <Route path="*" element={<NotFoundPage />} />
      {/*
        Remaining screens follow the exact same pattern as Dashboard/AddExpense:
        1. useEffect + the relevant api client call from src/lib/apiClient.js
        2. loading / error / empty states (see Dashboard.jsx)
        3. wrap the route in <RequireAuth>
        See README.md "Wiring the remaining screens" for the full checklist.
      */}
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
