import assert from "node:assert/strict";
import test from "node:test";

import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { selectRegimeBalancedReplayWindow } from "./regimeBalancedWindowSampler.js";

test("regime balanced sampler cycles through available target regimes", () => {
  const targetRegimes: MarketRegimeLabel[] = ["bull", "bear", "sideways"];
  const commonOptions = {
    snapshots: snapshotsByMonth([
      ["2025-01", 100, 106],
      ["2025-02", 100, 94],
      ["2025-03", 100, 100.5]
    ]),
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    seed: "balanced-seed",
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    targetRegimes
  };

  const selections = [0, 1, 2].map((runIndex) =>
    selectRegimeBalancedReplayWindow({
      ...commonOptions,
      runIndex
    })
  );

  assert.deepEqual(
    selections.map((selection) => selection.targetRegime),
    ["bull", "bear", "sideways"]
  );
  assert.deepEqual(
    selections.map((selection) => selection.marketRegime.label),
    ["bull", "bear", "sideways"]
  );
  assert.deepEqual(
    selections.map((selection) => selection.window.selectedMonth),
    ["2025-01", "2025-02", "2025-03"]
  );
  assert.deepEqual(selections[0]?.plan.bucketCounts, {
    bull: 1,
    bear: 1,
    sideways: 1,
    mixed: 0,
    insufficient_data: 0
  });
});

test("regime balanced sampler excludes unavailable target regimes", () => {
  const first = selectRegimeBalancedReplayWindow({
    snapshots: snapshotsByMonth([
      ["2025-01", 100, 106],
      ["2025-02", 100, 94]
    ]),
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    seed: "balanced-seed",
    runIndex: 0,
    targetRegimes: ["bull", "bear", "sideways"]
  });
  const second = selectRegimeBalancedReplayWindow({
    snapshots: snapshotsByMonth([
      ["2025-01", 100, 106],
      ["2025-02", 100, 94]
    ]),
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    seed: "balanced-seed",
    runIndex: 1,
    targetRegimes: ["bull", "bear", "sideways"]
  });

  assert.deepEqual(first.plan.activeTargetRegimes, ["bull", "bear"]);
  assert.deepEqual(first.plan.unavailableTargetRegimes, ["sideways"]);
  assert.equal(first.targetRegime, "bull");
  assert.equal(second.targetRegime, "bear");
});

test("regime balanced sampler filters candidates before bucket assignment", () => {
  const selection = selectRegimeBalancedReplayWindow({
    snapshots: snapshotsByMonth([
      ["2025-01", 100, 106],
      ["2025-02", 100, 94],
      ["2025-03", 100, 100.5]
    ]),
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    seed: "balanced-filter-seed",
    runIndex: 0,
    targetRegimes: ["bull", "bear"],
    candidateFilter: (candidate) => candidate.selectedMonth !== "2025-01"
  });

  assert.equal(selection.window.selectedMonth, "2025-02");
  assert.equal(selection.targetRegime, "bear");
  assert.deepEqual(selection.plan.activeTargetRegimes, ["bear"]);
  assert.deepEqual(selection.plan.unavailableTargetRegimes, ["bull"]);
  assert.deepEqual(selection.plan.bucketCounts, {
    bull: 0,
    bear: 1,
    sideways: 1,
    mixed: 0,
    insufficient_data: 0
  });
});

test("regime balanced sampler fails when no requested regimes are available", () => {
  assert.throws(
    () =>
      selectRegimeBalancedReplayWindow({
        snapshots: snapshotsByMonth([["2025-01", 100, 106]]),
        rangeStart: new Date("2025-01-01T00:00:00+09:00"),
        rangeEnd: new Date("2025-01-31T23:59:59.999+09:00"),
        seed: "balanced-seed",
        runIndex: 0,
        targetRegimes: ["bear"]
      }),
    /No requested market regime/
  );
});

function snapshotsByMonth(
  rows: Array<[string, number, number]>
): HistoricalMarketSnapshot[] {
  return rows.flatMap(([month, firstPrice, lastPrice]) => [
    snapshot(`${month}_start`, month, "03", firstPrice),
    snapshot(`${month}_end`, month, "28", lastPrice)
  ]);
}

function snapshot(
  snapshotId: string,
  month: string,
  day: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market: "KR",
    symbol: "005930",
    observedAt: `${month}-${day}T09:00:00+09:00`,
    interval: "1d",
    lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: `${month}-${day}T09:00:00+09:00`
  };
}
