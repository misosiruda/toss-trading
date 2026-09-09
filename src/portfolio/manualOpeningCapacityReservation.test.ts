import assert from "node:assert/strict";
import test from "node:test";
import { createInvestmentMandateRecord, createManualAssignmentEvent, type ManualAssignmentEvent } from "./investmentMandate.js";
import { createManualOpeningCapacityReservationRecord, parseManualOpeningCapacityReservationRecord,
  resolveManualOpeningCapacityMandateBinding, resolveManualOpeningCapacityReservationBinding,
  type ManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T01:00:00.000Z";

test("manual opening reservation preserves both strict variants and deterministic identity", () => {
  for (const kind of ["new_position", "increase_existing"] as const) {
    const input = reservationInput(kind);
    const record = createManualOpeningCapacityReservationRecord(input);
    assert.deepEqual(parseManualOpeningCapacityReservationRecord(record), record);
    assert.ok(Object.isFrozen(record));
    const retry = createManualOpeningCapacityReservationRecord({ ...input, createdAt: "2026-09-01T01:01:00.000Z" });
    assert.equal(record.manualCapacityReservationId, retry.manualCapacityReservationId);
    assert.equal(record.manualCapacityReservationHash, retry.manualCapacityReservationHash);
    assert.notEqual(record.createdAt, retry.createdAt);
    assert.notEqual(record.manualCapacityReservationId, createManualOpeningCapacityReservationRecord({ ...input, capacityLedgerVersion: 2 }).manualCapacityReservationId);
  }
});

test("manual opening reservation independently hashes every payload field", () => {
  for (const kind of ["new_position", "increase_existing"] as const) {
    const record = createManualOpeningCapacityReservationRecord(reservationInput(kind));
    const changes = { manualAssignmentEventId: "different-event", manualAssignmentEventHash: OTHER,
      portfolioId: "different-portfolio", policyHash: OTHER, bucket: "swing", market: "US", symbol: "DIFFERENT",
      currentPortfolioSnapshotId: "different-snapshot", currentPortfolioSnapshotHash: HASH,
      capacityLedgerVersion: 2, reservedMaximumNotionalKrw: 99, resultingReservedNotionalKrw: 201,
      authorizationRef: "different-authorization",
      ...(kind === "new_position" ? { reservedSlotOrdinal: 1 } : { existingPositionRef: "different-position" }) };
    for (const [key, value] of Object.entries(changes)) {
      assert.notEqual(record[key as keyof typeof record], value, `fixture must change ${key}`);
      assert.throws(() => parseManualOpeningCapacityReservationRecord({ ...record, [key]: value }), /identity does not match/, key);
    }
    assert.throws(() => parseManualOpeningCapacityReservationRecord({ ...record, manualCapacityReservationId: "invented" }), /identity does not match/);
    assert.throws(() => parseManualOpeningCapacityReservationRecord({ ...record, manualCapacityReservationHash: OTHER }), /identity does not match/);
  }
});

test("manual opening reservation rejects unsafe amounts noncanonical inputs and mixed variants", () => {
  const input = reservationInput("new_position");
  for (const key of ["reservedMaximumNotionalKrw", "resultingReservedNotionalKrw", "capacityLedgerVersion", "reservedSlotOrdinal"]) {
    for (const value of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      assert.throws(() => createManualOpeningCapacityReservationRecord({ ...input, [key]: value }));
    }
  }
  assert.throws(() => createManualOpeningCapacityReservationRecord({ ...input, reservedMaximumNotionalKrw: 0 }));
  assert.throws(() => createManualOpeningCapacityReservationRecord({ ...input, resultingReservedNotionalKrw: 99 }), /aggregate reserved notional/);
  for (const value of [" leading", "trailing ", "\ud800", ""]) {
    assert.throws(() => createManualOpeningCapacityReservationRecord({ ...input, authorizationRef: value }));
  }
  assert.throws(() => createManualOpeningCapacityReservationRecord({ ...input, createdAt: AT.replace("Z", "+00:00") }));
  const record = createManualOpeningCapacityReservationRecord(input);
  for (const extra of [{ existingPositionRef: "position" }, { unknown: true }, { optional: undefined }]) {
    assert.throws(() => parseManualOpeningCapacityReservationRecord({ ...record, ...extra }));
  }
  const increase = createManualOpeningCapacityReservationRecord(reservationInput("increase_existing"));
  assert.throws(() => parseManualOpeningCapacityReservationRecord({ ...increase, reservedSlotOrdinal: 0 }));
});

test("manual opening reservation binds complete authorization and mandate lineage", () => {
  const event = openingEvent();
  for (const kind of ["new_position", "increase_existing"] as const) {
    const reservation = createManualOpeningCapacityReservationRecord(reservationInput(kind));
    const mandate = openingMandate(reservation);
    const resolved = resolveManualOpeningCapacityMandateBinding({ reservation, manualAssignmentEvent: event, mandate });
    assert.deepEqual(resolved.reservation, reservation);
    assert.deepEqual(resolved.mandate, mandate);
    assert.ok(Object.isFrozen(resolved));
    // The transaction's current snapshot is intentionally different from the event's old sizing snapshot.
    assert.notEqual(reservation.currentPortfolioSnapshotId, event.portfolioSnapshotId);
    const changes = { manualAssignmentEventId: "other", manualAssignmentEventHash: OTHER,
      portfolioId: "other", policyHash: OTHER, bucket: "swing" as const, market: "US" as const,
      symbol: "other", authorizationRef: "other", reservedMaximumNotionalKrw: 1001, resultingReservedNotionalKrw: 1001,
      createdAt: "2026-09-01T00:59:59.999Z" };
    for (const [key, value] of Object.entries(changes)) {
      // Changing only the aggregate total does not change the authorization binding; the ledger verifies that total.
      if (key === "resultingReservedNotionalKrw") continue;
      const changed = createManualOpeningCapacityReservationRecord({ ...reservationInput(kind), resultingReservedNotionalKrw: 2000, [key]: value });
      assert.throws(() => resolveManualOpeningCapacityReservationBinding({ reservation: changed, manualAssignmentEvent: event }), /authorization source/);
    }
    const changed = createManualOpeningCapacityReservationRecord({ ...reservationInput(kind), capacityLedgerVersion: 2 });
    assert.throws(() => resolveManualOpeningCapacityMandateBinding({ reservation: changed, manualAssignmentEvent: event, mandate }), /complete reservation lineage/);
    assert.throws(() => resolveManualOpeningCapacityMandateBinding({ reservation, manualAssignmentEvent: event,
      mandate: openingMandate(reservation, "2026-09-01T00:59:59.999Z") }), /complete reservation lineage/);
  }
});

test("manual classification cannot create opening reservation authority", () => {
  const original = openingEvent();
  const event = createManualAssignmentEvent({ portfolioId: original.portfolioId, policyHash: original.policyHash,
    bucket: original.bucket, market: original.market, symbol: original.symbol, asOf: original.asOf,
    selectionPolicyRecordId: original.selectionPolicyRecordId, selectionPolicyHash: original.selectionPolicyHash,
    reasonCodes: original.reasonCodes, evidenceRefs: original.evidenceRefs, evidenceAsOf: original.evidenceAsOf,
    evidenceValidationHash: original.evidenceValidationHash, authorizationRef: original.authorizationRef,
    authorizationScope: "classify_existing_reduce_only", evidenceEligibility: "blocked",
    classificationMinWeightRatio: 0, classificationTargetWeightRatio: 0.1, classificationMaxWeightRatio: 0.2, createdAt: AT });
  const reservation = createManualOpeningCapacityReservationRecord({ ...reservationInput("new_position"),
    manualAssignmentEventId: event.manualAssignmentEventId, manualAssignmentEventHash: event.manualAssignmentEventHash });
  assert.throws(() => resolveManualOpeningCapacityReservationBinding({ reservation, manualAssignmentEvent: event }), /classification authorization/);
});

function openingEvent() {
  return createManualAssignmentEvent({ portfolioId: "portfolio", policyHash: HASH, market: "KR", symbol: "000660", bucket: "intraday",
    asOf: "2026-09-01T00:30:00.000Z", selectionPolicyRecordId: "selection-policy", selectionPolicyHash: HASH,
    reasonCodes: ["manual-opening"], evidenceRefs: ["evidence"], evidenceAsOf: "2026-09-01T00:00:00.000Z",
    evidenceValidationHash: HASH, authorizationRef: "authorization", authorizationScope: "open_or_increase", evidenceEligibility: "eligible",
    portfolioSnapshotId: "old-sizing-snapshot", portfolioSnapshotHash: HASH, sizingInputRecordId: "sizing-input",
    minWeightRatio: 0, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumNotionalKrw: 1000,
    sizingInputHash: HASH, sizingOutputHash: HASH, createdAt: AT }) as Extract<ManualAssignmentEvent, { authorizationScope: "open_or_increase" }>;
}

function reservationInput(kind: "new_position" | "increase_existing") {
  const event = openingEvent();
  return { manualAssignmentEventId: event.manualAssignmentEventId, manualAssignmentEventHash: event.manualAssignmentEventHash,
    portfolioId: event.portfolioId, policyHash: event.policyHash, bucket: event.bucket, market: event.market, symbol: event.symbol,
    currentPortfolioSnapshotId: "current-snapshot", currentPortfolioSnapshotHash: OTHER, capacityLedgerVersion: 1,
    reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: 200, authorizationRef: event.authorizationRef, createdAt: AT,
    ...(kind === "new_position" ? { reservationKind: kind, reservedSlotOrdinal: 0 }
      : { reservationKind: kind, existingPositionRef: "existing-paper-position" }) };
}

function openingMandate(reservation: ManualOpeningCapacityReservationRecord, createdAt = AT) {
  const event = openingEvent();
  return createInvestmentMandateRecord({ portfolioId: event.portfolioId, policyHash: event.policyHash,
    bucket: event.bucket, market: event.market, symbol: event.symbol, asOf: event.asOf, evidenceAsOf: event.evidenceAsOf,
    reasonCodes: event.reasonCodes, evidenceRefs: event.evidenceRefs, minWeightRatio: event.minWeightRatio,
    targetWeightRatio: event.targetWeightRatio, maxWeightRatio: event.maxWeightRatio,
    maximumOpeningNotionalKrw: reservation.reservedMaximumNotionalKrw, reviewCadence: { mode: "every_tick" }, validFrom: event.asOf,
    assignmentSource: "manual_policy", manualAuthorizationScope: "open_or_increase", manualAssignmentEventId: event.manualAssignmentEventId,
    capacityReservation: { manualCapacityReservationId: reservation.manualCapacityReservationId,
      manualCapacityReservationHash: reservation.manualCapacityReservationHash, reservedMaximumNotionalKrw: reservation.reservedMaximumNotionalKrw,
      ...(reservation.reservationKind === "new_position" ? { reservationKind: reservation.reservationKind, reservedSlotOrdinal: reservation.reservedSlotOrdinal }
        : { reservationKind: reservation.reservationKind, existingPositionRef: reservation.existingPositionRef }) }, createdAt });
}
