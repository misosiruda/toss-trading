import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { withCurrentCapacityFixture as fixture, options } from "./currentSizingCapacityTestFixtures.js";
import { withPublishedCurrentOpeningBudget as consume, appendOpeningBudgetBoundCurrentPortfolioSizingSnapshot as historical } from "./currentPortfolioSizingSnapshotFiles.js";
import { createRebalancePlanRecord } from "./rebalancePlan.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
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
      await assert.rejects(consume(request, async () => { called = true; }, options), /frontier.*plan commit/);
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
      await assert.rejects(repository.refreshFromCurrentPublication(input), /frontier.*plan commit/);
      assert.deepEqual(await fs.readFile(path), before); assert.deepEqual(await fs.readFile(records), snapshots);
      assert.deepEqual(await repository.readVerifiedSnapshot(), first);
      const next = await repository.refreshFromCurrentPublication({ snapshotInput: { ...snapshotInput, asOf: at(121) }, expectedDocumentHash: first.documentHash });
      assert.notEqual(next.documentHash, first.documentHash);
    }, kind, true);
  });
}
