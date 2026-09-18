import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { withPublishedCurrentOpeningBudget as consume, appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot as historical } from "./currentPortfolioSizingSnapshotFiles.js";
import { createRebalancePlanRecord } from "./rebalancePlan.js";
import { RebalancePlanFileRepository, createRebalancePlanPaths, resolveVerifiedRebalancePlanOrigin } from "./rebalancePlanFiles.js";
import { BucketOpeningCapacityStateFileRepository as Capacity, createBucketOpeningCapacityStatePaths } from "./bucketOpeningCapacityStateFiles.js";
import { START, at, HASH, PORTFOLIO } from "./storedManualOpeningCapacityTestFixtures.js";

async function latePlan(dir: string) {
  return new RebalancePlanFileRepository(dir).append(createRebalancePlanRecord({ cycleId: "late-plan", portfolioId: PORTFOLIO,
    portfolioVersion: "v1", portfolioSnapshotHash: HASH, policyHash: HASH, evidenceCutoffAt: at(55), createdAt: at(60),
    triggerRef: "synthetic", phase: "buy", actions: [{ actionId: "action", actionSequence: 0, market: "KR", symbol: "005930",
      lineageKind: "mandate", side: "BUY", mandateId: "synthetic-mandate", executionTarget: { targetKind: "fractional_buy_notional",
        targetNotionalKrw: 100 }, maximumNotionalKrw: 100, reasonCodes: ["synthetic"] }] }));
}

for (const kind of ["manual", "selector"] as const) {
  for (const retry of [false, true]) test(`current ${kind} publication rejects post-cutoff backdated plan before consumer retry=${retry}`, async (context) => {
    await fixture(context, async ({ dir, request, records, store }) => {
      if (retry) await consume(request, async () => {}, options);
      const before = await fs.readFile(records), portfolio = await store.readSnapshot();
      context.mock.timers.setTime(START + 120); await latePlan(dir); context.mock.timers.setTime(START + 130);
      let called = false;
      await assert.rejects(consume(request, async () => { called = true; }, options), /recorded-time coverage.*plan commit/);
      assert.equal(called, false); assert.deepEqual(await fs.readFile(records), before); assert.deepEqual(await store.readSnapshot(), portfolio);
      // Detached historical publication is intentionally still allowed; it grants no current consumer scope.
      assert.equal((await historical(request, options)).snapshot.asOf, request.asOf);
      await consume({ ...request, asOf: at(121) }, async () => { called = true; }, options); assert.equal(called, true);
    }, kind, true);
  });

  test(`current ${kind} document retry rechecks event frontier and preserves prior document`, async (context) => {
    await fixture(context, async ({ dir, request, records }) => {
      const repository = new Capacity(dir), { baseDir: _baseDir, ...snapshotInput } = request;
      const input = { snapshotInput, expectedDocumentHash: null as string | null };
      const first = await repository.refreshFromCurrentPublication(input), path = createBucketOpeningCapacityStatePaths(dir).statePath;
      const before = await fs.readFile(path), snapshots = await fs.readFile(records);
      context.mock.timers.setTime(START + 120); await latePlan(dir); context.mock.timers.setTime(START + 130);
      await assert.rejects(repository.refreshFromCurrentPublication(input), /recorded-time coverage.*plan commit/);
      assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(records), snapshots);
      assert.deepEqual(await repository.readVerifiedSnapshot(), first);
      const next = await repository.refreshFromCurrentPublication({ snapshotInput: { ...snapshotInput, asOf: at(121) }, expectedDocumentHash: first.documentHash });
      assert.notEqual(next.documentHash, first.documentHash);
    }, kind, true);
  });

  test(`current ${kind} recorded-time coverage never promotes a straddling marker fsync into historical availability`, async (context) => {
    await fixture(context, async ({ dir, request }) => {
      const path = createRebalancePlanPaths(dir).recordsPath, original = fs.open;
      let delayed = false;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        const handle = await original(...args);
        if (args[0] === path && args[1] === "a") {
          const write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle); let marker = false;
          context.mock.method(handle, "writeFile", async (...parts: Parameters<typeof handle.writeFile>) => {
            marker = String(parts[0]).includes("rebalance_plan_commit.v1"); return write(...parts);
          });
          context.mock.method(handle, "sync", async () => {
            await sync();
            if (marker) { context.mock.timers.setTime(START + 101); delayed = true; }
          });
        }
        return handle;
      });
      syncBuiltinESMExports(); context.mock.timers.setTime(START + 99);
      let plan!: Awaited<ReturnType<typeof latePlan>>;
      try { plan = await latePlan(dir); } finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(delayed, true);
      const history = await new RebalancePlanFileRepository(dir).readVerifiedHistory();
      assert.equal(resolveVerifiedRebalancePlanOrigin(history, plan.planId).appendedAt, at(99));
      assert.equal(request.asOf, at(100)); assert.equal(Date.now(), START + 101);
      await consume(request, async (publication) => {
        assert.equal(publication.openingBudget.assessment.historicalDiskAvailability, "not_proven");
        assert.equal(publication.openingBudget.occupancy.assessment.historicalDiskAvailability, "not_proven");
        assert.equal(publication.openingBudget.assessment.currentExecutionAuthority, "not_granted");
      }, options);
    }, kind, true);
  });
}
