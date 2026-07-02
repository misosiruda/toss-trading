import { z } from "zod";

import {
  assetClassSchema,
  assetRegionSchema,
  assetRiskTagSchema,
  assetTypeSchema,
  type AssetType,
  type HistoricalMarketSnapshot,
  instrumentLifecycleStatusSchema,
  type Market,
  marketSchema,
  parseWithSchema
} from "../domain/schemas.js";
import type { HistoricalDataAvailabilitySymbolRequirement } from "./historicalDataAvailability.js";

const isoCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD calendar date")
  .refine(isValidCalendarDate, "Expected a valid calendar date");

export const historicalInstrumentLifecycleStatusSchema =
  instrumentLifecycleStatusSchema;

export const historicalUniverseMemberSchema = z
  .object({
    market: marketSchema,
    symbol: z.string().trim().min(1),
    sourceSymbol: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    assetType: assetTypeSchema.optional(),
    assetClass: assetClassSchema.optional(),
    region: assetRegionSchema.optional(),
    riskTags: z.array(assetRiskTagSchema).optional(),
    sector: z.string().trim().min(1).optional(),
    segment: z.string().trim().min(1).optional(),
    lifecycleStatus: historicalInstrumentLifecycleStatusSchema.default(
      "unknown"
    ),
    required: z.boolean().default(true),
    tags: z.array(z.string().trim().min(1)).optional()
  })
  .strict();

export const historicalUniverseManifestSchema = z
  .object({
    mode: z.literal("paper_only_historical_universe"),
    universeId: z.string().trim().min(1),
    snapshotDate: isoCalendarDateSchema,
    description: z.string().trim().min(1).optional(),
    symbols: z.array(historicalUniverseMemberSchema).min(1),
    disclaimer: z.string().trim().min(1)
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, symbol] of value.symbols.entries()) {
      const key = symbolKey(symbol);
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["symbols", index, "symbol"],
          message: "universe symbols must be unique by market and symbol"
        });
      }
      seen.add(key);
    }
  });

export type HistoricalUniverseMember = z.infer<
  typeof historicalUniverseMemberSchema
>;
export type HistoricalUniverseManifest = z.infer<
  typeof historicalUniverseManifestSchema
>;

export interface HistoricalUniverseCoverageOptions {
  snapshots: HistoricalMarketSnapshot[];
  universe: HistoricalUniverseManifest;
  rangeStart: Date;
  rangeEnd: Date;
  corruptLineCount?: number;
  timezoneOffsetMinutes?: number;
  minMonthlyCoverageRatio?: number;
  minSnapshotsPerSymbol?: number;
  minAvailableSymbolCount?: number;
  minAvailableMarketSymbolCounts?: Partial<Record<Market, number>>;
  minAvailableAssetTypeSymbolCounts?: Partial<Record<AssetType, number>>;
  requireOptionalSymbols?: boolean;
  requiredMarkets?: Market[];
  requiredAssetTypes?: AssetType[];
}

export interface HistoricalUniverseCoverageSymbolSummary {
  market: Market;
  symbol: string;
  sourceSymbol: string | null;
  name: string | null;
  assetType: string | null;
  assetClass: string | null;
  region: string | null;
  riskTags: string[];
  sector: string | null;
  segment: string | null;
  required: boolean;
  snapshotCount: number;
  coveredMonthCount: number;
  expectedMonthCount: number;
  monthlyCoverageRatio: number;
  earliestObservedAt: string | null;
  latestObservedAt: string | null;
  missingMonths: string[];
  available: boolean;
}

export interface HistoricalUniverseCoverageReport {
  mode: "paper_only";
  universeId: string;
  status: "available" | "insufficient";
  rangeStart: string;
  rangeEnd: string;
  timezoneOffsetMinutes: number;
  expectedMonths: string[];
  minMonthlyCoverageRatio: number;
  minSnapshotsPerSymbol: number;
  minAvailableSymbolCount: number;
  minAvailableMarketSymbolCounts: Partial<Record<Market, number>>;
  minAvailableAssetTypeSymbolCounts: Partial<Record<AssetType, number>>;
  requireOptionalSymbols: boolean;
  requiredMarkets: Market[];
  requiredAssetTypes: AssetType[];
  availableMarkets: Market[];
  availableAssetTypes: AssetType[];
  availableSymbolCount: number;
  availableMarketSymbolCounts: Partial<Record<Market, number>>;
  availableAssetTypeSymbolCounts: Partial<Record<AssetType, number>>;
  missingRequiredMarkets: Market[];
  missingRequiredAssetTypes: AssetType[];
  insufficientAvailableMarketSymbolCounts: Array<{
    market: Market;
    minimum: number;
    available: number;
  }>;
  insufficientAvailableAssetTypeSymbolCounts: Array<{
    assetType: AssetType;
    minimum: number;
    available: number;
  }>;
  corruptLineCount: number;
  universeSymbolCount: number;
  requiredSymbolCount: number;
  optionalSymbolCount: number;
  availableRequiredSymbolCount: number;
  availableOptionalSymbolCount: number;
  missingRequiredSymbols: HistoricalDataAvailabilitySymbolRequirement[];
  missingOptionalSymbols: HistoricalDataAvailabilitySymbolRequirement[];
  insufficientRequiredSymbols: HistoricalUniverseCoverageSymbolSummary[];
  insufficientOptionalSymbols: HistoricalUniverseCoverageSymbolSummary[];
  symbolSummaries: HistoricalUniverseCoverageSymbolSummary[];
  issues: string[];
  disclaimer: string;
}

const DEFAULT_TIMEZONE_OFFSET_MINUTES = 540;
const DEFAULT_MIN_MONTHLY_COVERAGE_RATIO = 1;
const DEFAULT_MIN_SNAPSHOTS_PER_SYMBOL = 1;

export function parseHistoricalUniverseManifest(
  value: unknown
): HistoricalUniverseManifest {
  return parseWithSchema(
    historicalUniverseManifestSchema,
    value,
    "historicalUniverseManifest"
  );
}

export function requiredSymbolsFromHistoricalUniverse(
  universe: HistoricalUniverseManifest,
  options: { includeOptional?: boolean } = {}
): HistoricalDataAvailabilitySymbolRequirement[] {
  return universe.symbols
    .filter((symbol) => symbol.required || options.includeOptional === true)
    .map((symbol) => ({
      market: symbol.market,
      symbol: symbol.symbol
    }))
    .sort(compareRequirements);
}

export function assessHistoricalUniverseCoverage(
  options: HistoricalUniverseCoverageOptions
): HistoricalUniverseCoverageReport {
  validateDate(options.rangeStart, "rangeStart");
  validateDate(options.rangeEnd, "rangeEnd");
  if (options.rangeStart.getTime() > options.rangeEnd.getTime()) {
    throw new Error("rangeStart must be before or equal to rangeEnd");
  }

  const timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ?? DEFAULT_TIMEZONE_OFFSET_MINUTES;
  if (!Number.isInteger(timezoneOffsetMinutes)) {
    throw new Error("timezoneOffsetMinutes must be an integer");
  }
  const minMonthlyCoverageRatio =
    options.minMonthlyCoverageRatio ?? DEFAULT_MIN_MONTHLY_COVERAGE_RATIO;
  validateRatio(minMonthlyCoverageRatio, "minMonthlyCoverageRatio");
  const minSnapshotsPerSymbol =
    options.minSnapshotsPerSymbol ?? DEFAULT_MIN_SNAPSHOTS_PER_SYMBOL;
  validateNonNegativeInteger(minSnapshotsPerSymbol, "minSnapshotsPerSymbol");
  const minAvailableSymbolCount = options.minAvailableSymbolCount ?? 0;
  validateNonNegativeInteger(
    minAvailableSymbolCount,
    "minAvailableSymbolCount"
  );
  const minAvailableMarketSymbolCounts = normalizeCountRecord(
    options.minAvailableMarketSymbolCounts ?? {},
    "minAvailableMarketSymbolCounts"
  );
  const minAvailableAssetTypeSymbolCounts = normalizeCountRecord(
    options.minAvailableAssetTypeSymbolCounts ?? {},
    "minAvailableAssetTypeSymbolCounts"
  );
  const corruptLineCount = options.corruptLineCount ?? 0;
  validateNonNegativeInteger(corruptLineCount, "corruptLineCount");

  const expectedMonths = listLocalYearMonths({
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
    timezoneOffsetMinutes
  });
  const expectedMonthSet = new Set(expectedMonths);
  const snapshotsBySymbol = snapshotsInRangeBySymbol({
    snapshots: options.snapshots,
    rangeStart: options.rangeStart,
    rangeEnd: options.rangeEnd,
    timezoneOffsetMinutes,
    expectedMonthSet
  });
  const symbolSummaries = options.universe.symbols
    .map((member) =>
      summarizeUniverseMember({
        member,
        snapshots: snapshotsBySymbol.get(symbolKey(member)) ?? [],
        expectedMonths,
        minMonthlyCoverageRatio,
        minSnapshotsPerSymbol,
        timezoneOffsetMinutes
      })
    )
    .sort(compareSymbolSummaries);
  const missingRequiredSymbols = missingSymbols(symbolSummaries, true);
  const missingOptionalSymbols = missingSymbols(symbolSummaries, false);
  const insufficientRequiredSymbols = symbolSummaries.filter(
    (summary) =>
      summary.required && summary.snapshotCount > 0 && !summary.available
  );
  const insufficientOptionalSymbols = symbolSummaries.filter(
    (summary) =>
      !summary.required && summary.snapshotCount > 0 && !summary.available
  );
  const requireOptionalSymbols = options.requireOptionalSymbols === true;
  const requiredMarkets = uniqueSorted(options.requiredMarkets ?? []);
  const requiredAssetTypes = uniqueSorted(options.requiredAssetTypes ?? []);
  const availableSymbolCount = symbolSummaries.filter(
    (summary) => summary.available
  ).length;
  const availableMarkets = uniqueSorted(
    symbolSummaries
      .filter((summary) => summary.available)
      .map((summary) => summary.market)
  );
  const availableAssetTypes = uniqueSorted(
    symbolSummaries
      .filter((summary) => summary.available && summary.assetType !== null)
      .map((summary) => summary.assetType as AssetType)
  );
  const availableMarketSymbolCounts = countAvailableMarkets(symbolSummaries);
  const availableAssetTypeSymbolCounts =
    countAvailableAssetTypes(symbolSummaries);
  const missingRequiredMarkets = requiredMarkets.filter(
    (market) => !availableMarkets.includes(market)
  );
  const missingRequiredAssetTypes = requiredAssetTypes.filter(
    (assetType) => !availableAssetTypes.includes(assetType)
  );
  const insufficientAvailableMarketSymbolCounts =
    insufficientMarketSymbolCounts({
      minimumCounts: minAvailableMarketSymbolCounts,
      availableCounts: availableMarketSymbolCounts
    });
  const insufficientAvailableAssetTypeSymbolCounts =
    insufficientAssetTypeSymbolCounts({
      minimumCounts: minAvailableAssetTypeSymbolCounts,
      availableCounts: availableAssetTypeSymbolCounts
    });
  const issues = coverageIssues({
    corruptLineCount,
    missingRequiredSymbols,
    missingOptionalSymbols,
    insufficientRequiredSymbols,
    insufficientOptionalSymbols,
    requireOptionalSymbols,
    missingRequiredMarkets,
    missingRequiredAssetTypes,
    availableSymbolCount,
    minAvailableSymbolCount,
    insufficientAvailableMarketSymbolCounts,
    insufficientAvailableAssetTypeSymbolCounts
  });

  return {
    mode: "paper_only",
    universeId: options.universe.universeId,
    status: issues.length === 0 ? "available" : "insufficient",
    rangeStart: options.rangeStart.toISOString(),
    rangeEnd: options.rangeEnd.toISOString(),
    timezoneOffsetMinutes,
    expectedMonths,
    minMonthlyCoverageRatio,
    minSnapshotsPerSymbol,
    minAvailableSymbolCount,
    minAvailableMarketSymbolCounts,
    minAvailableAssetTypeSymbolCounts,
    requireOptionalSymbols,
    requiredMarkets,
    requiredAssetTypes,
    availableMarkets,
    availableAssetTypes,
    availableSymbolCount,
    availableMarketSymbolCounts,
    availableAssetTypeSymbolCounts,
    missingRequiredMarkets,
    missingRequiredAssetTypes,
    insufficientAvailableMarketSymbolCounts,
    insufficientAvailableAssetTypeSymbolCounts,
    corruptLineCount,
    universeSymbolCount: symbolSummaries.length,
    requiredSymbolCount: symbolSummaries.filter((summary) => summary.required)
      .length,
    optionalSymbolCount: symbolSummaries.filter((summary) => !summary.required)
      .length,
    availableRequiredSymbolCount: symbolSummaries.filter(
      (summary) => summary.required && summary.available
    ).length,
    availableOptionalSymbolCount: symbolSummaries.filter(
      (summary) => !summary.required && summary.available
    ).length,
    missingRequiredSymbols,
    missingOptionalSymbols,
    insufficientRequiredSymbols,
    insufficientOptionalSymbols,
    symbolSummaries,
    issues,
    disclaimer:
      "Paper-only historical universe coverage. This is not investment advice, not a performance guarantee, and not a live trading signal."
  };
}

function summarizeUniverseMember(input: {
  member: HistoricalUniverseMember;
  snapshots: HistoricalMarketSnapshot[];
  expectedMonths: string[];
  minMonthlyCoverageRatio: number;
  minSnapshotsPerSymbol: number;
  timezoneOffsetMinutes: number;
}): HistoricalUniverseCoverageSymbolSummary {
  const observedMonths = new Set(
    input.snapshots.map((snapshot) =>
      localYearMonth(Date.parse(snapshot.observedAt), input.timezoneOffsetMinutes)
    )
  );
  const missingMonths = input.expectedMonths.filter(
    (month) => !observedMonths.has(month)
  );
  const coveredMonthCount = input.expectedMonths.length - missingMonths.length;
  const monthlyCoverageRatio =
    input.expectedMonths.length === 0
      ? 0
      : roundRatio(coveredMonthCount / input.expectedMonths.length);
  const sortedSnapshots = [...input.snapshots].sort(compareSnapshots);
  const available =
    sortedSnapshots.length >= input.minSnapshotsPerSymbol &&
    monthlyCoverageRatio >= input.minMonthlyCoverageRatio;

  return {
    market: input.member.market,
    symbol: input.member.symbol,
    sourceSymbol: input.member.sourceSymbol ?? null,
    name: input.member.name ?? null,
    assetType: input.member.assetType ?? null,
    assetClass: input.member.assetClass ?? null,
    region: input.member.region ?? null,
    riskTags: input.member.riskTags ?? [],
    sector: input.member.sector ?? null,
    segment: input.member.segment ?? null,
    required: input.member.required,
    snapshotCount: sortedSnapshots.length,
    coveredMonthCount,
    expectedMonthCount: input.expectedMonths.length,
    monthlyCoverageRatio,
    earliestObservedAt: sortedSnapshots[0]?.observedAt ?? null,
    latestObservedAt: sortedSnapshots.at(-1)?.observedAt ?? null,
    missingMonths,
    available
  };
}

function snapshotsInRangeBySymbol(input: {
  snapshots: HistoricalMarketSnapshot[];
  rangeStart: Date;
  rangeEnd: Date;
  timezoneOffsetMinutes: number;
  expectedMonthSet: Set<string>;
}): Map<string, HistoricalMarketSnapshot[]> {
  const bySymbol = new Map<string, HistoricalMarketSnapshot[]>();
  for (const snapshot of input.snapshots) {
    const observedAtMs = Date.parse(snapshot.observedAt);
    if (
      !Number.isFinite(observedAtMs) ||
      observedAtMs < input.rangeStart.getTime() ||
      observedAtMs > input.rangeEnd.getTime()
    ) {
      continue;
    }
    const month = localYearMonth(observedAtMs, input.timezoneOffsetMinutes);
    if (!input.expectedMonthSet.has(month)) {
      continue;
    }
    const key = symbolKey(snapshot);
    const values = bySymbol.get(key);
    if (values === undefined) {
      bySymbol.set(key, [snapshot]);
      continue;
    }
    values.push(snapshot);
  }
  return bySymbol;
}

function missingSymbols(
  summaries: HistoricalUniverseCoverageSymbolSummary[],
  required: boolean
): HistoricalDataAvailabilitySymbolRequirement[] {
  return summaries
    .filter(
      (summary) => summary.required === required && summary.snapshotCount === 0
    )
    .map((summary) => ({
      market: summary.market,
      symbol: summary.symbol
    }));
}

function coverageIssues(input: {
  corruptLineCount: number;
  missingRequiredSymbols: HistoricalDataAvailabilitySymbolRequirement[];
  missingOptionalSymbols: HistoricalDataAvailabilitySymbolRequirement[];
  insufficientRequiredSymbols: HistoricalUniverseCoverageSymbolSummary[];
  insufficientOptionalSymbols: HistoricalUniverseCoverageSymbolSummary[];
  requireOptionalSymbols: boolean;
  missingRequiredMarkets: Market[];
  missingRequiredAssetTypes: AssetType[];
  availableSymbolCount: number;
  minAvailableSymbolCount: number;
  insufficientAvailableMarketSymbolCounts: Array<{
    market: Market;
    minimum: number;
    available: number;
  }>;
  insufficientAvailableAssetTypeSymbolCounts: Array<{
    assetType: AssetType;
    minimum: number;
    available: number;
  }>;
}): string[] {
  const issues: string[] = [];
  if (input.corruptLineCount > 0) {
    issues.push("CORRUPT_SNAPSHOT_LINES");
  }
  if (input.missingRequiredSymbols.length > 0) {
    issues.push("REQUIRED_UNIVERSE_SYMBOL_MISSING");
  }
  if (input.insufficientRequiredSymbols.length > 0) {
    issues.push("REQUIRED_UNIVERSE_SYMBOL_COVERAGE_BELOW_MINIMUM");
  }
  if (input.requireOptionalSymbols && input.missingOptionalSymbols.length > 0) {
    issues.push("OPTIONAL_UNIVERSE_SYMBOL_MISSING");
  }
  if (
    input.requireOptionalSymbols &&
    input.insufficientOptionalSymbols.length > 0
  ) {
    issues.push("OPTIONAL_UNIVERSE_SYMBOL_COVERAGE_BELOW_MINIMUM");
  }
  if (input.missingRequiredMarkets.length > 0) {
    issues.push("REQUIRED_MARKET_MISSING");
  }
  if (input.missingRequiredAssetTypes.length > 0) {
    issues.push("REQUIRED_ASSET_TYPE_MISSING");
  }
  if (input.availableSymbolCount < input.minAvailableSymbolCount) {
    issues.push("AVAILABLE_UNIVERSE_SYMBOL_COUNT_BELOW_MINIMUM");
  }
  if (input.insufficientAvailableMarketSymbolCounts.length > 0) {
    issues.push("AVAILABLE_MARKET_SYMBOL_COUNT_BELOW_MINIMUM");
  }
  if (input.insufficientAvailableAssetTypeSymbolCounts.length > 0) {
    issues.push("AVAILABLE_ASSET_TYPE_SYMBOL_COUNT_BELOW_MINIMUM");
  }
  return issues;
}

function normalizeCountRecord<T extends string>(
  value: Partial<Record<T, number>>,
  label: string
): Partial<Record<T, number>> {
  const output: Partial<Record<T, number>> = {};
  for (const [key, count] of Object.entries(value) as Array<[T, number]>) {
    validateNonNegativeInteger(count, `${label}.${key}`);
    if (count > 0) {
      output[key] = count;
    }
  }
  return sortCountRecord(output);
}

function countAvailableMarkets(
  summaries: HistoricalUniverseCoverageSymbolSummary[]
): Partial<Record<Market, number>> {
  const counts: Partial<Record<Market, number>> = {};
  for (const summary of summaries) {
    if (!summary.available) {
      continue;
    }
    counts[summary.market] = (counts[summary.market] ?? 0) + 1;
  }
  return sortCountRecord(counts);
}

function countAvailableAssetTypes(
  summaries: HistoricalUniverseCoverageSymbolSummary[]
): Partial<Record<AssetType, number>> {
  const counts: Partial<Record<AssetType, number>> = {};
  for (const summary of summaries) {
    if (!summary.available || summary.assetType === null) {
      continue;
    }
    const assetType = summary.assetType as AssetType;
    counts[assetType] = (counts[assetType] ?? 0) + 1;
  }
  return sortCountRecord(counts);
}

function insufficientMarketSymbolCounts(input: {
  minimumCounts: Partial<Record<Market, number>>;
  availableCounts: Partial<Record<Market, number>>;
}): Array<{ market: Market; minimum: number; available: number }> {
  return (Object.entries(input.minimumCounts) as Array<[Market, number]>)
    .flatMap(([market, minimum]) => {
      const available = input.availableCounts[market] ?? 0;
      return available < minimum ? [{ market, minimum, available }] : [];
    })
    .sort((left, right) => left.market.localeCompare(right.market));
}

function insufficientAssetTypeSymbolCounts(input: {
  minimumCounts: Partial<Record<AssetType, number>>;
  availableCounts: Partial<Record<AssetType, number>>;
}): Array<{ assetType: AssetType; minimum: number; available: number }> {
  return (Object.entries(input.minimumCounts) as Array<[AssetType, number]>)
    .flatMap(([assetType, minimum]) => {
      const available = input.availableCounts[assetType] ?? 0;
      return available < minimum ? [{ assetType, minimum, available }] : [];
    })
    .sort((left, right) => left.assetType.localeCompare(right.assetType));
}

function sortCountRecord<T extends string>(
  record: Partial<Record<T, number>>
): Partial<Record<T, number>> {
  return Object.fromEntries(
    (Object.entries(record) as Array<[T, number]>).sort((left, right) =>
      left[0].localeCompare(right[0])
    )
  ) as Partial<Record<T, number>>;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
}

function listLocalYearMonths(input: {
  rangeStart: Date;
  rangeEnd: Date;
  timezoneOffsetMinutes: number;
}): string[] {
  const start = localYearMonthParts(
    input.rangeStart.getTime(),
    input.timezoneOffsetMinutes
  );
  const end = localYearMonthParts(
    input.rangeEnd.getTime(),
    input.timezoneOffsetMinutes
  );
  const months: string[] = [];
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

function localYearMonth(
  epochMs: number,
  timezoneOffsetMinutes: number
): string {
  const parts = localYearMonthParts(epochMs, timezoneOffsetMinutes);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function localYearMonthParts(
  epochMs: number,
  timezoneOffsetMinutes: number
): { year: number; month: number } {
  const shifted = new Date(epochMs + timezoneOffsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1
  };
}

function symbolKey(input: { market: Market; symbol: string }): string {
  return `${input.market}:${input.symbol}`;
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

function compareSymbolSummaries(
  left: HistoricalUniverseCoverageSymbolSummary,
  right: HistoricalUniverseCoverageSymbolSummary
): number {
  const requiredDiff = Number(right.required) - Number(left.required);
  if (requiredDiff !== 0) {
    return requiredDiff;
  }
  const segmentDiff = (left.segment ?? "").localeCompare(right.segment ?? "");
  if (segmentDiff !== 0) {
    return segmentDiff;
  }
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  return left.symbol.localeCompare(right.symbol);
}

function compareRequirements(
  left: HistoricalDataAvailabilitySymbolRequirement,
  right: HistoricalDataAvailabilitySymbolRequirement
): number {
  const marketDiff = left.market.localeCompare(right.market);
  if (marketDiff !== 0) {
    return marketDiff;
  }
  return left.symbol.localeCompare(right.symbol);
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validateRatio(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be >= 0 and <= 1`);
  }
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}

function isValidCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
