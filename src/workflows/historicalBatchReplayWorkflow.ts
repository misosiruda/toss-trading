import {
  access,
  appendFile,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG,
  classifyMarketRegime,
  classifyMarketRegimeByMarket,
  type MarketRegimeClassification,
  type MarketRegimeLabel,
  type MarketRegimesByMarket
} from "../analytics/marketRegimeClassifier.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import type { PaperExecutionPolicy } from "../paper/executionModel.js";
import type { MarketRegimeAllocationPolicy } from "../paper/marketRegimeAllocationPolicy.js";
import {
  normalizePaperExitPolicy,
  type NormalizedPaperExitPolicy,
  type PaperExitPolicy
} from "../paper/exitPolicy.js";
import type { PaperRiskProfileName } from "../paper/riskProfile.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import type {
  HistoricalReplayCostSummary,
  HistoricalReplayReport
} from "../reports/historicalReplayReport.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import {
  assessHistoricalDataAvailability,
  type HistoricalDataAvailabilityCalendarOptions,
  type HistoricalDataAvailabilityFxOptions,
  type HistoricalDataAvailabilityReport,
  type HistoricalDataAvailabilitySymbolRequirement
} from "../replay/historicalDataAvailability.js";
import type { HistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";
import type {
  AssetType,
  AuditEvent,
  HistoricalMarketSnapshot,
  Market,
  StrategyBucket
} from "../domain/schemas.js";
import {
  parseWithSchema,
  replayResearchManifestSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
import type { ReplayDecisionFrequency } from "../replay/replaySamplingPolicy.js";
import type { StrategyReplayPresetName } from "../replay/strategyReplayPreset.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import {
  replayWindowCandidates,
  selectReplayWindow,
  type ReplayWindowCandidate,
  type ReplayWindowCandidateFilter,
  type ReplayWindowSelection
} from "../replay/replayWindowSampler.js";
import {
  DEFAULT_BALANCED_REGIME_TARGETS,
  selectRegimeBalancedReplayWindow,
  type RegimeBalancedWindowSamplerPlan
} from "../replay/regimeBalancedWindowSampler.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import type { CodexHistoricalReplayDecisionProviderLike } from "../replay/codexHistoricalReplayRunner.js";
import {
  createReplayResearchHash,
  missingReplayResearchManifestReference,
  replayResearchManifestReference,
  type ReplayResearchManifestReference
} from "../replay/replayRunManifest.js";
import {
  buildValidationRoleRegimeBatchProvenance,
  type ValidationRoleRegimeBatchProvenance,
  type ValidationRoleRegimeBatchManifestProvenance,
  type ValidationRoleRegimeBatchRunProvenance
} from "../replay/validationRoleRegimeBatchProvenance.js";
import {
  parseValidationRoleRegimeReplayPlan,
  type ValidationRoleRegimeReplayPlan
} from "../replay/validationRoleRegimeReplayPlan.js";
import {
  createValidationFeasibilityCalendarHash,
  createValidationFeasibilityCandidateHash,
  createValidationFeasibilityClassifierHash,
  defaultMarketRegimeClassifierConfig,
  feasibilityCoverageSourceSchema
} from "../replay/validationSplitRegimeFeasibility.js";
import {
  createSelectionTrialRecord,
  type SelectionTrialRecord
} from "../replay/selectionTrialLog.js";
import {
  validationSplitAssignmentSchema,
  type ValidationSplitAssignment,
  type ValidationSplitRole
} from "../replay/validationProtocol.js";
import { validationRoleWindow } from "../replay/validationRoleWindow.js";
import {
  createBatchReplayArtifactPaths,
  safeArtifactPathPart,
  type BatchReplayArtifactPaths
} from "../storage/artifactPaths.js";

export type BatchReplayRunStatus =
  | "completed"
  | "completed_with_failures"
  | "skipped"
  | "failed";
export type BatchReplayManifestStatus =
  | "running"
  | "completed"
  | "completed_with_failures";
export type BatchReplayWindowSamplingMode =
  | "random"
  | "balanced_regime"
  | "fixed_range"
  | "validation_role_regime_plan";

export interface BatchReplayRunnerOptions {
  sourceDataDir: string;
  outputBaseDir: string;
  batchId: string;
  strategyPreset?: StrategyReplayPresetName;
  candidateStrategyBucket?: StrategyBucket;
  seed: string;
  runCount: number;
  rangeStart: Date;
  rangeEnd: Date;
  fixedWindow?: ReplayWindowSelection;
  windowMonths?: number;
  timezoneOffsetMinutes?: number;
  generatedAt?: Date;
  stepSeconds?: number;
  speedMultiplier?: number;
  tickDelayMs?: number;
  wallClockTimestamps?: boolean;
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
  executionPolicy?: Partial<PaperExecutionPolicy>;
  riskProfile?: PaperRiskProfileName;
  riskPolicy?: Partial<VirtualRiskPolicy>;
  allocationPolicy?: PaperAllocationPolicy;
  marketRegimeAllocationPolicy?: MarketRegimeAllocationPolicy;
  paperExitPolicy?: PaperExitPolicy;
  windowSamplingMode?: BatchReplayWindowSamplingMode;
  targetRegimes?: MarketRegimeLabel[];
  validationSplitAssignments?: ValidationSplitAssignment[];
  validationRoleRegimePlan?: unknown;
  validationRoleRegimeCoverage?: unknown;
  validationRoleRegimeUniverseSource?: unknown;
  minWindowSnapshots?: number;
  minSnapshotsPerRequiredSymbol?: number;
  requiredSymbols?: HistoricalDataAvailabilitySymbolRequirement[];
  universeManifest?: HistoricalUniverseManifest;
  calendarValidation?: HistoricalDataAvailabilityCalendarOptions;
  fxValidation?: HistoricalDataAvailabilityFxOptions;
  decisionProviderFactory?: BatchReplayDecisionProviderFactory;
  decisionProviderMetadata?: BatchReplayDecisionProviderMetadata;
}

export type BatchReplayDecisionProviderMode =
  | "deterministic_fixture"
  | "codex_cli"
  | "unknown_provider";

export interface BatchReplayDecisionProviderMetadata {
  mode: BatchReplayDecisionProviderMode;
  maxCallsPerRun: number | null;
  sandbox: "read-only" | null;
  allowWebSearch: boolean;
  promptPolicy: string | null;
  promptVersion: string | null;
  promptText?: string | null;
  promptConfig?: {
    modelId: string | null;
    schemaVersion: string | null;
    policyVersion: string | null;
    outputSchemaPath: string | null;
    ephemeral: boolean;
    ignoreUserConfig: boolean;
    disabledFeatures: readonly string[];
  } | null;
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
  selectionTrialsPath: string;
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
  selectionTrialsPath: string;
  runCount: number;
  initialCashKrw: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  activeRun: BatchReplayActiveRunSnapshot | null;
  decisionProvider: BatchReplayDecisionProviderMetadata;
  strategyPreset: StrategyReplayPresetName | null;
  candidateStrategyBucket: StrategyBucket | null;
  riskProfile: PaperRiskProfileName | null;
  allocationPolicy: PaperAllocationPolicy | null;
  marketRegimeAllocationPolicy: MarketRegimeAllocationPolicy | null;
  paperExitPolicy: NormalizedPaperExitPolicy | null;
  windowSampling: BatchReplayWindowSamplingSummary;
  validationProtocol: BatchReplayValidationProtocolSummary | null;
  validationRoleRegimePlan: ValidationRoleRegimeBatchManifestProvenance | null;
  disclaimer: string;
}

export interface BatchReplayValidationProtocolSummary {
  validationProtocol: "walk_forward";
  assignmentCount: number;
  roleCounts: Partial<Record<ValidationSplitRole, number>>;
}

export interface BatchReplayActiveRunSnapshot {
  runId: string;
  runIndex: number;
  runSeed: string;
  startedAt: string;
  storageBaseDir: string;
  window: ReplayWindowSelection;
  windowSampling: BatchReplayRunWindowSampling;
  validationSplit: ValidationSplitAssignment | null;
  validationRoleRegimePlan: ValidationRoleRegimeBatchRunProvenance | null;
  marketRegime: MarketRegimeClassification;
  marketRegimesByMarket: MarketRegimesByMarket;
  dataAvailability: BatchReplayDataAvailabilitySummary;
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
  validationSplit: ValidationSplitAssignment | null;
  validationRoleRegimePlan: ValidationRoleRegimeBatchRunProvenance | null;
  marketRegime: MarketRegimeClassification;
  marketRegimesByMarket: MarketRegimesByMarket;
  dataAvailability: BatchReplayDataAvailabilitySummary;
  researchManifest: ReplayResearchManifestReference;
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
  costSummary?: HistoricalReplayCostSummary | undefined;
  tradeCount: number;
  decisionProviderCallCount: number;
  aiDecisionFailureCount: number;
  aiDecisionFailureReasons: string[];
  lastAiDecisionFailureSummary: string | null;
  rejectedCount: number;
  meaningfulRejectCount: number;
  dustRejectCount: number;
  avgExposureRatio: number | null;
  avgCashRatio: number | null;
  maxExposureRatio: number | null;
  minExposureRatio: number | null;
  timeInMarketRatio: number | null;
  finalCashRatio: number | null;
  finalPositionRatio: number | null;
  targetExposureRatio: number | null;
  averageTargetExposureGapRatio: number | null;
  finalTargetExposureGapRatio: number | null;
  finalExposureByMarketKrw: Record<Market, number>;
  finalExposureByAssetTypeKrw: Record<AssetType | "UNKNOWN", number>;
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
  const validationRoleRegimePlan =
    options.validationRoleRegimePlan === undefined
      ? null
      : parseValidationRoleRegimeReplayPlan(options.validationRoleRegimePlan);
  validateBatchOptions(options, validationRoleRegimePlan);

  const batchId = normalizeRequiredText(options.batchId, "batchId");
  const seed = normalizeRequiredText(options.seed, "seed");
  const runCount = validationRoleRegimePlan?.runs.length ?? options.runCount;
  const validationRoleRegimeProvenance =
    validationRoleRegimePlan === null
      ? null
      : buildValidationRoleRegimeBatchProvenance(validationRoleRegimePlan);
  const startedAt = options.generatedAt ?? new Date();
  const paths = createBatchReplayArtifactPaths(options.outputBaseDir, batchId);
  const sourcePaths = createStoragePaths(options.sourceDataDir);
  const decisionProviderMetadata = batchDecisionProviderMetadata(options);
  const validationSplitAssignments = normalizeValidationSplitAssignments(
    options.validationSplitAssignments,
    runCount
  );
  const validationProtocolSummary =
    validationRoleRegimeProvenance !== null
      ? validationProtocolSummaryFor(
          validationRoleRegimeProvenance.runs.map(
            (run) => run.executionAssignment
          )
        )
      : validationSplitAssignments === null
        ? null
        : validationProtocolSummaryFor(validationSplitAssignments);
  const snapshotRead = await new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  ).readAll();
  if (
    validationRoleRegimePlan !== null &&
    validationRoleRegimeProvenance !== null
  ) {
    assertValidationRoleRegimeRuntimeSources({
      options,
      plan: validationRoleRegimePlan,
      provenance: validationRoleRegimeProvenance,
      snapshots: snapshotRead.records,
      corruptLineCount: snapshotRead.corruptLineCount
    });
    await assertValidationRoleRegimeOutputAbsent(paths.outputDir);
  }
  const windowSamplingMode =
    validationRoleRegimePlan !== null
      ? "validation_role_regime_plan"
      : validationSplitAssignments === null
      ? options.windowSamplingMode ?? "random"
      : "fixed_range";
  const paperExitPolicy = normalizePaperExitPolicy(options.paperExitPolicy);
  const initialCashKrw = options.initialCashKrw ?? DEFAULT_INITIAL_CASH_KRW;
  const initialWindowSamplingSummary = initialWindowSamplingSummaryFor(
    windowSamplingMode,
    validationRoleRegimePlan?.config.targetRegimes ?? options.targetRegimes,
    validationRoleRegimePlan
  );
  const records: BatchReplayRunRecord[] = [];

  await mkdir(paths.runsDir, { recursive: true });
  await removeStaleBatchReplayDerivedArtifacts(paths);
  await writeFile(paths.runsPath, "", "utf8");
  await writeFile(paths.selectionTrialsPath, "", "utf8");
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
    selectionTrialsPath: paths.selectionTrialsPath,
    runCount,
    initialCashKrw,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    activeRun: null,
    decisionProvider: decisionProviderMetadata,
    strategyPreset: options.strategyPreset ?? null,
    candidateStrategyBucket: options.candidateStrategyBucket ?? null,
    riskProfile: options.riskProfile ?? null,
    allocationPolicy: options.allocationPolicy ?? null,
    marketRegimeAllocationPolicy: options.marketRegimeAllocationPolicy ?? null,
    paperExitPolicy,
    windowSampling: initialWindowSamplingSummary,
    validationProtocol: validationProtocolSummary,
    validationRoleRegimePlan:
      validationRoleRegimeProvenance?.manifest ?? null,
    disclaimer: batchReplayDisclaimer()
  });

  let windowSamplingSummary = initialWindowSamplingSummary;

  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const runSeed = `${seed}:${runIndex}`;
    const windowSelection = selectBatchReplayWindow({
      options,
      snapshots: snapshotRead.records,
      runIndex,
      runSeed,
      windowSamplingMode,
      ...(validationSplitAssignments === null
        ? {}
        : { validationSplitAssignment: validationSplitAssignments[runIndex]! }),
      ...(validationRoleRegimeProvenance === null
        ? {}
        : {
            validationRoleRegimeRun:
              validationRoleRegimeProvenance.runs[runIndex]!,
            validationRoleRegimePlan
          })
    });
    windowSamplingSummary = windowSelection.summary;
    const window = windowSelection.window;
    const runId = batchReplayRunId(batchId, runIndex, window);
    const storageBaseDir = join(paths.runsDir, runId);
    const runStartedAt = dateForRun(startedAt, runIndex);
    const windowStart = new Date(window.startAt);
    const windowEnd = new Date(window.endAt);
    const availability = applyCandidateStrategyBucketAvailability({
      report: assessHistoricalDataAvailability({
        snapshots: snapshotRead.records,
        windowStart,
        windowEnd,
        corruptLineCount: snapshotRead.corruptLineCount,
        minWindowSnapshots: options.minWindowSnapshots ?? 1,
        minSnapshotsPerRequiredSymbol:
          options.minSnapshotsPerRequiredSymbol ?? 1,
        requiredSymbols: options.requiredSymbols ?? [],
        ...(options.calendarValidation === undefined
          ? {}
          : { calendarValidation: options.calendarValidation }),
        ...(options.fxValidation === undefined
          ? {}
          : { fxValidation: options.fxValidation })
      }),
      snapshots: snapshotRead.records,
      windowStart,
      windowEnd,
      minWindowSnapshots: options.minWindowSnapshots ?? 1,
      candidateStrategyBucket: options.candidateStrategyBucket
    });
    const marketRegime =
      windowSelection.marketRegime ??
      classifyMarketRegime({
        snapshots: snapshotRead.records,
        windowStart,
        windowEnd
      });
    const marketRegimesByMarket = classifyMarketRegimeByMarket({
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
        validationSplit: windowSelection.validationSplitAssignment ?? null,
        validationRoleRegimePlan:
          windowSelection.validationRoleRegimeRun ?? null,
        marketRegime,
        marketRegimesByMarket,
        availability,
        skipReason: "DATA_INSUFFICIENT",
        terminalAt: terminalDateForRun({
          startedAt: runStartedAt,
          runIndex: 1,
          wallClock: options.wallClockTimestamps === true
        })
      });
      records.push(skipped);
      await appendDataAvailabilityAuditEvent(skipped);
      await appendRunRecord(paths.runsPath, skipped);
      await appendSelectionTrialRecord(
        paths.selectionTrialsPath,
        selectionTrialRecord({
          record: skipped,
          decisionProviderMetadata,
          options,
          paperExitPolicy
        })
      );
      continue;
    }

    await writeManifest(paths.manifestPath, {
      mode: "paper_only",
      batchId,
      seed,
      status: "running",
      startedAt: startedAt.toISOString(),
      updatedAt: runStartedAt.toISOString(),
      completedAt: null,
      outputDir: paths.outputDir,
      sourceDataDir: options.sourceDataDir,
      runsPath: paths.runsPath,
      selectionTrialsPath: paths.selectionTrialsPath,
      runCount,
      initialCashKrw,
      completedCount: records.filter(isCompletedRunRecord).length,
      skippedCount: records.filter((record) => record.status === "skipped").length,
      failedCount: records.filter((record) => record.status === "failed").length,
      activeRun: activeRunSnapshot({
        runId,
        runIndex,
        runSeed,
        runStartedAt,
        storageBaseDir,
        window,
        windowSampling: windowSelection.runWindowSampling,
        validationSplit: windowSelection.validationSplitAssignment ?? null,
        validationRoleRegimePlan:
          windowSelection.validationRoleRegimeRun ?? null,
        marketRegime,
        marketRegimesByMarket,
        availability
      }),
      decisionProvider: decisionProviderMetadata,
      strategyPreset: options.strategyPreset ?? null,
      candidateStrategyBucket: options.candidateStrategyBucket ?? null,
      riskProfile: options.riskProfile ?? null,
      allocationPolicy: options.allocationPolicy ?? null,
      marketRegimeAllocationPolicy: options.marketRegimeAllocationPolicy ?? null,
      paperExitPolicy,
      windowSampling: windowSamplingSummary,
      validationProtocol: validationProtocolSummary,
      validationRoleRegimePlan:
        validationRoleRegimeProvenance?.manifest ?? null,
      disclaimer: batchReplayDisclaimer()
    });

    try {
      const decisionProvider = options.decisionProviderFactory?.({
        batchId,
        runId,
        runIndex,
        runSeed,
        window
      });
      const replayDecisionProviderMetadata =
        options.decisionProviderMetadata ??
        (decisionProvider === undefined ? decisionProviderMetadata : undefined);
      const result = await runHistoricalReplayWorkflow({
        storageBaseDir,
        historicalMarketSnapshotsPath: sourcePaths.historicalMarketSnapshotsPath,
        clock: new SimulatedClock({
          startAt: new Date(window.startAt),
          endAt: new Date(window.endAt),
          stepSeconds: options.stepSeconds ?? DEFAULT_STEP_SECONDS,
          speedMultiplier: options.speedMultiplier ?? 1
        }),
        ...(options.tickDelayMs === undefined
          ? {}
          : { tickDelayMs: options.tickDelayMs }),
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
        initialCashKrw,
        packetIdPrefix: `${options.packetIdPrefix ?? DEFAULT_PACKET_ID_PREFIX}_${runIndex}`,
        packetExpiresInSeconds:
          options.packetExpiresInSeconds ?? DEFAULT_PACKET_EXPIRES_IN_SECONDS,
        maxCandidates: options.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
        maxSnapshotAgeSeconds:
          options.maxSnapshotAgeSeconds ?? DEFAULT_MAX_SNAPSHOT_AGE_SECONDS,
        constraints: options.constraints ?? DEFAULT_CONSTRAINTS,
        ...(options.executionPolicy === undefined
          ? {}
          : { executionPolicy: options.executionPolicy }),
        ...(options.riskProfile === undefined
          ? {}
          : { riskProfile: options.riskProfile }),
        ...(options.riskPolicy === undefined
          ? {}
          : { riskPolicy: options.riskPolicy }),
        ...(options.allocationPolicy === undefined
          ? {}
          : { allocationPolicy: options.allocationPolicy }),
        ...(options.marketRegimeAllocationPolicy === undefined
          ? {}
          : {
              marketRegimeAllocationPolicy:
                options.marketRegimeAllocationPolicy
            }),
        ...(options.paperExitPolicy === undefined
          ? {}
          : { paperExitPolicy: options.paperExitPolicy }),
        ...(options.universeManifest === undefined
          ? {}
          : { universeManifest: options.universeManifest }),
        ...(options.strategyPreset === undefined
          ? {}
          : { strategyPreset: options.strategyPreset }),
        ...(options.candidateStrategyBucket === undefined
          ? {}
          : { candidateStrategyBucket: options.candidateStrategyBucket }),
        ...(decisionProvider === undefined ? {} : { decisionProvider }),
        ...(replayDecisionProviderMetadata === undefined
          ? {}
          : { decisionProviderMetadata: replayDecisionProviderMetadata }),
        runId,
        batchId,
        batchRunIndex: runIndex,
        windowSelection: window
      });
      const summary = summarizeRun(result.report, result.replayResult.auditEvents);
      const completed = runRecord({
        batchId,
        runId,
        runIndex,
        runSeed,
        status:
          summary.aiDecisionFailureCount > 0
            ? "completed_with_failures"
            : "completed",
        runStartedAt,
        storageBaseDir,
        window,
        windowSampling: windowSelection.runWindowSampling,
        validationSplit: windowSelection.validationSplitAssignment ?? null,
        validationRoleRegimePlan:
          windowSelection.validationRoleRegimeRun ?? null,
        marketRegime,
        marketRegimesByMarket,
        availability,
        researchManifest: result.researchManifest,
        reportPath: result.reportPath,
        summary,
        terminalAt: terminalDateForRun({
          startedAt: runStartedAt,
          runIndex: 1,
          wallClock: options.wallClockTimestamps === true
        })
      });
      records.push(completed);
      await appendRunRecord(paths.runsPath, completed);
      await appendSelectionTrialRecord(
        paths.selectionTrialsPath,
        selectionTrialRecord({
          record: completed,
          decisionProviderMetadata,
          options,
          paperExitPolicy
        })
      );
    } catch (error) {
      const failedRunResearchManifest =
        await readRunResearchManifestReference(storageBaseDir);
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
        validationSplit: windowSelection.validationSplitAssignment ?? null,
        validationRoleRegimePlan:
          windowSelection.validationRoleRegimeRun ?? null,
        marketRegime,
        marketRegimesByMarket,
        availability,
        ...(failedRunResearchManifest === undefined
          ? {}
          : { researchManifest: failedRunResearchManifest }),
        error: error instanceof Error ? error.message : String(error),
        terminalAt: terminalDateForRun({
          startedAt: runStartedAt,
          runIndex: 1,
          wallClock: options.wallClockTimestamps === true
        })
      });
      records.push(failed);
      await appendRunRecord(paths.runsPath, failed);
      await appendSelectionTrialRecord(
        paths.selectionTrialsPath,
        selectionTrialRecord({
          record: failed,
          decisionProviderMetadata,
          options,
          paperExitPolicy
        })
      );
    }
  }

  const completedAt = terminalDateForRun({
    startedAt,
    runIndex: runCount,
    wallClock: options.wallClockTimestamps === true
  });
  const completedCount = records.filter(isCompletedRunRecord).length;
  const skippedCount = records.filter((record) => record.status === "skipped").length;
  const failedCount = records.filter((record) => record.status === "failed").length;
  const completedWithFailuresCount = records.filter(
    (record) => record.status === "completed_with_failures"
  ).length;
  const status: BatchReplayManifestStatus =
    failedCount > 0 || completedWithFailuresCount > 0
      ? "completed_with_failures"
      : "completed";

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
    selectionTrialsPath: paths.selectionTrialsPath,
    runCount,
    initialCashKrw,
    completedCount,
    skippedCount,
    failedCount,
    activeRun: null,
    decisionProvider: decisionProviderMetadata,
    strategyPreset: options.strategyPreset ?? null,
    candidateStrategyBucket: options.candidateStrategyBucket ?? null,
    riskProfile: options.riskProfile ?? null,
    allocationPolicy: options.allocationPolicy ?? null,
    marketRegimeAllocationPolicy: options.marketRegimeAllocationPolicy ?? null,
    paperExitPolicy,
    windowSampling: windowSamplingSummary,
    validationProtocol: validationProtocolSummary,
    validationRoleRegimePlan:
      validationRoleRegimeProvenance?.manifest ?? null,
    disclaimer: batchReplayDisclaimer()
  });

  return {
    mode: "paper_only",
    batchId,
    status,
    outputDir: paths.outputDir,
    manifestPath: paths.manifestPath,
    runsPath: paths.runsPath,
    selectionTrialsPath: paths.selectionTrialsPath,
    runCount,
    completedCount,
    skippedCount,
    failedCount,
    records
  };
}

async function removeStaleBatchReplayDerivedArtifacts(
  paths: BatchReplayArtifactPaths
): Promise<void> {
  // These reports are keyed only by batch directory, so reruns must clear them
  // before report CLI sibling auto-load can attach previous-run evidence.
  await Promise.all([
    rm(paths.tripleBarrierLabelReportPath, { force: true }),
    rm(paths.metaLabelEvaluationReportPath, { force: true })
  ]);
}

interface SelectedBatchReplayWindow {
  window: ReplayWindowSelection;
  runWindowSampling: BatchReplayRunWindowSampling;
  summary: BatchReplayWindowSamplingSummary;
  marketRegime?: MarketRegimeClassification;
  validationSplitAssignment?: ValidationSplitAssignment;
  validationRoleRegimeRun?: ValidationRoleRegimeBatchRunProvenance;
}

function selectBatchReplayWindow(input: {
  options: BatchReplayRunnerOptions;
  snapshots: HistoricalMarketSnapshot[];
  runIndex: number;
  runSeed: string;
  windowSamplingMode: BatchReplayWindowSamplingMode;
  validationSplitAssignment?: ValidationSplitAssignment;
  validationRoleRegimeRun?: ValidationRoleRegimeBatchRunProvenance;
  validationRoleRegimePlan?: ValidationRoleRegimeReplayPlan | null;
}): SelectedBatchReplayWindow {
  if (
    input.validationRoleRegimeRun !== undefined &&
    input.validationRoleRegimePlan !== undefined &&
    input.validationRoleRegimePlan !== null
  ) {
    return {
      window: windowFromValidationRoleRegimeRun({
        run: input.validationRoleRegimeRun,
        plan: input.validationRoleRegimePlan,
        runSeed: input.runSeed
      }),
      runWindowSampling: {
        mode: "validation_role_regime_plan",
        targetRegime: input.validationRoleRegimeRun.targetRegime,
        targetCandidateCount: input.validationRoleRegimePlan.runs.filter(
          (run) => run.targetRegime === input.validationRoleRegimeRun!.targetRegime
        ).length,
        fallbackReason: null
      },
      summary: initialWindowSamplingSummaryFor(
        "validation_role_regime_plan",
        input.validationRoleRegimePlan.config.targetRegimes,
        input.validationRoleRegimePlan
      ),
      validationSplitAssignment:
        input.validationRoleRegimeRun.executionAssignment,
      validationRoleRegimeRun: input.validationRoleRegimeRun
    };
  }

  if (input.validationSplitAssignment !== undefined) {
    return {
      window: windowFromValidationSplitAssignment({
        assignment: input.validationSplitAssignment,
        runIndex: input.runIndex,
        runSeed: input.runSeed,
        candidateCount: input.options.runCount,
        timezoneOffsetMinutes:
          input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES
      }),
      runWindowSampling: {
        mode: "fixed_range",
        targetRegime: null,
        targetCandidateCount: null,
        fallbackReason: null
      },
      summary: initialWindowSamplingSummaryFor("fixed_range"),
      validationSplitAssignment: input.validationSplitAssignment
    };
  }

  if (input.options.fixedWindow !== undefined) {
    return {
      window: {
        ...input.options.fixedWindow,
        seed: input.runSeed
      },
      runWindowSampling: {
        mode: "fixed_range",
        targetRegime: null,
        targetCandidateCount: null,
        fallbackReason: null
      },
      summary: initialWindowSamplingSummaryFor("fixed_range")
    };
  }

  if (input.windowSamplingMode === "balanced_regime") {
    const candidateFilterOption = calendarValidReplayWindowCandidateFilterOption({
      snapshots: input.snapshots,
      rangeStart: input.options.rangeStart,
      rangeEnd: input.options.rangeEnd,
      windowMonths: input.options.windowMonths ?? DEFAULT_WINDOW_MONTHS,
      timezoneOffsetMinutes:
        input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES,
      ...(input.options.calendarValidation === undefined
        ? {}
        : { calendarValidation: input.options.calendarValidation })
    });
    const balancedSelectionOptions = {
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
    };
    const selected = selectCalendarFilteredRegimeBalancedReplayWindow({
      selectionOptions: balancedSelectionOptions,
      candidateFilterOption
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
        input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES,
      ...calendarValidReplayWindowCandidateFilterOption({
        snapshots: input.snapshots,
        rangeStart: input.options.rangeStart,
        rangeEnd: input.options.rangeEnd,
        windowMonths: input.options.windowMonths ?? DEFAULT_WINDOW_MONTHS,
        timezoneOffsetMinutes:
          input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES,
        ...(input.options.calendarValidation === undefined
          ? {}
          : { calendarValidation: input.options.calendarValidation })
      })
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

function selectCalendarFilteredRegimeBalancedReplayWindow(input: {
  selectionOptions: Parameters<typeof selectRegimeBalancedReplayWindow>[0];
  candidateFilterOption: { candidateFilter?: ReplayWindowCandidateFilter };
}): ReturnType<typeof selectRegimeBalancedReplayWindow> {
  if (input.candidateFilterOption.candidateFilter === undefined) {
    return selectRegimeBalancedReplayWindow(input.selectionOptions);
  }

  try {
    return selectRegimeBalancedReplayWindow({
      ...input.selectionOptions,
      candidateFilter: input.candidateFilterOption.candidateFilter
    });
  } catch (error) {
    if (!isNoRequestedMarketRegimeWindowsError(error)) {
      throw error;
    }
    return selectRegimeBalancedReplayWindow(input.selectionOptions);
  }
}

function isNoRequestedMarketRegimeWindowsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === "No requested market regime windows are available"
  );
}

function calendarValidReplayWindowCandidateFilterOption(input: {
  snapshots: HistoricalMarketSnapshot[];
  calendarValidation?: HistoricalDataAvailabilityCalendarOptions;
  rangeStart: Date;
  rangeEnd: Date;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): { candidateFilter?: ReplayWindowCandidateFilter } {
  const candidateFilter = calendarValidReplayWindowCandidateFilter(input);
  if (candidateFilter === undefined) {
    return {};
  }

  const hasCalendarValidCandidate = replayWindowCandidates({
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes
  }).some(candidateFilter);

  return hasCalendarValidCandidate ? { candidateFilter } : {};
}

function calendarValidReplayWindowCandidateFilter(input: {
  snapshots: HistoricalMarketSnapshot[];
  calendarValidation?: HistoricalDataAvailabilityCalendarOptions;
}): ReplayWindowCandidateFilter | undefined {
  const calendarValidation = input.calendarValidation;
  if (calendarValidation === undefined) {
    return undefined;
  }

  return (candidate) =>
    isCalendarValidReplayWindowCandidate({
      candidate,
      snapshots: input.snapshots,
      calendarValidation
    });
}

function isCalendarValidReplayWindowCandidate(input: {
  candidate: ReplayWindowCandidate;
  snapshots: HistoricalMarketSnapshot[];
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
}): boolean {
  const availability = assessHistoricalDataAvailability({
    snapshots: input.snapshots,
    windowStart: new Date(input.candidate.startMs),
    windowEnd: new Date(input.candidate.endMs),
    minWindowSnapshots: 0,
    calendarValidation: input.calendarValidation
  });
  return availability.calendarValidation?.rejectedSnapshotCount === 0;
}

function initialWindowSamplingSummaryFor(
  mode: BatchReplayWindowSamplingMode,
  targetRegimes?: MarketRegimeLabel[],
  validationRoleRegimePlan?: ValidationRoleRegimeReplayPlan | null
): BatchReplayWindowSamplingSummary {
  if (
    mode === "validation_role_regime_plan" &&
    validationRoleRegimePlan !== undefined &&
    validationRoleRegimePlan !== null
  ) {
    const bucketCounts = emptyRegimeCounts();
    for (const run of validationRoleRegimePlan.runs) {
      bucketCounts[run.targetRegime] += 1;
    }
    return {
      mode,
      requestedTargetRegimes: [...validationRoleRegimePlan.config.targetRegimes],
      activeTargetRegimes: [...validationRoleRegimePlan.config.targetRegimes],
      unavailableTargetRegimes: [],
      candidateCount: validationRoleRegimePlan.runs.length,
      bucketCounts
    };
  }
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

function emptyRegimeCounts(): Record<MarketRegimeLabel, number> {
  return {
    bull: 0,
    bear: 0,
    sideways: 0,
    mixed: 0,
    insufficient_data: 0
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

function windowFromValidationSplitAssignment(input: {
  assignment: ValidationSplitAssignment;
  runIndex: number;
  runSeed: string;
  candidateCount: number;
  timezoneOffsetMinutes: number;
}): ReplayWindowSelection {
  const roleWindow = validationRoleWindow(input.assignment);
  const effectiveRoleEnd =
    roleWindow.effectiveRoleEnd ?? roleWindow.roleEnd;
  return {
    seed: input.runSeed,
    rangeStart: input.assignment.trainStart,
    rangeEnd: input.assignment.testEnd ?? input.assignment.validationEnd,
    windowMonths: 1,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    candidateCount: input.candidateCount,
    selectedCandidateIndex: input.runIndex,
    selectedMonth: `${input.assignment.splitId}_${input.assignment.splitRole}`,
    localStartDate: localDatePart(
      roleWindow.roleStart,
      input.timezoneOffsetMinutes
    ),
    localEndDate: localDatePart(effectiveRoleEnd, input.timezoneOffsetMinutes),
    startAt: roleWindow.roleStart,
    endAt: effectiveRoleEnd
  };
}

function windowFromValidationRoleRegimeRun(input: {
  run: ValidationRoleRegimeBatchRunProvenance;
  plan: ValidationRoleRegimeReplayPlan;
  runSeed: string;
}): ReplayWindowSelection {
  return {
    seed: input.runSeed,
    rangeStart: earliestPlanBoundary(input.plan),
    rangeEnd: latestPlanBoundary(input.plan),
    windowMonths: input.plan.config.windowMonths,
    timezoneOffsetMinutes: input.plan.config.timezoneOffsetMinutes,
    candidateCount: input.plan.runs.length,
    selectedCandidateIndex: input.run.planIndex,
    selectedMonth: input.run.runKey,
    localStartDate: localDatePart(
      input.run.startAt,
      input.plan.config.timezoneOffsetMinutes
    ),
    localEndDate: localDatePart(
      input.run.endAt,
      input.plan.config.timezoneOffsetMinutes
    ),
    startAt: input.run.startAt,
    endAt: input.run.endAt
  };
}

function earliestPlanBoundary(plan: ValidationRoleRegimeReplayPlan): string {
  return plan.runs.reduce(
    (earliest, run) =>
      Date.parse(run.startAt) < Date.parse(earliest) ? run.startAt : earliest,
    plan.runs[0]!.startAt
  );
}

function latestPlanBoundary(plan: ValidationRoleRegimeReplayPlan): string {
  return plan.runs.reduce(
    (latest, run) =>
      Date.parse(run.endAt) > Date.parse(latest) ? run.endAt : latest,
    plan.runs[0]!.endAt
  );
}

function localDatePart(
  isoDateTime: string,
  timezoneOffsetMinutes: number
): string {
  const date = new Date(isoDateTime);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("validation split window must be a valid ISO datetime");
  }
  const shifted = new Date(
    date.getTime() + timezoneOffsetMinutes * 60_000
  );
  return [
    shifted.getUTCFullYear(),
    pad2(shifted.getUTCMonth() + 1),
    pad2(shifted.getUTCDate())
  ].join("-");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeValidationSplitAssignments(
  assignments: ValidationSplitAssignment[] | undefined,
  runCount: number
): ValidationSplitAssignment[] | null {
  if (assignments === undefined) {
    return null;
  }
  if (assignments.length === 0) {
    throw new Error("validationSplitAssignments must not be empty");
  }
  if (assignments.length !== runCount) {
    throw new Error("validationSplitAssignments length must equal runCount");
  }
  return assignments.map((assignment) =>
    validationSplitAssignmentSchema.parse(assignment)
  );
}

function validationProtocolSummaryFor(
  assignments: ValidationSplitAssignment[]
): BatchReplayValidationProtocolSummary {
  const roleCounts: Partial<Record<ValidationSplitRole, number>> = {};
  for (const assignment of assignments) {
    roleCounts[assignment.splitRole] =
      (roleCounts[assignment.splitRole] ?? 0) + 1;
  }
  return {
    validationProtocol: "walk_forward",
    assignmentCount: assignments.length,
    roleCounts
  };
}

function activeRunSnapshot(input: {
  runId: string;
  runIndex: number;
  runSeed: string;
  runStartedAt: Date;
  storageBaseDir: string;
  window: ReplayWindowSelection;
  windowSampling: BatchReplayRunWindowSampling;
  marketRegime: MarketRegimeClassification;
  marketRegimesByMarket: MarketRegimesByMarket;
  availability: HistoricalDataAvailabilityReport;
  validationSplit: ValidationSplitAssignment | null;
  validationRoleRegimePlan: ValidationRoleRegimeBatchRunProvenance | null;
}): BatchReplayActiveRunSnapshot {
  return {
    runId: input.runId,
    runIndex: input.runIndex,
    runSeed: input.runSeed,
    startedAt: input.runStartedAt.toISOString(),
    storageBaseDir: input.storageBaseDir,
    window: input.window,
    windowSampling: input.windowSampling,
    validationSplit: input.validationSplit,
    validationRoleRegimePlan: input.validationRoleRegimePlan,
    marketRegime: input.marketRegime,
    marketRegimesByMarket: input.marketRegimesByMarket,
    dataAvailability: summarizeAvailability(input.availability)
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
  validationSplit: ValidationSplitAssignment | null;
  validationRoleRegimePlan: ValidationRoleRegimeBatchRunProvenance | null;
  marketRegime: MarketRegimeClassification;
  marketRegimesByMarket: MarketRegimesByMarket;
  availability: HistoricalDataAvailabilityReport;
  researchManifest?: ReplayResearchManifestReference;
  reportPath?: string;
  summary?: BatchReplayRunSummary;
  error?: string;
  skipReason?: string;
  terminalAt?: Date;
}): BatchReplayRunRecord {
  const terminalAt =
    input.terminalAt?.toISOString() ??
    dateForRun(input.runStartedAt, 1).toISOString();
  return {
    mode: "paper_only",
    batchId: input.batchId,
    runId: input.runId,
    runIndex: input.runIndex,
    runSeed: input.runSeed,
    status: input.status,
    startedAt: input.runStartedAt.toISOString(),
    completedAt: isCompletedRunStatus(input.status) ? terminalAt : null,
    skippedAt: input.status === "skipped" ? terminalAt : null,
    failedAt: input.status === "failed" ? terminalAt : null,
    storageBaseDir: input.storageBaseDir,
    window: input.window,
    windowSampling: input.windowSampling,
    validationSplit: input.validationSplit,
    validationRoleRegimePlan: input.validationRoleRegimePlan,
    marketRegime: input.marketRegime,
    marketRegimesByMarket: input.marketRegimesByMarket,
    dataAvailability: summarizeAvailability(input.availability),
    researchManifest:
      input.researchManifest ??
      missingReplayResearchManifestReference("RESEARCH_MANIFEST_NOT_CREATED"),
    summary: input.summary ?? null,
    reportPath: input.reportPath ?? null,
    error: input.error ?? null,
    skipReason: input.skipReason ?? null
  };
}

async function readRunResearchManifestReference(
  storageBaseDir: string
): Promise<ReplayResearchManifestReference | undefined> {
  const manifestPath = createStoragePaths(
    storageBaseDir
  ).historicalReplayResearchManifestPath;

  try {
    const manifest = parseWithSchema(
      replayResearchManifestSchema,
      JSON.parse(await readFile(manifestPath, "utf8")),
      "batchRunReplayResearchManifest"
    );
    return replayResearchManifestReference({ manifest, manifestPath });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    return {
      ...missingReplayResearchManifestReference(
        "RESEARCH_MANIFEST_READ_FAILED"
      ),
      manifestPath
    };
  }
}

async function appendDataAvailabilityAuditEvent(
  record: BatchReplayRunRecord
): Promise<void> {
  const paths = createStoragePaths(record.storageBaseDir);
  await new FileAuditLog(paths.auditLogPath).append({
    eventId: `audit_batch_${record.runId}_data_availability_rejected`,
    eventType: "HISTORICAL_DATA_AVAILABILITY_REJECTED",
    actor: "system",
    summary: [
      "Batch replay skipped before execution",
      `skipReason=${record.skipReason ?? "unknown"}`,
      `issues=${record.dataAvailability.issues.join(",") || "none"}`
    ].join("; "),
    maskedRefs: [],
    createdAt: record.skippedAt ?? record.startedAt
  });
}

function summarizeRun(
  report: HistoricalReplayReport,
  auditEvents: AuditEvent[]
): BatchReplayRunSummary {
  const aiDecisionFailureReasons = uniqueRecentValues(
    auditEvents
      .filter((event) => event.eventType === "HISTORICAL_AI_DECISION_FAILED")
      .map((event) => event.summary)
  );
  return {
    finalVirtualNetWorthKrw: report.portfolio.finalVirtualNetWorthKrw,
    totalReturnRatio: report.advancedPerformance.totalReturnRatio,
    costSummary: report.costSummary,
    tradeCount: report.tradeSummary.tradeCount,
    decisionProviderCallCount: report.replaySummary.decisionProviderCallCount,
    aiDecisionFailureCount: auditEvents.filter(
      (event) => event.eventType === "HISTORICAL_AI_DECISION_FAILED"
    ).length,
    aiDecisionFailureReasons,
    lastAiDecisionFailureSummary: aiDecisionFailureReasons.at(-1) ?? null,
    rejectedCount: report.riskSummary.rejectedCount,
    meaningfulRejectCount: report.riskSummary.meaningfulRejectCount,
    dustRejectCount: report.riskSummary.dustRejectCount,
    avgExposureRatio: report.portfolioConstruction.avgExposureRatio,
    avgCashRatio: report.portfolioConstruction.avgCashRatio,
    maxExposureRatio: report.portfolioConstruction.maxExposureRatio,
    minExposureRatio: report.portfolioConstruction.minExposureRatio,
    timeInMarketRatio: report.portfolioConstruction.timeInMarketRatio,
    finalCashRatio: report.portfolioConstruction.finalCashRatio,
    finalPositionRatio: report.portfolioConstruction.finalPositionRatio,
    targetExposureRatio: report.portfolioConstruction.targetExposureRatio,
    averageTargetExposureGapRatio:
      report.portfolioConstruction.averageTargetExposureGapRatio,
    finalTargetExposureGapRatio:
      report.portfolioConstruction.finalTargetExposureGapRatio,
    finalExposureByMarketKrw: report.analytics.exposureByMarket,
    finalExposureByAssetTypeKrw: report.analytics.exposureByAssetType
  };
}

function isCompletedRunRecord(record: BatchReplayRunRecord): boolean {
  return isCompletedRunStatus(record.status);
}

function isCompletedRunStatus(status: BatchReplayRunStatus): boolean {
  return status === "completed" || status === "completed_with_failures";
}

function uniqueRecentValues(values: string[], limit = 5): string[] {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
  }
  return unique.slice(-limit);
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

function applyCandidateStrategyBucketAvailability(input: {
  report: HistoricalDataAvailabilityReport;
  snapshots: HistoricalMarketSnapshot[];
  windowStart: Date;
  windowEnd: Date;
  minWindowSnapshots: number;
  candidateStrategyBucket: StrategyBucket | undefined;
}): HistoricalDataAvailabilityReport {
  if (input.candidateStrategyBucket === undefined) {
    return input.report;
  }

  const scopedWindowSnapshotCount = input.snapshots.filter((snapshot) => {
    const observedAt = Date.parse(snapshot.observedAt);
    return (
      snapshot.strategyBucket === input.candidateStrategyBucket &&
      observedAt >= input.windowStart.getTime() &&
      observedAt <= input.windowEnd.getTime()
    );
  }).length;
  const issues = [...input.report.issues];
  if (scopedWindowSnapshotCount === 0) {
    issues.push("CANDIDATE_STRATEGY_BUCKET_WINDOW_SNAPSHOT_MISSING");
  }
  if (scopedWindowSnapshotCount < input.minWindowSnapshots) {
    issues.push(
      "CANDIDATE_STRATEGY_BUCKET_WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM"
    );
  }
  const uniqueIssues = Array.from(new Set(issues));

  return {
    ...input.report,
    status: uniqueIssues.length === 0 ? "available" : "insufficient",
    issues: uniqueIssues
  };
}

async function appendRunRecord(
  filePath: string,
  record: BatchReplayRunRecord
): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function appendSelectionTrialRecord(
  filePath: string,
  record: SelectionTrialRecord
): Promise<void> {
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function selectionTrialRecord(input: {
  record: BatchReplayRunRecord;
  decisionProviderMetadata: BatchReplayDecisionProviderMetadata;
  options: BatchReplayRunnerOptions;
  paperExitPolicy: NormalizedPaperExitPolicy | null;
}): SelectionTrialRecord {
  return createSelectionTrialRecord({
    batchId: input.record.batchId,
    runId: input.record.runId,
    runIndex: input.record.runIndex,
    runSeed: input.record.runSeed,
    status: input.record.status,
    startedAt: input.record.startedAt,
    completedAt: input.record.completedAt,
    skippedAt: input.record.skippedAt,
    failedAt: input.record.failedAt,
    window: input.record.window,
    marketRegime: input.record.marketRegime,
    decisionProviderMetadata: input.decisionProviderMetadata,
    strategyPreset: input.options.strategyPreset ?? null,
    candidateStrategyBucket: input.options.candidateStrategyBucket ?? null,
    replayCadence: {
      stepSeconds: input.options.stepSeconds ?? DEFAULT_STEP_SECONDS,
      everyNSteps: input.options.everyNSteps ?? null,
      candidateChangedOnly: input.options.candidateChangedOnly ?? false,
      decisionFrequency: input.options.decisionFrequency ?? "every_tick",
      maxDecisionCalls: input.options.maxDecisionCalls ?? null,
      timezoneOffsetMinutes:
        input.options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES
    },
    riskProfile: input.options.riskProfile ?? null,
    riskPolicy: input.options.riskPolicy,
    allocationPolicy: input.options.allocationPolicy ?? null,
    marketRegimeAllocationPolicy:
      input.options.marketRegimeAllocationPolicy ?? null,
    paperExitPolicy: input.paperExitPolicy,
    researchManifest: input.record.researchManifest,
    totalReturnRatio: input.record.summary?.totalReturnRatio ?? null,
    finalVirtualNetWorthKrw:
      input.record.summary?.finalVirtualNetWorthKrw ?? null,
    tradeCount: input.record.summary?.tradeCount ?? 0,
    aiDecisionFailureCount:
      input.record.summary?.aiDecisionFailureCount ?? 0,
    rejectedCount: input.record.summary?.rejectedCount ?? 0,
    skipReason: input.record.skipReason,
    error: input.record.error,
    reportPath: input.record.reportPath
  });
}

async function writeManifest(
  filePath: string,
  manifest: BatchReplayManifest
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function batchReplayRunId(
  batchId: string,
  runIndex: number,
  window: ReplayWindowSelection
): string {
  const paddedIndex = String(runIndex).padStart(6, "0");
  return `${safeArtifactPathPart(
    batchId,
    "batch"
  )}_run_${paddedIndex}_${safeArtifactPathPart(window.selectedMonth, "window")}`;
}

function validateBatchOptions(
  options: BatchReplayRunnerOptions,
  validationRoleRegimePlan: ValidationRoleRegimeReplayPlan | null
): void {
  normalizeRequiredText(options.batchId, "batchId");
  normalizeRequiredText(options.seed, "seed");
  if (options.candidateStrategyBucket !== undefined) {
    parseWithSchema(
      strategyBucketSchema,
      options.candidateStrategyBucket,
      "candidateStrategyBucket"
    );
  }
  if (!Number.isInteger(options.runCount) || options.runCount <= 0) {
    throw new Error("runCount must be a positive integer");
  }
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }
  if (
    options.validationSplitAssignments !== undefined &&
    options.fixedWindow !== undefined
  ) {
    throw new Error("validationSplitAssignments cannot be used with fixedWindow");
  }
  if (
    options.validationSplitAssignments !== undefined &&
    options.validationSplitAssignments.length !== options.runCount
  ) {
    throw new Error("validationSplitAssignments length must equal runCount");
  }
  if (validationRoleRegimePlan === null) {
    return;
  }
  if (
    options.validationSplitAssignments !== undefined ||
    options.fixedWindow !== undefined ||
    options.windowSamplingMode !== undefined ||
    options.targetRegimes !== undefined
  ) {
    throw new Error(
      "validationRoleRegimePlan cannot be combined with existing window selection options"
    );
  }
  if (options.runCount !== validationRoleRegimePlan.runs.length) {
    throw new Error("runCount must equal validationRoleRegimePlan runs length");
  }
  if (
    options.rangeStart.getTime() !==
      Date.parse(earliestPlanBoundary(validationRoleRegimePlan)) ||
    options.rangeEnd.getTime() !==
      Date.parse(latestPlanBoundary(validationRoleRegimePlan))
  ) {
    throw new Error("range must match validationRoleRegimePlan boundaries");
  }
  if (
    options.candidateStrategyBucket !==
    validationRoleRegimePlan.config.candidateStrategyBucket
  ) {
    throw new Error(
      "candidateStrategyBucket must match validationRoleRegimePlan"
    );
  }
  if (
    options.windowMonths !== undefined &&
    options.windowMonths !== validationRoleRegimePlan.config.windowMonths
  ) {
    throw new Error("windowMonths must match validationRoleRegimePlan");
  }
  if (
    options.timezoneOffsetMinutes !== undefined &&
    options.timezoneOffsetMinutes !==
      validationRoleRegimePlan.config.timezoneOffsetMinutes
  ) {
    throw new Error(
      "timezoneOffsetMinutes must match validationRoleRegimePlan"
    );
  }
  if (
    options.universeManifest === undefined ||
    options.validationRoleRegimeUniverseSource === undefined ||
    options.calendarValidation === undefined ||
    options.validationRoleRegimeCoverage === undefined
  ) {
    throw new Error(
      "validationRoleRegimePlan requires universe, coverage, and calendar sources"
    );
  }
}

function assertValidationRoleRegimeRuntimeSources(input: {
  options: BatchReplayRunnerOptions;
  plan: ValidationRoleRegimeReplayPlan;
  provenance: ValidationRoleRegimeBatchProvenance;
  snapshots: HistoricalMarketSnapshot[];
  corruptLineCount: number;
}): void {
  if (input.corruptLineCount !== 0) {
    throw new Error("validation role-regime source snapshot is corrupt");
  }
  const orderedSnapshots = [...input.snapshots].sort(compareSourceSnapshots);
  if (
    createReplayResearchHash(orderedSnapshots) !==
    input.plan.source.dataSnapshotHash
  ) {
    throw new Error("validation role-regime data snapshot hash mismatch");
  }
  if (
    createReplayResearchHash(
      input.options.validationRoleRegimeUniverseSource
    ) !==
    input.plan.source.universeHash
  ) {
    throw new Error("validation role-regime universe hash mismatch");
  }
  const coverage = feasibilityCoverageSourceSchema.parse(
    input.options.validationRoleRegimeCoverage
  );
  if (
    createReplayResearchHash(coverage) !== input.plan.source.coverageHash
  ) {
    throw new Error("validation role-regime coverage hash mismatch");
  }
  if (
    createValidationFeasibilityCalendarHash(
      input.options.calendarValidation!
    ) !== input.plan.source.calendarHash
  ) {
    throw new Error("validation role-regime calendar hash mismatch");
  }
  const classifier = defaultMarketRegimeClassifierConfig();
  if (
    createValidationFeasibilityClassifierHash(classifier) !==
    input.plan.source.marketRegimeClassifierHash
  ) {
    throw new Error("validation role-regime classifier hash mismatch");
  }

  for (const run of input.provenance.runs) {
    const windowStart = new Date(run.startAt);
    const windowEnd = new Date(run.endAt);
    const availability = applyCandidateStrategyBucketAvailability({
      report: assessHistoricalDataAvailability({
        snapshots: input.snapshots,
        windowStart,
        windowEnd,
        corruptLineCount: input.corruptLineCount,
        minWindowSnapshots: input.options.minWindowSnapshots ?? 1,
        minSnapshotsPerRequiredSymbol:
          input.options.minSnapshotsPerRequiredSymbol ?? 1,
        requiredSymbols: input.options.requiredSymbols ?? [],
        calendarValidation: input.options.calendarValidation!,
        ...(input.options.fxValidation === undefined
          ? {}
          : { fxValidation: input.options.fxValidation })
      }),
      snapshots: input.snapshots,
      windowStart,
      windowEnd,
      minWindowSnapshots: input.options.minWindowSnapshots ?? 1,
      candidateStrategyBucket: input.options.candidateStrategyBucket
    });
    if (availability.status !== "available") {
      throw new Error(
        `validation role-regime runtime source unavailable: ${run.runKey}`
      );
    }
    const candidateHash = createValidationFeasibilityCandidateHash({
      startAt: run.startAt,
      endAt: run.endAt,
      timezoneOffsetMinutes: input.plan.config.timezoneOffsetMinutes,
      windowMonths: input.plan.config.windowMonths,
      calendarHash: input.plan.source.calendarHash,
      marketRegimeClassifierHash:
        input.plan.source.marketRegimeClassifierHash,
      candidateStrategyBucket: input.plan.config.candidateStrategyBucket,
      scopeAvailable: true,
      dataSnapshotHash: input.plan.source.dataSnapshotHash,
      universeHash: input.plan.source.universeHash,
      coverageHash: input.plan.source.coverageHash
    });
    if (candidateHash !== run.candidateHash) {
      throw new Error(
        `validation role-regime candidate hash mismatch: ${run.runKey}`
      );
    }
    const { version: _version, ...classifierOptions } = classifier;
    const regime = classifyMarketRegime({
      snapshots: input.snapshots,
      windowStart,
      windowEnd,
      ...classifierOptions
    });
    if (regime.label !== run.targetRegime) {
      throw new Error(
        `validation role-regime target regime mismatch: ${run.runKey}`
      );
    }
  }
}

async function assertValidationRoleRegimeOutputAbsent(
  outputDir: string
): Promise<void> {
  try {
    await access(outputDir);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(
    `validation role-regime batch output already exists: ${outputDir}`
  );
}

function compareSourceSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  return (
    Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol) ||
    compareText(left.snapshotId, right.snapshotId)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function terminalDateForRun(input: {
  startedAt: Date;
  runIndex: number;
  wallClock: boolean;
}): Date {
  return input.wallClock
    ? new Date()
    : dateForRun(input.startedAt, input.runIndex);
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

function batchDecisionProviderMetadata(
  options: BatchReplayRunnerOptions
): BatchReplayDecisionProviderMetadata {
  if (options.decisionProviderMetadata !== undefined) {
    return options.decisionProviderMetadata;
  }

  if (options.decisionProviderFactory !== undefined) {
    return unknownDecisionProviderMetadata();
  }

  return defaultDecisionProviderMetadata();
}

function unknownDecisionProviderMetadata(): BatchReplayDecisionProviderMetadata {
  return {
    mode: "unknown_provider",
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
