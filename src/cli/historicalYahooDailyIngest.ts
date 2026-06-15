import "../config/loadEnv.js";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { collectYahooHistoricalDailySnapshots } from "../collectors/yahooHistoricalDailyCollector.js";
import { parseHistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";
import { createStoragePaths } from "../storage/repositories.js";

const args = process.argv.slice(2);
const dataDir =
  readArgValue("--data-dir") ?? "data/replay-2023-01-2026-05-global-yahoo-daily";
const universePath =
  readArgValue("--universe-path") ??
  "docs/historical-universe.global-broad.json";
const rangeStart = readDateArg(
  "--range-start",
  "2023-01-01T00:00:00+09:00"
);
const rangeEnd = readDateArg(
  "--range-end",
  "2026-05-31T23:59:59.999+09:00"
);
const outputPath =
  readArgValue("--output-path") ??
  createStoragePaths(dataDir).historicalMarketSnapshotsPath;
const reportPath =
  readArgValue("--report-path") ?? join(dataDir, "historical-yahoo-ingest-report.json");
const fxSourceSymbol = readArgValue("--fx-source-symbol");
const jsonOutput = args.includes("--json");
const allowPartial = args.includes("--allow-partial");

const universe = parseHistoricalUniverseManifest(
  JSON.parse(await readFile(universePath, "utf8"))
);
const result = await collectYahooHistoricalDailySnapshots({
  universe,
  rangeStart,
  rangeEnd,
  ...(fxSourceSymbol === undefined ? {} : { fxSourceSymbol })
});
const report = {
  ...result,
  snapshots: undefined,
  outputPath,
  reportPath
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  result.snapshots.map((snapshot) => JSON.stringify(snapshot)).join("\n") + "\n",
  "utf8"
);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(jsonOutput ? JSON.stringify(report, null, 2) : renderReport());
process.exitCode =
  result.status === "completed" || allowPartial === true ? 0 : 1;

function renderReport(): string {
  return [
    "# Yahoo Historical Daily Ingest",
    "",
    `mode: ${result.mode}`,
    `provider: ${result.provider}`,
    `status: ${result.status}`,
    `universe_id: ${result.universeId}`,
    `range_start: ${result.rangeStart}`,
    `range_end: ${result.rangeEnd}`,
    `snapshot_count: ${result.snapshotCount}`,
    `output_path: ${outputPath}`,
    `report_path: ${reportPath}`,
    `fx_source_symbol: ${result.fxSourceSymbol}`,
    "",
    "## Symbols",
    ...result.symbolReports.map(
      (item) =>
        `${item.market}:${item.symbol} source=${item.sourceSymbol} assetType=${
          item.assetType ?? "unknown"
        } currency=${item.currency ?? "unknown"} status=${item.status} snapshots=${
          item.snapshotCount
        }${item.error ? ` error=${item.error}` : ""}`
    ),
    "",
    result.disclaimer
  ].join("\n");
}

function readDateArg(name: string, fallback: string): Date {
  const raw = readArgValue(name) ?? fallback;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
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
