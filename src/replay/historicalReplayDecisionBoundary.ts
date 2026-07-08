import type {
  AuditEvent,
  MarketPacket,
  VirtualDecision,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import { bindVirtualDecisionConfidenceBreakdown } from "../paper/decisionConfidence.js";
import type {
  PaperOrderEngine,
  PaperOrderResult
} from "../paper/orderEngine.js";
import type { PaperExecutionPolicy } from "../paper/executionModel.js";
import {
  prunePaperExitPolicyState,
  type PaperExitPolicyState
} from "../paper/exitPolicy.js";
import type { VirtualRiskPolicy } from "../paper/riskEngine.js";
import {
  createHistoricalReplayProgressEvent,
  type HistoricalReplayProgressEvent
} from "./historicalReplayProgress.js";
import type { SimulatedTick } from "./simulatedClock.js";

export type HistoricalReplayDecisionSource = "paper_exit_policy" | "provider";

export interface HistoricalReplayDecisionRecordInput {
  packet: MarketPacket;
  decision: VirtualDecision;
  source: HistoricalReplayDecisionSource;
  decisions: VirtualDecision[];
  auditEvents: AuditEvent[];
  tick: SimulatedTick;
}

export interface HistoricalReplayDecisionExecutionInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  recordedDecision: VirtualDecision;
  engine: PaperOrderEngine;
  riskPolicy: Partial<VirtualRiskPolicy>;
  executionPolicy?: Partial<PaperExecutionPolicy> | undefined;
  paperExitPolicyState: PaperExitPolicyState;
  auditEvents: AuditEvent[];
  riskDecisions: VirtualRiskDecision[];
  trades: VirtualTrade[];
  tick: SimulatedTick;
  exitSuppressionSymbolKeys?: Set<string>;
}

export interface HistoricalReplayDecisionItemExecutionInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decisionItem: VirtualDecisionItem;
  engine: PaperOrderEngine;
  riskPolicy: Partial<VirtualRiskPolicy>;
  executionPolicy?: Partial<PaperExecutionPolicy> | undefined;
  paperExitPolicyState: PaperExitPolicyState;
  auditEvents: AuditEvent[];
  riskDecisions: VirtualRiskDecision[];
  trades: VirtualTrade[];
  tick: SimulatedTick;
  exitSuppressionSymbolKeys?: Set<string>;
}

export type HistoricalReplayDecisionExecutionEffect =
  | {
      type: "risk_rejected";
      item: VirtualDecisionItem;
      riskDecision: VirtualRiskDecision;
      sequence: number;
      portfolio: VirtualPortfolio;
    }
  | {
      type: "trade_filled";
      item: VirtualDecisionItem;
      trade: VirtualTrade;
      sequence: number;
      portfolio: VirtualPortfolio;
    }
  | {
      type: "no_op";
      item: VirtualDecisionItem;
      noOpReason: NonNullable<PaperOrderResult["noOpReason"]>;
      sequence: number;
      portfolio: VirtualPortfolio;
    };

export interface HistoricalReplayDecisionExecutionResult {
  portfolio: VirtualPortfolio;
  rejectedCount: number;
  effects: HistoricalReplayDecisionExecutionEffect[];
}

export interface ProviderDecisionExecutionCapResult {
  decision: VirtualDecision;
  cappedItemCount: number;
  heldItemCount: number;
}

export function recordHistoricalReplayDecision(
  input: HistoricalReplayDecisionRecordInput
): VirtualDecision {
  const recordedDecision = bindVirtualDecisionConfidenceBreakdown({
    decision: input.decision,
    packet: input.packet
  });
  input.decisions.push(recordedDecision);
  appendHistoricalReplayAuditEvent(
    input.auditEvents,
    input.source === "paper_exit_policy"
      ? "PAPER_EXIT_POLICY_RECORDED"
      : "VIRTUAL_DECISION_RECORDED",
    input.source === "paper_exit_policy"
      ? `${recordedDecision.decisions.length} paper exit decision(s)`
      : `${recordedDecision.decisions.length} historical replay decision(s)`,
    input.tick
  );
  return recordedDecision;
}

export function executeHistoricalReplayDecisionItems(
  input: HistoricalReplayDecisionExecutionInput
): HistoricalReplayDecisionExecutionResult {
  let currentPortfolio = input.portfolio;
  let rejectedCount = 0;
  const effects: HistoricalReplayDecisionExecutionEffect[] = [];

  for (const item of input.recordedDecision.decisions) {
    const itemExecution = executeHistoricalReplayDecisionItem({
      packet: input.packet,
      portfolio: currentPortfolio,
      decisionItem: item,
      engine: input.engine,
      riskPolicy: input.riskPolicy,
      ...(input.executionPolicy === undefined
        ? {}
        : { executionPolicy: input.executionPolicy }),
      paperExitPolicyState: input.paperExitPolicyState,
      auditEvents: input.auditEvents,
      riskDecisions: input.riskDecisions,
      trades: input.trades,
      tick: input.tick,
      ...(input.exitSuppressionSymbolKeys === undefined
        ? {}
        : { exitSuppressionSymbolKeys: input.exitSuppressionSymbolKeys })
    });
    currentPortfolio = itemExecution.portfolio;
    rejectedCount += itemExecution.rejectedCount;
    effects.push(...itemExecution.effects);
  }

  return {
    portfolio: currentPortfolio,
    rejectedCount,
    effects
  };
}

export function executeHistoricalReplayDecisionItem(
  input: HistoricalReplayDecisionItemExecutionInput
): HistoricalReplayDecisionExecutionResult {
  const item = input.decisionItem;
  const effects: HistoricalReplayDecisionExecutionEffect[] = [];
  let rejectedCount = 0;
  const result = input.engine.execute({
    packet: input.packet,
    portfolio: input.portfolio,
    decision: item,
    riskPolicy: input.riskPolicy,
    ...(input.executionPolicy === undefined
      ? {}
      : { executionPolicy: input.executionPolicy })
  });
  const currentPortfolio = result.portfolio;
  prunePaperExitPolicyState(input.paperExitPolicyState, currentPortfolio);
  input.riskDecisions.push(result.riskDecision);
  appendHistoricalReplayAuditEvent(
    input.auditEvents,
    result.riskDecision.approved
      ? "VIRTUAL_RISK_APPROVED"
      : "VIRTUAL_RISK_REJECTED",
    `${item.market}:${item.symbol} ${item.action}`,
    input.tick
  );

  if (!result.riskDecision.approved) {
    rejectedCount += 1;
    effects.push({
      type: "risk_rejected",
      item,
      riskDecision: result.riskDecision,
      sequence: input.riskDecisions.length,
      portfolio: currentPortfolio
    });
  }

  if (result.trade) {
    input.exitSuppressionSymbolKeys?.add(decisionItemSymbolKey(item));
    input.trades.push(result.trade);
    appendHistoricalReplayAuditEvent(
      input.auditEvents,
      "PAPER_ORDER_FILLED",
      `${result.trade.market}:${result.trade.symbol} ${result.trade.action}`,
      input.tick
    );
    effects.push({
      type: "trade_filled",
      item,
      trade: result.trade,
      sequence: input.trades.length,
      portfolio: currentPortfolio
    });
  } else if (result.noOpReason !== undefined) {
    input.exitSuppressionSymbolKeys?.add(decisionItemSymbolKey(item));
    appendHistoricalReplayAuditEvent(
      input.auditEvents,
      result.noOpReason,
      `${item.market}:${item.symbol} ${item.action}`,
      input.tick
    );
    effects.push({
      type: "no_op",
      item,
      noOpReason: result.noOpReason,
      sequence: input.riskDecisions.length,
      portfolio: currentPortfolio
    });
  }

  return {
    portfolio: currentPortfolio,
    rejectedCount,
    effects
  };
}

export function progressEventFromHistoricalReplayExecutionEffect(input: {
  effect: HistoricalReplayDecisionExecutionEffect;
  simulatedAt: Date;
  tick: SimulatedTick;
  packetId: string;
}): HistoricalReplayProgressEvent {
  if (input.effect.type === "risk_rejected") {
    return createHistoricalReplayProgressEvent({
      eventType: "RISK_REJECTED",
      sequence: input.effect.sequence,
      simulatedAt: input.simulatedAt,
      tick: input.tick,
      packetId: input.packetId,
      market: input.effect.item.market,
      symbol: input.effect.item.symbol,
      action: input.effect.item.action,
      approved: false,
      rejectCodes: input.effect.riskDecision.rejectCodes,
      summary: `${input.effect.item.market}:${input.effect.item.symbol} ${input.effect.item.action} rejected ${input.effect.riskDecision.rejectCodes.join(",")}`
    });
  }

  if (input.effect.type === "trade_filled") {
    return createHistoricalReplayProgressEvent({
      eventType: input.effect.trade.action,
      sequence: input.effect.sequence,
      simulatedAt: input.simulatedAt,
      tick: input.tick,
      packetId: input.packetId,
      market: input.effect.trade.market,
      symbol: input.effect.trade.symbol,
      action: input.effect.trade.action,
      approved: true,
      rejectCodes: [],
      amountKrw: input.effect.trade.amountKrw,
      summary: `${input.effect.trade.market}:${input.effect.trade.symbol} ${input.effect.trade.action} filled ${input.effect.trade.amountKrw}`
    });
  }

  return createHistoricalReplayProgressEvent({
    eventType: input.effect.noOpReason,
    sequence: input.effect.sequence,
    simulatedAt: input.simulatedAt,
    tick: input.tick,
    packetId: input.packetId,
    market: input.effect.item.market,
    symbol: input.effect.item.symbol,
    action: input.effect.item.action,
    approved: true,
    rejectCodes: [],
    summary: `${input.effect.item.market}:${input.effect.item.symbol} ${input.effect.item.action} ${input.effect.noOpReason}`
  });
}

export function suppressDecisionItemsForSymbols(
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

export function enforceProviderDecisionExecutionCaps(input: {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecision;
}): ProviderDecisionExecutionCapResult {
  const allocation = input.packet.portfolioAllocation;
  if (allocation === undefined) {
    return {
      decision: input.decision,
      cappedItemCount: 0,
      heldItemCount: 0
    };
  }

  const currentExposureBySymbol = new Map<string, number>();
  for (const position of input.portfolio.positions) {
    currentExposureBySymbol.set(
      decisionItemSymbolKey(position),
      position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)
    );
  }

  const remainingMarketBudgetByMarket = new Map(
    Object.entries(allocation.marketAllocations ?? {}).map(
      ([market, marketAllocation]) => [
        market,
        marketAllocation.maxAdditionalBuyBudgetKrw
      ]
    )
  );
  let remainingDecisionBudgetKrw = allocation.maxBudgetPerDecisionKrw;
  let remainingAdditionalBudgetKrw = allocation.maxAdditionalBuyBudgetKrw;
  let remainingCashBudgetKrw = Math.max(
    0,
    input.portfolio.cashKrw - allocation.minCashReserveKrw
  );
  let remainingNewPositionSlots =
    allocation.remainingNewPositionSlots ??
    Math.max(
      0,
      input.packet.constraints.maxNewPositions - input.portfolio.positions.length
    );
  let cappedItemCount = 0;
  let heldItemCount = 0;

  const decisions = input.decision.decisions.map((item) => {
    if (item.action !== "VIRTUAL_BUY") {
      return item;
    }

    const symbolKey = decisionItemSymbolKey(item);
    const currentSymbolExposureKrw =
      currentExposureBySymbol.get(symbolKey) ?? 0;
    const opensNewPosition = currentSymbolExposureKrw <= 0;
    if (opensNewPosition && remainingNewPositionSlots <= 0) {
      heldItemCount += 1;
      return allocationHoldDecision(item);
    }

    const symbolHeadroomKrw =
      Math.max(0, allocation.maxSymbolExposureKrw - currentSymbolExposureKrw);
    const remainingMarketBudgetKrw =
      remainingMarketBudgetByMarket.get(item.market) ??
      Number.MAX_SAFE_INTEGER;
    const cappedBudgetKrw = Math.max(
      0,
      Math.floor(
        Math.min(
          item.budgetKrw,
          input.packet.constraints.maxBudgetPerSymbolKrw,
          remainingDecisionBudgetKrw,
          remainingAdditionalBudgetKrw,
          remainingCashBudgetKrw,
          remainingMarketBudgetKrw,
          symbolHeadroomKrw
        )
      )
    );

    if (cappedBudgetKrw <= 0) {
      heldItemCount += 1;
      return allocationHoldDecision(item);
    }

    if (cappedBudgetKrw < item.budgetKrw) {
      cappedItemCount += 1;
    }

    remainingDecisionBudgetKrw -= cappedBudgetKrw;
    remainingAdditionalBudgetKrw -= cappedBudgetKrw;
    remainingCashBudgetKrw -= cappedBudgetKrw;
    const nextMarketBudget = remainingMarketBudgetByMarket.get(item.market);
    if (nextMarketBudget !== undefined) {
      remainingMarketBudgetByMarket.set(
        item.market,
        nextMarketBudget - cappedBudgetKrw
      );
    }
    if (opensNewPosition) {
      remainingNewPositionSlots -= 1;
    }
    currentExposureBySymbol.set(
      symbolKey,
      currentSymbolExposureKrw + cappedBudgetKrw
    );

    return cappedBudgetKrw === item.budgetKrw
      ? item
      : {
          ...item,
          budgetKrw: cappedBudgetKrw,
          maxBudgetKrw: cappedBudgetKrw
        };
  });

  if (cappedItemCount === 0 && heldItemCount === 0) {
    return {
      decision: input.decision,
      cappedItemCount,
      heldItemCount
    };
  }

  return {
    decision: {
      ...input.decision,
      summary: `${input.decision.summary} 백엔드 배분 한도로 일부 BUY가 축소 또는 HOLD 처리되었습니다.`,
      decisions
    },
    cappedItemCount,
    heldItemCount
  };
}

export function appendHistoricalReplayAuditEvent(
  events: AuditEvent[],
  eventType: string,
  summary: string,
  tick: SimulatedTick
): void {
  events.push(auditEvent(eventType, summary, tick, events.length));
}

function decisionItemSymbolKey(
  item: Pick<VirtualDecisionItem, "market" | "symbol">
): string {
  return `${item.market}:${item.symbol}`;
}

function allocationHoldDecision(item: VirtualDecisionItem): VirtualDecisionItem {
  return {
    market: item.market,
    symbol: item.symbol,
    action: "VIRTUAL_HOLD",
    holdReasonCode: "PORTFOLIO_CONFLICT",
    confidence: item.confidence,
    budgetKrw: 0,
    maxBudgetKrw: 0,
    thesis: `${item.thesis} 백엔드 배분 한도로 이번 decision에서는 집행하지 않습니다.`,
    riskFactors: item.riskFactors,
    dataRefs: item.dataRefs,
    ...(item.featureRefs === undefined ? {} : { featureRefs: item.featureRefs }),
    ...(item.claimSupport === undefined
      ? {}
      : { claimSupport: item.claimSupport }),
    expiresAt: item.expiresAt
  };
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
