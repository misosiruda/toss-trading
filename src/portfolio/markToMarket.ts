import type {
  HistoricalMarketSnapshot,
  MarketCandidate,
  MarketPacket,
  VirtualPortfolio
} from "../domain/schemas.js";

export interface PortfolioPricePoint {
  market: string;
  symbol: string;
  priceKrw: number;
  priceUpdatedAt: string;
  priceStaleAfter: string;
  sourceRefs: string[];
}

export function markPortfolioToMarket(input: {
  portfolio: VirtualPortfolio;
  prices: PortfolioPricePoint[];
  asOf: Date;
}): VirtualPortfolio {
  const pricesBySymbol = new Map(
    input.prices.map((price) => [`${price.market}:${price.symbol}`, price])
  );

  return {
    ...input.portfolio,
    positions: input.portfolio.positions.map((position) => {
      const price = pricesBySymbol.get(`${position.market}:${position.symbol}`);
      if (price === undefined) {
        const fallbackMarketValueKrw =
          position.marketValueKrw ??
          Math.round(position.quantity * position.averagePriceKrw);
        return {
          ...position,
          marketValueKrw: fallbackMarketValueKrw,
          unrealizedPnlKrw:
            fallbackMarketValueKrw -
            Math.round(position.quantity * position.averagePriceKrw)
        };
      }

      const marketValueKrw = Math.round(position.quantity * price.priceKrw);
      const costBasisKrw = Math.round(position.quantity * position.averagePriceKrw);

      return {
        ...position,
        marketPriceKrw: price.priceKrw,
        marketValueKrw,
        unrealizedPnlKrw: marketValueKrw - costBasisKrw,
        priceUpdatedAt: price.priceUpdatedAt,
        priceStaleAfter: price.priceStaleAfter,
        priceSourceRefs: price.sourceRefs,
        isPriceStale: Date.parse(price.priceStaleAfter) <= input.asOf.getTime(),
        updatedAt: input.asOf.toISOString()
      };
    }),
    updatedAt: input.asOf.toISOString()
  };
}

export function pricePointsFromMarketPacket(
  packet: MarketPacket
): PortfolioPricePoint[] {
  return packet.candidates.flatMap((candidate) =>
    pricePointFromMarketCandidate(candidate)
  );
}

export function pricePointsFromHistoricalSnapshots(
  snapshots: HistoricalMarketSnapshot[],
  maxSnapshotAgeSeconds: number
): PortfolioPricePoint[] {
  return snapshots.map((snapshot) => ({
    market: snapshot.market,
    symbol: snapshot.symbol,
    priceKrw: snapshot.lastPriceKrw,
    priceUpdatedAt: snapshot.observedAt,
    priceStaleAfter: new Date(
      Date.parse(snapshot.observedAt) + maxSnapshotAgeSeconds * 1000
    ).toISOString(),
    sourceRefs: [`historical_snapshot:${snapshot.snapshotId}`, ...snapshot.sourceRefs]
  }));
}

function pricePointFromMarketCandidate(
  candidate: MarketCandidate
): PortfolioPricePoint[] {
  if (candidate.lastPriceKrw === undefined) {
    return [];
  }

  return [
    {
      market: candidate.market,
      symbol: candidate.symbol,
      priceKrw: candidate.lastPriceKrw,
      priceUpdatedAt: candidate.collectedAt,
      priceStaleAfter: candidate.staleAfter,
      sourceRefs: candidate.sourceRefs
    }
  ];
}
