import assert from "node:assert/strict";
import test from "node:test";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { HASH, fixture as manualFixture } from "./storedManualOpeningCapacityTestFixtures.js";
import { run, intraday, storePolicy, position, storeSnapshot, fixture } from "./storedSnapshotOpeningCapacityTestFixtures.js";

test("stored opening occupancy includes old-policy reservations and counts pending BUY only once across fills", async (context) => {
  for (const source of ["manual", "selector"] as const) for (const count of [0, 1, 2, 3]) {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const policy = await storePolicy(state.dir);
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, 170, count ? [position("005930", "intraday", [0, 4, 7, 10][count]!)] : []);
      const result = await run(state, stored), capacity = intraday(result);
      assert.notEqual(stored.policyHash, HASH);
      assert.equal(capacity.maximumPositionCount, 4);
      assert.equal(capacity.activePositionCount, count ? 1 : 0);
      assert.equal(capacity.pendingReservationCount, count ? 0 : 1);
      assert.equal(capacity.mandateBoundUnusedSlotCount, 0);
      assert.equal(capacity.availableSlots, 3);
      assert.equal(capacity.reservedOpeningNotionalKrw, [100, 60, 30, 0][count]);
      assert.equal(capacity.pendingBuyNotionalKrw, capacity.reservedOpeningNotionalKrw);
      assert.equal(capacity.unsubmittedReservedNotionalKrw, 0);
      assert.equal(result.totalReservedOpeningNotionalKrw, capacity.reservedOpeningNotionalKrw);
      assert.equal(result.assessment.currentLedgerAndCasAuthority, "not_verified");
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      assert.equal(result.assessment.capacitiesHash, hashCanonicalPayload(result.capacities));
      assert.ok(Object.isFrozen(result.capacities)); assert.ok(Object.isFrozen(capacity));
      assert.deepEqual(await run(state, stored), result);
    });
  }
});

test("stored opening occupancy separates unbound roots and unused bound slots at the snapshot cutoff", async (context) => {
  for (const source of ["manual", "selector"] as const) await fixture(context, source, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    for (const cutoff of [25, 45]) {
      const result = await run(state, await storeSnapshot(state, context, policy.policy.policyHash, cutoff));
      assert.equal(intraday(result).pendingReservationCount, cutoff === 25 ? 1 : 0);
      assert.equal(intraday(result).mandateBoundUnusedSlotCount, cutoff === 45 ? 1 : 0);
      assert.equal(intraday(result).pendingBuyNotionalKrw, 0);
      assert.equal(intraday(result).unsubmittedReservedNotionalKrw, 100);
      assert.equal(intraday(result).availableSlots, 3);
    }
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash, 40)), /ambiguous at cutoff/);
  });
});

test("stored opening occupancy counts unrelated held instruments without double-reserving pending cash", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    const result = await run(state, await storeSnapshot(state, context, policy.policy.policyHash, 170,
      [position("000660", "intraday"), position("035420", "swing")]));
    assert.equal(intraday(result).activePositionCount, 1);
    assert.equal(intraday(result).availableSlots, 2);
    assert.equal(result.capacities.find((item) => item.bucket === "swing")!.availableSlots, 3);
    assert.equal(result.totalReservedOpeningNotionalKrw, 100);
  });
});

test("stored opening occupancy preserves zero holding rejection and clamps overfull slots without changing reservations", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    await assert.rejects(storeSnapshot(state, context, policy.policy.policyHash, 170, [position("000660", "intraday", 0)]), /position quantity must be positive/);
    const full = await run(state, await storeSnapshot(state, context, policy.policy.policyHash, 170,
      ["000660", "035420", "035720", "005380"].map((symbol) => position(symbol, "intraday"))));
    assert.equal(intraday(full).activePositionCount, 4);
    assert.equal(intraday(full).pendingReservationCount, 1);
    assert.equal(intraday(full).availableSlots, 0);
    assert.equal(intraday(full).reservedOpeningNotionalKrw, 100);
  });
});
