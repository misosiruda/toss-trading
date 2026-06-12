import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import { resolveVirtualDecisionNotionalKrw } from "./decisionSizing.js";
import {
  buildPaperFill,
  type PaperExecutionPolicy,
  type PaperFill
} from "./executionModel.js";
import { findCandidate, VirtualRiskEngine, type VirtualRiskPolicy } from "./riskEngine.js";

export interface PaperOrderInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
  riskPolicy?: Partial<VirtualRiskPolicy>;
  executionPolicy?: Partial<PaperExecutionPolicy> | undefined;
}

export interface PaperOrderResult {
  portfolio: VirtualPortfolio;
  riskDecision: VirtualRiskDecision;
  trade: VirtualTrade | null;
}

type PricedMarketCandidate = MarketCandidate & { lastPriceKrw: number };

export class PaperOrderEngine {
  private readonly riskEngine = new VirtualRiskEngine();

  execute(input: PaperOrderInput): PaperOrderResult {
    const riskInput = {
      packet: input.packet,
      portfolio: input.portfolio,
      decision: input.decision
    };
    const riskDecision = this.riskEngine.evaluate(
      input.riskPolicy ? { ...riskInput, policy: input.riskPolicy } : riskInput
    );

    if (!riskDecision.approved || input.decision.action === "VIRTUAL_HOLD") {
      return {
        portfolio: clonePortfolio(input.portfolio),
        riskDecision,
        trade: null
      };
    }

    const candidate = findCandidate(input.packet, input.decision);
    if (!candidate?.lastPriceKrw) {
      return {
        portfolio: clonePortfolio(input.portfolio),
        riskDecision: {
          ...riskDecision,
          approved: false,
          rejectCodes: [...riskDecision.rejectCodes, "VIRTUAL_PRICE_MISSING"]
        },
        trade: null
      };
    }
    const pricedCandidate = candidate as PricedMarketCandidate;

    if (input.decision.action === "VIRTUAL_BUY") {
      return executeBuy(input, riskDecision, pricedCandidate);
    }

    return executeSell(input, riskDecision, pricedCandidate);
  }
}

function executeBuy(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  candidate: PricedMarketCandidate
): PaperOrderResult {
  const portfolio = clonePortfolio(input.portfolio);
  const fill = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: resolveVirtualDecisionNotionalKrw(input),
    sourcePriceKrw: candidate.lastPriceKrw,
    policy: input.executionPolicy
  });
  const existing = portfolio.positions.find(
    (position) =>
      position.market === input.decision.market &&
      position.symbol === input.decision.symbol
  );

  if (existing) {
    const previousAmount = existing.quantity * existing.averagePriceKrw;
    const nextQuantity = existing.quantity + fill.quantity;
    existing.quantity = nextQuantity;
    existing.averagePriceKrw = Math.round(
      (previousAmount + fill.netAmountKrw) / nextQuantity
    );
    existing.marketPriceKrw = candidate.lastPriceKrw;
    existing.marketValueKrw = Math.round(nextQuantity * candidate.lastPriceKrw);
    existing.unrealizedPnlKrw =
      existing.marketValueKrw - Math.round(nextQuantity * existing.averagePriceKrw);
    existing.updatedAt = riskDecision.createdAt;
  } else {
    portfolio.positions.push({
      market: input.decision.market,
      symbol: input.decision.symbol,
      quantity: fill.quantity,
      averagePriceKrw: Math.round(fill.netAmountKrw / fill.quantity),
      marketPriceKrw: candidate.lastPriceKrw,
      marketValueKrw: Math.round(fill.quantity * candidate.lastPriceKrw),
      unrealizedPnlKrw:
        Math.round(fill.quantity * candidate.lastPriceKrw) - fill.netAmountKrw,
      updatedAt: riskDecision.createdAt
    });
  }

  portfolio.cashKrw -= fill.netAmountKrw;
  portfolio.updatedAt = riskDecision.createdAt;

  return {
    portfolio,
    riskDecision,
    trade: buildTrade(
      input,
      riskDecision,
      "VIRTUAL_BUY",
      fill,
      candidate.sourceRefs
    )
  };
}

function executeSell(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  candidate: PricedMarketCandidate
): PaperOrderResult {
  const portfolio = clonePortfolio(input.portfolio);
  const existing = portfolio.positions.find(
    (position) =>
      position.market === input.decision.market &&
      position.symbol === input.decision.symbol
  );

  if (!existing) {
    return { portfolio, riskDecision, trade: null };
  }

  const fill = buildPaperFill({
    action: "VIRTUAL_SELL",
    targetNotionalKrw: resolveVirtualDecisionNotionalKrw(input),
    sourcePriceKrw: candidate.lastPriceKrw,
    averagePriceKrw: existing.averagePriceKrw,
    policy: input.executionPolicy
  });
  existing.quantity -= fill.quantity;
  existing.marketPriceKrw = candidate.lastPriceKrw;
  existing.marketValueKrw = Math.round(existing.quantity * candidate.lastPriceKrw);
  existing.unrealizedPnlKrw =
    existing.marketValueKrw -
    Math.round(existing.quantity * existing.averagePriceKrw);
  existing.updatedAt = riskDecision.createdAt;
  portfolio.cashKrw += fill.netAmountKrw;
  portfolio.updatedAt = riskDecision.createdAt;

  if (existing.quantity <= 0.000001) {
    portfolio.positions = portfolio.positions.filter(
      (position) =>
        !(
          position.market === input.decision.market &&
          position.symbol === input.decision.symbol
        )
    );
  }

  return {
    portfolio,
    riskDecision,
    trade: buildTrade(
      input,
      riskDecision,
      "VIRTUAL_SELL",
      fill,
      candidate.sourceRefs
    )
  };
}

function buildTrade(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  action: "VIRTUAL_BUY" | "VIRTUAL_SELL",
  fill: PaperFill,
  priceSourceRefs: string[]
): VirtualTrade {
  const trade: VirtualTrade = {
    tradeId: `vtrade_${input.packet.packetId}_${input.decision.symbol}_${input.decision.action}`,
    packetId: input.packet.packetId,
    decisionId: riskDecision.riskDecisionId,
    market: input.decision.market,
    symbol: input.decision.symbol,
    action,
    quantity: fill.quantity,
    sourcePriceKrw: fill.sourcePriceKrw,
    priceKrw: fill.fillPriceKrw,
    fillPriceRule: fill.fillPriceRule,
    grossAmountKrw: fill.grossAmountKrw,
    amountKrw: fill.grossAmountKrw,
    netAmountKrw: fill.netAmountKrw,
    feeKrw: fill.feeKrw,
    taxKrw: fill.taxKrw,
    slippageKrw: fill.slippageKrw,
    priceSourceRefs,
    fillRatio: fill.fillRatio,
    fractionalShares: fill.fractionalShares,
    status: "VIRTUAL_FILLED",
    executedAt: riskDecision.createdAt
  };

  if (fill.realizedPnlKrw !== undefined) {
    trade.realizedPnlKrw = fill.realizedPnlKrw;
  }

  return trade;
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}
