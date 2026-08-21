import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { colors, fontDisplay, fontBody } from "../lib/theme";

/**
 * A spotlight tour over whatever's actually rendered on the page - takes
 * refs to real DOM elements (not a fake replica of the screen) and
 * measures their live position with getBoundingClientRect, so what's
 * highlighted is exactly what's really there.
 *
 * A step's target may not be in the DOM the instant its step becomes
 * active - e.g. a menu item that only renders after onStepChange opens
 * the menu, which is an async state update in the parent. This retries
 * briefly (500ms) before concluding a target is genuinely absent (e.g.
 * the account list ref when there are zero accounts) and skipping ahead.
 *
 * A step targets an element either via `ref` (a React ref, e.g.
 * Dashboard's own walkthrough) or `targetId` (a plain string matched
 * against a `data-wizard-target="..."` attribute, used by the
 * centralized per-page wizards in lib/wizards.js so their content
 * doesn't need a useRef() wired up in every page). A step with neither
 * renders as a plain, non-spotlit centered card - the same fallback
 * this component already uses for a genuinely-absent ref target, which
 * is exactly right for a conceptual step that was never meant to point
 * at one specific element.
 */
function resolveStepElement(step) {
  if (step?.ref?.current) return step.ref.current;
  if (step?.targetId) return document.querySelector(`[data-wizard-target="${step.targetId}"]`);
  return null;
}

export default function Walkthrough({ steps, onFinish, onStepChange }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const step = steps[index];

  useEffect(() => {
    onStepChange?.(index, step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    let attempts = 0;
    let timeoutId;

    // Clear the previous step's spotlight position immediately - without
    // this, a step whose target takes a moment to resolve (or never
    // does) would show the NEW step's title/body over the OLD step's
    // spotlight box for the length of the retry loop below, which reads
    // as the highlight pointing at the wrong thing.
    setRect(null);

    function measure() {
      const el = resolveStepElement(step);
      if (el) {
        setRect(el.getBoundingClientRect());
        return;
      }
      // A step with no ref/targetId at all was never meant to point at
      // anything - render it as a plain centered card immediately,
      // never skip it (unlike below, where a target was expected).
      if (!step?.ref && !step?.targetId) {
        setRect(null);
        return;
      }
      if (attempts < 10) {
        // Give an async side effect (like opening a menu) time to mount
        // its content before giving up on this step's target.
        attempts += 1;
        timeoutId = setTimeout(measure, 50);
        return;
      }
      // Genuinely absent (not just not-yet-mounted) - skip this step
      // rather than spotlight nothing, unless it's the last step.
      setRect(null);
      if (index < steps.length - 1) {
        setIndex((i) => i + 1);
      }
    }

    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!step) return null;

  const padding = 8;
  const spotlightStyle = rect
    ? {
        position: "fixed",
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        borderRadius: 16,
        boxShadow: `0 0 0 3px ${colors.accentLight}, 0 0 0 9999px rgba(15,27,45,0.78)`,
        zIndex: 100,
        pointerEvents: "none",
        transition: "all 0.2s ease",
      }
    : {
        position: "fixed",
        inset: 0,
        background: "rgba(15,27,45,0.78)",
        zIndex: 100,
      };

  // Position the card below the spotlighted element, or centered if there's no
  // target. The 180 floor keeps the card from starting too low when the
  // spotlighted element is near the bottom of the viewport (e.g. Payday's
  // fixed submit bar) - but a longer step body can still be taller than
  // that reserved space, which would push its Next/Done button below the
  // viewport and out of reach. maxHeight + overflowY guarantee the button
  // row stays reachable (via a scroll inside the card) no matter how long
  // a given step's body text is or where the spotlighted element sits.
  const cardTop = rect ? Math.min(rect.bottom + padding + 12, window.innerHeight - 180) : null;
  const cardStyle = rect
    ? {
        position: "fixed",
        top: cardTop,
        left: 20,
        right: 20,
        zIndex: 101,
        maxHeight: window.innerHeight - cardTop - 20,
        overflowY: "auto",
      }
    : {
        position: "fixed",
        top: "50%",
        left: 20,
        right: 20,
        transform: "translateY(-50%)",
        zIndex: 101,
        maxHeight: "calc(100dvh - 40px)",
        overflowY: "auto",
      };

  // Portaled to document.body for the same reason as WizardMenu (which
  // opens this when launched from PageHeader, nested deep enough under
  // sticky/backdrop-filter ancestors that mobile Safari stops treating
  // `position: fixed` as viewport-relative) - Dashboard's own tour opens
  // this from much shallower in the tree, but there's no harm in the
  // same fix applying there too.
  return createPortal(
    <>
      <div style={spotlightStyle} />
      <div
        style={{ ...cardStyle, background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}`, fontFamily: fontBody }}
        className="max-w-sm mx-auto rounded-2xl p-5"
      >
        <div className="flex items-start justify-between mb-2">
          <h3 style={{ fontFamily: fontDisplay, color: colors.text, fontSize: 17, fontWeight: 600 }}>{step.title}</h3>
          <button onClick={onFinish} aria-label="Skip tour" style={{ color: colors.textMuted }}>
            <X size={18} />
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: colors.textMuted }}>{step.body}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div key={i} className="rounded-full" style={{ width: i === index ? 16 : 6, height: 6, background: i === index ? colors.accent : colors.border }} />
            ))}
          </div>
          <div className="flex gap-2">
            {index < steps.length - 1 ? (
              <button onClick={() => setIndex((i) => i + 1)} className="rounded-lg px-4 py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>
                Next
              </button>
            ) : (
              <button onClick={onFinish} className="rounded-lg px-4 py-2 text-xs font-medium" style={{ background: colors.accent, color: colors.bg }}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
