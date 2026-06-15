import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  buildMarketRegimeAllocationPolicy,
  deriveMarketTargetExposureRatios
} from "./marketRegimeAllocationPolicy.js";

test("market regime allocation gives more target exposure to stronger market", () => {
  const result = buildMarketRegimeAllocationPolicy({
    basePolicy: baseAllocationPolicy(),
    simulatedAt: new Date("2025-01-20T09:00:00+09:00"),
    policy: {
      lookbackDays: 20,
      minSymbols: 1,
      minSnapshotsPerSymbol: 2
    },
    snapshots: [
      snapshot("kr_early", "KR", "005930", "2025-01-02T09:00:00+09:00", 100),
      snapshot("kr_now", "KR", "005930", "2025-01-20T09:00:00+09:00", 90),
      snapshot("us_early", "US", "AAPL", "2025-01-02T09:00:00+09:00", 100),
      snapshot("us_now", "US", "AAPL", "2025-01-20T09:00:00+09:00", 112)
    ]
  });

  assert.equal(result.marketRegimesByMarket.KR?.label, "bear");
  assert.equal(result.marketRegimesByMarket.US?.label, "bull");
  assert.equal(
    result.allocationPolicy.policyName,
    "fixture_allocation_market_regime"
  );
  assert.ok(
    (result.marketTargetExposureRatios.US ?? 0) >
      (result.marketTargetExposureRatios.KR ?? 0)
  );
  assert.equal(
    roundRatio(
      (result.marketTargetExposureRatios.KR ?? 0) +
        (result.marketTargetExposureRatios.US ?? 0)
    ),
    0.85
  );
});

test("market regime allocation ignores snapshots after simulated tick", () => {
  const result = buildMarketRegimeAllocationPolicy({
    basePolicy: baseAllocationPolicy(),
    simulatedAt: new Date("2025-01-20T09:00:00+09:00"),
    policy: {
      lookbackDays: 20,
      minSymbols: 1,
      minSnapshotsPerSymbol: 2
    },
    snapshots: [
      snapshot("us_early", "US", "AAPL", "2025-01-02T09:00:00+09:00", 100),
      snapshot("us_now", "US", "AAPL", "2025-01-20T09:00:00+09:00", 112),
      snapshot("us_future", "US", "AAPL", "2025-01-28T09:00:00+09:00", 70)
    ]
  });

  assert.equal(result.marketRegimesByMarket.US?.label, "bull");
  assert.equal(
    result.marketRegimesByMarket.US?.symbolReturns[0]?.lastObservedAt,
    "2025-01-20T09:00:00+09:00"
  );
  assert.equal(result.marketTargetExposureRatios.US, 0.85);
});

test("market regime allocation returns empty targets when all weights are zero", () => {
  const ratios = deriveMarketTargetExposureRatios({
    totalTargetExposureRatio: 0.85,
    marketRegimesByMarket: {
      KR: {
        label: "bear",
        windowStart: "2025-01-01T00:00:00.000Z",
        windowEnd: "2025-01-02T00:00:00.000Z",
        symbolCount: 1,
        classifiedSymbolCount: 1,
        averageReturnRatio: -0.1,
        medianReturnRatio: -0.1,
        advancingSymbolRatio: 0,
        decliningSymbolRatio: 1,
        flatSymbolRatio: 0,
        minSymbols: 1,
        minSnapshotsPerSymbol: 2,
        thresholds: {
          bullReturnThreshold: 0.03,
          bearReturnThreshold: -0.03,
          sidewaysAbsReturnThreshold: 0.01,
          breadthThreshold: 0.6
        },
        reasons: ["NEGATIVE_RETURN_AND_BREADTH"],
        symbolReturns: []
      }
    },
    regimeWeights: {
      bear: 0
    }
  });

  assert.deepEqual(ratios, {});
});

function baseAllocationPolicy() {
  return {
    policyName: "fixture_allocation",
    targetExposureRatio: 0.85,
    minCashReserveRatio: 0.05,
    maxBudgetPerDecisionRatio: 0.2,
    maxSymbolExposureRatio: 0.3
  };
}

function snapshot(
  snapshotId: string,
  market: HistoricalMarketSnapshot["market"],
  symbol: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId,
    market,
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: "2026-06-15T09:00:00+09:00"
  };
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
