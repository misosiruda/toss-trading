import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import { assessHistoricalDataAvailability } from "./historicalDataAvailability.js";

test("historical data availability summarizes window and symbol coverage", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_before", "005930", "2025-01-31T09:00:00+09:00"),
      snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_005930_002", "005930", "2025-02-03T09:01:00+09:00"),
      snapshot("hist_000660_001", "000660", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_005930_after", "005930", "2025-03-01T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minWindowSnapshots: 3,
    minSnapshotsPerRequiredSymbol: 1,
    requiredSymbols: [
      { market: "KR", symbol: "005930" },
      { market: "KR", symbol: "000660" }
    ]
  });

  assert.equal(report.status, "available");
  assert.equal(report.totalSnapshotCount, 5);
  assert.equal(report.windowSnapshotCount, 3);
  assert.equal(report.symbolCount, 2);
  assert.equal(report.requiredSymbolCount, 2);
  assert.equal(report.availableRequiredSymbolCount, 2);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(
    report.symbolSummaries.map((summary) => ({
      symbol: summary.symbol,
      totalSnapshotCount: summary.totalSnapshotCount,
      windowSnapshotCount: summary.windowSnapshotCount,
      required: summary.required,
      available: summary.available
    })),
    [
      {
        symbol: "000660",
        totalSnapshotCount: 1,
        windowSnapshotCount: 1,
        required: true,
        available: true
      },
      {
        symbol: "005930",
        totalSnapshotCount: 4,
        windowSnapshotCount: 2,
        required: true,
        available: true
      }
    ]
  );
});

test("historical data availability fails closed for missing window data", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_before", "005930", "2025-01-31T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00")
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.windowSnapshotCount, 0);
  assert.ok(report.issues.includes("WINDOW_SNAPSHOT_MISSING"));
  assert.ok(report.issues.includes("WINDOW_SNAPSHOT_COUNT_BELOW_MINIMUM"));
});

test("historical data availability reports required symbol gaps", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00"),
      snapshot("hist_000660_old", "000660", "2025-01-31T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minSnapshotsPerRequiredSymbol: 1,
    requiredSymbols: [
      { market: "KR", symbol: "005930" },
      { market: "KR", symbol: "000660" },
      { market: "KR", symbol: "035420" }
    ]
  });

  assert.equal(report.status, "insufficient");
  assert.deepEqual(report.missingRequiredSymbols, [
    { market: "KR", symbol: "035420" }
  ]);
  assert.deepEqual(
    report.insufficientRequiredSymbols.map((summary) => summary.symbol),
    ["000660"]
  );
  assert.ok(report.issues.includes("REQUIRED_SYMBOL_MISSING"));
  assert.ok(
    report.issues.includes("REQUIRED_SYMBOL_SNAPSHOT_COUNT_BELOW_MINIMUM")
  );
});

test("historical data availability treats corrupt snapshot lines as insufficient", () => {
  const report = assessHistoricalDataAvailability({
    snapshots: [
      snapshot("hist_005930_001", "005930", "2025-02-03T09:00:00+09:00")
    ],
    windowStart: new Date("2025-02-01T00:00:00+09:00"),
    windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    corruptLineCount: 1
  });

  assert.equal(report.status, "insufficient");
  assert.equal(report.corruptLineCount, 1);
  assert.ok(report.issues.includes("CORRUPT_SNAPSHOT_LINES"));
});

test("historical data availability rejects invalid options", () => {
  assert.throws(
    () =>
      assessHistoricalDataAvailability({
        snapshots: [],
        windowStart: new Date("2025-03-01T00:00:00+09:00"),
        windowEnd: new Date("2025-02-01T00:00:00+09:00")
      }),
    /windowStart/
  );

  assert.throws(
    () =>
      assessHistoricalDataAvailability({
        snapshots: [],
        windowStart: new Date("2025-02-01T00:00:00+09:00"),
        windowEnd: new Date("2025-02-28T23:59:59.999+09:00"),
        minWindowSnapshots: -1
      }),
    /minWindowSnapshots/
  );
});

function snapshot(
  snapshotId: string,
  symbol: string,
  observedAt: string
): HistoricalMarketSnapshot {
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
