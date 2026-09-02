import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioExposureSnapshot,
  type VerifiedPortfolioExposureSnapshot
} from "./portfolioExposureSnapshot.js";
import {
  createPortfolioSizingSnapshot,
  parsePortfolioSizingSnapshot,
  type CreatePortfolioSizingSnapshotInput,
  type PortfolioSizingSnapshot
} from "./portfolioSizingSnapshot.js";
import {
  hashCanonicalPayload,
  hashDerivedId
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_F = `sha256:${"f".repeat(64)}` as const;
const AS_OF = "2026-09-02T00:00:00.000Z";

test("portfolio sizing snapshot binds canonical inputs to hash-derived identity", () => {
  const snapshot = createPortfolioSizingSnapshot(snapshotInput());

  assert.deepEqual(
    snapshot.virtualPortfolio.positions.map(
      ({ market, symbol, strategyBucket }) =>
        `${market}:${symbol}:${strategyBucket}`
    ),
    ["KR:005930:long_term", "US:AAPL:swing"]
  );
  assert.deepEqual(snapshot.virtualPortfolio.positions[0]?.priceSourceRefs, [
    "price-a",
    "price-b"
  ]);
  assert.deepEqual(
    snapshot.valuationInputs.map((input) => input.kind),
    ["mark_price", "mark_price", "fx_rate"]
  );
  const { portfolioSnapshotId, portfolioSnapshotHash, ...payload } = snapshot;
  assert.equal(portfolioSnapshotHash, hashCanonicalPayload(payload));
  assert.equal(
    portfolioSnapshotId,
    hashDerivedId("portfolio_sizing_snapshot", portfolioSnapshotHash)
  );
  assert.deepEqual(parsePortfolioSizingSnapshot(snapshot), snapshot);
  assert.equal(Object.isFrozen(snapshot.virtualPortfolio.positions), true);
});

test("portfolio sizing snapshot preserves split-bucket positions and rejects duplicate identities", () => {
  const input = snapshotInput();
  const first = input.virtualPortfolio as {
    positions: Array<Record<string, unknown>>;
  };
  const splitBucket = {
    ...first.positions[0]!,
    strategyBucket: "long_term",
    updatedAt: "2026-09-01T23:00:00.000Z"
  };
  const splitSnapshot = createPortfolioSizingSnapshot({
    ...input,
    virtualPortfolio: {
      ...first,
      positions: [...first.positions, splitBucket]
    }
  });
  assert.equal(splitSnapshot.virtualPortfolio.positions.length, 3);

  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...first,
          positions: [...first.positions, { ...first.positions[0] }]
        }
      }),
    /duplicate position identity/
  );
});

test("portfolio sizing snapshot rejects identity and nested hash tamper", () => {
  const input = snapshotInput();
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        exposureSnapshotHash: HASH_F
      }),
    /exposure snapshot hash mismatch/
  );

  const snapshot = createPortfolioSizingSnapshot(input);
  assert.throws(
    () =>
      parsePortfolioSizingSnapshot({
        ...snapshot,
        portfolioSnapshotHash: HASH_F
      }),
    /identity does not match payload/
  );
  assert.throws(
    () =>
      parsePortfolioSizingSnapshot({
        ...snapshot,
        portfolioSnapshotId: "portfolio_sizing_snapshot_wrong"
      }),
    /identity does not match payload/
  );
});

test("portfolio sizing snapshot rejects noncanonical stored arrays", () => {
  const snapshot = createPortfolioSizingSnapshot(snapshotInput());
  const reversedValuation = rehashSnapshot({
    ...snapshot,
    valuationInputs: [...snapshot.valuationInputs].reverse()
  });
  assert.throws(
    () => parsePortfolioSizingSnapshot(reversedValuation),
    /valuation inputs must already be canonical/
  );

  const reversedPositions = rehashSnapshot({
    ...snapshot,
    virtualPortfolio: {
      ...snapshot.virtualPortfolio,
      positions: [...snapshot.virtualPortfolio.positions].reverse()
    }
  });
  assert.throws(
    () => parsePortfolioSizingSnapshot(reversedPositions),
    /positions must already be canonical/
  );
});

test("portfolio sizing snapshot enforces scope chronology cash and pending totals", () => {
  const input = snapshotInput();
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        portfolioId: "portfolio-other"
      }),
    /portfolio scope/
  );
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        valuationInputs: [
          markInput({
            market: "KR",
            symbol: "005930",
            evidenceAsOf: "2026-09-02T00:00:01.000Z"
          })
        ]
      }),
    /valuation evidence cannot be after/
  );
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...(input.virtualPortfolio as object),
          cashKrw: 400_000
        }
      }),
    /exposure cash does not match/
  );

  const mismatchedExposure = exposure({ pendingBuyExposureKrw: 101 });
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        ...mismatchedExposure
      }),
    /pending action exposure totals do not match/
  );
});

test("portfolio sizing snapshot rejects normalized and malformed position identity", () => {
  const input = snapshotInput();
  const portfolio = input.virtualPortfolio as {
    positions: Array<Record<string, unknown>>;
  };
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...portfolio,
          positions: [
            { ...portfolio.positions[0], symbol: " AAPL " },
            portfolio.positions[1]
          ]
        }
      }),
    /must not require schema normalization/
  );
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...portfolio,
          positions: [
            { ...portfolio.positions[0], symbol: "\ud800" },
            portfolio.positions[1]
          ]
        }
      }),
    /well-formed Unicode/
  );
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...portfolio,
          updatedAt: "2026-09-01T23:00:00"
        }
      }),
    /timezone offset/
  );
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...portfolio,
          positions: [
            { ...portfolio.positions[0], marketValueKrw: -0 },
            portfolio.positions[1]
          ]
        }
      }),
    /position market value must not be negative zero/
  );
  assert.throws(
    () =>
      createPortfolioSizingSnapshot({
        ...input,
        virtualPortfolio: {
          ...portfolio,
          cashKrw: -0
        }
      }),
    /portfolio cash must not be negative zero/
  );
});

function snapshotInput(): CreatePortfolioSizingSnapshotInput {
  const verifiedExposure = exposure();
  return {
    portfolioId: "portfolio-1",
    portfolioVersion: "portfolio-version-1",
    policyHash: HASH_A,
    asOf: AS_OF,
    virtualPortfolio: {
      portfolioId: "portfolio-1",
      cashKrw: 500_000,
      positions: [
        {
          market: "US",
          symbol: "AAPL",
          assetType: "STOCK",
          assetClass: "equity",
          region: "US",
          riskTags: ["sector_concentrated", "currency_exposed"],
          strategyBucket: "swing",
          sector: "Technology",
          quantity: 2,
          averagePriceKrw: 100_000,
          marketPriceKrw: 100_000,
          marketValueKrw: 200_000,
          updatedAt: "2026-09-01T23:00:00.000Z"
        },
        {
          market: "KR",
          symbol: "005930",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          riskTags: ["sector_concentrated"],
          strategyBucket: "long_term",
          sector: "Electronics",
          quantity: 3,
          averagePriceKrw: 100_000,
          marketPriceKrw: 100_000,
          marketValueKrw: 300_000,
          priceSourceRefs: ["price-b", "price-a"],
          updatedAt: "2026-09-01T23:00:00.000Z"
        }
      ],
      updatedAt: "2026-09-01T23:00:00.000Z"
    },
    valuationInputs: [
      fxInput(),
      markInput({ market: "US", symbol: "AAPL" }),
      markInput({ market: "KR", symbol: "005930" })
    ],
    pendingActionInputs: [
      pendingSellInput(),
      pendingBuyInput()
    ],
    ...verifiedExposure
  };
}

function exposure(
  overrides: Partial<{
    pendingBuyExposureKrw: number;
    pendingSellExposureKrw: number;
  }> = {}
): VerifiedPortfolioExposureSnapshot {
  return createPortfolioExposureSnapshot({
    virtualNetWorthKrw: 1_000_000,
    cashKrw: 500_000,
    bucketExposureKrw: {
      hedge: 0,
      intraday: 0,
      long_term: 300_000,
      short_term: 0,
      swing: 200_000
    },
    symbolExposureKrw: [
      { market: "KR", symbol: "005930", exposureKrw: 300_000 },
      { market: "US", symbol: "AAPL", exposureKrw: 200_000 }
    ],
    marketExposureKrw: { KR: 300_000, US: 200_000 },
    sectorExposureKrw: { Electronics: 300_000, Technology: 200_000 },
    countryExposureKrw: { KR: 300_000, US: 200_000 },
    currencyExposureKrw: { KRW: 300_000, USD: 200_000 },
    pendingBuyExposureKrw: overrides.pendingBuyExposureKrw ?? 100,
    pendingSellExposureKrw: overrides.pendingSellExposureKrw ?? 80
  });
}

function markInput(overrides: {
  market: "KR" | "US";
  symbol: string;
  evidenceAsOf?: string;
}) {
  return {
    kind: "mark_price" as const,
    market: overrides.market,
    symbol: overrides.symbol,
    priceKrw: 100_000,
    evidenceRef: `evidence-${overrides.market}-${overrides.symbol}`,
    evidenceAsOf: overrides.evidenceAsOf ?? "2026-09-01T23:30:00.000Z"
  };
}

function fxInput() {
  return {
    kind: "fx_rate" as const,
    baseCurrency: "USD",
    quoteCurrency: "KRW" as const,
    rate: 1_400,
    evidenceRef: "evidence-fx-usd-krw",
    evidenceAsOf: "2026-09-01T23:30:00.000Z"
  };
}

function pendingBuyInput() {
  return {
    ...pendingBase("plan-buy", "action-buy", "KR", "005930", 100),
    side: "BUY" as const,
    openingCapacityReservationId: "reservation-buy",
    openingCapacityReservationHash: HASH_B
  };
}

function pendingSellInput() {
  return {
    ...pendingBase("plan-sell", "action-sell", "US", "AAPL", 80),
    side: "SELL" as const,
    remainingQuantity: 0.5,
    priceEvidenceRef: "evidence-sell-aapl"
  };
}

function pendingBase(
  planId: string,
  actionId: string,
  market: "KR" | "US",
  symbol: string,
  remainingNotionalKrw: number
) {
  return {
    planId,
    planHash: HASH_A,
    planEventId: `${planId}-event`,
    planEventHash: HASH_B,
    actionId,
    actionExecutionTargetHash: HASH_A,
    market,
    symbol,
    remainingNotionalKrw,
    asOf: "2026-09-01T23:45:00.000Z"
  };
}

function rehashSnapshot(
  value: PortfolioSizingSnapshot
): PortfolioSizingSnapshot {
  const {
    portfolioSnapshotId: _portfolioSnapshotId,
    portfolioSnapshotHash: _portfolioSnapshotHash,
    ...payload
  } = value;
  const portfolioSnapshotHash = hashCanonicalPayload(payload);
  return {
    portfolioSnapshotId: hashDerivedId(
      "portfolio_sizing_snapshot",
      portfolioSnapshotHash
    ),
    ...payload,
    portfolioSnapshotHash
  };
}
