import { z } from "zod";

import { historicalMarketSnapshotSchema } from "../domain/schemas.js";
import { HistoricalMarketSnapshotIndex } from "../market/historicalPacketBuilder.js";
import { createPaperCostModel } from "../paper/costModel.js";
import { createPaperExecutionPolicy } from "../paper/executionModel.js";
import { normalizePaperExitPolicy } from "../paper/exitPolicy.js";
import { resolvePaperRiskProfile } from "../paper/riskProfile.js";
import { historicalReplayRunConfigurationSchema } from "./historicalReplayAuditLog.js";
import { historicalUniverseManifestSchema } from "./historicalUniverseCoverage.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { ReplaySamplingPolicy } from "./replaySamplingPolicy.js";
import { SimulatedClock } from "./simulatedClock.js";

export const PAPER_EXPERIMENT_INPUT_VERSION = "paper_experiment_input.v1";
export const PAPER_EXPERIMENT_FIXTURE_ID = "paper-experiment";
export const PAPER_EXPERIMENT_SOURCE_REF = "fixture:paper-experiment.v1";
export const PAPER_EXPERIMENT_LIMITS = Object.freeze({
  inputBytes: 2 * 1024 * 1024,
  snapshots: 100,
  symbols: 10,
  ticks: 100,
  decisionCalls: 100,
  minimumStepSeconds: 60,
  costBps: 10_000,
  snapshotVolume: 1_000_000_000_000
});
export const PAPER_EXPERIMENT_LIMITATIONS = Object.freeze([
  "synthetic_fixture_only",
  "exchange_calendar_fx_lifecycle_not_verified",
  "not_statistical_or_investment_evidence"
] as const);

const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const explicitTimestampSchema = z.iso.datetime({ offset: true, precision: 3 })
  .or(z.iso.datetime({ offset: true, precision: 0 }))
  .transform((value) => new Date(value).toISOString())
  .pipe(z.iso.datetime({ precision: 3 }));
const fixtureSymbolSchema = z.string().regex(/^FIXTURE_[A-Z0-9_]{1,32}$/);
const fixtureTokenSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const boundedTextSchema = z.string().trim().min(1).max(2000);
const baseConfiguration = historicalReplayRunConfigurationSchema;
const baseExecutionPolicy = baseConfiguration.shape.executionPolicy.unwrap();
const executionPolicySchema = baseExecutionPolicy.extend({
  fillRatio: baseExecutionPolicy.shape.fillRatio.max(1),
  slippageBps: baseExecutionPolicy.shape.slippageBps.max(PAPER_EXPERIMENT_LIMITS.costBps),
  feeBps: baseExecutionPolicy.shape.feeBps.max(PAPER_EXPERIMENT_LIMITS.costBps),
  taxBps: baseExecutionPolicy.shape.taxBps.max(PAPER_EXPERIMENT_LIMITS.costBps),
  halfSpreadBps: baseExecutionPolicy.shape.halfSpreadBps.unwrap().max(PAPER_EXPERIMENT_LIMITS.costBps).default(0),
  marketImpactBpsPerParticipationRate: baseExecutionPolicy.shape.marketImpactBpsPerParticipationRate.max(PAPER_EXPERIMENT_LIMITS.costBps)
});
const riskPolicySchema = baseConfiguration.shape.riskPolicy.unwrap().pick({
  maxBudgetPerDecisionKrw: true,
  maxSymbolExposureKrw: true,
  targetExposureRatio: true,
  maxPositionWeightRatio: true,
  minCashReserveRatio: true,
  minCashReserveKrw: true
});
const configurationSchema = baseConfiguration.extend({
  clock: baseConfiguration.shape.clock.extend({
    startAt: explicitTimestampSchema,
    endAt: explicitTimestampSchema,
    stepSeconds: z.number().int().min(PAPER_EXPERIMENT_LIMITS.minimumStepSeconds)
      .max(Number.MAX_SAFE_INTEGER / 1000),
    speedMultiplier: z.literal(1)
  }),
  samplingPolicy: baseConfiguration.shape.samplingPolicy.unwrap().extend({
    everyNSteps: z.number().int().min(1).max(PAPER_EXPERIMENT_LIMITS.ticks).nullable(),
    maxDecisionCalls: z.number().int().min(1).max(PAPER_EXPERIMENT_LIMITS.decisionCalls),
    timezoneOffsetMinutes: z.literal(0)
  }),
  packetIdPrefix: fixtureTokenSchema,
  packetExpiresInSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER / 1000),
  maxCandidates: z.number().int().min(1).max(PAPER_EXPERIMENT_LIMITS.symbols),
  maxSnapshotAgeSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER / 1000),
  executionPolicy: executionPolicySchema.partial().optional(),
  strategyPreset: z.null(),
  candidateStrategyBucket: z.null(),
  riskProfile: baseConfiguration.shape.riskProfile.unwrap(),
  riskPolicy: riskPolicySchema.nullable(),
  marketRegimeAllocationPolicy: z.null(),
  paperExitPolicy: z.null()
});
const snapshotSchema = historicalMarketSnapshotSchema.safeExtend({
  snapshotId: fixtureTokenSchema,
  lastPriceKrw: historicalMarketSnapshotSchema.shape.lastPriceKrw.positive(),
  symbol: fixtureSymbolSchema,
  observedAt: explicitTimestampSchema,
  createdAt: explicitTimestampSchema,
  volume: historicalMarketSnapshotSchema.shape.volume.unwrap().max(PAPER_EXPERIMENT_LIMITS.snapshotVolume).optional(),
  sourceRefs: z.tuple([z.literal(PAPER_EXPERIMENT_SOURCE_REF)])
});
const universeSchema = historicalUniverseManifestSchema.refine(
  (value) => value.symbols.length <= PAPER_EXPERIMENT_LIMITS.symbols
    && value.symbols.every((member) => fixtureSymbolSchema.safeParse(member.symbol).success
      && (member.sourceSymbol === undefined || member.sourceSymbol === member.symbol)),
  "Expected a bounded synthetic universe"
);
const inputSchema = z.object({
  schemaVersion: z.literal(PAPER_EXPERIMENT_INPUT_VERSION),
  mode: z.literal("fixture_only"),
  question: boundedTextSchema,
  fixture: z.object({
    id: z.literal(PAPER_EXPERIMENT_FIXTURE_ID),
    version: z.literal(1)
  }).strict(),
  // null binds to the independently verified caller context; it is never retained.
  implementationRevision: revisionSchema.nullable(),
  source: z.object({
    kind: z.literal("inline_synthetic"),
    coverageDescription: boundedTextSchema,
    snapshots: z.array(snapshotSchema).min(1).max(PAPER_EXPERIMENT_LIMITS.snapshots)
  }).strict(),
  universe: universeSchema,
  configuration: configurationSchema,
  initialPositions: z.tuple([]),
  provider: z.object({
    id: z.literal("FirstPricedHistoricalDecisionProvider"),
    version: z.literal("first_priced_fixture.v1"),
    mode: z.literal("deterministic_fixture"),
    externalCalls: z.literal(0)
  }).strict(),
  evaluation: z.object({
    evidenceCutoff: explicitTimestampSchema,
    generatedAt: explicitTimestampSchema,
    primaryBenchmark: z.literal("cashOnly"),
    reviewQuestions: z.array(boundedTextSchema).min(1).max(10),
    limitations: z.tuple([
      z.literal(PAPER_EXPERIMENT_LIMITATIONS[0]),
      z.literal(PAPER_EXPERIMENT_LIMITATIONS[1]),
      z.literal(PAPER_EXPERIMENT_LIMITATIONS[2])
    ])
  }).strict(),
  // Validated against the existing resolver's entire plain JSON output below.
  costModel: z.unknown().optional()
}).strict();

export interface PaperExperimentExecutionIdentity {
  implementationRevision: string;
}

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export type PaperExperimentInput = z.input<typeof inputSchema>;
type EffectivePaperExperimentInput = ReturnType<typeof normalizeInput>;
export type NormalizedPaperExperimentInput = DeepReadonly<EffectivePaperExperimentInput>;
export type PaperExperimentValidationCode =
  | "INPUT_SIZE" | "INVALID_JSON" | "INVALID_INPUT" | "INVALID_EXECUTION_IDENTITY"
  | "REVISION_MISMATCH" | "INVALID_WINDOW" | "TICK_LIMIT" | "TIMESTAMP_RANGE" | "SOURCE_CONFLICT"
  | "SOURCE_CUTOFF" | "UNIVERSE_MISMATCH" | "NO_USABLE_SOURCE" | "COST_MODEL_MISMATCH";

export class PaperExperimentValidationError extends Error {
  constructor(readonly code: PaperExperimentValidationCode) {
    super(`Paper experiment validation failed: ${code}`);
    this.name = "PaperExperimentValidationError";
  }
}

/** Pure admission only: the caller reads bytes and supplies a verified code identity. */
export function parsePaperExperimentInput(
  json: string | Uint8Array,
  executionIdentity: PaperExperimentExecutionIdentity
) {
  let parsed: unknown;
  try {
    const size = typeof json === "string" ? Buffer.byteLength(json, "utf8") : json.byteLength;
    requireInput(size > 0 && size <= PAPER_EXPERIMENT_LIMITS.inputBytes, "INPUT_SIZE");
    const text = typeof json === "string" ? json : new TextDecoder("utf-8", { fatal: true }).decode(json);
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof PaperExperimentValidationError) throw error;
    throw new PaperExperimentValidationError("INVALID_JSON");
  }

  try {
    const identity = z.object({ implementationRevision: revisionSchema }).strict()
      .safeParse(executionIdentity);
    requireInput(identity.success, "INVALID_EXECUTION_IDENTITY");
    const input = inputSchema.parse(parsed);
    requireInput(input.implementationRevision === null
      || input.implementationRevision === executionIdentity.implementationRevision, "REVISION_MISMATCH");
    const normalizedInput = normalizeInput(input, executionIdentity);
    const preflight = assessSourceCoverage(normalizedInput);
    const inputHash = createReplayResearchHash(normalizedInput);
    return deepFreeze({ normalizedInput, inputHash, preflight });
  } catch (error) {
    if (error instanceof PaperExperimentValidationError) throw error;
    // Do not leak raw values, object keys, paths or resolver/Zod diagnostics.
    throw new PaperExperimentValidationError("INVALID_INPUT");
  }
}

function normalizeInput(
  input: z.infer<typeof inputSchema>,
  executionIdentity: PaperExperimentExecutionIdentity
) {
  const config = input.configuration;
  const startMs = Date.parse(config.clock.startAt);
  const endMs = Date.parse(config.clock.endAt);
  requireInput(endMs >= startMs, "INVALID_WINDOW");
  const tickCount = Math.floor((endMs - startMs) / (config.clock.stepSeconds * 1000)) + 1;
  requireInput(Number.isSafeInteger(tickCount) && tickCount <= PAPER_EXPERIMENT_LIMITS.ticks, "TICK_LIMIT");
  // The existing packet builder derives expiry/freshness timestamps with these additions.
  const latestTimestampMs = Date.parse("9999-12-31T23:59:59.999Z");
  requireInput(Math.max(endMs, Date.parse(input.evaluation.generatedAt))
    + config.packetExpiresInSeconds * 1000 <= latestTimestampMs, "TIMESTAMP_RANGE");
  requireInput(input.source.snapshots.every((snapshot) => Date.parse(snapshot.observedAt)
    + config.maxSnapshotAgeSeconds * 1000 <= latestTimestampMs), "TIMESTAMP_RANGE");
  const profile = resolvePaperRiskProfile({
    name: config.riskProfile,
    initialCashKrw: config.initialCashKrw,
    maxNewPositions: config.constraints.maxNewPositions,
    maxBudgetPerSymbolKrw: config.constraints.maxBudgetPerSymbolKrw
  });
  const executionPolicy = createPaperExecutionPolicy(executionPolicySchema.parse({
    ...createPaperExecutionPolicy(undefined), ...config.executionPolicy
  }));
  const costModel = createPaperCostModel(executionPolicy);
  if (input.costModel !== undefined) {
    requireInput(createReplayResearchHash(input.costModel) === createReplayResearchHash(costModel), "COST_MODEL_MISMATCH");
  }
  const sampling = config.samplingPolicy;
  const samplingPolicy = new ReplaySamplingPolicy({
    ...(sampling.everyNSteps === null ? {} : { everyNSteps: sampling.everyNSteps }),
    candidateChangedOnly: sampling.candidateChangedOnly,
    decisionFrequency: sampling.decisionFrequency,
    maxDecisionCalls: sampling.maxDecisionCalls,
    timezoneOffsetMinutes: sampling.timezoneOffsetMinutes
  }).metadata();
  const clock = new SimulatedClock({
    startAt: new Date(config.clock.startAt),
    endAt: new Date(config.clock.endAt),
    stepSeconds: config.clock.stepSeconds,
    speedMultiplier: config.clock.speedMultiplier
  }).metadata();
  const symbols = input.universe.symbols.map(({ lifecycleStatusSource, ...member }) => {
    void lifecycleStatusSource; // Parser-derived provenance is not an input-schema field.
    return {
      ...member,
      ...(member.riskTags === undefined ? {} : { riskTags: [...new Set(member.riskTags)].sort(compareText) })
    };
  }).sort((a, b) => compareText(symbolKey(a), symbolKey(b)));
  const snapshots = input.source.snapshots.map((snapshot) => ({
    ...snapshot,
    ...(snapshot.riskTags === undefined ? {} : { riskTags: [...new Set(snapshot.riskTags)].sort(compareText) })
  })).sort((a, b) =>
    compareText(a.market, b.market) || compareText(a.symbol, b.symbol)
    || compareText(a.observedAt, b.observedAt) || compareText(a.snapshotId, b.snapshotId));
  const seenIds = new Set<string>();
  const seenInstants = new Set<string>();
  const members = new Map(symbols.map((member) => [symbolKey(member), member]));
  const cutoffMs = Date.parse(input.evaluation.evidenceCutoff);
  for (const snapshot of snapshots) {
    const instantKey = `${symbolKey(snapshot)}:${snapshot.observedAt}`;
    requireInput(!seenIds.has(snapshot.snapshotId) && !seenInstants.has(instantKey), "SOURCE_CONFLICT");
    seenIds.add(snapshot.snapshotId);
    seenInstants.add(instantKey);
    requireInput(Date.parse(snapshot.observedAt) <= cutoffMs, "SOURCE_CUTOFF");
    const member = members.get(symbolKey(snapshot));
    requireInput(member !== undefined, "UNIVERSE_MISMATCH");
    if (member.riskTags !== undefined && snapshot.riskTags !== undefined) {
      requireInput(createReplayResearchHash([...new Set(member.riskTags)].sort(compareText))
        === createReplayResearchHash([...new Set(snapshot.riskTags)].sort(compareText)), "UNIVERSE_MISMATCH");
    }
    for (const key of ["assetType", "assetClass", "region", "strategyBucket", "sector"] as const) {
      requireInput(member?.[key] === undefined || snapshot[key] === undefined
        || member[key] === snapshot[key], "UNIVERSE_MISMATCH");
    }
  }
  requireInput(new Set(snapshots.map(symbolKey)).size === symbols.length, "UNIVERSE_MISMATCH");
  const configuration = baseConfiguration.parse({
    ...config,
    clock,
    samplingPolicy,
    executionPolicy,
    riskPolicy: riskPolicySchema.parse({ ...profile.riskPolicy, ...config.riskPolicy }),
    allocationPolicy: config.allocationPolicy ?? profile.allocationPolicy,
    paperExitPolicy: normalizePaperExitPolicy(undefined)
  });
  return {
    ...input,
    implementationRevision: executionIdentity.implementationRevision,
    source: { ...input.source, snapshots },
    universe: { ...input.universe, symbols },
    configuration,
    costModel
  };
}

function assessSourceCoverage(input: EffectivePaperExperimentInput) {
  const { clock, maxSnapshotAgeSeconds, samplingPolicy } = input.configuration;
  // Arithmetic admission in normalizeInput has already bounded this allocation.
  const ticks = new SimulatedClock({
    startAt: new Date(clock.startAt), endAt: new Date(clock.endAt),
    stepSeconds: clock.stepSeconds, speedMultiplier: clock.speedMultiplier
  }).ticks();
  const index = new HistoricalMarketSnapshotIndex(input.source.snapshots);
  const coverage = ticks.map((tick) => {
    const fresh = index.latestFreshSnapshots({ simulatedAt: new Date(tick.epochMs), maxSnapshotAgeSeconds });
    // Admission rejects zero prices, so every fresh source remains usable downstream.
    const usable = fresh;
    const usableKeys = new Set(usable.map(symbolKey));
    const missing = input.universe.symbols.filter((member) => !usableKeys.has(symbolKey(member)))
      .map((member) => {
        const history = input.source.snapshots.filter((snapshot) => symbolKey(snapshot) === symbolKey(member));
        const latest = history.filter((snapshot) => Date.parse(snapshot.observedAt) <= tick.epochMs).at(-1);
        const reason = latest === undefined ? "future_only" as const : "stale" as const;
        return { market: member.market, symbol: member.symbol, reason };
      });
    return {
      simulatedAt: tick.simulatedAt,
      usableSnapshotIds: usable.map((snapshot) => snapshot.snapshotId).sort(compareText),
      missing
    };
  });
  const usableTickCount = coverage.filter((tick) => tick.usableSnapshotIds.length > 0).length;
  requireInput(usableTickCount > 0, "NO_USABLE_SOURCE");
  return {
    tickCount: ticks.length,
    decisionCallUpperBound: Math.min(ticks.length, samplingPolicy?.maxDecisionCalls ?? 0),
    snapshotCount: input.source.snapshots.length,
    symbolCount: input.universe.symbols.length,
    usableTickCount,
    missingSymbolTickCount: coverage.reduce((count, tick) => count + tick.missing.length, 0),
    status: coverage.some((tick) => tick.missing.length > 0) ? "insufficient_data" as const : "available_fixture" as const,
    ticks: coverage
  };
}

function requireInput(condition: boolean, code: PaperExperimentValidationCode): asserts condition {
  if (!condition) throw new PaperExperimentValidationError(code);
}

function symbolKey(value: { market: string; symbol: string }): string {
  return `${value.market}:${value.symbol}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
