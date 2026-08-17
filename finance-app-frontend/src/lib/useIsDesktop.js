import { useEffect, useState } from "react";

// 768px matches the standard tablet/desktop breakpoint most CSS
// frameworks use - wide enough that phones (including large ones in
// landscape) stay on the mobile layout, narrow enough that small
// laptop windows get the desktop one.
const DESKTOP_BREAKPOINT = "(min-width: 768px)";

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_BREAKPOINT).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_BREAKPOINT);
    function handleChange(e) {
      setIsDesktop(e.matches);
    }
    // addEventListener is the modern API; addListener is the Safari <14
    // fallback some users may still be on.
    if (mql.addEventListener) mql.addEventListener("change", handleChange);
    else mql.addListener(handleChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handleChange);
      else mql.removeListener(handleChange);
    };
  }, []);

  return isDesktop;
}
