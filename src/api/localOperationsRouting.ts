import { buildPaperDailyReport } from "../reports/paperDailyReport.js";
import {
  readDashboardPortfolioComplianceViewModel,
  readDashboardRiskGateTraceViewModel,
  readDashboardStrategyBucketTestProgressViewModel,
  readDashboardStrategyTestLabViewModel,
  readDashboardValidationLabViewModel
} from "./dashboardViewModels.js";
import {
  healthResponse,
  readAuditEvents,
  readBatchReplayAggregateReport,
  readBatchReplayRuns,
  readHistoricalReplayProgress,
  readHistoricalReplayReport,
  readMarketPackets,
  readReplayResearchReport,
  readSchedulerStatus,
  readSourceHealth,
  readVirtualDecisions,
  readVirtualPortfolio,
  readVirtualTrades
} from "./localOperationsReaders.js";
import {
  isLocalOperationsApiRoutePath,
  type LocalOperationsApiRoutePath
} from "./localOperationsSurface.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";

export async function routeRequest(
  url: URL,
  options: LocalOperationsServerOptions
): Promise<unknown | null> {
  const strategyBucketTestProgressTestId =
    readStrategyBucketTestProgressTestId(url.pathname);
  if (strategyBucketTestProgressTestId !== null) {
    return readDashboardStrategyBucketTestProgressViewModel(
      options.storageBaseDir,
      strategyBucketTestProgressTestId,
      readNow(options)
    );
  }

  if (!isLocalOperationsApiRoutePath(url.pathname)) {
    return null;
  }

  return LOCAL_OPERATIONS_ROUTE_HANDLERS[url.pathname](url, options);
}

type LocalOperationsRouteHandler = (
  url: URL,
  options: LocalOperationsServerOptions
) => Promise<unknown> | unknown;

const LOCAL_OPERATIONS_ROUTE_HANDLERS: Record<
  LocalOperationsApiRoutePath,
  LocalOperationsRouteHandler
> = {
  "/health": () => healthResponse(),
  "/virtual/portfolio": (_url, options) =>
    readVirtualPortfolio(options.storageBaseDir),
  "/virtual/decisions": (url, options) =>
    readVirtualDecisions(options.storageBaseDir, readLimit(url)),
  "/virtual/trades": (url, options) =>
    readVirtualTrades(options.storageBaseDir, readLimit(url)),
  "/paper/report": (url, options) =>
    buildPaperDailyReport({
      storageBaseDir: options.storageBaseDir,
      date: readDate(url, options),
      generatedAt: readNow(options)
    }),
  "/replay/report": (_url, options) =>
    readHistoricalReplayReport(options.storageBaseDir),
  "/replay/progress": (_url, options) =>
    readHistoricalReplayProgress(options.storageBaseDir),
  "/research/replay/report": (_url, options) =>
    readReplayResearchReport(options.storageBaseDir),
  "/batch/replay/report": (_url, options) =>
    readBatchReplayAggregateReport(options.storageBaseDir),
  "/batch/replay/runs": (url, options) =>
    readBatchReplayRuns(options.storageBaseDir, readLimit(url), {
      includeLatestRunArtifacts:
        url.searchParams.get("includeLatestRunArtifacts") === "1"
    }),
  "/dashboard/view-model/portfolio-compliance": (_url, options) =>
    readDashboardPortfolioComplianceViewModel(options.storageBaseDir),
  "/dashboard/view-model/strategy-test-lab": (_url, options) =>
    readDashboardStrategyTestLabViewModel(
      options.storageBaseDir,
      readNow(options)
    ),
  "/dashboard/view-model/risk-gate-trace": (url, options) =>
    readDashboardRiskGateTraceViewModel(options.storageBaseDir, readLimit(url)),
  "/dashboard/view-model/validation-lab": (_url, options) =>
    readDashboardValidationLabViewModel(options.storageBaseDir),
  "/scheduler/status": (_url, options) =>
    readSchedulerStatus(options.storageBaseDir),
  "/source/health": (_url, options) =>
    readSourceHealth(options.storageBaseDir),
  "/market/packets": (url, options) =>
    readMarketPackets(options.storageBaseDir, readLimit(url)),
  "/audit/events": (url, options) =>
    readAuditEvents(options.storageBaseDir, readLimit(url))
};

function readLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return 20;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return 20;
  }
  return parsed;
}

function readDate(url: URL, options: LocalOperationsServerOptions): string {
  const raw = url.searchParams.get("date");
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return readNow(options).toISOString().slice(0, 10);
}

function readNow(options: LocalOperationsServerOptions): Date {
  return options.now?.() ?? new Date();
}

function readStrategyBucketTestProgressTestId(pathname: string): string | null {
  const prefix = "/dashboard/view-model/strategy-test-lab/tests/";
  const suffix = "/progress";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }

  const encodedTestId = pathname.slice(prefix.length, -suffix.length);
  if (encodedTestId.length === 0 || encodedTestId.includes("/")) {
    return null;
  }

  try {
    const decodedTestId = decodeURIComponent(encodedTestId).trim();
    if (decodedTestId.length === 0 || decodedTestId.includes("/")) {
      return null;
    }
    return decodedTestId;
  } catch {
    return null;
  }
}
