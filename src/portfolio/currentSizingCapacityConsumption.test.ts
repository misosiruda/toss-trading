import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { seedCapacityExecutionHistory, fixture as executionFixture, START, at, PORTFOLIO } from "./storedManualOpeningCapacityTestFixtures.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createRebalancePlanPaths } from "./rebalancePlanFiles.js";
import { assertHeldRebalancePlanEventSource, createRebalancePlanEventPaths, type VerifiedRebalancePlanEventHistory } from "./rebalancePlanEventFiles.js";
import { createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { withStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

test("pending progress callback retains complete actual history beyond its filtered cutoff only during its lease", async (context) => {
  await executionFixture(context, {}, async ({ dir }) => {
    let expired!: VerifiedRebalancePlanEventHistory;
    await withStoredPendingPlanActionProgress({ baseDir: dir, portfolioId: PORTFOLIO, asOf: at(55) }, async (progress, history) => {
      assert.deepEqual(progress.projection.planReplays, []);
      assert.equal(history.events.length, 3);
      assertHeldRebalancePlanEventSource(history, dir); expired = history;
    });
    assert.throws(() => assertHeldRebalancePlanEventSource(expired, dir), /lease/);
  });
});

for (const kind of ["manual", "selector"] as const) {
  for (const cutoff of [55, 200]) test(`current sizing binds ${kind} actual terminal consumption on append and retry cutoff=${cutoff}`, async (context) => {
    await fixture(context, async ({ dir, root, store, request, records }) => {
      await seedCapacityExecutionHistory(dir, context, { count: 3, feeBps: 250 }, root);
      context.mock.timers.setTime(START + 200);
      await store.write({ portfolioId: PORTFOLIO, cashKrw: 1000, positions: [], updatedAt: at(50) });
      const input = { ...request, asOf: at(cutoff) }, before = await store.readSnapshot();
      const path = createOpeningCapacityReservationEventPaths(dir).eventsPath, bytes = await fs.readFile(path);
      const snapshot = await publish(input, options), destination = await fs.readFile(records);
      assert.deepEqual(await publish(input, options), snapshot);
      assert.deepEqual(await fs.readFile(records), destination);
      assert.deepEqual(await fs.readFile(path), bytes);
      assert.deepEqual(await store.readSnapshot(), before);
      assert.deepEqual(snapshot.pendingActionInputs, []);
    }, kind);
  });

  for (const retry of [false, true]) test(`current sizing rejects ${kind} post-cutoff consumption without matching execution or gross retry=${retry}`, async (context) => {
    await fixture(context, async ({ dir, root, store, request, records }) => {
      const seeded = await seedCapacityExecutionHistory(dir, context, {}, root);
      context.mock.timers.setTime(START + 200);
      await store.write({ portfolioId: PORTFOLIO, cashKrw: 1000, positions: [], updatedAt: at(50) });
      const input = { ...request, asOf: at(55) };
      if (retry) await publish(input, options);
      const destination = await fs.readFile(records), portfolio = await store.readSnapshot();
      const path = createOpeningCapacityReservationEventPaths(dir).eventsPath, original = await fs.readFile(path);
      const consumption = seeded.capacity[0]!;
      const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = consumption;
      if (payload.eventType !== "consumed_by_position") throw new Error("consumption fixture required");
      for (const patch of [{ remainingReservedNotionalKrw: 59 }, { paperFillRecordId: "missing" }]) {
        await fs.unlink(path);
        const repository = new OpeningCapacityReservationEventFileRepository(dir);
        context.mock.timers.setTime(START + 20); await repository.append(root.root);
        context.mock.timers.setTime(START + 40); await repository.append(root.bound);
        context.mock.timers.setTime(START + 95); await repository.append(createOpeningCapacityReservationEvent({ ...payload, ...patch }));
        context.mock.timers.setTime(START + 200);
        const damaged = await fs.readFile(path);
        await assert.rejects(publish(input, options), /differs from actual filled notional|no actual mandate or plan execution source/);
        assert.deepEqual(await fs.readFile(path), damaged);
        assert.deepEqual(await fs.readFile(records), destination);
        assert.deepEqual(await store.readSnapshot(), portfolio);
      }
      await fs.writeFile(path, original);
      await publish(input, options);
    }, kind);
  });

  test(`current sizing holds ${kind} execution and price source locks through destination fsync and retry`, async (context) => {
    await fixture(context, async ({ dir, root, request, records }) => {
      await seedCapacityExecutionHistory(dir, context, { count: 3 }, root);
      context.mock.timers.setTime(START + 200);
      const input = { ...request, asOf: at(200) }, original = fs.open;
      let finalPhase = false, checked = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (args[0] === createOpeningCapacityReservationEventPaths(dir).lockPath && args[1] === "wx") finalPhase = true;
        if (args[0] === records && finalPhase && (args[1] === "a" || args[1] === "r+")) {
          const sync = handle.sync.bind(handle);
          context.mock.method(handle, "sync", async () => {
            for (const path of [createRebalancePlanPaths(dir).lockPath, createRebalancePlanEventPaths(dir).lockPath,
              createPortfolioActionRiskDecisionPaths(dir).lockPath, createPaperFillExecutionPaths(dir).lockPath, createSourcePriceEvidencePaths(dir).lockPath]) {
              await assert.rejects(original(path, "wx"), { code: "EEXIST" });
            }
            checked++; await sync();
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try { await publish(input, options); finalPhase = false; await publish(input, options); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(checked, 2);
    }, kind);
  });
}
