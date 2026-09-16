import assert from "node:assert/strict";
import test from "node:test";
import { OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { HASH, at, fixture as manualFixture } from "./storedManualOpeningCapacityTestFixtures.js";
import { run, intraday, capacityPolicy, storePolicy, storeSnapshot, fixture } from "./storedSnapshotOpeningCapacityTestFixtures.js";

test("stored opening occupancy rejects missing explicit policy limits and an inactive snapshot policy", async (context) => {
  for (const legacy of [true, false]) await fixture(context, "manual", { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir, legacy);
    const stored = await storeSnapshot(state, context, legacy ? policy.policy.policyHash : HASH);
    await assert.rejects(run(state, stored), legacy ? /explicit policy limits/ : /active policy mismatch/);
  });
});

test("stored opening occupancy rejects policy generation changes after reservation source observations", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const capacitySpy = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory");
    const original = RuntimePortfolioPolicyFileRepository.prototype.readGeneration;
    let injected = false;
    const mocked = context.mock.method(RuntimePortfolioPolicyFileRepository.prototype, "readGeneration", async function(this: RuntimePortfolioPolicyFileRepository) {
      if (!injected && capacitySpy.mock.callCount() > 0) {
        injected = true;
        await this.append(capacityPolicy(false, "next").policy);
      }
      return original.call(this);
    });
    try { await assert.rejects(run(state, stored), /policy generation changed/); assert.equal(injected, true); }
    finally { mocked.mock.restore(); capacitySpy.mock.restore(); }
    assert.equal(intraday(await run(state, stored)).availableSlots, 3);
  });
});

test("stored opening occupancy rejects policy changes at the final event observation", async (context) => {
  for (const phase of ["before", "after"] as const) for (const activate of [false, true]) {
    await manualFixture(context, { count: 0 }, async (state) => {
      const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
      const original = OpeningCapacityReservationEventFileRepository.prototype.withDurableVerifiedHistory;
      const spy = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory");
      const baseline = await run(state, stored), lastRead = spy.mock.callCount();
      spy.mock.restore();
      assert.ok(lastRead > 0);
      const changed = capacityPolicy(false, "changed-during-observation", 2);
      let calls = 0, injected = false;
      const inject = async () => {
        injected = true;
        await new RuntimePortfolioPolicyFileRepository(state.dir, policy.dependencies).append(changed.policy);
        if (activate) await new RuntimePortfolioPolicyActivationFileRepository(state.dir, [policy.policy, changed.policy], policy.dependencies)
          .appendActivated({ policy: changed.policy, supersedesActivationId: baseline.activePolicy.activation.activationId, createdAt: at(1) });
      };
      const mocked = context.mock.method(OpeningCapacityReservationEventFileRepository.prototype, "withDurableVerifiedHistory",
        async function(this: OpeningCapacityReservationEventFileRepository, operation: Parameters<typeof original>[0]) {
          const finalRead = ++calls === lastRead;
          if (finalRead && phase === "before") await inject();
          const result = await original.call(this, operation);
          if (finalRead && phase === "after") await inject();
          return result;
        } as typeof original);
      try { await assert.rejects(run(state, stored), /policy generation changed/); assert.equal(injected, true); }
      finally { mocked.mock.restore(); }
      if (activate) await assert.rejects(run(state, stored), /active policy mismatch/);
      else assert.equal(intraday(await run(state, stored)).availableSlots, 3);
    });
  }
});
