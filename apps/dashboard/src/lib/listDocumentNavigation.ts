/** Installed before SSR anchors become actionable; also used after client entry. */
export function installListDocumentNavigation() {
  const owner = window as Window & { __experimentListDocumentGuard?: boolean };
  if (owner.__experimentListDocumentGuard) return;
  owner.__experimentListDocumentGuard = true;
  let pendingDocument = false;
  let queuedDestination: string | null = null;
  const onList = () => window.location.pathname === "/dashboard" && document.querySelector("[data-list-native-boundary]") !== null;
  const cancelPending = () => {
    queuedDestination = null;
    if (!pendingDocument) return;
    pendingDocument = false;
    window.stop();
  };
  document.addEventListener("click", event => {
    if (!onList() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      if (target?.closest('[data-list-native-boundary] form[role="search"] button')) cancelPending();
      return;
    }
    if (anchor.hasAttribute("download") || (anchor.target && anchor.target.toLowerCase() !== "_self")) return;
    const destination = new URL(anchor.href);
    if (!["http:", "https:"].includes(destination.protocol)) return;
    const current = new URL(window.location.href);
    if (destination.origin !== current.origin) {
      // Cancel the superseded document but let the original external anchor
      // retain its referrerPolicy/rel and native activation semantics.
      const replacesControlledDocument = pendingDocument;
      cancelPending();
      pendingDocument = replacesControlledDocument;
      return;
    }
    const sameDocument = destination.origin === current.origin && destination.pathname === current.pathname && destination.search === current.search;
    const replacingPending = pendingDocument;
    cancelPending();
    // A later cross-document intent must stay native while this retained
    // document is active, even when the other destination is a Next Link.
    if (replacingPending && !sameDocument) {
      event.preventDefault();
      // Next Link respects defaultPrevented; React navigation UI handlers must
      // still receive the event so a pending replacement closes mobile menus.
      pendingDocument = true;
      window.location.assign(destination.href);
      return;
    }
    if (!sameDocument && anchor.hasAttribute("data-native-list-document")) {
      if (document.readyState !== "complete") {
        // Starting a document now would make cancellation also stop initial
        // hydration chunks. Retain only the latest intent until load completes;
        // fragment/history/filter intent cancels it without stopping resources.
        event.preventDefault();
        queuedDestination = destination.href;
      } else pendingDocument = true;
    }
  }, true);
  const filterIntent = (event: Event) => {
    if (onList() && event.target instanceof Element && event.target.closest('[data-list-native-boundary] form[role="search"]')) cancelPending();
  };
  // Capture precedes React handlers and their synchronous History API writes.
  document.addEventListener("input", filterIntent, true);
  document.addEventListener("change", filterIntent, true);
  document.addEventListener("submit", filterIntent, true);
  window.addEventListener("popstate", () => {
    if (!pendingDocument && !queuedDestination) return;
    cancelPending();
    // Same-list history keeps its loaded snapshot. A traversal to another
    // path must activate that history destination instead of retaining list UI.
    if (window.location.pathname !== "/dashboard") window.location.replace(window.location.href);
  }, true);
  window.addEventListener("hashchange", () => { if (onList()) cancelPending(); }, true);
  window.addEventListener("load", () => {
    const destination = queuedDestination;
    queuedDestination = null;
    if (!destination || !onList()) return;
    pendingDocument = true;
    window.location.assign(destination);
  }, { once: true });
  window.addEventListener("pagehide", () => { pendingDocument = false; queuedDestination = null; });
  window.addEventListener("pageshow", event => { if (event.persisted) { pendingDocument = false; queuedDestination = null; } });
}

// The installer is self-contained: its serialized SSR bootstrap has no imports,
// user input or credentials. One guard lives for the browser document lifetime.
export const listDocumentNavigationBootstrap = `(${installListDocumentNavigation.toString()})();`;
