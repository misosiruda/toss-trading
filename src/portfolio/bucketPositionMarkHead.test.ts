import assert from "node:assert/strict";
import test from "node:test";

import {
  createBucketPositionMarkHeadEvent,
  createBucketPositionMarkHeadState,
  parseBucketPositionMarkHeadEvent,
  parseBucketPositionMarkHeadState
} from "./bucketPositionMarkHead.js";
import {
  hashCanonicalPayload,
  hashDerivedId
} from "./runtimePolicyContracts.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("position mark head event derives identity from the complete variant payload", () => {
  const event = initializedEvent();
  const {
    positionMarkHeadEventId,
    positionMarkHeadEventHash,
    createdAt,
    ...payload
  } = event;

  assert.equal(positionMarkHeadEventHash, hashCanonicalPayload(payload));
  assert.equal(
    positionMarkHeadEventId,
    hashDerivedId("bucket_position_mark_head_event", positionMarkHeadEventHash)
  );
  assert.equal(createdAt, "2026-09-01T01:00:01.000Z");
  assert.deepEqual(parseBucketPositionMarkHeadEvent(event), event);
  assert.ok(Object.isFrozen(event));
  assert.equal(event.eventType, "initialized");
  assert.ok(Object.isFrozen(event.initializationOrigin));
});

test("position mark head event accepts every strict authenticated-origin variant", () => {
  const initialized = initializedEvent();
  const initializedFromFill = createBucketPositionMarkHeadEvent({
    ...eventScope(),
    eventType: "initialized",
    initializationOrigin: {
      originKind: "position_opening_fill",
      fillId: "fill-1",
      paperFillRecordId: "paper-fill-1",
      paperFillHash: HASH_A
    },
    resultingQuantity: 2,
    resultingPriceKrw: 100,
    resultingPriceEvidenceRef: "price-evidence-1",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
  const valuation = createBucketPositionMarkHeadEvent({
    ...eventScope(),
    eventType: "valuation_applied",
    previousPositionMarkHeadEventId: initialized.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: initialized.positionMarkHeadEventHash,
    bucketValuationMarkRecordId: "valuation-1",
    valuationMarkHash: HASH_B,
    bucketEquityEventId: "equity-event-1",
    bucketEquityEventHash: HASH_C,
    resultingQuantity: 2,
    resultingPriceKrw: 110,
    resultingPriceEvidenceRef: "price-evidence-2",
    asOf: "2026-09-01T01:01:00.000Z",
    createdAt: "2026-09-01T01:01:01.000Z"
  });
  const mutation = createBucketPositionMarkHeadEvent({
    ...eventScope(),
    eventType: "position_mutation_applied",
    previousPositionMarkHeadEventId: valuation.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: valuation.positionMarkHeadEventHash,
    mutationOrigin: {
      originKind: "paper_fill",
      fillId: "fill-2",
      paperFillRecordId: "paper-fill-2",
      paperFillHash: HASH_A
    },
    resultingQuantity: 1,
    resultingPriceKrw: 110,
    resultingPriceEvidenceRef: "price-evidence-2",
    asOf: "2026-09-01T01:02:00.000Z",
    createdAt: "2026-09-01T01:02:01.000Z"
  });
  const migrationMutation = createBucketPositionMarkHeadEvent({
    ...eventScope(),
    eventType: "position_mutation_applied",
    previousPositionMarkHeadEventId: mutation.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: mutation.positionMarkHeadEventHash,
    mutationOrigin: {
      originKind: "verified_migration",
      migrationRecordId: "migration-quantity-1",
      migrationRecordHash: HASH_B
    },
    resultingQuantity: 1,
    resultingPriceKrw: 110,
    resultingPriceEvidenceRef: "price-evidence-2",
    asOf: "2026-09-01T01:02:30.000Z",
    createdAt: "2026-09-01T01:02:31.000Z"
  });
  const transferOut = createBucketPositionMarkHeadEvent({
    ...eventScope(),
    eventType: "bucket_transfer_out",
    previousPositionMarkHeadEventId: mutation.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: mutation.positionMarkHeadEventHash,
    migrationRecordId: "migration-1",
    migrationRecordHash: HASH_B,
    transferGroupId: "transfer-1",
    resultingQuantity: 0,
    resultingPriceKrw: 110,
    resultingPriceEvidenceRef: "price-evidence-2",
    asOf: "2026-09-01T01:03:00.000Z",
    createdAt: "2026-09-01T01:03:01.000Z"
  });
  const transferIn = createBucketPositionMarkHeadEvent({
    ...eventScope(),
    bucket: "long_term",
    eventType: "bucket_transfer_in",
    migrationRecordId: "migration-1",
    migrationRecordHash: HASH_B,
    transferGroupId: "transfer-1",
    resultingQuantity: 1,
    resultingPriceKrw: 110,
    resultingPriceEvidenceRef: "price-evidence-2",
    asOf: "2026-09-01T01:03:00.000Z",
    createdAt: "2026-09-01T01:03:01.000Z"
  });

  assert.deepEqual(
    [
      initialized,
      initializedFromFill,
      valuation,
      mutation,
      migrationMutation,
      transferOut,
      transferIn
    ].map(
      (event) => parseBucketPositionMarkHeadEvent(event).eventType
    ),
    [
      "initialized",
      "initialized",
      "valuation_applied",
      "position_mutation_applied",
      "position_mutation_applied",
      "bucket_transfer_out",
      "bucket_transfer_in"
    ]
  );
});

test("position mark head event rejects chronology, quantity, evidence and identity drift", () => {
  assert.throws(
    () =>
      initializedEvent({
        createdAt: "2026-09-01T00:59:59.999Z"
      }),
    /cannot be created before asOf/
  );
  assert.throws(
    () => initializedEvent({ resultingQuantity: -0 }),
    /negative zero/
  );
  assert.throws(
    () => initializedEvent({ resultingQuantity: 0 }),
    /positive resulting quantity/
  );
  assert.throws(
    () => initializedEvent({ resultingPriceEvidenceRef: "different-mark" }),
    /preserve its verified evidence/
  );

  const event = initializedEvent();
  assert.throws(
    () =>
      parseBucketPositionMarkHeadEvent({
        ...event,
        positionMarkHeadEventHash: HASH_C
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      parseBucketPositionMarkHeadEvent({
        ...event,
        portfolioId: " portfolio-1 "
      }),
    /must already be canonical/
  );
});

test("position mark head state derives a stable scope ID and complete snapshot hash", () => {
  const first = createBucketPositionMarkHeadState(stateInput());
  const second = createBucketPositionMarkHeadState({
    ...stateInput(),
    quantity: 1,
    currentPriceKrw: 120,
    currentPriceEvidenceRef: "price-evidence-3",
    lastPositionMarkHeadEventId: "head-event-2",
    lastPositionMarkHeadEventHash: HASH_C,
    lastValuationMarkRecordId: "valuation-2",
    lastValuationMarkHash: HASH_B,
    asOf: "2026-09-01T02:00:00.000Z"
  });
  const { positionMarkHeadHash, ...payload } = first;

  assert.equal(first.positionMarkHeadId, second.positionMarkHeadId);
  assert.equal(positionMarkHeadHash, hashCanonicalPayload(payload));
  assert.deepEqual(parseBucketPositionMarkHeadState(first), first);
  assert.ok(Object.isFrozen(first));
});

test("position mark head state rejects incomplete origins and stored identity drift", () => {
  assert.throws(
    () =>
      createBucketPositionMarkHeadState({
        ...stateInput(),
        lastValuationMarkHash: undefined
      }),
    /complete valuation origin/
  );
  assert.throws(
    () => createBucketPositionMarkHeadState({ ...stateInput(), quantity: -0 }),
    /negative zero/
  );

  const state = createBucketPositionMarkHeadState(stateInput());
  assert.throws(
    () =>
      parseBucketPositionMarkHeadState({
        ...state,
        positionMarkHeadId: "bucket_position_mark_head_wrong"
      }),
    /identity does not match/
  );
  assert.throws(
    () =>
      parseBucketPositionMarkHeadState({
        ...state,
        currentPriceKrw: 999
      }),
    /identity does not match/
  );
});

function initializedEvent(
  overrides: Partial<{
    resultingQuantity: number;
    resultingPriceEvidenceRef: string;
    createdAt: string;
  }> = {}
) {
  return createBucketPositionMarkHeadEvent({
    ...eventScope(),
    eventType: "initialized",
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef: "observed-position-1",
      markEvidenceRef: "price-evidence-1"
    },
    resultingQuantity: overrides.resultingQuantity ?? 2,
    resultingPriceKrw: 100,
    resultingPriceEvidenceRef:
      overrides.resultingPriceEvidenceRef ?? "price-evidence-1",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-01T01:00:01.000Z"
  });
}

function eventScope() {
  return {
    portfolioId: "portfolio-1",
    bucket: "swing" as const,
    market: "KR" as const,
    symbol: "005930"
  };
}

function stateInput() {
  return {
    ...eventScope(),
    quantity: 2,
    currentPriceKrw: 110,
    currentPriceEvidenceRef: "price-evidence-2",
    lastPositionMarkHeadEventId: "head-event-1",
    lastPositionMarkHeadEventHash: HASH_A,
    lastValuationMarkRecordId: "valuation-1",
    lastValuationMarkHash: HASH_B,
    lastPositionMutationRef: "fill-1",
    asOf: "2026-09-01T01:00:00.000Z"
  };
}
