"use client";

import { useEffect } from "react";

const REPORT_FRAGMENTS = new Set(["#candidate-comparison", "#data-universe-coverage"]);

export function ValidationFragmentNavigation() {
  useEffect(() => {
    let frame: number | null = null;

    function cancelPendingRestore() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    }

    function restoreFragment(preserveExistingPosition = false) {
      cancelPendingRestore();
      const hash = window.location.hash;
      if (window.location.pathname !== "/dashboard/validation" || !REPORT_FRAGMENTS.has(hash)) return;
      const initialFocus = document.activeElement;
      const initialX = window.scrollX;
      const initialY = window.scrollY;
      if (preserveExistingPosition && (
        (initialFocus && initialFocus !== document.body && initialFocus !== document.documentElement) || initialX || initialY
      )) {
        const target = document.getElementById(hash.slice(1));
        if (!target || (initialFocus && initialFocus !== document.body && initialFocus !== document.documentElement && initialFocus !== target)) return;
        const top = target.getBoundingClientRect().top + initialY;
        const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const expectedY = Math.min(maxY, Math.max(0, top - margin));
        // Preserve a position the user or browser restored before hydration.
        // A native arrival already at this target may still receive focus.
        if ((initialX !== 0 || initialY !== 0) && (initialX !== 0 || Math.abs(initialY - expectedY) > 3)) return;
      }

      // A native link can reach the streamed document before its report target
      // is mounted. Restore the exact destination after hydration/layout, rather
      // than treating the URL hash or DOM visibility as a completed navigation.
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (window.location.pathname !== "/dashboard/validation" || window.location.hash !== hash) return;
        const target = document.getElementById(hash.slice(1));
        if (!target?.isConnected) return;
        if (window.scrollX !== initialX || window.scrollY !== initialY) return;
        if (document.activeElement !== initialFocus && document.activeElement !== target) return;
        target.scrollIntoView({ behavior: "instant", block: "start" });
        target.focus({ preventScroll: true });
      });
    }

    const onHashChange = () => restoreFragment();
    function cancelOnFocusChange(event: FocusEvent) {
      if (frame === null) return;
      const hash = window.location.hash;
      if (REPORT_FRAGMENTS.has(hash) && event.target === document.getElementById(hash.slice(1))) return;
      cancelPendingRestore();
    }
    const intentEvents = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const event of intentEvents) window.addEventListener(event, cancelPendingRestore, { capture: true, passive: true });
    window.addEventListener("focusin", cancelOnFocusChange, true);
    restoreFragment(true);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelPendingRestore();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("focusin", cancelOnFocusChange, true);
      for (const event of intentEvents) window.removeEventListener(event, cancelPendingRestore, true);
    };
  }, []);

  return null;
}
