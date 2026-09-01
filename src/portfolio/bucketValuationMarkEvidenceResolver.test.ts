import assert from "node:assert/strict";
import test from "node:test";

import { createBucketPositionMarkHeadState } from "./bucketPositionMarkHead.js";
import { createBucketValuationMarkRecord } from "./bucketValuationMark.js";
import { resolveBucketValuationMarkOrigins } from "./bucketValuationMarkOriginResolver.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("valuation mark resolves each current price to typed immutable evidence", () => {
  const samsung = positionHead();
  const hynix = positionHead({
    symbol: "000660",
    currentPriceKrw: 150,
    currentPriceEvidenceRef: "hynix-before",
    lastPositionMarkHeadEventId: "head-hynix"
  });
  const samsungEvidence = priceEvidence();
  const hynixEvidence = priceEvidence({
    symbol: "000660",
    priceKrw: 145,
    sourceRefs: ["hynix-source"]
  });
  const record = valuationMark([
    { head: samsung, evidence: samsungEvidence },
    { head: hynix, evidence: hynixEvidence }
  ]);

  const resolved = resolveBucketValuationMarkOrigins({
    value: record,
    currentStates: [hynix, samsung],
    currentPriceEvidence: [samsungEvidence, hynixEvidence]
  });

  assert.deepEqual(
    resolved.positions.map((position) => position.input.symbol),
    ["000660", "005930"]
  );
  assert.equal(
    resolved.positions[0]?.currentPriceEvidence.evidenceHash,
    hynixEvidence.evidenceHash
  );
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.positions));
});

test("valuation mark accepts equivalent offset notation for the observation instant", () => {
  const head = positionHead();
  const evidence = priceEvidence({
    observedAt: "2026-09-01T11:00:00+09:00",
    createdAt: "2026-09-01T11:00:00+09:00"
  });
  const record = valuationMark([{ head, evidence }]);

  const resolved = resolveBucketValuationMarkOrigins({
    value: record,
    currentStates: [head],
    currentPriceEvidence: [evidence]
  });
  assert.equal(resolved.positions.length, 1);
});

test("valuation mark rejects unresolved and duplicate current evidence", () => {
  const head = positionHead();
  const evidence = priceEvidence();
  const record = valuationMark([{ head, evidence }]);

  assert.throws(
    () =>
      resolveBucketValuationMarkOrigins({
        value: record,
        currentStates: [head],
        currentPriceEvidence: []
      }),
    /does not resolve exactly once/
  );
  assert.throws(
    () =>
      resolveBucketValuationMarkOrigins({
        value: record,
        currentStates: [head],
        currentPriceEvidence: [evidence, evidence]
      }),
    /duplicate ref/
  );
});

test("valuation mark rejects current evidence scope and value drift", () => {
  const head = positionHead();

  const foreign = priceEvidence({ symbol: "000660" });
  assert.throws(
    () => resolveWith(head, foreign),
    /scope mismatch/
  );

  const wrongPrice = priceEvidence({ priceKrw: 111 });
  const record = valuationMark(
    [{ head, evidence: wrongPrice }],
    { currentPriceKrwOverride: 110 }
  );
  assert.throws(
    () =>
      resolveBucketValuationMarkOrigins({
        value: record,
        currentStates: [head],
        currentPriceEvidence: [wrongPrice]
      }),
    /value mismatch/
  );
});

test("valuation mark rejects observation-time drift", () => {
  const head = positionHead();
  const stale = priceEvidence({
    observedAt: "2026-09-01T01:59:59.999Z"
  });
  assert.throws(() => resolveWith(head, stale), /time mismatch/);
});

test("valuation mark independently rehashes supplied current evidence", () => {
  const head = positionHead();
  const evidence = priceEvidence();
  const record = valuationMark([{ head, evidence }]);
  assert.throws(
    () =>
      resolveBucketValuationMarkOrigins({
        value: record,
        currentStates: [head],
        currentPriceEvidence: [{ ...evidence, evidenceHash: HASH_C }]
      }),
    /identity does not match/
  );
});

function resolveWith(
  head: ReturnType<typeof positionHead>,
  evidence: ReturnType<typeof priceEvidence>
) {
  const record = valuationMark([{ head, evidence }]);
  return resolveBucketValuationMarkOrigins({
    value: record,
    currentStates: [head],
    currentPriceEvidence: [evidence]
  });
}

function positionHead(
  overrides: Partial<{
    symbol: string;
    currentPriceKrw: number;
    currentPriceEvidenceRef: string;
    lastPositionMarkHeadEventId: string;
  }> = {}
) {
  return createBucketPositionMarkHeadState({
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol: overrides.symbol ?? "005930",
    quantity: 2,
    currentPriceKrw: overrides.currentPriceKrw ?? 100,
    currentPriceEvidenceRef:
      overrides.currentPriceEvidenceRef ?? "samsung-before",
    lastPositionMarkHeadEventId:
      overrides.lastPositionMarkHeadEventId ?? "head-samsung",
    lastPositionMarkHeadEventHash: HASH_A,
    asOf: "2026-09-01T01:00:00.000Z"
  });
}

function priceEvidence(
  overrides: Partial<{
    symbol: string;
    priceKrw: number;
    observedAt: string;
    createdAt: string;
    sourceRefs: string[];
  }> = {}
) {
  return createSourcePriceEvidenceRecord({
    sourceContractId: "contract-v1",
    market: "KR",
    symbol: overrides.symbol ?? "005930",
    priceField: "last_price",
    priceKrw: overrides.priceKrw ?? 110,
    observedAt: overrides.observedAt ?? "2026-09-01T02:00:00.000Z",
    sourceRefs: overrides.sourceRefs ?? ["samsung-source"],
    createdAt: overrides.createdAt ?? "2026-09-01T02:00:00.000Z"
  });
}

function valuationMark(
  positions: ReadonlyArray<{
    head: ReturnType<typeof positionHead>;
    evidence: ReturnType<typeof priceEvidence>;
  }>,
  overrides: { currentPriceKrwOverride?: number } = {}
) {
  const positionInputs = positions.map(({ head, evidence }) => ({
    market: head.market,
    symbol: head.symbol,
    quantity: head.quantity,
    previousPositionMarkHeadId: head.positionMarkHeadId,
    previousPositionMarkHeadHash: head.positionMarkHeadHash,
    previousPriceKrw: head.currentPriceKrw,
    currentPriceKrw:
      overrides.currentPriceKrwOverride ?? evidence.priceKrw,
    previousPriceEvidenceRef: head.currentPriceEvidenceRef,
    currentPriceEvidenceRef: evidence.evidenceRef
  }));
  return createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    positionInputs,
    equityDeltaKrw: positionInputs.reduce(
      (total, position) =>
        total +
        position.quantity *
          (position.currentPriceKrw - position.previousPriceKrw),
      0
    ),
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z"
  });
}
