import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  classifyMarketRegime,
  classifyMarketRegimeByMarket
} from "./marketRegimeClassifier.js";

test("market regime classifier detects bull windows", () => {
  const regime = classifyMarketRegime({
    snapshots: [
      snapshot("s1", "005930", "2025-02-03T09:00:00+09:00", 100),
      snapshot("s2", "005930", "2025-02-28T15:00:00+09:00", 106),
      snapshot("s3", "000660", "2025-02-03T09:00:00+09:00", 200),
      snapshot("s4", "000660", "2025-02-28T15:00:00+09:00", 212)
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minSymbols: 2
  });

  assert.equal(regime.label, "bull");
  assert.equal(regime.classifiedSymbolCount, 2);
  assert.equal(regime.advancingSymbolRatio, 1);
  assert.ok(regime.reasons.includes("POSITIVE_RETURN_AND_BREADTH"));
});

test("market regime classifier detects bear windows", () => {
  const regime = classifyMarketRegime({
    snapshots: [
      snapshot("s1", "005930", "2025-03-03T09:00:00+09:00", 100),
      snapshot("s2", "005930", "2025-03-31T15:00:00+09:00", 94),
      snapshot("s3", "000660", "2025-03-03T09:00:00+09:00", 200),
      snapshot("s4", "000660", "2025-03-31T15:00:00+09:00", 188)
    ],
    windowStart: new Date("2025-03-01T00:00:00+09:00"),
    windowEnd: new Date("2025-03-31T23:59:59.999+09:00"),
    minSymbols: 2
  });

  assert.equal(regime.label, "bear");
  assert.equal(regime.decliningSymbolRatio, 1);
  assert.ok(regime.reasons.includes("NEGATIVE_RETURN_AND_BREADTH"));
});

test("market regime classifier detects sideways windows", () => {
  const regime = classifyMarketRegime({
    snapshots: [
      snapshot("s1", "005930", "2025-04-01T09:00:00+09:00", 10_000),
      snapshot("s2", "005930", "2025-04-30T15:00:00+09:00", 10_050),
      snapshot("s3", "000660", "2025-04-01T09:00:00+09:00", 20_000),
      snapshot("s4", "000660", "2025-04-30T15:00:00+09:00", 19_950)
    ],
    windowStart: new Date("2025-04-01T00:00:00+09:00"),
    windowEnd: new Date("2025-04-30T23:59:59.999+09:00"),
    minSymbols: 2
  });

  assert.equal(regime.label, "sideways");
  assert.ok(regime.reasons.includes("LOW_ABSOLUTE_AVERAGE_RETURN"));
});

test("market regime classifier detects mixed windows", () => {
  const regime = classifyMarketRegime({
    snapshots: [
      snapshot("s1", "005930", "2025-05-01T09:00:00+09:00", 100),
      snapshot("s2", "005930", "2025-05-30T15:00:00+09:00", 110),
      snapshot("s3", "000660", "2025-05-01T09:00:00+09:00", 200),
      snapshot("s4", "000660", "2025-05-30T15:00:00+09:00", 190)
    ],
    windowStart: new Date("2025-05-01T00:00:00+09:00"),
    windowEnd: new Date("2025-05-31T23:59:59.999+09:00"),
    minSymbols: 2
  });

  assert.equal(regime.label, "mixed");
  assert.ok(regime.reasons.includes("DIRECTION_OR_BREADTH_MIXED"));
});

test("market regime classifier reports insufficient data", () => {
  const regime = classifyMarketRegime({
    snapshots: [
      snapshot("s1", "005930", "2025-06-01T09:00:00+09:00", 100)
    ],
    windowStart: new Date("2025-06-01T00:00:00+09:00"),
    windowEnd: new Date("2025-06-30T23:59:59.999+09:00")
  });

  assert.equal(regime.label, "insufficient_data");
  assert.equal(regime.averageReturnRatio, null);
  assert.ok(regime.reasons.includes("INSUFFICIENT_CLASSIFIABLE_SYMBOLS"));
});

test("market regime classifier reports different labels by market", () => {
  const regimes = classifyMarketRegimeByMarket({
    snapshots: [
      snapshot("kr_1", "005930", "2025-07-01T09:00:00+09:00", 100, "KR"),
      snapshot("kr_2", "005930", "2025-07-31T15:00:00+09:00", 94, "KR"),
      snapshot("us_1", "AAPL", "2025-07-01T09:00:00+09:00", 100, "US"),
      snapshot("us_2", "AAPL", "2025-07-31T15:00:00+09:00", 108, "US")
    ],
    windowStart: new Date("2025-07-01T00:00:00+09:00"),
    windowEnd: new Date("2025-07-31T23:59:59.999+09:00")
  });

  assert.equal(regimes.KR?.label, "bear");
  assert.equal(regimes.US?.label, "bull");
  assert.equal(regimes.KR?.symbolReturns[0]?.market, "KR");
  assert.equal(regimes.US?.symbolReturns[0]?.market, "US");
});

function snapshot(
  snapshotId: string,
  symbol: string,
  observedAt: string,
  lastPriceKrw: number,
  market: "KR" | "US" = "KR"
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
    createdAt: observedAt
  };
}
