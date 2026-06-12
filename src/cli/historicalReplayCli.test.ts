import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";

test("historical replay availability CLI keeps named option values out of positional fallback", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-availability-cli-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      dataDir,
      "2025-02-01T00:00:00+09:00",
      "2025-02-28T23:59:59.999+09:00",
      "60",
      "--check-data-availability",
      "--min-window-snapshots",
      "1",
      "--required-symbols",
      "KR:005930",
      "--min-snapshots-per-symbol",
      "1"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { status: string };
  assert.equal(report.status, "available");
});

test("historical replay CLI writes batch run metadata", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "historical-batch-metadata-cli-"));
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalReplay.js"),
      "--dry-run",
      "--data-dir",
      dataDir,
      "--start-at",
      "2025-02-03T09:00:00+09:00",
      "--end-at",
      "2025-02-03T09:00:00+09:00",
      "--step-seconds",
      "60",
      "--batch-id",
      "batch-smoke",
      "--batch-run-index",
      "2",
      "--run-id",
      "batch-smoke-run-002"
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(
    readFileSync(join(dataDir, "historical-replay-run-metadata.json"), "utf8")
  ) as Record<string, unknown>;
  const identity = metadata["identity"] as Record<string, unknown>;
  const window = metadata["window"] as Record<string, unknown>;

  assert.equal(identity["runId"], "batch-smoke-run-002");
  assert.equal(identity["batchId"], "batch-smoke");
  assert.equal(identity["runIndex"], 2);
  assert.equal(window["source"], "explicit");
  assert.equal(window["startAt"], "2025-02-03T00:00:00.000Z");
});

test("historical batch replay CLI writes batch manifest", () => {
  const sourceDataDir = mkdtempSync(
    join(tmpdir(), "historical-batch-cli-source-")
  );
  const outputBaseDir = mkdtempSync(
    join(tmpdir(), "historical-batch-cli-output-")
  );
  mkdirSync(sourceDataDir, { recursive: true });
  writeFileSync(
    join(sourceDataDir, "historical-market-snapshots.jsonl"),
    `${JSON.stringify(snapshot("hist_005930_001", "005930"))}\n`,
    "utf8"
  );

  const result = spawnSync(
    process.execPath,
    [
      join("dist", "cli", "historicalBatchReplay.js"),
      "--source-data-dir",
      sourceDataDir,
      "--output-dir",
      outputBaseDir,
      "--batch-id",
      "batch-cli",
      "--seed",
      "seed-001",
      "--runs",
      "1",
      "--random-window-from",
      "2025-02-01T00:00:00+09:00",
      "--random-window-to",
      "2025-02-28T23:59:59.999+09:00",
      "--step-seconds",
      "604800",
      "--max-snapshot-age-seconds",
      String(31 * 24 * 60 * 60)
    ],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  const manifest = JSON.parse(
    readFileSync(String(output["manifestPath"]), "utf8")
  ) as Record<string, unknown>;
  const runRecords = readFileSync(String(output["runsPath"]), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(output["status"], "completed");
  assert.equal(output["completedCount"], 1);
  assert.equal(manifest["batchId"], "batch-cli");
  assert.equal(runRecords[0]?.["status"], "completed");
});

function snapshot(
  snapshotId: string,
  symbol: string
): HistoricalMarketSnapshot {
  const observedAt = "2025-02-03T09:00:00+09:00";
  return {
    snapshotId,
    market: "KR",
    symbol,
    observedAt,
    interval: "1m",
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}
