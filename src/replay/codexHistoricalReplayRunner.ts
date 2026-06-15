import type {
  AuditEvent,
  HistoricalMarketSnapshot,
  MarketPacket,
  VirtualDecision,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import {
  HistoricalMarketPacketBuilder,
  HistoricalMarketSnapshotIndex
} from "../market/historicalPacketBuilder.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import { bindVirtualDecisionConfidenceBreakdown } from "../paper/decisionConfidence.js";
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
  createHistoricalReplayProgressEvent,
  type HistoricalReplayProgressEvent,
  type HistoricalReplayProgressUpdate,
  type HistoricalReplayTickPerformance
} from "./historicalReplayProgress.js";
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
      currentPortfolio,
      packets,
      decisions,
      riskDecisions,
      trades
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
      appendAuditEvent(
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
    appendAuditEvent(
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
      const recordedExitDecision = bindVirtualDecisionConfidenceBreakdown({
        decision: exitDecision,
        packet
      });

      decisions.push(recordedExitDecision);
      appendAuditEvent(
        auditEvents,
        "PAPER_EXIT_POLICY_RECORDED",
        `${recordedExitDecision.decisions.length} paper exit decision(s)`,
        tick
      );

      for (const item of recordedExitDecision.decisions) {
        const orderStartedAtMs = performanceClock();
        const result = engine.execute({
          packet,
          portfolio: currentPortfolio,
          decision: item,
          riskPolicy: riskPolicyForTick(options.riskPolicy, simulatedAt)
        });
        orderExecutionMs += performanceClock() - orderStartedAtMs;
        currentPortfolio = result.portfolio;
        prunePaperExitPolicyState(paperExitPolicyState, currentPortfolio);
        riskDecisions.push(result.riskDecision);
        appendAuditEvent(
          auditEvents,
          result.riskDecision.approved
            ? "VIRTUAL_RISK_APPROVED"
            : "VIRTUAL_RISK_REJECTED",
          `${item.market}:${item.symbol} ${item.action}`,
          tick
        );

        if (!result.riskDecision.approved) {
          rejectedCount += 1;
          await emitProgress(
            tick,
            simulatedAt,
            createHistoricalReplayProgressEvent({
              eventType: "RISK_REJECTED",
              sequence: riskDecisions.length,
              simulatedAt,
              tick,
              packetId: packet.packetId,
              market: item.market,
              symbol: item.symbol,
              action: item.action,
              approved: false,
              rejectCodes: result.riskDecision.rejectCodes,
              summary: `${item.market}:${item.symbol} ${item.action} rejected ${result.riskDecision.rejectCodes.join(",")}`
            })
          );
        }

        if (result.trade) {
          exitedSymbolKeys.add(decisionItemSymbolKey(item));
          trades.push(result.trade);
          appendAuditEvent(
            auditEvents,
            "PAPER_ORDER_FILLED",
            `${result.trade.market}:${result.trade.symbol} ${result.trade.action}`,
            tick
          );
          await emitProgress(
            tick,
            simulatedAt,
            createHistoricalReplayProgressEvent({
              eventType: result.trade.action,
              sequence: trades.length,
              simulatedAt,
              tick,
              packetId: packet.packetId,
              market: result.trade.market,
              symbol: result.trade.symbol,
              action: result.trade.action,
              approved: true,
              rejectCodes: [],
              amountKrw: result.trade.amountKrw,
              summary: `${result.trade.market}:${result.trade.symbol} ${result.trade.action} filled ${result.trade.amountKrw}`
            })
          );
        } else if (result.noOpReason !== undefined) {
          exitedSymbolKeys.add(decisionItemSymbolKey(item));
          appendAuditEvent(
            auditEvents,
            result.noOpReason,
            `${item.market}:${item.symbol} ${item.action}`,
            tick
          );
          await emitProgress(
            tick,
            simulatedAt,
            createHistoricalReplayProgressEvent({
              eventType: result.noOpReason,
              sequence: riskDecisions.length,
              simulatedAt,
              tick,
              packetId: packet.packetId,
              market: item.market,
              symbol: item.symbol,
              action: item.action,
              approved: true,
              rejectCodes: [],
              summary: `${item.market}:${item.symbol} ${item.action} ${result.noOpReason}`
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
      appendAuditEvent(
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
      appendAuditEvent(
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
      appendAuditEvent(
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
      appendAuditEvent(
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

    const recordedDecision = bindVirtualDecisionConfidenceBreakdown({
      decision: filteredDecision.decision,
      packet
    });

    decisions.push(recordedDecision);
    appendAuditEvent(
      auditEvents,
      "VIRTUAL_DECISION_RECORDED",
      `${recordedDecision.decisions.length} historical replay decision(s)`,
      tick
    );

    for (const item of recordedDecision.decisions) {
      const orderStartedAtMs = performanceClock();
      const result = engine.execute({
        packet,
        portfolio: currentPortfolio,
        decision: item,
        riskPolicy: riskPolicyForTick(options.riskPolicy, simulatedAt)
      });
      orderExecutionMs += performanceClock() - orderStartedAtMs;
      currentPortfolio = result.portfolio;
      prunePaperExitPolicyState(paperExitPolicyState, currentPortfolio);
      riskDecisions.push(result.riskDecision);
      appendAuditEvent(
        auditEvents,
        result.riskDecision.approved
          ? "VIRTUAL_RISK_APPROVED"
          : "VIRTUAL_RISK_REJECTED",
        `${item.market}:${item.symbol} ${item.action}`,
        tick
      );

      if (!result.riskDecision.approved) {
        rejectedCount += 1;
        await emitProgress(
          tick,
          simulatedAt,
          createHistoricalReplayProgressEvent({
            eventType: "RISK_REJECTED",
            sequence: riskDecisions.length,
            simulatedAt,
            tick,
            packetId: packet.packetId,
            market: item.market,
            symbol: item.symbol,
            action: item.action,
            approved: false,
            rejectCodes: result.riskDecision.rejectCodes,
            summary: `${item.market}:${item.symbol} ${item.action} rejected ${result.riskDecision.rejectCodes.join(",")}`
          })
        );
      }

      if (result.trade) {
        trades.push(result.trade);
        appendAuditEvent(
          auditEvents,
          "PAPER_ORDER_FILLED",
          `${result.trade.market}:${result.trade.symbol} ${result.trade.action}`,
          tick
        );
        await emitProgress(
          tick,
          simulatedAt,
          createHistoricalReplayProgressEvent({
            eventType: result.trade.action,
            sequence: trades.length,
            simulatedAt,
            tick,
            packetId: packet.packetId,
            market: result.trade.market,
            symbol: result.trade.symbol,
            action: result.trade.action,
            approved: true,
            rejectCodes: [],
            amountKrw: result.trade.amountKrw,
            summary: `${result.trade.market}:${result.trade.symbol} ${result.trade.action} filled ${result.trade.amountKrw}`
          })
        );
      } else if (result.noOpReason !== undefined) {
        appendAuditEvent(
          auditEvents,
          result.noOpReason,
          `${item.market}:${item.symbol} ${item.action}`,
          tick
        );
        await emitProgress(
          tick,
          simulatedAt,
          createHistoricalReplayProgressEvent({
            eventType: result.noOpReason,
            sequence: riskDecisions.length,
            simulatedAt,
            tick,
            packetId: packet.packetId,
            market: item.market,
            symbol: item.symbol,
            action: item.action,
            approved: true,
            rejectCodes: [],
            summary: `${item.market}:${item.symbol} ${item.action} ${result.noOpReason}`
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

function suppressDecisionItemsForSymbols(
  decision: VirtualDecision,
  symbolKeys: Set<string>
): { decision: VirtualDecision; suppressedCount: number } {
  if (symbolKeys.size === 0) {
    return { decision, suppressedCount: 0 };
  }

  const decisions = decision.decisions.filter(
    (item) => !symbolKeys.has(decisionItemSymbolKey(item))
  );
  return {
    decision: {
      ...decision,
      decisions,
      summary:
        decisions.length === decision.decisions.length
          ? decision.summary
          : `${decision.summary} Provider items for exited symbols were suppressed.`
    },
    suppressedCount: decision.decisions.length - decisions.length
  };
}

function decisionItemSymbolKey(
  item: Pick<VirtualDecisionItem, "market" | "symbol">
): string {
  return `${item.market}:${item.symbol}`;
}

function appendAuditEvent(
  events: AuditEvent[],
  eventType: string,
  summary: string,
  tick: SimulatedTick
): void {
  events.push(auditEvent(eventType, summary, tick, events.length));
}

function auditEvent(
  eventType: string,
  summary: string,
  tick: SimulatedTick,
  sequence: number
): AuditEvent {
  return {
    eventId: `audit_historical_${tick.stepIndex}_${sequence}_${eventType.toLowerCase()}`,
    eventType,
    actor: "system",
    summary,
    maskedRefs: [],
    createdAt: new Date(tick.epochMs).toISOString()
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
