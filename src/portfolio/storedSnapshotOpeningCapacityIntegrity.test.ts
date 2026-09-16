import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { HASH, START, PORTFOLIO, at, snapshot, fixture as manualFixture } from "./storedManualOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotOpeningCapacity } from "./storedSnapshotOpeningCapacity.js";
import { run, intraday, storePolicy, position, storeSnapshot, fixture } from "./storedSnapshotOpeningCapacityTestFixtures.js";

test("stored opening occupancy rejects unassigned duplicate-bucket and already-held new-position instruments", async (context) => {
  for (const positions of [[position("000660")], [position("000660", "swing"), position("000660", "long_term")], [position("005930", "intraday")]]) {
    await fixture(context, "selector", { count: 0 }, async (state) => {
      const policy = await storePolicy(state.dir);
      await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash, 170, positions)),
        /unassigned holdings|repeats a held instrument|repeats a new-position instrument/);
    });
  }
});

test("stored opening occupancy rejects corrupt reservation history and leaves its bytes untouched", async (context) => {
  await fixture(context, "selector", { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const { eventsPath } = createOpeningCapacityReservationEventPaths(state.dir);
    const corrupt = (await readFile(eventsPath)).subarray(0, -1);
    await writeFile(eventsPath, corrupt);
    await assert.rejects(run(state, stored), /torn final line/);
    assert.deepEqual(await readFile(eventsPath), corrupt);
  });
});

test("stored opening occupancy rejects actual-source reservations that reuse a slot or instrument", async (context) => {
  for (const sameSlot of [true, false]) await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    context.mock.timers.setTime(START + 60);
    const { manualAssignmentEventId: _eventId, manualAssignmentEventHash: _eventHash, ...manualPayload } = state.manual.source;
    const manual = createManualAssignmentEvent({ ...manualPayload, authorizationRef: "another-authorization", symbol: sameSlot ? "000660" : "005930" });
    await new ManualAssignmentFileRepository(state.dir).append(manual);
    const { manualCapacityReservationId: _id, manualCapacityReservationHash: _hash, ...payload } = state.manual.record;
    const reservation = createManualOpeningCapacityReservationRecord({ ...payload, reservationKind: "new_position",
      manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
      authorizationRef: manual.authorizationRef, symbol: manual.symbol, reservedSlotOrdinal: sameSlot ? 0 : 1, capacityLedgerVersion: 3, createdAt: at(60) });
    await new ManualOpeningCapacityReservationFileRepository(state.dir).append(reservation);
    context.mock.timers.setTime(START + 70);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "reserved", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: reservation.manualCapacityReservationId, reservationHash: reservation.manualCapacityReservationHash,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
        manualCapacityReservationHash: reservation.manualCapacityReservationHash }, capacityLedgerVersion: 3,
      remainingReservedNotionalKrw: reservation.reservedMaximumNotionalKrw, occupiesNewPositionSlot: true, asOf: at(70), createdAt: at(70)
    }));
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash)),
      sameSlot ? /repeats an occupied slot ordinal/ : /repeats a new-position instrument/);
  });
});

test("stored opening occupancy rejects unverified request cancellation even without pending BUY", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), { eventsPath } = createOpeningCapacityReservationEventPaths(state.dir);
    const lines = (await readFile(eventsPath, "utf8")).trimEnd().split("\n");
    await writeFile(eventsPath, `${lines.slice(0, 2).join("\n")}\n`);
    context.mock.timers.setTime(START + 50);
    const root = state.manual.root;
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "released", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: root.reservationId, reservationHash: root.reservationHash,
      previousCapacityReservationEventId: root.capacityReservationEventId, capacityLedgerVersion: 2,
      remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
      releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "unverified-cancellation" },
      releaseReasonCode: "fixture_cancel", asOf: at(50), createdAt: at(50)
    }));
    const before = await readFile(eventsPath);
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash, 60)), /lacks a verified source/);
    assert.deepEqual(await readFile(eventsPath), before);
  });
});

test("stored opening occupancy captures its strict query before asynchronous policy loading", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const input = { baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId };
    const result = resolveStoredSnapshotOpeningCapacity(input);
    input.portfolioSnapshotId = "missing"; input.baseDir = "missing";
    assert.equal(intraday(await result).availableSlots, 3);
    await assert.rejects(resolveStoredSnapshotOpeningCapacity({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId, trusted: true } as never));
  });
});

test("stored opening occupancy rejects unsafe bucket and portfolio sums across distinct policy ledgers", async (context) => {
  for (const bucket of ["intraday", "swing"] as const) await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    context.mock.timers.setTime(START + 60);
    const oldHash = `sha256:${"c".repeat(64)}`, origin = snapshot(oldHash);
    await new PortfolioSizingSnapshotFileRepository(state.dir).append(origin);
    const { manualAssignmentEventId: _eventId, manualAssignmentEventHash: _eventHash, ...manualPayload } = state.manual.source;
    const manual = createManualAssignmentEvent({ ...manualPayload, policyHash: oldHash, bucket, symbol: "000660",
      authorizationScope: "open_or_increase", authorizationRef: "overflow-fixture", maximumNotionalKrw: Number.MAX_SAFE_INTEGER,
      portfolioSnapshotId: origin.portfolioSnapshotId, portfolioSnapshotHash: origin.portfolioSnapshotHash } as Parameters<typeof createManualAssignmentEvent>[0]);
    await new ManualAssignmentFileRepository(state.dir).append(manual);
    const reservation = createManualOpeningCapacityReservationRecord({ reservationKind: "new_position", portfolioId: PORTFOLIO,
      policyHash: oldHash, bucket, market: "KR", symbol: manual.symbol, authorizationRef: manual.authorizationRef,
      manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
      currentPortfolioSnapshotId: origin.portfolioSnapshotId, currentPortfolioSnapshotHash: origin.portfolioSnapshotHash,
      reservedSlotOrdinal: 0, capacityLedgerVersion: 1, reservedMaximumNotionalKrw: Number.MAX_SAFE_INTEGER,
      resultingReservedNotionalKrw: Number.MAX_SAFE_INTEGER, createdAt: at(60) });
    await new ManualOpeningCapacityReservationFileRepository(state.dir).append(reservation);
    context.mock.timers.setTime(START + 70);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "reserved", portfolioId: PORTFOLIO, policyHash: oldHash, bucket,
      reservationId: reservation.manualCapacityReservationId, reservationHash: reservation.manualCapacityReservationHash,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
        manualCapacityReservationHash: reservation.manualCapacityReservationHash }, capacityLedgerVersion: 1,
      remainingReservedNotionalKrw: Number.MAX_SAFE_INTEGER, occupiesNewPositionSlot: true, asOf: at(70), createdAt: at(70) }));
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash)),
      bucket === "intraday" ? /reserved totals are unsafe/ : /portfolio reserved total is unsafe/);
  });
});
