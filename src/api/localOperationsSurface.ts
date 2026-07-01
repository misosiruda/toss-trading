export const READ_ONLY_HTTP_METHODS = ["GET", "HEAD"] as const;
export const PAPER_SIMULATION_MUTATION_METHODS = ["POST"] as const;
export const PAPER_POLICY_VALIDATION_METHODS = ["POST"] as const;
export const PAPER_POLICY_MUTATION_METHODS = ["POST"] as const;
export const STRATEGY_BUCKET_TEST_VALIDATION_METHODS = ["POST"] as const;
export const STRATEGY_BUCKET_TEST_MUTATION_METHODS = ["POST"] as const;

export type ReadOnlyHttpMethod = (typeof READ_ONLY_HTTP_METHODS)[number];
export type PaperSimulationMutationMethod =
  (typeof PAPER_SIMULATION_MUTATION_METHODS)[number];
export type PaperPolicyValidationMethod =
  (typeof PAPER_POLICY_VALIDATION_METHODS)[number];
export type PaperPolicyMutationMethod =
  (typeof PAPER_POLICY_MUTATION_METHODS)[number];
export type StrategyBucketTestValidationMethod =
  (typeof STRATEGY_BUCKET_TEST_VALIDATION_METHODS)[number];
export type StrategyBucketTestMutationMethod =
  (typeof STRATEGY_BUCKET_TEST_MUTATION_METHODS)[number];

export const LOCAL_OPERATIONS_API_ROUTES = [
  "/health",
  "/virtual/portfolio",
  "/virtual/decisions",
  "/virtual/trades",
  "/paper/report",
  "/replay/report",
  "/replay/progress",
  "/research/replay/report",
  "/batch/replay/report",
  "/batch/replay/runs",
  "/dashboard/view-model/live-readiness",
  "/dashboard/view-model/portfolio-compliance",
  "/dashboard/view-model/strategy-test-lab",
  "/dashboard/view-model/risk-gate-trace",
  "/dashboard/view-model/validation-lab",
  "/dashboard/view-model/audit",
  "/scheduler/status",
  "/source/health",
  "/market/packets",
  "/audit/events"
] as const;

export type LocalOperationsApiRoutePath =
  (typeof LOCAL_OPERATIONS_API_ROUTES)[number];

export const PAPER_SIMULATION_MUTATION_API_ROUTES = [
  "/paper/simulations"
] as const;

export type PaperSimulationMutationApiRoutePath =
  (typeof PAPER_SIMULATION_MUTATION_API_ROUTES)[number];

export const PAPER_POLICY_VALIDATION_API_ROUTES = [
  "/paper/policies/validate"
] as const;

export type PaperPolicyValidationApiRoutePath =
  (typeof PAPER_POLICY_VALIDATION_API_ROUTES)[number];

export const PAPER_POLICY_MUTATION_API_ROUTES = ["/paper/policies"] as const;

export type PaperPolicyMutationApiRoutePath =
  (typeof PAPER_POLICY_MUTATION_API_ROUTES)[number];

export const STRATEGY_BUCKET_TEST_VALIDATION_API_ROUTES = [
  "/paper/simulations/strategy-bucket-tests/validate"
] as const;

export type StrategyBucketTestValidationApiRoutePath =
  (typeof STRATEGY_BUCKET_TEST_VALIDATION_API_ROUTES)[number];

export const STRATEGY_BUCKET_TEST_MUTATION_API_ROUTES = [
  "/paper/simulations/strategy-bucket-tests",
  "/paper/simulations/strategy-bucket-tests/matrix"
] as const;

export type StrategyBucketTestMutationApiRoutePath =
  (typeof STRATEGY_BUCKET_TEST_MUTATION_API_ROUTES)[number];

export const LOCAL_OPERATIONS_LEGACY_DASHBOARD_DOCUMENT_PATHS = [
  "/",
  "/dashboard",
  "/dashboard/",
  "/dashboard/virtual",
  "/dashboard/virtual/",
  "/dashboard/virtual/simulations",
  "/dashboard/virtual/simulations/",
  "/dashboard/virtual/simulations/new",
  "/dashboard/virtual/simulations/new/",
  "/dashboard/virtual/simulations/current",
  "/dashboard/virtual/simulations/current/",
  "/dashboard/virtual/validation",
  "/dashboard/virtual/validation/"
] as const;

export type LocalOperationsLegacyDashboardDocumentPath =
  (typeof LOCAL_OPERATIONS_LEGACY_DASHBOARD_DOCUMENT_PATHS)[number];

export const LOCAL_OPERATIONS_LEGACY_DASHBOARD_ALIAS_PATHS = [
  "/dashboard/virtual-replays",
  "/dashboard/virtual-replays/",
  "/dashboard/batch-summary",
  "/dashboard/batch-summary/"
] as const;

export type LocalOperationsLegacyDashboardAliasPath =
  (typeof LOCAL_OPERATIONS_LEGACY_DASHBOARD_ALIAS_PATHS)[number];

export const LOCAL_OPERATIONS_LEGACY_DASHBOARD_REDIRECTS = {
  "/dashboard/virtual-replays": "/dashboard/virtual/simulations",
  "/dashboard/virtual-replays/": "/dashboard/virtual/simulations",
  "/dashboard/batch-summary": "/dashboard/virtual/validation",
  "/dashboard/batch-summary/": "/dashboard/virtual/validation"
} as const satisfies Record<LocalOperationsLegacyDashboardAliasPath, string>;

export const LOCAL_OPERATIONS_DASHBOARD_DOCUMENT_PATHS = [
  ...LOCAL_OPERATIONS_LEGACY_DASHBOARD_DOCUMENT_PATHS
] as const;

export const LOCAL_OPERATIONS_DASHBOARD_ASSET_PATHS = [
  "/dashboard/app.js",
  "/app.js",
  "/dashboard/apiClient.js",
  "/apiClient.js",
  "/dashboard/currentSimulationData.js",
  "/currentSimulationData.js",
  "/dashboard/batchRunRenderers.js",
  "/batchRunRenderers.js",
  "/dashboard/dashboardStatusRenderers.js",
  "/dashboardStatusRenderers.js",
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
  "/dashboard/replayProgressCoordinator.js",
  "/replayProgressCoordinator.js",
  "/dashboard/replayProgressRenderers.js",
  "/replayProgressRenderers.js",
  "/dashboard/reportViewHelpers.js",
  "/reportViewHelpers.js",
  "/dashboard/router.js",
  "/router.js",
  "/dashboard/simulationForm.js",
  "/simulationForm.js",
  "/dashboard/sourceRenderers.js",
  "/sourceRenderers.js",
  "/dashboard/state.js",
  "/state.js",
  "/dashboard/tableRenderers.js",
  "/tableRenderers.js",
  "/dashboard/styles.css",
  "/styles.css"
] as const;

export function isReadOnlyHttpMethod(
  method: string | undefined
): method is ReadOnlyHttpMethod {
  return method === "GET" || method === "HEAD";
}

export function isPaperSimulationMutationMethod(
  method: string | undefined
): method is PaperSimulationMutationMethod {
  return method === "POST";
}

export function isPaperPolicyValidationMethod(
  method: string | undefined
): method is PaperPolicyValidationMethod {
  return method === "POST";
}

export function isPaperPolicyMutationMethod(
  method: string | undefined
): method is PaperPolicyMutationMethod {
  return method === "POST";
}

export function isStrategyBucketTestValidationMethod(
  method: string | undefined
): method is StrategyBucketTestValidationMethod {
  return method === "POST";
}

export function isStrategyBucketTestMutationMethod(
  method: string | undefined
): method is StrategyBucketTestMutationMethod {
  return method === "POST";
}

export function isLocalOperationsApiRoutePath(
  pathname: string
): pathname is LocalOperationsApiRoutePath {
  return LOCAL_OPERATIONS_API_ROUTES.includes(
    pathname as LocalOperationsApiRoutePath
  );
}

export function isPaperSimulationMutationApiRoutePath(
  pathname: string
): pathname is PaperSimulationMutationApiRoutePath {
  return PAPER_SIMULATION_MUTATION_API_ROUTES.includes(
    pathname as PaperSimulationMutationApiRoutePath
  );
}

export function isPaperPolicyValidationApiRoutePath(
  pathname: string
): pathname is PaperPolicyValidationApiRoutePath {
  return PAPER_POLICY_VALIDATION_API_ROUTES.includes(
    pathname as PaperPolicyValidationApiRoutePath
  );
}

export function isPaperPolicyMutationApiRoutePath(
  pathname: string
): pathname is PaperPolicyMutationApiRoutePath {
  return PAPER_POLICY_MUTATION_API_ROUTES.includes(
    pathname as PaperPolicyMutationApiRoutePath
  );
}

export function isStrategyBucketTestValidationApiRoutePath(
  pathname: string
): pathname is StrategyBucketTestValidationApiRoutePath {
  return STRATEGY_BUCKET_TEST_VALIDATION_API_ROUTES.includes(
    pathname as StrategyBucketTestValidationApiRoutePath
  );
}

export function isStrategyBucketTestMutationApiRoutePath(
  pathname: string
): pathname is StrategyBucketTestMutationApiRoutePath {
  return STRATEGY_BUCKET_TEST_MUTATION_API_ROUTES.includes(
    pathname as StrategyBucketTestMutationApiRoutePath
  );
}
