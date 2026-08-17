import { useEffect, useState } from "react";
import { billingApi } from "./apiClient";

// Fetches the caller's subscription status once. Free tier (no row on the
// backend yet) resolves to { tier: "free", status: null, ... } - same
// null-fallback convention as every other per-user preference in this app.
export function useSubscription() {
  const [tier, setTier] = useState(null); // null while loading
  const [status, setStatus] = useState(null);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    billingApi
      .getStatus()
      .then((data) => {
        setTier(data.tier || "free");
        setStatus(data.status || null);
        setCurrentPeriodEnd(data.currentPeriodEnd || null);
        setCancelAtPeriodEnd(!!data.cancelAtPeriodEnd);
      })
      .catch(() => setTier("free")) // best-effort - treat a failed check as free rather than blocking the page
      .finally(() => setLoading(false));
  }, []);

  return { tier, status, currentPeriodEnd, cancelAtPeriodEnd, loading, isPremium: tier === "premium" };
}
