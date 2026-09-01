import assert from "node:assert/strict";
import test from "node:test";

import {
  type BucketPositionMarkHeadEvent,
  createBucketPositionMarkHeadEvent,
  parseBucketPositionMarkHeadState
} from "./bucketPositionMarkHead.js";
import { foldBucketPositionMarkHeadHistory } from "./bucketPositionMarkHeadState.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("position mark head replay derives valuation, mutation, and terminal state", () => {
  const initialized = initialization();
  const valuation = valuationEvent(initialized);
  const mutation = mutationEvent(valuation, {
    resultingQuantity: 1,
    fillId: "fill-sell"
  });
  const transferOut = transferOutEvent(mutation);

  const snapshot = foldBucketPositionMarkHeadHistory([
    initialized,
    valuation,
    mutation,
    transferOut
  ]);
  const state = snapshot.states[0];
  assert.ok(state);
  assert.equal(state.quantity, 0);
  assert.equal(state.currentPriceKrw, 110);
  assert.equal(state.currentPriceEvidenceRef, "price-evidence-2");
  assert.equal(state.lastValuationMarkRecordId, "valuation-1");
  assert.equal(state.lastValuationMarkHash, HASH_B);
  assert.equal(state.lastPositionMutationRef, "migration-1");
  assert.equal(
    state.lastPositionMarkHeadEventId,
    transferOut.positionMarkHeadEventId
  );
  assert.deepEqual(parseBucketPositionMarkHeadState(state), state);
});

test("position mark head replay supports a new root only after a closed head", () => {
  const initialized = initialization();
  const competingRoot = initialization({
    asOf: "2026-09-01T01:01:00.000Z",
    createdAt: "2026-09-01T01:01:01.000Z",
    observedPositionRef: "observed-position-competing"
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, competingRoot]),
    /cannot accept another root/
  );

  const closed = mutationEvent(initialized, {
    resultingQuantity: 0,
    fillId: "fill-close"
  });
  const reopened = initialization({
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z",
    observedPositionRef: "observed-position-2"
  });
  const state = foldBucketPositionMarkHeadHistory([
    initialized,
    closed,
    reopened
  ]).states[0];
  assert.ok(state);
  assert.equal(state.quantity, 2);
  assert.equal(state.lastValuationMarkRecordId, undefined);
  assert.equal(state.lastPositionMutationRef, undefined);
  assert.equal(state.lastPositionMarkHeadEventId, reopened.positionMarkHeadEventId);
});

test("position mark head replay creates transfer-in roots and canonical scope order", () => {
  const krSwing = initialization({ portfolioId: "portfolio-2" });
  const usHedge = initialization({
    bucket: "hedge",
    market: "US",
    symbol: "SPY",
    observedPositionRef: "observed-spy"
  });
  const transferred = transferInEvent();
  const states = foldBucketPositionMarkHeadHistory([
    krSwing,
    usHedge,
    transferred
  ]).states;

  assert.deepEqual(
    states.map((state) => [
      state.portfolioId,
      state.bucket,
      state.market,
      state.symbol
    ]),
    [
      ["portfolio-1", "hedge", "US", "AAPL"],
      ["portfolio-1", "hedge", "US", "SPY"],
      ["portfolio-2", "swing", "KR", "005930"]
    ]
  );
  assert.equal(states[0]?.lastPositionMutationRef, "migration-in-1");
});

test("position mark head replay preserves opening fill origin in the snapshot", () => {
  const opening = createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: "swing",
    market: "KR",
    symbol: "000660",
    eventType: "initialized",
    initializationOrigin: {
      originKind: "position_opening_fill",
      fillId: "fill-open",
      paperFillRecordId: "paper-fill-open",
      paperFillHash: HASH_A
    },
    resultingQuantity: 1,
    resultingPriceKrw: 150,
    resultingPriceEvidenceRef: "opening-source-price",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
  const state = foldBucketPositionMarkHeadHistory([opening]).states[0];
  assert.ok(state);
  assert.equal(state.lastPositionMutationRef, "fill-open");

  const duplicateFillMutation = mutationEvent(opening, {
    resultingQuantity: 2,
    fillId: "fill-open"
  });
  assert.throws(
    () =>
      foldBucketPositionMarkHeadHistory([opening, duplicateFillMutation]),
    /duplicate origin/
  );
});

test("position mark head replay rejects branches, missing roots, scope drift, and closed chaining", () => {
  const initialized = initialization();
  const valuation = valuationEvent(initialized);
  const branch = mutationEvent(initialized, {
    resultingQuantity: 1,
    fillId: "fill-branch"
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, valuation, branch]),
    /predecessor does not match current head/
  );

  assert.throws(
    () => foldBucketPositionMarkHeadHistory([valuation]),
    /appears before initialization/
  );

  const foreignScope = valuationEvent(initialized, { portfolioId: "portfolio-2" });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, foreignScope]),
    /appears before initialization/
  );

  const closed = mutationEvent(initialized, {
    resultingQuantity: 0,
    fillId: "fill-close"
  });
  const afterClose = valuationEvent(closed, {
    resultingQuantity: 1,
    asOf: "2026-09-01T02:00:00.000Z"
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, closed, afterClose]),
    /requires a new root event/
  );
});

test("position mark head replay rejects chronology, valuation quantity, and mutation basis drift", () => {
  const initialized = initialization();
  const sameTimeValuation = valuationEvent(initialized, {
    asOf: initialized.asOf
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, sameTimeValuation]),
    /must advance the mark interval/
  );

  const quantityDrift = valuationEvent(initialized, { resultingQuantity: 1 });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, quantityDrift]),
    /cannot change quantity/
  );

  const regressedMutation = mutationEvent(initialized, {
    resultingQuantity: 1,
    fillId: "fill-regressed",
    asOf: "2026-08-31T23:59:59.000Z"
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, regressedMutation]),
    /asOf cannot move backward/
  );

  const regressedCreatedAt = mutationEvent(initialized, {
    resultingQuantity: 1,
    fillId: "fill-created-at-regressed",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  assert.throws(
    () =>
      foldBucketPositionMarkHeadHistory([initialized, regressedCreatedAt]),
    /createdAt cannot move backward/
  );

  const priceRebase = mutationEvent(initialized, {
    resultingQuantity: 1,
    fillId: "fill-rebase",
    resultingPriceKrw: 99
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, priceRebase]),
    /cannot change the accepted mark basis/
  );

  const noQuantityChange = mutationEvent(initialized, {
    resultingQuantity: 2,
    fillId: "fill-no-change"
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, noQuantityChange]),
    /must change quantity/
  );
});

test("position mark head replay rejects duplicate IDs, origins, and corrupt stored events", () => {
  const initialized = initialization();
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, initialized]),
    /duplicate event ID/
  );

  const first = valuationEvent(initialized);
  const second = valuationEvent(first, {
    resultingPriceKrw: 120,
    resultingPriceEvidenceRef: "price-evidence-3",
    asOf: "2026-09-01T02:00:00.000Z"
  });
  assert.throws(
    () => foldBucketPositionMarkHeadHistory([initialized, first, second]),
    /duplicate origin/
  );

  const transferred = transferInEvent();
  const duplicateMigrationMutation = createBucketPositionMarkHeadEvent({
    ...scope(transferred),
    eventType: "position_mutation_applied",
    previousPositionMarkHeadEventId: transferred.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: transferred.positionMarkHeadEventHash,
    mutationOrigin: {
      originKind: "verified_migration",
      migrationRecordId: "migration-in-1",
      migrationRecordHash: HASH_C
    },
    resultingQuantity: 2,
    resultingPriceKrw: transferred.resultingPriceKrw,
    resultingPriceEvidenceRef: transferred.resultingPriceEvidenceRef,
    asOf: transferred.asOf,
    createdAt: "2026-09-01T01:00:02.000Z"
  });
  assert.throws(
    () =>
      foldBucketPositionMarkHeadHistory([
        transferred,
        duplicateMigrationMutation
      ]),
    /duplicate origin/
  );

  assert.throws(
    () =>
      foldBucketPositionMarkHeadHistory([
        { ...initialized, positionMarkHeadEventHash: HASH_C }
      ]),
    /identity does not match/
  );
});

function initialization(
  overrides: Partial<{
    portfolioId: string;
    bucket: "swing" | "hedge";
    market: "KR" | "US";
    symbol: string;
    observedPositionRef: string;
    asOf: string;
    createdAt: string;
  }> = {}
) {
  return createBucketPositionMarkHeadEvent({
    eventType: "initialized",
    portfolioId: overrides.portfolioId ?? "portfolio-1",
    bucket: overrides.bucket ?? "swing",
    market: overrides.market ?? "KR",
    symbol: overrides.symbol ?? "005930",
    initializationOrigin: {
      originKind: "legacy_verified_mark",
      observedPositionRef:
        overrides.observedPositionRef ?? "observed-position-1",
      markEvidenceRef: "price-evidence-1"
    },
    resultingQuantity: 2,
    resultingPriceKrw: 100,
    resultingPriceEvidenceRef: "price-evidence-1",
    asOf: overrides.asOf ?? "2026-09-01T01:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-01T01:00:01.000Z"
  });
}

function valuationEvent(
  previous: BucketPositionMarkHeadEvent,
  overrides: Partial<{
    portfolioId: string;
    resultingQuantity: number;
    resultingPriceKrw: number;
    resultingPriceEvidenceRef: string;
    asOf: string;
  }> = {}
) {
  return createBucketPositionMarkHeadEvent({
    ...scope(previous),
    portfolioId: overrides.portfolioId ?? previous.portfolioId,
    eventType: "valuation_applied",
    previousPositionMarkHeadEventId: previous.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: previous.positionMarkHeadEventHash,
    bucketValuationMarkRecordId: "valuation-1",
    valuationMarkHash: HASH_B,
    bucketEquityEventId: "equity-event-1",
    bucketEquityEventHash: HASH_C,
    resultingQuantity:
      overrides.resultingQuantity ?? previous.resultingQuantity,
    resultingPriceKrw: overrides.resultingPriceKrw ?? 110,
    resultingPriceEvidenceRef:
      overrides.resultingPriceEvidenceRef ?? "price-evidence-2",
    asOf: overrides.asOf ?? "2026-09-01T01:30:00.000Z",
    createdAt: "2026-09-01T02:00:01.000Z"
  });
}

function mutationEvent(
  previous: BucketPositionMarkHeadEvent,
  input: {
    resultingQuantity: number;
    fillId: string;
    asOf?: string;
    createdAt?: string;
    resultingPriceKrw?: number;
  }
) {
  return createBucketPositionMarkHeadEvent({
    ...scope(previous),
    eventType: "position_mutation_applied",
    previousPositionMarkHeadEventId: previous.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: previous.positionMarkHeadEventHash,
    mutationOrigin: {
      originKind: "paper_fill",
      fillId: input.fillId,
      paperFillRecordId: `paper-${input.fillId}`,
      paperFillHash: HASH_A
    },
    resultingQuantity: input.resultingQuantity,
    resultingPriceKrw:
      input.resultingPriceKrw ?? previous.resultingPriceKrw,
    resultingPriceEvidenceRef: previous.resultingPriceEvidenceRef,
    asOf: input.asOf ?? previous.asOf,
    createdAt: input.createdAt ?? "2026-09-01T02:00:01.000Z"
  });
}

function transferOutEvent(previous: BucketPositionMarkHeadEvent) {
  return createBucketPositionMarkHeadEvent({
    ...scope(previous),
    eventType: "bucket_transfer_out",
    previousPositionMarkHeadEventId: previous.positionMarkHeadEventId,
    previousPositionMarkHeadEventHash: previous.positionMarkHeadEventHash,
    migrationRecordId: "migration-1",
    migrationRecordHash: HASH_C,
    transferGroupId: "transfer-1",
    resultingQuantity: 0,
    resultingPriceKrw: previous.resultingPriceKrw,
    resultingPriceEvidenceRef: previous.resultingPriceEvidenceRef,
    asOf: previous.asOf,
    createdAt: "2026-09-01T02:00:01.000Z"
  });
}

function transferInEvent() {
  return createBucketPositionMarkHeadEvent({
    portfolioId: "portfolio-1",
    bucket: "hedge",
    market: "US",
    symbol: "AAPL",
    eventType: "bucket_transfer_in",
    migrationRecordId: "migration-in-1",
    migrationRecordHash: HASH_C,
    transferGroupId: "transfer-in-1",
    resultingQuantity: 1,
    resultingPriceKrw: 200,
    resultingPriceEvidenceRef: "aapl-price-evidence",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:01.000Z"
  });
}

function scope(event: BucketPositionMarkHeadEvent) {
  return {
    portfolioId: event.portfolioId,
    bucket: event.bucket,
    market: event.market,
    symbol: event.symbol
  };
}
