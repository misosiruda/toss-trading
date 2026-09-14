import assert from "node:assert/strict";
import test from "node:test";
import { createBucketOpeningCapacityState, parseBucketOpeningCapacityState, resolveBucketOpeningCapacityStatePolicy } from "./bucketOpeningCapacityState.js";
import { policyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";

const HASH = `sha256:${"a".repeat(64)}`, OTHER = `sha256:${"b".repeat(64)}`;

test("opening capacity state round-trips its complete payload and retains a stable portfolio bucket identity", () => {
  const original = input(), state = createBucketOpeningCapacityState(original);
  const { capacityStateHash, ...payload } = state;
  assert.equal(capacityStateHash, hashCanonicalPayload(payload));
  assert.deepEqual(parseBucketOpeningCapacityState(JSON.parse(JSON.stringify(state))), state);
  assert.ok(Object.isFrozen(state));
  for (const change of [{ policyHash: OTHER }, { currentPortfolioSnapshotId: "next-snapshot", currentPortfolioSnapshotHash: OTHER },
    { capacityLedgerVersion: 2 }, { remainingOpeningBudgetKrw: 49 }, { asOf: "2026-09-14T00:00:01.000Z" }]) {
    const next = createBucketOpeningCapacityState({ ...original, ...change });
    assert.equal(next.capacityStateId, state.capacityStateId);
    assert.notEqual(next.capacityStateHash, state.capacityStateHash);
  }
  assert.notEqual(createBucketOpeningCapacityState({ ...original, portfolioId: "other-portfolio" }).capacityStateId, state.capacityStateId);
  assert.notEqual(createBucketOpeningCapacityState({ ...original, bucket: "swing" }).capacityStateId, state.capacityStateId);
});

test("opening capacity state detects tampering in every semantic field including optional origin and self identity", () => {
  const state = createBucketOpeningCapacityState({ ...input(), lastReservationRecordId: "reservation" });
  const changes = { portfolioId: "other", policyHash: OTHER, bucket: "swing", currentPortfolioSnapshotId: "next",
    currentPortfolioSnapshotHash: OTHER, capacityLedgerVersion: 2, activePositionCount: 2, pendingReservationCount: 2,
    mandateBoundUnusedSlotCount: 2, availableSlots: 2, reservedOpeningNotionalKrw: 101, remainingOpeningBudgetKrw: 49,
    lastReservationRecordId: "other", asOf: "2026-09-14T00:00:01.000Z", capacityStateId: "fake", capacityStateHash: OTHER };
  for (const [field, value] of Object.entries(changes)) assert.throws(() => parseBucketOpeningCapacityState({ ...state, [field]: value }), field);
  const { capacityStateHash: _hash, lastReservationRecordId: _origin, ...withoutOrigin } = state;
  assert.throws(() => parseBucketOpeningCapacityState({ ...withoutOrigin, capacityStateHash: state.capacityStateHash }));
  const forged = { ...withoutOrigin, capacityStateId: "fake" };
  assert.throws(() => parseBucketOpeningCapacityState({ ...forged, capacityStateHash: hashCanonicalPayload(forged) }), /identity/);
});

test("opening capacity state rejects noncanonical JSON inputs and malformed identifiers", () => {
  for (const field of ["portfolioId", "currentPortfolioSnapshotId", "lastReservationRecordId"]) for (const value of ["", " padded", "trailing ", "\ud800", "\udc00"]) {
    assert.throws(() => createBucketOpeningCapacityState({ ...input(), [field]: value }));
  }
  for (const change of [{ extra: true }, { lastReservationRecordId: undefined }, { asOf: "2026-09-14T09:00:00+09:00" },
    { asOf: "2026-09-14T00:00:00" }, { asOf: "invalid" }]) {
    assert.throws(() => createBucketOpeningCapacityState({ ...input(), ...change } as never));
  }
  const state = createBucketOpeningCapacityState(input());
  assert.throws(() => parseBucketOpeningCapacityState({ ...state, lastReservationRecordId: undefined }));
  assert.throws(() => parseBucketOpeningCapacityState({ ...state, extra: true }));
  assert.doesNotThrow(() => createBucketOpeningCapacityState({ ...input(), portfolioId: "paper-한글-😀" }));
});

test("opening capacity state rejects unsafe numbers and unbacked occupied reservation slots", () => {
  for (const field of ["capacityLedgerVersion", "activePositionCount", "pendingReservationCount", "mandateBoundUnusedSlotCount",
    "availableSlots", "reservedOpeningNotionalKrw", "remainingOpeningBudgetKrw"]) {
    for (const value of [-1, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => createBucketOpeningCapacityState({ ...input(), [field]: value }), `${field}=${value}`);
    }
  }
  assert.throws(() => createBucketOpeningCapacityState({ ...input(), activePositionCount: Number.MAX_SAFE_INTEGER }), /slot aggregate/);
  assert.throws(() => createBucketOpeningCapacityState({ ...input(), reservedOpeningNotionalKrw: Number.MAX_SAFE_INTEGER }), /notional aggregate/);
  assert.throws(() => createBucketOpeningCapacityState({ ...input(), reservedOpeningNotionalKrw: 1 }), /positive reserved notional/);
  const empty = { ...input(), activePositionCount: 0, pendingReservationCount: 0, mandateBoundUnusedSlotCount: 0,
    availableSlots: 0, reservedOpeningNotionalKrw: 0, remainingOpeningBudgetKrw: Number.MAX_SAFE_INTEGER, capacityLedgerVersion: 0 };
  assert.doesNotThrow(() => parseBucketOpeningCapacityState(createBucketOpeningCapacityState(empty)));
  assert.doesNotThrow(() => createBucketOpeningCapacityState({ ...empty, reservedOpeningNotionalKrw: Number.MAX_SAFE_INTEGER, remainingOpeningBudgetKrw: 0 }));
});

test("opening capacity state binds all bucket limits and preserves overfull zero-slot states", () => {
  const selected = policy();
  for (const bucket of selected.strategyBuckets) {
    const state = createBucketOpeningCapacityState({ ...input(), portfolioId: selected.portfolioId, policyHash: selected.policyHash, bucket: bucket.bucket });
    const result = resolveBucketOpeningCapacityStatePolicy({ state, policy: selected });
    assert.equal(result.maximumPositionCount, 4);
    assert.equal(result.currentLedgerAndCasAuthority, "not_verified");
    assert.equal(result.occupancyAndBudgetReplay, "not_performed");
    assert.equal(result.currentExecutionAuthority, "not_granted");
    assert.ok(Object.isFrozen(result));
    const overfull = createBucketOpeningCapacityState({ ...input(), portfolioId: selected.portfolioId, policyHash: selected.policyHash,
      bucket: bucket.bucket, activePositionCount: 5, availableSlots: 0 });
    assert.equal(resolveBucketOpeningCapacityStatePolicy({ state: overfull, policy: selected }).state.reservedOpeningNotionalKrw, 100);
    for (const availableSlots of [0, 2]) {
      const wrong = createBucketOpeningCapacityState({ ...input(), portfolioId: selected.portfolioId, policyHash: selected.policyHash,
        bucket: bucket.bucket, availableSlots });
      assert.throws(() => resolveBucketOpeningCapacityStatePolicy({ state: wrong, policy: selected }), /available slots/);
    }
  }
});

test("opening capacity state policy binding rejects mismatched absent corrupt and future policy origins", () => {
  const selected = policy(), original = { ...input(), portfolioId: selected.portfolioId, policyHash: selected.policyHash };
  for (const change of [{ portfolioId: "other" }, { policyHash: OTHER }, { asOf: new Date(Date.parse(selected.createdAt) - 1).toISOString() }]) {
    assert.throws(() => resolveBucketOpeningCapacityStatePolicy({ state: createBucketOpeningCapacityState({ ...original, ...change }), policy: selected }), /scope or chronology/);
  }
  const legacy = policyFixture().policy;
  assert.throws(() => resolveBucketOpeningCapacityStatePolicy({ state: createBucketOpeningCapacityState({ ...original, policyHash: legacy.policyHash }), policy: legacy }), /explicit policy limit/);
  assert.throws(() => resolveBucketOpeningCapacityStatePolicy({ state: createBucketOpeningCapacityState(original), policy: { ...selected, name: "tampered" } }));
  assert.throws(() => resolveBucketOpeningCapacityStatePolicy({ state: createBucketOpeningCapacityState(original), policy: selected, trusted: true } as never));
});

function input(): Parameters<typeof createBucketOpeningCapacityState>[0] {
  return { portfolioId: "paper-portfolio", policyHash: HASH, bucket: "intraday", currentPortfolioSnapshotId: "snapshot",
    currentPortfolioSnapshotHash: HASH, capacityLedgerVersion: 1, activePositionCount: 1, pendingReservationCount: 1,
    mandateBoundUnusedSlotCount: 1, availableSlots: 1, reservedOpeningNotionalKrw: 100, remainingOpeningBudgetKrw: 50,
    asOf: "2026-09-14T00:00:00.000Z" };
}
function policy() {
  const { runtimePolicyRecordId: _id, policyHash: _hash, lineageHash: _lineage, createdAt, ...base } = policyFixture().policy;
  const payload = { ...base, strategyBuckets: base.strategyBuckets.map((bucket) => ({ ...bucket,
    openingCapacityPolicy: { modelVersion: "bucket_opening_capacity_policy.v1" as const, maximumPositionCount: 4 } })) };
  const policyHash = hashCanonicalPayload(payload), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  return parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
}
