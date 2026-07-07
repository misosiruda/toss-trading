import "../config/loadEnv.js";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  collectTossInvestHistoricalChartSnapshots,
  type TossInvestChartInterval
} from "../collectors/tossInvestHistoricalChartCollector.js";
import { collectTossInvestDailyChartSnapshots } from "../collectors/tossInvestDailyChartCollector.js";
import type { Market } from "../domain/schemas.js";
import { parseHistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";
import { createStoragePaths } from "../storage/repositories.js";
import { createTossInvestHistoricalChartSymbols } from "./tossInvestHistoricalChartIngestSymbols.js";

const args = process.argv.slice(2);
const interval = parseInterval(readArgValue("--interval") ?? "1d");
const startDate = readArgValue("--start-date") ?? "2024-01-01";
const endDate = readArgValue("--end-date") ?? yesterdayKstDateKey();
const universePath = readArgValue("--universe-path") ?? readArgValue("--universe");
const dataDir =
  readArgValue("--data-dir") ??
  (interval === "1d"
    ? `data/tossinvest-daily-${startDate}-${endDate}`
    : "data/tossinvest-recent-chart");
const symbols = parseSymbols(readArgValue("--symbols") ?? "005930,000660");
const market = parseMarket(readArgValue("--market") ?? "KR");
const count = readIntArg("--count", interval === "1d" ? 450 : 80);
const outputPath =
  readArgValue("--output-path") ??
  createStoragePaths(dataDir).historicalMarketSnapshotsPath;
const reportPath =
  readArgValue("--report-path") ??
  join(
    dataDir,
    interval === "1d"
      ? "historical-tossinvest-daily-ingest-report.json"
      : "historical-tossinvest-chart-ingest-report.json"
  );
const tossctlPath = readArgValue("--tossctl-path") ?? process.env.TOSSINVEST_CLI_PATH;
const timeoutSeconds =
  readArgValue("--timeout-seconds") ??
  process.env.TOSSINVEST_CLI_TIMEOUT_SECONDS ??
  "30";
const jsonOutput = args.includes("--json");
const allowPartial = args.includes("--allow-partial");
const enabled =
  args.includes("--enable") || process.env.TOSSINVEST_CLI_ENABLED === "true";

const universe =
  universePath === undefined
    ? null
    : parseHistoricalUniverseManifest(
        JSON.parse(await readFile(universePath, "utf8"))
      );
const collectorSymbols = createTossInvestHistoricalChartSymbols({
  universe,
  symbols,
  market
});
const result =
  interval === "1d"
    ? await collectTossInvestDailyChartSnapshots({
        enabled,
        symbols: collectorSymbols,
        rangeStart: parseKstDateOnly(startDate, "--start-date"),
        rangeEnd: parseKstDateOnly(endDate, "--end-date"),
        pageSize: count
      })
    : await collectTossInvestHistoricalChartSnapshots({
        symbols: collectorSymbols,
        interval,
        count,
        config: {
          enabled,
          tossctlPath: tossctlPath ?? "tossctl",
          timeoutMs: Number(timeoutSeconds) * 1000
        }
      });
const observedTimes = result.snapshots
  .map((snapshot) => Date.parse(snapshot.observedAt))
  .filter(Number.isFinite)
  .sort((left, right) => left - right);
const report = {
  ...result,
  snapshots: undefined,
  universeId: universe?.universeId ?? null,
  universePath: universePath ?? null,
  outputPath,
  reportPath,
  rangeStart:
    observedTimes.length > 0
      ? new Date(observedTimes[0]!).toISOString()
      : null,
  rangeEnd:
    observedTimes.length > 0
      ? new Date(observedTimes.at(-1)!).toISOString()
      : null
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  result.snapshots.map((snapshot) => JSON.stringify(snapshot)).join("\n") +
    (result.snapshots.length > 0 ? "\n" : ""),
  "utf8"
);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(jsonOutput ? JSON.stringify(report, null, 2) : renderReport());
process.exitCode =
  result.status === "completed" || allowPartial === true ? 0 : 1;

function renderReport(): string {
  return [
    "# TossInvest Historical Chart Ingest",
    "",
    `mode: ${result.mode}`,
    `provider: ${result.provider}`,
    `status: ${result.status}`,
    `enabled: ${enabled}`,
    `symbols: ${
      universe === null
        ? symbols.join(",")
        : `${universe.universeId} (${collectorSymbols.length})`
    }`,
    ...(universePath === undefined ? [] : [`universe_path: ${universePath}`]),
    `market: ${market}`,
    `interval: ${interval}`,
    `requested_count: ${
      "requestedCount" in result ? result.requestedCount : result.pageSize
    }`,
    ...(interval === "1d" ? [`range: ${startDate}..${endDate}`] : []),
    `snapshot_count: ${result.snapshotCount}`,
    `range_start: ${report.rangeStart ?? "-"}`,
    `range_end: ${report.rangeEnd ?? "-"}`,
    `output_path: ${outputPath}`,
    `report_path: ${reportPath}`,
    "",
    "## Symbols",
    ...result.symbolReports.map(renderSymbolReport),
    "",
    result.disclaimer
  ].join("\n");
}

function renderSymbolReport(
  item: (typeof result.symbolReports)[number]
): string {
  const productCode =
    "productCode" in item && item.productCode !== null
      ? ` productCode=${item.productCode}`
      : "";
  const assetType =
    "assetType" in item && item.assetType !== null
      ? ` assetType=${item.assetType}`
      : "";
  return `${item.market}:${item.symbol} source=${item.sourceSymbol}${productCode}${assetType} status=${item.status} snapshots=${item.snapshotCount}${
    item.error ? ` error=${item.error}` : ""
  }`;
}

function parseSymbols(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseMarket(value: string): Market {
  const normalized = value.trim().toUpperCase();
  if (normalized === "KR" || normalized === "US") {
    return normalized;
  }
  throw new Error("--market must be KR or US");
}

function parseInterval(value: string): TossInvestChartInterval | "1d" {
  if (value === "1d") {
    return value;
  }
  if (value === "1m" || value === "5m" || value === "15m" || value === "60m") {
    return value;
  }
  throw new Error("--interval must be one of 1d, 1m, 5m, 15m, 60m");
}

function readIntArg(name: string, fallback: number): number {
  const raw = readArgValue(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
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

function parseKstDateOnly(value: string, name: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${name} must be a valid date`);
  }
  return date;
}

function yesterdayKstDateKey(now = new Date()): string {
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kstNow.setUTCDate(kstNow.getUTCDate() - 1);
  return kstNow.toISOString().slice(0, 10);
}
