import assert from "node:assert/strict";
import test from "node:test";

import {
  createBucketValuationMarkRecord,
  parseBucketValuationMarkRecord
} from "./bucketValuationMark.js";
import {
  hashCanonicalPayload,
  hashDerivedId
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

test("bucket valuation mark canonicalizes instruments and derives identity", () => {
  const record = createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_A,
    positionInputs: [
      positionInput({
        market: "US",
        symbol: "AAPL",
        quantity: 1.5,
        previousPriceKrw: 200,
        currentPriceKrw: 190
      }),
      positionInput({
        market: "KR",
        symbol: "005930",
        quantity: 2,
        previousPriceKrw: 100,
        currentPriceKrw: 110
      })
    ],
    equityDeltaKrw: 5,
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });

  assert.deepEqual(
    record.positionInputs.map(({ market, symbol }) => ({ market, symbol })),
    [
      { market: "KR", symbol: "005930" },
      { market: "US", symbol: "AAPL" }
    ]
  );
  const { bucketValuationMarkRecordId, valuationMarkHash, createdAt, ...payload } =
    record;
  assert.equal(valuationMarkHash, hashCanonicalPayload(payload));
  assert.equal(
    bucketValuationMarkRecordId,
    hashDerivedId("bucket_valuation_mark", valuationMarkHash)
  );
  assert.equal(createdAt, "2026-09-01T01:00:01.000Z");
  assert.deepEqual(parseBucketValuationMarkRecord(record), record);
  assert.equal(Object.isFrozen(record.positionInputs), true);
});

test("bucket valuation mark independently recalculates equity delta", () => {
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        equityDeltaKrw: 11
      }),
    /equity delta does not match/
  );

  const record = createBucketValuationMarkRecord(recordInput());
  assert.throws(
    () =>
      parseBucketValuationMarkRecord({
        ...record,
        positionInputs: record.positionInputs.map((position) => ({
          ...position,
          currentPriceEvidenceRef: "tampered-evidence"
        }))
      }),
    /identity does not match/
  );
});

test("bucket valuation mark rejects duplicate and noncanonical instruments", () => {
  const duplicate = positionInput();
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        positionInputs: [duplicate, duplicate]
      }),
    /duplicate instruments/
  );

  const canonical = createBucketValuationMarkRecord({
    ...recordInput(),
    positionInputs: [
      positionInput({ market: "KR", symbol: "005930" }),
      positionInput({ market: "US", symbol: "AAPL" })
    ],
    equityDeltaKrw: 20
  });
  const { bucketValuationMarkRecordId, valuationMarkHash, createdAt, ...payload } =
    canonical;
  const reversedPayload = {
    ...payload,
    positionInputs: [...payload.positionInputs].reverse()
  };
  const reversedHash = hashCanonicalPayload(reversedPayload);
  assert.throws(
    () =>
      parseBucketValuationMarkRecord({
        ...reversedPayload,
        bucketValuationMarkRecordId: hashDerivedId(
          "bucket_valuation_mark",
          reversedHash
        ),
        valuationMarkHash: reversedHash,
        createdAt
      }),
    /canonical market and symbol order/
  );
  assert.notEqual(bucketValuationMarkRecordId, "");
  assert.notEqual(valuationMarkHash, "");
});

test("bucket valuation mark rejects invalid chronology and numeric identity", () => {
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        createdAt: "2026-09-01T00:59:59.999Z"
      }),
    /cannot be created before/
  );
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        equityDeltaKrw: -0
      }),
    /negative zero/
  );
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        positionInputs: [
          positionInput({
            quantity: Number.MAX_VALUE,
            previousPriceKrw: 1,
            currentPriceKrw: Number.MAX_VALUE
          })
        ],
        equityDeltaKrw: 0
      }),
    /must remain finite/
  );
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        positionInputs: [
          positionInput({
            quantity: Number.MIN_VALUE,
            previousPriceKrw: 1,
            currentPriceKrw: 1.5
          })
        ],
        equityDeltaKrw: 0
      }),
    /must remain finite/
  );
  assert.throws(
    () =>
      createBucketValuationMarkRecord({
        ...recordInput(),
        positionInputs: [
          positionInput({
            quantity: 1,
            previousPriceKrw: 1,
            currentPriceKrw: 1 + Number.EPSILON
          })
        ],
        equityDeltaKrw: 0
      }),
    /equity delta does not match/
  );
});

function recordInput() {
  return {
    portfolioId: "portfolio-1",
    bucket: "swing" as const,
    policyHash: HASH_A,
    positionInputs: [positionInput()],
    equityDeltaKrw: 10,
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  };
}

function positionInput(
  overrides: Partial<{
    market: "KR" | "US";
    symbol: string;
    quantity: number;
    previousPriceKrw: number;
    currentPriceKrw: number;
  }> = {}
) {
  return {
    market: "KR" as const,
    symbol: "005930",
    quantity: 1,
    previousPositionMarkHeadId: "mark-head-1",
    previousPositionMarkHeadHash: HASH_B,
    previousPriceKrw: 100,
    currentPriceKrw: 110,
    previousPriceEvidenceRef: "price-evidence-before",
    currentPriceEvidenceRef: "price-evidence-after",
    ...overrides
  };
}
