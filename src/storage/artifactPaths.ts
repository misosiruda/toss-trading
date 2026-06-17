import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const AUDIT_EVENTS_FILE_NAME = "audit-events.jsonl";
export const VIRTUAL_PORTFOLIO_FILE_NAME = "virtual-portfolio.json";
export const VIRTUAL_DECISIONS_FILE_NAME = "virtual-decisions.jsonl";
export const VIRTUAL_TRADES_FILE_NAME = "virtual-trades.jsonl";
export const TOSSINVEST_SOURCES_FILE_NAME = "tossinvest-sources.jsonl";
export const MARKET_PACKETS_FILE_NAME = "market-packets.jsonl";
export const HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME =
  "historical-market-snapshots.jsonl";
export const HISTORICAL_REPLAY_REPORT_FILE_NAME =
  "historical-replay-report.json";
export const HISTORICAL_REPLAY_PROGRESS_FILE_NAME =
  "historical-replay-progress.json";
export const HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME =
  "historical-replay-run-metadata.json";
export const HISTORICAL_REPLAY_PACKETS_FILE_NAME =
  "historical-replay-packets.jsonl";
export const HISTORICAL_REPLAY_DECISIONS_FILE_NAME =
  "historical-replay-decisions.jsonl";
export const HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME =
  "historical-replay-risk-decisions.jsonl";
export const HISTORICAL_REPLAY_TRADES_FILE_NAME =
  "historical-replay-trades.jsonl";
export const HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME =
  "historical-replay-portfolio-timeline.jsonl";
export const BATCH_REPLAY_ARTIFACT_DIR_NAME = "batch-replay";
export const BATCH_REPLAY_RUNS_DIR_NAME = "runs";
export const BATCH_REPLAY_MANIFEST_FILE_NAME = "batch-replay-manifest.json";
export const BATCH_REPLAY_RUNS_FILE_NAME = "batch-replay-runs.jsonl";
export const BATCH_REPLAY_AGGREGATE_REPORT_FILE_NAME =
  "batch-replay-aggregate-report.json";

export type StorageArtifactFormat = "json" | "jsonl";
export type StorageArtifactRole =
  | "append_only_log"
  | "metadata"
  | "report"
  | "snapshot";

export interface StorageArtifactContract {
  artifactName: string;
  fileName: string;
  relativePath: string;
  format: StorageArtifactFormat;
  role: StorageArtifactRole;
  domainContract: string;
  writer: string;
  localOperationsReader: string | null;
  failureTrace: string;
  corruptJsonlPolicy: "skip_line_and_count" | null;
}

export type StorageArtifactPathCatalog = Record<string, string>;

export interface DynamicStorageArtifactContract
  extends Omit<StorageArtifactContract, "relativePath"> {
  relativePathPattern: string;
  pathResolver: string;
}

export const STORAGE_ARTIFACT_CONTRACTS: readonly StorageArtifactContract[] = [
  {
    artifactName: "auditEvents",
    fileName: AUDIT_EVENTS_FILE_NAME,
    relativePath: AUDIT_EVENTS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "AuditEvent",
    writer: "FileAuditLog",
    localOperationsReader: "/audit/events",
    failureTrace: "process stage, failure code, masked summary",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "virtualPortfolio",
    fileName: VIRTUAL_PORTFOLIO_FILE_NAME,
    relativePath: VIRTUAL_PORTFOLIO_FILE_NAME,
    format: "json",
    role: "snapshot",
    domainContract: "VirtualPortfolio",
    writer: "FileVirtualPortfolioStore",
    localOperationsReader: "/virtual/portfolio",
    failureTrace: "latest paper-only portfolio state",
    corruptJsonlPolicy: null
  },
  {
    artifactName: "virtualDecisions",
    fileName: VIRTUAL_DECISIONS_FILE_NAME,
    relativePath: VIRTUAL_DECISIONS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "VirtualDecision",
    writer: "FileVirtualDecisionStore",
    localOperationsReader: "/virtual/decisions",
    failureTrace: "AI/provider decision accepted by backend validation",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "virtualTrades",
    fileName: VIRTUAL_TRADES_FILE_NAME,
    relativePath: VIRTUAL_TRADES_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "VirtualTrade",
    writer: "FileVirtualTradeStore",
    localOperationsReader: "/virtual/trades",
    failureTrace: "paper order fill record",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "tossInvestSources",
    fileName: TOSSINVEST_SOURCES_FILE_NAME,
    relativePath: TOSSINVEST_SOURCES_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "TossInvestCliCollectResult",
    writer: "FileTossInvestSourceStore",
    localOperationsReader: "/source/health",
    failureTrace: "read-only source collection status and degradation reason",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "marketPackets",
    fileName: MARKET_PACKETS_FILE_NAME,
    relativePath: MARKET_PACKETS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "MarketPacket",
    writer: "FileMarketPacketStore",
    localOperationsReader: "/market/packets",
    failureTrace: "candidate packet and source refs used before AI decision",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "historicalMarketSnapshots",
    fileName: HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME,
    relativePath: HISTORICAL_MARKET_SNAPSHOTS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "HistoricalMarketSnapshot",
    writer: "FileHistoricalMarketSnapshotStore",
    localOperationsReader: null,
    failureTrace: "historical replay source data and corrupt line count",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "historicalReplayReport",
    fileName: HISTORICAL_REPLAY_REPORT_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_REPORT_FILE_NAME,
    format: "json",
    role: "report",
    domainContract: "HistoricalReplayReport",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: "/replay/report",
    failureTrace: "final replay summary and warning counts",
    corruptJsonlPolicy: null
  },
  {
    artifactName: "historicalReplayProgress",
    fileName: HISTORICAL_REPLAY_PROGRESS_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_PROGRESS_FILE_NAME,
    format: "json",
    role: "snapshot",
    domainContract: "HistoricalReplayProgress",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: "/replay/progress",
    failureTrace: "latest replay progress state",
    corruptJsonlPolicy: null
  },
  {
    artifactName: "historicalReplayRunMetadata",
    fileName: HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_RUN_METADATA_FILE_NAME,
    format: "json",
    role: "metadata",
    domainContract: "HistoricalReplayRunMetadata",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: null,
    failureTrace: "run id, window, profile, log paths, status",
    corruptJsonlPolicy: null
  },
  {
    artifactName: "historicalReplayPackets",
    fileName: HISTORICAL_REPLAY_PACKETS_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_PACKETS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "MarketPacket",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: null,
    failureTrace: "packet sequence generated at each simulated tick",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "historicalReplayDecisions",
    fileName: HISTORICAL_REPLAY_DECISIONS_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_DECISIONS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "VirtualDecision",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: null,
    failureTrace: "paper exit and provider decisions recorded during replay",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "historicalReplayRiskDecisions",
    fileName: HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_RISK_DECISIONS_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "VirtualRiskDecision",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: null,
    failureTrace: "risk approval/rejection per replay decision item",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "historicalReplayTrades",
    fileName: HISTORICAL_REPLAY_TRADES_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_TRADES_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "VirtualTrade",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: null,
    failureTrace: "paper fills created during replay",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "historicalReplayPortfolioTimeline",
    fileName: HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME,
    relativePath: HISTORICAL_REPLAY_PORTFOLIO_TIMELINE_FILE_NAME,
    format: "jsonl",
    role: "append_only_log",
    domainContract: "HistoricalPortfolioTimelineItem",
    writer: "HistoricalReplayWorkflow",
    localOperationsReader: null,
    failureTrace: "portfolio state by simulated tick",
    corruptJsonlPolicy: "skip_line_and_count"
  },
  {
    artifactName: "batchReplayAggregateReport",
    fileName: BATCH_REPLAY_AGGREGATE_REPORT_FILE_NAME,
    relativePath: BATCH_REPLAY_AGGREGATE_REPORT_FILE_NAME,
    format: "json",
    role: "report",
    domainContract: "BatchReplayAggregateReport",
    writer: "historicalBatchReport CLI",
    localOperationsReader: "/batch/replay/report",
    failureTrace: "aggregate replay result and AI decision failure count",
    corruptJsonlPolicy: null
  }
];

export const DYNAMIC_STORAGE_ARTIFACT_CONTRACTS: readonly DynamicStorageArtifactContract[] =
  [
    {
      artifactName: "batchReplayManifest",
      fileName: BATCH_REPLAY_MANIFEST_FILE_NAME,
      relativePathPattern:
        "batch-replay/<batchId>/batch-replay-manifest.json",
      format: "json",
      role: "metadata",
      domainContract: "BatchReplayManifest",
      writer: "HistoricalBatchReplayWorkflow",
      localOperationsReader: "readLatestBatchReplayManifest",
      failureTrace: "batch id, run status, latest runsPath",
      corruptJsonlPolicy: null,
      pathResolver: "createBatchReplayManifestPath"
    },
    {
      artifactName: "batchReplayRuns",
      fileName: BATCH_REPLAY_RUNS_FILE_NAME,
      relativePathPattern: "batch-replay/<batchId>/batch-replay-runs.jsonl",
      format: "jsonl",
      role: "append_only_log",
      domainContract: "BatchReplayRunRecord",
      writer: "HistoricalBatchReplayWorkflow",
      localOperationsReader: "/batch/replay/runs",
      failureTrace: "per-window run status, skip/failure reason, report path",
      corruptJsonlPolicy: "skip_line_and_count",
      pathResolver: "resolveBatchReplayRunsArtifactPath"
    }
  ];

export interface BatchReplayArtifactPaths {
  outputDir: string;
  runsDir: string;
  manifestPath: string;
  runsPath: string;
}

export interface ResolveBatchReplayRunsArtifactPathOptions {
  storageBaseDir: string;
  cwd?: string;
}

export function createBatchReplayArtifactPaths(
  outputBaseDir: string,
  batchId: string
): BatchReplayArtifactPaths {
  const outputDir = join(outputBaseDir, safeArtifactPathPart(batchId, "batch"));
  return {
    outputDir,
    runsDir: join(outputDir, BATCH_REPLAY_RUNS_DIR_NAME),
    manifestPath: join(outputDir, BATCH_REPLAY_MANIFEST_FILE_NAME),
    runsPath: join(outputDir, BATCH_REPLAY_RUNS_FILE_NAME)
  };
}

export function createStorageArtifactPathCatalog(
  storageBaseDir: string
): StorageArtifactPathCatalog {
  return Object.fromEntries(
    STORAGE_ARTIFACT_CONTRACTS.map((artifact) => [
      artifact.artifactName,
      join(storageBaseDir, artifact.relativePath)
    ])
  );
}

export function createBatchReplayRootDirForStorage(
  storageBaseDir: string
): string {
  return resolve(
    dirname(resolve(storageBaseDir)),
    BATCH_REPLAY_ARTIFACT_DIR_NAME
  );
}

export function createBatchReplayManifestPath(
  batchReplayRootDir: string,
  batchDirName: string
): string {
  return join(
    batchReplayRootDir,
    batchDirName,
    BATCH_REPLAY_MANIFEST_FILE_NAME
  );
}

export function resolveBatchReplayRunsArtifactPath(
  sourceRunsPath: string,
  options: ResolveBatchReplayRunsArtifactPathOptions
): string | null {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = isAbsolute(sourceRunsPath)
    ? resolve(sourceRunsPath)
    : resolve(cwd, sourceRunsPath);
  const normalized = resolvedPath.replace(/\\/g, "/");

  if (
    basename(resolvedPath) !== BATCH_REPLAY_RUNS_FILE_NAME ||
    !normalized.includes(`/${BATCH_REPLAY_ARTIFACT_DIR_NAME}/`)
  ) {
    return null;
  }

  const allowedRoots = [
    resolve(cwd),
    resolve(options.storageBaseDir),
    createBatchReplayRootDirForStorage(options.storageBaseDir),
    resolve(cwd, "data", BATCH_REPLAY_ARTIFACT_DIR_NAME)
  ];
  return allowedRoots.some((root) => isPathInside(resolvedPath, root))
    ? resolvedPath
    : null;
}

export function safeArtifactPathPart(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length === 0 ? fallback : sanitized;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const path = relative(parentPath, childPath);
  return path === "" || (!!path && !path.startsWith("..") && !isAbsolute(path));
}
