import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import {
  normalizePaperExitPolicy,
  type PaperExitPolicy
} from "../paper/exitPolicy.js";
import type { MarketRegimeAllocationPolicy } from "../paper/marketRegimeAllocationPolicy.js";
import type { PaperRiskProfileName } from "../paper/riskProfile.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import type {
  CodexHistoricalReplayDecisionProviderLike,
  CodexHistoricalReplayRunnerOptions
} from "../replay/codexHistoricalReplayRunner.js";
import {
  createPaperExecutionPolicy,
  type PaperExecutionPolicy
} from "../paper/executionModel.js";
import type { HistoricalReplayRunMetadataContext } from "../replay/historicalReplayAuditLog.js";
import type { HistoricalReplayInput } from "../replay/historicalReplayRunner.js";
import type { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import type { ReplayWindowSelection } from "../replay/replayWindowSampler.js";
import type { SimulatedClock } from "../replay/simulatedClock.js";
import type { HistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";
import type { StrategyReplayPresetName } from "../replay/strategyReplayPreset.js";

export interface HistoricalReplayWorkflowOptions {
  storageBaseDir: string;
  historicalMarketSnapshotsPath?: string;
  clock: SimulatedClock;
  decisionProvider?: CodexHistoricalReplayDecisionProviderLike;
  samplingPolicy?: ReplaySamplingPolicy;
  generatedAt?: Date;
  initialCashKrw?: number;
  packetIdPrefix: string;
  packetExpiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
  executionPolicy?: Partial<PaperExecutionPolicy>;
  riskProfile?: PaperRiskProfileName;
  riskPolicy?: Partial<VirtualRiskPolicy>;
  allocationPolicy?: PaperAllocationPolicy;
  marketRegimeAllocationPolicy?: MarketRegimeAllocationPolicy;
  paperExitPolicy?: PaperExitPolicy;
  tickDelayMs?: number;
  decisionProviderMetadata?: unknown;
  universeManifest?: HistoricalUniverseManifest;
  strategyPreset?: StrategyReplayPresetName;
  runId?: string;
  batchId?: string;
  batchRunIndex?: number;
  windowSelection?: ReplayWindowSelection;
}

export interface HistoricalReplayWorkflowPlanInput {
  options: HistoricalReplayWorkflowOptions;
  storedPortfolio: VirtualPortfolio | null;
  snapshots: HistoricalMarketSnapshot[];
  replayStartedAt: Date;
  decisionProvider: CodexHistoricalReplayDecisionProviderLike;
}

export interface HistoricalReplayWorkflowPlan {
  initialPortfolio: VirtualPortfolio;
  replayInput: HistoricalReplayInput;
  runnerOptions: Omit<CodexHistoricalReplayRunnerOptions, "onProgress">;
  metadataContext: HistoricalReplayRunMetadataContext;
  tickCount: number;
}

const DEFAULT_INITIAL_CASH_KRW = 1_000_000;

export function createHistoricalReplayWorkflowPlan(
  input: HistoricalReplayWorkflowPlanInput
): HistoricalReplayWorkflowPlan {
  const initialPortfolio =
    input.storedPortfolio ??
    createInitialPortfolio(
      input.options.initialCashKrw ?? DEFAULT_INITIAL_CASH_KRW,
      input.options.clock
    );
  const executionPolicy =
    input.options.executionPolicy === undefined
      ? undefined
      : createPaperExecutionPolicy(input.options.executionPolicy);
  const runnerOptions: Omit<CodexHistoricalReplayRunnerOptions, "onProgress"> = {
    clock: input.options.clock,
    decisionProvider: input.decisionProvider,
    ...(input.options.samplingPolicy === undefined
      ? {}
      : { samplingPolicy: input.options.samplingPolicy }),
    packetIdPrefix: input.options.packetIdPrefix,
    packetExpiresInSeconds: input.options.packetExpiresInSeconds,
    maxCandidates: input.options.maxCandidates,
    maxSnapshotAgeSeconds: input.options.maxSnapshotAgeSeconds,
    constraints: input.options.constraints,
    ...(executionPolicy === undefined ? {} : { executionPolicy }),
    ...(input.options.riskPolicy === undefined
      ? {}
      : { riskPolicy: input.options.riskPolicy }),
    ...(input.options.allocationPolicy === undefined
      ? {}
      : { allocationPolicy: input.options.allocationPolicy }),
    ...(input.options.marketRegimeAllocationPolicy === undefined
      ? {}
      : {
          marketRegimeAllocationPolicy:
            input.options.marketRegimeAllocationPolicy
        }),
    ...(input.options.paperExitPolicy === undefined
      ? {}
      : { paperExitPolicy: input.options.paperExitPolicy }),
    ...(input.options.universeManifest === undefined
      ? {}
      : { universeManifest: input.options.universeManifest }),
    ...(input.options.tickDelayMs === undefined
      ? {}
      : { tickDelayMs: input.options.tickDelayMs })
  };

  return {
    initialPortfolio,
    replayInput: {
      initialPortfolio,
      snapshots: input.snapshots
    },
    runnerOptions,
    metadataContext: buildHistoricalReplayRunMetadataContext(
      input.options,
      input.replayStartedAt
    ),
    tickCount: input.options.clock.ticks().length
  };
}

function buildHistoricalReplayRunMetadataContext(
  options: HistoricalReplayWorkflowOptions,
  replayStartedAt: Date
): HistoricalReplayRunMetadataContext {
  const clock = options.clock.metadata();
  const samplingPolicy = options.samplingPolicy?.metadata() ?? null;
  const windowSelection = options.windowSelection;
  const batchId = normalizeOptionalText(options.batchId);
  const runIndex = options.batchRunIndex ?? null;
  const timezoneOffsetMinutes =
    windowSelection?.timezoneOffsetMinutes ??
    samplingPolicy?.timezoneOffsetMinutes ??
    0;

  return {
    identity: {
      runId:
        normalizeOptionalText(options.runId) ??
        defaultRunId({
          batchId,
          runIndex,
          replayStartedAt,
          windowStartAt: clock.startAt
        }),
      batchId,
      runIndex
    },
    window: {
      source: windowSelection === undefined ? "explicit" : "random_window",
      startAt: clock.startAt,
      endAt: clock.endAt,
      rangeStart: windowSelection?.rangeStart ?? null,
      rangeEnd: windowSelection?.rangeEnd ?? null,
      seed: windowSelection?.seed ?? null,
      selectedMonth: windowSelection?.selectedMonth ?? null,
      localStartDate: windowSelection?.localStartDate ?? null,
      localEndDate: windowSelection?.localEndDate ?? null,
      windowMonths: windowSelection?.windowMonths ?? null,
      timezoneOffsetMinutes
    },
    configuration: {
      clock: {
        startAt: clock.startAt,
        endAt: clock.endAt,
        stepSeconds: clock.stepSeconds,
        speedMultiplier: clock.speedMultiplier
      },
      samplingPolicy,
      initialCashKrw: options.initialCashKrw ?? DEFAULT_INITIAL_CASH_KRW,
      packetIdPrefix: options.packetIdPrefix,
      packetExpiresInSeconds: options.packetExpiresInSeconds,
      maxCandidates: options.maxCandidates,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
      constraints: options.constraints,
      ...(options.executionPolicy === undefined
        ? {}
        : { executionPolicy: createPaperExecutionPolicy(options.executionPolicy) }),
      strategyPreset: options.strategyPreset ?? null,
      riskProfile: options.riskProfile ?? null,
      riskPolicy: serializeRiskPolicy(options.riskPolicy),
      allocationPolicy: options.allocationPolicy ?? null,
      marketRegimeAllocationPolicy:
        options.marketRegimeAllocationPolicy ?? null,
      paperExitPolicy: normalizePaperExitPolicy(options.paperExitPolicy)
    }
  };
}

function serializeRiskPolicy(
  policy: Partial<VirtualRiskPolicy> | undefined
): HistoricalReplayRunMetadataContext["configuration"]["riskPolicy"] {
  if (policy === undefined) {
    return null;
  }

  return {
    ...(policy.maxBudgetPerDecisionKrw === undefined
      ? {}
      : { maxBudgetPerDecisionKrw: policy.maxBudgetPerDecisionKrw }),
    ...(policy.maxSymbolExposureKrw === undefined
      ? {}
      : { maxSymbolExposureKrw: policy.maxSymbolExposureKrw }),
    ...(policy.targetExposureRatio === undefined
      ? {}
      : { targetExposureRatio: policy.targetExposureRatio }),
    ...(policy.maxPositionWeightRatio === undefined
      ? {}
      : { maxPositionWeightRatio: policy.maxPositionWeightRatio }),
    ...(policy.maxStrategyBucketExposureKrw === undefined
      ? {}
      : {
          maxStrategyBucketExposureKrw:
            policy.maxStrategyBucketExposureKrw
        }),
    ...(policy.maxStrategyBucketExposureRatio === undefined
      ? {}
      : {
          maxStrategyBucketExposureRatio:
            policy.maxStrategyBucketExposureRatio
        }),
    ...(policy.maxBucketTurnoverKrw === undefined
      ? {}
      : { maxBucketTurnoverKrw: policy.maxBucketTurnoverKrw }),
    ...(policy.maxBucketTurnoverRatio === undefined
      ? {}
      : { maxBucketTurnoverRatio: policy.maxBucketTurnoverRatio }),
    ...(policy.maxSectorExposureKrw === undefined
      ? {}
      : { maxSectorExposureKrw: policy.maxSectorExposureKrw }),
    ...(policy.maxSectorExposureRatio === undefined
      ? {}
      : { maxSectorExposureRatio: policy.maxSectorExposureRatio }),
    ...(policy.maxCountryExposureKrw === undefined
      ? {}
      : { maxCountryExposureKrw: policy.maxCountryExposureKrw }),
    ...(policy.maxCountryExposureRatio === undefined
      ? {}
      : { maxCountryExposureRatio: policy.maxCountryExposureRatio }),
    ...(policy.maxCurrencyExposureKrw === undefined
      ? {}
      : { maxCurrencyExposureKrw: policy.maxCurrencyExposureKrw }),
    ...(policy.maxCurrencyExposureRatio === undefined
      ? {}
      : { maxCurrencyExposureRatio: policy.maxCurrencyExposureRatio }),
    ...(policy.maxUnknownMetadataExposureKrw === undefined
      ? {}
      : {
          maxUnknownMetadataExposureKrw:
            policy.maxUnknownMetadataExposureKrw
        }),
    ...(policy.maxUnknownMetadataExposureRatio === undefined
      ? {}
      : {
          maxUnknownMetadataExposureRatio:
            policy.maxUnknownMetadataExposureRatio
        }),
    ...(policy.minCashReserveRatio === undefined
      ? {}
      : { minCashReserveRatio: policy.minCashReserveRatio }),
    ...(policy.minCashReserveKrw === undefined
      ? {}
      : { minCashReserveKrw: policy.minCashReserveKrw }),
    ...(policy.dynamicCashReservePolicy === undefined
      ? {}
      : { dynamicCashReservePolicy: policy.dynamicCashReservePolicy }),
    ...(policy.hedgePolicy === undefined
      ? {}
      : { hedgePolicy: policy.hedgePolicy })
  };
}

function defaultRunId(input: {
  batchId: string | null;
  runIndex: number | null;
  replayStartedAt: Date;
  windowStartAt: string;
}): string {
  const windowDate = input.windowStartAt.slice(0, 10).replaceAll("-", "");
  if (input.batchId !== null) {
    const runIndex =
      input.runIndex === null
        ? "manual"
        : String(input.runIndex).padStart(6, "0");
    return `${safeRunIdPart(input.batchId)}_run_${runIndex}_${windowDate}`;
  }

  const startedAt = input.replayStartedAt
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `historical_replay_${startedAt}_${windowDate}`;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function safeRunIdPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized.length === 0 ? "batch" : sanitized;
}

function createInitialPortfolio(
  cashKrw: number,
  clock: SimulatedClock
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw,
    positions: [],
    updatedAt: clock.metadata().startAt
  };
}
