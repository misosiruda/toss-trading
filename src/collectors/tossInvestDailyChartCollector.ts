import {
  historicalMarketSnapshotSchema,
  parseWithSchema,
  type HistoricalMarketSnapshot
} from "../domain/schemas.js";
import type { TossInvestHistoricalChartSymbol } from "./tossInvestHistoricalChartCollector.js";

export interface TossInvestDailyChartCollectorOptions {
  enabled: boolean;
  symbols: TossInvestHistoricalChartSymbol[];
  rangeStart: Date;
  rangeEnd: Date;
  pageSize?: number;
  maxPagesPerSymbol?: number;
  fetcher?: TossInvestDailyChartFetch;
  now?: () => Date;
}

export interface TossInvestDailyChartCollectorResult {
  mode: "paper_only";
  provider: "tossinvest_web_chart_day1";
  status: "completed" | "completed_with_failures";
  rangeStart: string;
  rangeEnd: string;
  pageSize: number;
  snapshotCount: number;
  symbolReports: TossInvestDailyChartSymbolReport[];
  snapshots: HistoricalMarketSnapshot[];
  disclaimer: string;
}

export interface TossInvestDailyChartSymbolReport {
  market: string;
  symbol: string;
  sourceSymbol: string;
  name: string | null;
  productCode: string | null;
  assetType: string | null;
  status: "completed" | "failed";
  pageCount: number;
  snapshotCount: number;
  error: string | null;
}

type TossInvestDailyChartFetch = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<TossInvestDailyChartFetchResponse>;

interface TossInvestDailyChartFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

type JsonRecord = Record<string, unknown>;

interface ResolvedProductMetadata {
  productCode: string;
  name: string | null;
}

const infoApiBase = "https://wts-info-api.tossinvest.com";
const endpointBase = `${infoApiBase}/api/v1/c-chart`;
const defaultPageSize = 450;
const defaultMaxPagesPerSymbol = 8;

export async function collectTossInvestDailyChartSnapshots(
  options: TossInvestDailyChartCollectorOptions
): Promise<TossInvestDailyChartCollectorResult> {
  validateOptions(options);

  const pageSize = options.pageSize ?? defaultPageSize;
  const maxPagesPerSymbol =
    options.maxPagesPerSymbol ?? defaultMaxPagesPerSymbol;
  const rangeStartKey = kstDateKey(options.rangeStart);
  const rangeEndKey = kstDateKey(options.rangeEnd);
  const createdAt = (options.now ?? (() => new Date()))();
  const fetcher = options.fetcher ?? fetch;
  const snapshots: HistoricalMarketSnapshot[] = [];
  const symbolReports: TossInvestDailyChartSymbolReport[] = [];

  for (const symbol of options.symbols) {
    const sourceSymbol = symbol.sourceSymbol ?? symbol.symbol;
    let resolvedProduct: ResolvedProductMetadata | null = null;
    if (!options.enabled) {
      symbolReports.push({
        market: symbol.market,
        symbol: symbol.symbol,
        sourceSymbol,
        name: cleanString(symbol.name),
        productCode: null,
        assetType: symbol.assetType ?? null,
        status: "failed",
        pageCount: 0,
        snapshotCount: 0,
        error: "COLLECTOR_DISABLED: TossInvest daily chart collector is disabled"
      });
      continue;
    }

    try {
      resolvedProduct = await resolveProductMetadata({
        symbol,
        sourceSymbol,
        fetcher
      });
      const collected = await fetchSymbolDailyCandles({
        symbol,
        sourceSymbol,
        productCode: resolvedProduct.productCode,
        rangeStartKey,
        pageSize,
        maxPagesPerSymbol,
        fetcher
      });
      const converted = convertDailyCandlesToSnapshots({
        symbol,
        sourceSymbol,
        productCode: resolvedProduct.productCode,
        name: resolvedProduct.name,
        candles: collected.candles,
        rangeStartKey,
        rangeEndKey,
        createdAt
      });
      snapshots.push(...converted);
      symbolReports.push({
        market: symbol.market,
        symbol: symbol.symbol,
        sourceSymbol,
        name: resolvedProduct.name,
        productCode: resolvedProduct.productCode,
        assetType: symbol.assetType ?? null,
        status: converted.length > 0 ? "completed" : "failed",
        pageCount: collected.pageCount,
        snapshotCount: converted.length,
        error: converted.length > 0 ? null : "NO_DAILY_PRICE_ROWS"
      });
    } catch (error) {
      symbolReports.push({
        market: symbol.market,
        symbol: symbol.symbol,
        sourceSymbol,
        name: resolvedProduct?.name ?? cleanString(symbol.name),
        productCode: resolvedProduct?.productCode ?? null,
        assetType: symbol.assetType ?? null,
        status: "failed",
        pageCount: 0,
        snapshotCount: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const sortedSnapshots = snapshots.sort(compareSnapshots);
  return {
    mode: "paper_only",
    provider: "tossinvest_web_chart_day1",
    status: symbolReports.some((report) => report.status === "failed")
      ? "completed_with_failures"
      : "completed",
    rangeStart: options.rangeStart.toISOString(),
    rangeEnd: options.rangeEnd.toISOString(),
    pageSize,
    snapshotCount: sortedSnapshots.length,
    symbolReports,
    snapshots: sortedSnapshots,
    disclaimer:
      "TossInvest day:1 chart snapshots are unofficial read-only paper replay inputs. They are not investment advice, guaranteed performance, or live trading signals."
  };
}

async function fetchSymbolDailyCandles(input: {
  symbol: TossInvestHistoricalChartSymbol;
  sourceSymbol: string;
  productCode: string;
  rangeStartKey: string;
  pageSize: number;
  maxPagesPerSymbol: number;
  fetcher: TossInvestDailyChartFetch;
}): Promise<{ candles: JsonRecord[]; pageCount: number }> {
  const candles: JsonRecord[] = [];
  let from: string | null = null;
  let previousFrom: string | null = null;

  for (let page = 0; page < input.maxPagesPerSymbol; page += 1) {
    const body = await fetchDailyChartPage({
      symbol: input.symbol,
      sourceSymbol: input.sourceSymbol,
      productCode: input.productCode,
      pageSize: input.pageSize,
      from,
      fetcher: input.fetcher
    });
    const pageCandles = body.candles;
    candles.push(...pageCandles);

    const oldestDateKey = oldestLocalDateKey(pageCandles);
    if (
      pageCandles.length === 0 ||
      oldestDateKey === null ||
      oldestDateKey <= input.rangeStartKey
    ) {
      return { candles, pageCount: page + 1 };
    }

    const next = typeof body.nextDateTime === "string" ? body.nextDateTime : null;
    if (!next || next === from || next === previousFrom) {
      return { candles, pageCount: page + 1 };
    }
    previousFrom = from;
    from = next;
  }

  throw new Error(
    `daily chart pagination exceeded ${input.maxPagesPerSymbol} pages`
  );
}

async function fetchDailyChartPage(input: {
  symbol: TossInvestHistoricalChartSymbol;
  sourceSymbol: string;
  productCode: string;
  pageSize: number;
  from: string | null;
  fetcher: TossInvestDailyChartFetch;
}): Promise<{ candles: JsonRecord[]; nextDateTime: unknown }> {
  const securityType = securityTypeFor(input.productCode, input.symbol.market);
  const url = new URL(
    `${endpointBase}/${securityType}/${encodeURIComponent(input.productCode)}/day:1`
  );
  url.searchParams.set("count", String(input.pageSize));
  url.searchParams.set("session", "all");
  url.searchParams.set("investMode", "integrated");
  url.searchParams.set("useAdjustedRate", "true");
  if (input.from) {
    url.searchParams.set("from", input.from);
  }

  const response = await input.fetcher(url, {
    headers: {
      "User-Agent": "toss-trading-paper-replay/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(
      `TossInvest day chart ${input.sourceSymbol} failed: ${response.status} ${response.statusText}`
    );
  }

  const root = asRecord(await response.json());
  const result = asRecord(root?.["result"]);
  const candles = result?.["candles"];
  if (!Array.isArray(candles)) {
    throw new Error(`TossInvest day chart ${input.sourceSymbol} returned no candles`);
  }

  return {
    candles: candles.map(asRecord).filter((item): item is JsonRecord => item !== null),
    nextDateTime: result?.["nextDateTime"]
  };
}

function convertDailyCandlesToSnapshots(input: {
  symbol: TossInvestHistoricalChartSymbol;
  sourceSymbol: string;
  productCode: string;
  name: string | null;
  candles: JsonRecord[];
  rangeStartKey: string;
  rangeEndKey: string;
  createdAt: Date;
}): HistoricalMarketSnapshot[] {
  const snapshotsByKey = new Map<string, HistoricalMarketSnapshot>();
  for (const candle of input.candles) {
    const observedAt = readDate(candle, ["dt", "time", "observedAt"]);
    const localDateKey = readLocalDateKey(candle);
    const close = readPrice(candle, ["close", "closePrice", "last"]);
    if (
      !observedAt ||
      !localDateKey ||
      localDateKey < input.rangeStartKey ||
      localDateKey > input.rangeEndKey ||
      close === undefined
    ) {
      continue;
    }

    const snapshot = parseWithSchema(
      historicalMarketSnapshotSchema,
      {
        snapshotId: snapshotIdFor(input.symbol, localDateKey),
        market: input.symbol.market,
        symbol: input.symbol.symbol,
        ...(input.name === null ? {} : { name: input.name }),
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
        ...(input.symbol.sector === undefined
          ? {}
          : { sector: input.symbol.sector }),
        observedAt: observedAt.toISOString(),
        interval: "1d",
        ...optionalPrice("openPriceKrw", readPrice(candle, ["open", "openPrice"])),
        ...optionalPrice("highPriceKrw", readPrice(candle, ["high", "highPrice"])),
        ...optionalPrice("lowPriceKrw", readPrice(candle, ["low", "lowPrice"])),
        closePriceKrw: close,
        lastPriceKrw: close,
        ...optionalNumber("volume", readNonNegativeNumber(candle, ["volume"])),
        sourceRefs: [
          `tossinvest_web:c-chart:day:1:${input.productCode}:${localDateKey}`
        ],
        createdAt: input.createdAt.toISOString()
      },
      "historicalMarketSnapshot"
    );
    snapshotsByKey.set(`${input.symbol.market}:${input.symbol.symbol}:${localDateKey}`, snapshot);
  }
  return [...snapshotsByKey.values()];
}

function validateOptions(options: TossInvestDailyChartCollectorOptions): void {
  if (options.symbols.length === 0) {
    throw new Error("at least one symbol is required");
  }
  if (!Number.isFinite(options.rangeStart.getTime())) {
    throw new Error("rangeStart must be a valid date");
  }
  if (!Number.isFinite(options.rangeEnd.getTime())) {
    throw new Error("rangeEnd must be a valid date");
  }
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }
  const pageSize = options.pageSize ?? defaultPageSize;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 450) {
    throw new Error("pageSize must be an integer between 1 and 450");
  }
}

async function resolveProductMetadata(input: {
  symbol: TossInvestHistoricalChartSymbol;
  sourceSymbol: string;
  fetcher: TossInvestDailyChartFetch;
}): Promise<ResolvedProductMetadata> {
  const fallbackName = cleanString(input.symbol.name);
  const direct = directProductCodeFor(input.sourceSymbol, input.symbol.market);
  if (direct !== null && fallbackName !== null) {
    return { productCode: direct, name: fallbackName };
  }

  const queries = productSearchQueriesFor(
    input.sourceSymbol,
    input.symbol.market,
    direct
  );
  for (const query of queries) {
    const found = await searchProductMetadata({
      query,
      market: input.symbol.market,
      preferredProductCode: direct,
      fetcher: input.fetcher
    });
    if (found !== null) {
      return {
        productCode: direct ?? found.productCode,
        name: found.name ?? fallbackName
      };
    }
  }

  if (direct !== null) {
    return { productCode: direct, name: fallbackName };
  }

  throw new Error(`no TossInvest product code result returned for ${input.sourceSymbol}`);
}

function directProductCodeFor(sourceSymbol: string, market: string): string | null {
  const trimmed = sourceSymbol.trim().toUpperCase();
  const normalized =
    market === "KR" ? trimmed.replace(/\.(KS|KQ)$/u, "") : trimmed;
  if (/^\d{6}$/u.test(normalized)) {
    return `A${normalized}`;
  }
  return looksLikeProductCode(normalized) ? normalized : null;
}

function productSearchQueriesFor(
  sourceSymbol: string,
  market: string,
  directProductCode: string | null = null
): string[] {
  const trimmed = sourceSymbol.trim().toUpperCase();
  const normalized =
    market === "KR" ? trimmed.replace(/\.(KS|KQ)$/u, "") : trimmed;
  const queries = [normalized, trimmed];
  if (directProductCode !== null) {
    queries.push(directProductCode);
  }
  if (market === "US" && trimmed.includes("-")) {
    queries.push(trimmed.replace(/-/gu, "."));
  }
  if (market === "US" && trimmed.includes(".")) {
    queries.push(trimmed.replace(/\./gu, "-"));
  }
  return Array.from(new Set(queries)).filter((query) => query.length > 0);
}

async function searchProductCode(input: {
  query: string;
  market: string;
  fetcher: TossInvestDailyChartFetch;
}): Promise<string | null> {
  return (
    await searchProductMetadata({
      ...input,
      preferredProductCode: null
    })
  )?.productCode ?? null;
}

async function searchProductMetadata(input: {
  query: string;
  market: string;
  preferredProductCode: string | null;
  fetcher: TossInvestDailyChartFetch;
}): Promise<ResolvedProductMetadata | null> {
  const response = await input.fetcher(`${infoApiBase}/api/v2/search/stocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "toss-trading-paper-replay/0.1"
    },
    body: JSON.stringify({ query: input.query })
  });
  if (!response.ok) {
    throw new Error(
      `TossInvest product search ${input.query} failed: ${response.status} ${response.statusText}`
    );
  }

  const root = asRecord(await response.json());
  const result = asRecord(root?.["result"]);
  const stocks = result?.["stocks"];
  if (!Array.isArray(stocks)) {
    return null;
  }

  const matches = stocks.map(asRecord).filter((item): item is JsonRecord => item !== null);
  const marketMatches = matches.filter((item) =>
    productCodeMatchesMarket(readString(item, "stockCode"), input.market)
  );
  const candidates = marketMatches.length > 0 ? marketMatches : matches;
  const preferred =
    input.preferredProductCode === null
      ? undefined
      : candidates.find(
          (item) => readString(item, "stockCode") === input.preferredProductCode
        );
  const exact =
    preferred ??
    candidates.find((item) => readString(item, "matchType") === "EXACT") ??
    candidates.find(
      (item) => normalizeTicker(readString(item, "stockName")) === normalizeTicker(input.query)
    );
  const selected = exact ?? candidates[0];
  const productCode = readString(selected, "stockCode");
  if (productCode === null) {
    return null;
  }
  return {
    productCode,
    name: readString(selected, "stockName")
  };
}

function looksLikeProductCode(value: string): boolean {
  if (/^A\d{6}$/u.test(value)) {
    return true;
  }
  return /^[A-Z]{2}\d{6,}$/u.test(value);
}

function productCodeMatchesMarket(productCode: string | null, market: string): boolean {
  if (productCode === null) {
    return false;
  }
  if (market === "KR") {
    return productCode.startsWith("A");
  }
  if (market === "US") {
    return productCode.startsWith("US");
  }
  return false;
}

function securityTypeFor(productCode: string, market: string): string {
  if (market === "KR") {
    return "kr-s";
  }
  return productCode.startsWith("A") ? "us-s" : "us-s";
}

function readString(record: JsonRecord | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function cleanString(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeTicker(value: string | null): string {
  return (value ?? "").trim().toUpperCase().replace(/\./gu, "-");
}

function readLocalDateKey(record: JsonRecord): string | null {
  for (const key of ["dt", "time", "observedAt"]) {
    const value = record[key];
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }
  }
  return null;
}

function oldestLocalDateKey(candles: JsonRecord[]): string | null {
  const keys = candles
    .map(readLocalDateKey)
    .filter((value): value is string => value !== null)
    .sort();
  return keys[0] ?? null;
}

function snapshotIdFor(
  symbol: TossInvestHistoricalChartSymbol,
  localDateKey: string
): string {
  return `hist_tossinvest_day1_${symbol.market}_${symbol.symbol}_${localDateKey.replace(
    /[^0-9]/g,
    ""
  )}`;
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

function kstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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
