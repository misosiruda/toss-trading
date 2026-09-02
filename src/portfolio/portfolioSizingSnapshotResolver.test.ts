import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioExposureSnapshot,
  type VerifiedPortfolioExposureSnapshot
} from "./portfolioExposureSnapshot.js";
import {
  createPortfolioSizingSnapshot,
  type CreatePortfolioSizingSnapshotInput
} from "./portfolioSizingSnapshot.js";
import { resolvePortfolioSizingSnapshot } from "./portfolioSizingSnapshotResolver.js";

const HASH = `sha256:${"a".repeat(64)}` as const;

test("sizing resolver replays exact marks, FX coverage, NAV, and exposure", () => {
  const snapshot = createPortfolioSizingSnapshot(snapshotInput());
  const resolved = resolvePortfolioSizingSnapshot(snapshot);

  assert.deepEqual(resolved.verifiedExposure, verifiedExposure());
  assert.deepEqual(resolved.snapshot, snapshot);
  assert.equal(Object.isFrozen(resolved), true);
});

test("sizing resolver requires exact held-position mark coverage", () => {
  const missingMark = snapshotInput();
  missingMark.valuationInputs = missingMark.valuationInputs.filter(
    (input) =>
      !(
        typeof input === "object" &&
        input !== null &&
        "symbol" in input &&
        input.symbol === "AAPL"
      )
  );
  assert.throws(
    () =>
      resolvePortfolioSizingSnapshot(
        createPortfolioSizingSnapshot(missingMark)
      ),
    /missing a position mark/
  );

  const extraMark = snapshotInput();
  extraMark.valuationInputs = [
    ...extraMark.valuationInputs,
    mark("KR", "000660", 120_000)
  ];
  assert.throws(
    () =>
      resolvePortfolioSizingSnapshot(createPortfolioSizingSnapshot(extraMark)),
    /unheld mark/
  );
});

test("sizing resolver requires exact market FX coverage", () => {
  const missingFx = snapshotInput();
  missingFx.valuationInputs = missingFx.valuationInputs.filter(
    (input) =>
      !(
        typeof input === "object" &&
        input !== null &&
        "kind" in input &&
        input.kind === "fx_rate"
      )
  );
  assert.throws(
    () =>
      resolvePortfolioSizingSnapshot(createPortfolioSizingSnapshot(missingFx)),
    /missing a required FX pair/
  );

  const krOnly = snapshotInput({ includeUs: false });
  krOnly.valuationInputs = [
    ...krOnly.valuationInputs,
    fx("USD", 1_400)
  ];
  assert.throws(
    () =>
      resolvePortfolioSizingSnapshot(createPortfolioSizingSnapshot(krOnly)),
    /unused FX pair/
  );
});

test("sizing resolver rejects stored dimension and NAV divergence", () => {
  const input = snapshotInput();
  const divergentExposure = createPortfolioExposureSnapshot({
    ...verifiedExposure().exposureSnapshot,
    sectorExposureKrw: { Other: 500_000 }
  });
  input.exposureSnapshot = divergentExposure.exposureSnapshot;
  input.exposureSnapshotHash = divergentExposure.exposureSnapshotHash;

  assert.throws(
    () => resolvePortfolioSizingSnapshot(createPortfolioSizingSnapshot(input)),
    /does not match valuation replay/
  );
});

test("sizing resolver fails closed for metadata and embedded mark drift", () => {
  const missingSector = snapshotInput();
  const missingSectorPortfolio = missingSector.virtualPortfolio as {
    positions: Array<Record<string, unknown>>;
  };
  delete missingSectorPortfolio.positions[0]?.sector;
  assert.throws(
    () =>
      resolvePortfolioSizingSnapshot(
        createPortfolioSizingSnapshot(missingSector)
      ),
    /missing sector/
  );

  const staleEmbeddedMark = snapshotInput();
  const stalePortfolio = staleEmbeddedMark.virtualPortfolio as {
    positions: Array<Record<string, unknown>>;
  };
  stalePortfolio.positions[0]!.marketValueKrw = 199_999;
  assert.throws(
    () =>
      resolvePortfolioSizingSnapshot(
        createPortfolioSizingSnapshot(staleEmbeddedMark)
      ),
    /market value does not match mark/
  );
});

function snapshotInput(
  overrides: { includeUs?: boolean } = {}
): CreatePortfolioSizingSnapshotInput {
  const includeUs = overrides.includeUs ?? true;
  const exposure = verifiedExposure({ includeUs });
  const positions: Array<Record<string, unknown>> = [
    position({
      market: "KR",
      symbol: "005930",
      strategyBucket: "long_term",
      sector: "Electronics",
      region: "KR",
      quantity: 2,
      marketValueKrw: 200_000
    }),
    position({
      market: "KR",
      symbol: "005930",
      strategyBucket: "short_term",
      sector: "Electronics",
      region: "KR",
      quantity: 1,
      marketValueKrw: 100_000
    })
  ];
  if (includeUs) {
    positions.push(
      position({
        market: "US",
        symbol: "AAPL",
        strategyBucket: "swing",
        sector: "Technology",
        region: "US",
        quantity: 2,
        marketValueKrw: 200_000
      })
    );
  }
  return {
    portfolioId: "portfolio-1",
    portfolioVersion: "portfolio-version-1",
    policyHash: HASH,
    asOf: "2026-09-02T00:00:00.000Z",
    virtualPortfolio: {
      portfolioId: "portfolio-1",
      cashKrw: includeUs ? 400_000 : 600_000,
      positions,
      updatedAt: "2026-09-01T23:30:00.000Z"
    },
    valuationInputs: [
      mark("KR", "005930", 100_000),
      ...(includeUs
        ? [mark("US", "AAPL", 100_000), fx("USD", 1_400)]
        : [])
    ],
    pendingActionInputs: [],
    ...exposure
  };
}

function verifiedExposure(
  overrides: { includeUs?: boolean } = {}
): VerifiedPortfolioExposureSnapshot {
  const includeUs = overrides.includeUs ?? true;
  return createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 900_000,
    cashKrw: includeUs ? 400_000 : 600_000,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: 200_000,
      short_term: 100_000,
      swing: includeUs ? 200_000 : 0
    },
    symbolExposureKrw: [
      { market: "KR", symbol: "005930", exposureKrw: 300_000 },
      ...(includeUs
        ? [{ market: "US" as const, symbol: "AAPL", exposureKrw: 200_000 }]
        : [])
    ],
    marketExposureKrw: {
      KR: 300_000,
      US: includeUs ? 200_000 : 0
    },
    sectorExposureKrw: {
      Electronics: 300_000,
      ...(includeUs ? { Technology: 200_000 } : {})
    },
    countryExposureKrw: {
      KR: 300_000,
      ...(includeUs ? { US: 200_000 } : {})
    },
    currencyExposureKrw: {
      KRW: 300_000,
      ...(includeUs ? { USD: 200_000 } : {})
    },
    pendingBuyExposureKrw: 0,
    pendingSellExposureKrw: 0
  });
}

function position(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    assetType: "STOCK",
    assetClass: "equity",
    riskTags: [],
    averagePriceKrw: 100_000,
    marketPriceKrw: 100_000,
    unrealizedPnlKrw: 0,
    updatedAt: "2026-09-01T23:30:00.000Z",
    ...overrides
  };
}

function mark(market: "KR" | "US", symbol: string, priceKrw: number) {
  return {
    kind: "mark_price" as const,
    market,
    symbol,
    priceKrw,
    evidenceRef: `price-${market}-${symbol}`,
    evidenceAsOf: "2026-09-01T23:00:00.000Z"
  };
}

function fx(baseCurrency: string, rate: number) {
  return {
    kind: "fx_rate" as const,
    baseCurrency,
    quoteCurrency: "KRW" as const,
    rate,
    evidenceRef: `fx-${baseCurrency}-KRW`,
    evidenceAsOf: "2026-09-01T23:00:00.000Z"
  };
}
