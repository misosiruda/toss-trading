import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { fixture as manualFixture } from "./storedManualOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotOpeningBudget } from "./storedSnapshotOpeningBudget.js";
import { capacityPolicy, storePolicy, position, storeSnapshot, fixture } from "./storedSnapshotOpeningCapacityTestFixtures.js";

test("stored opening budget subtracts pending and unused reservations exactly once across manual and selector fills", async (context) => {
  for (const source of ["manual", "selector"] as const) for (const count of [0, 1, 2, 3]) {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const policy = await storePolicy(state.dir), quantity = [0, 4, 7, 10][count]!;
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, 170,
        quantity ? [position("005930", "intraday", quantity)] : []);
      const result = await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      const bucket = result.budgets.find((item) => item.bucket === "intraday")!;
      const reserved = [100, 60, 30, 0][count]!;
      assert.equal(result.cash.reservedOpeningNotionalKrw, reserved);
      assert.equal(result.cash.pendingBuyExposureKrw, reserved);
      assert.equal(result.cash.unsubmittedReservedNotionalKrw, 0);
      assert.equal(result.cash.maximumAdditionalNetCashDebitKrw, 1000 - Math.round((1000 + quantity * 10) * 0.15) - reserved);
      assert.equal(bucket.remainingMaxBandNotionalKrw, Math.round((1000 + quantity * 10) * 0.5) - quantity * 10 - reserved);
      assert.equal(bucket.maximumAdditionalNetCashDebitKrw, bucket.remainingMaxBandNotionalKrw);
      assert.equal(result.assessment.occupancyAssessmentHash, result.occupancy.assessmentHash);
      assert.equal(result.assessment.cashHash, hashCanonicalPayload(result.cash));
      assert.equal(result.assessment.budgetsHash, hashCanonicalPayload(result.budgets));
      assert.equal(result.assessmentHash, hashCanonicalPayload(result.assessment));
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      assert.equal(result.assessment.selectionTriggerAndSizing, "not_evaluated");
      assert.ok(Object.isFrozen(result.cash)); assert.ok(Object.isFrozen(result.budgets)); assert.ok(Object.isFrozen(bucket));
    });
  }
});

test("stored opening budget shares cash across buckets and includes unsubmitted unbound and bound reservations", async (context) => {
  for (const source of ["manual", "selector"] as const) await fixture(context, source, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir, false, 800);
    for (const cutoff of [25, 45]) {
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, cutoff);
      const result = await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      assert.equal(result.cash.pendingBuyExposureKrw, 0);
      assert.equal(result.cash.unsubmittedReservedNotionalKrw, 100);
      assert.equal(result.cash.maximumAdditionalNetCashDebitKrw, 100);
      assert.ok(result.budgets.every((item) => item.maximumAdditionalNetCashDebitKrw === 100));
      assert.equal(result.budgets.find((item) => item.bucket === "intraday")!.remainingMaxBandNotionalKrw, 400);
      assert.equal(result.budgets.find((item) => item.bucket === "swing")!.remainingMaxBandNotionalKrw, 500);
      assert.equal(result.cash.overcommitted, false);
    }
  });
});

test("stored opening budget clamps cash exhaustion and safe integer extremes without releasing reservations", async (context) => {
  for (const [cashKrw, reserve] of [[0, 100], [1000, 900], [1000, 901], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]]) {
    await manualFixture(context, { count: 0 }, async (state) => {
      const policy = await storePolicy(state.dir, false, reserve);
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, 45, [], cashKrw);
      const result = await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      assert.equal(result.cash.maximumAdditionalNetCashDebitKrw, 0);
      assert.ok(result.budgets.every((item) => item.maximumAdditionalNetCashDebitKrw === 0));
      assert.equal(result.cash.reservedOpeningNotionalKrw, 100);
      assert.equal(result.cash.overcommitted, BigInt(reserve!) + 100n > BigInt(cashKrw!));
    });
  }
});

test("stored opening budget applies max bands independently of target gaps and available new position slots", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    const stored = await storeSnapshot(state, context, policy.policy.policyHash, 45, [position("000660", "swing", 150),
      ...["035420", "035720", "005380", "051910"].map((symbol) => position(symbol, "intraday"))]);
    const result = await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
    const swing = result.budgets.find((item) => item.bucket === "swing")!;
    const day = result.budgets.find((item) => item.bucket === "intraday")!;
    assert.equal(swing.maximumExposureKrw, 1270);
    assert.equal(swing.positionExposureKrw, 1500);
    assert.equal(swing.remainingMaxBandNotionalKrw, 0);
    assert.equal(swing.overcommitted, true);
    assert.equal(day.availableSlots, 0);
    assert.equal(day.maximumAdditionalNetCashDebitKrw, 519);
    assert.equal(result.assessment.currentLedgerAndCasAuthority, "not_verified");
  });
});

test("stored opening budget preserves strict captured lookup and rejects corrupt actual reservation sources", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const input = { baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId };
    const pending = resolveStoredSnapshotOpeningBudget(input);
    input.baseDir = "missing"; input.portfolioSnapshotId = "missing";
    assert.equal((await pending).cash.maximumAdditionalNetCashDebitKrw, 750);
    await assert.rejects(resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId,
      exemptReservationId: state.manual.root.reservationId } as never));
    const { eventsPath } = createOpeningCapacityReservationEventPaths(state.dir);
    const corrupt = (await readFile(eventsPath)).subarray(0, -1);
    await writeFile(eventsPath, corrupt);
    await assert.rejects(resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId }), /torn final line/);
    assert.deepEqual(await readFile(eventsPath), corrupt);
  });
});

test("stored opening budget floors exact canonical decimal max weight ceilings", async (context) => {
  for (const [cashKrw, ratio, expected] of [[1, 0.5, 0], [1001, 0.5, 500], [100, 0.29, 29],
    [Number.MAX_SAFE_INTEGER, 0.5, 4503599627370495]] as const) {
    await manualFixture(context, { count: 0 }, async (state) => {
      const policy = capacityPolicy(false, "floor-boundary", 4, 100, ratio);
      await storePolicyFixture(state.dir, policy);
      const stored = await storeSnapshot(state, context, policy.policy.policyHash, 45, [], cashKrw);
      const result = await resolveStoredSnapshotOpeningBudget({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
      const day = result.budgets.find((item) => item.bucket === "intraday")!;
      assert.equal(day.maximumExposureKrw, expected);
      assert.equal(day.remainingMaxBandNotionalKrw, Math.max(0, expected - 100));
      assert.equal(day.maximumAdditionalNetCashDebitKrw, Math.min(result.cash.maximumAdditionalNetCashDebitKrw, Math.max(0, expected - 100)));
    });
  }
});
