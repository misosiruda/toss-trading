import type { MarketPacket, VirtualPortfolio, VirtualTrade } from "../domain/schemas.js";
import type { HistoricalReplayResult } from "../replay/historicalReplayRunner.js";

export interface HistoricalReplayBenchmarkReport {
  strategy: HistoricalReplayMetricSummary;
  cashOnly: HistoricalReplayMetricSummary;
  equalWeightBuyAndHold: HistoricalReplayMetricSummary | null;
  initialPortfolioBuyAndHold: HistoricalReplayMetricSummary;
  notes: string[];
}

export interface HistoricalReplayMetricSummary {
  initialNetWorthKrw: number;
  finalNetWorthKrw: number;
  totalReturnRatio: number | null;
  maxDrawdownRatio: number | null;
  tickVolatilityRatio: number | null;
  turnoverRatio: number | null;
  feeDragKrw: number;
}

export function buildHistoricalReplayBenchmarks(
  result: HistoricalReplayResult
): HistoricalReplayBenchmarkReport {
  const initialNetWorthKrw = portfolioNetWorth(result.initialPortfolio);
  const strategyCurve = result.portfolioTimeline.map(
    (item) => item.virtualNetWorthKrw
  );
  const normalizedStrategyCurve =
    strategyCurve.length > 0 ? strategyCurve : [initialNetWorthKrw];
  const tradeAmountKrw = sumTradeAmounts(result.trades);
  const feeDragKrw = sumTradeCosts(result.trades);
  const equalWeightCurve = buildEqualWeightBuyHoldCurve(
    initialNetWorthKrw,
    result.packets
  );
  const initialPortfolioCurve = buildInitialPortfolioBuyHoldCurve(
    result.initialPortfolio,
    result.packets
  );

  return {
    strategy: summarizeMetricCurve(
      normalizedStrategyCurve,
      tradeAmountKrw,
      feeDragKrw
    ),
    cashOnly: summarizeMetricCurve(
      Array.from({ length: normalizedStrategyCurve.length }, () => initialNetWorthKrw),
      0,
      0
    ),
    equalWeightBuyAndHold:
      equalWeightCurve.length > 0
        ? summarizeMetricCurve(equalWeightCurve, 0, 0)
        : null,
    initialPortfolioBuyAndHold: summarizeMetricCurve(initialPortfolioCurve, 0, 0),
    notes: [
      "Benchmarks use only replay packets and portfolio timeline data.",
      "Volatility is per replay tick and is not annualized.",
      "Equal-weight buy-and-hold uses the first priced replay packet universe."
    ]
  };
}

export function summarizeMetricCurve(
  curve: number[],
  tradeAmountKrw: number,
  feeDragKrw: number
): HistoricalReplayMetricSummary {
  const normalizedCurve = curve.length > 0 ? curve : [0];
  const initialNetWorthKrw = normalizedCurve[0] ?? 0;
  const finalNetWorthKrw = normalizedCurve.at(-1) ?? initialNetWorthKrw;
  const averageNetWorthKrw =
    normalizedCurve.reduce((sum, value) => sum + value, 0) /
    normalizedCurve.length;

  return {
    initialNetWorthKrw,
    finalNetWorthKrw,
    totalReturnRatio:
      initialNetWorthKrw > 0
        ? roundRatio((finalNetWorthKrw - initialNetWorthKrw) / initialNetWorthKrw)
        : null,
    maxDrawdownRatio: maxDrawdownRatio(normalizedCurve),
    tickVolatilityRatio: tickVolatilityRatio(normalizedCurve),
    turnoverRatio:
      averageNetWorthKrw > 0
        ? roundRatio(tradeAmountKrw / averageNetWorthKrw)
        : null,
    feeDragKrw
  };
}

function buildEqualWeightBuyHoldCurve(
  initialNetWorthKrw: number,
  packets: MarketPacket[]
): number[] {
  const firstPacket = packets.find((packet) =>
    packet.candidates.some((candidate) => candidate.lastPriceKrw !== undefined)
  );
  const firstCandidates =
    firstPacket?.candidates.filter(
      (candidate) => candidate.lastPriceKrw !== undefined
    ) ?? [];

  if (firstCandidates.length === 0) {
    return [];
  }

  const allocationKrw = initialNetWorthKrw / firstCandidates.length;
  const holdings = firstCandidates.map((candidate) => ({
    market: candidate.market,
    symbol: candidate.symbol,
    quantity: allocationKrw / candidate.lastPriceKrw!,
    lastPriceKrw: candidate.lastPriceKrw!
  }));

  return packets.map((packet) => {
    for (const candidate of packet.candidates) {
      const holding = holdings.find(
        (item) =>
          item.market === candidate.market && item.symbol === candidate.symbol
      );
      if (holding && candidate.lastPriceKrw !== undefined) {
        holding.lastPriceKrw = candidate.lastPriceKrw;
      }
    }

    return Math.round(
      holdings.reduce(
        (sum, holding) => sum + holding.quantity * holding.lastPriceKrw,
        0
      )
    );
  });
}

function buildInitialPortfolioBuyHoldCurve(
  initialPortfolio: VirtualPortfolio,
  packets: MarketPacket[]
): number[] {
  const latestPrices = new Map<string, number>();
  for (const position of initialPortfolio.positions) {
    latestPrices.set(
      portfolioKey(position.market, position.symbol),
      position.marketPriceKrw ?? position.averagePriceKrw
    );
  }

  if (packets.length === 0) {
    return [portfolioNetWorth(initialPortfolio)];
  }

  return packets.map((packet) => {
    for (const candidate of packet.candidates) {
      if (candidate.lastPriceKrw !== undefined) {
        latestPrices.set(
          portfolioKey(candidate.market, candidate.symbol),
          candidate.lastPriceKrw
        );
      }
    }

    return Math.round(
      initialPortfolio.cashKrw +
        initialPortfolio.positions.reduce((sum, position) => {
          const price =
            latestPrices.get(portfolioKey(position.market, position.symbol)) ??
            position.averagePriceKrw;
          return sum + position.quantity * price;
        }, 0)
    );
  });
}

function portfolioNetWorth(portfolio: VirtualPortfolio): number {
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

function sumTradeAmounts(trades: VirtualTrade[]): number {
  return trades.reduce(
    (sum, trade) => sum + (trade.grossAmountKrw ?? trade.amountKrw),
    0
  );
}

function sumTradeCosts(trades: VirtualTrade[]): number {
  return trades.reduce(
    (sum, trade) =>
      sum +
      (trade.feeKrw ?? 0) +
      (trade.taxKrw ?? 0) +
      (trade.slippageKrw ?? 0),
    0
  );
}

function maxDrawdownRatio(curve: number[]): number | null {
  if (curve.length === 0) {
    return null;
  }

  let peak = curve[0] ?? 0;
  let maxDrawdown = 0;
  for (const value of curve) {
    peak = Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, (value - peak) / peak);
    }
  }

  return roundRatio(maxDrawdown);
}

function tickVolatilityRatio(curve: number[]): number | null {
  if (curve.length < 2) {
    return null;
  }

  const returns: number[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1] ?? 0;
    const current = curve[index] ?? 0;
    if (previous > 0) {
      returns.push((current - previous) / previous);
    }
  }

  if (returns.length === 0) {
    return null;
  }

  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    returns.length;
  return roundRatio(Math.sqrt(variance));
}

function portfolioKey(market: string, symbol: string): string {
  return `${market}:${symbol}`;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}
