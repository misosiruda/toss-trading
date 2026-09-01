import assert from "node:assert/strict";
import test from "node:test";

import {
  parseBucketEquityEvent,
  createBucketRiskState
} from "./bucketEquity.js";
import {
  createBucketPositionMarkHeadState,
  parseBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import { resolveBucketValuationApplication } from "./bucketValuationApplication.js";
import { createBucketValuationMarkRecord } from "./bucketValuationMark.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("valuation application binds one equity event to every position event", () => {
  const fixture = applicationFixture();

  const resolved = resolveBucketValuationApplication(fixture.input);

  assert.equal(resolved.bucketEquityEvent.eventType, "valuation");
  assert.equal(
    resolved.bucketEquityEvent.previousBucketEquityEventId,
    fixture.riskState.lastBucketEquityEventId
  );
  assert.equal(
    resolved.bucketEquityEvent.equityDeltaKrw,
    fixture.mark.equityDeltaKrw
  );
  assert.deepEqual(
    resolved.bucketEquityEvent.evidenceRefs,
    [
      fixture.samsungEvidence.evidenceRef,
      fixture.hynixEvidence.evidenceRef
    ].sort()
  );
  assert.deepEqual(
    resolved.positionMarkHeadEvents.map((event) => event.symbol),
    ["000660", "005930"]
  );
  assert.equal(resolved.resultingRiskState.equityKrw, 1_010);
  assert.equal(resolved.resultingRiskState.unitNavKrw, 1.01);
  assert.equal(
    resolved.resultingRiskState.lastBucketEquityEventId,
    resolved.bucketEquityEvent.bucketEquityEventId
  );
  for (const event of resolved.positionMarkHeadEvents) {
    assert.equal(
      event.bucketEquityEventId,
      resolved.bucketEquityEvent.bucketEquityEventId
    );
    assert.equal(
      event.bucketEquityEventHash,
      resolved.bucketEquityEvent.bucketEquityEventHash
    );
    assert.equal(
      event.bucketValuationMarkRecordId,
      fixture.mark.bucketValuationMarkRecordId
    );
  }
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.positionMarkHeadEvents));
});

test("valuation application rejects foreign risk scope and policy", () => {
  const fixture = applicationFixture();
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ bucket: "long_term" })
      }),
    /scope mismatch/
  );
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ policyHash: HASH_C })
      }),
    /policy mismatch/
  );
});

test("valuation application rejects ahead and corrupt risk states", () => {
  const fixture = applicationFixture();
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: riskState({ asOf: "2026-09-01T02:00:00.001Z" })
      }),
    /ahead of the mark/
  );
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: { ...fixture.riskState, riskStateHash: HASH_C }
      }),
    /hash does not match/
  );
});

test("valuation application rejects an inapplicable risk-state delta", () => {
  const fixture = applicationFixture();
  const empty = createBucketRiskState({
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    drawdownSemanticsHash: HASH_A,
    units: 0,
    unitNavKrw: 1,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 0,
    drawdownRatio: 0,
    lastBucketEquityEventId: "bucket-equity-head",
    asOf: "2026-09-01T01:30:00.000Z"
  });
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentRiskState: empty
      }),
    /cannot change an empty epoch balance/
  );
});

test("valuation application emits independently verifiable event identities", () => {
  const fixture = applicationFixture();
  const resolved = resolveBucketValuationApplication(fixture.input);

  assert.deepEqual(
    parseBucketEquityEvent(resolved.bucketEquityEvent),
    resolved.bucketEquityEvent
  );
  for (const event of resolved.positionMarkHeadEvents) {
    assert.deepEqual(parseBucketPositionMarkHeadEvent(event), event);
  }
  assert.throws(
    () =>
      parseBucketEquityEvent({
        ...resolved.bucketEquityEvent,
        bucketValuationMarkRecordId: "foreign-mark"
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      parseBucketPositionMarkHeadEvent({
        ...resolved.positionMarkHeadEvents[0],
        bucketEquityEventHash: HASH_C
      }),
    /identity does not match/
  );
});

test("valuation application preserves the composed price-evidence gate", () => {
  const fixture = applicationFixture();
  assert.throws(
    () =>
      resolveBucketValuationApplication({
        ...fixture.input,
        currentPriceEvidence: [
          fixture.samsungEvidence,
          { ...fixture.hynixEvidence, priceKrw: 146 }
        ]
      }),
    /identity does not match/
  );
});

function applicationFixture() {
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
  const mark = createBucketValuationMarkRecord({
    portfolioId: "portfolio-1",
    bucket: "swing",
    policyHash: HASH_B,
    positionInputs: [
      valuationPosition(samsung, samsungEvidence),
      valuationPosition(hynix, hynixEvidence)
    ],
    equityDeltaKrw: 10,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z"
  });
  const currentRiskState = riskState();
  return {
    mark,
    riskState: currentRiskState,
    samsungEvidence,
    hynixEvidence,
    input: {
      value: mark,
      currentPositionStates: [hynix, samsung],
      currentPriceEvidence: [samsungEvidence, hynixEvidence],
      currentRiskState
    }
  };
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
    sourceRefs: string[];
  }> = {}
) {
  return createSourcePriceEvidenceRecord({
    sourceContractId: "contract-v1",
    market: "KR",
    symbol: overrides.symbol ?? "005930",
    priceField: "last_price",
    priceKrw: overrides.priceKrw ?? 110,
    observedAt: "2026-09-01T02:00:00.000Z",
    sourceRefs: overrides.sourceRefs ?? ["samsung-source"],
    createdAt: "2026-09-01T02:00:00.000Z"
  });
}

function valuationPosition(
  head: ReturnType<typeof positionHead>,
  evidence: ReturnType<typeof priceEvidence>
) {
  return {
    market: head.market,
    symbol: head.symbol,
    quantity: head.quantity,
    previousPositionMarkHeadId: head.positionMarkHeadId,
    previousPositionMarkHeadHash: head.positionMarkHeadHash,
    previousPriceKrw: head.currentPriceKrw,
    currentPriceKrw: evidence.priceKrw,
    previousPriceEvidenceRef: head.currentPriceEvidenceRef,
    currentPriceEvidenceRef: evidence.evidenceRef
  };
}

function riskState(
  overrides: Partial<{
    bucket: "long_term" | "swing";
    policyHash: typeof HASH_B | typeof HASH_C;
    asOf: string;
  }> = {}
) {
  return createBucketRiskState({
    riskStateEpochId: "epoch-1",
    portfolioId: "portfolio-1",
    bucket: overrides.bucket ?? "swing",
    policyHash: overrides.policyHash ?? HASH_B,
    drawdownSemanticsHash: HASH_A,
    units: 1_000,
    unitNavKrw: 1,
    highWaterMarkUnitNavKrw: 1,
    equityKrw: 1_000,
    drawdownRatio: 0,
    lastBucketEquityEventId: "bucket-equity-head",
    asOf: overrides.asOf ?? "2026-09-01T01:30:00.000Z"
  });
}
