import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, ArrowRight } from "lucide-react";
import { colors, fontDisplay } from "../lib/theme";

function TierCard({ label, tier, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl p-3.5 transition-opacity hover:opacity-90"
      style={{ background: colors.surface, border: `1px solid ${colors.border}` }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium" style={{ color: colors.text }}>{label}</span>
        <span className="flex items-center gap-1 text-xs" style={{ color: colors.textMuted }}>
          <Clock size={12} />
          ~{tier.minutes} min
        </span>
      </div>
      <ul className="text-xs mb-2" style={{ color: colors.textMuted }}>
        {tier.covers.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      <span className="flex items-center gap-1 text-xs font-medium" style={{ color: colors.accentLight }}>
        Start <ArrowRight size={12} />
      </span>
    </button>
  );
}

/**
 * The wizard-button popup, opened from PageHeader. Two things can be
 * shown, decided by whether `blocked` is set when this opens:
 *
 * - The Basic/Advanced picker (the normal case) - one card per tier
 *   `wizard` actually has (a page with no `advanced` entry just shows
 *   one card, same component either way).
 * - A prerequisite notice (only when `blocked` is set, e.g. Payday
 *   with no income yet) - explains what's missing, with three ways
 *   forward: go complete it, skip straight to the normal picker
 *   anyway, or back out entirely. Never a forced path.
 */
export default function WizardMenu({ open, pageTitle, wizard, blocked, onClose, onSelectTier, onGuide }) {
  const [skippedBlock, setSkippedBlock] = useState(false);

  useEffect(() => {
    if (open) setSkippedBlock(false);
  }, [open]);

  if (!open) return null;

  const showBlocked = !!blocked && !skippedBlock;

  // Portaled to document.body - mounted inside PageHeader, which on some
  // pages sits under enough sticky/backdrop-filter ancestors that mobile
  // Safari stops treating `position: fixed` as viewport-relative and
  // clips the overlay to whatever scrollable box it's actually nested
  // in. Escaping to body sidesteps that entirely.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {showBlocked ? (
          <>
            <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 17, fontWeight: 600 }} className="mb-2">
              Before touring {pageTitle}…
            </p>
            <p className="text-sm mb-4" style={{ color: colors.textMuted }}>{blocked.message}</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onGuide}
                className="w-full rounded-lg py-2.5 text-sm font-medium"
                style={{ background: colors.accent, color: colors.bg }}
              >
                Take me there
              </button>
              <button
                type="button"
                onClick={() => setSkippedBlock(true)}
                className="w-full rounded-lg py-2.5 text-sm font-medium"
                style={{ border: `1px solid ${colors.border}`, color: colors.text }}
              >
                Skip - show me the wizard anyway
              </button>
              <button type="button" onClick={onClose} className="w-full text-xs" style={{ color: colors.textMuted }}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 17, fontWeight: 600 }} className="mb-3">
              {pageTitle} wizard
            </p>
            <div className="flex flex-col gap-2">
              <TierCard label="Basic" tier={wizard.basic} onClick={() => onSelectTier("basic")} />
              {wizard.advanced && (
                <TierCard label="Advanced" tier={wizard.advanced} onClick={() => onSelectTier("advanced")} />
              )}
            </div>
            <button type="button" onClick={onClose} className="w-full text-xs mt-3" style={{ color: colors.textMuted }}>
              Maybe later
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
