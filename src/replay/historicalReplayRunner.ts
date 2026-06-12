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
import { PaperOrderEngine } from "../paper/orderEngine.js";
import {
  markPortfolioToMarket,
  pricePointsFromHistoricalSnapshots
} from "../portfolio/markToMarket.js";
import {
  fingerprintMarketPacketCandidates,
  type ReplaySamplingDecision,
  type ReplaySamplingPolicy,
  type ReplaySamplingPolicyMetadata
} from "./replaySamplingPolicy.js";
import type { SimulatedClock, SimulatedTick } from "./simulatedClock.js";

export interface HistoricalReplayDecisionContext {
  simulatedAt: Date;
  tick: SimulatedTick;
}

export interface HistoricalReplayDecisionProvider {
  decide(
    packet: MarketPacket,
    context: HistoricalReplayDecisionContext
  ): VirtualDecision;
}

export interface HistoricalReplayRunnerOptions {
  clock: SimulatedClock;
  decisionProvider: HistoricalReplayDecisionProvider;
  samplingPolicy?: ReplaySamplingPolicy;
  packetIdPrefix: string;
  packetExpiresInSeconds: number;
  maxCandidates: number;
  maxSnapshotAgeSeconds: number;
  constraints: MarketPacketConstraints;
}

export interface HistoricalReplayInput {
  initialPortfolio: VirtualPortfolio;
  snapshots: HistoricalMarketSnapshot[];
}

export interface HistoricalPortfolioTimelineItem {
  simulatedAt: string;
  cashKrw: number;
  positionCount: number;
  positionMarketValueKrw: number;
  virtualNetWorthKrw: number;
}

export interface HistoricalReplaySamplingRecord {
  simulatedAt: string;
  packetId: string;
  shouldEvaluate: boolean;
  reason: ReplaySamplingDecision["reason"];
  decisionCallsUsed: number;
  candidateFingerprint: string;
}

export interface HistoricalReplayProgressSummary {
  totalTicks: number;
  packetsCreated: number;
  decisionsRequested: number;
  decisionsSkipped: number;
  tradesCreated: number;
  maxCandidatesPerStep: number;
}

export interface HistoricalReplayResult {
  status: "completed";
  mode: "paper_only";
  tickCount: number;
  packetCount: number;
  decisionProviderCallCount: number;
  decisionSkippedCount: number;
  decisionRecordCount: number;
  decisionItemCount: number;
  tradeCount: number;
  rejectedCount: number;
  packets: MarketPacket[];
  decisions: VirtualDecision[];
  riskDecisions: VirtualRiskDecision[];
  trades: VirtualTrade[];
  auditEvents: AuditEvent[];
  warnings: string[];
  samplingPolicy: ReplaySamplingPolicyMetadata | null;
  samplingDecisions: HistoricalReplaySamplingRecord[];
  progressSummary: HistoricalReplayProgressSummary;
  initialPortfolio: VirtualPortfolio;
  finalPortfolio: VirtualPortfolio;
  portfolioTimeline: HistoricalPortfolioTimelineItem[];
}

export class FirstPricedHistoricalDecisionProvider
  implements HistoricalReplayDecisionProvider
{
  decide(packet: MarketPacket): VirtualDecision {
    const candidate = packet.candidates.find(
      (item) => item.lastPriceKrw !== undefined
    );
    const dataRef =
      candidate === undefined
        ? null
        : candidate.sourceRefs[0] ?? `packet:${packet.packetId}`;
    const decisions: VirtualDecisionItem[] =
      candidate === undefined
        ? []
        : [
            {
              market: candidate.market,
              symbol: candidate.symbol,
              action: "VIRTUAL_BUY",
              confidence: 0.55,
              budgetKrw: Math.min(
                packet.constraints.maxBudgetPerSymbolKrw,
                candidate.lastPriceKrw ?? packet.constraints.maxBudgetPerSymbolKrw
              ),
              thesis:
                "Deterministic historical replay fixture uses the first priced candidate.",
              riskFactors: [
                "Historical replay fixture is not a live trading signal."
              ],
              dataRefs: [dataRef ?? `packet:${packet.packetId}`],
              claimSupport: [
                {
                  claim:
                    "Deterministic historical replay fixture uses the first priced candidate.",
                  dataRefs: [dataRef ?? `packet:${packet.packetId}`]
                }
              ],
              expiresAt: packet.expiresAt
            }
          ];

    return {
      packetId: packet.packetId,
      summary: "Deterministic paper-only historical replay decision.",
      decisions
    };
  }
}

export function runHistoricalReplay(
  options: HistoricalReplayRunnerOptions,
  input: HistoricalReplayInput
): HistoricalReplayResult {
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
  const engine = new PaperOrderEngine();
  const ticks = options.clock.ticks();
  const snapshotIndex = new HistoricalMarketSnapshotIndex(input.snapshots);

  for (const tick of ticks) {
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
    const packetBuild = new HistoricalMarketPacketBuilder({
      packetId: `${options.packetIdPrefix}_${tick.stepIndex}`,
      simulatedAt,
      expiresInSeconds: options.packetExpiresInSeconds,
      maxCandidates: options.maxCandidates,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
      constraints: options.constraints
    }).build({
      portfolio: currentPortfolio,
      snapshotIndex
    });

    warnings.push(...packetBuild.warnings);

    if (packetBuild.status === "failed") {
      appendAuditEvent(
        auditEvents,
        "HISTORICAL_PACKET_SKIPPED",
        `No historical candidates at ${simulatedAt.toISOString()}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
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

    const samplingDecision = evaluateSamplingPolicy(
      options.samplingPolicy,
      packet,
      context,
      decisionProviderCallCount
    );
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
      continue;
    }

    decisionProviderCallCount += 1;
    const decision = options.decisionProvider.decide(packet, context);
    if (decision.packetId !== packet.packetId) {
      appendAuditEvent(
        auditEvents,
        "HISTORICAL_DECISION_REJECTED",
        `Decision packet mismatch for ${packet.packetId}`,
        tick
      );
      portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
      continue;
    }

    const recordedDecision = bindVirtualDecisionConfidenceBreakdown({
      decision,
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
      const result = engine.execute({
        packet,
        portfolio: currentPortfolio,
        decision: item,
        riskPolicy: { now: simulatedAt }
      });
      currentPortfolio = result.portfolio;
      riskDecisions.push(result.riskDecision);
      appendAuditEvent(
        auditEvents,
        result.riskDecision.approved
          ? "VIRTUAL_RISK_APPROVED"
          : "VIRTUAL_RISK_REJECTED",
        `${item.market}:${item.symbol} ${item.action}`,
        tick
      );

      if (result.trade) {
        trades.push(result.trade);
        appendAuditEvent(
          auditEvents,
          "PAPER_ORDER_FILLED",
          `${result.trade.market}:${result.trade.symbol} ${result.trade.action}`,
          tick
        );
      }
    }

    currentPortfolio = markPortfolioToMarket({
      portfolio: currentPortfolio,
      prices: pricePoints,
      asOf: simulatedAt
    });
    portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
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
    rejectedCount: riskDecisions.filter((decision) => !decision.approved).length,
    packets,
    decisions,
    riskDecisions,
    trades,
    auditEvents,
    warnings,
    samplingPolicy: options.samplingPolicy?.metadata() ?? null,
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
