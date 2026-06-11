import type {
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import { findCandidate, VirtualRiskEngine, type VirtualRiskPolicy } from "./riskEngine.js";

export interface PaperOrderInput {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
  riskPolicy?: Partial<VirtualRiskPolicy>;
}

export interface PaperOrderResult {
  portfolio: VirtualPortfolio;
  riskDecision: VirtualRiskDecision;
  trade: VirtualTrade | null;
}

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

    if (input.decision.action === "VIRTUAL_BUY") {
      return executeBuy(input, riskDecision, candidate.lastPriceKrw);
    }

    return executeSell(input, riskDecision, candidate.lastPriceKrw);
  }
}

function executeBuy(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  priceKrw: number
): PaperOrderResult {
  const portfolio = clonePortfolio(input.portfolio);
  const quantity = input.decision.budgetKrw / priceKrw;
  const existing = portfolio.positions.find(
    (position) =>
      position.market === input.decision.market &&
      position.symbol === input.decision.symbol
  );

  if (existing) {
    const previousAmount = existing.quantity * existing.averagePriceKrw;
    const nextQuantity = existing.quantity + quantity;
    existing.quantity = nextQuantity;
    existing.averagePriceKrw = Math.round(
      (previousAmount + input.decision.budgetKrw) / nextQuantity
    );
    existing.marketValueKrw = Math.round(nextQuantity * priceKrw);
    existing.updatedAt = riskDecision.createdAt;
  } else {
    portfolio.positions.push({
      market: input.decision.market,
      symbol: input.decision.symbol,
      quantity,
      averagePriceKrw: priceKrw,
      marketValueKrw: input.decision.budgetKrw,
      unrealizedPnlKrw: 0,
      updatedAt: riskDecision.createdAt
    });
  }

  portfolio.cashKrw -= input.decision.budgetKrw;
  portfolio.updatedAt = riskDecision.createdAt;

  return {
    portfolio,
    riskDecision,
    trade: buildTrade(
      input,
      riskDecision,
      "VIRTUAL_BUY",
      quantity,
      priceKrw,
      input.decision.budgetKrw
    )
  };
}

function executeSell(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  priceKrw: number
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

  const quantity = input.decision.budgetKrw / priceKrw;
  existing.quantity -= quantity;
  existing.marketValueKrw = Math.round(existing.quantity * priceKrw);
  existing.updatedAt = riskDecision.createdAt;
  portfolio.cashKrw += input.decision.budgetKrw;
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
      quantity,
      priceKrw,
      input.decision.budgetKrw
    )
  };
}

function buildTrade(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  action: "VIRTUAL_BUY" | "VIRTUAL_SELL",
  quantity: number,
  priceKrw: number,
  amountKrw: number
): VirtualTrade {
  return {
    tradeId: `vtrade_${input.packet.packetId}_${input.decision.symbol}_${input.decision.action}`,
    packetId: input.packet.packetId,
    decisionId: riskDecision.riskDecisionId,
    market: input.decision.market,
    symbol: input.decision.symbol,
    action,
    quantity,
    priceKrw,
    amountKrw,
    status: "VIRTUAL_FILLED",
    executedAt: riskDecision.createdAt
  };
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}
