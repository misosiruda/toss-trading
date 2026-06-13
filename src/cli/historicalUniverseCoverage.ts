import "../config/loadEnv.js";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assessHistoricalUniverseCoverage,
  parseHistoricalUniverseManifest
} from "../replay/historicalUniverseCoverage.js";
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
const requireOptionalSymbols = args.includes("--require-optional-symbols");
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
  corruptLineCount: snapshotRead.corruptLineCount,
  requireOptionalSymbols
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
    `issues: ${report.issues.join(", ") || "none"}`,
    "",
    "## Missing Symbols",
    `required: ${formatSymbols(report.missingRequiredSymbols)}`,
    `optional: ${formatSymbols(report.missingOptionalSymbols)}`,
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
