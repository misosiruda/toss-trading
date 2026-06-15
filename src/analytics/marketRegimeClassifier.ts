import type { HistoricalMarketSnapshot, Market } from "../domain/schemas.js";

export type MarketRegimeLabel =
  | "bull"
  | "bear"
  | "sideways"
  | "mixed"
  | "insufficient_data";

export interface MarketRegimeClassifierOptions {
  snapshots: HistoricalMarketSnapshot[];
  windowStart: Date;
  windowEnd: Date;
  minSymbols?: number;
  minSnapshotsPerSymbol?: number;
  bullReturnThreshold?: number;
  bearReturnThreshold?: number;
  sidewaysAbsReturnThreshold?: number;
  breadthThreshold?: number;
}

export interface MarketRegimeClassification {
  label: MarketRegimeLabel;
  windowStart: string;
  windowEnd: string;
  symbolCount: number;
  classifiedSymbolCount: number;
  averageReturnRatio: number | null;
  medianReturnRatio: number | null;
  advancingSymbolRatio: number | null;
  decliningSymbolRatio: number | null;
  flatSymbolRatio: number | null;
  minSymbols: number;
  minSnapshotsPerSymbol: number;
  thresholds: {
    bullReturnThreshold: number;
    bearReturnThreshold: number;
    sidewaysAbsReturnThreshold: number;
    breadthThreshold: number;
  };
  reasons: string[];
  symbolReturns: MarketRegimeSymbolReturn[];
}

export interface MarketRegimeSymbolReturn {
  market: Market;
  symbol: string;
  snapshotCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  firstPriceKrw: number;
  lastPriceKrw: number;
  returnRatio: number;
}

export type MarketRegimesByMarket = Partial<
  Record<Market, MarketRegimeClassification>
>;

const DEFAULT_MIN_SYMBOLS = 1;
const DEFAULT_MIN_SNAPSHOTS_PER_SYMBOL = 2;
const DEFAULT_BULL_RETURN_THRESHOLD = 0.03;
const DEFAULT_BEAR_RETURN_THRESHOLD = -0.03;
const DEFAULT_SIDEWAYS_ABS_RETURN_THRESHOLD = 0.01;
const DEFAULT_BREADTH_THRESHOLD = 0.6;

export function classifyMarketRegime(
  options: MarketRegimeClassifierOptions
): MarketRegimeClassification {
  validateOptions(options);

  const minSymbols = options.minSymbols ?? DEFAULT_MIN_SYMBOLS;
  const minSnapshotsPerSymbol =
    options.minSnapshotsPerSymbol ?? DEFAULT_MIN_SNAPSHOTS_PER_SYMBOL;
  const thresholds = {
    bullReturnThreshold:
      options.bullReturnThreshold ?? DEFAULT_BULL_RETURN_THRESHOLD,
    bearReturnThreshold:
      options.bearReturnThreshold ?? DEFAULT_BEAR_RETURN_THRESHOLD,
    sidewaysAbsReturnThreshold:
      options.sidewaysAbsReturnThreshold ??
      DEFAULT_SIDEWAYS_ABS_RETURN_THRESHOLD,
    breadthThreshold: options.breadthThreshold ?? DEFAULT_BREADTH_THRESHOLD
  };
  const windowSnapshots = options.snapshots
    .filter((snapshot) =>
      isInsideWindow(snapshot, options.windowStart, options.windowEnd)
    )
    .sort(compareSnapshots);
  const symbolGroups = groupBySymbol(windowSnapshots);
  const symbolReturns = Array.from(symbolGroups.values())
    .filter((snapshots) => snapshots.length >= minSnapshotsPerSymbol)
    .map(toSymbolReturn)
    .sort(compareSymbolReturns);

  if (symbolReturns.length < minSymbols) {
    return baseClassification({
      label: "insufficient_data",
      options,
      minSymbols,
      minSnapshotsPerSymbol,
      thresholds,
      symbolCount: symbolGroups.size,
      symbolReturns,
      reasons: ["INSUFFICIENT_CLASSIFIABLE_SYMBOLS"]
    });
  }

  const returns = symbolReturns.map((item) => item.returnRatio);
  const averageReturnRatio = roundRatio(average(returns));
  const medianReturnRatio = roundRatio(median(returns));
  const advancingSymbolRatio = roundRatio(
    returns.filter((value) => value > 0).length / returns.length
  );
  const decliningSymbolRatio = roundRatio(
    returns.filter((value) => value < 0).length / returns.length
  );
  const flatSymbolRatio = roundRatio(
    returns.filter((value) => value === 0).length / returns.length
  );
  const { label, reasons } = regimeLabel({
    averageReturnRatio,
    advancingSymbolRatio,
    decliningSymbolRatio,
    thresholds
  });

  return {
    label,
    windowStart: options.windowStart.toISOString(),
    windowEnd: options.windowEnd.toISOString(),
    symbolCount: symbolGroups.size,
    classifiedSymbolCount: symbolReturns.length,
    averageReturnRatio,
    medianReturnRatio,
    advancingSymbolRatio,
    decliningSymbolRatio,
    flatSymbolRatio,
    minSymbols,
    minSnapshotsPerSymbol,
    thresholds,
    reasons,
    symbolReturns
  };
}

export function classifyMarketRegimeByMarket(
  options: MarketRegimeClassifierOptions
): MarketRegimesByMarket {
  validateOptions(options);

  const markets = Array.from(
    new Set(
      options.snapshots
        .filter((snapshot) =>
          isInsideWindow(snapshot, options.windowStart, options.windowEnd)
        )
        .map((snapshot) => snapshot.market)
    )
  ).sort();
  const byMarket: MarketRegimesByMarket = {};

  for (const market of markets) {
    byMarket[market] = classifyMarketRegime({
      ...options,
      snapshots: options.snapshots.filter(
        (snapshot) => snapshot.market === market
      )
    });
  }

  return byMarket;
}

function baseClassification(input: {
  label: MarketRegimeLabel;
  options: MarketRegimeClassifierOptions;
  minSymbols: number;
  minSnapshotsPerSymbol: number;
  thresholds: MarketRegimeClassification["thresholds"];
  symbolCount: number;
  symbolReturns: MarketRegimeSymbolReturn[];
  reasons: string[];
}): MarketRegimeClassification {
  return {
    label: input.label,
    windowStart: input.options.windowStart.toISOString(),
    windowEnd: input.options.windowEnd.toISOString(),
    symbolCount: input.symbolCount,
    classifiedSymbolCount: input.symbolReturns.length,
    averageReturnRatio: null,
    medianReturnRatio: null,
    advancingSymbolRatio: null,
    decliningSymbolRatio: null,
    flatSymbolRatio: null,
    minSymbols: input.minSymbols,
    minSnapshotsPerSymbol: input.minSnapshotsPerSymbol,
    thresholds: input.thresholds,
    reasons: input.reasons,
    symbolReturns: input.symbolReturns
  };
}

function regimeLabel(input: {
  averageReturnRatio: number;
  advancingSymbolRatio: number;
  decliningSymbolRatio: number;
  thresholds: MarketRegimeClassification["thresholds"];
}): { label: MarketRegimeLabel; reasons: string[] } {
  if (
    input.averageReturnRatio >= input.thresholds.bullReturnThreshold &&
    input.advancingSymbolRatio >= input.thresholds.breadthThreshold
  ) {
    return { label: "bull", reasons: ["POSITIVE_RETURN_AND_BREADTH"] };
  }

  if (
    input.averageReturnRatio <= input.thresholds.bearReturnThreshold &&
    input.decliningSymbolRatio >= input.thresholds.breadthThreshold
  ) {
    return { label: "bear", reasons: ["NEGATIVE_RETURN_AND_BREADTH"] };
  }

  if (
    Math.abs(input.averageReturnRatio) <=
    input.thresholds.sidewaysAbsReturnThreshold
  ) {
    return { label: "sideways", reasons: ["LOW_ABSOLUTE_AVERAGE_RETURN"] };
  }

  return { label: "mixed", reasons: ["DIRECTION_OR_BREADTH_MIXED"] };
}

function toSymbolReturn(
  snapshots: HistoricalMarketSnapshot[]
): MarketRegimeSymbolReturn {
  const first = snapshots[0]!;
  const last = snapshots.at(-1)!;
  return {
    market: first.market,
    symbol: first.symbol,
    snapshotCount: snapshots.length,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
    firstPriceKrw: first.lastPriceKrw,
    lastPriceKrw: last.lastPriceKrw,
    returnRatio: roundRatio(
      (last.lastPriceKrw - first.lastPriceKrw) / first.lastPriceKrw
    )
  };
}

function groupBySymbol(
  snapshots: HistoricalMarketSnapshot[]
): Map<string, HistoricalMarketSnapshot[]> {
  const groups = new Map<string, HistoricalMarketSnapshot[]>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.market}:${snapshot.symbol}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [snapshot]);
      continue;
    }
    existing.push(snapshot);
  }
  return groups;
}

function isInsideWindow(
  snapshot: HistoricalMarketSnapshot,
  windowStart: Date,
  windowEnd: Date
): boolean {
  const observedAt = Date.parse(snapshot.observedAt);
  return observedAt >= windowStart.getTime() && observedAt <= windowEnd.getTime();
}

function compareSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  const timeDiff = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  return left.symbol.localeCompare(right.symbol);
}

function compareSymbolReturns(
  left: MarketRegimeSymbolReturn,
  right: MarketRegimeSymbolReturn
): number {
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  return left.symbol.localeCompare(right.symbol);
}

function validateOptions(options: MarketRegimeClassifierOptions): void {
  validateDate(options.windowStart, "windowStart");
  validateDate(options.windowEnd, "windowEnd");
  if (options.windowStart.getTime() > options.windowEnd.getTime()) {
    throw new Error("windowStart must be before or equal to windowEnd");
  }
  validatePositiveInteger(options.minSymbols ?? DEFAULT_MIN_SYMBOLS, "minSymbols");
  validatePositiveInteger(
    options.minSnapshotsPerSymbol ?? DEFAULT_MIN_SNAPSHOTS_PER_SYMBOL,
    "minSnapshotsPerSymbol"
  );
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint]!;
  }
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
