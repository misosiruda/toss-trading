import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { runHistoricalBatchReplay } from "./historicalBatchReplayWorkflow.js";

test("historical batch replay runner writes manifest and per-run records", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );
  await snapshotStore.append(
    snapshot("hist_005930_002", "005930", "2025-02-10T09:00:00+09:00", 74_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-smoke",
    seed: "seed-001",
    runCount: 2,
    rangeStart: new Date("2025-02-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    stepSeconds: 604_800,
    maxSnapshotAgeSeconds: 31 * 24 * 60 * 60
  });
  const manifest = JSON.parse(
    await readFile(result.manifestPath, "utf8")
  ) as Record<string, unknown>;
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;
  const firstMetadata = JSON.parse(
    await readFile(
      join(
        String(firstRecord["storageBaseDir"]),
        "historical-replay-run-metadata.json"
      ),
      "utf8"
    )
  ) as Record<string, unknown>;
  const firstIdentity = firstMetadata["identity"] as Record<string, unknown>;
  const firstWindow = firstMetadata["window"] as Record<string, unknown>;

  assert.equal(result.status, "completed");
  assert.equal(result.runCount, 2);
  assert.equal(result.completedCount, 2);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.equal(manifest["status"], "completed");
  assert.equal(manifest["completedCount"], 2);
  assert.equal(runRecords.length, 2);
  assert.equal(firstRecord["status"], "completed");
  assert.equal(
    (firstRecord["window"] as Record<string, unknown>)["selectedMonth"],
    "2025-02"
  );
  assert.equal(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["status"],
    "available"
  );
  assert.equal(
    (firstRecord["marketRegime"] as Record<string, unknown>)["label"],
    "bull"
  );
  assert.ok(firstRecord["summary"]);
  assert.equal(firstIdentity["batchId"], "batch-smoke");
  assert.equal(firstIdentity["runIndex"], 0);
  assert.equal(firstWindow["source"], "random_window");
  assert.equal(firstWindow["selectedMonth"], "2025-02");
});

test("historical batch replay runner skips insufficient windows", async () => {
  const sourceDataDir = await mkdtemp(join(tmpdir(), "batch-replay-source-"));
  const outputBaseDir = await mkdtemp(join(tmpdir(), "batch-replay-output-"));
  const sourcePaths = createStoragePaths(sourceDataDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    sourcePaths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00", 70_000)
  );

  const result = await runHistoricalBatchReplay({
    sourceDataDir,
    outputBaseDir,
    batchId: "batch-skip",
    seed: "seed-001",
    runCount: 1,
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    minWindowSnapshots: 1
  });
  const runRecords = await readJsonl(result.runsPath);
  const firstRecord = runRecords[0]!;

  assert.equal(result.status, "completed");
  assert.equal(result.completedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(firstRecord["status"], "skipped");
  assert.equal(firstRecord["skipReason"], "DATA_INSUFFICIENT");
  assert.equal(firstRecord["reportPath"], null);
  assert.equal(
    (firstRecord["marketRegime"] as Record<string, unknown>)["label"],
    "insufficient_data"
  );
  assert.deepEqual(
    (firstRecord["dataAvailability"] as Record<string, unknown>)["issues"],
    ["WINDOW_SNAPSHOT_MISSING", "WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM"]
  );
});

function snapshot(
  snapshotId: string,
  symbol: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}

async function readJsonl(filePath: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
