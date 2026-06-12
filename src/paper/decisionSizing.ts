import type {
  MarketCandidate,
  MarketPacket,
  VirtualDecisionItem,
  VirtualPortfolio
} from "../domain/schemas.js";

export function resolveVirtualDecisionNotionalKrw(input: {
  packet: MarketPacket;
  portfolio: VirtualPortfolio;
  decision: VirtualDecisionItem;
}): number {
  if (input.decision.action !== "VIRTUAL_SELL") {
    return input.decision.budgetKrw;
  }

  const position = input.portfolio.positions.find(
    (item) =>
      item.market === input.decision.market &&
      item.symbol === input.decision.symbol
  );
  const candidate = findDecisionCandidate(input.packet, input.decision);
  const priceKrw = candidate?.lastPriceKrw;

  if (position === undefined || priceKrw === undefined) {
    return input.decision.budgetKrw;
  }

  if (input.decision.sellAll === true) {
    return Math.round(position.quantity * priceKrw);
  }

  if (input.decision.sellQuantity !== undefined) {
    return Math.round(input.decision.sellQuantity * priceKrw);
  }

  if (input.decision.sellRatio !== undefined) {
    return Math.round(position.quantity * input.decision.sellRatio * priceKrw);
  }

  if (input.decision.targetWeightPct !== undefined) {
    const currentPositionValueKrw = Math.round(position.quantity * priceKrw);
    const targetValueKrw = Math.round(
      virtualNetWorthKrw(input.portfolio) * input.decision.targetWeightPct
    );
    return Math.max(0, currentPositionValueKrw - targetValueKrw);
  }

  return input.decision.budgetKrw;
}

function virtualNetWorthKrw(portfolio: VirtualPortfolio): number {
  return (
    portfolio.cashKrw +
    portfolio.positions.reduce(
      (sum, position) =>
        sum +
        (position.marketValueKrw ??
          Math.round(position.quantity * position.averagePriceKrw)),
      0
    )
  );
}

function findDecisionCandidate(
  packet: MarketPacket,
  decision: Pick<VirtualDecisionItem, "market" | "symbol">
): MarketCandidate | undefined {
  return packet.candidates.find(
    (candidate) =>
      candidate.market === decision.market && candidate.symbol === decision.symbol
  );
}
