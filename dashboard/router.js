import { fileModeDashboardUrl, state } from "./state.js";

export function bindDashboardNavigation({
  isFileMode,
  onBatchRunsPage,
  onOtherPage
}) {
  document.querySelectorAll("[data-dashboard-route]").forEach((link) => {
    const route = link.getAttribute("data-dashboard-route") ?? "live";
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
      const route = link.getAttribute("data-dashboard-route") ?? "live";
      link.classList.toggle("active", route === page);
      if (route === page) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    document.querySelectorAll(".metric-grid").forEach((section) => {
      section.hidden = page !== "virtual";
    });

    document.querySelectorAll(".content-grid > .panel").forEach((panel) => {
      const pageAttribute = panel.getAttribute("data-dashboard-page");
      const pages = pageAttribute === null ? ["virtual"] : pageAttribute.split(/\s+/);
      panel.hidden = !pages.includes(page);
    });

    document.title = `${dashboardPageLabel(page)} - Toss Trading Paper Dashboard`;
    if (
      (page === "virtual" || page === "active-simulation" || page === "history") &&
      !isFileMode()
    ) {
      onBatchRunsPage();
    } else {
      onOtherPage();
    }
  }
}

export function dashboardPageFromPath(pathname) {
  if (pathname.startsWith("/dashboard/virtual/simulations/new")) {
    return "new-simulation";
  }
  if (pathname.startsWith("/dashboard/virtual/simulations/current")) {
    return "active-simulation";
  }
  if (pathname.startsWith("/dashboard/virtual/simulations")) {
    return "history";
  }
  if (pathname.startsWith("/dashboard/virtual/validation")) {
    return "validation";
  }
  if (pathname.startsWith("/dashboard/virtual-replays")) {
    return "active-simulation";
  }
  if (pathname.startsWith("/dashboard/batch-summary")) {
    return "validation";
  }
  if (pathname.startsWith("/dashboard/virtual")) {
    return "virtual";
  }
  return "live";
}

export function dashboardPageLabel(page) {
  return {
    live: "Live",
    virtual: "가상 투자",
    "new-simulation": "새 가상 투자",
    "active-simulation": "실행 상세",
    history: "히스토리",
    validation: "검증 센터"
  }[page] ?? "Live";
}

export function dashboardPathForRoute(route) {
  return {
    live: "",
    virtual: "/virtual",
    "new-simulation": "/virtual/simulations/new",
    "active-simulation": "/virtual/simulations/current",
    history: "/virtual/simulations",
    validation: "/virtual/validation"
  }[route] ?? "";
}
