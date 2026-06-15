import type {
  AssetClass,
  AssetRegion,
  AssetRiskTag,
  AssetType,
  Market,
  VirtualPortfolio
} from "../domain/schemas.js";
import type { TossInvestCliCollectResult } from "../collectors/tossInvestCliCollector.js";
import {
  MarketPacketBuilder,
  type MarketCandidateDraft,
  type MarketPacketBuilderOptions,
  type MarketPacketBuildResult
} from "./packetBuilder.js";

export interface TossInvestNormalizationOptions {
  now: Date;
  sourceMaxAgeSeconds: number;
  candidateTtlSeconds: number;
  defaultMarket?: Market;
}

export interface TossInvestNormalizationResult {
  status: "ok" | "degraded";
  candidates: MarketCandidateDraft[];
  warnings: string[];
}

export interface TossInvestMarketPacketInput {
  portfolio: VirtualPortfolio;
  collectorResults: TossInvestCliCollectResult[];
  builderOptions: MarketPacketBuilderOptions;
  normalizationOptions: TossInvestNormalizationOptions;
}

export interface TossInvestMarketPacketBuildResult extends MarketPacketBuildResult {
  normalizationStatus: TossInvestNormalizationResult["status"];
}

type JsonRecord = Record<string, unknown>;

interface CandidateAccumulator {
  market: Market;
  symbol: string;
  reasonCodes: Set<string>;
  eventTags: Set<string>;
  newsRefs: Set<string>;
  sourceRefs: Set<string>;
  collectedAt: string;
  staleAfter: string;
  name?: string;
  assetType?: AssetType;
  assetClass?: AssetClass;
  region?: AssetRegion;
  riskTags?: Set<AssetRiskTag>;
  sector?: string;
  industry?: string;
  lastPriceKrw?: number;
  ranking?: number;
  score?: number;
  dividendYieldPct?: number;
  exDividendDate?: string;
}

const rankingRowKeys = ["items", "results", "rankings", "ranking", "stocks", "data"];
const signalRowKeys = ["items", "results", "signals", "stocks", "data"];
const quoteRowKeys = ["items", "results", "quotes", "stocks", "data"];

export function normalizeTossInvestCollectorResults(
  collectorResults: TossInvestCliCollectResult[],
  options: TossInvestNormalizationOptions
): TossInvestNormalizationResult {
  const warnings: string[] = [];
  const accumulators = new Map<string, CandidateAccumulator>();
  let degraded = false;

  for (const [sourceIndex, result] of collectorResults.entries()) {
    const sourceLabel = `tossinvest_cli:${result.commandKey}:${sourceIndex}`;

    if (result.status !== "ok") {
      degraded = true;
      warnings.push(
        `${sourceLabel} skipped: collector status ${result.status}${
          result.error ? ` (${result.error.code})` : ""
        }`
      );
      continue;
    }

    const collectedAt = parseIsoDate(result.metadata.collectedAt);
    if (!collectedAt) {
      degraded = true;
      warnings.push(`${sourceLabel} skipped: invalid collectedAt`);
      continue;
    }

    if (isOlderThan(collectedAt, options.now, options.sourceMaxAgeSeconds)) {
      degraded = true;
      warnings.push(`${sourceLabel} skipped: stale source`);
      continue;
    }

    const applied = applySource({
      result,
      sourceLabel,
      sourceIndex,
      collectedAt,
      accumulators,
      options,
      warnings
    });
    if (!applied) {
      degraded = true;
    }
  }

  return {
    status: degraded ? "degraded" : "ok",
    candidates: Array.from(accumulators.values()).map(toCandidateDraft),
    warnings
  };
}

export function buildMarketPacketFromTossInvestData(
  input: TossInvestMarketPacketInput
): TossInvestMarketPacketBuildResult {
  const normalized = normalizeTossInvestCollectorResults(
    input.collectorResults,
    input.normalizationOptions
  );
  const packetResult = new MarketPacketBuilder(input.builderOptions).build({
    portfolio: input.portfolio,
    candidates: normalized.candidates
  });

  return {
    packet: packetResult.packet,
    warnings: [...normalized.warnings, ...packetResult.warnings],
    normalizationStatus: normalized.status
  };
}

function applySource(input: {
  result: TossInvestCliCollectResult;
  sourceLabel: string;
  sourceIndex: number;
  collectedAt: Date;
  accumulators: Map<string, CandidateAccumulator>;
  options: TossInvestNormalizationOptions;
  warnings: string[];
}): boolean {
  switch (input.result.commandKey) {
    case "market.ranking":
      return applyRows(input, rankingRowKeys, "ranking");
    case "market.signals":
      return applyRows(input, signalRowKeys, "signals");
    case "quote.get":
    case "quote.batch":
      return applyRows(input, quoteRowKeys, "quote");
    default:
      input.warnings.push(
        `${input.sourceLabel} skipped: unsupported command for market packet normalization`
      );
      return false;
  }
}

function applyRows(
  input: Parameters<typeof applySource>[0],
  rowKeys: string[],
  kind: "ranking" | "signals" | "quote"
): boolean {
  const rows = extractRows(input.result.data, rowKeys, kind === "quote");
  if (!rows || rows.length === 0) {
    input.warnings.push(`${input.sourceLabel} skipped: malformed ${kind} output`);
    return false;
  }

  let appliedCount = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const record = asRecord(row);
    if (!record) {
      input.warnings.push(`${input.sourceLabel}:${rowIndex} skipped: row is not an object`);
      continue;
    }

    const candidate = createCandidatePatch(record, kind, input.options);
    if (!candidate) {
      input.warnings.push(`${input.sourceLabel}:${rowIndex} skipped: missing symbol`);
      continue;
    }

    upsertCandidate(input.accumulators, {
      ...candidate,
      sourceRef: `${input.sourceLabel}:${rowIndex}`,
      collectedAt: input.collectedAt,
      staleAfter: addSeconds(input.collectedAt, input.options.candidateTtlSeconds)
    });
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    input.warnings.push(`${input.sourceLabel} skipped: no valid candidates`);
    return false;
  }

  return true;
}

function createCandidatePatch(
  record: JsonRecord,
  kind: "ranking" | "signals" | "quote",
  options: TossInvestNormalizationOptions
): {
  market: Market;
  symbol: string;
  reasonCodes: string[];
  eventTags: string[];
  newsRefs: string[];
  name?: string;
  assetType?: AssetType;
  assetClass?: AssetClass;
  region?: AssetRegion;
  riskTags?: AssetRiskTag[];
  sector?: string;
  industry?: string;
  lastPriceKrw?: number;
  ranking?: number;
  score?: number;
  dividendYieldPct?: number;
  exDividendDate?: string;
} | null {
  const symbol = readString(record, ["symbol", "ticker", "code", "stockCode", "stock_code"]);
  if (!symbol) {
    return null;
  }

  const market = readMarket(record, options.defaultMarket ?? "KR");
  const reasonCodes = defaultReasonCodes(record, kind);
  const patch: {
    market: Market;
    symbol: string;
    reasonCodes: string[];
    eventTags: string[];
    newsRefs: string[];
    name?: string;
    assetType?: AssetType;
    assetClass?: AssetClass;
    region?: AssetRegion;
    riskTags?: AssetRiskTag[];
    sector?: string;
    industry?: string;
    lastPriceKrw?: number;
    ranking?: number;
    score?: number;
    dividendYieldPct?: number;
    exDividendDate?: string;
  } = {
    market,
    symbol: symbol.toUpperCase(),
    reasonCodes,
    eventTags: readEventTags(record),
    newsRefs: readNewsRefs(record)
  };

  const name = readString(record, ["name", "stockName", "stock_name", "displayName"]);
  if (name) {
    patch.name = name;
  }
  const assetType = readAssetType(record);
  if (assetType !== undefined) {
    patch.assetType = assetType;
  }
  const assetClass = readAssetClass(record, assetType);
  if (assetClass !== undefined) {
    patch.assetClass = assetClass;
  }
  const region = readAssetRegion(record, market);
  if (region !== undefined) {
    patch.region = region;
  }
  const riskTags = readAssetRiskTags(record);
  if (riskTags.length > 0) {
    patch.riskTags = riskTags;
  }
  const sector = readString(record, [
    "sector",
    "sectorName",
    "sector_name",
    "industrySector",
    "category"
  ]);
  if (sector) {
    patch.sector = sector;
  }
  const industry = readString(record, [
    "industry",
    "industryName",
    "industry_name",
    "subIndustry",
    "theme"
  ]);
  if (industry) {
    patch.industry = industry;
  }

  const explicitLastPriceKrw = readMoney(record, [
    "lastPriceKrw",
    "currentPriceKrw",
    "priceKrw"
  ]);
  const lastPriceKrw = explicitLastPriceKrw ?? readKrwQuoteMoney(record, [
    "lastPrice",
    "currentPrice",
    "price",
    "close",
    "last",
    "reference_price"
  ]);
  if (lastPriceKrw !== undefined) {
    patch.lastPriceKrw = lastPriceKrw;
  }

  const ranking = readPositiveInt(record, ["ranking", "rank", "rankNo", "rank_no"]);
  if (ranking !== undefined) {
    patch.ranking = ranking;
  }

  const score = readScore(record, ["score", "rankScore", "signalScore", "confidence"]);
  if (score !== undefined) {
    patch.score = score;
  }
  const dividendYieldPct = readPercent(record, [
    "dividendYieldPct",
    "dividendYield",
    "dividend_yield",
    "yieldPct"
  ]);
  if (dividendYieldPct !== undefined) {
    patch.dividendYieldPct = dividendYieldPct;
  }
  const exDividendDate = readString(record, [
    "exDividendDate",
    "ex_dividend_date",
    "dividendDate",
    "dividend_date"
  ]);
  if (exDividendDate !== undefined) {
    patch.exDividendDate = exDividendDate;
  }

  return patch;
}

function upsertCandidate(
  accumulators: Map<string, CandidateAccumulator>,
  patch: {
    market: Market;
    symbol: string;
    sourceRef: string;
    collectedAt: Date;
    staleAfter: Date;
    reasonCodes: string[];
    eventTags: string[];
    newsRefs: string[];
    name?: string;
    assetType?: AssetType;
    assetClass?: AssetClass;
    region?: AssetRegion;
    riskTags?: AssetRiskTag[];
    sector?: string;
    industry?: string;
    lastPriceKrw?: number;
    ranking?: number;
    score?: number;
    dividendYieldPct?: number;
    exDividendDate?: string;
  }
): void {
  const key = `${patch.market}:${patch.symbol}`;
  const current =
    accumulators.get(key) ??
    createAccumulator(patch.market, patch.symbol, patch.collectedAt, patch.staleAfter);

  for (const reasonCode of patch.reasonCodes) {
    current.reasonCodes.add(reasonCode);
  }
  for (const eventTag of patch.eventTags) {
    current.eventTags.add(eventTag);
  }
  for (const newsRef of patch.newsRefs) {
    current.newsRefs.add(newsRef);
  }
  current.sourceRefs.add(patch.sourceRef);
  current.collectedAt = maxIso(current.collectedAt, patch.collectedAt);
  current.staleAfter = minIso(current.staleAfter, patch.staleAfter);

  if (patch.name !== undefined) {
    current.name = patch.name;
  }
  if (patch.assetType !== undefined) {
    current.assetType = patch.assetType;
  }
  if (patch.assetClass !== undefined) {
    current.assetClass = patch.assetClass;
  }
  if (patch.region !== undefined) {
    current.region = patch.region;
  }
  if (patch.riskTags !== undefined) {
    const currentRiskTags = current.riskTags ?? new Set<AssetRiskTag>();
    for (const riskTag of patch.riskTags) {
      currentRiskTags.add(riskTag);
    }
    current.riskTags = currentRiskTags;
  }
  if (patch.sector !== undefined) {
    current.sector = patch.sector;
  }
  if (patch.industry !== undefined) {
    current.industry = patch.industry;
  }
  if (patch.lastPriceKrw !== undefined) {
    current.lastPriceKrw = patch.lastPriceKrw;
  }
  if (patch.ranking !== undefined) {
    current.ranking = patch.ranking;
  }
  if (patch.score !== undefined) {
    current.score = patch.score;
  }
  if (patch.dividendYieldPct !== undefined) {
    current.dividendYieldPct = patch.dividendYieldPct;
  }
  if (patch.exDividendDate !== undefined) {
    current.exDividendDate = patch.exDividendDate;
  }

  accumulators.set(key, current);
}

function createAccumulator(
  market: Market,
  symbol: string,
  collectedAt: Date,
  staleAfter: Date
): CandidateAccumulator {
  return {
    market,
    symbol,
    reasonCodes: new Set(),
    eventTags: new Set(),
    newsRefs: new Set(),
    sourceRefs: new Set(),
    collectedAt: collectedAt.toISOString(),
    staleAfter: staleAfter.toISOString()
  };
}

function toCandidateDraft(accumulator: CandidateAccumulator): MarketCandidateDraft {
  const candidate: MarketCandidateDraft = {
    market: accumulator.market,
    symbol: accumulator.symbol,
    reasonCodes: Array.from(accumulator.reasonCodes).sort(),
    eventTags: Array.from(accumulator.eventTags).sort(),
    newsRefs: Array.from(accumulator.newsRefs).sort(),
    sourceRefs: Array.from(accumulator.sourceRefs).sort(),
    collectedAt: accumulator.collectedAt,
    staleAfter: accumulator.staleAfter
  };

  if (accumulator.name !== undefined) {
    candidate.name = accumulator.name;
  }
  if (accumulator.assetType !== undefined) {
    candidate.assetType = accumulator.assetType;
  }
  if (accumulator.assetClass !== undefined) {
    candidate.assetClass = accumulator.assetClass;
  }
  if (accumulator.region !== undefined) {
    candidate.region = accumulator.region;
  }
  if (accumulator.riskTags !== undefined && accumulator.riskTags.size > 0) {
    candidate.riskTags = Array.from(accumulator.riskTags).sort();
  }
  if (accumulator.sector !== undefined) {
    candidate.sector = accumulator.sector;
  }
  if (accumulator.industry !== undefined) {
    candidate.industry = accumulator.industry;
  }
  if (accumulator.lastPriceKrw !== undefined) {
    candidate.lastPriceKrw = accumulator.lastPriceKrw;
  }
  if (accumulator.ranking !== undefined) {
    candidate.ranking = accumulator.ranking;
  }
  if (accumulator.score !== undefined) {
    candidate.score = accumulator.score;
  }
  if (accumulator.dividendYieldPct !== undefined) {
    candidate.dividendYieldPct = accumulator.dividendYieldPct;
  }
  if (accumulator.exDividendDate !== undefined) {
    candidate.exDividendDate = accumulator.exDividendDate;
  }

  return candidate;
}

function extractRows(
  data: unknown,
  rowKeys: string[],
  allowSingleRecord: boolean
): unknown[] | null {
  if (Array.isArray(data)) {
    return data;
  }

  const record = asRecord(data);
  if (!record) {
    return null;
  }

  for (const key of rowKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }

    const nestedRecord = asRecord(value);
    if (nestedRecord) {
      const nestedRows = extractRows(nestedRecord, rowKeys, false);
      if (nestedRows) {
        return nestedRows;
      }
    }
  }

  return allowSingleRecord ? [record] : null;
}

function asRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function defaultReasonCodes(
  record: JsonRecord,
  kind: "ranking" | "signals" | "quote"
): string[] {
  const codes = new Set<string>();
  if (kind === "ranking") {
    codes.add("TOSS_MARKET_RANKING");
  }
  if (kind === "signals") {
    codes.add("TOSS_MARKET_SIGNAL");
  }
  if (kind === "quote") {
    codes.add("TOSS_QUOTE");
  }

  for (const key of ["signal", "signalType", "keyword", "keywords", "reason", "reasons", "tags"]) {
    for (const value of readStringList(record[key])) {
      codes.add(toReasonCode(value));
    }
  }

  return Array.from(codes);
}

function readEventTags(record: JsonRecord): string[] {
  return Array.from(
    new Set([
      ...readStringList(record["eventTag"]),
      ...readStringList(record["eventTags"]),
      ...readStringList(record["event"]),
      ...readStringList(record["events"]),
      ...readStringList(record["catalyst"]),
      ...readStringList(record["catalysts"]),
      ...readStringList(record["earningsEvent"])
    ])
  ).sort();
}

function readNewsRefs(record: JsonRecord): string[] {
  return Array.from(
    new Set([
      ...readStringList(record["newsRef"]),
      ...readStringList(record["newsRefs"]),
      ...readStringList(record["newsUrl"]),
      ...readStringList(record["newsUrls"]),
      ...readStringList(record["articleUrl"]),
      ...readStringList(record["articleUrls"])
    ])
  ).sort();
}

function readAssetType(record: JsonRecord): AssetType | undefined {
  const explicit = readString(record, [
    "assetType",
    "asset_type",
    "instrumentType",
    "instrument_type",
    "securityType",
    "security_type",
    "type"
  ]);
  const fallbackName = readString(record, [
    "name",
    "stockName",
    "stock_name",
    "asset_name",
    "displayName"
  ]);
  const normalized = normalizeText(`${explicit ?? ""} ${fallbackName ?? ""}`);

  if (normalized.includes("ETF")) {
    return "ETF";
  }
  if (
    normalized.includes("STOCK") ||
    normalized.includes("STOCKS") ||
    normalized.includes("EQUITY") ||
    normalized.includes("SHARE")
  ) {
    return "STOCK";
  }

  return undefined;
}

function readAssetClass(
  record: JsonRecord,
  assetType: AssetType | undefined
): AssetClass | undefined {
  const explicit = readString(record, [
    "assetClass",
    "asset_class",
    "class",
    "category",
    "asset_type",
    "instrumentType",
    "instrument_type"
  ]);
  const text = normalizeText(
    [
      explicit,
      readString(record, ["name", "stockName", "stock_name", "asset_name"]),
      readString(record, ["title", "keyword", "theme", "sector"])
    ]
      .filter((value): value is string => value !== undefined)
      .join(" ")
  );

  if (text.includes("INVERSE") || text.includes("인버스")) {
    return "inverse";
  }
  if (
    text.includes("LEVERAGED") ||
    text.includes("LEVERAGE") ||
    text.includes("레버리지") ||
    /\b[23]X\b/.test(text)
  ) {
    return "leveraged";
  }
  if (
    text.includes("BOND") ||
    text.includes("TREASURY") ||
    text.includes("FIXED_INCOME") ||
    text.includes("채권")
  ) {
    return "bond";
  }
  if (
    text.includes("CASH") ||
    text.includes("MONEY_MARKET") ||
    text.includes("MMF")
  ) {
    return "cash_like";
  }
  if (
    text.includes("COMMODITY") ||
    text.includes("GOLD") ||
    text.includes("원자재") ||
    text.includes("금")
  ) {
    return "commodity";
  }
  if (
    text.includes("CURRENCY") ||
    text.includes("FX") ||
    text.includes("DOLLAR") ||
    text.includes("USD") ||
    text.includes("달러")
  ) {
    return "currency";
  }
  if (
    text.includes("EQUITY") ||
    text.includes("STOCK") ||
    text.includes("ETF") ||
    text.includes("주식")
  ) {
    return "equity";
  }

  return assetType === "STOCK" ? "equity" : undefined;
}

function readAssetRegion(
  record: JsonRecord,
  fallbackMarket: Market
): AssetRegion | undefined {
  const explicit = readString(record, [
    "region",
    "assetRegion",
    "asset_region",
    "investmentRegion",
    "investment_region",
    "country",
    "nation",
    "market",
    "exchange"
  ]);
  const normalized = normalizeText(explicit ?? "");

  if (["KR", "KOR", "KOREA", "KOSPI", "KOSDAQ"].includes(normalized)) {
    return "KR";
  }
  if (["US", "USA", "NASDAQ", "NYSE", "AMEX"].includes(normalized)) {
    return "US";
  }
  if (
    ["GLOBAL", "WORLD", "INTERNATIONAL"].includes(normalized) ||
    normalized.includes("GLOBAL")
  ) {
    return "GLOBAL";
  }

  return fallbackMarket;
}

function readAssetRiskTags(record: JsonRecord): AssetRiskTag[] {
  const text = normalizeText(
    [
      ...readStringList(record["riskTag"]),
      ...readStringList(record["riskTags"]),
      ...readStringList(record["risk_tags"]),
      ...readStringList(record["tags"]),
      readString(record, ["name", "stockName", "stock_name", "asset_name"]),
      readString(record, ["title", "keyword", "theme", "category"])
    ]
      .filter((value): value is string => value !== undefined)
      .join(" ")
  );
  const riskTags = new Set<AssetRiskTag>();

  if (text.includes("INVERSE") || text.includes("인버스")) {
    riskTags.add("inverse");
  }
  if (
    text.includes("LEVERAGED") ||
    text.includes("LEVERAGE") ||
    text.includes("레버리지") ||
    /\b[23]X\b/.test(text)
  ) {
    riskTags.add("leveraged");
  }
  if (
    text.includes("CURRENCY_EXPOSED") ||
    text.includes("UNHEDGED") ||
    text.includes("환노출")
  ) {
    riskTags.add("currency_exposed");
  }
  if (
    text.includes("SECTOR_CONCENTRATED") ||
    text.includes("SECTOR") ||
    text.includes("THEME") ||
    text.includes("TOP10") ||
    text.includes("섹터") ||
    text.includes("테마")
  ) {
    riskTags.add("sector_concentrated");
  }

  return Array.from(riskTags).sort();
}

function readString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => readStringList(item))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }

  return [];
}

function readMarket(record: JsonRecord, fallback: Market): Market {
  const value = readString(record, ["market", "nation", "country", "exchange"]);
  if (!value) {
    return fallback;
  }

  const normalized = value.toUpperCase();
  if (["KR", "KOR", "KOREA", "KOSPI", "KOSDAQ"].includes(normalized)) {
    return "KR";
  }
  if (["US", "USA", "NASDAQ", "NYSE", "AMEX"].includes(normalized)) {
    return "US";
  }

  return fallback;
}

function normalizeText(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function readMoney(record: JsonRecord, keys: string[]): number | undefined {
  const value = readFiniteNumber(record, keys);
  if (value === undefined || value < 0) {
    return undefined;
  }

  return Math.round(value);
}

function readKrwQuoteMoney(
  record: JsonRecord,
  keys: string[]
): number | undefined {
  const currency = readString(record, ["currency"]);
  if (currency && currency.toUpperCase() !== "KRW") {
    return undefined;
  }

  return readMoney(record, keys);
}

function readPositiveInt(record: JsonRecord, keys: string[]): number | undefined {
  const value = readFiniteNumber(record, keys);
  if (value === undefined || value <= 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function readScore(record: JsonRecord, keys: string[]): number | undefined {
  const value = readFiniteNumber(record, keys);
  if (value === undefined) {
    return undefined;
  }

  const normalized = value <= 1 ? value * 100 : value;
  if (normalized < 0 || normalized > 100) {
    return undefined;
  }

  return normalized;
}

function readPercent(record: JsonRecord, keys: string[]): number | undefined {
  const value = readFiniteNumber(record, keys);
  if (value === undefined || value < 0 || value > 100) {
    return undefined;
  }

  return value;
}

function readFiniteNumber(record: JsonRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.replace(/,/g, "").replace(/%/g, "").trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function toReasonCode(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? `TOSS_${normalized}` : "TOSS_SIGNAL";
}

function parseIsoDate(value: string): Date | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp);
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function isOlderThan(date: Date, now: Date, maxAgeSeconds: number): boolean {
  return date.getTime() + maxAgeSeconds * 1000 <= now.getTime();
}

function maxIso(currentIso: string, candidateDate: Date): string {
  const currentMs = Date.parse(currentIso);
  return candidateDate.getTime() > currentMs ? candidateDate.toISOString() : currentIso;
}

function minIso(currentIso: string, candidateDate: Date): string {
  const currentMs = Date.parse(currentIso);
  return candidateDate.getTime() < currentMs ? candidateDate.toISOString() : currentIso;
}
