import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { START, PORTFOLIO, at, snapshot, fixture as manualFixture } from "./storedManualOpeningCapacityTestFixtures.js";
import { resolveStoredBucketOpeningCapacityStates } from "./storedBucketOpeningCapacityStates.js";
import { parseBucketOpeningCapacityState, resolveBucketOpeningCapacityStatePolicy } from "./bucketOpeningCapacityState.js";
import { BucketOpeningCapacityStateFileRepository } from "./bucketOpeningCapacityStateFiles.js";
import { storePolicy, position, storeSnapshot, fixture } from "./storedSnapshotOpeningCapacityTestFixtures.js";

test("stored capacity states bind every bucket to actual snapshot occupancy and reserved budgets across fills", async (context) => {
  for (const source of ["manual", "selector"] as const) for (const count of [0, 1, 3]) {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const policy = await storePolicy(state.dir), quantity = [0, 4, 7, 10][count]!;
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, 170,
        quantity ? [position("005930", "intraday", quantity)] : []);
      const result = await resolveStoredBucketOpeningCapacityStates({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      const { projectionHash, ...payload } = result.projection;
      assert.equal(projectionHash, hashCanonicalPayload(payload));
      assert.equal(result.projection.states.length, 5);
      assert.deepEqual(result.projection.states.map((item) => item.bucket), policy.policy.strategyBuckets.map((item) => item.bucket));
      for (const item of result.projection.states) {
        assert.deepEqual(parseBucketOpeningCapacityState(JSON.parse(JSON.stringify(item))), item);
        assert.equal(resolveBucketOpeningCapacityStatePolicy({ state: item, policy: policy.policy }).state.capacityStateHash, item.capacityStateHash);
        assert.equal(item.currentPortfolioSnapshotHash, stored.portfolioSnapshotHash);
        assert.equal(item.currentPortfolioSnapshotId, stored.portfolioSnapshotId);
        assert.equal(item.policyHash, policy.policy.policyHash);
        assert.equal(item.capacityLedgerVersion, 0); // Outstanding roots belong to the old policy, not this policy's event epoch.
        assert.equal(Object.hasOwn(item, "lastReservationRecordId"), false);
        assert.equal(item.remainingOpeningBudgetKrw, result.budget.budgets.find((bound) => bound.bucket === item.bucket)!.maximumAdditionalNetCashDebitKrw);
        assert.ok(Object.isFrozen(item));
      }
      const day = result.projection.states.find((item) => item.bucket === "intraday")!;
      assert.equal(day.activePositionCount, count ? 1 : 0);
      assert.equal(day.pendingReservationCount, count ? 0 : 1);
      assert.equal(day.reservedOpeningNotionalKrw, [100, 60, 30, 0][count]);
      assert.equal(result.assessment.budgetAssessmentHash, result.budget.assessmentHash);
      assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
      assert.equal(result.assessment.currentLedgerAndCasAuthority, "not_verified");
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      assert.ok(Object.isFrozen(result.projection)); assert.ok(Object.isFrozen(result.projection.states));
      context.mock.timers.setTime(START + 250);
      const repeated = await resolveStoredBucketOpeningCapacityStates({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      assert.deepEqual(repeated.projection, result.projection);
      assert.notEqual(repeated.assessmentHash, result.assessmentHash);
    });
  }
});

test("stored capacity states derive current policy versions and last roots while retaining old policy reservations", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    const rootIds: string[] = [];
    for (const [index, symbol] of ["000660", "035420"].entries()) {
      context.mock.timers.setTime(START + 60 + index * 20);
      const origin = snapshot(policy.policy.policyHash);
      await new PortfolioSizingSnapshotFileRepository(state.dir).append(origin);
      const { manualAssignmentEventId: _id, manualAssignmentEventHash: _hash, ...manualPayload } = state.manual.source;
      const manual = createManualAssignmentEvent({ ...manualPayload, policyHash: policy.policy.policyHash, symbol,
        authorizationScope: "open_or_increase", authorizationRef: `current-root-${index}`,
        portfolioSnapshotId: origin.portfolioSnapshotId, portfolioSnapshotHash: origin.portfolioSnapshotHash } as Parameters<typeof createManualAssignmentEvent>[0]);
      await new ManualAssignmentFileRepository(state.dir).append(manual);
      const reservation = createManualOpeningCapacityReservationRecord({ reservationKind: "new_position", portfolioId: PORTFOLIO,
        policyHash: policy.policy.policyHash, bucket: "intraday", market: "KR", symbol, authorizationRef: manual.authorizationRef,
        manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
        currentPortfolioSnapshotId: origin.portfolioSnapshotId, currentPortfolioSnapshotHash: origin.portfolioSnapshotHash,
        reservedSlotOrdinal: index, capacityLedgerVersion: index + 1, reservedMaximumNotionalKrw: 100,
        resultingReservedNotionalKrw: (index + 1) * 100, createdAt: at(60 + index * 20) });
      await new ManualOpeningCapacityReservationFileRepository(state.dir).append(reservation);
      context.mock.timers.setTime(START + 70 + index * 20);
      await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
        eventType: "reserved", portfolioId: PORTFOLIO, policyHash: policy.policy.policyHash, bucket: "intraday",
        reservationId: reservation.manualCapacityReservationId, reservationHash: reservation.manualCapacityReservationHash,
        reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
          manualCapacityReservationHash: reservation.manualCapacityReservationHash }, capacityLedgerVersion: index + 1,
        remainingReservedNotionalKrw: 100, occupiesNewPositionSlot: true, asOf: at(70 + index * 20), createdAt: at(70 + index * 20) }));
      rootIds.push(reservation.manualCapacityReservationId);
    }
    for (const [count, cutoff] of [[0, 45], [1, 75], [2, 95]] as const) {
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, cutoff);
      const result = await resolveStoredBucketOpeningCapacityStates({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      const day = result.projection.states.find((item) => item.bucket === "intraday")!;
      assert.equal(day.capacityLedgerVersion, count);
      assert.equal(day.lastReservationRecordId, count ? rootIds[count - 1] : undefined);
      assert.equal(day.reservedOpeningNotionalKrw, (count + 1) * 100);
      assert.equal(day.availableSlots, 3 - count);
      assert.equal(day.remainingOpeningBudgetKrw, 500 - (count + 1) * 100);
      assert.equal(result.projection.states.find((item) => item.bucket === "swing")!.capacityLedgerVersion, 0);
    }
  });
});

test("stored capacity states normalize offset snapshot instants without changing the source hash or accepting caller state", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = stored;
    const offset = await new PortfolioSizingSnapshotFileRepository(state.dir).append(createPortfolioSizingSnapshot({ ...payload,
      portfolioVersion: "offset-snapshot", asOf: stored.asOf.replace("Z", "+00:00") }));
    const input = { baseDir: state.dir, portfolioSnapshotId: offset.portfolioSnapshotId };
    const pending = resolveStoredBucketOpeningCapacityStates(input);
    input.baseDir = "missing"; input.portfolioSnapshotId = "missing";
    const result = await pending;
    assert.equal(result.projection.asOf, stored.asOf);
    assert.equal(result.projection.portfolioSnapshotHash, offset.portfolioSnapshotHash);
    assert.ok(result.projection.states.every((item) => item.asOf === stored.asOf));
    await assert.rejects(resolveStoredBucketOpeningCapacityStates({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId,
      states: result.projection.states } as never));
    const { eventsPath } = createOpeningCapacityReservationEventPaths(state.dir);
    const corrupt = (await readFile(eventsPath)).subarray(0, -1);
    await writeFile(eventsPath, corrupt);
    await assert.rejects(resolveStoredBucketOpeningCapacityStates({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId }), /torn final line/);
    assert.deepEqual(await readFile(eventsPath), corrupt);
  });
});

test("capacity state persistence replays actual manual and selector reservation fills after restart", async (context) => {
  for (const source of ["manual", "selector"] as const) await fixture(context, source, { count: 1, feeBps: 250 }, async (state) => {
    const policy = await storePolicy(state.dir);
    const stored = await storeSnapshot(state, context, policy.policy.policyHash, 170, [position("005930", "intraday", 4)]);
    const repository = new BucketOpeningCapacityStateFileRepository(state.dir);
    const document = await repository.refresh({ portfolioSnapshotId: stored.portfolioSnapshotId, expectedDocumentHash: null });
    const day = document.projections[0]!.states.find((item) => item.bucket === "intraday")!;
    assert.equal(day.activePositionCount, 1); assert.equal(day.pendingReservationCount, 0);
    assert.equal(day.reservedOpeningNotionalKrw, 60); assert.equal(day.availableSlots, 3);
    assert.deepEqual(await new BucketOpeningCapacityStateFileRepository(state.dir).readVerifiedSnapshot(), document);
  });
});
