import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizePendingPortfolioActionInputs,
  canonicalizePortfolioValuationInputs,
  parseCanonicalPendingPortfolioActionInputs,
  parseCanonicalPortfolioValuationInputs,
  pendingActionExposureTotals
} from "./portfolioSizingInputs.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const AS_OF = "2026-09-02T00:00:00.000Z";

test("valuation inputs canonicalize mark and FX identities", () => {
  const inputs = canonicalizePortfolioValuationInputs([
    fxInput({ baseCurrency: "USD" }),
    markInput({ market: "US", symbol: "AAPL", priceKrw: 100.5 }),
    markInput({ market: "KR", symbol: "005930" })
  ]);

  assert.deepEqual(
    inputs.map((input) =>
      input.kind === "mark_price"
        ? `${input.kind}:${input.market}:${input.symbol}`
        : `${input.kind}:${input.baseCurrency}:${input.quoteCurrency}`
    ),
    ["mark_price:KR:005930", "mark_price:US:AAPL", "fx_rate:USD:KRW"]
  );
  const usMark = inputs[1];
  assert(usMark?.kind === "mark_price");
  assert.equal(usMark.priceKrw, 100.5);
  assert.deepEqual(parseCanonicalPortfolioValuationInputs(inputs), inputs);
  assert.equal(Object.isFrozen(inputs), true);
});

test("valuation inputs reject duplicate identities and noncanonical order", () => {
  assert.throws(
    () =>
      canonicalizePortfolioValuationInputs([
        markInput(),
        markInput({ priceKrw: 101 })
      ]),
    /duplicate identity/
  );
  assert.throws(
    () =>
      canonicalizePortfolioValuationInputs([
        fxInput(),
        fxInput({ rate: 1_401 })
      ]),
    /duplicate identity/
  );
  assert.throws(
    () =>
      parseCanonicalPortfolioValuationInputs([
        fxInput(),
        markInput()
      ]),
    /must already be canonical/
  );
});

test("valuation inputs fail closed for transformed and unsafe values", () => {
  assert.throws(
    () =>
      canonicalizePortfolioValuationInputs([
        markInput({ symbol: " 005930 " })
      ]),
    /identifier must already be canonical/
  );
  assert.throws(
    () =>
      canonicalizePortfolioValuationInputs([
        markInput({ priceKrw: Number.POSITIVE_INFINITY })
      ]),
    /expected number/
  );
  assert.throws(
    () =>
      canonicalizePortfolioValuationInputs([
        fxInput({ evidenceAsOf: "2026-09-02T00:00:00" })
      ]),
    /timezone offset/
  );
});

test("pending actions canonicalize by instrument side plan and action", () => {
  const inputs = canonicalizePendingPortfolioActionInputs([
    sellInput({
      market: "US",
      symbol: "AAPL",
      planId: "plan-2",
      actionId: "sell-1"
    }),
    buyInput({
      market: "KR",
      symbol: "005930",
      planId: "plan-2",
      actionId: "buy-2"
    }),
    buyInput({
      market: "KR",
      symbol: "005930",
      planId: "plan-1",
      actionId: "buy-1"
    })
  ]);

  assert.deepEqual(
    inputs.map(({ market, symbol, side, planId }) =>
      `${market}:${symbol}:${side}:${planId}`
    ),
    [
      "KR:005930:BUY:plan-1",
      "KR:005930:BUY:plan-2",
      "US:AAPL:SELL:plan-2"
    ]
  );
  assert.deepEqual(parseCanonicalPendingPortfolioActionInputs(inputs), inputs);
});

test("pending actions preserve strict side origins and reject duplicates", () => {
  assert.throws(
    () =>
      canonicalizePendingPortfolioActionInputs([
        buyInput(),
        buyInput({ remainingNotionalKrw: 11 })
      ]),
    /duplicate plan action/
  );
  assert.throws(
    () =>
      canonicalizePendingPortfolioActionInputs([
        { ...buyInput(), remainingQuantity: 1 }
      ]),
    /unrecognized key/i
  );
  const { openingCapacityReservationId: _id, ...missingBuyOrigin } = buyInput();
  assert.throws(
    () => canonicalizePendingPortfolioActionInputs([missingBuyOrigin]),
    /openingCapacityReservationId/
  );
  assert.throws(
    () =>
      parseCanonicalPendingPortfolioActionInputs([
        sellInput({ market: "US", symbol: "AAPL" }),
        buyInput({ market: "KR", symbol: "005930" })
      ]),
    /must already be canonical/
  );
});

test("pending action totals split BUY and SELL remaining notional", () => {
  const inputs = canonicalizePendingPortfolioActionInputs([
    buyInput({ actionId: "buy-1", remainingNotionalKrw: 100 }),
    buyInput({ actionId: "buy-2", remainingNotionalKrw: 50 }),
    sellInput({ actionId: "sell-1", remainingNotionalKrw: 80 })
  ]);
  assert.deepEqual(pendingActionExposureTotals(inputs), {
    pendingBuyExposureKrw: 150,
    pendingSellExposureKrw: 80
  });

  const nearLimit = canonicalizePendingPortfolioActionInputs([
    buyInput({ actionId: "buy-1", remainingNotionalKrw: Number.MAX_SAFE_INTEGER }),
    buyInput({ actionId: "buy-2", remainingNotionalKrw: 1 })
  ]);
  assert.throws(
    () => pendingActionExposureTotals(nearLimit),
    /total is not a safe integer/
  );
});

function markInput(
  overrides: Partial<{
    market: "KR" | "US";
    symbol: string;
    priceKrw: number;
    evidenceRef: string;
    evidenceAsOf: string;
  }> = {}
) {
  return {
    kind: "mark_price" as const,
    market: overrides.market ?? "KR",
    symbol: overrides.symbol ?? "005930",
    priceKrw: overrides.priceKrw ?? 100,
    evidenceRef: overrides.evidenceRef ?? "evidence-mark",
    evidenceAsOf: overrides.evidenceAsOf ?? AS_OF
  };
}

function fxInput(
  overrides: Partial<{
    baseCurrency: string;
    rate: number;
    evidenceRef: string;
    evidenceAsOf: string;
  }> = {}
) {
  return {
    kind: "fx_rate" as const,
    baseCurrency: overrides.baseCurrency ?? "USD",
    quoteCurrency: "KRW" as const,
    rate: overrides.rate ?? 1_400,
    evidenceRef: overrides.evidenceRef ?? "evidence-fx",
    evidenceAsOf: overrides.evidenceAsOf ?? AS_OF
  };
}

function pendingBase(overrides: Record<string, unknown> = {}) {
  return {
    planId: "plan-1",
    planHash: HASH_A,
    planEventId: "plan-event-1",
    planEventHash: HASH_B,
    actionId: "action-1",
    actionExecutionTargetHash: HASH_A,
    market: "KR" as const,
    symbol: "005930",
    remainingNotionalKrw: 10,
    asOf: AS_OF,
    ...overrides
  };
}

function buyInput(overrides: Record<string, unknown> = {}) {
  return {
    ...pendingBase(overrides),
    side: "BUY" as const,
    openingCapacityReservationId: "reservation-1",
    openingCapacityReservationHash: HASH_B
  };
}

function sellInput(overrides: Record<string, unknown> = {}) {
  return {
    ...pendingBase(overrides),
    side: "SELL" as const,
    remainingQuantity: 1,
    priceEvidenceRef: "evidence-sell"
  };
}
