import {
  historicalMarketSnapshotSchema,
  parseWithSchema,
  type HistoricalMarketSnapshot
} from "../domain/schemas.js";
import type {
  HistoricalUniverseManifest,
  HistoricalUniverseMember
} from "../replay/historicalUniverseCoverage.js";

export interface YahooHistoricalDailyCollectorOptions {
  universe: HistoricalUniverseManifest;
  rangeStart: Date;
  rangeEnd: Date;
  fetcher?: YahooFetch;
  now?: () => Date;
  fxSourceSymbol?: string;
}

export interface YahooHistoricalDailyCollectorResult {
  mode: "paper_only";
  provider: "yahoo_chart";
  status: "completed" | "completed_with_failures";
  rangeStart: string;
  rangeEnd: string;
  universeId: string;
  snapshotCount: number;
  fxSourceSymbol: string;
  symbolReports: YahooHistoricalDailySymbolReport[];
  snapshots: HistoricalMarketSnapshot[];
  disclaimer: string;
}

export interface YahooHistoricalDailySymbolReport {
  market: string;
  symbol: string;
  sourceSymbol: string;
  assetType: string | null;
  currency: string | null;
  status: "completed" | "failed";
  snapshotCount: number;
  error: string | null;
}

type YahooFetch = (
  input: string | URL,
  init?: { headers?: Record<string, string> }
) => Promise<YahooFetchResponse>;

interface YahooFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string } | null;
  };
}

interface YahooChartResult {
  meta?: {
    currency?: string;
    symbol?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: YahooQuoteSeries[];
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
}

interface YahooQuoteSeries {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
}

interface FxRate {
  dateKey: string;
  observedAtMs: number;
  rate: number;
}

const defaultFxSourceSymbol = "KRW=X";
const yahooChartEndpoint = "https://query1.finance.yahoo.com/v8/finance/chart";
const secondsPerDay = 24 * 60 * 60;

export async function collectYahooHistoricalDailySnapshots(
  options: YahooHistoricalDailyCollectorOptions
): Promise<YahooHistoricalDailyCollectorResult> {
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }

  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const fxSourceSymbol = options.fxSourceSymbol ?? defaultFxSourceSymbol;
  const fxChart = await fetchYahooChart({
    sourceSymbol: fxSourceSymbol,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
    fetcher
  });
  const fxRates = extractFxRates(fxChart);
  const snapshots: HistoricalMarketSnapshot[] = [];
  const symbolReports: YahooHistoricalDailySymbolReport[] = [];

  for (const member of options.universe.symbols) {
    const sourceSymbol = sourceSymbolFor(member);
    try {
      const chart = await fetchYahooChart({
        sourceSymbol,
        rangeStart: options.rangeStart,
        rangeEnd: options.rangeEnd,
        fetcher
      });
      const converted = convertYahooChartToSnapshots({
        chart,
        member,
        sourceSymbol,
        rangeStart: options.rangeStart,
        rangeEnd: options.rangeEnd,
        fxRates,
        fxSourceSymbol,
        createdAt: now()
      });
      snapshots.push(...converted.snapshots);
      symbolReports.push({
        market: member.market,
        symbol: member.symbol,
        sourceSymbol,
        assetType: member.assetType ?? null,
        currency: converted.currency,
        status: converted.snapshots.length > 0 ? "completed" : "failed",
        snapshotCount: converted.snapshots.length,
        error: converted.snapshots.length > 0 ? null : "NO_DAILY_PRICE_ROWS"
      });
    } catch (error) {
      symbolReports.push({
        market: member.market,
        symbol: member.symbol,
        sourceSymbol,
        assetType: member.assetType ?? null,
        currency: null,
        status: "failed",
        snapshotCount: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const sortedSnapshots = snapshots.sort(compareSnapshots);
  return {
    mode: "paper_only",
    provider: "yahoo_chart",
    status: symbolReports.some((report) => report.status === "failed")
      ? "completed_with_failures"
      : "completed",
    rangeStart: options.rangeStart.toISOString(),
    rangeEnd: options.rangeEnd.toISOString(),
    universeId: options.universe.universeId,
    snapshotCount: sortedSnapshots.length,
    fxSourceSymbol,
    symbolReports,
    snapshots: sortedSnapshots,
    disclaimer:
      "Yahoo historical daily snapshots are paper-only replay inputs. They are not investment advice, guaranteed performance, or live trading signals."
  };
}

async function fetchYahooChart(input: {
  sourceSymbol: string;
  rangeStart: Date;
  rangeEnd: Date;
  fetcher: YahooFetch;
}): Promise<YahooChartResult> {
  const url = new URL(
    `${yahooChartEndpoint}/${encodeURIComponent(input.sourceSymbol)}`
  );
  url.searchParams.set("period1", String(toUnixSeconds(input.rangeStart)));
  url.searchParams.set(
    "period2",
    String(toUnixSeconds(input.rangeEnd) + secondsPerDay)
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");
  url.searchParams.set("includeAdjustedClose", "true");

  const response = await input.fetcher(url, {
    headers: {
      "User-Agent": "toss-trading-paper-replay/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(
      `Yahoo chart ${input.sourceSymbol} failed: ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as YahooChartResponse;
  const chartError = body.chart?.error;
  if (chartError) {
    throw new Error(
      `Yahoo chart ${input.sourceSymbol} error: ${
        chartError.description ?? chartError.code ?? "unknown"
      }`
    );
  }

  const result = body.chart?.result?.[0];
  if (result === undefined) {
    throw new Error(`Yahoo chart ${input.sourceSymbol} returned no result`);
  }

  return result;
}

function convertYahooChartToSnapshots(input: {
  chart: YahooChartResult;
  member: HistoricalUniverseMember;
  sourceSymbol: string;
  rangeStart: Date;
  rangeEnd: Date;
  fxRates: FxRate[];
  fxSourceSymbol: string;
  createdAt: Date;
}): { currency: string | null; snapshots: HistoricalMarketSnapshot[] } {
  const timestamps = input.chart.timestamp ?? [];
  const quote = input.chart.indicators?.quote?.[0] ?? {};
  const adjclose = input.chart.indicators?.adjclose?.[0]?.adjclose ?? [];
  const currency = input.chart.meta?.currency ?? null;
  const snapshots: HistoricalMarketSnapshot[] = [];

  for (const [index, timestamp] of timestamps.entries()) {
    const observedAtMs = timestamp * 1000;
    if (
      observedAtMs < input.rangeStart.getTime() ||
      observedAtMs > input.rangeEnd.getTime()
    ) {
      continue;
    }

    const close = quote.close?.[index] ?? adjclose[index];
    if (close === null || close === undefined || close <= 0) {
      continue;
    }

    const observedAt = new Date(observedAtMs);
    const dateKey = isoDateKey(observedAt);
    const conversion = conversionFor({
      market: input.member.market,
      currency,
      observedAtMs,
      fxRates: input.fxRates
    });
    const snapshot = parseWithSchema(
      historicalMarketSnapshotSchema,
      {
        snapshotId: `hist_yahoo_1d_${input.member.market}_${input.member.symbol}_${dateKey.replace(/-/g, "")}`,
        market: input.member.market,
        symbol: input.member.symbol,
        ...(input.member.assetType === undefined
          ? {}
          : { assetType: input.member.assetType }),
        ...(input.member.assetClass === undefined
          ? {}
          : { assetClass: input.member.assetClass }),
        ...(input.member.region === undefined ? {} : { region: input.member.region }),
        ...(input.member.riskTags === undefined
          ? {}
          : { riskTags: input.member.riskTags }),
        ...(input.member.strategyBucket === undefined
          ? {}
          : { strategyBucket: input.member.strategyBucket }),
        ...(input.member.sector === undefined
          ? {}
          : { sector: input.member.sector }),
        observedAt: observedAt.toISOString(),
        interval: "1d",
        ...priceFields({
          open: quote.open?.[index],
          high: quote.high?.[index],
          low: quote.low?.[index],
          close,
          factor: conversion.factor
        }),
        volume: quote.volume?.[index] ?? undefined,
        sourceRefs: [
          `yahoo_chart:${input.sourceSymbol}:${dateKey}`,
          ...(conversion.fxDateKey === null
            ? []
            : [`yahoo_fx:${input.fxSourceSymbol}:${conversion.fxDateKey}`])
        ],
        createdAt: input.createdAt.toISOString()
      },
      "historicalMarketSnapshot"
    );
    snapshots.push(snapshot);
  }

  return { currency, snapshots };
}

function priceFields(input: {
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number;
  factor: number;
}): Pick<
  HistoricalMarketSnapshot,
  "openPriceKrw" | "highPriceKrw" | "lowPriceKrw" | "closePriceKrw" | "lastPriceKrw"
> {
  const output: Pick<
    HistoricalMarketSnapshot,
    | "openPriceKrw"
    | "highPriceKrw"
    | "lowPriceKrw"
    | "closePriceKrw"
    | "lastPriceKrw"
  > = {
    closePriceKrw: toKrw(input.close, input.factor),
    lastPriceKrw: toKrw(input.close, input.factor)
  };
  if (input.open !== null && input.open !== undefined) {
    output.openPriceKrw = toKrw(input.open, input.factor);
  }
  if (input.high !== null && input.high !== undefined) {
    output.highPriceKrw = toKrw(input.high, input.factor);
  }
  if (input.low !== null && input.low !== undefined) {
    output.lowPriceKrw = toKrw(input.low, input.factor);
  }
  return output;
}

function extractFxRates(chart: YahooChartResult): FxRate[] {
  const timestamps = chart.timestamp ?? [];
  const quote = chart.indicators?.quote?.[0] ?? {};
  const rates: FxRate[] = [];
  for (const [index, timestamp] of timestamps.entries()) {
    const close = quote.close?.[index];
    if (close === null || close === undefined || close <= 0) {
      continue;
    }
    const observedAtMs = timestamp * 1000;
    rates.push({
      dateKey: isoDateKey(new Date(observedAtMs)),
      observedAtMs,
      rate: close
    });
  }
  return rates.sort((left, right) => left.observedAtMs - right.observedAtMs);
}

function conversionFor(input: {
  market: string;
  currency: string | null;
  observedAtMs: number;
  fxRates: FxRate[];
}): { factor: number; fxDateKey: string | null } {
  const currency = input.currency?.toUpperCase();
  if (currency === "KRW" || (currency === null && input.market === "KR")) {
    return { factor: 1, fxDateKey: null };
  }

  if (currency === "USD" || (currency === null && input.market === "US")) {
    const fxRate = latestFxRate(input.fxRates, input.observedAtMs);
    if (fxRate === undefined) {
      throw new Error("USD/KRW FX rate is missing for Yahoo USD conversion");
    }
    return { factor: fxRate.rate, fxDateKey: fxRate.dateKey };
  }

  throw new Error(`Unsupported Yahoo currency: ${input.currency ?? "unknown"}`);
}

function latestFxRate(rates: FxRate[], observedAtMs: number): FxRate | undefined {
  let latest: FxRate | undefined;
  for (const rate of rates) {
    if (rate.observedAtMs > observedAtMs) {
      break;
    }
    latest = rate;
  }
  return latest;
}

function sourceSymbolFor(member: HistoricalUniverseMember): string {
  return member.sourceSymbol ?? member.symbol;
}

function toKrw(value: number, factor: number): number {
  return Math.max(0, Math.round(value * factor));
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
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
