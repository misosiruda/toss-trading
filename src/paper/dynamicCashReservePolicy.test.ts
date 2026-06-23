import assert from "node:assert/strict";
import test from "node:test";

import type {
  HistoricalMarketSnapshot,
  VirtualPortfolio
} from "../domain/schemas.js";
import {
  assessDynamicCashReserve,
  classifyDynamicCashReserveRegime
} from "./dynamicCashReservePolicy.js";

test("dynamic cash reserve raises minimum reserve in bear regimes", () => {
  const policy = { lookbackDays: 3, minSymbols: 1, minSnapshotsPerSymbol: 2 };
  const marketRegime = classifyDynamicCashReserveRegime({
    policy,
    simulatedAt: new Date("2025-01-03T09:00:00+09:00"),
    snapshots: [
      snapshot("hist_005930_0102", "2025-01-02T09:00:00+09:00", 100_000),
      snapshot("hist_005930_0103", "2025-01-03T09:00:00+09:00", 96_000)
    ]
  });

  const assessment = assessDynamicCashReserve({
    portfolio: portfolio(),
    baseMinimumCashReserveRatio: 0.05,
    baseMinimumCashReserveKrw: 0,
    policy,
    marketRegime
  });

  assert.equal(marketRegime.label, "bear");
  assert.equal(assessment?.minimumCashReserveRatio, 0.25);
  assert.equal(assessment?.minimumCashReserveKrw, 250_000);
  assert.equal(assessment?.reason, "bear");
});

test("dynamic cash reserve keeps a nonzero floor in bull regimes", () => {
  const policy = { lookbackDays: 3, minSymbols: 1, minSnapshotsPerSymbol: 2 };
  const marketRegime = classifyDynamicCashReserveRegime({
    policy,
    simulatedAt: new Date("2025-01-03T09:00:00+09:00"),
    snapshots: [
      snapshot("hist_005930_0102", "2025-01-02T09:00:00+09:00", 100_000),
      snapshot("hist_005930_0103", "2025-01-03T09:00:00+09:00", 104_000)
    ]
  });

  const assessment = assessDynamicCashReserve({
    portfolio: portfolio(),
    baseMinimumCashReserveRatio: 0,
    baseMinimumCashReserveKrw: 0,
    policy,
    marketRegime
  });

  assert.equal(marketRegime.label, "bull");
  assert.equal(assessment?.minimumCashReserveRatio, 0.02);
  assert.equal(assessment?.minimumCashReserveKrw, 20_000);
  assert.equal(assessment?.reason, "bull");
});

test("dynamic cash reserve applies high volatility reserve regardless of direction", () => {
  const policy = {
    lookbackDays: 3,
    minSymbols: 2,
    minSnapshotsPerSymbol: 2,
    highVolatilityReturnThreshold: 0.08,
    highVolatilityCashReserveRatio: 0.3
  };
  const marketRegime = classifyDynamicCashReserveRegime({
    policy,
    simulatedAt: new Date("2025-01-03T09:00:00+09:00"),
    snapshots: [
      snapshot("hist_005930_0102", "2025-01-02T09:00:00+09:00", 100_000),
      snapshot("hist_005930_0103", "2025-01-03T09:00:00+09:00", 120_000),
      snapshot("hist_000660_0102", "2025-01-02T09:00:00+09:00", 100_000, "000660"),
      snapshot("hist_000660_0103", "2025-01-03T09:00:00+09:00", 80_000, "000660")
    ]
  });

  const assessment = assessDynamicCashReserve({
    portfolio: portfolio(),
    baseMinimumCashReserveRatio: 0.05,
    baseMinimumCashReserveKrw: 0,
    policy,
    marketRegime
  });

  assert.equal(marketRegime.label, "sideways");
  assert.equal(assessment?.highVolatility, true);
  assert.equal(assessment?.minimumCashReserveRatio, 0.3);
  assert.equal(assessment?.reason, "high_volatility");
});

test("dynamic cash reserve falls back to conservative reserve without regime context", () => {
  const assessment = assessDynamicCashReserve({
    portfolio: portfolio(),
    baseMinimumCashReserveRatio: 0.05,
    baseMinimumCashReserveKrw: 0,
    policy: { lookbackDays: 3 }
  });

  assert.equal(assessment?.marketRegimeLabel, "insufficient_data");
  assert.equal(assessment?.minimumCashReserveRatio, 0.35);
  assert.equal(assessment?.minimumCashReserveKrw, 350_000);
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2025-01-03T09:00:00+09:00"
  };
}

function snapshot(
  snapshotId: string,
  observedAt: string,
  lastPriceKrw: number,
  symbol = "005930"
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
