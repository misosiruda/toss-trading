import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualRiskDecision,
  VirtualTrade
} from "../domain/schemas.js";
import {
  normalizeVirtualDecision,
  type NormalizedVirtualOrder
} from "./decisionNormalizer.js";
import {
  buildPaperFill,
  type PaperExecutionPolicy,
  type PaperFill
} from "./executionModel.js";
import { PAPER_COST_MODEL_VERSION } from "./costModel.js";
import { isDustPosition, isSellAllDustClose } from "./dustPosition.js";
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
  noOpReason?: "NO_OP_EXIT_DUST_CLOSED" | undefined;
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
    const normalizedOrder = normalizeVirtualDecision(input);

    if (input.decision.action === "VIRTUAL_BUY") {
      return executeBuy(input, riskDecision, pricedCandidate, normalizedOrder);
    }

    return executeSell(input, riskDecision, pricedCandidate, normalizedOrder);
  }
}

function executeBuy(
  input: PaperOrderInput,
  riskDecision: VirtualRiskDecision,
  candidate: PricedMarketCandidate,
  normalizedOrder: NormalizedVirtualOrder
): PaperOrderResult {
  const portfolio = clonePortfolio(input.portfolio);
  const fill = buildPaperFill({
    action: "VIRTUAL_BUY",
    targetNotionalKrw: normalizedOrder.targetNotionalKrw,
    sourcePriceKrw: candidate.lastPriceKrw,
    volume: candidate.volume,
    averageVolume: candidate.averageVolume,
    liquidityStale: isCandidateLiquidityStale(candidate, riskDecision.createdAt),
    policy: input.executionPolicy
  });

  if (fill.fillStatus === "rejected") {
    return {
      portfolio,
      riskDecision: rejectLiquidityFill(riskDecision, fill),
      trade: null
    };
  }

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
    syncPositionMetadata(existing, candidate);
    existing.updatedAt = riskDecision.createdAt;
  } else {
    portfolio.positions.push({
      market: input.decision.market,
      symbol: input.decision.symbol,
      ...(candidate.assetType === undefined
        ? {}
        : { assetType: candidate.assetType }),
      ...(candidate.assetClass === undefined
        ? {}
        : { assetClass: candidate.assetClass }),
      ...(candidate.region === undefined ? {} : { region: candidate.region }),
      ...(candidate.riskTags === undefined
        ? {}
        : { riskTags: candidate.riskTags }),
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
  candidate: PricedMarketCandidate,
  normalizedOrder: NormalizedVirtualOrder
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

  if (
    normalizedOrder.targetNotionalKrw <= 0 &&
    isSellAllDustClose({
      decision: input.decision,
      position: existing,
      priceKrw: candidate.lastPriceKrw
    })
  ) {
    portfolio.positions = portfolio.positions.filter(
      (position) =>
        !(
          position.market === input.decision.market &&
          position.symbol === input.decision.symbol
        )
    );
    portfolio.updatedAt = riskDecision.createdAt;

    return {
      portfolio,
      riskDecision,
      trade: null,
      noOpReason: "NO_OP_EXIT_DUST_CLOSED"
    };
  }

  const fill = buildPaperFill({
    action: "VIRTUAL_SELL",
    targetNotionalKrw: normalizedOrder.targetNotionalKrw,
    sourcePriceKrw: candidate.lastPriceKrw,
    averagePriceKrw: existing.averagePriceKrw,
    volume: candidate.volume,
    averageVolume: candidate.averageVolume,
    liquidityStale: isCandidateLiquidityStale(candidate, riskDecision.createdAt),
    quantityOverride: shouldSnapToFullExit({
      normalizedOrder,
      existing,
      sourcePriceKrw: candidate.lastPriceKrw
    })
      ? existing.quantity
      : undefined,
    policy: input.executionPolicy
  });

  if (fill.fillStatus === "rejected") {
    return {
      portfolio,
      riskDecision: rejectLiquidityFill(riskDecision, fill),
      trade: null
    };
  }

  existing.quantity -= fill.quantity;
  existing.marketPriceKrw = candidate.lastPriceKrw;
  existing.marketValueKrw = Math.round(existing.quantity * candidate.lastPriceKrw);
  existing.unrealizedPnlKrw =
    existing.marketValueKrw -
    Math.round(existing.quantity * existing.averagePriceKrw);
  existing.updatedAt = riskDecision.createdAt;
  portfolio.cashKrw += fill.netAmountKrw;
  portfolio.updatedAt = riskDecision.createdAt;

  if (isDustPosition(existing, candidate.lastPriceKrw)) {
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

function shouldSnapToFullExit(input: {
  normalizedOrder: NormalizedVirtualOrder;
  existing: VirtualPortfolio["positions"][number];
  sourcePriceKrw: number;
}): boolean {
  const currentPositionValueKrw = Math.round(
    input.existing.quantity * input.sourcePriceKrw
  );
  return (
    input.normalizedOrder.reduceOnly &&
    currentPositionValueKrw > 0 &&
    input.normalizedOrder.targetNotionalKrw >= currentPositionValueKrw
  );
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
    spreadCostKrw: fill.spreadCostKrw,
    impactCostKrw: fill.impactCostKrw,
    totalCostKrw: fill.totalCostKrw,
    costModelVersion: PAPER_COST_MODEL_VERSION,
    requestedNotionalKrw: fill.requestedNotionalKrw,
    filledNotionalKrw: fill.filledNotionalKrw,
    fillStatus: fill.fillStatus,
    liquidityStatus: fill.liquidityStatus,
    maxParticipationRate: fill.maxParticipationRate,
    priceSourceRefs,
    fillRatio: fill.fillRatio,
    fractionalShares: fill.fractionalShares,
    status: "VIRTUAL_FILLED",
    executedAt: riskDecision.createdAt
  };

  if (fill.realizedPnlKrw !== undefined) {
    trade.realizedPnlKrw = fill.realizedPnlKrw;
  }
  if (fill.participationRate !== undefined) {
    trade.participationRate = fill.participationRate;
  }
  if (fill.volume !== undefined) {
    trade.volume = fill.volume;
  }
  if (fill.averageVolume !== undefined) {
    trade.averageVolume = fill.averageVolume;
  }

  return trade;
}

function rejectLiquidityFill(
  riskDecision: VirtualRiskDecision,
  fill: PaperFill
): VirtualRiskDecision {
  const rejectCode =
    fill.liquidityRejectReason === "stale_liquidity"
      ? "VIRTUAL_LIQUIDITY_STALE"
      : "VIRTUAL_LIQUIDITY_INSUFFICIENT";

  return {
    ...riskDecision,
    approved: false,
    rejectCodes: Array.from(new Set([...riskDecision.rejectCodes, rejectCode])),
    checkedRules: Array.from(
      new Set([...riskDecision.checkedRules, "liquidity"])
    )
  };
}

function isCandidateLiquidityStale(
  candidate: MarketCandidate,
  evaluatedAt: string
): boolean {
  if (candidate.volume === undefined && candidate.averageVolume === undefined) {
    return false;
  }

  const staleAfterMs = Date.parse(candidate.staleAfter);
  const evaluatedAtMs = Date.parse(evaluatedAt);
  return (
    Number.isFinite(staleAfterMs) &&
    Number.isFinite(evaluatedAtMs) &&
    staleAfterMs <= evaluatedAtMs
  );
}

function syncPositionMetadata(
  position: VirtualPortfolio["positions"][number],
  candidate: MarketCandidate
): void {
  if (position.assetType === undefined && candidate.assetType !== undefined) {
    position.assetType = candidate.assetType;
  }
  if (position.assetClass === undefined && candidate.assetClass !== undefined) {
    position.assetClass = candidate.assetClass;
  }
  if (position.region === undefined && candidate.region !== undefined) {
    position.region = candidate.region;
  }
  if (position.riskTags === undefined && candidate.riskTags !== undefined) {
    position.riskTags = candidate.riskTags;
  }
}

function clonePortfolio(portfolio: VirtualPortfolio): VirtualPortfolio {
  return {
    ...portfolio,
    positions: portfolio.positions.map((position) => ({ ...position }))
  };
}
