import { average, formatDateTime } from "./formatters.js";
import {
  enrichPositionForDisplay,
  metadataForSymbol
} from "./metadata.js";
import { state } from "./state.js";

export function benchmarkPackets(data) {
  const progressPackets = data?.replayProgress?.progress?.recentPackets;
  if (Array.isArray(progressPackets) && progressPackets.length) {
    return progressPackets;
  }
  const packets = data?.packets?.packets;
  return Array.isArray(packets) ? packets : [];
}

export function equalWeightBenchmarkReturn(packets) {
  const sorted = [...packets]
    .filter((packet) => packet?.generatedAt && Array.isArray(packet.candidates))
    .sort((left, right) => new Date(left.generatedAt) - new Date(right.generatedAt));
  if (sorted.length < 2) {
    return { returnRatio: null, movers: [], rangeText: "-" };
  }

  const first = sorted[0];
  const last = sorted.at(-1);
  const latest = new Map(
    (last.candidates ?? []).map((candidate) => [
      `${candidate.market}:${candidate.symbol}`,
      candidate
    ])
  );
  const movers = [];
  for (const candidate of first.candidates ?? []) {
    const latestCandidate = latest.get(`${candidate.market}:${candidate.symbol}`);
    if (!latestCandidate || !candidate.lastPriceKrw) {
      continue;
    }
    const returnRatio =
      (latestCandidate.lastPriceKrw - candidate.lastPriceKrw) /
      candidate.lastPriceKrw;
    movers.push({
      market: candidate.market,
      symbol: candidate.symbol,
      name: metadataForSymbol(candidate.market, candidate.symbol, latestCandidate).name,
      startPriceKrw: candidate.lastPriceKrw,
      latestPriceKrw: latestCandidate.lastPriceKrw,
      returnRatio
    });
  }

  return {
    returnRatio: average(movers.map((item) => item.returnRatio)),
    movers: movers.sort((left, right) => Math.abs(right.returnRatio) - Math.abs(left.returnRatio)),
    rangeText: `${formatDateTime(first.generatedAt)} - ${formatDateTime(last.generatedAt)} · ${movers.length}종목`
  };
}

export function currentTradeList(data) {
  const progressTrades = data?.replayProgress?.progress?.recentTrades;
  if (Array.isArray(progressTrades) && progressTrades.length) {
    return progressTrades;
  }
  const trades = data?.trades?.trades;
  if (Array.isArray(trades) && trades.length) {
    return trades;
  }
  return Array.isArray(state.trades) ? state.trades : [];
}

export function realizedPnlFromTrades(trades) {
  if (!Array.isArray(trades) || !trades.length) {
    return null;
  }
  const explicitValues = trades
    .map((trade) => Number(trade.realizedPnlKrw))
    .filter((value) => Number.isFinite(value));
  if (explicitValues.length) {
    return explicitValues.reduce((sum, value) => sum + value, 0);
  }

  const lotsBySymbol = new Map();
  let realizedPnlKrw = 0;
  let hasSell = false;
  const sorted = trades
    .slice()
    .sort((left, right) => tradeTimeValue(left) - tradeTimeValue(right));

  for (const trade of sorted) {
    const key = `${trade.market}:${trade.symbol}`;
    const quantity = Number(trade.quantity ?? 0);
    const amountKrw = Number(trade.amountKrw ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amountKrw)) {
      continue;
    }

    if (trade.action === "VIRTUAL_BUY") {
      const lots = lotsBySymbol.get(key) ?? [];
      lots.push({
        quantity,
        costKrw: amountKrw
      });
      lotsBySymbol.set(key, lots);
      continue;
    }

    if (trade.action !== "VIRTUAL_SELL") {
      continue;
    }

    hasSell = true;
    let remaining = quantity;
    let costBasisKrw = 0;
    const lots = lotsBySymbol.get(key) ?? [];
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const usedQuantity = Math.min(remaining, lot.quantity);
      const usedCost = lot.costKrw * (usedQuantity / lot.quantity);
      costBasisKrw += usedCost;
      lot.quantity -= usedQuantity;
      lot.costKrw -= usedCost;
      remaining -= usedQuantity;
      if (lot.quantity <= 1e-9) {
        lots.shift();
      }
    }
    lotsBySymbol.set(key, lots);

    if (remaining > 1e-9) {
      const fallbackPrice = Number(trade.priceKrw ?? 0);
      costBasisKrw += Number.isFinite(fallbackPrice)
        ? remaining * fallbackPrice
        : 0;
    }
    realizedPnlKrw += Math.round(amountKrw - costBasisKrw);
  }

  return hasSell ? realizedPnlKrw : 0;
}

export function rememberPerformancePoint(portfolio) {
  const point = normalizePortfolioPoint(portfolio);
  if (!point) {
    return;
  }
  const existingIndex = state.performancePoints.findIndex(
    (item) => item.simulatedAt === point.simulatedAt
  );
  if (existingIndex >= 0) {
    state.performancePoints[existingIndex] = point;
  } else {
    state.performancePoints.push(point);
  }
  state.performancePoints = state.performancePoints
    .sort((left, right) => new Date(left.simulatedAt) - new Date(right.simulatedAt))
    .slice(-1_500);
}

export function portfolioPerformanceTimeline(data) {
  const progressTimeline = normalizePortfolioTimeline(
    data?.replayProgress?.progress?.portfolioTimeline
  );
  if (progressTimeline.length) {
    return progressTimeline;
  }

  const packetTimeline = normalizePortfolioTimeline(
    (data?.replayProgress?.progress?.recentPackets ?? [])
      .map((packet) => portfolioPointFromPacket(packet))
      .filter(Boolean)
  );
  if (packetTimeline.length) {
    const current = currentPortfolioSummary(data, packetTimeline);
    return mergePortfolioTimeline(packetTimeline, current ? [current] : []);
  }

  const reportTimeline = normalizePortfolioTimeline(
    data?.replay?.report?.portfolioTimeline
  );
  if (reportTimeline.length) {
    return reportTimeline;
  }

  if (state.performancePoints.length) {
    return [...state.performancePoints];
  }

  const current = currentPortfolioSummary(data, []);
  return current ? [current] : [];
}

export function currentPortfolioSummary(data, timeline) {
  const progress = data?.replayProgress?.progress ?? null;
  if (progress?.currentPortfolio) {
    return normalizePortfolioPoint(
      portfolioPointFromVirtualPortfolio(
        progress.currentPortfolio,
        progress.currentPortfolio.simulatedAt,
        progress.recentPackets?.[0]
      )
    );
  }

  const portfolio = data?.portfolio?.portfolio;
  if (portfolio) {
    const positions = Array.isArray(portfolio.positions)
      ? portfolio.positions.map((position) => enrichPositionForDisplay(position))
      : [];
    const positionMarketValueKrw = positions.reduce(
      (sum, position) => sum + positionMarketValue(position),
      0
    );
    return {
      simulatedAt: portfolio.updatedAt ?? new Date().toISOString(),
      cashKrw: Number(portfolio.cashKrw ?? 0),
      positionCount: positions.length,
      positionMarketValueKrw,
      virtualNetWorthKrw: Number(portfolio.cashKrw ?? 0) + positionMarketValueKrw,
      positions
    };
  }

  return timeline.at(-1) ?? null;
}

export function initialNetWorthKrw(data, timeline) {
  const reportInitial = data?.replay?.report?.portfolio?.initialCashKrw;
  if (Number.isFinite(Number(reportInitial))) {
    return Number(reportInitial);
  }
  return timeline[0]?.virtualNetWorthKrw ?? null;
}

export function maxDrawdownRatio(timeline) {
  let peak = null;
  let maxDrawdown = 0;
  for (const item of timeline) {
    const value = Number(item.virtualNetWorthKrw);
    if (!Number.isFinite(value)) {
      continue;
    }
    peak = peak === null ? value : Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
    }
  }
  return timeline.length > 1 ? maxDrawdown : null;
}

export function timelineRangeText(timeline) {
  if (!timeline.length) {
    return "-";
  }
  const first = timeline[0];
  const last = timeline.at(-1);
  return `${formatDateTime(first.simulatedAt)} - ${formatDateTime(last.simulatedAt)} · ${timeline.length} points`;
}

export function timelineVolatilityRatio(timeline) {
  const returns = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = Number(timeline[index - 1]?.virtualNetWorthKrw);
    const current = Number(timeline[index]?.virtualNetWorthKrw);
    if (Number.isFinite(previous) && previous > 0 && Number.isFinite(current)) {
      returns.push((current - previous) / previous);
    }
  }
  if (returns.length < 2) {
    return null;
  }
  const mean = average(returns) ?? 0;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;
  return Math.sqrt(variance);
}

export function positionMarketValue(position) {
  const quantity = Number(position?.quantity ?? 0);
  const averagePriceKrw = Number(position?.averagePriceKrw ?? 0);
  const marketValueKrw = Number(position?.marketValueKrw);
  if (Number.isFinite(marketValueKrw)) {
    return marketValueKrw;
  }
  return Math.round(quantity * averagePriceKrw);
}

export function positionCostBasis(position) {
  return Math.round(
    Number(position?.quantity ?? 0) * Number(position?.averagePriceKrw ?? 0)
  );
}

function tradeTimeValue(trade) {
  const time = Date.parse(trade?.executedAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function normalizePortfolioTimeline(timeline) {
  if (!Array.isArray(timeline)) {
    return [];
  }
  return timeline
    .map((item) => normalizePortfolioPoint(item))
    .filter(Boolean)
    .sort((left, right) => new Date(left.simulatedAt) - new Date(right.simulatedAt));
}

function normalizePortfolioPoint(item) {
  if (!item?.simulatedAt) {
    return null;
  }
  const cashKrw = Number(item.cashKrw ?? 0);
  const positionMarketValueKrw = Number(item.positionMarketValueKrw ?? 0);
  const virtualNetWorthKrw = Number(
    item.virtualNetWorthKrw ?? cashKrw + positionMarketValueKrw
  );
  if (!Number.isFinite(virtualNetWorthKrw)) {
    return null;
  }

  return {
    simulatedAt: item.simulatedAt,
    cashKrw,
    positionCount: Number(item.positionCount ?? item.positions?.length ?? 0),
    positionMarketValueKrw,
    virtualNetWorthKrw,
    positions: Array.isArray(item.positions)
      ? item.positions.map((position) => enrichPositionForDisplay(position))
      : []
  };
}

function portfolioPointFromPacket(packet) {
  if (!packet?.virtualPortfolio) {
    return null;
  }
  return portfolioPointFromVirtualPortfolio(
    packet.virtualPortfolio,
    packet.generatedAt,
    packet
  );
}

function portfolioPointFromVirtualPortfolio(portfolio, simulatedAt, latestPacket) {
  if (!portfolio || !simulatedAt) {
    return null;
  }
  const latestCandidates = new Map(
    (latestPacket?.candidates ?? []).map((candidate) => [
      `${candidate.market}:${candidate.symbol}`,
      candidate
    ])
  );
  const positions = (portfolio.positions ?? []).map((position) => {
    const latestCandidate = latestCandidates.get(`${position.market}:${position.symbol}`);
    const latestPrice = latestCandidate?.lastPriceKrw;
    const marketValueKrw =
      latestPrice === undefined
        ? positionMarketValue(position)
        : Math.round(Number(position.quantity ?? 0) * Number(latestPrice));
    const costBasisKrw = positionCostBasis(position);
    return {
      ...enrichPositionForDisplay(position, latestCandidate),
      marketValueKrw,
      unrealizedPnlKrw: marketValueKrw - costBasisKrw
    };
  });
  const positionMarketValueKrw = positions.reduce(
    (sum, position) => sum + positionMarketValue(position),
    0
  );
  return {
    simulatedAt,
    cashKrw: Number(portfolio.cashKrw ?? 0),
    positionCount: positions.length,
    positionMarketValueKrw,
    virtualNetWorthKrw: Number(portfolio.cashKrw ?? 0) + positionMarketValueKrw,
    positions
  };
}

function mergePortfolioTimeline(...groups) {
  const byTime = new Map();
  for (const group of groups) {
    for (const item of group) {
      if (item?.simulatedAt) {
        byTime.set(item.simulatedAt, item);
      }
    }
  }
  return normalizePortfolioTimeline(Array.from(byTime.values()));
}
