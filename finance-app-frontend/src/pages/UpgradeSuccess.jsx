import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { billingApi } from "../lib/apiClient";
import { colors, fontDisplay, fontBody } from "../lib/theme";
import PageHeader from "../components/PageHeader";

// Stripe redirects here right after Checkout completes, but our backend
// only finds out via webhook - which can lag the redirect by a couple of
// seconds. Poll billing/status briefly rather than trusting the redirect
// alone (that's what produced the "says upgraded, but Settings still says
// Free" confusion this page replaces), with a manual way through
// regardless in case the webhook is slower than the poll window.
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 6; // ~9 seconds total

export default function UpgradeSuccessPage() {
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [pollsRemaining, setPollsRemaining] = useState(MAX_POLLS);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    function poll() {
      billingApi
        .getStatus()
        .then((data) => {
          if (cancelled) return;
          if (data.tier === "premium") {
            setConfirmed(true);
            return;
          }
          attempts += 1;
          setPollsRemaining(MAX_POLLS - attempts);
          if (attempts < MAX_POLLS) setTimeout(poll, POLL_INTERVAL_MS);
        })
        .catch(() => {
          if (cancelled) return;
          attempts += 1;
          setPollsRemaining(MAX_POLLS - attempts);
          if (attempts < MAX_POLLS) setTimeout(poll, POLL_INTERVAL_MS);
        });
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  const stillWaiting = !confirmed && pollsRemaining > 0;

  return (
    <div className="min-h-screen pb-10" style={{ background: colors.bg, fontFamily: fontBody }}>
      <PageHeader title="Upgrade" />
      <div className="px-5 pt-10 max-w-md mx-auto text-center">
        <div className="rounded-2xl p-6" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
          {confirmed ? (
            <>
              <CheckCircle2 size={32} style={{ color: colors.positive }} className="mx-auto mb-3" />
              <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }} className="mb-2">
                You're on Premium
              </h2>
              <p className="text-sm mb-5" style={{ color: colors.textMuted }}>
                Your payment went through and Premium is active on your account.
              </p>
            </>
          ) : stillWaiting ? (
            <>
              <Loader2 size={32} style={{ color: colors.accentLight }} className="mx-auto mb-3 animate-spin" />
              <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }} className="mb-2">
                Confirming your upgrade…
              </h2>
              <p className="text-sm mb-5" style={{ color: colors.textMuted }}>
                Your payment succeeded - just waiting on the final confirmation. This is usually quick.
              </p>
            </>
          ) : (
            <>
              <h2 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 18, fontWeight: 600 }} className="mb-2">
                Payment received
              </h2>
              <p className="text-sm mb-5" style={{ color: colors.textMuted }}>
                Your payment succeeded, but confirming it on our end is taking longer than expected. It should
                finish shortly - check Settings in a minute, and let us know if it's still showing Free.
              </p>
            </>
          )}
          <button
            onClick={() => navigate("/settings")}
            className="rounded-xl px-5 py-2.5 text-sm font-medium"
            style={{ background: colors.accent, color: colors.bg }}
          >
            Continue to Settings
          </button>
        </div>
      </div>
    </div>
  );
}
