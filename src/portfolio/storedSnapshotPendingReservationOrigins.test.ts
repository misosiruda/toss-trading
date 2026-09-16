import assert from "node:assert/strict";
import test from "node:test";
import { HASH, OTHER, snapshot } from "./storedManualOpeningCapacityTestFixtures.js";
import { run, storeSnapshot, fixture } from "./snapshotPendingReservationTestFixtures.js";

test("pending BUY reservation origins bind manual and selector gross balances and old-policy sources across partial fills", async (context) => {
  for (const source of ["manual", "selector"] as const) for (const count of [0, 1, 2, 3]) {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const stored = { state, snapshot: await storeSnapshot(state, context, { policyHash: OTHER }) };
      const result = await run(stored);
      assert.equal(result.bindings.length, count === 3 ? 0 : 1);
      if (count !== 3) {
        const binding = result.bindings[0]!;
        assert.equal(binding.reservation.sourceKind, source);
        assert.equal(binding.reservation.mandate.policyHash, HASH);
        assert.equal(binding.pending.openingCapacityReservationId, state.manual.bound.reservationId);
        assert.equal(binding.priorConsumptionOrigins.length, count);
        assert.equal(result.reservationTotals[0]!.pendingNotionalKrw, count === 0 ? 100 : count === 1 ? 60 : 30);
        assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, result.reservationTotals[0]!.pendingNotionalKrw);
      }
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      assert.equal(result.assessment.slotAndBudgetAllocationAuthority, "not_verified");
      assert.deepEqual(result.assessment.unverifiedCapacityEventIds, []);
      assert.deepEqual(await run(stored), result);
      assert.ok(Object.isFrozen(result.bindings)); assert.ok(Object.isFrozen(result.reservationTotals));
    });
  }
});


test("pending BUY reservation origins reject wrong reservation identity hash and nonactive opening mandate", async (context) => {
  for (const patch of [{ openingCapacityReservationId: "missing" }, { openingCapacityReservationHash: OTHER }]) {
    await fixture(context, "selector", { count: 0 }, async (state) => {
      await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context, { patch }) }), /reservation or mandate lineage mismatch/);
    });
  }
  for (const mandateState of ["proposed", "review_required", "retired"] as const) {
    await fixture(context, "manual", { count: 0, mandateState }, async (state) => {
      await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context) }), /active.*mandate/);
    });
  }
  await fixture(context, "selector", { count: 0, wrongMandate: true }, async (state) => {
    await assert.rejects(run({ state, snapshot: await storeSnapshot(state, context) }), /reservation or mandate lineage mismatch/);
  });
});
