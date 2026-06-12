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
import { HistoricalMarketPacketBuilder } from "../market/historicalPacketBuilder.js";
import type { MarketPacketConstraints } from "../market/packetBuilder.js";
import { PaperOrderEngine } from "../paper/orderEngine.js";
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

export interface HistoricalReplayResult {
  status: "completed";
  mode: "paper_only";
  tickCount: number;
  packetCount: number;
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
              dataRefs: [candidate.sourceRefs[0] ?? `packet:${packet.packetId}`],
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
  const portfolioTimeline: HistoricalPortfolioTimelineItem[] = [];
  const engine = new PaperOrderEngine();
  const ticks = options.clock.ticks();

  for (const tick of ticks) {
    const simulatedAt = new Date(tick.epochMs);
    const packetBuild = new HistoricalMarketPacketBuilder({
      packetId: `${options.packetIdPrefix}_${tick.stepIndex}`,
      simulatedAt,
      expiresInSeconds: options.packetExpiresInSeconds,
      maxCandidates: options.maxCandidates,
      maxSnapshotAgeSeconds: options.maxSnapshotAgeSeconds,
      constraints: options.constraints
    }).build({
      portfolio: currentPortfolio,
      snapshots: input.snapshots
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
    packets.push(packet);
    appendAuditEvent(
      auditEvents,
      "HISTORICAL_MARKET_PACKET_CREATED",
      `${packet.packetId} candidates=${packet.candidates.length}`,
      tick
    );

    const decision = options.decisionProvider.decide(packet, {
      simulatedAt,
      tick
    });
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

    decisions.push(decision);
    appendAuditEvent(
      auditEvents,
      "VIRTUAL_DECISION_RECORDED",
      `${decision.decisions.length} historical replay decision(s)`,
      tick
    );

    for (const item of decision.decisions) {
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

    portfolioTimeline.push(timelineItem(simulatedAt, currentPortfolio));
  }

  return {
    status: "completed",
    mode: "paper_only",
    tickCount: ticks.length,
    packetCount: packets.length,
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
    initialPortfolio,
    finalPortfolio: currentPortfolio,
    portfolioTimeline
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
