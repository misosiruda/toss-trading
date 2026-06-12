import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
