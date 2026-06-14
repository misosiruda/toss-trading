import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  classifyMarketRegime,
  type MarketRegimeClassification,
  type MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import {
  normalizePaperExitPolicy,
  type NormalizedPaperExitPolicy,
  type PaperExitPolicy
} from "../paper/exitPolicy.js";
import type { PaperRiskProfileName } from "../paper/riskProfile.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import type { HistoricalReplayReport } from "../reports/historicalReplayReport.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import {
  assessHistoricalDataAvailability,
  type HistoricalDataAvailabilityReport,
  type HistoricalDataAvailabilitySymbolRequirement
} from "../replay/historicalDataAvailability.js";
import type { AuditEvent, HistoricalMarketSnapshot } from "../domain/schemas.js";
import type { ReplayDecisionFrequency } from "../replay/replaySamplingPolicy.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import {
  selectReplayWindow,
  type ReplayWindowSelection
} from "../replay/replayWindowSampler.js";
import {
  DEFAULT_BALANCED_REGIME_TARGETS,
  selectRegimeBalancedReplayWindow,
  type RegimeBalancedWindowSamplerPlan
} from "../replay/regimeBalancedWindowSampler.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import type { CodexHistoricalReplayDecisionProviderLike } from "../replay/codexHistoricalReplayRunner.js";

export type BatchReplayRunStatus = "completed" | "skipped" | "failed";
export type BatchReplayManifestStatus =
  | "running"
  | "completed"
  | "completed_with_failures";
export type BatchReplayWindowSamplingMode = "random" | "balanced_regime";

export interface BatchReplayRunnerOptions {
  sourceDataDir: string;
  outputBaseDir: string;
  batchId: string;
  seed: string;
  runCount: number;
  rangeStart: Date;
  rangeEnd: Date;
  windowMonths?: number;
  timezoneOffsetMinutes?: number;
  generatedAt?: Date;
  stepSeconds?: number;
  speedMultiplier?: number;
  everyNSteps?: number;
  candidateChangedOnly?: boolean;
  decisionFrequency?: ReplayDecisionFrequency;
  maxDecisionCalls?: number;
  initialCashKrw?: number;
  packetIdPrefix?: string;
  packetExpiresInSeconds?: number;
  maxCandidates?: number;
  maxSnapshotAgeSeconds?: number;
  constraints?: MarketPacketConstraints;
  riskProfile?: PaperRiskProfileName;
  riskPolicy?: Partial<VirtualRiskPolicy>;
  paperExitPolicy?: PaperExitPolicy;
  windowSamplingMode?: BatchReplayWindowSamplingMode;
  targetRegimes?: MarketRegimeLabel[];
  minWindowSnapshots?: number;
  minSnapshotsPerRequiredSymbol?: number;
  requiredSymbols?: HistoricalDataAvailabilitySymbolRequirement[];
  decisionProviderFactory?: BatchReplayDecisionProviderFactory;
  decisionProviderMetadata?: BatchReplayDecisionProviderMetadata;
}

export type BatchReplayDecisionProviderMode =
  | "deterministic_fixture"
  | "codex_cli";

export interface BatchReplayDecisionProviderMetadata {
  mode: BatchReplayDecisionProviderMode;
  maxCallsPerRun: number | null;
  sandbox: "read-only" | null;
  allowWebSearch: boolean;
  promptPolicy: string | null;
  promptVersion: string | null;
}

export interface BatchReplayDecisionProviderContext {
  batchId: string;
  runId: string;
  runIndex: number;
  runSeed: string;
  window: ReplayWindowSelection;
}

export type BatchReplayDecisionProviderFactory = (
  context: BatchReplayDecisionProviderContext
) => CodexHistoricalReplayDecisionProviderLike;

export interface BatchReplayResult {
  mode: "paper_only";
  batchId: string;
  status: BatchReplayManifestStatus;
  outputDir: string;
  manifestPath: string;
  runsPath: string;
  runCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  records: BatchReplayRunRecord[];
}

export interface BatchReplayManifest {
  mode: "paper_only";
  batchId: string;
  seed: string;
  status: BatchReplayManifestStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  outputDir: string;
  sourceDataDir: string;
  runsPath: string;
  runCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  decisionProvider: BatchReplayDecisionProviderMetadata;
  riskProfile: PaperRiskProfileName | null;
  paperExitPolicy: NormalizedPaperExitPolicy | null;
  windowSampling: BatchReplayWindowSamplingSummary;
  disclaimer: string;
}

export interface BatchReplayRunRecord {
  mode: "paper_only";
  batchId: string;
  runId: string;
  runIndex: number;
  runSeed: string;
  status: BatchReplayRunStatus;
  startedAt: string;
  completedAt: string | null;
  skippedAt: string | null;
  failedAt: string | null;
  storageBaseDir: string;
  window: ReplayWindowSelection;
  windowSampling: BatchReplayRunWindowSampling;
  marketRegime: MarketRegimeClassification;
  dataAvailability: BatchReplayDataAvailabilitySummary;
  summary: BatchReplayRunSummary | null;
  reportPath: string | null;
  error: string | null;
  skipReason: string | null;
}

export interface BatchReplayDataAvailabilitySummary {
  status: HistoricalDataAvailabilityReport["status"];
  totalSnapshotCount: number;
  windowSnapshotCount: number;
  corruptLineCount: number;
  requiredSymbolCount: number;
  availableRequiredSymbolCount: number;
  issues: string[];
}

export interface BatchReplayRunSummary {
  finalVirtualNetWorthKrw: number;
  totalReturnRatio: number | null;
  tradeCount: number;
  decisionProviderCallCount: number;
  aiDecisionFailureCount: number;
  rejectedCount: number;
}

export interface BatchReplayWindowSamplingSummary {
  mode: BatchReplayWindowSamplingMode;
  requestedTargetRegimes: MarketRegimeLabel[] | null;
  activeTargetRegimes: MarketRegimeLabel[] | null;
  unavailableTargetRegimes: MarketRegimeLabel[] | null;
  candidateCount: number | null;
  bucketCounts: Record<MarketRegimeLabel, number> | null;
}

export interface BatchReplayRunWindowSampling {
  mode: BatchReplayWindowSamplingMode;
  targetRegime: MarketRegimeLabel | null;
  targetCandidateCount: number | null;
  fallbackReason: string | null;
}

interface BatchReplayPaths {
  outputDir: string;
  runsDir: string;
  manifestPath: string;
  runsPath: string;
}

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 540;
const DEFAULT_WINDOW_MONTHS = 1;
const DEFAULT_STEP_SECONDS = 60;
const DEFAULT_INITIAL_CASH_KRW = 1_000_000;
const DEFAULT_PACKET_ID_PREFIX = "packet_batch_replay";
const DEFAULT_PACKET_EXPIRES_IN_SECONDS = 60;
const DEFAULT_MAX_CANDIDATES = 10;
const DEFAULT_MAX_SNAPSHOT_AGE_SECONDS = 300;
const DEFAULT_CONSTRAINTS: MarketPacketConstraints = {
  maxNewPositions: 3,
  maxBudgetPerSymbolKrw: 100_000,
  allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
};

export async function runHistoricalBatchReplay(
  options: BatchReplayRunnerOptions
): Promise<BatchReplayResult> {
  validateBatchOptions(options);

  const batchId = normalizeRequiredText(options.batchId, "batchId");
  const seed = normalizeRequiredText(options.seed, "seed");
  const startedAt = options.generatedAt ?? new Date();
  const paths = batchReplayPaths(options.outputBaseDir, batchId);
  const sourcePaths = createStoragePaths(options.sourceDataDir);
  const decisionProviderMetadata =
    options.decisionProviderMetadata ?? defaultDecisionProviderMetadata();
  const snapshotRead = await new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  ).readAll();
  const windowSamplingMode = options.windowSamplingMode ?? "random";
  const paperExitPolicy = normalizePaperExitPolicy(options.paperExitPolicy);
  const initialWindowSamplingSummary = initialWindowSamplingSummaryFor(
    windowSamplingMode,
    options.targetRegimes
  );
  const records: BatchReplayRunRecord[] = [];

  await mkdir(paths.runsDir, { recursive: true });
  await writeFile(paths.runsPath, "", "utf8");
  await writeManifest(paths.manifestPath, {
    mode: "paper_only",
    batchId,
    seed,
    status: "running",
    startedAt: startedAt.toISOString(),
    updatedAt: startedAt.toISOString(),
    completedAt: null,
    outputDir: paths.outputDir,
    sourceDataDir: options.sourceDataDir,
    runsPath: paths.runsPath,
    runCount: options.runCount,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    decisionProvider: decisionProviderMetadata,
    riskProfile: options.riskProfile ?? null,
    paperExitPolicy,
    windowSampling: initialWindowSamplingSummary,
    disclaimer: batchReplayDisclaimer()
  });

  let windowSamplingSummary = initialWindowSamplingSummary;

  for (let runIndex = 0; runIndex < options.runCount; runIndex += 1) {
    const runSeed = `${seed}:${runIndex}`;
    const windowSelection = selectBatchReplayWindow({
      options,
      snapshots: snapshotRead.records,
      runIndex,
      runSeed,
      windowSamplingMode
    });
    windowSamplingSummary = windowSelection.summary;
    const window = windowSelection.window;
    const runId = batchReplayRunId(batchId, runIndex, window);
    const storageBaseDir = join(paths.runsDir, runId);
    const runStartedAt = dateForRun(startedAt, runIndex);
    const windowStart = new Date(window.startAt);
    const windowEnd = new Date(window.endAt);
    const availability = assessHistoricalDataAvailability({
      snapshots: snapshotRead.records,
      windowStart,
      windowEnd,
      corruptLineCount: snapshotRead.corruptLineCount,
      minWindowSnapshots: options.minWindowSnapshots ?? 1,
      minSnapshotsPerRequiredSymbol:
        options.minSnapshotsPerRequiredSymbol ?? 1,
      requiredSymbols: options.requiredSymbols ?? []
    });
    const marketRegime =
      windowSelection.marketRegime ??
      classifyMarketRegime({
        snapshots: snapshotRead.records,
        windowStart,
        windowEnd
      });

    if (availability.status !== "available") {
      const skipped = runRecord({
        batchId,
        runId,
        runIndex,
        runSeed,
        status: "skipped",
        runStartedAt,
        storageBaseDir,
        window,
        windowSampling: windowSelection.runWindowSampling,
        marketRegime,
        availability,
        skipReason: "DATA_INSUFFICIENT"
      });
      records.push(skipped);
      await appendRunRecord(paths.runsPath, skipped);
      continue;
    }

    try {
      const decisionProvider = options.decisionProviderFactory?.({
        batchId,
        runId,
        runIndex,
        runSeed,
        window
      });
      const result = await runHistoricalReplayWorkflow({
        storageBaseDir,
        historicalMarketSnapshotsPath: sourcePaths.historicalMarketSnapshotsPath,
        clock: new SimulatedClock({
          startAt: new Date(window.startAt),
          endAt: new Date(window.endAt),
          stepSeconds: options.stepSeconds ?? DEFAULT_STEP_SECONDS,
          speedMultiplier: options.speedMultiplier ?? 1
        }),
        samplingPolicy: new ReplaySamplingPolicy({
          ...(options.everyNSteps === undefined
            ? {}
            : { everyNSteps: options.everyNSteps }),
          candidateChangedOnly: options.candidateChangedOnly ?? false,
          decisionFrequency: options.decisionFrequency ?? "every_tick",
          ...(options.maxDecisionCalls === undefined
            ? {}
            : { maxDecisionCalls: options.maxDecisionCalls }),
          timezoneOffsetMinutes:
            options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES
        }),
        generatedAt: runStartedAt,
        initialCashKrw: options.initialCashKrw ?? DEFAULT_INITIAL_CASH_KRW,
        packetIdPrefix: `${options.packetIdPrefix ?? DEFAULT_PACKET_ID_PREFIX}_${runIndex}`,
        packetExpiresInSeconds:
          options.packetExpiresInSeconds ?? DEFAULT_PACKET_EXPIRES_IN_SECONDS,
        maxCandidates: options.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
        maxSnapshotAgeSeconds:
          options.maxSnapshotAgeSeconds ?? DEFAULT_MAX_SNAPSHOT_AGE_SECONDS,
        constraints: options.constraints ?? DEFAULT_CONSTRAINTS,
        ...(options.riskProfile === undefined
          ? {}
          : { riskProfile: options.riskProfile }),
        ...(options.riskPolicy === undefined
          ? {}
          : { riskPolicy: options.riskPolicy }),
        ...(options.paperExitPolicy === undefined
          ? {}
          : { paperExitPolicy: options.paperExitPolicy }),
        ...(decisionProvider === undefined ? {} : { decisionProvider }),
        runId,
        batchId,
        batchRunIndex: runIndex,
        windowSelection: window
      });
      const completed = runRecord({
        batchId,
        runId,
        runIndex,
        runSeed,
        status: "completed",
        runStartedAt,
        storageBaseDir,
        window,
        windowSampling: windowSelection.runWindowSampling,
        marketRegime,
        availability,
        reportPath: result.reportPath,
        summary: summarizeRun(result.report, result.replayResult.auditEvents)
      });
      records.push(completed);
      await appendRunRecord(paths.runsPath, completed);
    } catch (error) {
      const failed = runRecord({
        batchId,
        runId,
        runIndex,
        runSeed,
        status: "failed",
        runStartedAt,
        storageBaseDir,
        window,
        windowSampling: windowSelection.runWindowSampling,
        marketRegime,
        availability,
        error: error instanceof Error ? error.message : String(error)
      });
      records.push(failed);
      await appendRunRecord(paths.runsPath, failed);
    }
  }

  const completedAt = dateForRun(startedAt, options.runCount);
  const completedCount = records.filter(
    (record) => record.status === "completed"
  ).length;
  const skippedCount = records.filter((record) => record.status === "skipped").length;
  const failedCount = records.filter((record) => record.status === "failed").length;
  const status: BatchReplayManifestStatus =
    failedCount > 0 ? "completed_with_failures" : "completed";

  await writeManifest(paths.manifestPath, {
    mode: "paper_only",
    batchId,
    seed,
    status,
    startedAt: startedAt.toISOString(),
    updatedAt: completedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    outputDir: paths.outputDir,
    sourceDataDir: options.sourceDataDir,
    runsPath: paths.runsPath,
    runCount: options.runCount,
    completedCount,
    skippedCount,
    failedCount,
    decisionProvider: decisionProviderMetadata,
    riskProfile: options.riskProfile ?? null,
    paperExitPolicy,
    windowSampling: windowSamplingSummary,
    disclaimer: batchReplayDisclaimer()
  });

  return {
    mode: "paper_only",
    batchId,
    status,
    outputDir: paths.outputDir,
    manifestPath: paths.manifestPath,
    runsPath: paths.runsPath,
    runCount: options.runCount,
    completedCount,
    skippedCount,
    failedCount,
    records
  };
}

interface SelectedBatchReplayWindow {
  window: ReplayWindowSelection;
  runWindowSampling: BatchReplayRunWindowSampling;
  summary: BatchReplayWindowSamplingSummary;
  marketRegime?: MarketRegimeClassification;
}

function selectBatchReplayWindow(input: {
  options: BatchReplayRunnerOptions;
  snapshots: HistoricalMarketSnapshot[];
  runIndex: number;
  runSeed: string;
  windowSamplingMode: BatchReplayWindowSamplingMode;
}): SelectedBatchReplayWindow {
  if (input.windowSamplingMode === "balanced_regime") {
    const selected = selectRegimeBalancedReplayWindow({
      snapshots: input.snapshots,
      rangeStart: input.options.rangeStart,
      rangeEnd: input.options.rangeEnd,
      seed: input.runSeed,
      runIndex: input.runIndex,
      windowMonths: input.options.windowMonths ?? DEFAULT_WINDOW_MONTHS,
      timezoneOffsetMinutes:
        input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES,
      targetRegimes:
        input.options.targetRegimes ?? DEFAULT_BALANCED_REGIME_TARGETS
    });

    return {
      window: selected.window,
      runWindowSampling: {
        mode: "balanced_regime",
        targetRegime: selected.targetRegime,
        targetCandidateCount: selected.targetCandidateCount,
        fallbackReason: null
      },
      summary: windowSamplingSummaryFromPlan(selected.plan),
      marketRegime: selected.marketRegime
    };
  }

  return {
    window: selectReplayWindow({
      rangeStart: input.options.rangeStart,
      rangeEnd: input.options.rangeEnd,
      seed: input.runSeed,
      windowMonths: input.options.windowMonths ?? DEFAULT_WINDOW_MONTHS,
      timezoneOffsetMinutes:
        input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES
    }),
    runWindowSampling: {
      mode: "random",
      targetRegime: null,
      targetCandidateCount: null,
      fallbackReason: null
    },
    summary: initialWindowSamplingSummaryFor("random")
  };
}

function initialWindowSamplingSummaryFor(
  mode: BatchReplayWindowSamplingMode,
  targetRegimes?: MarketRegimeLabel[]
): BatchReplayWindowSamplingSummary {
  return {
    mode,
    requestedTargetRegimes:
      mode === "balanced_regime"
        ? targetRegimes ?? DEFAULT_BALANCED_REGIME_TARGETS
        : null,
    activeTargetRegimes: null,
    unavailableTargetRegimes: null,
    candidateCount: null,
    bucketCounts: null
  };
}

function windowSamplingSummaryFromPlan(
  plan: RegimeBalancedWindowSamplerPlan
): BatchReplayWindowSamplingSummary {
  return {
    mode: plan.mode,
    requestedTargetRegimes: plan.requestedTargetRegimes,
    activeTargetRegimes: plan.activeTargetRegimes,
    unavailableTargetRegimes: plan.unavailableTargetRegimes,
    candidateCount: plan.candidateCount,
    bucketCounts: plan.bucketCounts
  };
}

function runRecord(input: {
  batchId: string;
  runId: string;
  runIndex: number;
  runSeed: string;
  status: BatchReplayRunStatus;
  runStartedAt: Date;
  storageBaseDir: string;
  window: ReplayWindowSelection;
  windowSampling: BatchReplayRunWindowSampling;
  marketRegime: MarketRegimeClassification;
  availability: HistoricalDataAvailabilityReport;
  reportPath?: string;
  summary?: BatchReplayRunSummary;
  error?: string;
  skipReason?: string;
}): BatchReplayRunRecord {
  const terminalAt = dateForRun(input.runStartedAt, 1).toISOString();
  return {
    mode: "paper_only",
    batchId: input.batchId,
    runId: input.runId,
    runIndex: input.runIndex,
    runSeed: input.runSeed,
    status: input.status,
    startedAt: input.runStartedAt.toISOString(),
    completedAt: input.status === "completed" ? terminalAt : null,
    skippedAt: input.status === "skipped" ? terminalAt : null,
    failedAt: input.status === "failed" ? terminalAt : null,
    storageBaseDir: input.storageBaseDir,
    window: input.window,
    windowSampling: input.windowSampling,
    marketRegime: input.marketRegime,
    dataAvailability: summarizeAvailability(input.availability),
    summary: input.summary ?? null,
    reportPath: input.reportPath ?? null,
    error: input.error ?? null,
    skipReason: input.skipReason ?? null
  };
}

function summarizeRun(
  report: HistoricalReplayReport,
  auditEvents: AuditEvent[]
): BatchReplayRunSummary {
  return {
    finalVirtualNetWorthKrw: report.portfolio.finalVirtualNetWorthKrw,
    totalReturnRatio: report.benchmarks.strategy.totalReturnRatio,
    tradeCount: report.tradeSummary.tradeCount,
    decisionProviderCallCount: report.replaySummary.decisionProviderCallCount,
    aiDecisionFailureCount: auditEvents.filter(
      (event) => event.eventType === "HISTORICAL_AI_DECISION_FAILED"
    ).length,
    rejectedCount: report.riskSummary.rejectedCount
  };
}

function summarizeAvailability(
  report: HistoricalDataAvailabilityReport
): BatchReplayDataAvailabilitySummary {
  return {
    status: report.status,
    totalSnapshotCount: report.totalSnapshotCount,
    windowSnapshotCount: report.windowSnapshotCount,
    corruptLineCount: report.corruptLineCount,
    requiredSymbolCount: report.requiredSymbolCount,
    availableRequiredSymbolCount: report.availableRequiredSymbolCount,
    issues: report.issues
  };
}

async function appendRunRecord(
  filePath: string,
  record: BatchReplayRunRecord
): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function writeManifest(
  filePath: string,
  manifest: BatchReplayManifest
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function batchReplayPaths(outputBaseDir: string, batchId: string): BatchReplayPaths {
  const outputDir = join(outputBaseDir, safePathPart(batchId));
  return {
    outputDir,
    runsDir: join(outputDir, "runs"),
    manifestPath: join(outputDir, "batch-replay-manifest.json"),
    runsPath: join(outputDir, "batch-replay-runs.jsonl")
  };
}

function batchReplayRunId(
  batchId: string,
  runIndex: number,
  window: ReplayWindowSelection
): string {
  const paddedIndex = String(runIndex).padStart(6, "0");
  return `${safePathPart(batchId)}_run_${paddedIndex}_${window.selectedMonth.replace(
    "-",
    ""
  )}`;
}

function validateBatchOptions(options: BatchReplayRunnerOptions): void {
  normalizeRequiredText(options.batchId, "batchId");
  normalizeRequiredText(options.seed, "seed");
  if (!Number.isInteger(options.runCount) || options.runCount <= 0) {
    throw new Error("runCount must be a positive integer");
  }
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }
}

function normalizeRequiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return trimmed;
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function dateForRun(startedAt: Date, runIndex: number): Date {
  return new Date(startedAt.getTime() + runIndex);
}

function safePathPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length === 0 ? "batch" : sanitized;
}

function defaultDecisionProviderMetadata(): BatchReplayDecisionProviderMetadata {
  return {
    mode: "deterministic_fixture",
    maxCallsPerRun: null,
    sandbox: null,
    allowWebSearch: false,
    promptPolicy: null,
    promptVersion: null
  };
}

function batchReplayDisclaimer(): string {
  return [
    "Historical batch replay is paper-only.",
    "It cannot place live orders and does not represent investment advice or guaranteed performance."
  ].join(" ");
}
