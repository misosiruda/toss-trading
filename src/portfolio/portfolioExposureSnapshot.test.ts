import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioExposureSnapshot,
  hashPortfolioExposureSnapshot,
  parseVerifiedPortfolioExposureSnapshot,
  type PortfolioExposureSnapshot
} from "./portfolioExposureSnapshot.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

test("portfolio exposure snapshot canonicalizes dimensions and hashes full payload", () => {
  const verified = createPortfolioExposureSnapshot({
    ...snapshotInput(),
    symbolExposureKrw: [
      { market: "US", symbol: "AAPL", exposureKrw: 200_000 },
      { market: "KR", symbol: "005930", exposureKrw: 300_000 }
    ],
    sectorExposureKrw: { Technology: 200_000, Electronics: 300_000 },
    countryExposureKrw: { US: 200_000, KR: 300_000 },
    currencyExposureKrw: { USD: 200_000, KRW: 300_000 }
  });

  assert.deepEqual(verified.exposureSnapshot.symbolExposureKrw, [
    { market: "KR", symbol: "005930", exposureKrw: 300_000 },
    { market: "US", symbol: "AAPL", exposureKrw: 200_000 }
  ]);
  assert.deepEqual(Object.keys(verified.exposureSnapshot.sectorExposureKrw), [
    "Electronics",
    "Technology"
  ]);
  assert.deepEqual(Object.keys(verified.exposureSnapshot.countryExposureKrw), [
    "KR",
    "US"
  ]);
  assert.deepEqual(Object.keys(verified.exposureSnapshot.bucketExposureKrw), [
    "hedge",
    "intraday",
    "long_term",
    "short_term",
    "swing"
  ]);
  assert.equal(
    verified.exposureSnapshotHash,
    hashCanonicalPayload(verified.exposureSnapshot)
  );
  assert.equal(
    hashPortfolioExposureSnapshot(verified.exposureSnapshot),
    verified.exposureSnapshotHash
  );
  assert.deepEqual(parseVerifiedPortfolioExposureSnapshot(verified), verified);
  assert.equal(Object.isFrozen(verified.exposureSnapshot.symbolExposureKrw), true);
});

test("portfolio exposure snapshot rejects duplicate and noncanonical symbols", () => {
  const input = snapshotInput();
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...input,
        symbolExposureKrw: [
          input.symbolExposureKrw[0]!,
          input.symbolExposureKrw[0]!
        ]
      }),
    /duplicate instruments/
  );

  const verified = createPortfolioExposureSnapshot(input);
  const reversed = {
    ...verified,
    exposureSnapshot: {
      ...verified.exposureSnapshot,
      symbolExposureKrw: [...verified.exposureSnapshot.symbolExposureKrw].reverse()
    }
  };
  reversed.exposureSnapshotHash = hashCanonicalPayload(reversed.exposureSnapshot);
  assert.throws(
    () => parseVerifiedPortfolioExposureSnapshot(reversed),
    /canonical market and symbol order/
  );
});

test("portfolio exposure snapshot verifies all dimension totals", () => {
  const cases: Array<[keyof PortfolioExposureSnapshot, unknown]> = [
    [
      "bucketExposureKrw",
      { ...snapshotInput().bucketExposureKrw, long_term: 199_999 }
    ],
    [
      "marketExposureKrw",
      { ...snapshotInput().marketExposureKrw, KR: 299_999 }
    ],
    ["sectorExposureKrw", { Electronics: 299_999, Technology: 200_000 }],
    ["countryExposureKrw", { KR: 299_999, US: 200_000 }],
    ["currencyExposureKrw", { KRW: 299_999, USD: 200_000 }]
  ];
  for (const [key, value] of cases) {
    assert.throws(
      () => createPortfolioExposureSnapshot({ ...snapshotInput(), [key]: value }),
      /total does not match/
    );
  }

  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        symbolExposureKrw: [
          { market: "KR", symbol: "005930", exposureKrw: 299_999 },
          { market: "US", symbol: "AAPL", exposureKrw: 200_000 }
        ]
      }),
    /symbol exposure total does not match/
  );
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        pendingSellExposureKrw: 500_001
      }),
    /pending sell exposure exceeds/
  );
});

test("portfolio exposure snapshot rejects hash and canonical-map tamper", () => {
  const verified = createPortfolioExposureSnapshot(snapshotInput());
  assert.throws(
    () =>
      parseVerifiedPortfolioExposureSnapshot({
        ...verified,
        exposureSnapshotHash: `sha256:${"f".repeat(64)}`
      }),
    /hash mismatch/
  );

  const noncanonicalMap = {
    Technology: 200_000,
    Electronics: 300_000
  };
  const exposureSnapshot = {
    ...verified.exposureSnapshot,
    sectorExposureKrw: noncanonicalMap
  };
  assert.throws(
    () =>
      parseVerifiedPortfolioExposureSnapshot({
        exposureSnapshot,
        exposureSnapshotHash: hashCanonicalPayload(exposureSnapshot)
      }),
    /keys must use canonical order/
  );

  const reversedBucketMap = Object.fromEntries(
    Object.entries(verified.exposureSnapshot.bucketExposureKrw).reverse()
  ) as PortfolioExposureSnapshot["bucketExposureKrw"];
  const bucketOrderTamper = {
    ...verified.exposureSnapshot,
    bucketExposureKrw: reversedBucketMap
  };
  assert.throws(
    () =>
      parseVerifiedPortfolioExposureSnapshot({
        exposureSnapshot: bucketOrderTamper,
        exposureSnapshotHash: hashCanonicalPayload(bucketOrderTamper)
      }),
    /bucket exposure keys must use canonical order/
  );
});

test("portfolio exposure snapshot fails closed for noncanonical values", () => {
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        pendingBuyExposureKrw: -0
      }),
    /negative zero/
  );
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        symbolExposureKrw: [
          { market: "KR", symbol: " 005930 ", exposureKrw: 300_000 },
          { market: "US", symbol: "AAPL", exposureKrw: 200_000 }
        ]
      }),
    /key must already be canonical/
  );
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        cashKrw: 1_000_001
      }),
    /cash cannot exceed/
  );
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        virtualNetWorthKrw: Number.MAX_SAFE_INTEGER + 1
      }),
    /safe integer/
  );
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        sectorExposureKrw: {
          ...snapshotInput().sectorExposureKrw,
          UNUSED: 0
        }
      }),
    />0/
  );
  assert.throws(
    () =>
      createPortfolioExposureSnapshot({
        ...snapshotInput(),
        sectorExposureKrw: { "10": 300_000, Technology: 200_000 }
      }),
    /must not be an integer-index property/
  );
});

test("cash-only exposure has canonical empty dimensions", () => {
  const verified = createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 1_000_000,
    cashKrw: 1_000_000,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: 0,
      short_term: 0,
      swing: 0
    },
    symbolExposureKrw: [],
    marketExposureKrw: { KR: 0, US: 0 },
    sectorExposureKrw: {},
    countryExposureKrw: {},
    currencyExposureKrw: {},
    pendingBuyExposureKrw: 0,
    pendingSellExposureKrw: 0
  });

  assert.deepEqual(verified.exposureSnapshot.symbolExposureKrw, []);
  assert.match(verified.exposureSnapshotHash, /^sha256:[a-f0-9]{64}$/);
});

function snapshotInput(): PortfolioExposureSnapshot {
  return {
    virtualNetWorthKrw: 1_000_000,
    cashKrw: 500_000,
    bucketExposureKrw: {
      hedge: 50_000,
      intraday: 50_000,
      long_term: 200_000,
      short_term: 100_000,
      swing: 100_000
    },
    symbolExposureKrw: [
      { market: "KR", symbol: "005930", exposureKrw: 300_000 },
      { market: "US", symbol: "AAPL", exposureKrw: 200_000 }
    ],
    marketExposureKrw: { KR: 300_000, US: 200_000 },
    sectorExposureKrw: { Electronics: 300_000, Technology: 200_000 },
    countryExposureKrw: { KR: 300_000, US: 200_000 },
    currencyExposureKrw: { KRW: 300_000, USD: 200_000 },
    pendingBuyExposureKrw: 20_000,
    pendingSellExposureKrw: 10_000
  };
}
