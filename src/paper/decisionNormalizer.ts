import type {
  Market,
  MarketCandidate,
  MarketPacket,
  VirtualAction,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";
import { virtualNetWorthKrw } from "./riskPolicy.js";

export interface NormalizedVirtualOrder {
  action: VirtualAction;
  market: Market;
  symbol: string;
  targetNotionalKrw: number;
  expectedPriceKrw: number | null;
  quantity: number | null;
  reduceOnly: boolean;
  originalDecisionRef: string;
  normalizationNotes: string[];
}

export function normalizeVirtualDecision(input: {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
}): NormalizedVirtualOrder {
  const candidate = findCandidate(input.packet, input.decision);
  const expectedPriceKrw = candidate?.lastPriceKrw ?? null;
  const base = {
    action: input.decision.action,
    market: input.decision.market,
    symbol: input.decision.symbol,
    expectedPriceKrw,
    originalDecisionRef: `${input.packet.packetId}:${input.decision.market}:${input.decision.symbol}:${input.decision.action}`,
    normalizationNotes: []
  };

  if (input.decision.action === "VIRTUAL_HOLD") {
    return {
      ...base,
      targetNotionalKrw: 0,
      quantity: null,
      reduceOnly: true
    };
  }

  if (input.decision.action === "VIRTUAL_BUY") {
    return normalizeBuy(input, base);
  }

  return normalizeSell(input, base, candidate);
}

function normalizeBuy(
  input: {
    packet: MarketPacket;
    decision: VirtualDecisionItem;
  },
  base: Omit<
    NormalizedVirtualOrder,
    "targetNotionalKrw" | "quantity" | "reduceOnly"
  >
): NormalizedVirtualOrder {
  const allocationCaps = input.packet.portfolioAllocation;
  const requestedBudgetKrw = Math.min(
    input.decision.budgetKrw,
    input.packet.constraints.maxBudgetPerSymbolKrw,
    allocationCaps?.maxBudgetPerDecisionKrw ?? Number.MAX_SAFE_INTEGER,
    allocationCaps?.maxAdditionalBuyBudgetKrw ?? Number.MAX_SAFE_INTEGER
  );
  const notes: string[] = [];
  if (requestedBudgetKrw < input.decision.budgetKrw) {
    notes.push("BUY_BUDGET_CAPPED_BY_PACKET_POLICY");
  }
  if (
    allocationCaps !== undefined &&
    requestedBudgetKrw <= allocationCaps.maxAdditionalBuyBudgetKrw &&
    input.decision.budgetKrw > allocationCaps.maxAdditionalBuyBudgetKrw
  ) {
    notes.push("BUY_BUDGET_CAPPED_BY_TARGET_EXPOSURE");
  }

  return {
    ...base,
    targetNotionalKrw: requestedBudgetKrw,
    quantity:
      base.expectedPriceKrw && base.expectedPriceKrw > 0
        ? requestedBudgetKrw / base.expectedPriceKrw
        : null,
    reduceOnly: false,
    normalizationNotes: notes
  };
}

function normalizeSell(
  input: {
    packet: MarketPacket;
    portfolio: VirtualPortfolio;
    decision: VirtualDecisionItem;
  },
  base: Omit<
    NormalizedVirtualOrder,
    "targetNotionalKrw" | "quantity" | "reduceOnly"
  >,
  candidate: MarketCandidate | undefined
): NormalizedVirtualOrder {
  const position = input.portfolio.positions.find(
    (item) =>
      item.market === input.decision.market &&
      item.symbol === input.decision.symbol
  );
  const priceKrw = candidate?.lastPriceKrw;
  const notes: string[] = [];

  if (!position || priceKrw === undefined) {
    return {
      ...base,
      targetNotionalKrw: input.decision.budgetKrw,
      quantity: null,
      reduceOnly: input.decision.reduceOnly !== false,
      normalizationNotes: notes
    };
  }

  const positionNotionalKrw = Math.round(position.quantity * priceKrw);
  const targetNotionalKrw = sellTargetNotionalKrw({
    decision: input.decision,
    portfolio: input.portfolio,
    positionQuantity: position.quantity,
    priceKrw
  });
  const cappedNotionalKrw = Math.min(targetNotionalKrw, positionNotionalKrw);
  if (cappedNotionalKrw < targetNotionalKrw) {
    notes.push("SELL_CLIPPED_TO_AVAILABLE_POSITION");
  }

  return {
    ...base,
    targetNotionalKrw: cappedNotionalKrw,
    quantity: cappedNotionalKrw > 0 ? cappedNotionalKrw / priceKrw : null,
    reduceOnly: true,
    normalizationNotes: notes
  };
}

function sellTargetNotionalKrw(input: {
  decision: VirtualDecisionItem;
  portfolio: VirtualPortfolio;
  positionQuantity: number;
  priceKrw: number;
}): number {
  if (input.decision.sellAll === true) {
    return Math.round(input.positionQuantity * input.priceKrw);
  }

  if (input.decision.sellQuantity !== undefined) {
    return Math.round(input.decision.sellQuantity * input.priceKrw);
  }

  if (input.decision.sellRatio !== undefined) {
    return Math.round(
      input.positionQuantity * input.decision.sellRatio * input.priceKrw
    );
  }

  if (input.decision.targetWeightPct !== undefined) {
    const currentPositionValueKrw = Math.round(
      input.positionQuantity * input.priceKrw
    );
    const targetValueKrw = Math.round(
      virtualNetWorthKrw(input.portfolio) * input.decision.targetWeightPct
    );
    return Math.max(0, currentPositionValueKrw - targetValueKrw);
  }

  return input.decision.budgetKrw;
}

function findCandidate(
  packet: MarketPacket,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): MarketCandidate | undefined {
  return packet.candidates.find(
    (candidate) =>
      candidate.market === decision.market && candidate.symbol === decision.symbol
  );
}
