import { buildPaperDailyReport } from "../reports/paperDailyReport.js";
import {
  healthResponse,
  readAuditEvents,
  readBatchReplayAggregateReport,
  readBatchReplayRuns,
  readHistoricalReplayProgress,
  readHistoricalReplayReport,
  readMarketPackets,
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
  "/batch/replay/report": (_url, options) =>
    readBatchReplayAggregateReport(options.storageBaseDir),
  "/batch/replay/runs": (url, options) =>
    readBatchReplayRuns(options.storageBaseDir, readLimit(url)),
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
