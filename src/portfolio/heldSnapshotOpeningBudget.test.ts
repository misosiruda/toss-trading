import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { PaperFillExecutionFileRepository } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { bindHeldSnapshotOpeningBudget as bind } from "./heldSnapshotOpeningBudget.js";
import type { OpeningCapacityConsumptionSources as Sources } from "./openingCapacityConsumptionBinding.js";
import { fixture, storePolicy, capacityPolicy, storeSnapshot, position } from "./storedSnapshotOpeningCapacityTestFixtures.js";
import { storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { resolveStoredSnapshotOpeningBudget } from "./storedSnapshotOpeningBudget.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const options = { lockTimeoutMs: 60, lockRetryDelayMs: 3 };
async function hold<T>(dir: string, operation: (sources: Sources) => Promise<T>) {
  return new SourcePriceEvidenceFileRepository(dir, options).withDurableVerifiedHistory((prices) =>
    new ManualAssignmentFileRepository(dir, options).withDurableVerifiedHistory((manual) =>
      new CandidateAssignmentFileRepository(dir, options).withDurableVerifiedHistory((assignments, inputs, requests, snapshots) =>
        new ManualOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(manual, snapshots, (manualReservations) =>
          new SelectorOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots, (selectorReservations) =>
            new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(dir, options), options).withDurableVerifiedHistory((planEvents) =>
              new InvestmentMandateFileRepository(dir, options).withDurableVerifiedHistory((mandates) =>
                new PortfolioActionRiskDecisionFileRepository(dir, options).withDurableVerifiedHistory((risks) =>
                  new PaperFillExecutionFileRepository(dir, options).withDurableVerifiedHistory((fills) =>
                    new OpeningCapacityReservationEventFileRepository(dir, options).withDurableVerifiedHistory((events) =>
                      operation({ manual, requests, inputs, assignments, manualReservations, selectorReservations, mandates, events, prices, planEvents, risks, fills })))))))))));
}
const run = (query: Parameters<typeof bind>[0]) => hold(query.baseDir, async (sources) => bind(query, sources));

for (const source of ["manual", "selector"] as const) for (const count of [0, 1, 2, 3]) {
  test(`held budget matches historical ${source} after ${count} gross fills without double pending debit`, async (context) => {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const { policy } = await storePolicy(state.dir), quantity = [0, 4, 7, 10][count]!;
      const snapshot = await storeSnapshot(state, context, policy.policyHash, 170, quantity ? [position("005930", "intraday", quantity)] : []);
      const input = { baseDir: state.dir, snapshot, policy }, result = await run(input);
      const historical = await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: snapshot.portfolioSnapshotId });
      assert.deepEqual(result.cash, historical.cash); assert.deepEqual(result.budgets, historical.budgets);
      assert.equal(result.cash.reservedOpeningNotionalKrw, [100, 60, 30, 0][count]);
      assert.equal(result.cash.pendingBuyExposureKrw, result.cash.reservedOpeningNotionalKrw);
      assert.equal(result.cash.maximumAdditionalNetCashDebitKrw, 1000 - Math.round((1000 + quantity * 10) * 0.15) - result.cash.reservedOpeningNotionalKrw);
      assert.equal(result.assessment.cashHash, hashCanonicalPayload(result.cash));
      assert.equal(result.assessment.budgetsHash, hashCanonicalPayload(result.budgets));
      assert.equal(result.assessment.occupancyAssessmentHash, result.occupancy.assessmentHash);
      assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      for (const value of [result, result.assessment, result.cash, result.budgets, ...result.budgets]) assert.ok(Object.isFrozen(value));
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, bytes = await readFile(path);
      assert.deepEqual(await run(input), result); assert.deepEqual(await readFile(path), bytes);
    });
  });
}

for (const source of ["manual", "selector"] as const) for (const cutoff of [25, 45]) {
  test(`held budget shares cash across all buckets with ${source} unused reservation at ${cutoff}`, async (context) => {
    await fixture(context, source, { count: 0 }, async (state) => {
      const { policy } = await storePolicy(state.dir, false, 800), snapshot = await storeSnapshot(state, context, policy.policyHash, cutoff);
      const result = await run({ baseDir: state.dir, snapshot, policy });
      assert.equal(result.cash.pendingBuyExposureKrw, 0); assert.equal(result.cash.unsubmittedReservedNotionalKrw, 100);
      assert.equal(result.cash.maximumAdditionalNetCashDebitKrw, 100);
      assert.ok(result.budgets.every((item) => item.maximumAdditionalNetCashDebitKrw === 100));
      assert.equal(result.assessment.budgetMeaning, "shared_cash_and_gross_reserved_max_band_upper_bound");
    });
  });
}

for (const [cashKrw, reserve] of [[0, 100], [1000, 900], [1000, 901], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]] as const) {
  test(`held budget safely clamps exhausted cash=${cashKrw} reserve=${reserve}`, async (context) => {
    await fixture(context, "manual", { count: 0 }, async (state) => {
      const { policy } = await storePolicy(state.dir, false, reserve), snapshot = await storeSnapshot(state, context, policy.policyHash, 45, [], cashKrw);
      const result = await run({ baseDir: state.dir, snapshot, policy });
      assert.equal(result.cash.maximumAdditionalNetCashDebitKrw, 0);
      assert.ok(result.budgets.every((item) => item.maximumAdditionalNetCashDebitKrw === 0));
      assert.equal(result.cash.reservedOpeningNotionalKrw, 100);
      assert.equal(result.cash.overcommitted, BigInt(reserve) + 100n > BigInt(cashKrw));
    });
  });
}

for (const [cashKrw, ratio, expected] of [[1, 0.5, 0], [1001, 0.5, 500], [100, 0.29, 29], [Number.MAX_SAFE_INTEGER, 0.5, 4503599627370495]] as const) {
  test(`held budget floors canonical decimal band cash=${cashKrw} ratio=${ratio}`, async (context) => {
    await fixture(context, "selector", { count: 0 }, async (state) => {
      const record = capacityPolicy(false, "floor-boundary", 4, 100, ratio); await storePolicyFixture(state.dir, record);
      const snapshot = await storeSnapshot(state, context, record.policy.policyHash, 45, [], cashKrw);
      const result = await run({ baseDir: state.dir, snapshot, policy: record.policy });
      const day = result.budgets.find((item) => item.bucket === "intraday")!;
      assert.equal(day.maximumExposureKrw, expected); assert.equal(day.remainingMaxBandNotionalKrw, Math.max(0, expected - 100));
      assert.deepEqual(result.budgets, (await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: snapshot.portfolioSnapshotId })).budgets);
    });
  });
}

test("held budget distinguishes max bands from exhausted new-position slots", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const { policy } = await storePolicy(state.dir);
    const snapshot = await storeSnapshot(state, context, policy.policyHash, 45, [position("000660", "swing", 150),
      ...["035420", "035720", "005380", "051910"].map((symbol) => position(symbol, "intraday"))]);
    const result = await run({ baseDir: state.dir, snapshot, policy });
    const swing = result.budgets.find((item) => item.bucket === "swing")!, day = result.budgets.find((item) => item.bucket === "intraday")!;
    assert.equal(swing.maximumExposureKrw, 1270); assert.equal(swing.remainingMaxBandNotionalKrw, 0); assert.equal(swing.overcommitted, true);
    assert.equal(day.availableSlots, 0); assert.equal(day.maximumAdditionalNetCashDebitKrw, 519);
    assert.equal(result.assessment.selectionTriggerAndSizing, "not_evaluated");
  });
});

test("held budget revalidates actual source leases and strict query without manufacturing active policy authority", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const { policy } = capacityPolicy(), snapshot = await storeSnapshot(state, context, policy.policyHash), input = { baseDir: state.dir, snapshot, policy };
    let escaped!: Sources;
    await hold(state.dir, async (sources) => {
      escaped = sources; const result = bind(input, sources);
      assert.equal(result.assessment.policyActivationAuthority, "not_verified");
      assert.equal(result.assessment.actualPortfolioAndValuationAuthority, "not_verified");
      assert.throws(() => bind({ ...input, exemptReservationId: state.manual.root.reservationId } as never, sources));
      assert.throws(() => bind({ ...input, snapshot: { ...snapshot, portfolioSnapshotHash: "f".repeat(64) } }, sources));
      for (const key of Object.keys(sources) as (keyof Sources)[]) assert.throws(() => bind(input, { ...sources, [key]: { ...sources[key] } }), /verified|lease/);
      await assert.rejects(new OpeningCapacityReservationEventFileRepository(state.dir, options).withDurableVerifiedHistory(async () => {}), /lock|timeout/i);
    });
    assert.throws(() => bind(input, escaped), /verified|lease/);
    const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, original = await readFile(path), corrupt = original.subarray(0, -1);
    await writeFile(path, corrupt); await assert.rejects(run(input), /torn final line/); assert.deepEqual(await readFile(path), corrupt);
    await writeFile(path, original); assert.equal((await run(input)).cash.maximumAdditionalNetCashDebitKrw, 750);
    await assert.rejects(resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: snapshot.portfolioSnapshotId }), /active|policy/);
  });
});
