import { readdir, readFile } from "node:fs/promises";

import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import {
  createBatchReplayManifestPath,
  createBatchReplayRootDirForStorage,
  resolveBatchReplayRunsArtifactPath
} from "../storage/artifactPaths.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileTossInvestSourceStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";

export function healthResponse(): Record<string, unknown> {
  return {
    status: "ok",
    service: "toss-trading-local-operations-api",
    mode: "paper_only",
    readOnly: true,
    tradingEnabled: false
  };
}

export async function readVirtualPortfolio(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const portfolio = await new FileVirtualPortfolioStore(
    paths.virtualPortfolioPath
  ).read();

  return {
    mode: "paper_only",
    readOnly: true,
    portfolio,
    sourceStatus: portfolio ? "ok" : "missing"
  };
}

export async function readVirtualDecisions(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileVirtualDecisionStore(
    paths.virtualDecisionsPath
  ).readAll();

  return {
    mode: "paper_only",
    readOnly: true,
    decisions: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount
  };
}

export async function readVirtualTrades(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileVirtualTradeStore(
    paths.virtualTradesPath
  ).readAll();

  return {
    mode: "paper_only",
    readOnly: true,
    trades: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount
  };
}

export async function readSchedulerStatus(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createPaperSchedulerPaths(storageBaseDir);
  const [state, lock] = await Promise.all([
    readJsonFile(paths.statePath),
    readJsonFile(paths.lockPath)
  ]);

  return {
    mode: "paper_only",
    readOnly: true,
    stateStatus: state.status,
    lockStatus: lock.status,
    schedulerState: state.value,
    lock: lock.value
  };
}

export async function readHistoricalReplayReport(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const report = await readJsonFile(paths.historicalReplayReportPath);

  return {
    mode: "paper_only",
    readOnly: true,
    status: report.status,
    report: report.value
  };
}

export async function readHistoricalReplayProgress(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const progress = await readJsonFile(paths.historicalReplayProgressPath);
  const progressStatus =
    progress.status === "ok" && isRecord(progress.value)
      ? progress.value["status"]
      : progress.status;

  return {
    mode: "paper_only",
    readOnly: true,
    status: progressStatus,
    fileStatus: progress.status,
    progress: progress.value
  };
}

export async function readBatchReplayAggregateReport(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const report = await readJsonFile(paths.batchReplayAggregateReportPath);

  return {
    mode: "paper_only",
    readOnly: true,
    status: report.status,
    report: report.value
  };
}

export async function readBatchReplayRuns(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const aggregate = await readJsonFile(paths.batchReplayAggregateReportPath);
  const latestManifest = await readLatestBatchReplayManifest(storageBaseDir);
  const manifestRunsPath = readManifestRunsPath(latestManifest?.manifest ?? null);
  const aggregateRunsPath = readSourceRunsPath(aggregate.value);
  const sourceRunsPath =
    latestManifest?.status === "running" && manifestRunsPath !== null
      ? manifestRunsPath
      : aggregateRunsPath ?? manifestRunsPath;
  const batchStatus = latestManifest?.status ?? null;

  if (sourceRunsPath === null) {
    return {
      mode: "paper_only",
      readOnly: true,
      status: "missing",
      aggregateStatus: aggregate.status,
      batchStatus,
      batchId: latestManifest?.batchId ?? null,
      sourceRunsPath: null,
      runs: [],
      count: 0,
      totalCount: 0,
      statusCounts: {},
      corruptLineCount: 0
    };
  }

  const runsPath = resolveBatchReplayRunsArtifactPath(sourceRunsPath, {
    storageBaseDir
  });
  if (runsPath === null) {
    return {
      mode: "paper_only",
      readOnly: true,
      status: "blocked",
      aggregateStatus: aggregate.status,
      batchStatus,
      batchId: latestManifest?.batchId ?? null,
      sourceRunsPath,
      runs: [],
      count: 0,
      totalCount: 0,
      statusCounts: {},
      corruptLineCount: 0
    };
  }

  const result = await readJsonlRecords(runsPath);
  const runs = takeLast(result.records, limit);
  const status = batchStatus === "running" ? "running" : result.status;

  return {
    mode: "paper_only",
    readOnly: true,
    status,
    aggregateStatus: aggregate.status,
    batchStatus,
    batchId: latestManifest?.batchId ?? null,
    sourceRunsPath,
    runs,
    count: runs.length,
    totalCount: result.records.length,
    statusCounts: countRunStatuses(result.records),
    corruptLineCount: result.corruptLineCount
  };
}

export async function readSourceHealth(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileTossInvestSourceStore(
    paths.tossInvestSourcesPath
  ).readAll();
  const byStatus: Record<string, number> = { ok: 0, degraded: 0, blocked: 0 };
  const byCommandKey: Record<string, number> = {};
  let lastCollectedAt: string | null = null;

  for (const source of result.records) {
    byStatus[source.status] = (byStatus[source.status] ?? 0) + 1;
    byCommandKey[source.commandKey] = (byCommandKey[source.commandKey] ?? 0) + 1;
    const collectedAt = source.metadata.collectedAt;
    if (!lastCollectedAt || Date.parse(collectedAt) > Date.parse(lastCollectedAt)) {
      lastCollectedAt = collectedAt;
    }
  }

  return {
    mode: "paper_only",
    readOnly: true,
    status:
      result.corruptLineCount > 0 ||
      (byStatus.degraded ?? 0) > 0 ||
      (byStatus.blocked ?? 0) > 0
        ? "degraded"
        : result.records.length > 0
          ? "ok"
          : "unknown",
    totalCount: result.records.length,
    byStatus,
    byCommandKey,
    lastCollectedAt,
    corruptLineCount: result.corruptLineCount
  };
}

export async function readMarketPackets(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileMarketPacketStore(paths.marketPacketsPath).readAll();

  return {
    mode: "paper_only",
    readOnly: true,
    packets: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount
  };
}

export async function readAuditEvents(
  storageBaseDir: string,
  limit: number
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const result = await new FileAuditLog(paths.auditLogPath).readAll();

  return {
    mode: "paper_only",
    readOnly: true,
    events: takeRecent(result.records, limit),
    count: Math.min(result.records.length, limit),
    totalCount: result.records.length,
    corruptLineCount: result.corruptLineCount
  };
}

function takeRecent<T>(records: T[], limit: number): T[] {
  return records.slice(-limit).reverse();
}

function takeLast<T>(records: T[], limit: number): T[] {
  return records.slice(-limit);
}

async function readJsonFile(
  filePath: string
): Promise<{ status: "missing" | "ok" | "corrupt"; value: unknown | null }> {
  try {
    return { status: "ok", value: JSON.parse(await readFile(filePath, "utf8")) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing", value: null };
    }
    if (error instanceof SyntaxError) {
      return { status: "corrupt", value: null };
    }
    throw error;
  }
}

async function readJsonlRecords(filePath: string): Promise<{
  status: "missing" | "ok" | "degraded";
  records: Record<string, unknown>[];
  corruptLineCount: number;
}> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing", records: [], corruptLineCount: 0 };
    }
    throw error;
  }

  const records: Record<string, unknown>[] = [];
  let corruptLineCount = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        records.push(parsed);
      } else {
        corruptLineCount += 1;
      }
    } catch {
      corruptLineCount += 1;
    }
  }

  return {
    status: corruptLineCount > 0 ? "degraded" : "ok",
    records,
    corruptLineCount
  };
}

function readSourceRunsPath(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceRunsPath = value["sourceRunsPath"];
  if (typeof sourceRunsPath !== "string" || sourceRunsPath.trim().length === 0) {
    return null;
  }
  return sourceRunsPath;
}

interface BatchReplayManifestSnapshot {
  batchId: string | null;
  status: string | null;
  updatedAt: string | null;
  manifest: Record<string, unknown>;
}

async function readLatestBatchReplayManifest(
  storageBaseDir: string
): Promise<BatchReplayManifestSnapshot | null> {
  const batchReplayDir = createBatchReplayRootDirForStorage(storageBaseDir);
  let entries;
  try {
    entries = await readdir(batchReplayDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const manifests: BatchReplayManifestSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = createBatchReplayManifestPath(
      batchReplayDir,
      entry.name
    );
    const manifest = await readJsonFile(manifestPath);
    if (manifest.status !== "ok" || !isRecord(manifest.value)) {
      continue;
    }
    manifests.push({
      batchId: readStringField(manifest.value, "batchId"),
      status: readStringField(manifest.value, "status"),
      updatedAt:
        readStringField(manifest.value, "updatedAt") ??
        readStringField(manifest.value, "startedAt") ??
        readStringField(manifest.value, "completedAt"),
      manifest: manifest.value
    });
  }

  return manifests.sort(compareBatchReplayManifests)[0] ?? null;
}

function readManifestRunsPath(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return readStringField(value, "runsPath");
}

function readStringField(
  value: Record<string, unknown>,
  key: string
): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field : null;
}

function compareBatchReplayManifests(
  left: BatchReplayManifestSnapshot,
  right: BatchReplayManifestSnapshot
): number {
  const leftTime = Date.parse(left.updatedAt ?? "");
  const rightTime = Date.parse(right.updatedAt ?? "");
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0;
  if (normalizedLeft !== normalizedRight) {
    return normalizedRight - normalizedLeft;
  }
  return String(right.batchId ?? "").localeCompare(String(left.batchId ?? ""));
}

function countRunStatuses(
  records: Record<string, unknown>[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const status =
      typeof record["status"] === "string" ? record["status"] : "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
