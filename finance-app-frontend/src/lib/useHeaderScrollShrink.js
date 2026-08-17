import { useEffect, useState } from "react";

// A single threshold flickers right at the boundary - minor scroll jitter
// (momentum scroll, trackpad micro-movements) flips `scrolled` back and
// forth every scroll event. The dead zone between shrinkAt and expandAt
// means once shrunk, it stays shrunk through that jitter and only expands
// back on a real return toward the top.
export function useHeaderScrollShrink(isDesktop, shrinkAt = 60, expandAt = 15) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    function onScroll() {
      setScrolled((prev) => {
        if (window.scrollY > shrinkAt) return true;
        if (window.scrollY < expandAt) return false;
        return prev;
      });
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isDesktop, shrinkAt, expandAt]);

  return scrolled;
}
