import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { appendPolicyBoundCurrentPortfolioSizingSnapshot as publish } from "./currentPortfolioSizingSnapshotFiles.js";
import { fixture, request, event, options, T, at, readSnapshotBytes } from "./currentSizingPendingTestFixtures.js";
import { createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget } from "./rebalancePlan.js";
import { getHeldRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import { createRebalancePlanPaths } from "./rebalancePlanFiles.js";
import { withStoredPendingPlanActionHistory, projectHeldPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

for (const selector of [false, true]) {
  for (const mode of ["missing", "boundary", "late"] as const) for (const retry of [false, true]) {
    test(`current pending reservation rejects ${selector ? "selector" : "manual"} ${mode} consumption before append retry=${retry}`, async (context) => {
      await fixture(context, "whole_buy", async (state) => {
        const input = request(state);
        if (retry) await publish(input, options);
        const destination = await readSnapshotBytes(state.records), portfolio = await fs.readFile(state.portfolioPath);
        const path = createOpeningCapacityReservationEventPaths(state.baseDir).eventsPath, original = await fs.readFile(path, "utf8");
        const consumed = await state.capacity.withDurableVerifiedHistory(async (history) => history.events.at(-1)!);
        assert.equal(consumed.eventType, "consumed_by_position");
        await fs.writeFile(path, original.trimEnd().split("\n").slice(0, -2).join("\n") + "\n");
        if (mode !== "missing") {
          context.mock.timers.setTime(T + (mode === "boundary" ? 50 : 51));
          await state.capacity.append(consumed);
        }
        context.mock.timers.setTime(T + 100);
        const damaged = await fs.readFile(path);
        await assert.rejects(publish(input, options), mode === "boundary"
          ? /commit is ambiguous at cutoff/ : /prior execution lacks its actual reservation consumption/);
        assert.deepEqual(await readSnapshotBytes(state.records), destination);
        assert.deepEqual(await fs.readFile(path), damaged); assert.deepEqual(await fs.readFile(state.portfolioPath), portfolio);
        await fs.writeFile(path, original);
        assert.deepEqual(await publish(input, options), await publish(input, options));
      }, { selector });
    });
  }
  for (const quantity of [1, 2]) test(`current pending reservation aggregates ${selector ? "selector" : "manual"} shared BUY gross quantity=${quantity}`, async (context) => {
    await fixture(context, "whole_buy", async (state) => {
      const { planId: _id, planHash: _hash, ...payload } = state.plan, originalAction = payload.actions[0]!;
      const priorTarget = originalAction.executionTarget;
      if (priorTarget.targetKind !== "whole_share_quantity") throw new Error("whole BUY fixture required");
      const target = { ...priorTarget, targetQuantity: quantity, plannedNotionalKrw: quantity * 100 };
      context.mock.timers.setTime(T + 41);
      const plan = await state.plans.append(createRebalancePlanRecord({ ...payload, cycleId: "synthetic-other-cycle", createdAt: at(41),
        actions: [{ ...originalAction, executionTarget: target }] }));
      context.mock.timers.setTime(T + 42); const preview = await state.events.append(event(plan, "previewed", undefined, 42));
      context.mock.timers.setTime(T + 43); const approved = await state.events.append(event(plan, "approved", preview, 43));
      context.mock.timers.setTime(T + 100);
      const extra = { ...state.pending, planId: plan.planId, planHash: plan.planHash, planEventId: approved.planEventId,
        planEventHash: approved.planEventHash, actionExecutionTargetHash: hashRebalanceExecutionTarget(target), remainingNotionalKrw: quantity * 100 };
      const input = request(state, [state.pending, extra]), before = await readSnapshotBytes(state.records);
      if (quantity === 1) {
        const first = await publish(input, options);
        assert.equal(first.exposureSnapshot.pendingBuyExposureKrw, 300);
        assert.deepEqual(await publish(input, options), first);
      } else {
        await assert.rejects(publish(input, options), /exceeds remaining reservation gross/);
        assert.deepEqual(await readSnapshotBytes(state.records), before);
      }
    }, { selector });
  });
}

for (const offset of [40, 41]) for (const retry of [false, true]) {
  test(`current pending reservation preserves SELL completion gate offset=${offset} retry=${retry}`, async (context) => {
    await fixture(context, "fractional_sell", async (state) => {
      const input = request(state);
      if (retry) await publish(input, options);
      const before = await readSnapshotBytes(state.records), path = createPaperFillExecutionPaths(state.baseDir).recordsPath;
      const original = await fs.readFile(path, "utf8"), rows = original.trimEnd().split("\n").map((row) => JSON.parse(row));
      const { completionHash: _hash, ...completion } = rows.at(-1)!;
      assert.equal(completion.schemaVersion, "paper_fill_execution_completion.v1");
      const payload = { ...completion, completedAt: at(offset) };
      const damaged = [...rows.slice(0, -1), { ...payload, completionHash: hashCanonicalPayload(payload) }].map((row) => JSON.stringify(row)).join("\n") + "\n";
      await fs.writeFile(path, damaged);
      await assert.rejects(publish(input, options), /held pending reservation fill completion follows its execution event/);
      assert.deepEqual(await readSnapshotBytes(state.records), before); assert.equal(await fs.readFile(path, "utf8"), damaged);
      await fs.writeFile(path, original); await publish(input, options);
    }, { reduceOnly: true, completion: true });
  });
}

test("unprojected pending history retains full actual sources locks and callback lifetime", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    const query = { baseDir: state.baseDir, portfolioId: state.plan.portfolioId, asOf: at(5) };
    const escaped = await withStoredPendingPlanActionHistory(query, async (history) => {
      assert.equal(history.events.length, 3);
      assert.deepEqual(projectHeldPendingPlanActionProgress(query, history).projection.pendingActions, []);
      assert.equal(projectHeldPendingPlanActionProgress({ ...query, asOf: at(50) }, history).projection.pendingActions.length, 1);
      await assert.rejects(state.plans.append(state.plan), /lock is unavailable/);
      await assert.rejects(state.events.readAll(), /lock is unavailable/);
      return history;
    }, options);
    assert.throws(() => getHeldRebalancePlanEventObservation(escaped), /expired/);
    await assert.rejects(withStoredPendingPlanActionHistory(query, async () => { throw new Error("synthetic consumer failure"); }, options), /consumer failure/);
    await state.plans.append(state.plan); assert.equal((await state.events.readAll()).length, 3);
  });
});

test("unprojected pending history rejects noncanonical future and backwards requests before consumption", async (context) => {
  await fixture(context, "whole_buy", async (state) => {
    const query = { baseDir: state.baseDir, portfolioId: state.plan.portfolioId, asOf: at(50) };
    const consume = async () => assert.fail("invalid observation must not reach consumer");
    await assert.rejects(withStoredPendingPlanActionHistory({ ...query, trusted: true } as never, consume, options));
    await assert.rejects(withStoredPendingPlanActionHistory({ ...query, asOf: at(101) }, consume, options), /cutoff follows/);
    const path = createRebalancePlanPaths(state.baseDir).recordsPath, original = fs.open;
    const hook = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === path && args[1] === "r+") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await sync(); context.mock.timers.setTime(T + 99); });
      }
      return handle;
    }); syncBuiltinESMExports();
    try { await assert.rejects(withStoredPendingPlanActionHistory(query, consume, options), /clock moved backwards/); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); context.mock.timers.setTime(T + 100); }
    await withStoredPendingPlanActionHistory(query, async (history) => assert.equal(history.events.length, 3), options);
  });
});
