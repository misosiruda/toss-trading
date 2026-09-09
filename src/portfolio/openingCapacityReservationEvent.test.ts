import assert from "node:assert/strict";
import test from "node:test";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { createOpeningCapacityReservationEvent, parseOpeningCapacityReservationEvent,
  resolveManualOpeningCapacityReservedEventBinding } from "./openingCapacityReservationEvent.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T01:00:00.000Z";
const LATER = "2026-09-01T01:01:00.000Z";
type Input = Parameters<typeof createOpeningCapacityReservationEvent>[0];

test("opening capacity events preserve all strict variants and freeze nested origins", () => {
  for (const input of inputs()) {
    const event = createOpeningCapacityReservationEvent(input);
    assert.deepEqual(parseOpeningCapacityReservationEvent(event), event);
    assert.ok(Object.isFrozen(event));
    if (event.eventType === "reserved") assert.ok(Object.isFrozen(event.reservationSource));
    if (event.eventType === "released") assert.ok(Object.isFrozen(event.releaseOrigin));
    const { capacityReservationEventId, capacityReservationEventHash, createdAt: _createdAt, ...payload } = event;
    assert.equal(capacityReservationEventHash, hashCanonicalPayload(payload));
    assert.equal(capacityReservationEventId, hashDerivedId("opening_capacity_event", capacityReservationEventHash));
    const later = createOpeningCapacityReservationEvent({ ...input, createdAt: LATER });
    assert.equal(later.capacityReservationEventId, capacityReservationEventId);
    assert.equal(later.capacityReservationEventHash, capacityReservationEventHash);
    assert.notEqual(later.createdAt, event.createdAt);
  }
  // A new position can consume its slot while retaining unfilled notional.
  assert.equal(createOpeningCapacityReservationEvent(inputs()[4]!).remainingReservedNotionalKrw, 100);
  assert.equal(create({ ...inputs()[4]!, remainingReservedNotionalKrw: 0 }).remainingReservedNotionalKrw, 0);
});

test("opening capacity parser independently hashes each top-level and nested payload field", () => {
  for (const input of inputs()) {
    const event = createOpeningCapacityReservationEvent(input);
    const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, createdAt: _created, ...payload } = event;
    for (const [path, value] of leaves(payload)) {
      const changed = structuredClone(event) as Record<string, unknown>;
      let target = changed;
      for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
      target[path.at(-1)!] = typeof value === "boolean" ? !value : typeof value === "number" ? value + 1
        : String(value).startsWith("sha256:") ? OTHER : `${value}-different`;
      assert.notDeepEqual(changed, event);
      assert.throws(() => parseOpeningCapacityReservationEvent(changed), path.join("."));
    }
    assert.throws(() => parseOpeningCapacityReservationEvent({ ...event, capacityReservationEventHash: OTHER }));
    assert.throws(() => parseOpeningCapacityReservationEvent({ ...event, capacityReservationEventId: "invented" }));
    // Independently rehashed valid payload changes are distinct events, never exact retries.
    const changed = createOpeningCapacityReservationEvent({ ...input, capacityLedgerVersion: input.capacityLedgerVersion + 1 });
    assert.notEqual(changed.capacityReservationEventHash, event.capacityReservationEventHash);
  }
});

test("opening capacity events reject missing origins mixed variants and unknown fields", () => {
  for (const input of inputs()) {
    assert.throws(() => create({ ...input, unknown: true }));
    assert.throws(() => create({ ...input, unknown: undefined }));
    const event = createOpeningCapacityReservationEvent(input);
    assert.throws(() => parseOpeningCapacityReservationEvent({ ...event, unknown: true }));
    if (input.eventType === "reserved") {
      assert.throws(() => create({ ...input, previousCapacityReservationEventId: "unexpected" }));
      assert.throws(() => create({ ...input, previousCapacityReservationEventId: undefined }));
      assert.throws(() => create({ ...input, reservationSource: undefined }));
      assert.throws(() => create({ ...input, reservationSource: { ...input.reservationSource, unknown: true } }));
      for (const key of Object.keys(input.reservationSource)) {
        assert.throws(() => create({ ...input, reservationSource: { ...input.reservationSource, [key]: undefined } }));
      }
      assert.throws(() => create({ ...input, mandateId: "unexpected" }));
    } else {
      assert.throws(() => create({ ...input, previousCapacityReservationEventId: undefined }));
      assert.throws(() => create({ ...input, reservationSource: inputs()[0]!.eventType }));
      if (input.eventType === "released") {
        assert.throws(() => create({ ...input, releaseOrigin: undefined }));
        assert.throws(() => create({ ...input, releaseOrigin: { ...input.releaseOrigin, unknown: true } }));
        for (const key of Object.keys(input.releaseOrigin)) {
          assert.throws(() => create({ ...input, releaseOrigin: { ...input.releaseOrigin, [key]: undefined } }));
        }
        assert.throws(() => create({ ...input, releaseReasonCode: undefined }));
      } else {
        assert.throws(() => create({ ...input, mandateHash: undefined }));
        if (input.eventType !== "bound_to_mandate") {
          for (const key of ["fillId", "paperFillRecordId", "paperFillHash"]) assert.throws(() => create({ ...input, [key]: undefined }));
          if (input.eventType === "consumed_by_position") assert.throws(() => create({ ...input, resultingPositionRef: undefined }));
        }
      }
    }
  }
});

test("opening capacity events reject unsafe numbers noncanonical times and invalid slot flags", () => {
  for (const input of inputs()) {
    for (const key of ["capacityLedgerVersion", "remainingReservedNotionalKrw"]) {
      for (const value of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) assert.throws(() => create({ ...input, [key]: value }));
    }
    for (const value of [" leading", "trailing ", "\ud800", ""]) assert.throws(() => create({ ...input, portfolioId: value }));
    for (const key of ["asOf", "createdAt"]) {
      for (const value of ["invalid", AT.replace("Z", "+00:00"), AT.replace(".000", "")]) assert.throws(() => create({ ...input, [key]: value }));
    }
    assert.throws(() => create({ ...input, asOf: LATER, createdAt: AT }));
    if (["reserved", "bound_to_mandate", "partially_consumed"].includes(input.eventType)) {
      assert.throws(() => create({ ...input, remainingReservedNotionalKrw: 0 }));
    }
    if (["partially_consumed", "consumed_by_position", "released"].includes(input.eventType)) {
      assert.throws(() => create({ ...input, occupiesNewPositionSlot: true }));
    }
  }
  const selector = inputs()[1]!;
  assert.throws(() => create({ ...selector, occupiesNewPositionSlot: false }));
  for (const value of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => create({ ...selector, reservationSource: { ...(selector as Extract<Input, { eventType: "reserved" }>).reservationSource, reservedSlotOrdinal: value } }));
  }
  assert.throws(() => create({ ...inputs()[5]!, remainingReservedNotionalKrw: 1 }));
  assert.throws(() => create({ ...inputs()[0]!, reservationHash: OTHER }), /preserve its reservation identity/);
});

test("manual reserved events bind both reservation kinds and reject rehashed source mismatches", () => {
  for (const kind of ["new_position", "increase_existing"] as const) {
    const manualAssignmentEvent = manualEvent();
    const reservation = createManualOpeningCapacityReservationRecord({
      manualAssignmentEventId: manualAssignmentEvent.manualAssignmentEventId, manualAssignmentEventHash: manualAssignmentEvent.manualAssignmentEventHash,
      portfolioId: "portfolio", policyHash: HASH, bucket: "swing", market: "KR", symbol: "KR:005930",
      currentPortfolioSnapshotId: "current-snapshot", currentPortfolioSnapshotHash: OTHER, capacityLedgerVersion: 1,
      reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: 200, authorizationRef: "authorization", createdAt: AT,
      ...(kind === "new_position" ? { reservationKind: kind, reservedSlotOrdinal: 0 } : { reservationKind: kind, existingPositionRef: "existing-position" })
    });
    const input: Input = { ...common(), eventType: "reserved", reservationId: reservation.manualCapacityReservationId,
      reservationHash: reservation.manualCapacityReservationHash, occupiesNewPositionSlot: kind === "new_position",
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
        manualCapacityReservationHash: reservation.manualCapacityReservationHash } };
    const event = createOpeningCapacityReservationEvent(input);
    const resolve = (value: unknown) => resolveManualOpeningCapacityReservedEventBinding({ event: value, reservation, manualAssignmentEvent });
    assert.deepEqual(resolve(event).reservation, reservation);
    for (const patch of [{ portfolioId: "other" }, { policyHash: OTHER }, { bucket: "intraday" },
      { capacityLedgerVersion: 2 }, { remainingReservedNotionalKrw: 99 }, { occupiesNewPositionSlot: kind !== "new_position" },
      { asOf: "2026-09-01T00:59:00.000Z" }]) {
      assert.throws(() => resolve(create({ ...input, ...patch })), /does not match its reservation source/);
    }
    assert.throws(() => resolveManualOpeningCapacityReservedEventBinding({ event, reservation: { ...reservation, authorizationRef: "altered" }, manualAssignmentEvent }));
    assert.throws(() => resolveManualOpeningCapacityReservedEventBinding({ event, reservation, manualAssignmentEvent: { ...manualAssignmentEvent, authorizationRef: "altered" } }));
    assert.throws(() => resolve(createOpeningCapacityReservationEvent(inputs()[1]!)), /does not match its reservation source/);
  }
});

function create(value: unknown) { return createOpeningCapacityReservationEvent(value as Input); }
function common() { return { reservationId: "reservation", reservationHash: HASH, portfolioId: "portfolio", policyHash: HASH,
  bucket: "swing" as const, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true, capacityLedgerVersion: 1, asOf: AT, createdAt: AT }; }
function inputs(): Input[] {
  const subsequent = { ...common(), previousCapacityReservationEventId: "previous-event" };
  const bound = { ...subsequent, mandateId: "mandate", mandateHash: HASH };
  const filled = { ...bound, fillId: "fill", paperFillRecordId: "paper-fill", paperFillHash: HASH, occupiesNewPositionSlot: false };
  const released = { ...subsequent, eventType: "released" as const, remainingReservedNotionalKrw: 0 as const,
    occupiesNewPositionSlot: false as const, releaseReasonCode: "cancelled" };
  return [
    { ...common(), eventType: "reserved", reservationSource: { sourceKind: "manual", manualCapacityReservationId: "reservation", manualCapacityReservationHash: HASH } },
    { ...common(), eventType: "reserved", reservationSource: { sourceKind: "selector", candidateAssignmentSetId: "set", candidateAssignmentSetHash: HASH, candidateAssignmentId: "assignment", reservedSlotOrdinal: 0 } },
    { ...bound, eventType: "bound_to_mandate" },
    { ...filled, eventType: "partially_consumed", occupiesNewPositionSlot: false },
    { ...filled, eventType: "consumed_by_position", occupiesNewPositionSlot: false, resultingPositionRef: "position" },
    { ...released, releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "request" } },
    { ...released, releaseOrigin: { originKind: "mandate_terminal", mandateId: "mandate", mandateHash: HASH, mandateEventId: "terminal", mandateEventHash: HASH } }
  ];
}
function leaves(value: Record<string, unknown>, prefix: string[] = []): Array<[string[], unknown]> {
  return Object.entries(value).flatMap(([key, child]) => child !== null && typeof child === "object"
    ? leaves(child as Record<string, unknown>, [...prefix, key]) : [[[...prefix, key], child] as [string[], unknown]]);
}
function manualEvent() {
  return createManualAssignmentEvent({ portfolioId: "portfolio", policyHash: HASH, bucket: "swing", market: "KR", symbol: "KR:005930",
    asOf: AT, selectionPolicyRecordId: "selection", selectionPolicyHash: HASH, reasonCodes: ["manual-opening"], evidenceRefs: ["synthetic-evidence"],
    evidenceAsOf: AT, evidenceValidationHash: HASH, authorizationRef: "authorization", authorizationScope: "open_or_increase", evidenceEligibility: "eligible",
    portfolioSnapshotId: "old-snapshot", portfolioSnapshotHash: HASH, sizingInputRecordId: "sizing", sizingInputHash: HASH, sizingOutputHash: HASH,
    minWeightRatio: 0, targetWeightRatio: 0.1, maxWeightRatio: 0.2, maximumNotionalKrw: 1000, createdAt: AT });
}
