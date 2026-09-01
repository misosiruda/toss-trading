import assert from "node:assert/strict";
import test from "node:test";

import { createBucketPositionMarkHeadState } from "./bucketPositionMarkHead.js";
import {
  type BucketValuationPositionInput,
  createBucketValuationMarkRecord
} from "./bucketValuationMark.js";
import { resolveBucketValuationMarkPreviousHeads } from "./bucketValuationMarkOriginResolver.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("valuation mark resolves every active previous head in canonical input order", () => {
  const samsung = positionHead();
  const hynix = positionHead({
    symbol: "000660",
    quantity: 1,
    currentPriceKrw: 150,
    currentPriceEvidenceRef: "price-hynix-before",
    lastPositionMarkHeadEventId: "head-hynix"
  });
  const foreign = positionHead({
    portfolioId: "portfolio-2",
    symbol: "AAPL",
    currentPriceEvidenceRef: "price-aapl-before",
    lastPositionMarkHeadEventId: "head-aapl"
  });
  const record = valuationMark([samsung, hynix]);

  const resolved = resolveBucketValuationMarkPreviousHeads({
    value: record,
    currentStates: [foreign, samsung, hynix]
  });

  assert.deepEqual(
    resolved.positions.map((position) => position.input.symbol),
    ["000660", "005930"]
  );
  assert.equal(
    resolved.positions[0]?.previousHead.positionMarkHeadHash,
    hynix.positionMarkHeadHash
  );
  assert.equal(resolved.record.bucketValuationMarkRecordId, record.bucketValuationMarkRecordId);
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.positions));
});

test("valuation mark rejects missing and unclaimed active positions", () => {
  const samsung = positionHead();
  const hynix = positionHead({
    symbol: "000660",
    currentPriceEvidenceRef: "price-hynix-before",
    lastPositionMarkHeadEventId: "head-hynix"
  });
  const record = valuationMark([samsung]);

  assert.throws(
    () =>
      resolveBucketValuationMarkPreviousHeads({
        value: record,
        currentStates: []
      }),
    /does not cover every active position/
  );
  assert.throws(
    () =>
      resolveBucketValuationMarkPreviousHeads({
        value: record,
        currentStates: [samsung, hynix]
      }),
    /does not cover every active position/
  );
});

test("valuation mark ignores closed and foreign-scope heads", () => {
  const active = positionHead();
  const closed = positionHead({
    symbol: "000660",
    quantity: 0,
    currentPriceEvidenceRef: "price-closed",
    lastPositionMarkHeadEventId: "head-closed"
  });
  const foreignBucket = positionHead({
    bucket: "hedge",
    symbol: "AAPL",
    currentPriceEvidenceRef: "price-aapl",
    lastPositionMarkHeadEventId: "head-aapl"
  });

  const resolved = resolveBucketValuationMarkPreviousHeads({
    value: valuationMark([active]),
    currentStates: [closed, foreignBucket, active]
  });
  assert.equal(resolved.positions.length, 1);
});

test("valuation mark rejects previous head identity and quantity drift", () => {
  const head = positionHead();
  const record = valuationMark([head]);
  const positionInput = record.positionInputs[0];
  assert.ok(positionInput);

  for (const changedInput of [
    { ...positionInput, previousPositionMarkHeadId: "different-head" },
    { ...positionInput, previousPositionMarkHeadHash: HASH_C }
  ]) {
    assert.throws(
      () =>
        resolveBucketValuationMarkPreviousHeads({
          value: valuationMarkFromInputs([changedInput]),
          currentStates: [head]
        }),
      /previous head identity mismatch/
    );
  }
  assert.throws(
    () =>
      resolveBucketValuationMarkPreviousHeads({
        value: valuationMarkFromInputs([
          { ...positionInput, quantity: positionInput.quantity + 1 }
        ]),
        currentStates: [head]
      }),
    /quantity mismatch/
  );
});

test("valuation mark rejects previous price, evidence, and interval drift", () => {
  const head = positionHead();
  const record = valuationMark([head]);
  const positionInput = record.positionInputs[0];
  assert.ok(positionInput);

  for (const changedInput of [
    { ...positionInput, previousPriceKrw: positionInput.previousPriceKrw + 1 },
    { ...positionInput, previousPriceEvidenceRef: "different-evidence" }
  ]) {
    assert.throws(
      () =>
        resolveBucketValuationMarkPreviousHeads({
          value: valuationMarkFromInputs([changedInput]),
          currentStates: [head]
        }),
      /previous price basis mismatch/
    );
  }
  assert.throws(
    () =>
      resolveBucketValuationMarkPreviousHeads({
        value: valuationMark([head], { asOf: head.asOf }),
        currentStates: [head]
      }),
    /must advance every previous head interval/
  );
});

test("valuation mark rejects duplicate and corrupt supplied state scopes", () => {
  const head = positionHead();
  const record = valuationMark([head]);
  assert.throws(
    () =>
      resolveBucketValuationMarkPreviousHeads({
        value: record,
        currentStates: [head, head]
      }),
    /duplicate scope/
  );
  assert.throws(
    () =>
      resolveBucketValuationMarkPreviousHeads({
        value: record,
        currentStates: [{ ...head, positionMarkHeadHash: HASH_C }]
      }),
    /identity does not match/
  );
});

function positionHead(
  overrides: Partial<{
    portfolioId: string;
    bucket: "swing" | "hedge";
    symbol: string;
    quantity: number;
    currentPriceKrw: number;
    currentPriceEvidenceRef: string;
    lastPositionMarkHeadEventId: string;
  }> = {}
) {
  return createBucketPositionMarkHeadState({
    portfolioId: overrides.portfolioId ?? "portfolio-1",
    bucket: overrides.bucket ?? "swing",
    market: "KR",
    symbol: overrides.symbol ?? "005930",
    quantity: overrides.quantity ?? 2,
    currentPriceKrw: overrides.currentPriceKrw ?? 100,
    currentPriceEvidenceRef:
      overrides.currentPriceEvidenceRef ?? "price-samsung-before",
    lastPositionMarkHeadEventId:
      overrides.lastPositionMarkHeadEventId ?? "head-samsung",
    lastPositionMarkHeadEventHash: HASH_A,
    asOf: "2026-09-01T01:00:00.000Z"
  });
}

function valuationMark(
  states: readonly ReturnType<typeof positionHead>[],
  overrides: { asOf?: string } = {}
) {
  return valuationMarkFromInputs(
    states.map((state) => ({
      market: state.market,
      symbol: state.symbol,
      quantity: state.quantity,
      previousPositionMarkHeadId: state.positionMarkHeadId,
      previousPositionMarkHeadHash: state.positionMarkHeadHash,
      previousPriceKrw: state.currentPriceKrw,
      currentPriceKrw:
        state.symbol === "000660" ? state.currentPriceKrw - 5 : state.currentPriceKrw + 10,
      previousPriceEvidenceRef: state.currentPriceEvidenceRef,
      currentPriceEvidenceRef: `price-${state.symbol}-after`
    })),
    overrides
  );
}

function valuationMarkFromInputs(
  positionInputs: BucketValuationPositionInput[],
  overrides: { asOf?: string } = {}
) {
  const equityDeltaKrw = positionInputs.reduce(
    (total, input) =>
      total + input.quantity * (input.currentPriceKrw - input.previousPriceKrw),
    0
  );
  return createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    positionInputs,
    equityDeltaKrw,
    asOf: overrides.asOf ?? "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z"
  });
}
