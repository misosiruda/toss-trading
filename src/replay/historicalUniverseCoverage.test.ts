import assert from "node:assert/strict";
import test from "node:test";

import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import {
  assessHistoricalUniverseCoverage,
  parseHistoricalUniverseManifest,
  requiredSymbolsFromHistoricalUniverse,
  type HistoricalUniverseManifest
} from "./historicalUniverseCoverage.js";

test("historical universe coverage passes required core while reporting optional gaps", () => {
  const report = assessHistoricalUniverseCoverage({
    universe: universe(),
    snapshots: [
      snapshot("hist_005930_202501", "005930", "2025-01-02T15:30:00+09:00"),
      snapshot("hist_005930_202502", "005930", "2025-02-03T15:30:00+09:00"),
      snapshot("hist_000660_202501", "000660", "2025-01-02T15:30:00+09:00"),
      snapshot("hist_000660_202502", "000660", "2025-02-03T15:30:00+09:00")
    ],
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1
  });

  assert.equal(report.status, "available");
  assert.equal(report.universeSymbolCount, 3);
  assert.equal(report.requiredSymbolCount, 2);
  assert.equal(report.optionalSymbolCount, 1);
  assert.equal(report.availableRequiredSymbolCount, 2);
  assert.equal(report.availableOptionalSymbolCount, 0);
  assert.deepEqual(report.missingOptionalSymbols, [
    { market: "KR", symbol: "035420" }
  ]);
  const skHynix = report.symbolSummaries.find((item) => item.symbol === "000660");
  assert.equal(skHynix?.assetType, "STOCK");
  assert.equal(skHynix?.assetClass, "equity");
  assert.equal(skHynix?.region, "KR");
  assert.deepEqual(skHynix?.riskTags, ["sector_concentrated"]);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.expectedMonths, ["2025-01", "2025-02"]);
});

test("historical universe coverage fails closed when optional symbols are required", () => {
  const report = assessHistoricalUniverseCoverage({
    universe: universe(),
    snapshots: [
      snapshot("hist_005930_202501", "005930", "2025-01-02T15:30:00+09:00"),
      snapshot("hist_005930_202502", "005930", "2025-02-03T15:30:00+09:00"),
      snapshot("hist_000660_202501", "000660", "2025-01-02T15:30:00+09:00"),
      snapshot("hist_000660_202502", "000660", "2025-02-03T15:30:00+09:00")
    ],
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    requireOptionalSymbols: true
  });

  assert.equal(report.status, "insufficient");
  assert.deepEqual(report.issues, ["OPTIONAL_UNIVERSE_SYMBOL_MISSING"]);
});

test("historical universe coverage reports partial monthly gaps", () => {
  const report = assessHistoricalUniverseCoverage({
    universe: universe(),
    snapshots: [
      snapshot("hist_005930_202501", "005930", "2025-01-02T15:30:00+09:00"),
      snapshot("hist_005930_202502", "005930", "2025-02-03T15:30:00+09:00"),
      snapshot("hist_000660_202501", "000660", "2025-01-02T15:30:00+09:00")
    ],
    rangeStart: new Date("2025-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2025-02-28T23:59:59.999+09:00"),
    minMonthlyCoverageRatio: 1
  });
  const insufficient = report.insufficientRequiredSymbols[0];

  assert.equal(report.status, "insufficient");
  assert.equal(insufficient?.symbol, "000660");
  assert.equal(insufficient?.monthlyCoverageRatio, 0.5);
  assert.deepEqual(insufficient?.missingMonths, ["2025-02"]);
  assert.ok(
    report.issues.includes("REQUIRED_UNIVERSE_SYMBOL_COVERAGE_BELOW_MINIMUM")
  );
});

test("historical universe manifest parser rejects duplicate symbols", () => {
  assert.throws(
    () =>
      parseHistoricalUniverseManifest({
        ...universe(),
        symbols: [
          { market: "KR", symbol: "005930" },
          { market: "KR", symbol: "005930" }
        ]
      }),
    /unique/
  );
});

test("requiredSymbolsFromHistoricalUniverse can include optional symbols", () => {
  const manifest = universe();

  assert.deepEqual(requiredSymbolsFromHistoricalUniverse(manifest), [
    { market: "KR", symbol: "000660" },
    { market: "KR", symbol: "005930" }
  ]);
  assert.deepEqual(
    requiredSymbolsFromHistoricalUniverse(manifest, { includeOptional: true }),
    [
      { market: "KR", symbol: "000660" },
      { market: "KR", symbol: "005930" },
      { market: "KR", symbol: "035420" }
    ]
  );
});

function universe(): HistoricalUniverseManifest {
  return parseHistoricalUniverseManifest({
    mode: "paper_only_historical_universe",
    universeId: "fixture-universe",
    symbols: [
      { market: "KR", symbol: "005930", required: true },
      {
        market: "KR",
        symbol: "000660",
        assetType: "STOCK",
        assetClass: "equity",
        region: "KR",
        riskTags: ["sector_concentrated"],
        required: true
      },
      { market: "KR", symbol: "035420", required: false }
    ],
    disclaimer: "Paper-only fixture."
  });
}

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
    interval: "1d",
    lastPriceKrw: 70_000,
    volume: 100_000,
    sourceRefs: [`fixture:${snapshotId}`],
    createdAt: observedAt
  };
}
