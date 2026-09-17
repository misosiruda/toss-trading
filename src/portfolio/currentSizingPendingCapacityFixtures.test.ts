import assert from "node:assert/strict";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot } from "./currentPortfolioSizingSnapshotFiles.js";
import { fixture, request, options, readSnapshotBytes } from "./currentSizingPendingTestFixtures.js";
import { resolveStoredSnapshotPendingReservationOrigins } from "./storedSnapshotPendingReservationOrigins.js";

for (const selector of [false, true]) for (const kind of ["fractional_buy", "whole_buy"] as const) {
  test(`current pending fixture provides actual ${selector ? "selector" : "manual"} ${kind} reservation and consumption origins`, async (context) => {
    await fixture(context, kind, async (state) => {
      assert.ok(state.opening); assert.ok(state.bound);
      assert.equal(state.initialSnapshotCount, 1); assert.ok(state.initialSnapshotBytes);
      const published = await appendPolicyBoundCurrentPortfolioSizingSnapshot(request(state), options);
      const bytes = await readSnapshotBytes(state.records);
      const result = await resolveStoredSnapshotPendingReservationOrigins({ baseDir: state.baseDir, portfolioSnapshotId: published.portfolioSnapshotId }, options);
      assert.equal(result.bindings.length, 1);
      assert.equal(result.bindings[0]!.reservation.sourceKind, selector ? "selector" : "manual");
      assert.equal(result.bindings[0]!.reservation.root.reservationId, state.opening.root.reservationId);
      assert.equal(result.bindings[0]!.priorConsumptionOrigins.length, 1);
      assert.equal(result.bindings[0]!.priorConsumptionOrigins[0]!.event.eventType, "consumed_by_position");
      assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, kind === "fractional_buy" ? 360 : 300);
      assert.equal(result.reservationTotals[0]!.pendingNotionalKrw, kind === "fractional_buy" ? 60 : 200);
      assert.deepEqual(result.assessment.unverifiedCapacityEventIds, []);
      assert.notEqual(published.policyHash, state.mandate.policyHash);
      assert.deepEqual(await appendPolicyBoundCurrentPortfolioSizingSnapshot(request(state), options), published);
      assert.deepEqual(await readSnapshotBytes(state.records), bytes);
      assert.equal((await state.snapshots.readAll()).length, 2);
    }, { selector });
  });
}
