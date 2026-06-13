import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  FirstPricedHistoricalDecisionProvider,
  runHistoricalReplay,
  type HistoricalReplayRunnerOptions
} from "./historicalReplayRunner.js";
import { SimulatedClock } from "./simulatedClock.js";

test("historical replay ignores future snapshots at the simulated time", () => {
  const baseResult = runHistoricalReplay(runnerOptions(), {
    initialPortfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_005930_0900",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      })
    ]
  });
  const withFutureResult = runHistoricalReplay(runnerOptions(), {
    initialPortfolio: portfolio(),
    snapshots: [
      snapshot({
        snapshotId: "hist_005930_0900",
        symbol: "005930",
        observedAt: "2025-01-02T09:00:00+09:00",
        lastPriceKrw: 70_000
      }),
      snapshot({
        snapshotId: "hist_000660_future",
        symbol: "000660",
        observedAt: "2025-01-02T09:01:00+09:00",
        lastPriceKrw: 999_999
      })
    ]
  });

  assert.deepEqual(withFutureResult.finalPortfolio, baseResult.finalPortfolio);
  assert.deepEqual(
    withFutureResult.trades.map((trade) => trade.symbol),
    baseResult.trades.map((trade) => trade.symbol)
  );
  assert.deepEqual(
    withFutureResult.packets[0]?.candidates.map((candidate) => candidate.symbol),
    ["005930"]
  );
  assert.equal(
    withFutureResult.warnings.some((warning) =>
      warning.includes("excluded: future snapshot")
    ),
    true
  );
});

test("historical replay core avoids current wall-clock APIs", async () => {
  const sourcePaths = [
    "src/replay/historicalReplayRunner.ts",
    "src/replay/codexHistoricalReplayRunner.ts",
    "src/market/historicalPacketBuilder.ts",
    "src/replay/simulatedClock.ts"
  ];

  for (const sourcePath of sourcePaths) {
    const source = await readFile(sourcePath, "utf8");
    assert.doesNotMatch(source, /Date\.now\(/, sourcePath);
    assert.doesNotMatch(source, /new Date\(\)/, sourcePath);
  }
});

test("batch replay analysis keeps live execution surfaces out of source files", async () => {
  const sourcePaths = [
    "src/workflows/historicalBatchReplayWorkflow.ts",
    "src/replay/regimeBalancedWindowSampler.ts",
    "src/reports/batchReplayReport.ts",
    "src/cli/historicalBatchReplay.ts",
    "src/cli/historicalBatchReport.ts",
    "src/api/localOperationsServer.ts",
    "dashboard/app.js",
    "dashboard/index.html"
  ];
  const forbiddenPatterns = [
    /from\s+["']node:child_process["']/,
    /\bspawn(?:Sync)?\s*\(/,
    /\bexec(?:File|Sync)?\s*\(/,
    /\btossctl\b/i,
    /\bcodex\s+exec\b/i,
    /\bplace_order\b/i,
    /\bTradingSignal\b/,
    /\bOrderIntent\b/,
    /\bTRADING_ENABLED\s*=\s*true\b/,
    /\bAI_DECISION_ENABLED\s*=\s*true\b/,
    /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i
  ];

  for (const sourcePath of sourcePaths) {
    const source = await readFile(sourcePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(source, pattern, `${sourcePath} matched ${pattern}`);
    }
  }
});

function runnerOptions(): HistoricalReplayRunnerOptions {
  return {
    clock: new SimulatedClock({
      startAt: new Date("2025-01-02T09:00:00+09:00"),
      endAt: new Date("2025-01-02T09:00:00+09:00"),
      stepSeconds: 60
    }),
    decisionProvider: new FirstPricedHistoricalDecisionProvider(),
    packetIdPrefix: "packet_historical_safety",
    packetExpiresInSeconds: 60,
    maxCandidates: 10,
    maxSnapshotAgeSeconds: 300,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-02T09:00:00+09:00"
  };
}

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
