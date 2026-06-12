import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { ReplaySamplingPolicy } from "../replay/replaySamplingPolicy.js";
import { SimulatedClock } from "../replay/simulatedClock.js";
import {
  createStoragePaths,
  FileHistoricalMarketSnapshotStore
} from "../storage/repositories.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";

test("historical replay workflow writes a stored paper report", async () => {
  const storageBaseDir = await mkdtemp(join(tmpdir(), "toss-replay-workflow-"));
  const paths = createStoragePaths(storageBaseDir);
  const snapshotStore = new FileHistoricalMarketSnapshotStore(
    paths.historicalMarketSnapshotsPath
  );
  await snapshotStore.append(
    snapshot({
      snapshotId: "hist_005930_0900",
      symbol: "005930",
      observedAt: "2025-01-02T09:00:00+09:00",
      lastPriceKrw: 70_000
    })
  );
  await snapshotStore.append(
    snapshot({
      snapshotId: "hist_000660_0901",
      symbol: "000660",
      observedAt: "2025-01-02T09:01:00+09:00",
      lastPriceKrw: 120_000
    })
  );

  const result = await runHistoricalReplayWorkflow({
    storageBaseDir,
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:01:00+09:00"),
      stepSeconds: 60
    }),
    samplingPolicy: new ReplaySamplingPolicy({ everyNSteps: 2 }),
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    packetIdPrefix: "packet_historical_workflow",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });
  const stored = JSON.parse(
    await readFile(paths.historicalReplayReportPath, "utf8")
  ) as Record<string, unknown>;

  assert.equal(result.status, "completed");
  assert.equal(result.mode, "paper_only");
  assert.equal(result.reportPath, paths.historicalReplayReportPath);
  assert.equal(result.replayResult.packetCount, 2);
  assert.equal(result.replayResult.decisionProviderCallCount, 1);
  assert.equal(result.replayResult.decisionSkippedCount, 1);
  assert.equal(stored["title"], "Historical Replay Paper Report");
  assert.match(String(stored["disclaimer"]), /cannot place live orders/);
});

function snapshot(input: {
  snapshotId: string;
  symbol: string;
  observedAt: string;
  lastPriceKrw: number;
}): HistoricalMarketSnapshot {
  return {
    snapshotId: input.snapshotId,
    market: "KR",
    symbol: input.symbol,
    observedAt: input.observedAt,
    interval: "1m",
    lastPriceKrw: input.lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${input.snapshotId}`],
    createdAt: "2026-06-12T09:00:00+09:00"
  };
}
