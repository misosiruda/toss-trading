export const READ_ONLY_HTTP_METHODS = ["GET", "HEAD"] as const;

export type ReadOnlyHttpMethod = (typeof READ_ONLY_HTTP_METHODS)[number];

export const LOCAL_OPERATIONS_API_ROUTES = [
  "/health",
  "/virtual/portfolio",
  "/virtual/decisions",
  "/virtual/trades",
  "/paper/report",
  "/replay/report",
  "/replay/progress",
  "/batch/replay/report",
  "/batch/replay/runs",
  "/scheduler/status",
  "/source/health",
  "/market/packets",
  "/audit/events"
] as const;

export type LocalOperationsApiRoutePath =
  (typeof LOCAL_OPERATIONS_API_ROUTES)[number];

export const LOCAL_OPERATIONS_DASHBOARD_DOCUMENT_PATHS = [
  "/",
  "/dashboard",
  "/dashboard/",
  "/dashboard/virtual-replays",
  "/dashboard/virtual-replays/",
  "/dashboard/batch-summary",
  "/dashboard/batch-summary/"
] as const;

export const LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS = [
  "/dashboard/app.js",
  "/app.js",
  "/dashboard/apiClient.js",
  "/apiClient.js",
  "/dashboard/batchRunRenderers.js",
  "/batchRunRenderers.js",
  "/dashboard/dom.js",
  "/dom.js",
  "/dashboard/decisionRenderers.js",
  "/decisionRenderers.js",
  "/dashboard/formatters.js",
  "/formatters.js",
  "/dashboard/metadata.js",
  "/metadata.js",
  "/dashboard/portfolioModel.js",
  "/portfolioModel.js",
  "/dashboard/portfolioRenderers.js",
  "/portfolioRenderers.js",
  "/dashboard/reportRenderers.js",
  "/reportRenderers.js",
  "/dashboard/reportViewHelpers.js",
  "/reportViewHelpers.js",
  "/dashboard/router.js",
  "/router.js",
  "/dashboard/state.js",
  "/state.js",
  "/dashboard/styles.css",
  "/styles.css"
] as const;

export function isReadOnlyHttpMethod(
  method: string | undefined
): method is ReadOnlyHttpMethod {
  return method === "GET" || method === "HEAD";
}

export function isLocalOperationsApiRoutePath(
  pathname: string
): pathname is LocalOperationsApiRoutePath {
  return LOCAL_OPERATIONS_API_ROUTES.includes(
    pathname as LocalOperationsApiRoutePath
  );
}
