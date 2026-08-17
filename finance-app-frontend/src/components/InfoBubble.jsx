import React, { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { colors } from "../lib/theme";

const BUBBLE_WIDTH = 256; // matches the old w-64 (16rem) so the popup's visual size doesn't change
const VIEWPORT_MARGIN = 12; // minimum gap kept from either screen edge

export default function InfoBubble({ text }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({ left: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    // Position the bubble so it never renders outside the viewport -
    // previously this was always left-0, so a trigger near the right
    // edge of the screen (common on mobile, where most triggers sit
    // next to right-aligned labels) would push the bubble off-screen.
    function reposition() {
      const trigger = containerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Default: left-aligned with the trigger, same as before.
      let left = 0;
      const wouldOverflowRight = rect.left + BUBBLE_WIDTH + VIEWPORT_MARGIN > viewportWidth;
      if (wouldOverflowRight) {
        // Shift left just enough to fit, anchored to the trigger's own
        // right edge if that still doesn't fit within the margin.
        const shift = rect.left + BUBBLE_WIDTH + VIEWPORT_MARGIN - viewportWidth;
        left = -Math.min(shift, rect.left - VIEWPORT_MARGIN);
      }
      setStyle({ left });
    }

    reposition();

    function handleOutsideClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleScroll() {
      setOpen(false);
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    // capture: true catches scroll on any scrollable ancestor, not just
    // window - a bubble inside a scrolling card/list needs this too.
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    window.addEventListener("resize", reposition);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      window.removeEventListener("scroll", handleScroll, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  return (
    <span className="relative inline-flex align-middle ml-1.5" ref={containerRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="More information" style={{ width: 16, height: 16, color: colors.textMuted }}>
        <HelpCircle size={14} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="absolute z-30 top-6 rounded-lg p-3 text-xs shadow-xl"
          style={{ left: style.left, width: BUBBLE_WIDTH, background: colors.surfaceRaised, border: `1px solid ${colors.borderStrong}`, color: colors.text }}
        >
          {text}
          <button onClick={() => setOpen(false)} className="block mt-2 text-xs underline" style={{ color: colors.accentLight }}>Got it</button>
        </div>
      )}
    </span>
  );
}
