import type {
  AuditEvent,
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import {
  HistoricalMarketPacketBuilder,
  HistoricalMarketSnapshotIndex
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
import {
  type HistoricalReplayProgressEvent,
  type HistoricalReplayProgressUpdate,
  type HistoricalReplayTickPerformance
} from "./historicalReplayProgress.js";
import {
  appendHistoricalReplayAuditEvent,
  executeHistoricalReplayDecisionItem,
  progressEventFromHistoricalReplayExecutionEffect,
  recordHistoricalReplayDecision,
  suppressDecisionItemsForSymbols
} from "./historicalReplayDecisionBoundary.js";
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
  allocationPolicy?: PaperAllocationPolicy;
  marketRegimeAllocationPolicy?: MarketRegimeAllocationPolicy;
  paperExitPolicy?: PaperExitPolicy;
  performanceClock?: () => number;
  onProgress?: (
    update: HistoricalReplayProgressUpdate
  ) => Promise<void> | void;
}

export async function runCodexHistoricalReplay(
  options: CodexHistoricalReplayRunnerOptions,
  input: HistoricalReplayInput
): Promise<HistoricalReplayResult> {
  let currentPortfolio = clonePortfolio(input.initialPortfolio);
  const initialPortfolio = clonePortfolio(currentPortfolio);
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
  const snapshotIndex = new HistoricalMarketSnapshotIndex(input.snapshots);
  const performanceClock = options.performanceClock ?? monotonicNowMs;
  const paperExitPolicy = normalizePaperExitPolicy(options.paperExitPolicy);
  const paperExitPolicyState = createPaperExitPolicyState();
  appendExitPolicyWarnings(warnings, options.riskPolicy, paperExitPolicy);
  appendMarketRegimeAllocationWarnings(warnings, options);

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
        maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds
      }),
      options.maxSnapshotAgeSeconds
    );
    currentPortfolio = markPortfolioToMarket({
      portfolio: currentPortfolio,
      prices: pricePoints,
      asOf: simulatedAt
    });
    const allocationPolicy = allocationPolicyForTick({
      basePolicy: options.allocationPolicy,
      marketRegimeAllocationPolicy: options.marketRegimeAllocationPolicy,
      snapshots: input.snapshots,
      simulatedAt
    });
    const packetBuildStartedAtMs = performanceClock();
    const packetBuild = new HistoricalMarketPacketBuilder({
      packetId: `${options.packetIdPrefix}_${tick.stepIndex}`,
      simulatedAt,
      expiresInSeconds: options.packetExpiresInSeconds,
      maxCandidates: options.maxCandidates,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
      constraints: options.constraints,
      ...(allocationPolicy === undefined
        ? {}
        : { allocationPolicy })
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
          riskPolicy: riskPolicyForTick(options.riskPolicy, simulatedAt),
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
    if (
      filteredDecision.decision.decisions.length === 0 &&
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
      continue;
    }

    const recordedDecision = recordHistoricalReplayDecision({
      packet,
      decision: filteredDecision.decision,
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
        riskPolicy: riskPolicyForTick(options.riskPolicy, simulatedAt),
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
    allocationPolicy: options.allocationPolicy ?? null,
    paperExitPolicy,
    samplingDecisions,
    progressSummary: {
      totalTicks: ticks.length,
      packetsCreated: packets.length,
      decisionsRequested: decisionProviderCallCount,
      decisionsSkipped: decisionSkippedCount,
      tradesCreated: trades.length,
      maxCandidatesPerStep: options.maxCandidates
    },
    initialPortfolio,
    finalPortfolio: currentPortfolio,
    portfolioTimeline
  };
}

function riskPolicyForTick(
  policy: Partial<VirtualRiskPolicy> | undefined,
  now: Date
): Partial<VirtualRiskPolicy> {
  return {
    ...(policy ?? {}),
    now
  };
}

function allocationPolicyForTick(input: {
  basePolicy: PaperAllocationPolicy | undefined;
  marketRegimeAllocationPolicy: MarketRegimeAllocationPolicy | undefined;
  snapshots: HistoricalMarketSnapshot[];
  simulatedAt: Date;
}): PaperAllocationPolicy | undefined {
  if (input.basePolicy === undefined) {
    return undefined;
  }
  if (input.marketRegimeAllocationPolicy === undefined) {
    return input.basePolicy;
  }

  return buildMarketRegimeAllocationPolicy({
    basePolicy: input.basePolicy,
    snapshots: input.snapshots,
    simulatedAt: input.simulatedAt,
    policy: input.marketRegimeAllocationPolicy
  }).allocationPolicy;
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
