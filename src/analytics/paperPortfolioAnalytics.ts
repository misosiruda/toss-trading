import type {
  Market,
  VirtualDecision,
  VirtualPortfolio,
  VirtualTrade
} from "../domain/schemas.js";

export interface PaperPortfolioAnalytics {
  mode: "paper_only";
  cashKrw: number | null;
  positionMarketValueKrw: number;
  virtualNetWorthKrw: number | null;
  cashAllocationRatio: number | null;
  positionAllocationRatio: number | null;
  positionCount: number;
  symbolAllocations: SymbolAllocation[];
  exposureByMarket: Record<Market, number>;
  virtualPnl: VirtualPnlSummary;
  decisionTradeLinkage: DecisionTradeLinkageSummary;
  disclaimer: string;
}

export interface SymbolAllocation {
  market: Market;
  symbol: string;
  quantity: number;
  marketValueKrw: number;
  allocationRatio: number | null;
}

export interface VirtualPnlSummary {
  realizedPnlKrw: null;
  unrealizedPnlKrw: number | null;
  note: string;
}

export interface DecisionTradeLinkageSummary {
  decisionItemCount: number;
  filledTradeCount: number;
  linkedDecisionItemCount: number;
  unlinkedDecisionItemCount: number;
  tradeWithoutDecisionCount: number;
}

export function buildPaperPortfolioAnalytics(input: {
  portfolio: VirtualPortfolio | null;
  decisions: VirtualDecision[];
  trades: VirtualTrade[];
}): PaperPortfolioAnalytics {
  const positionMarketValueKrw =
    input.portfolio?.positions.reduce(
      (sum, position) => sum + positionMarketValue(position),
      0
    ) ?? 0;
  const virtualNetWorthKrw = input.portfolio
    ? input.portfolio.cashKrw + positionMarketValueKrw
    : null;
  const symbolAllocations =
    input.portfolio?.positions.map((position) => {
      const marketValueKrw = positionMarketValue(position);
      return {
        market: position.market,
        symbol: position.symbol,
        quantity: position.quantity,
        marketValueKrw,
        allocationRatio:
          virtualNetWorthKrw && virtualNetWorthKrw > 0
            ? roundRatio(marketValueKrw / virtualNetWorthKrw)
            : null
      };
    }) ?? [];

  return {
    mode: "paper_only",
    cashKrw: input.portfolio?.cashKrw ?? null,
    positionMarketValueKrw,
    virtualNetWorthKrw,
    cashAllocationRatio:
      input.portfolio && virtualNetWorthKrw && virtualNetWorthKrw > 0
        ? roundRatio(input.portfolio.cashKrw / virtualNetWorthKrw)
        : null,
    positionAllocationRatio:
      virtualNetWorthKrw && virtualNetWorthKrw > 0
        ? roundRatio(positionMarketValueKrw / virtualNetWorthKrw)
        : null,
    positionCount: input.portfolio?.positions.length ?? 0,
    symbolAllocations: symbolAllocations.sort(compareSymbolAllocation),
    exposureByMarket: buildExposureByMarket(symbolAllocations),
    virtualPnl: buildVirtualPnl(input.portfolio),
    decisionTradeLinkage: buildDecisionTradeLinkage(input.decisions, input.trades),
    disclaimer:
      "Paper-only analytics for virtual simulation. This is not investment performance and not financial advice."
  };
}

function positionMarketValue(
  position: NonNullable<VirtualPortfolio["positions"][number]>
): number {
  return (
    position.marketValueKrw ??
    Math.round(position.quantity * position.averagePriceKrw)
  );
}

function buildExposureByMarket(
  allocations: SymbolAllocation[]
): Record<Market, number> {
  return allocations.reduce<Record<Market, number>>(
    (byMarket, allocation) => {
      byMarket[allocation.market] += allocation.marketValueKrw;
      return byMarket;
    },
    { KR: 0, US: 0 }
  );
}

function buildVirtualPnl(
  portfolio: VirtualPortfolio | null
): VirtualPnlSummary {
  const pnlValues =
    portfolio?.positions
      .map((position) => position.unrealizedPnlKrw)
      .filter((value): value is number => value !== undefined) ?? [];

  return {
    realizedPnlKrw: null,
    unrealizedPnlKrw:
      portfolio && pnlValues.length === portfolio.positions.length
        ? pnlValues.reduce((sum, value) => sum + value, 0)
        : null,
    note:
      "Realized PnL requires broker-grade fills and cost basis; this paper metric intentionally avoids performance claims."
  };
}

function buildDecisionTradeLinkage(
  decisions: VirtualDecision[],
  trades: VirtualTrade[]
): DecisionTradeLinkageSummary {
  const decisionKeys = decisions.flatMap((decision) =>
    decision.decisions.map((item) =>
      [decision.packetId, item.market, item.symbol, item.action].join(":")
    )
  );
  const tradeKeys = trades.map((trade) =>
    [trade.packetId, trade.market, trade.symbol, trade.action].join(":")
  );
  const remainingTradeKeys = new Map<string, number>();
  for (const key of tradeKeys) {
    remainingTradeKeys.set(key, (remainingTradeKeys.get(key) ?? 0) + 1);
  }

  let linkedDecisionItemCount = 0;
  for (const key of decisionKeys) {
    const remaining = remainingTradeKeys.get(key) ?? 0;
    if (remaining > 0) {
      linkedDecisionItemCount += 1;
      remainingTradeKeys.set(key, remaining - 1);
    }
  }

  return {
    decisionItemCount: decisionKeys.length,
    filledTradeCount: trades.length,
    linkedDecisionItemCount,
    unlinkedDecisionItemCount: decisionKeys.length - linkedDecisionItemCount,
    tradeWithoutDecisionCount: Array.from(remainingTradeKeys.values()).reduce(
      (sum, value) => sum + value,
      0
    )
  };
}

function compareSymbolAllocation(
  left: SymbolAllocation,
  right: SymbolAllocation
): number {
  if (right.marketValueKrw !== left.marketValueKrw) {
    return right.marketValueKrw - left.marketValueKrw;
  }

  return `${left.market}:${left.symbol}`.localeCompare(`${right.market}:${right.symbol}`);
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}
