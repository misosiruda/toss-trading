import { fileModeDashboardUrl, state } from "./state.js";

export function bindDashboardNavigation({
  isFileMode,
  onVirtualReplaysPage,
  onOtherPage
}) {
  document.querySelectorAll("[data-dashboard-route]").forEach((link) => {
    const route = link.getAttribute("data-dashboard-route") ?? "overview";
    const path = dashboardPathForRoute(route);
    if (isFileMode()) {
      link.setAttribute("href", `${fileModeDashboardUrl}${path}`);
    }

    link.addEventListener("click", (event) => {
      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }
      if (isFileMode()) {
        return;
      }
      event.preventDefault();
      history.pushState({}, "", link.href);
      applyDashboardRoute();
    });
  });

  window.addEventListener("popstate", applyDashboardRoute);

  return {
    applyDashboardRoute
  };

  function applyDashboardRoute() {
    const page = dashboardPageFromPath(window.location.pathname);
    state.currentPage = page;
    document.documentElement.dataset.dashboardPage = page;

    document.querySelectorAll("[data-dashboard-route]").forEach((link) => {
      const route = link.getAttribute("data-dashboard-route") ?? "overview";
      link.classList.toggle("active", route === page);
      if (route === page) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    document.querySelectorAll(".metric-grid").forEach((section) => {
      section.hidden = page !== "overview";
    });

    document.querySelectorAll(".content-grid > .panel").forEach((panel) => {
      const pageAttribute = panel.getAttribute("data-dashboard-page");
      const pages =
        pageAttribute === null ? ["overview"] : pageAttribute.split(/\s+/);
      panel.hidden = !pages.includes(page);
    });

    document.title = `${dashboardPageLabel(page)} - Toss Trading Paper Dashboard`;
    if (page === "virtual-replays" && !isFileMode()) {
      onVirtualReplaysPage();
    } else {
      onOtherPage();
    }
  }
}

export function dashboardPageFromPath(pathname) {
  if (pathname.startsWith("/dashboard/virtual-replays")) {
    return "virtual-replays";
  }
  if (pathname.startsWith("/dashboard/batch-summary")) {
    return "batch-summary";
  }
  return "overview";
}

export function dashboardPageLabel(page) {
  return {
    overview: "개요",
    "virtual-replays": "가상 투자",
    "batch-summary": "총합 결과"
  }[page] ?? "개요";
}

export function dashboardPathForRoute(route) {
  return {
    overview: "",
    "virtual-replays": "/virtual-replays",
    "batch-summary": "/batch-summary"
  }[route] ?? "";
}
