import React, { createContext, useContext, useEffect, useState } from "react";
import {
  getIdToken,
  getCurrentUserEmail,
  getCurrentCognitoUser,
  getUserAttributes,
  signIn as cognitoSignIn,
  confirmMfaCode as cognitoConfirmMfa,
  signOut as cognitoSignOut,
} from "./cognito";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking"); // "checking" | "signedIn" | "signedOut" | "mfaRequired"
  const [email, setEmail] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pendingMfaUser, setPendingMfaUser] = useState(null);

  async function refreshSetupStatus() {
    try {
      const user = await getCurrentCognitoUser();
      const attrs = await getUserAttributes(user);
      setNeedsSetup(attrs["custom:hasCompletedSetup"] !== "true");
    } catch {
      // Fail open: if we can't read the attribute for any reason, don't
      // trap the user in a redirect loop over a lookup that failed.
      setNeedsSetup(false);
    }
  }

  useEffect(() => {
    getIdToken().then(async (token) => {
      if (token) {
        setEmail(getCurrentUserEmail());
        await refreshSetupStatus();
        setStatus("signedIn");
      } else {
        setStatus("signedOut");
      }
    });
  }, []);

  async function signIn(userEmail, password) {
    const result = await cognitoSignIn(userEmail, password);
    if (result.status === "mfaRequired") {
      setPendingMfaUser(result.cognitoUser);
      setEmail(userEmail);
      setStatus("mfaRequired");
      return result; // caller (Login page) shows the code-entry step
    }
    setEmail(userEmail);
    await refreshSetupStatus();
    setStatus("signedIn");
    return result;
  }

  async function confirmMfa(code) {
    if (!pendingMfaUser) throw new Error("No sign-in is waiting for an MFA code");
    await cognitoConfirmMfa(pendingMfaUser, code);
    setPendingMfaUser(null);
    await refreshSetupStatus();
    setStatus("signedIn");
  }

  function signOut() {
    cognitoSignOut();
    setEmail(null);
    setNeedsSetup(false);
    setPendingMfaUser(null);
    setStatus("signedOut");
  }

  return (
    <AuthContext.Provider value={{ status, email, needsSetup, signIn, confirmMfa, signOut, refreshSetupStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
