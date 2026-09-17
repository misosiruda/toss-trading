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
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { bindHeldSnapshotPendingReservationOrigins as bind } from "./heldSnapshotPendingReservationBinding.js";
import type { OpeningCapacityConsumptionSources as Sources } from "./openingCapacityConsumptionBinding.js";
import { createPortfolioSizingSnapshot, type PortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { fixture, storeSnapshot, appendOtherPlan } from "./snapshotPendingReservationTestFixtures.js";
import { snapshot, OTHER, START, at, PORTFOLIO, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";
import { projectHeldPendingPlanActionProgress, resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";
import { fixture as pendingFixture, request, options, at as pendingAt } from "./currentSizingPendingTestFixtures.js";
import { appendCurrentPortfolioSizingSnapshot } from "./currentPortfolioSizingSnapshotFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

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
const run = (baseDir: string, snapshot: PortfolioSizingSnapshot) => hold(baseDir, async (sources) => bind({ baseDir, snapshot }, sources));
function replacePending(record: PortfolioSizingSnapshot, pendingActionInputs: readonly PendingPortfolioActionInput[]) {
  const { portfolioSnapshotId: _id, portfolioSnapshotHash: _hash, ...payload } = record;
  return createPortfolioSizingSnapshot({ ...payload, pendingActionInputs,
    ...createPortfolioExposureSnapshot({ ...record.exposureSnapshot, ...pendingActionExposureTotals(pendingActionInputs) }) });
}

test("held pending reservations reject copied foreign expired and historical sources and noncanonical queries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "held-pending-reservation-"));
  try {
    const input = { baseDir: dir, snapshot: snapshot() }; let expired!: Sources;
    await hold(dir, async (sources) => {
      expired = sources; assert.deepEqual(bind(input, sources).bindings, []);
      assert.throws(() => bind({ ...input, trusted: true } as never, sources));
      assert.throws(() => bind({ ...input, snapshot: { ...input.snapshot, portfolioSnapshotHash: OTHER } }, sources));
      await hold(join(dir, "foreign"), async (foreign) => {
        for (const key of Object.keys(sources) as (keyof Sources)[]) {
          assert.throws(() => bind(input, { ...sources, [key]: { ...sources[key] } }), /verified|lease/);
          assert.throws(() => bind(input, { ...sources, [key]: foreign[key] }), /different source path/);
        }
      });
    });
    await hold(dir, async (fresh) => {
      for (const key of Object.keys(fresh) as (keyof Sources)[]) assert.throws(() => bind(input, { ...fresh, [key]: expired[key] }), /verified|lease/);
    });
    const history = await new RebalancePlanEventFileRepository(dir, new RebalancePlanFileRepository(dir)).readDurableVerifiedHistory();
    assert.throws(() => projectHeldPendingPlanActionProgress({ baseDir: dir, portfolioId: PORTFOLIO, asOf: input.snapshot.asOf }, history), /lease/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const kind of ["manual", "selector"] as const) {
  for (const count of [0, 1, 2, 3]) test(`held pending reservations bind ${kind} remaining gross after ${count} fills across restart`, async (context) => {
    await fixture(context, kind, { count, feeBps: 250 }, async (state) => {
      const current = await storeSnapshot(state, context, { policyHash: OTHER }), path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const bytes = await readFile(path), result = await run(state.dir, current);
      assert.equal(result.bindings.length, count === 3 ? 0 : 1);
      if (count !== 3) {
        assert.equal(result.bindings[0]!.reservation.sourceKind, kind);
        assert.equal(result.bindings[0]!.priorConsumptionOrigins.length, count);
        assert.equal(result.reservationTotals[0]!.pendingNotionalKrw, [100, 60, 30][count]);
        assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, [100, 60, 30][count]);
      }
      const historical = await resolveStoredPendingPlanActionProgress({ baseDir: state.dir, portfolioId: PORTFOLIO, asOf: current.asOf });
      assert.deepEqual(result.progress, historical);
      assert.deepEqual(await run(state.dir, current), result); assert.deepEqual(await readFile(path), bytes);
      for (const item of [result, result.bindings, result.reservationTotals]) assert.ok(Object.isFrozen(item));
    });
  });
  for (const mode of ["missing", "ambiguous", "before_consumption"] as const) test(`held pending reservations reject ${kind} ${mode} consumption at cutoff`, async (context) => {
    await fixture(context, kind, { count: 1 }, async (state) => {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      if (mode === "missing") {
        const rows = (await readFile(path, "utf8")).trimEnd().split("\n");
        await writeFile(path, rows.slice(0, -2).join("\n") + "\n");
      }
      const current = await storeSnapshot(state, context, { cutoff: mode === "ambiguous" ? 95 : mode === "before_consumption" ? 93 : 170 });
      const bytes = await readFile(path);
      await assert.rejects(run(state.dir, current), /ambiguous at cutoff|prior execution lacks its actual reservation consumption/);
      assert.deepEqual(await readFile(path), bytes);
    });
  });
  test(`held pending reservations aggregate all ${kind} actions sharing a reservation`, async (context) => {
    await fixture(context, kind, { count: 0 }, async (state) => {
      await appendOtherPlan(state, context);
      await assert.rejects(run(state.dir, await storeSnapshot(state, context, { cutoff: 190 })), /exceeds remaining reservation gross/);
    });
  });
  test(`held pending reservations preserve ${kind} historical balances before later actual consumption`, async (context) => {
    await fixture(context, kind, { count: 2 }, async (state) => {
      const result = await run(state.dir, await storeSnapshot(state, context, { cutoff: 100 }));
      assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, 60);
      assert.equal(result.bindings[0]!.priorConsumptionOrigins.length, 1);
      assert.equal(state.capacity.at(-1)!.remainingReservedNotionalKrw, 30);
    });
  });
  test(`held pending reservations preserve ${kind} historical head before retirement but reject its later pending BUY`, async (context) => {
    await fixture(context, kind, { count: 1 }, async (state) => {
      const mandates = new InvestmentMandateFileRepository(state.dir), active = (await mandates.readSnapshot()).events[0]!;
      const retired = mandateEvent(state.manual.mandate, "retired", 160, active.mandateEventId);
      context.mock.timers.setTime(START + 160); await mandates.appendEvent(retired);
      const prior = state.capacity[0]!;
      context.mock.timers.setTime(START + 165);
      await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({ eventType: "released",
        portfolioId: prior.portfolioId, policyHash: prior.policyHash, bucket: prior.bucket, reservationId: prior.reservationId, reservationHash: prior.reservationHash,
        previousCapacityReservationEventId: prior.capacityReservationEventId, capacityLedgerVersion: prior.capacityLedgerVersion + 1,
        remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(165), createdAt: at(165), releaseReasonCode: "retired",
        releaseOrigin: { originKind: "mandate_terminal", mandateId: retired.mandateId, mandateHash: retired.mandateHash,
          mandateEventId: retired.mandateEventId, mandateEventHash: retired.mandateEventHash } }));
      const result = await run(state.dir, await storeSnapshot(state, context, { cutoff: 100 }));
      assert.equal(result.reservationTotals[0]!.remainingReservedNotionalKrw, 60);
      assert.equal(result.terminal.bindings.length, 1);
      await assert.rejects(run(state.dir, await storeSnapshot(state, context)), /investment mandate is required|active opening mandate/);
    });
  });
  test(`held pending reservations reconstruct ${kind} membership gross and lineage instead of trusting supplied claims`, async (context) => {
    await fixture(context, kind, { count: 1 }, async (state) => {
      const current = await storeSnapshot(state, context), pending = current.pendingActionInputs[0]!;
      await assert.rejects(run(state.dir, replacePending(current, [])), /set is incomplete/);
      await assert.rejects(run(state.dir, replacePending(current, [{ ...pending, remainingNotionalKrw: 59 }])), /remaining gross notional mismatch/);
      if (pending.side !== "BUY") throw new Error("BUY fixture required");
      await assert.rejects(run(state.dir, replacePending(current, [{ ...pending, openingCapacityReservationHash: OTHER }])), /reservation differs from stored mandate/);
      await hold(state.dir, async (sources) => {
        assert.throws(() => projectHeldPendingPlanActionProgress({ baseDir: state.dir, portfolioId: PORTFOLIO, asOf: at(201) }, sources.planEvents), /cutoff follows/);
        context.mock.timers.setTime(START + 199);
        assert.throws(() => bind({ baseDir: state.dir, snapshot: current }, sources), /clock moved backwards/);
        context.mock.timers.setTime(START + 200);
      });
    });
  });
  test(`held pending reservations reject ${kind} unbound roots and unverified cancellation without mutation`, async (context) => {
    await fixture(context, kind, { count: 0 }, async (state) => {
      const current = await storeSnapshot(state, context, { cutoff: 190 }), path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const rows = (await readFile(path, "utf8")).trimEnd().split("\n");
      await writeFile(path, rows.slice(0, 2).join("\n") + "\n");
      const unbound = await readFile(path);
      await assert.rejects(run(state.dir, current), /reservation or mandate lineage mismatch/);
      assert.deepEqual(await readFile(path), unbound);
      const root = state.manual.root;
      context.mock.timers.setTime(START + 180);
      await new OpeningCapacityReservationEventFileRepository(state.dir).append(createOpeningCapacityReservationEvent({ eventType: "released",
        portfolioId: root.portfolioId, policyHash: root.policyHash, bucket: root.bucket, reservationId: root.reservationId, reservationHash: root.reservationHash,
        previousCapacityReservationEventId: root.capacityReservationEventId, capacityLedgerVersion: 2, remainingReservedNotionalKrw: 0,
        occupiesNewPositionSlot: false, asOf: at(180), createdAt: at(180), releaseReasonCode: "cancelled",
        releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "unverified" } }));
      context.mock.timers.setTime(START + 200); const cancelled = await readFile(path);
      await assert.rejects(run(state.dir, current), /cannot accept unverified cancellation releases/);
      assert.deepEqual(await readFile(path), cancelled);
    });
  });
}

for (const mandateState of ["proposed", "review_required", "retired"] as const) test(`held pending reservations reject ${mandateState} BUY mandates`, async (context) => {
  await fixture(context, "manual", { count: 0, mandateState }, async (state) => {
    await assert.rejects(run(state.dir, await storeSnapshot(state, context)), /active opening mandate|investment mandate is required/);
  });
});
for (const kind of ["fractional_sell", "whole_sell"] as const) test(`held pending reservations preserve ${kind} execution validation without opening reservation authority`, async (context) => {
  await pendingFixture(context, kind, async (state) => {
    const current = await appendCurrentPortfolioSizingSnapshot(request(state), options);
    const result = await run(state.baseDir, current);
    assert.equal(result.pending.length, 1); assert.equal(result.executions.length, 1);
    assert.deepEqual(result.bindings, []); assert.deepEqual(result.reservationTotals, []);
  }, { reduceOnly: true, completion: true });
});

for (const offset of [40, 41]) test(`held pending reservations reject SELL completion at or after execution offset=${offset}`, async (context) => {
  await pendingFixture(context, "fractional_sell", async (state) => {
    const current = await appendCurrentPortfolioSizingSnapshot(request(state), options), path = createPaperFillExecutionPaths(state.baseDir).recordsPath;
    const original = await readFile(path, "utf8"), lines = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { completionHash: _hash, ...completion } = lines.at(-1)!;
    assert.equal(completion.schemaVersion, "paper_fill_execution_completion.v1");
    const payload = { ...completion, completedAt: pendingAt(offset) };
    const damaged = [...lines.slice(0, -1), { ...payload, completionHash: hashCanonicalPayload(payload) }].map((line) => JSON.stringify(line)).join("\n") + "\n";
    await writeFile(path, damaged);
    await assert.rejects(run(state.baseDir, current), /fill completion follows its execution event/);
    assert.equal(await readFile(path, "utf8"), damaged);
    await writeFile(path, original); assert.equal((await run(state.baseDir, current)).executions.length, 1);
  }, { reduceOnly: true, completion: true });
});

test("held pending reservation consumer retains actual source locks and releases them on failure", async (context) => {
  await fixture(context, "manual", { count: 1 }, async (state) => {
    const current = await storeSnapshot(state, context);
    await assert.rejects(hold(state.dir, async (sources) => {
      assert.equal(bind({ baseDir: state.dir, snapshot: current }, sources).reservationTotals[0]!.pendingNotionalKrw, 60);
      await assert.rejects(new InvestmentMandateFileRepository(state.dir, options).readSnapshot(), /lock|timeout/i);
      await assert.rejects(new OpeningCapacityReservationEventFileRepository(state.dir, options).withDurableVerifiedHistory(async () => {}), /lock|timeout/i);
      throw new Error("consumer failed");
    }), /consumer failed/);
    assert.equal((await run(state.dir, current)).bindings.length, 1);
  });
});
