import "../config/loadEnv.js";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assessHistoricalUniverseCoverage,
  parseHistoricalUniverseManifest
} from "../replay/historicalUniverseCoverage.js";
import {
  assetTypeSchema,
  marketSchema,
  type AssetType,
  type Market,
  strategyBucketSchema,
  type StrategyBucket
} from "../domain/schemas.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";

const args = process.argv.slice(2);
const dataDir = readArgValue("--data-dir") ?? "data/paper";
const universePath = readRequiredArgValue("--universe-path");
const rangeStart = readDateArg("--range-start");
const rangeEnd = readDateArg("--range-end");
const timezoneOffsetMinutes = readNumberArg("--timezone-offset-minutes", 540);
const minMonthlyCoverageRatio = readNumberArg(
  "--min-monthly-coverage-ratio",
  1
);
const minSnapshotsPerSymbol = readNumberArg("--min-snapshots-per-symbol", 1);
const minAvailableSymbolCount = readNumberArg("--min-available-symbols", 0);
const minAvailableMarketSymbolCounts = readMarketCountArg(
  "--min-available-market-symbols"
);
const minAvailableAssetTypeSymbolCounts = readAssetTypeCountArg(
  "--min-available-asset-type-symbols"
);
const minAvailableStrategyBucketSymbolCounts = readStrategyBucketCountArg(
  "--min-available-strategy-bucket-symbols"
);
const requireOptionalSymbols = args.includes("--require-optional-symbols");
const requiredMarkets = readMarketListArg("--require-markets");
const requiredAssetTypes = readAssetTypeListArg("--require-asset-types");
const requiredStrategyBuckets = readStrategyBucketListArg(
  "--require-strategy-buckets"
);
const outputPath = readArgValue("--output-path");
const jsonOutput = args.includes("--json");

const universe = parseHistoricalUniverseManifest(
  JSON.parse(await readFile(universePath, "utf8"))
);
const paths = createStoragePaths(dataDir);
const snapshotRead = await new FileHistoricalMarketSnapshotStore(
  paths.historicalMarketSnapshotsPath
).readAll();
const report = assessHistoricalUniverseCoverage({
  snapshots: snapshotRead.records,
  universe,
  rangeStart,
  rangeEnd,
  timezoneOffsetMinutes,
  minMonthlyCoverageRatio,
  minSnapshotsPerSymbol,
  minAvailableSymbolCount,
  minAvailableMarketSymbolCounts,
  minAvailableAssetTypeSymbolCounts,
  minAvailableStrategyBucketSymbolCounts,
  corruptLineCount: snapshotRead.corruptLineCount,
  requireOptionalSymbols,
  requiredMarkets,
  requiredAssetTypes,
  requiredStrategyBuckets
});

if (outputPath !== undefined) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(jsonOutput ? JSON.stringify(report, null, 2) : renderReport());
process.exit(report.status === "available" ? 0 : 1);

function renderReport(): string {
  return [
    "# Historical Universe Coverage",
    "",
    `mode: ${report.mode}`,
    `universe_id: ${report.universeId}`,
    `status: ${report.status}`,
    `range_start: ${report.rangeStart}`,
    `range_end: ${report.rangeEnd}`,
    `expected_months: ${report.expectedMonths.length}`,
    `universe_symbols: ${report.universeSymbolCount}`,
    `required_symbols: ${report.requiredSymbolCount}`,
    `optional_symbols: ${report.optionalSymbolCount}`,
    `available_required_symbols: ${report.availableRequiredSymbolCount}`,
    `available_optional_symbols: ${report.availableOptionalSymbolCount}`,
    `available_symbols: ${report.availableSymbolCount}`,
    `min_available_symbols: ${report.minAvailableSymbolCount}`,
    `required_markets: ${report.requiredMarkets.join(", ") || "none"}`,
    `available_markets: ${report.availableMarkets.join(", ") || "none"}`,
    `available_market_symbol_counts: ${formatCountRecord(
      report.availableMarketSymbolCounts
    )}`,
    `min_available_market_symbol_counts: ${formatCountRecord(
      report.minAvailableMarketSymbolCounts
    )}`,
    `required_asset_types: ${report.requiredAssetTypes.join(", ") || "none"}`,
    `available_asset_types: ${report.availableAssetTypes.join(", ") || "none"}`,
    `available_asset_type_symbol_counts: ${formatCountRecord(
      report.availableAssetTypeSymbolCounts
    )}`,
    `min_available_asset_type_symbol_counts: ${formatCountRecord(
      report.minAvailableAssetTypeSymbolCounts
    )}`,
    `required_strategy_buckets: ${
      report.requiredStrategyBuckets.join(", ") || "none"
    }`,
    `available_strategy_buckets: ${
      report.availableStrategyBuckets.join(", ") || "none"
    }`,
    `available_strategy_bucket_symbol_counts: ${formatCountRecord(
      report.availableStrategyBucketSymbolCounts
    )}`,
    `min_available_strategy_bucket_symbol_counts: ${formatCountRecord(
      report.minAvailableStrategyBucketSymbolCounts
    )}`,
    `issues: ${report.issues.join(", ") || "none"}`,
    "",
    "## Missing Symbols",
    `required: ${formatSymbols(report.missingRequiredSymbols)}`,
    `optional: ${formatSymbols(report.missingOptionalSymbols)}`,
    `markets: ${report.missingRequiredMarkets.join(", ") || "none"}`,
    `asset_types: ${report.missingRequiredAssetTypes.join(", ") || "none"}`,
    `strategy_buckets: ${
      report.missingRequiredStrategyBuckets.join(", ") || "none"
    }`,
    "",
    "## Lowest Coverage",
    ...report.symbolSummaries
      .slice()
      .sort((left, right) => {
        if (left.monthlyCoverageRatio !== right.monthlyCoverageRatio) {
          return left.monthlyCoverageRatio - right.monthlyCoverageRatio;
        }
        return `${left.market}:${left.symbol}`.localeCompare(
          `${right.market}:${right.symbol}`
        );
      })
      .slice(0, 10)
      .map(
        (summary) =>
          `${summary.market}:${summary.symbol} required=${summary.required} snapshots=${summary.snapshotCount} monthly_coverage=${summary.monthlyCoverageRatio}`
      ),
    "",
    report.disclaimer
  ].join("\n");
}

function formatSymbols(values: Array<{ market: string; symbol: string }>): string {
  return values.length === 0
    ? "none"
    : values.map((value) => `${value.market}:${value.symbol}`).join(", ");
}

function readDateArg(name: string): Date {
  const raw = readRequiredArgValue(name);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
}

function readNumberArg(name: string, fallback: number): number {
  const raw = readArgValue(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

function readMarketListArg(name: string): Market[] {
  return readListArg(name).map((value) => marketSchema.parse(value));
}

function readAssetTypeListArg(name: string): AssetType[] {
  return readListArg(name).map((value) => assetTypeSchema.parse(value));
}

function readStrategyBucketListArg(name: string): StrategyBucket[] {
  return readListArg(name).map((value) => strategyBucketSchema.parse(value));
}

function readMarketCountArg(name: string): Partial<Record<Market, number>> {
  const output: Partial<Record<Market, number>> = {};
  for (const item of readListArg(name)) {
    const [rawKey, rawCount] = item.split(":");
    const market = marketSchema.parse(rawKey);
    output[market] = parseCount(rawCount, name, item);
  }
  return output;
}

function readAssetTypeCountArg(
  name: string
): Partial<Record<AssetType, number>> {
  const output: Partial<Record<AssetType, number>> = {};
  for (const item of readListArg(name)) {
    const [rawKey, rawCount] = item.split(":");
    const assetType = assetTypeSchema.parse(rawKey);
    output[assetType] = parseCount(rawCount, name, item);
  }
  return output;
}

function readStrategyBucketCountArg(
  name: string
): Partial<Record<StrategyBucket, number>> {
  const output: Partial<Record<StrategyBucket, number>> = {};
  for (const item of readListArg(name)) {
    const [rawKey, rawCount] = item.split(":");
    const strategyBucket = strategyBucketSchema.parse(rawKey);
    output[strategyBucket] = parseCount(rawCount, name, item);
  }
  return output;
}

function parseCount(
  rawCount: string | undefined,
  argName: string,
  item: string
): number {
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${argName} item must use KEY:non-negative-integer (${item})`);
  }
  return count;
}

function readListArg(name: string): string[] {
  const raw = readArgValue(name);
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function formatCountRecord(value: Partial<Record<string, number>>): string {
  const entries = Object.entries(value);
  return entries.length === 0
    ? "none"
    : entries
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([key, count]) => `${key}:${count}`)
        .join(", ");
}

function readArgValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function readRequiredArgValue(name: string): string {
  const value = readArgValue(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
