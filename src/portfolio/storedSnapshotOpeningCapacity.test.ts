import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import { type VirtualPosition } from "../domain/schemas.js";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { pendingActionExposureTotals } from "./portfolioSizingInputs.js";
import { hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { HASH, START, PORTFOLIO, AT, at, snapshot, fixture as manualFixture,
  type State as ManualState, type Options } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture, type SelectorCapacityState } from "./storedSelectorOpeningCapacityTestFixtures.js";
import { resolveStoredSnapshotOpeningCapacity } from "./storedSnapshotOpeningCapacity.js";
import { resolveStoredSnapshotOpeningBudget } from "./storedSnapshotOpeningBudget.js";

type State = ManualState | SelectorCapacityState;
const run = (state: State, stored: Awaited<ReturnType<typeof storeSnapshot>>) =>
  resolveStoredSnapshotOpeningCapacity({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId });
const intraday = (result: Awaited<ReturnType<typeof run>>) => result.capacities.find((item) => item.bucket === "intraday")!;

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

test("stored opening occupancy rejects missing explicit policy limits and an inactive snapshot policy", async (context) => {
  for (const legacy of [true, false]) await fixture(context, "manual", { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir, legacy);
    const stored = await storeSnapshot(state, context, legacy ? policy.policy.policyHash : HASH);
    await assert.rejects(run(state, stored), legacy ? /explicit policy limits/ : /active policy mismatch/);
  });
});

test("stored opening occupancy rejects unassigned duplicate-bucket and already-held new-position instruments", async (context) => {
  for (const positions of [[position("000660")], [position("000660", "swing"), position("000660", "long_term")], [position("005930", "intraday")]]) {
    await fixture(context, "selector", { count: 0 }, async (state) => {
      const policy = await storePolicy(state.dir);
      await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash, 170, positions)),
        /unassigned holdings|repeats a held instrument|repeats a new-position instrument/);
    });
  }
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

test("stored opening occupancy rejects corrupt reservation history and leaves its bytes untouched", async (context) => {
  await fixture(context, "selector", { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const { eventsPath } = createOpeningCapacityReservationEventPaths(state.dir);
    const corrupt = (await readFile(eventsPath)).subarray(0, -1);
    await writeFile(eventsPath, corrupt);
    await assert.rejects(run(state, stored), /torn final line/);
    assert.deepEqual(await readFile(eventsPath), corrupt);
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

test("stored opening occupancy rejects actual-source reservations that reuse a slot or instrument", async (context) => {
  for (const sameSlot of [true, false]) await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    context.mock.timers.setTime(START + 60);
    const { manualAssignmentEventId: _eventId, manualAssignmentEventHash: _eventHash, ...manualPayload } = state.manual.source;
    const manual = createManualAssignmentEvent({ ...manualPayload, authorizationRef: "another-authorization", symbol: sameSlot ? "000660" : "005930" });
    await new ManualAssignmentFileRepository(state.dir).append(manual);
    const { manualCapacityReservationId: _id, manualCapacityReservationHash: _hash, ...payload } = state.manual.record;
    const reservation = createManualOpeningCapacityReservationRecord({ ...payload, reservationKind: "new_position",
      manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
      authorizationRef: manual.authorizationRef, symbol: manual.symbol, reservedSlotOrdinal: sameSlot ? 0 : 1, capacityLedgerVersion: 3, createdAt: at(60) });
    await new ManualOpeningCapacityReservationFileRepository(state.dir).append(reservation);
    context.mock.timers.setTime(START + 70);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "reserved", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: reservation.manualCapacityReservationId, reservationHash: reservation.manualCapacityReservationHash,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
        manualCapacityReservationHash: reservation.manualCapacityReservationHash }, capacityLedgerVersion: 3,
      remainingReservedNotionalKrw: reservation.reservedMaximumNotionalKrw, occupiesNewPositionSlot: true, asOf: at(70), createdAt: at(70)
    }));
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash)),
      sameSlot ? /repeats an occupied slot ordinal/ : /repeats a new-position instrument/);
  });
});

test("stored opening occupancy rejects unverified request cancellation even without pending BUY", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), { eventsPath } = createOpeningCapacityReservationEventPaths(state.dir);
    const lines = (await readFile(eventsPath, "utf8")).trimEnd().split("\n");
    await writeFile(eventsPath, `${lines.slice(0, 2).join("\n")}\n`);
    context.mock.timers.setTime(START + 50);
    const root = state.manual.root;
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "released", portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday",
      reservationId: root.reservationId, reservationHash: root.reservationHash,
      previousCapacityReservationEventId: root.capacityReservationEventId, capacityLedgerVersion: 2,
      remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false,
      releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "unverified-cancellation" },
      releaseReasonCode: "fixture_cancel", asOf: at(50), createdAt: at(50)
    }));
    const before = await readFile(eventsPath);
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash, 60)), /lacks a verified source/);
    assert.deepEqual(await readFile(eventsPath), before);
  });
});

test("stored opening occupancy captures its strict query before asynchronous policy loading", async (context) => {
  await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir), stored = await storeSnapshot(state, context, policy.policy.policyHash);
    const input = { baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId };
    const result = resolveStoredSnapshotOpeningCapacity(input);
    input.portfolioSnapshotId = "missing"; input.baseDir = "missing";
    assert.equal(intraday(await result).availableSlots, 3);
    await assert.rejects(resolveStoredSnapshotOpeningCapacity({ baseDir: state.dir, portfolioSnapshotId: stored.portfolioSnapshotId, trusted: true } as never));
  });
});

test("stored opening occupancy rejects unsafe bucket and portfolio sums across distinct policy ledgers", async (context) => {
  for (const bucket of ["intraday", "swing"] as const) await manualFixture(context, { count: 0 }, async (state) => {
    const policy = await storePolicy(state.dir);
    context.mock.timers.setTime(START + 60);
    const oldHash = `sha256:${"c".repeat(64)}`, origin = snapshot(oldHash);
    await new PortfolioSizingSnapshotFileRepository(state.dir).append(origin);
    const { manualAssignmentEventId: _eventId, manualAssignmentEventHash: _eventHash, ...manualPayload } = state.manual.source;
    const manual = createManualAssignmentEvent({ ...manualPayload, policyHash: oldHash, bucket, symbol: "000660",
      authorizationScope: "open_or_increase", authorizationRef: "overflow-fixture", maximumNotionalKrw: Number.MAX_SAFE_INTEGER,
      portfolioSnapshotId: origin.portfolioSnapshotId, portfolioSnapshotHash: origin.portfolioSnapshotHash } as Parameters<typeof createManualAssignmentEvent>[0]);
    await new ManualAssignmentFileRepository(state.dir).append(manual);
    const reservation = createManualOpeningCapacityReservationRecord({ reservationKind: "new_position", portfolioId: PORTFOLIO,
      policyHash: oldHash, bucket, market: "KR", symbol: manual.symbol, authorizationRef: manual.authorizationRef,
      manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
      currentPortfolioSnapshotId: origin.portfolioSnapshotId, currentPortfolioSnapshotHash: origin.portfolioSnapshotHash,
      reservedSlotOrdinal: 0, capacityLedgerVersion: 1, reservedMaximumNotionalKrw: Number.MAX_SAFE_INTEGER,
      resultingReservedNotionalKrw: Number.MAX_SAFE_INTEGER, createdAt: at(60) });
    await new ManualOpeningCapacityReservationFileRepository(state.dir).append(reservation);
    context.mock.timers.setTime(START + 70);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({
      eventType: "reserved", portfolioId: PORTFOLIO, policyHash: oldHash, bucket,
      reservationId: reservation.manualCapacityReservationId, reservationHash: reservation.manualCapacityReservationHash,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
        manualCapacityReservationHash: reservation.manualCapacityReservationHash }, capacityLedgerVersion: 1,
      remainingReservedNotionalKrw: Number.MAX_SAFE_INTEGER, occupiesNewPositionSlot: true, asOf: at(70), createdAt: at(70) }));
    await assert.rejects(run(state, await storeSnapshot(state, context, policy.policy.policyHash)),
      bucket === "intraday" ? /reserved totals are unsafe/ : /portfolio reserved total is unsafe/);
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

function capacityPolicy(legacy = false, version = "opening.v1", maximumPositionCount = 4, minimumCashReserveKrw = 100, intradayMaxWeightRatio = 0.5) {
  const fixture = policyFixture();
  const { runtimePolicyRecordId: _id, policyHash: _hash, lineageHash: _lineage, createdAt, ...base } = fixture.policy;
  const payload = { ...base, portfolioId: PORTFOLIO, version, cashPolicy: { ...base.cashPolicy, minimumCashReserveKrw },
    strategyBuckets: base.strategyBuckets.map((bucket) => ({ ...bucket,
      maxWeightRatio: bucket.bucket === "intraday" ? intradayMaxWeightRatio : bucket.maxWeightRatio, ...(legacy ? {} : {
      openingCapacityPolicy: { modelVersion: "bucket_opening_capacity_policy.v1" as const, maximumPositionCount }
    }) })) };
  const policyHash = hashCanonicalPayload(payload), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, runtimePolicyRecordId, policyHash, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  return { ...fixture, policy };
}
async function storePolicy(directory: string, legacy = false, minimumCashReserveKrw = 100) {
  const fixture = capacityPolicy(legacy, "opening.v1", 4, minimumCashReserveKrw);
  await storePolicyFixture(directory, fixture);
  return fixture;
}
function position(symbol: string, strategyBucket?: VirtualPosition["strategyBucket"], quantity = 1): VirtualPosition {
  return { market: "KR", symbol, quantity, averagePriceKrw: 10, region: "KR", sector: "Technology", updatedAt: AT,
    ...(strategyBucket === undefined ? {} : { strategyBucket }) };
}
async function storeSnapshot(state: State, context: TestContext, policyHash: string, cutoff = 170, positions: VirtualPosition[] = [], cashKrw = 1000) {
  context.mock.timers.setTime(START + 200);
  const progress = await resolveStoredPendingPlanActionProgress({ baseDir: state.dir, portfolioId: PORTFOLIO, asOf: at(cutoff) });
  const inputs = progress.projection.pendingActions.map((item) => ({ planId: item.planId, planHash: item.planHash,
    planEventId: item.planEventId, planEventHash: item.planEventHash, actionId: item.action.actionId, actionExecutionTargetHash: item.actionExecutionTargetHash,
    market: item.action.market, symbol: item.action.symbol, side: "BUY" as const, remainingNotionalKrw: item.remainingTargetNotionalKrw!, asOf: at(cutoff),
    openingCapacityReservationId: state.manual.bound.reservationId, openingCapacityReservationHash: state.manual.bound.reservationHash }));
  const base = snapshot(policyHash), exposure = base.exposureSnapshot;
  const total = positions.reduce((sum, item) => sum + item.quantity * 10, 0);
  const bucketExposureKrw = { ...exposure.bucketExposureKrw };
  const symbols = new Map<string, number>();
  let unassigned = 0;
  for (const item of positions) {
    if (item.strategyBucket) bucketExposureKrw[item.strategyBucket] += item.quantity * 10; else unassigned += item.quantity * 10;
    symbols.set(item.symbol, (symbols.get(item.symbol) ?? 0) + item.quantity * 10);
  }
  const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = base;
  return new PortfolioSizingSnapshotFileRepository(state.dir).append(createPortfolioSizingSnapshot({ ...payload, asOf: at(cutoff),
    portfolioVersion: "opening-snapshot", virtualPortfolio: { ...base.virtualPortfolio, cashKrw, positions, updatedAt: at(cutoff) }, pendingActionInputs: inputs,
    valuationInputs: [...symbols.keys()].map((symbol) => ({ kind: "mark_price", market: "KR", symbol, priceKrw: 10, evidenceRef: "fixture-mark", evidenceAsOf: AT })),
    ...createPortfolioExposureSnapshot({ ...exposure, cashKrw, virtualNetWorthKrw: cashKrw + total, bucketExposureKrw,
      ...(unassigned ? { unassignedExposureKrw: unassigned } : {}), symbolExposureKrw: [...symbols].filter(([, amount]) => amount > 0)
        .map(([symbol, exposureKrw]) => ({ market: "KR", symbol, exposureKrw })), marketExposureKrw: { KR: total, US: 0 },
      sectorExposureKrw: total ? { Technology: total } : {}, countryExposureKrw: total ? { KR: total } : {}, currencyExposureKrw: total ? { KRW: total } : {},
      ...pendingActionExposureTotals(inputs) }) }));
}
async function fixture(context: TestContext, source: "manual" | "selector", options: Options, operation: (state: State) => Promise<void>) {
  if (source === "manual") await manualFixture(context, options, operation); else await selectorFixture(context, options, operation);
}
