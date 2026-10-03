"use client";

import { useEffect } from "react";

const REPORT_FRAGMENTS = new Set(["#candidate-comparison", "#data-universe-coverage"]);

function isAtFragmentDestination(target: HTMLElement) {
  const top = target.getBoundingClientRect().top;
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  if (Math.abs(top - margin) <= 3) return true;
  const scroller = document.scrollingElement;
  return top >= margin - 3 && scroller !== null &&
    scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 3;
}

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
        // Preserve a position the user or browser restored before hydration.
        // A native arrival already at this target may still receive focus.
        if (initialX !== 0 || (initialY !== 0 && !isAtFragmentDestination(target))) return;
      }

      // A native link can reach the streamed document before its report target
      // is mounted. Restore the exact destination after hydration/layout, rather
      // than treating the URL hash or DOM visibility as a completed navigation.
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (window.location.pathname !== "/dashboard/validation" || window.location.hash !== hash) return;
        const target = document.getElementById(hash.slice(1));
        if (!target?.isConnected) return;
        if (window.scrollX !== initialX) return;
        // Native fragment scrolling may finish before this frame without moving
        // DOM focus. Complete that exact arrival, but preserve other movement.
        if (window.scrollY !== initialY && !isAtFragmentDestination(target)) return;
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
