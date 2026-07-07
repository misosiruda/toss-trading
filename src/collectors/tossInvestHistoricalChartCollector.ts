import {
  historicalMarketSnapshotSchema,
  parseWithSchema,
  type AssetClass,
  type AssetRegion,
  type AssetRiskTag,
  type AssetType,
  type HistoricalMarketSnapshot,
  type Market,
  type StrategyBucket
} from "../domain/schemas.js";
import type { ProcessRunner } from "../ai/processRunner.js";
import {
  TossInvestCliReadOnlyCollector,
  type TossInvestCliCollectorConfig
} from "./tossInvestCliCollector.js";

export interface TossInvestHistoricalChartSymbol {
  market: Market;
  symbol: string;
  sourceSymbol?: string;
  name?: string;
  assetType?: AssetType;
  assetClass?: AssetClass;
  region?: AssetRegion;
  riskTags?: AssetRiskTag[];
  strategyBucket?: StrategyBucket;
  sector?: string;
}

export interface TossInvestHistoricalChartCollectorOptions {
  symbols: TossInvestHistoricalChartSymbol[];
  interval: TossInvestChartInterval;
  count: number;
  config: TossInvestCliCollectorConfig;
  runner?: ProcessRunner;
  now?: () => Date;
}

export interface TossInvestHistoricalChartCollectorResult {
  mode: "paper_only";
  provider: "tossinvest_cli_quote_chart";
  status: "completed" | "completed_with_failures";
  interval: string;
  requestedCount: number;
  snapshotCount: number;
  symbolReports: TossInvestHistoricalChartSymbolReport[];
  snapshots: HistoricalMarketSnapshot[];
  disclaimer: string;
}

export interface TossInvestHistoricalChartSymbolReport {
  market: Market;
  symbol: string;
  sourceSymbol: string;
  status: "completed" | "failed";
  snapshotCount: number;
  error: string | null;
}

export type TossInvestChartInterval = "1m" | "5m" | "15m" | "60m";

type JsonRecord = Record<string, unknown>;

const intervalToSnapshotInterval: Record<
  TossInvestChartInterval,
  HistoricalMarketSnapshot["interval"]
> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "60m": "1h"
};

export async function collectTossInvestHistoricalChartSnapshots(
  options: TossInvestHistoricalChartCollectorOptions
): Promise<TossInvestHistoricalChartCollectorResult> {
  validateOptions(options);
  const collector = new TossInvestCliReadOnlyCollector(
    options.config,
    options.runner ? { runner: options.runner } : {}
  );
  const createdAt = (options.now ?? (() => new Date()))();
  const snapshots: HistoricalMarketSnapshot[] = [];
  const symbolReports: TossInvestHistoricalChartSymbolReport[] = [];

  for (const symbol of options.symbols) {
    const sourceSymbol = symbol.sourceSymbol ?? symbol.symbol;
    const result = await collector.collect({
      commandKey: "quote.chart",
      args: [
        sourceSymbol,
        "--interval",
        options.interval,
        "--count",
        String(options.count)
      ]
    });

    if (result.status !== "ok") {
      symbolReports.push({
        market: symbol.market,
        symbol: symbol.symbol,
        sourceSymbol,
        status: "failed",
        snapshotCount: 0,
        error: result.error
          ? `${result.error.code}: ${result.error.message}`
          : `collector status ${result.status}`
      });
      continue;
    }

    try {
      const converted = convertChartToSnapshots({
        symbol,
        sourceSymbol,
        interval: options.interval,
        data: result.data,
        createdAt
      });
      snapshots.push(...converted);
      symbolReports.push({
        market: symbol.market,
        symbol: symbol.symbol,
        sourceSymbol,
        status: converted.length > 0 ? "completed" : "failed",
        snapshotCount: converted.length,
        error: converted.length > 0 ? null : "NO_CANDLES"
      });
    } catch (error) {
      symbolReports.push({
        market: symbol.market,
        symbol: symbol.symbol,
        sourceSymbol,
        status: "failed",
        snapshotCount: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const sortedSnapshots = snapshots.sort(compareSnapshots);
  return {
    mode: "paper_only",
    provider: "tossinvest_cli_quote_chart",
    status: symbolReports.some((report) => report.status === "failed")
      ? "completed_with_failures"
      : "completed",
    interval: options.interval,
    requestedCount: options.count,
    snapshotCount: sortedSnapshots.length,
    symbolReports,
    snapshots: sortedSnapshots,
    disclaimer:
      "TossInvest CLI quote.chart snapshots are unofficial read-only paper replay inputs. They are not investment advice, guaranteed performance, or live trading signals."
  };
}

function validateOptions(
  options: TossInvestHistoricalChartCollectorOptions
): void {
  if (options.symbols.length === 0) {
    throw new Error("at least one symbol is required");
  }
  if (!Object.hasOwn(intervalToSnapshotInterval, options.interval)) {
    throw new Error(`unsupported chart interval: ${options.interval}`);
  }
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 500) {
    throw new Error("count must be an integer between 1 and 500");
  }
}

function convertChartToSnapshots(input: {
  symbol: TossInvestHistoricalChartSymbol;
  sourceSymbol: string;
  interval: TossInvestChartInterval;
  data: unknown;
  createdAt: Date;
}): HistoricalMarketSnapshot[] {
  const record = asRecord(input.data);
  if (!record) {
    throw new Error("quote.chart output must be an object");
  }

  const candles = record["candles"];
  if (!Array.isArray(candles)) {
    throw new Error("quote.chart output must include candles");
  }

  const snapshots: HistoricalMarketSnapshot[] = [];
  for (const [index, candleValue] of candles.entries()) {
    const candle = asRecord(candleValue);
    if (!candle) {
      continue;
    }
    const observedAt = readDate(candle, ["time", "observedAt", "timestamp"]);
    const close = readPrice(candle, ["close", "closePrice", "last"]);
    if (!observedAt || close === undefined) {
      continue;
    }
    const snapshot = parseWithSchema(
      historicalMarketSnapshotSchema,
      {
        snapshotId: snapshotIdFor(input.symbol, input.interval, observedAt),
        market: input.symbol.market,
        symbol: input.symbol.symbol,
        ...(input.symbol.name === undefined ? {} : { name: input.symbol.name }),
        ...(input.symbol.assetType === undefined
          ? {}
          : { assetType: input.symbol.assetType }),
        ...(input.symbol.assetClass === undefined
          ? {}
          : { assetClass: input.symbol.assetClass }),
        ...(input.symbol.region === undefined ? {} : { region: input.symbol.region }),
        ...(input.symbol.riskTags === undefined
          ? {}
          : { riskTags: input.symbol.riskTags }),
        ...(input.symbol.strategyBucket === undefined
          ? {}
          : { strategyBucket: input.symbol.strategyBucket }),
        ...(input.symbol.sector === undefined
          ? {}
          : { sector: input.symbol.sector }),
        observedAt: observedAt.toISOString(),
        interval: intervalToSnapshotInterval[input.interval],
        ...optionalPrice("openPriceKrw", readPrice(candle, ["open", "openPrice"])),
        ...optionalPrice("highPriceKrw", readPrice(candle, ["high", "highPrice"])),
        ...optionalPrice("lowPriceKrw", readPrice(candle, ["low", "lowPrice"])),
        closePriceKrw: close,
        lastPriceKrw: close,
        ...optionalNumber("volume", readNonNegativeNumber(candle, ["volume"])),
        sourceRefs: [
          `tossinvest_cli:quote.chart:${input.sourceSymbol}:${observedAt.toISOString()}:${index}`
        ],
        createdAt: input.createdAt.toISOString()
      },
      "historicalMarketSnapshot"
    );
    snapshots.push(snapshot);
  }

  return snapshots;
}

function snapshotIdFor(
  symbol: TossInvestHistoricalChartSymbol,
  interval: TossInvestChartInterval,
  observedAt: Date
): string {
  const timestamp = observedAt.toISOString().replace(/[^0-9]/g, "");
  return `hist_tossctl_${interval}_${symbol.market}_${symbol.symbol}_${timestamp}`;
}

function optionalPrice(
  key:
    | "openPriceKrw"
    | "highPriceKrw"
    | "lowPriceKrw"
    | "closePriceKrw"
    | "lastPriceKrw",
  value: number | undefined
): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

function optionalNumber(
  key: "volume",
  value: number | undefined
): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

function readDate(record: JsonRecord, keys: string[]): Date | null {
  for (const key of keys) {
    const value = record[key];
    const date =
      typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
    if (date && Number.isFinite(date.getTime())) {
      return date;
    }
  }
  return null;
}

function readPrice(record: JsonRecord, keys: string[]): number | undefined {
  const value = readNonNegativeNumber(record, keys);
  return value === undefined ? undefined : Math.round(value);
}

function readNonNegativeNumber(
  record: JsonRecord,
  keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value.replace(/,/g, "").trim())
          : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function compareSnapshots(
  left: HistoricalMarketSnapshot,
  right: HistoricalMarketSnapshot
): number {
  const observedDiff = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (observedDiff !== 0) {
    return observedDiff;
  }
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  const symbolDiff = left.symbol.localeCompare(right.symbol);
  if (symbolDiff !== 0) {
    return symbolDiff;
  }
  return left.snapshotId.localeCompare(right.snapshotId);
}
