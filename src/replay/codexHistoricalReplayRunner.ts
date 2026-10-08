import process from "node:process";
import { types } from "node:util";
import { PAPER_COST_MODEL_VERSION, PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { replayProcessObservationBindingSchema, replayProcessScalarObservationSchema,
  type ReplayProcessObservationBinding, type ReplayProcessObservationEvidence,
  type ReplayProcessScalarObservation } from "../domain/replayProcessObservation.js";
import type {
  AuditEvent,
  HistoricalMarketSnapshot,
  MarketPacket,
  StrategyBucket,
  VirtualDecision,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import {
  HistoricalMarketPacketBuilder,
  HistoricalMarketSnapshotIndex,
  type HistoricalUniverseLifecycleInput
} from "../market/historicalPacketBuilder.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import {
  buildPaperExitPolicyDecision,
  createPaperExitPolicyState,
  normalizePaperExitPolicy,
  prunePaperExitPolicyState,
  type PaperExitPolicy
} from "../paper/exitPolicy.js";
import type { PaperAllocationPolicy } from "../paper/allocationPolicy.js";
import {
  buildMarketRegimeAllocationPolicy,
  type MarketRegimeAllocationPolicy
} from "../paper/marketRegimeAllocationPolicy.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import type { PaperExecutionPolicy } from "../paper/executionModel.js";
import { summarizeCodexCliDecisionFailure } from "../ai/codexFailureSummary.js";
import {
  markPortfolioToMarket,
  pricePointsFromHistoricalSnapshots
} from "../portfolio/markToMarket.js";
import type { CodexCliDecisionResult } from "../ai/codexCliDecisionProvider.js";
import {
  fingerprintMarketPacketCandidates,
  type ReplaySamplingDecision,
  type ReplaySamplingPolicy
} from "./replaySamplingPolicy.js";
import { riskPolicyForReplayTick } from "./replayRiskPolicy.js";
import {
  type HistoricalReplayProgressEvent,
  type HistoricalReplayProgressUpdate,
  type HistoricalReplayTickPerformance
} from "./historicalReplayProgress.js";
import {
  appendHistoricalReplayAuditEvent,
  enforceProviderDecisionCandidateScope,
  executeHistoricalReplayDecisionItem,
  enforceProviderDecisionExecutionCaps,
  progressEventFromHistoricalReplayExecutionEffect,
  recordHistoricalReplayDecision,
  suppressDecisionItemsForSymbols
} from "./historicalReplayDecisionBoundary.js";
import type { HistoricalUniverseManifest } from "./historicalUniverseCoverage.js";
import { prepareReplaySourceSnapshot, type ReplaySourceSnapshotObservation } from "../domain/replaySourceSnapshot.js";
import { prepareReplaySettingsSnapshot, type ReplaySettingsSnapshotObservation } from "../domain/replaySettingsSnapshot.js";
import type { SimulatedClock, SimulatedTick } from "./simulatedClock.js";
import type {
  HistoricalPortfolioTimelineItem,
  HistoricalReplayDecisionContext,
  HistoricalReplayInput,
  HistoricalReplayResult,
  HistoricalReplaySamplingRecord
} from "./historicalReplayRunner.js";

export interface CodexHistoricalReplayDecisionProviderLike {
  decide(
    packet: MarketPacket,
    context: HistoricalReplayDecisionContext
  ): Promise<CodexCliDecisionResult>;
}

export interface CodexHistoricalReplayRunnerOptions {
  clock: SimulatedClock;
  decisionProvider: CodexHistoricalReplayDecisionProviderLike;
  samplingPolicy?: ReplaySamplingPolicy;
  packetIdPrefix: string;
  packetExpiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
  riskPolicy?: Partial<VirtualRiskPolicy>;
  executionPolicy?: Partial<PaperExecutionPolicy> | undefined;
  allocationPolicy?: PaperAllocationPolicy;
  marketRegimeAllocationPolicy?: MarketRegimeAllocationPolicy;
  paperExitPolicy?: PaperExitPolicy;
  universeManifest?: HistoricalUniverseManifest;
  candidateStrategyBucket?: StrategyBucket;
  performanceClock?: () => number;
  tickDelayMs?: number;
  tickDelay?: (ms: number) => Promise<void>;
  onSettings?: (settings: ReplaySettingsSnapshotObservation) => Promise<void> | void;
  onSourceSnapshots?: (source: ReplaySourceSnapshotObservation) => Promise<void> | void;
  onInitialPortfolio?: (portfolio: VirtualPortfolio) => Promise<void> | void;
  processObservationBinding?: ReplayProcessObservationBinding;
  onProcessObservation?: (context: ReplayProcessObservationContext) => Promise<void> | void;
  onProgress?: (
    update: HistoricalReplayProgressUpdate
  ) => Promise<void> | void;
}

type ReplayRunnerSettings = Pick<CodexHistoricalReplayRunnerOptions,
  "packetIdPrefix" | "packetExpiresInSeconds" | "maxCandidates" | "maxSnapshotAgeSeconds" | "constraints" |
  "riskPolicy" | "executionPolicy" | "allocationPolicy" | "marketRegimeAllocationPolicy" | "paperExitPolicy" |
  "candidateStrategyBucket" | "tickDelayMs"> & { universeManifest?: HistoricalUniverseLifecycleInput };

declare const processObservationBrand: unique symbol;
export interface ReplayProcessObservationContext { readonly [processObservationBrand]: true }
const processObservations = new WeakMap<object, ReplayProcessObservationEvidence>();

/** Membership is checked before any property access, including for proxies and revoked proxies. */
export function resolveReplayProcessObservationContext(context: unknown): ReplayProcessObservationEvidence {
  const evidence = context !== null && typeof context === "object" ? processObservations.get(context) : undefined;
  if (evidence === undefined) throw Error("process observation context unavailable");
  return evidence;
}

// No caller can issue from JSON or supply process scalar values. This function stays in the actual runner module.
function captureProcessObservation(options: CodexHistoricalReplayRunnerOptions): {
  context: ReplayProcessObservationContext; observe: NonNullable<CodexHistoricalReplayRunnerOptions["onProcessObservation"]>;
} | undefined {
  // Inspect only the two new selected fields; do not deep-inspect the root or opaque runtime dependencies.
  if (types.isProxy(options)) return undefined;
  const bindingDescriptor = Object.getOwnPropertyDescriptor(options, "processObservationBinding");
  const callbackDescriptor = Object.getOwnPropertyDescriptor(options, "onProcessObservation");
  if (bindingDescriptor === undefined && callbackDescriptor === undefined) return undefined;
  if (bindingDescriptor === undefined || callbackDescriptor === undefined ||
    !Object.hasOwn(bindingDescriptor, "value") || !Object.hasOwn(callbackDescriptor, "value") ||
    typeof callbackDescriptor.value !== "function") throw Error("process observation binding unavailable");
  const parsed = replayProcessObservationBindingSchema.safeParse(bindingDescriptor.value);
  if (!parsed.success) throw Error("process observation binding unavailable");
  const binding = parsed.data;
  Object.freeze(binding.identity);
  Object.freeze(binding);
  const values: Record<string, unknown> = {};
  for (const field of ["version", "platform", "arch"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(process, field);
    // Never execute accessors, coerce objects, or copy opaque values into the private evidence.
    if (descriptor !== undefined && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string") {
      values[field] = descriptor.value;
    }
  }
  const scalar = replayProcessScalarObservationSchema.safeParse({ status: "recorded",
    nodeVersion: values.version, platform: values.platform, architecture: values.arch,
    costModelVersion: PAPER_COST_MODEL_VERSION, executionModelVersion: PAPER_EXECUTION_MODEL_VERSION });
  const observation: ReplayProcessScalarObservation = scalar.success ? scalar.data
    : { status: "unavailable", reason: "unsupported_process_observation" };
  const context = Object.freeze(Object.create(null)) as ReplayProcessObservationContext;
  processObservations.set(context, Object.freeze({ binding, process: Object.freeze(observation) }));
  return { context, observe: callbackDescriptor.value as NonNullable<CodexHistoricalReplayRunnerOptions["onProcessObservation"]> };
}

export async function runCodexHistoricalReplay(
  options: CodexHistoricalReplayRunnerOptions,
  input: HistoricalReplayInput
): Promise<HistoricalReplayResult> {
  const processObservation = captureProcessObservation(options);
  // Only the bound observation path changes ownership; unsupported/legacy replay remains accepted as before.
  const capturedSettings = options.onSettings === undefined ? undefined : prepareReplaySettingsSnapshot(options);
  // The strict snapshot preflight excludes own undefined; no opaque runner field is copied here.
  const settings: ReplayRunnerSettings = capturedSettings?.status === "recorded"
    ? capturedSettings.snapshot : options;
  const source = options.onSourceSnapshots === undefined ? undefined : prepareReplaySourceSnapshot(input.snapshots);
  const snapshots = source?.status === "recorded" ? source.snapshot : input.snapshots;
  let currentPortfolio = structuredClone(input.initialPortfolio);
  const initialPortfolio = structuredClone(currentPortfolio);
  // Persist the initialized state before any tick/mark-to-market/provider work. Observers own a separate copy.
  await options.onInitialPortfolio?.(structuredClone(currentPortfolio));
  if (source !== undefined) {
    await options.onSourceSnapshots?.(structuredClone(source));
    if (source.status === "unavailable" && source.reason === "redacted") {
      throw Error("source input requires redaction");
    }
  }
  if (capturedSettings !== undefined) {
    await options.onSettings?.(structuredClone(capturedSettings));
    if (capturedSettings.status === "unavailable") {
      if (capturedSettings.reason === "redacted") throw Error("settings input requires redaction");
      if (capturedSettings.reason === "inspection_unavailable") throw Error("settings credential inspection unavailable");
    }
  }
  if (processObservation !== undefined) await processObservation.observe(processObservation.context);
  const packets: MarketPacket[] = [];
  const decisions: VirtualDecision[] = [];
  const riskDecisions: VirtualRiskDecision[] = [];
  const trades: VirtualTrade[] = [];
  const auditEvents: AuditEvent[] = [];
  const warnings: string[] = [];
  const samplingDecisions: HistoricalReplaySamplingRecord[] = [];
  const portfolioTimeline: HistoricalPortfolioTimelineItem[] = [];
  let decisionProviderCallCount = 0;
  let decisionSkippedCount = 0;
  let rejectedCount = 0;
  const engine = new PaperOrderEngine();
  const ticks = options.clock.ticks();
  const snapshotIndex = new HistoricalMarketSnapshotIndex(snapshots);
  const performanceClock = options.performanceClock ?? monotonicNowMs;
  const paperExitPolicy = normalizePaperExitPolicy(settings.paperExitPolicy);
  const paperExitPolicyState = createPaperExitPolicyState();
  appendExitPolicyWarnings(warnings, settings.riskPolicy, paperExitPolicy);
  appendMarketRegimeAllocationWarnings(warnings, settings);

  const emitProgress = async (
    tick: SimulatedTick,
    simulatedAt: Date,
    event?: HistoricalReplayProgressEvent,
    performance?: HistoricalReplayTickPerformance
  ): Promise<void> => {
    if (options.onProgress === undefined) {
      return;
    }

    const update: HistoricalReplayProgressUpdate = {
      simulatedAt,
      tick,
      tickCount: ticks.length,
      packetCount: packets.length,
      decisionProviderCallCount,
      decisionSkippedCount,
      decisionRecordCount: decisions.length,
      tradeCount: trades.length,
      riskDecisionCount: riskDecisions.length,
      riskApprovedCount: riskDecisions.length - rejectedCount,
      rejectedCount,
      currentPortfolio: clonePortfolio(currentPortfolio),
      packets: [...packets],
      decisions: [...decisions],
      riskDecisions: [...riskDecisions],
      trades: [...trades]
    };
    if (performance !== undefined) {
      update.performance = performance;
    }

    if (event === undefined) {
      await options.onProgress(update);
      return;
    }

    await options.onProgress({
      ...update,
      event
    });
  };

  for (const tick of ticks) {
    const tickStartedAtMs = performanceClock();
    let packetBuildMs = 0;
    let samplingMs = 0;
    let decisionProviderMs = 0;
    let orderExecutionMs = 0;
    const simulatedAt = new Date(tick.epochMs);
    const pricePoints = pricePointsFromHistoricalSnapshots(
      snapshotIndex.latestFreshSnapshots({
        simulatedAt,
        maxSnapshotAgeSeconds: settings.maxSnapshotAgeSeconds
      }),
      settings.maxSnapshotAgeSeconds
    );
    currentPortfolio = markPortfolioToMarket({
      portfolio: currentPortfolio,
      prices: pricePoints,
      asOf: simulatedAt
    });
    const allocationPolicy = allocationPolicyForTick({
      basePolicy: settings.allocationPolicy,
      marketRegimeAllocationPolicy: settings.marketRegimeAllocationPolicy,
      snapshots,
      simulatedAt,
      tick
    });
    const packetBuildStartedAtMs = performanceClock();
    const packetBuild = new HistoricalMarketPacketBuilder({
      packetId: `${settings.packetIdPrefix}_${tick.stepIndex}`,
      simulatedAt,
      expiresInSeconds: settings.packetExpiresInSeconds,
      maxCandidates: settings.maxCandidates,
      maxSnapshotAgeSeconds: settings.maxSnapshotAgeSeconds,
      constraints: settings.constraints,
      ...(allocationPolicy === undefined
        ? {}
        : { allocationPolicy }),
      ...(settings.universeManifest === undefined
        ? {}
        : { universeManifest: settings.universeManifest }),
      ...(settings.candidateStrategyBucket === undefined
        ? {}
        : { candidateStrategyBucket: settings.candidateStrategyBucket })
    }).build({
      portfolio: currentPortfolio,
      snapshotIndex
    });
    packetBuildMs = performanceClock() - packetBuildStartedAtMs;

    warnings.push(...packetBuild.warnings);

    if (packetBuild.status === "failed") {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_PACKET_SKIPPED",
        `No historical candidates at ${simulatedAt.toISOString()}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      await emitProgress(
        tick,
        simulatedAt,
        undefined,
        tickPerformance({
          performanceClock,
          tickStartedAtMs,
          packetBuildMs,
          samplingMs,
          decisionProviderMs,
          orderExecutionMs
        })
      );
      await waitForTickPacing(options, settings);
      continue;
    }

    const packet = packetBuild.packet;
    const context: HistoricalReplayDecisionContext = {
      simulatedAt,
      tick
    };
    packets.push(packet);
    appendHistoricalReplayAuditEvent(
      auditEvents,
      "HISTORICAL_MARKET_PACKET_CREATED",
      `${packet.packetId} candidates=${packet.candidates.length}`,
      tick
    );

    const exitedSymbolKeys = new Set<string>();
    const exitDecision = buildPaperExitPolicyDecision({
      packet,
      portfolio: currentPortfolio,
      policy: paperExitPolicy ?? undefined,
      state: paperExitPolicyState
    });
    if (exitDecision !== null) {
      const recordedExitDecision = recordHistoricalReplayDecision({
        packet,
        decision: exitDecision,
        source: "paper_exit_policy",
        decisions,
        auditEvents,
        tick
      });
      for (const item of recordedExitDecision.decisions) {
        const orderStartedAtMs = performanceClock();
        const execution = executeHistoricalReplayDecisionItem({
          packet,
          portfolio: currentPortfolio,
          decisionItem: item,
          engine,
          riskPolicy: riskPolicyForReplayTick({
            policy: settings.riskPolicy,
            now: simulatedAt,
            packet,
            snapshots,
            simulatedAt
          }),
          ...(settings.executionPolicy === undefined
            ? {}
            : { executionPolicy: settings.executionPolicy }),
          paperExitPolicyState,
          auditEvents,
          riskDecisions,
          trades,
          tick,
          exitSuppressionSymbolKeys: exitedSymbolKeys
        });
        orderExecutionMs += performanceClock() - orderStartedAtMs;
        currentPortfolio = execution.portfolio;
        rejectedCount += execution.rejectedCount;

        for (const effect of execution.effects) {
          currentPortfolio = effect.portfolio;
          await emitProgress(
            tick,
            simulatedAt,
            progressEventFromHistoricalReplayExecutionEffect({
              effect,
              simulatedAt,
              tick,
              packetId: packet.packetId
            })
          );
        }
      }
    }

    const samplingStartedAtMs = performanceClock();
    const samplingDecision = evaluateSamplingPolicy(
      options.samplingPolicy,
      packet,
      context,
      decisionProviderCallCount
    );
    samplingMs = performanceClock() - samplingStartedAtMs;
    samplingDecisions.push({
      simulatedAt: simulatedAt.toISOString(),
      packetId: packet.packetId,
      shouldEvaluate: samplingDecision.shouldEvaluate,
      reason: samplingDecision.reason,
      decisionCallsUsed: samplingDecision.decisionCallsUsed,
      candidateFingerprint: samplingDecision.candidateFingerprint
    });

    if (!samplingDecision.shouldEvaluate) {
      decisionSkippedCount += 1;
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_SKIPPED",
        `${packet.packetId} ${samplingDecision.reason}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      await emitProgress(
        tick,
        simulatedAt,
        undefined,
        tickPerformance({
          performanceClock,
          tickStartedAtMs,
          packetBuildMs,
          samplingMs,
          decisionProviderMs,
          orderExecutionMs
        })
      );
      await waitForTickPacing(options, settings);
      continue;
    }

    decisionProviderCallCount += 1;
    const decisionStartedAtMs = performanceClock();
    const decisionResult = await options.decisionProvider.decide(packet, context);
    decisionProviderMs = performanceClock() - decisionStartedAtMs;
    if (decisionResult.failure || !decisionResult.decision) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_AI_DECISION_FAILED",
        summarizeCodexCliDecisionFailure(decisionResult.failure),
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      await emitProgress(
        tick,
        simulatedAt,
        undefined,
        tickPerformance({
          performanceClock,
          tickStartedAtMs,
          packetBuildMs,
          samplingMs,
          decisionProviderMs,
          orderExecutionMs
        })
      );
      await waitForTickPacing(options, settings);
      continue;
    }

    if (decisionResult.decision.packetId !== packet.packetId) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_REJECTED",
        `Decision packet mismatch for ${packet.packetId}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      await emitProgress(
        tick,
        simulatedAt,
        undefined,
        tickPerformance({
          performanceClock,
          tickStartedAtMs,
          packetBuildMs,
          samplingMs,
          decisionProviderMs,
          orderExecutionMs
        })
      );
      await waitForTickPacing(options, settings);
      continue;
    }

    const filteredDecision = suppressDecisionItemsForSymbols(
      decisionResult.decision,
      exitedSymbolKeys
    );
    if (filteredDecision.suppressedCount > 0) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_ITEM_SUPPRESSED",
        `${filteredDecision.suppressedCount} provider decision item(s) suppressed after paper exit`,
        tick
      );
    }
    const eligibleDecision = enforceProviderDecisionCandidateScope({
      packet,
      decision: filteredDecision.decision
    });
    if (eligibleDecision.rejectedItemCount > 0) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_REJECTED",
        `${eligibleDecision.rejectedItemCount} provider decision item(s) rejected: VIRTUAL_DECISION_ACTION_NOT_ELIGIBLE`,
        tick
      );
    }
    if (
      eligibleDecision.decision.decisions.length === 0 &&
      decisionResult.decision.decisions.length > 0
    ) {
      currentPortfolio = markPortfolioToMarket({
        portfolio: currentPortfolio,
        prices: pricePoints,
        asOf: simulatedAt
      });
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      await emitProgress(
        tick,
        simulatedAt,
        undefined,
        tickPerformance({
          performanceClock,
          tickStartedAtMs,
          packetBuildMs,
          samplingMs,
          decisionProviderMs,
          orderExecutionMs
        })
      );
      await waitForTickPacing(options, settings);
      continue;
    }

    const cappedDecision = enforceProviderDecisionExecutionCaps({
      packet,
      portfolio: currentPortfolio,
      decision: eligibleDecision.decision
    });
    if (
      cappedDecision.cappedItemCount > 0 ||
      cappedDecision.heldItemCount > 0
    ) {
      appendHistoricalReplayAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_ALLOCATION_CAPPED",
        `${cappedDecision.cappedItemCount} BUY item(s) capped, ${cappedDecision.heldItemCount} BUY item(s) converted to HOLD`,
        tick
      );
    }

    const recordedDecision = recordHistoricalReplayDecision({
      packet,
      decision: cappedDecision.decision,
      source: "provider",
      decisions,
      auditEvents,
      tick
    });
    for (const item of recordedDecision.decisions) {
      const orderStartedAtMs = performanceClock();
      const execution = executeHistoricalReplayDecisionItem({
        packet,
        portfolio: currentPortfolio,
        decisionItem: item,
        engine,
        riskPolicy: riskPolicyForReplayTick({
          policy: settings.riskPolicy,
          now: simulatedAt,
          packet,
          snapshots,
          simulatedAt
        }),
        ...(settings.executionPolicy === undefined
          ? {}
          : { executionPolicy: settings.executionPolicy }),
        paperExitPolicyState,
        auditEvents,
        riskDecisions,
        trades,
        tick
      });
      orderExecutionMs += performanceClock() - orderStartedAtMs;
      currentPortfolio = execution.portfolio;
      rejectedCount += execution.rejectedCount;

      for (const effect of execution.effects) {
        currentPortfolio = effect.portfolio;
        await emitProgress(
          tick,
          simulatedAt,
          progressEventFromHistoricalReplayExecutionEffect({
            effect,
            simulatedAt,
            tick,
            packetId: packet.packetId
          })
        );
      }
    }

    currentPortfolio = markPortfolioToMarket({
      portfolio: currentPortfolio,
      prices: pricePoints,
      asOf: simulatedAt
    });
    prunePaperExitPolicyState(paperExitPolicyState, currentPortfolio);
    portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
    await emitProgress(
      tick,
      simulatedAt,
      undefined,
      tickPerformance({
        performanceClock,
        tickStartedAtMs,
        packetBuildMs,
        samplingMs,
        decisionProviderMs,
        orderExecutionMs
      })
    );
    await waitForTickPacing(options, settings);
  }

  return {
    status: "completed",
    mode: "paper_only",
    tickCount: ticks.length,
    packetCount: packets.length,
    decisionProviderCallCount,
    decisionSkippedCount,
    decisionRecordCount: decisions.length,
    decisionItemCount: decisions.reduce(
      (sum, decision) => sum + decision.decisions.length,
      0
    ),
    tradeCount: trades.length,
    rejectedCount,
    packets,
    decisions,
    riskDecisions,
    trades,
    auditEvents,
    warnings,
    samplingPolicy: options.samplingPolicy?.metadata() ?? null,
    allocationPolicy: capturedSettings?.status === "recorded"
      ? structuredClone(settings.allocationPolicy ?? null) : settings.allocationPolicy ?? null,
    paperExitPolicy,
    samplingDecisions,
    progressSummary: {
      totalTicks: ticks.length,
      packetsCreated: packets.length,
      decisionsRequested: decisionProviderCallCount,
      decisionsSkipped: decisionSkippedCount,
      tradesCreated: trades.length,
      maxCandidatesPerStep: settings.maxCandidates
    },
    initialPortfolio,
    finalPortfolio: currentPortfolio,
    portfolioTimeline
  };
}

async function waitForTickPacing(
  options: Pick<CodexHistoricalReplayRunnerOptions, "tickDelay">,
  settings: Pick<CodexHistoricalReplayRunnerOptions, "tickDelayMs">
): Promise<void> {
  const delayMs = settings.tickDelayMs ?? 0;
  if (delayMs <= 0) {
    return;
  }
  await (options.tickDelay ?? sleep)(delayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function allocationPolicyForTick(input: {
  basePolicy: PaperAllocationPolicy | undefined;
  marketRegimeAllocationPolicy: MarketRegimeAllocationPolicy | undefined;
  snapshots: HistoricalMarketSnapshot[];
  simulatedAt: Date;
  tick: SimulatedTick;
}): PaperAllocationPolicy | undefined {
  if (input.basePolicy === undefined) {
    return undefined;
  }
  if (input.marketRegimeAllocationPolicy === undefined) {
    return allocationPolicyWithRampDayIndex(input.basePolicy, input.tick);
  }

  return allocationPolicyWithRampDayIndex(buildMarketRegimeAllocationPolicy({
    basePolicy: input.basePolicy,
    snapshots: input.snapshots,
    simulatedAt: input.simulatedAt,
    policy: input.marketRegimeAllocationPolicy
  }).allocationPolicy, input.tick);
}

function allocationPolicyWithRampDayIndex(
  policy: PaperAllocationPolicy,
  tick: SimulatedTick
): PaperAllocationPolicy {
  if (
    policy.deploymentRampDays === undefined ||
    policy.rampDayIndex !== undefined
  ) {
    return policy;
  }

  return {
    ...policy,
    rampDayIndex: tick.stepIndex + 1
  };
}

function appendExitPolicyWarnings(
  warnings: string[],
  riskPolicy: Partial<VirtualRiskPolicy> | undefined,
  paperExitPolicy: ReturnType<typeof normalizePaperExitPolicy>
): void {
  const riskMaxPositionWeightRatio = riskPolicy?.maxPositionWeightRatio;
  const rebalanceMaxPositionWeightRatio =
    paperExitPolicy?.rebalanceMaxPositionWeightRatio;
  if (
    riskMaxPositionWeightRatio !== undefined &&
    rebalanceMaxPositionWeightRatio !== undefined &&
    rebalanceMaxPositionWeightRatio < riskMaxPositionWeightRatio
  ) {
    warnings.push(
      `paper exit rebalanceMaxPositionWeightRatio (${rebalanceMaxPositionWeightRatio}) is below risk maxPositionWeightRatio (${riskMaxPositionWeightRatio})`
    );
  }
}

function appendMarketRegimeAllocationWarnings(
  warnings: string[],
  options: Pick<
    CodexHistoricalReplayRunnerOptions,
    "allocationPolicy" | "marketRegimeAllocationPolicy"
  >
): void {
  if (
    options.marketRegimeAllocationPolicy !== undefined &&
    options.allocationPolicy === undefined
  ) {
    warnings.push(
      "market regime allocation policy ignored: allocationPolicy is not configured"
    );
  }
}

function evaluateSamplingPolicy(
  samplingPolicy: ReplaySamplingPolicy | undefined,
  packet: MarketPacket,
  context: HistoricalReplayDecisionContext,
  currentDecisionProviderCallCount: number
): ReplaySamplingDecision {
  if (samplingPolicy !== undefined) {
    return samplingPolicy.evaluate(packet, context);
  }

  return {
    shouldEvaluate: true,
    reason: "POLICY_ALLOWED",
    decisionCallsUsed: currentDecisionProviderCallCount + 1,
    candidateFingerprint: fingerprintMarketPacketCandidates(packet)
  };
}

function timelineItem(
  simulatedAt: Date,
  portfolio: VirtualPortfolio
): HistoricalPortfolioTimelineItem {
  const positionMarketValueKrw = portfolio.positions.reduce(
    (sum, position) =>
      sum +
      (position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)),
    0
  );

  return {
    simulatedAt: simulatedAt.toISOString(),
    cashKrw: portfolio.cashKrw,
    positionCount: portfolio.positions.length,
    positionMarketValueKrw,
    virtualNetWorthKrw: portfolio.cashKrw + positionMarketValueKrw
  };
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}

function tickPerformance(input: {
  performanceClock: () => number;
  tickStartedAtMs: number;
  packetBuildMs: number;
  samplingMs: number;
  decisionProviderMs: number;
  orderExecutionMs: number;
}): HistoricalReplayTickPerformance {
  return {
    tickElapsedMs: input.performanceClock() - input.tickStartedAtMs,
    packetBuildMs: input.packetBuildMs,
    samplingMs: input.samplingMs,
    decisionProviderMs: input.decisionProviderMs,
    orderExecutionMs: input.orderExecutionMs
  };
}

function monotonicNowMs(): number {
  return globalThis.performance.now();
}
