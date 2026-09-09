import assert from "node:assert/strict";
import test from "node:test";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { replayOpeningCapacityReservationEvents } from "./openingCapacityReservationEventReplay.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T01:00:00.000Z";
const LATER = "2026-09-01T01:01:00.000Z";
const scope = { portfolioId: "portfolio", policyHash: HASH, bucket: "swing" as const };
type Input = Parameters<typeof createOpeningCapacityReservationEvent>[0];

test("capacity replay reconstructs empty pending bound partial and fully consumed states", () => {
  const empty = replay([]);
  assert.equal(empty.capacityLedgerVersion, 0);
  assert.equal(empty.remainingReservedNotionalKrw, 0);
  assert.deepEqual(empty.reservations, []);
  assert.notEqual(empty.historyHash, replayOpeningCapacityReservationEvents({ ...scope, portfolioId: "other", events: [] }).historyHash);
  const events = completeHistory();
  const pending = replay(events.slice(0, 1));
  assert.equal(pending.pendingNewPositionSlotCount, 1);
  assert.equal(pending.remainingReservedNotionalKrw, 100);
  const bound = replay(events.slice(0, 2));
  assert.equal(bound.pendingNewPositionSlotCount, 0);
  assert.equal(bound.boundUnusedNewPositionSlotCount, 1);
  assert.equal(bound.remainingReservedNotionalKrw, 100);
  const partial = replay(events.slice(0, 3));
  assert.equal(partial.remainingReservedNotionalKrw, 60);
  assert.equal(partial.boundUnusedNewPositionSlotCount, 0);
  assert.equal(partial.reservations[0]!.consumedNotionalKrw, 40);
  assert.equal(partial.reservations[0]!.resultingPositionRef, "position-one");
  const final = replay(events);
  assert.equal(final.remainingReservedNotionalKrw, 0);
  assert.equal(final.reservations[0]!.consumedNotionalKrw, 100);
  assert.equal(final.reservations[0]!.releasedNotionalKrw, 0);
  assert.equal(final.capacityLedgerVersion, 5);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(events))), final);
  for (const value of [final, final.events, final.reservations, final.reservations[0], final.reservations[0]!.mandate]) assert.ok(Object.isFrozen(value));
  assert.notEqual(final.historyHash, partial.historyHash);
});

test("capacity replay interleaves reservations with global versions and reservation-local predecessors", () => {
  const first = root("one", 1);
  const second = root("two", 2, false);
  const firstBound = bind(first, 3);
  const secondBound = bind(second, 4);
  const increasePartial = consume(secondBound, 5, 70, "partially_consumed");
  const result = replay([first, second, firstBound, secondBound, increasePartial]);
  assert.equal(result.remainingReservedNotionalKrw, 170);
  assert.equal(result.boundUnusedNewPositionSlotCount, 1);
  assert.equal(result.reservations[1]!.consumedNotionalKrw, 30);
  assert.equal(result.reservations[1]!.resultingPositionRef, null);
  assert.throws(() => replay([first, second, rebuild(firstBound, { capacityLedgerVersion: 2 })]), /version gap or reuse/);
  assert.throws(() => replay([first, second, rebuild(firstBound, { previousCapacityReservationEventId: second.capacityReservationEventId })]), /wrong predecessor/);
});

test("capacity replay releases only the unused remainder with lifecycle-matching origins", () => {
  const pending = root("one", 1);
  const cancelled = release(pending, 2, false);
  assert.equal(replay([pending, cancelled]).reservations[0]!.releasedNotionalKrw, 100);
  const prefix = completeHistory().slice(0, 3);
  const retired = release(prefix[2]!, 4, true);
  const result = replay([...prefix, retired]);
  assert.equal(result.remainingReservedNotionalKrw, 0);
  assert.equal(result.reservations[0]!.consumedNotionalKrw, 40);
  assert.equal(result.reservations[0]!.releasedNotionalKrw, 60);
  assert.throws(() => replay([pending, release(pending, 2, true)]), /release origin/);
  assert.throws(() => replay([...prefix, release(prefix[2]!, 4, false)]), /release origin/);
  assert.throws(() => replay([...prefix, rebuild(retired, { releaseOrigin: { originKind: "mandate_terminal", mandateId: "other", mandateHash: HASH, mandateEventId: "terminal", mandateEventHash: HASH } })]), /release origin/);
});

test("capacity replay rejects rehashed scope drift gaps branches identity reuse and terminal successors", () => {
  const events = completeHistory();
  for (const patch of [{ portfolioId: "other" }, { policyHash: OTHER }, { bucket: "intraday" }]) {
    assert.throws(() => replay([rebuild(events[0]!, patch)]), /scope mismatch/);
  }
  assert.throws(() => replay(events.slice(1)), /version gap/);
  assert.throws(() => replay([events[0]!, rebuild(events[1]!, { capacityLedgerVersion: 3 })]), /version gap/);
  assert.throws(() => replay([events[0]!, events[0]!]), /version gap|duplicate event/);
  assert.throws(() => replay([events[0]!, rebuild(events[0]!, { capacityLedgerVersion: 2 })]), /reservation identity reused/);
  assert.throws(() => replay([events[0]!, rebuild(events[1]!, { reservationHash: OTHER })]), /reservation hash/);
  assert.throws(() => replay([events[0]!, rebuild(events[1]!, { previousCapacityReservationEventId: "missing" })]), /wrong predecessor/);
  assert.throws(() => replay([...events.slice(0, 3), rebuild(events[1]!, { capacityLedgerVersion: 4 })]), /wrong predecessor/);
  assert.throws(() => replay([...events, release(events[4]!, 6, true)]), /terminal reservation/);
  const cancelled = release(events[0]!, 2, false);
  assert.throws(() => replay([events[0]!, cancelled, rebuild(bind(events[0]!, 3), { previousCapacityReservationEventId: cancelled.capacityReservationEventId })]), /terminal reservation/);
  assert.throws(() => replay([rebuild(events[0]!, { createdAt: LATER }), events[1]!]), /time moved backwards/);
  const lateRoot = rebuild(events[0]!, { asOf: LATER, createdAt: LATER });
  assert.throws(() => replay([lateRoot, rebuild(bind(lateRoot, 2), { asOf: AT, createdAt: LATER })]), /time moved backwards/);
});

test("capacity replay forbids binding release tricks unbound fills and duplicated mandate or fill identities", () => {
  const [reserved, bound, firstFill] = completeHistory();
  for (const patch of [{ remainingReservedNotionalKrw: 99 }, { remainingReservedNotionalKrw: 101 }, { occupiesNewPositionSlot: false }]) {
    assert.throws(() => replay([reserved!, rebuild(bound!, patch)]), /binding must preserve/);
  }
  assert.throws(() => replay([reserved!, consume(reserved!, 2, 60)]), /bound mandate/);
  assert.throws(() => replay([reserved!, bound!, consume(bound!, 3, 60, "partially_consumed")]), /first new-position fill/);
  assert.throws(() => replay([reserved!, bound!, bind(bound!, 3)]), /invalid mandate binding/);
  for (const patch of [{ remainingReservedNotionalKrw: 100 }, { remainingReservedNotionalKrw: 101 }]) {
    assert.throws(() => replay([reserved!, bound!, rebuild(firstFill!, patch)]), /must reduce/);
  }
  assert.throws(() => replay([reserved!, bound!, rebuild(firstFill!, { mandateHash: OTHER })]), /bound mandate/);
  assert.throws(() => replay([reserved!, bound!, firstFill!, rebuild(consume(firstFill!, 4, 0), { resultingPositionRef: "different" })]), /position identity/);
  for (const key of ["fillId", "paperFillRecordId"] as const) {
    const originalFill = firstFill as Extract<OpeningCapacityReservationEvent, { eventType: "consumed_by_position" }>;
    assert.throws(() => replay([reserved!, bound!, firstFill!, rebuild(consume(firstFill!, 4, 0), { [key]: originalFill[key] })]), /reuses a fill identity/);
  }
  const another = root("two", 3, false);
  assert.throws(() => replay([reserved!, bound!, another, rebuild(bind(another, 4), { mandateId: "mandate-one" })]), /invalid mandate binding/);
  const otherRoot = root("two", 4, false);
  const otherBound = bind(otherRoot, 5);
  const otherFill = consume(otherBound, 6, 70, "partially_consumed");
  assert.throws(() => replay([reserved!, bound!, firstFill!, otherRoot, otherBound, rebuild(otherFill, { fillId: "fill-3" })]), /reuses a fill identity/);
});

test("capacity replay prevents selector assignment reuse and aggregate safe-integer overflow", () => {
  const selectorSource = { sourceKind: "selector", candidateAssignmentSetId: "set", candidateAssignmentSetHash: HASH, candidateAssignmentId: "assignment", reservedSlotOrdinal: 0 };
  const first = rebuild(root("one", 1), { reservationSource: selectorSource });
  const second = rebuild(root("two", 2), { reservationSource: { ...selectorSource, reservedSlotOrdinal: 1 } });
  assert.throws(() => replay([first, second]), /selector assignment reused/);
  const maximum = rebuild(root("maximum", 1), { remainingReservedNotionalKrw: Number.MAX_SAFE_INTEGER });
  assert.equal(replay([maximum]).remainingReservedNotionalKrw, Number.MAX_SAFE_INTEGER);
  assert.throws(() => replay([maximum, root("extra", 2)]), /aggregate notional is unsafe/);
  assert.throws(() => replayOpeningCapacityReservationEvents({ ...scope, events: [], unknown: true } as Parameters<typeof replayOpeningCapacityReservationEvents>[0]));
  assert.throws(() => replay([{ ...first, reservationHash: OTHER }]));
});

function replay(events: readonly unknown[]) { return replayOpeningCapacityReservationEvents({ ...scope, events }); }
function rebuild(event: OpeningCapacityReservationEvent, patch: Record<string, unknown>) {
  const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...input } = event;
  return createOpeningCapacityReservationEvent({ ...input, ...patch } as Input);
}
function root(id: string, version: number, slot = true) {
  return createOpeningCapacityReservationEvent({ ...scope, eventType: "reserved", reservationId: id, reservationHash: HASH,
    reservationSource: { sourceKind: "manual", manualCapacityReservationId: id, manualCapacityReservationHash: HASH },
    capacityLedgerVersion: version, remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: slot, asOf: AT, createdAt: AT });
}
function successor(previous: OpeningCapacityReservationEvent, version: number) {
  return { ...scope, reservationId: previous.reservationId, reservationHash: previous.reservationHash,
    previousCapacityReservationEventId: previous.capacityReservationEventId, capacityLedgerVersion: version,
    remainingReservedNotionalKrw: previous.remainingReservedNotionalKrw, occupiesNewPositionSlot: previous.occupiesNewPositionSlot, asOf: AT, createdAt: AT };
}
function bind(previous: OpeningCapacityReservationEvent, version: number) {
  return createOpeningCapacityReservationEvent({ ...successor(previous, version), eventType: "bound_to_mandate",
    mandateId: `mandate-${previous.reservationId}`, mandateHash: HASH });
}
function consume(previous: OpeningCapacityReservationEvent, version: number, remaining: number, type: "partially_consumed" | "consumed_by_position" = "consumed_by_position") {
  const common = { ...successor(previous, version), occupiesNewPositionSlot: false as const, remainingReservedNotionalKrw: remaining,
    mandateId: `mandate-${previous.reservationId}`, mandateHash: HASH, fillId: `fill-${version}`, paperFillRecordId: `paper-${version}`, paperFillHash: HASH };
  return createOpeningCapacityReservationEvent(type === "partially_consumed" ? { ...common, eventType: type }
    : { ...common, eventType: type, resultingPositionRef: `position-${previous.reservationId}` });
}
function release(previous: OpeningCapacityReservationEvent, version: number, terminal: boolean) {
  return createOpeningCapacityReservationEvent({ ...successor(previous, version), eventType: "released", remainingReservedNotionalKrw: 0,
    occupiesNewPositionSlot: false, releaseReasonCode: "cancelled", releaseOrigin: terminal
      ? { originKind: "mandate_terminal", mandateId: `mandate-${previous.reservationId}`, mandateHash: HASH, mandateEventId: "terminal", mandateEventHash: HASH }
      : { originKind: "request_cancelled", requestOrManualEventId: "request" } });
}
function completeHistory() {
  const first = root("one", 1);
  const second = bind(first, 2);
  const third = consume(second, 3, 60);
  const fourth = consume(third, 4, 40, "partially_consumed");
  return [first, second, third, fourth, consume(fourth, 5, 0)];
}
