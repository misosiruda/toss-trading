import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import {
  BATCH_REPLAY_ARTIFACT_DIR_NAME,
  BATCH_REPLAY_RUNS_DIR_NAME,
  createBatchReplayManifestPath,
  createBatchReplayRootDirForStorage,
  HISTORICAL_REPLAY_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_PACKETS_FILE_NAME,
  HISTORICAL_REPLAY_PROGRESS_FILE_NAME,
  HISTORICAL_REPLAY_REPORT_FILE_NAME,
  HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME,
  HISTORICAL_REPLAY_TRADES_FILE_NAME,
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
import { buildReplayResearchReport } from "../reports/replayResearchReport.js";
import type { BatchReplayAggregateReport } from "../reports/batchReplayReport.js";

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

export async function readReplayResearchReport(
  storageBaseDir: string
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const aggregate = await readJsonFile(paths.batchReplayAggregateReportPath);
  const report =
    aggregate.status === "ok" && isRecord(aggregate.value)
      ? buildReplayResearchReport({
          aggregateReport:
            aggregate.value as unknown as BatchReplayAggregateReport,
          generatedAt: new Date()
        })
      : null;

  return {
    mode: "paper_only",
    readOnly: true,
    status: aggregate.status,
    aggregateReportStatus: aggregate.status,
    report
  };
}

export async function readBatchReplayRuns(
  storageBaseDir: string,
  limit: number,
  options: { includeLatestRunArtifacts?: boolean } = {}
): Promise<Record<string, unknown>> {
  const paths = createStoragePaths(storageBaseDir);
  const aggregate = await readJsonFile(paths.batchReplayAggregateReportPath);
  const latestManifest = await readLatestBatchReplayManifest(storageBaseDir);
  const manifestRunsPath = readManifestRunsPath(latestManifest?.manifest ?? null);
  const aggregateRunsPath = readSourceRunsPath(aggregate.value);
  const sourceRunsPath = manifestRunsPath ?? aggregateRunsPath;
  const batchStatus = latestManifest?.status ?? null;
  const manifestMetadata = await readBatchReplayManifestMetadata(latestManifest);

  if (sourceRunsPath === null) {
    return {
      mode: "paper_only",
      readOnly: true,
      status: "missing",
      aggregateStatus: aggregate.status,
      batchStatus,
      batchId: latestManifest?.batchId ?? null,
      ...manifestMetadata,
      sourceRunsPath: null,
      runs: [],
      count: 0,
      totalCount: 0,
      statusCounts: {},
      aiDecisionFailureRunCount: 0,
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
      ...manifestMetadata,
      sourceRunsPath,
      runs: [],
      count: 0,
      totalCount: 0,
      statusCounts: {},
      aiDecisionFailureRunCount: 0,
      corruptLineCount: 0
    };
  }

const result = await readJsonlRecords(runsPath);
  const records = result.records.map(normalizeBatchReplayRunRecord);
  const runs = takeLast(records, limit);
  const latestRunArtifacts = options.includeLatestRunArtifacts
    ? await readLatestRunArtifacts({
        storageBaseDir,
        activeRun: readRecordField(latestManifest?.manifest ?? null, "activeRun"),
        sourceDataDir: readStringFieldOrNull(
          latestManifest?.manifest ?? null,
          "sourceDataDir"
        ),
        records
      })
    : null;
  const normalizedBatchStatus = normalizeBatchReplayBatchStatus(
    batchStatus,
    records
  );
  const status = normalizedBatchStatus === "running" ? "running" : result.status;

  return {
    mode: "paper_only",
    readOnly: true,
    status,
    aggregateStatus: aggregate.status,
    batchStatus: normalizedBatchStatus,
    batchId: latestManifest?.batchId ?? null,
    ...manifestMetadata,
    sourceRunsPath,
    runs,
    count: runs.length,
    totalCount: records.length,
    statusCounts: countRunStatuses(records),
    aiDecisionFailureRunCount: countAiDecisionFailureRuns(records),
    corruptLineCount: result.corruptLineCount,
    latestRunArtifacts
  };
}

async function readLatestRunArtifacts(input: {
  storageBaseDir: string;
  activeRun: Record<string, unknown> | null;
  sourceDataDir: string | null;
  records: Record<string, unknown>[];
}): Promise<Record<string, unknown> | null> {
  const run =
    input.activeRun ??
    [...input.records]
      .reverse()
      .find((record) => readStringField(record, "storageBaseDir") !== null) ??
    null;
  if (run === null) {
    return null;
  }

  const runStorageBaseDir = resolveBatchReplayRunStorageBaseDir(
    readStringField(run, "storageBaseDir"),
    input.storageBaseDir
  );
  if (runStorageBaseDir === null) {
    return {
      status: "blocked",
      runId: readStringFieldOrNull(run, "runId"),
      reason: "run storageBaseDir is outside allowed batch replay artifacts"
    };
  }

  const reportPath = resolveBatchReplayRunArtifactPath(
    readStringFieldOrNull(run, "reportPath") ??
      resolve(runStorageBaseDir, HISTORICAL_REPLAY_REPORT_FILE_NAME),
    input.storageBaseDir,
    HISTORICAL_REPLAY_REPORT_FILE_NAME
  );
  const paths = {
    progress: resolveBatchReplayRunArtifactPath(
      resolve(runStorageBaseDir, HISTORICAL_REPLAY_PROGRESS_FILE_NAME),
      input.storageBaseDir,
      HISTORICAL_REPLAY_PROGRESS_FILE_NAME
    ),
    decisions: resolveBatchReplayRunArtifactPath(
      resolve(runStorageBaseDir, HISTORICAL_REPLAY_DECISIONS_FILE_NAME),
      input.storageBaseDir,
      HISTORICAL_REPLAY_DECISIONS_FILE_NAME
    ),
    packets: resolveBatchReplayRunArtifactPath(
      resolve(runStorageBaseDir, HISTORICAL_REPLAY_PACKETS_FILE_NAME),
      input.storageBaseDir,
      HISTORICAL_REPLAY_PACKETS_FILE_NAME
    ),
    riskDecisions: resolveBatchReplayRunArtifactPath(
      resolve(runStorageBaseDir, HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME),
      input.storageBaseDir,
      HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME
    ),
    trades: resolveBatchReplayRunArtifactPath(
      resolve(runStorageBaseDir, HISTORICAL_REPLAY_TRADES_FILE_NAME),
      input.storageBaseDir,
      HISTORICAL_REPLAY_TRADES_FILE_NAME
    )
  };

  const [
    report,
    progress,
    decisions,
    packets,
    riskDecisions,
    trades,
    sourceNameLookup
  ] = await Promise.all([
      reportPath === null
        ? Promise.resolve({ status: "blocked" as const, value: null })
        : readJsonFile(reportPath),
      paths.progress === null
        ? Promise.resolve({ status: "blocked" as const, value: null })
        : readJsonFile(paths.progress),
      paths.decisions === null
        ? Promise.resolve(emptyJsonlResult("blocked"))
        : readJsonlRecords(paths.decisions),
      paths.packets === null
        ? Promise.resolve(emptyJsonlResult("blocked"))
        : readJsonlRecords(paths.packets),
      paths.riskDecisions === null
        ? Promise.resolve(emptyJsonlResult("blocked"))
        : readJsonlRecords(paths.riskDecisions),
      paths.trades === null
        ? Promise.resolve(emptyJsonlResult("blocked"))
        : readJsonlRecords(paths.trades),
      readSourceSnapshotNameLookup({
        sourceDataDir: input.sourceDataDir,
        storageBaseDir: input.storageBaseDir
      })
    ]);
  const packetRecords = enrichPacketCandidatesWithSourceNames(
    packets.records,
    sourceNameLookup
  );

  return {
    status:
      report.status === "ok" || progress.status === "ok" ? "ok" : "missing",
    runId: readStringFieldOrNull(run, "runId"),
    runStatus: readStringFieldOrNull(run, "status"),
    storageBaseDir: runStorageBaseDir,
    reportStatus: report.status,
    report: report.value,
    progressStatus: progress.status,
    progress: progress.value,
    decisionsStatus: decisions.status,
    decisions: takeLast(decisions.records, 100),
    decisionCount: Math.min(decisions.records.length, 100),
    totalDecisionCount: decisions.records.length,
    decisionCorruptLineCount: decisions.corruptLineCount,
    packetsStatus: packets.status,
    packets: takeLast(packetRecords, 100),
    packetCount: Math.min(packets.records.length, 100),
    totalPacketCount: packets.records.length,
    packetCorruptLineCount: packets.corruptLineCount,
    riskDecisionsStatus: riskDecisions.status,
    riskDecisions: takeLast(riskDecisions.records, 100),
    riskDecisionCount: Math.min(riskDecisions.records.length, 100),
    totalRiskDecisionCount: riskDecisions.records.length,
    riskDecisionCorruptLineCount: riskDecisions.corruptLineCount,
    tradesStatus: trades.status,
    trades: takeLast(trades.records, 100),
    tradeCount: Math.min(trades.records.length, 100),
    totalTradeCount: trades.records.length,
    tradeCorruptLineCount: trades.corruptLineCount
  };
}

interface SourceSnapshotNameCacheEntry {
  mtimeMs: number;
  size: number;
  names: Map<string, string>;
}

const sourceSnapshotNameCache = new Map<string, SourceSnapshotNameCacheEntry>();

async function readSourceSnapshotNameLookup(input: {
  sourceDataDir: string | null;
  storageBaseDir: string;
}): Promise<Map<string, string>> {
  const snapshotPath = resolveSourceSnapshotPath(
    input.sourceDataDir,
    input.storageBaseDir
  );
  if (snapshotPath === null) {
    return new Map();
  }

  let fileStat;
  try {
    fileStat = await stat(snapshotPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const cacheKey = snapshotPath;
  const cached = sourceSnapshotNameCache.get(cacheKey);
  if (
    cached &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    return cached.names;
  }

  const result = await readJsonlRecords(snapshotPath);
  const names = new Map<string, string>();
  for (const snapshot of result.records) {
    const market = readStringField(snapshot, "market");
    const symbol = readStringField(snapshot, "symbol");
    const name = readStringField(snapshot, "name");
    if (market === null || symbol === null || name === null) {
      continue;
    }
    const key = symbolMetadataKey(market, symbol);
    if (!names.has(key)) {
      names.set(key, name);
    }
  }

  sourceSnapshotNameCache.set(cacheKey, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    names
  });
  return names;
}

function resolveSourceSnapshotPath(
  sourceDataDir: string | null,
  storageBaseDir: string
): string | null {
  if (sourceDataDir === null) {
    return null;
  }

  const resolvedDir = resolveArtifactInputPath(sourceDataDir);
  const snapshotPath = createStoragePaths(resolvedDir).historicalMarketSnapshotsPath;
  return isAllowedArtifactPath(snapshotPath, storageBaseDir)
    ? snapshotPath
    : null;
}

function enrichPacketCandidatesWithSourceNames(
  packets: Record<string, unknown>[],
  names: Map<string, string>
): Record<string, unknown>[] {
  if (names.size === 0) {
    return packets;
  }

  return packets.map((packet) => {
    const candidates = packet["candidates"];
    if (!Array.isArray(candidates)) {
      return packet;
    }

    let changed = false;
    const enrichedCandidates = candidates.map((candidate) => {
      if (!isRecord(candidate) || readStringField(candidate, "name") !== null) {
        return candidate;
      }
      const market = readStringField(candidate, "market");
      const symbol = readStringField(candidate, "symbol");
      if (market === null || symbol === null) {
        return candidate;
      }
      const name = names.get(symbolMetadataKey(market, symbol));
      if (name === undefined) {
        return candidate;
      }
      changed = true;
      return { ...candidate, name };
    });

    return changed ? { ...packet, candidates: enrichedCandidates } : packet;
  });
}

function symbolMetadataKey(market: string, symbol: string): string {
  return `${market}:${symbol}`;
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

function emptyJsonlResult(status: "blocked" | "missing"): {
  status: "blocked" | "missing";
  records: Record<string, unknown>[];
  corruptLineCount: number;
} {
  return {
    status,
    records: [],
    corruptLineCount: 0
  };
}

function resolveBatchReplayRunStorageBaseDir(
  sourcePath: string | null,
  storageBaseDir: string
): string | null {
  if (sourcePath === null) {
    return null;
  }
  const resolvedPath = resolveArtifactInputPath(sourcePath);
  const normalized = normalizedPath(resolvedPath);
  if (
    !normalized.includes(`/${BATCH_REPLAY_ARTIFACT_DIR_NAME}/`) ||
    !normalized.includes(`/${BATCH_REPLAY_RUNS_DIR_NAME}/`)
  ) {
    return null;
  }
  return isAllowedArtifactPath(resolvedPath, storageBaseDir)
    ? resolvedPath
    : null;
}

function resolveBatchReplayRunArtifactPath(
  sourcePath: string | null,
  storageBaseDir: string,
  fileName: string
): string | null {
  if (sourcePath === null) {
    return null;
  }
  const resolvedPath = resolveArtifactInputPath(sourcePath);
  const normalized = normalizedPath(resolvedPath);
  if (
    basename(resolvedPath) !== fileName ||
    !normalized.includes(`/${BATCH_REPLAY_ARTIFACT_DIR_NAME}/`) ||
    !normalized.includes(`/${BATCH_REPLAY_RUNS_DIR_NAME}/`)
  ) {
    return null;
  }
  return isAllowedArtifactPath(resolvedPath, storageBaseDir)
    ? resolvedPath
    : null;
}

function resolveArtifactInputPath(sourcePath: string): string {
  return isAbsolute(sourcePath)
    ? resolve(sourcePath)
    : resolve(process.cwd(), sourcePath);
}

function isAllowedArtifactPath(
  resolvedPath: string,
  storageBaseDir: string
): boolean {
  const allowedRoots = [
    resolve(process.cwd()),
    resolve(storageBaseDir),
    createBatchReplayRootDirForStorage(storageBaseDir),
    resolve(process.cwd(), "data", BATCH_REPLAY_ARTIFACT_DIR_NAME)
  ];
  return allowedRoots.some((root) => isPathInside(resolvedPath, root));
}

function normalizedPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
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

async function readBatchReplayManifestMetadata(
  snapshot: BatchReplayManifestSnapshot | null
): Promise<Record<string, unknown>> {
  const manifest = snapshot?.manifest ?? null;
  const decisionProvider = readRecordField(manifest, "decisionProvider");
  const activeRun = readRecordField(manifest, "activeRun");
  const activeRunProgress = await readActiveRunProgress(activeRun);

  return {
    batchStartedAt: readStringFieldOrNull(manifest, "startedAt"),
    batchUpdatedAt: snapshot?.updatedAt ?? null,
    batchCompletedAt: readStringFieldOrNull(manifest, "completedAt"),
    requestedRunCount: readNumberFieldOrNull(manifest, "runCount"),
    initialCashKrw: readNumberFieldOrNull(manifest, "initialCashKrw"),
    activeRun,
    activeRunProgressStatus: activeRunProgress.status,
    activeRunProgress: activeRunProgress.value,
    manifestCounts: readManifestCounts(manifest),
    decisionProviderMode: readStringFieldOrNull(decisionProvider, "mode"),
    decisionProviderMaxCallsPerRun: readNumberFieldOrNull(
      decisionProvider,
      "maxCallsPerRun"
    ),
    riskProfile: readStringFieldOrNull(manifest, "riskProfile"),
    sourceDataDir: readStringFieldOrNull(manifest, "sourceDataDir")
  };
}

async function readActiveRunProgress(
  activeRun: Record<string, unknown> | null
): Promise<{
  status: "missing" | "ok" | "corrupt";
  value: unknown | null;
}> {
  const storageBaseDir = readStringFieldOrNull(activeRun, "storageBaseDir");
  if (storageBaseDir === null) {
    return { status: "missing", value: null };
  }
  const paths = createStoragePaths(storageBaseDir);
  return readJsonFile(paths.historicalReplayProgressPath);
}

function readManifestCounts(value: Record<string, unknown> | null): {
  completed?: number;
  skipped?: number;
  failed?: number;
} {
  const counts: { completed?: number; skipped?: number; failed?: number } = {};
  const completed = readNumberFieldOrNull(value, "completedCount");
  const skipped = readNumberFieldOrNull(value, "skippedCount");
  const failed = readNumberFieldOrNull(value, "failedCount");
  if (completed !== null) {
    counts.completed = completed;
  }
  if (skipped !== null) {
    counts.skipped = skipped;
  }
  if (failed !== null) {
    counts.failed = failed;
  }
  return counts;
}

function readRecordField(
  value: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  const field = value[key];
  return isRecord(field) ? field : null;
}

function readStringFieldOrNull(
  value: Record<string, unknown> | null,
  key: string
): string | null {
  return value ? readStringField(value, key) : null;
}

function readNumberFieldOrNull(
  value: Record<string, unknown> | null,
  key: string
): number | null {
  if (!value) {
    return null;
  }
  const field = value[key];
  if (
    field === null ||
    field === undefined ||
    (typeof field === "string" && field.trim().length === 0)
  ) {
    return null;
  }
  const number = Number(field);
  return Number.isFinite(number) ? number : null;
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

function countAiDecisionFailureRuns(records: Record<string, unknown>[]): number {
  return records.filter(hasAiDecisionFailures).length;
}

function normalizeBatchReplayRunRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  if (record["status"] !== "completed" || !hasAiDecisionFailures(record)) {
    return record;
  }
  return {
    ...record,
    status: "completed_with_failures"
  };
}

function normalizeBatchReplayBatchStatus(
  status: string | null,
  records: Record<string, unknown>[]
): string | null {
  if (
    status === "completed" &&
    records.some((record) => record["status"] === "completed_with_failures")
  ) {
    return "completed_with_failures";
  }
  return status;
}

function hasAiDecisionFailures(record: Record<string, unknown>): boolean {
  const summary = readRecordField(record, "summary");
  return Number(summary?.["aiDecisionFailureCount"] ?? 0) > 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
