import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { bindHeldSnapshotOpeningCapacity as bind } from "./heldSnapshotOpeningCapacity.js";
import type { OpeningCapacityConsumptionSources as Sources } from "./openingCapacityConsumptionBinding.js";
import { fixture, storePolicy, capacityPolicy, storeSnapshot, position, run as historical } from "./storedSnapshotOpeningCapacityTestFixtures.js";
import { snapshot, HASH, OTHER, START, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { hashCanonicalPayload, hashImmutableRecordLineage } from "./runtimePolicyContracts.js";
import { createManualAssignmentEvent } from "./investmentMandate.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";

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

test("held opening occupancy rejects copied foreign expired sources and malformed queries even without reservations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "held-opening-occupancy-"));
  try {
    const policy = capacityPolicy().policy, query = { baseDir: dir, policy, snapshot: snapshot(policy.policyHash) }; let escaped!: Sources;
    await hold(dir, async (sources) => {
      escaped = sources;
      assert.equal(bind(query, sources).totalReservedOpeningNotionalKrw, 0);
      assert.throws(() => bind({ ...query, trusted: true } as never, sources));
      assert.throws(() => bind({ ...query, policy: { ...policy, policyHash: OTHER } }, sources));
      assert.throws(() => bind({ ...query, snapshot: { ...query.snapshot, portfolioSnapshotHash: OTHER } }, sources));
      await hold(join(dir, "foreign"), async (foreign) => {
        for (const key of Object.keys(sources) as (keyof Sources)[]) {
          assert.throws(() => bind(query, { ...sources, [key]: { ...sources[key] } }), /verified|lease/);
          assert.throws(() => bind(query, { ...sources, [key]: foreign[key] }), /different source path/);
        }
      });
    });
    await hold(dir, async (fresh) => {
      for (const key of Object.keys(fresh) as (keyof Sources)[]) assert.throws(() => bind(query, { ...fresh, [key]: escaped[key] }), /verified|lease/);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const source of ["manual", "selector"] as const) {
  for (const count of [0, 1, 2, 3]) test(`held opening occupancy matches historical ${source} gross and slots after ${count} fills`, async (context) => {
    await fixture(context, source, { count, feeBps: 250 }, async (state) => {
      const { policy } = await storePolicy(state.dir);
      const current = await storeSnapshot(state, context, policy.policyHash, 170, count ? [position("005930", "intraday", [0, 4, 7, 10][count]!)] : []);
      const query = { baseDir: state.dir, snapshot: current, policy }, path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const bytes = await readFile(path), result = await run(query), prior = await historical(state, current);
      assert.deepEqual(result.capacities, prior.capacities); assert.equal(result.totalReservedOpeningNotionalKrw, prior.totalReservedOpeningNotionalKrw);
      const capacity = result.capacities.find((item) => item.bucket === "intraday")!;
      assert.notEqual(policy.policyHash, HASH); assert.equal(capacity.availableSlots, 3);
      assert.equal(capacity.reservedOpeningNotionalKrw, [100, 60, 30, 0][count]);
      assert.equal(capacity.pendingBuyNotionalKrw, capacity.reservedOpeningNotionalKrw);
      assert.equal(capacity.activePositionCount, count ? 1 : 0); assert.equal(capacity.pendingReservationCount, count ? 0 : 1);
      assert.equal(result.assessment.policyActivationAuthority, "not_verified");
      assert.equal(result.assessment.currentExecutionAuthority, "not_granted");
      assert.equal(result.assessment.capacitiesHash, hashCanonicalPayload(result.capacities));
      for (const value of [result, result.capacities, capacity, result.assessment]) assert.ok(Object.isFrozen(value));
      assert.deepEqual(await run(query), result); assert.deepEqual(await readFile(path), bytes);
    });
  });
  for (const cutoff of [25, 45, 100]) test(`held opening occupancy preserves ${source} cutoff head=${cutoff}`, async (context) => {
    await fixture(context, source, { count: 2 }, async (state) => {
      const { policy } = await storePolicy(state.dir), current = await storeSnapshot(state, context, policy.policyHash, cutoff);
      const result = await run({ baseDir: state.dir, snapshot: current, policy });
      assert.deepEqual(result.capacities, (await historical(state, current)).capacities);
      const capacity = result.capacities.find((item) => item.bucket === "intraday")!;
      assert.equal(capacity.reservedOpeningNotionalKrw, cutoff === 100 ? 60 : 100);
      assert.equal(capacity.pendingReservationCount, cutoff === 25 ? 1 : 0);
      assert.equal(capacity.mandateBoundUnusedSlotCount, cutoff === 45 ? 1 : 0);
    });
  });
}

test("held opening occupancy does not manufacture active policy authority or default legacy limits", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const { policy } = capacityPolicy(), current = await storeSnapshot(state, context, policy.policyHash);
    // The supplied policy is deliberately not stored/activated. This helper must not claim that authority.
    const result = await run({ baseDir: state.dir, snapshot: current, policy });
    assert.equal(result.assessment.policyActivationAuthority, "not_verified");
    await assert.rejects(historical(state, current), /active|policy/);
    const legacy = capacityPolicy(true).policy;
    await assert.rejects(run({ baseDir: state.dir, snapshot: await storeSnapshot(state, context, legacy.policyHash), policy: legacy }), /explicit policy limits/);
    await assert.rejects(run({ baseDir: state.dir, snapshot: current, policy: legacy }), /supplied policy scope/);
    const future = { ...policy, createdAt: at(180), lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy",
      recordId: policy.runtimePolicyRecordId, semanticHash: policy.policyHash, createdAt: at(180) }) };
    await assert.rejects(run({ baseDir: state.dir, snapshot: current, policy: future }), /supplied policy scope or chronology/);
  });
});

for (const increase of [false, true]) test(`held opening occupancy preserves occupied holdings and clamps slots increase=${increase}`, async (context) => {
  await fixture(context, "manual", { count: 0, increase }, async (state) => {
    const { policy } = capacityPolicy();
    const positions = (increase ? ["005930"] : ["000660", "035420", "035720", "005380"]).map((symbol) => position(symbol, "intraday"));
    const current = await storeSnapshot(state, context, policy.policyHash, 170, positions);
    const result = await run({ baseDir: state.dir, snapshot: current, policy }), capacity = result.capacities.find((item) => item.bucket === "intraday")!;
    assert.equal(capacity.activePositionCount, increase ? 1 : 4);
    assert.equal(capacity.pendingReservationCount, increase ? 0 : 1);
    assert.equal(capacity.mandateBoundUnusedSlotCount, 0);
    assert.equal(capacity.availableSlots, increase ? 3 : 0);
    assert.equal(capacity.reservedOpeningNotionalKrw, 100); assert.equal(capacity.pendingBuyNotionalKrw, 100);
  });
});

for (const positions of [[position("000660")], [position("000660", "swing"), position("000660", "long_term")], [position("005930", "intraday")]]) {
  test(`held opening occupancy rejects invalid holding membership ${JSON.stringify(positions.map((item) => [item.symbol, item.strategyBucket]))}`, async (context) => {
    await fixture(context, "selector", { count: 0 }, async (state) => {
      const { policy } = capacityPolicy(), current = await storeSnapshot(state, context, policy.policyHash, 170, positions);
      await assert.rejects(run({ baseDir: state.dir, snapshot: current, policy }), /unassigned holdings|repeats a held instrument|repeats a new-position instrument/);
    });
  });
}

for (const sameSlot of [true, false]) test(`held opening occupancy rejects actual root collision sameSlot=${sameSlot}`, async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    if (!("source" in state.manual)) throw new Error("manual fixture required");
    const { policy } = capacityPolicy(); context.mock.timers.setTime(START + 60);
    const { manualAssignmentEventId: _eventId, manualAssignmentEventHash: _eventHash, ...manualPayload } = state.manual.source;
    const manual = createManualAssignmentEvent({ ...manualPayload, authorizationRef: "another-authorization", symbol: sameSlot ? "000660" : "005930" });
    await new ManualAssignmentFileRepository(state.dir).append(manual);
    const { manualCapacityReservationId: _id, manualCapacityReservationHash: _hash, ...payload } = state.manual.record;
    const reservation = createManualOpeningCapacityReservationRecord({ ...payload, reservationKind: "new_position",
      manualAssignmentEventId: manual.manualAssignmentEventId, manualAssignmentEventHash: manual.manualAssignmentEventHash,
      authorizationRef: manual.authorizationRef, symbol: manual.symbol, reservedSlotOrdinal: sameSlot ? 0 : 1, capacityLedgerVersion: 3, createdAt: at(60) });
    await new ManualOpeningCapacityReservationFileRepository(state.dir).append(reservation);
    context.mock.timers.setTime(START + 70);
    await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({ eventType: "reserved",
      portfolioId: reservation.portfolioId, policyHash: reservation.policyHash, bucket: reservation.bucket,
      reservationId: reservation.manualCapacityReservationId, reservationHash: reservation.manualCapacityReservationHash,
      reservationSource: { sourceKind: "manual", manualCapacityReservationId: reservation.manualCapacityReservationId,
        manualCapacityReservationHash: reservation.manualCapacityReservationHash }, capacityLedgerVersion: 3,
      remainingReservedNotionalKrw: reservation.reservedMaximumNotionalKrw, occupiesNewPositionSlot: true, asOf: at(70), createdAt: at(70) }));
    await assert.rejects(run({ baseDir: state.dir, snapshot: await storeSnapshot(state, context, policy.policyHash), policy }),
      sameSlot ? /repeats an occupied slot ordinal/ : /repeats a new-position instrument/);
  });
});

test("held opening occupancy rejects corruption without repair and keeps source locks until callback exit", async (context) => {
  await fixture(context, "manual", { count: 0 }, async (state) => {
    const { policy } = capacityPolicy(), current = await storeSnapshot(state, context, policy.policyHash), query = { baseDir: state.dir, snapshot: current, policy };
    const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, original = await readFile(path), damaged = original.subarray(0, -1);
    await writeFile(path, damaged); await assert.rejects(run(query), /torn final line/); assert.deepEqual(await readFile(path), damaged);
    await writeFile(path, original);
    await assert.rejects(hold(state.dir, async (sources) => {
      assert.equal(bind(query, sources).totalReservedOpeningNotionalKrw, 100);
      context.mock.timers.setTime(START + 199);
      assert.throws(() => bind(query, sources), /clock moved backwards/);
      context.mock.timers.setTime(START + 200);
      await assert.rejects(new OpeningCapacityReservationEventFileRepository(state.dir, options).withDurableVerifiedHistory(async () => {}), /lock|timeout/i);
      throw new Error("synthetic consumer failure");
    }), /consumer failure/);
    assert.equal((await run(query)).totalReservedOpeningNotionalKrw, 100);
  });
});
