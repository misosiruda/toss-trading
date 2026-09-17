import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { createInvestmentMandateEvent, type InvestmentMandateEvent } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { bindOpeningCapacityTerminalOrigins as bind } from "./openingCapacityTerminalBinding.js";
import type { OpeningCapacityConsumptionSources as Sources } from "./openingCapacityConsumptionBinding.js";
import { fixture as manualFixture, PORTFOLIO, OTHER, START, at, mandateEvent } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture } from "./storedSelectorOpeningCapacityTestFixtures.js";

const options = { lockTimeoutMs: 100, lockRetryDelayMs: 3 };
const query = (baseDir: string) => ({ baseDir, portfolioId: PORTFOLIO });
type Fixture = { dir: string; manual: { mandate: Parameters<typeof mandateEvent>[0]; root: OpeningCapacityReservationEvent;
  bound: OpeningCapacityReservationEvent }; capacity: readonly OpeningCapacityReservationEvent[] };
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
const run = (dir: string) => hold(dir, async (sources) => bind(query(dir), sources));
async function retire(state: Fixture, context: TestContext, ms = 170) {
  const repository = new InvestmentMandateFileRepository(state.dir), history = await repository.readSnapshot();
  const terminal = mandateEvent(state.manual.mandate, "retired", ms, history.events.at(-1)!.mandateEventId);
  context.mock.timers.setTime(START + ms); await repository.appendEvent(terminal);
  return terminal;
}
async function release(state: Fixture, context: TestContext, terminal: InvestmentMandateEvent, ms = 180,
  patch: Record<string, string> = {}, asOf = ms) {
  const prior = state.capacity.at(-1) ?? state.manual.bound;
  context.mock.timers.setTime(START + ms);
  const event = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO, policyHash: prior.policyHash,
    bucket: prior.bucket, reservationId: prior.reservationId, reservationHash: prior.reservationHash,
    previousCapacityReservationEventId: prior.capacityReservationEventId, capacityLedgerVersion: prior.capacityLedgerVersion + 1,
    remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(asOf), createdAt: at(ms), releaseReasonCode: "retired",
    releaseOrigin: { originKind: "mandate_terminal", mandateId: terminal.mandateId, mandateHash: terminal.mandateHash,
      mandateEventId: terminal.mandateEventId, mandateEventHash: terminal.mandateEventHash, ...patch } });
  await new OpeningCapacityReservationEventFileRepository(state.dir).append(event);
  return event;
}

test("held retirement binding rejects copied foreign expired and noncanonical sources even with no releases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "held-capacity-terminal-"));
  try {
    let expired!: Sources;
    await hold(dir, async (sources) => {
      expired = sources;
      assert.deepEqual(bind(query(dir), sources), { consumption: { mandates: { roots: [], bindings: [] }, bindings: [] }, bindings: [], unverifiedReleaseEventIds: [] });
      assert.throws(() => bind({ ...query(dir), trusted: true } as never, sources));
      await hold(join(dir, "foreign"), async (foreign) => {
        for (const key of Object.keys(sources) as (keyof Sources)[]) {
          assert.deepEqual(sources[key], foreign[key]);
          assert.throws(() => bind(query(dir), { ...sources, [key]: { ...sources[key] } }), /verified|lease/);
          assert.throws(() => bind(query(dir), { ...sources, [key]: foreign[key] }), /different source path/);
        }
      });
    });
    await hold(dir, async (fresh) => {
      for (const key of Object.keys(fresh) as (keyof Sources)[]) assert.throws(() => bind(query(dir), { ...fresh, [key]: expired[key] }), /verified|lease/);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const [kind, fixture] of [["manual", manualFixture], ["selector", selectorFixture]] as const) {
  for (const count of [0, 1, 2]) test(`held retirement binds ${kind} remaining gross after ${count} fills and restart without writes`, async (context) => {
    await fixture(context, { count, feeBps: 250 }, async (state) => {
      const terminal = await retire(state, context), event = await release(state, context, terminal);
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, bytes = await readFile(path);
      const result = await run(state.dir), binding = result.bindings[0]!;
      assert.equal(result.bindings.length, 1); assert.equal(result.consumption.bindings.length, count);
      assert.equal(binding.releasedNotionalKrw, [100, 60, 30][count]);
      assert.deepEqual(binding.terminalEvent, terminal); assert.deepEqual(binding.event, event);
      assert.equal(binding.mandateBinding.sourceKind, kind); assert.deepEqual(result.unverifiedReleaseEventIds, []);
      assert.equal(binding.predecessorOrigin.event.remainingReservedNotionalKrw, binding.releasedNotionalKrw);
      for (const value of [result, result.bindings, binding, result.unverifiedReleaseEventIds]) assert.ok(Object.isFrozen(value));
      assert.deepEqual(await run(state.dir), result); assert.deepEqual(await readFile(path), bytes);
      await hold(state.dir, async (sources) => {
        const other = bind({ ...query(state.dir), portfolioId: "other" }, sources);
        assert.deepEqual(other.bindings, []); assert.deepEqual(other.unverifiedReleaseEventIds, []);
      });
    });
  });
  for (const mode of ["missing", "hash", "active", "review_required"] as const) test(`held retirement rejects ${kind} ${mode} event source`, async (context) => {
    await fixture(context, { count: 0 }, async (state) => {
      const repository = new InvestmentMandateFileRepository(state.dir), activated = (await repository.readSnapshot()).events[0]!;
      let terminal = activated;
      if (mode === "review_required") {
        terminal = mandateEvent(state.manual.mandate, "review_required", 100, activated.mandateEventId);
        context.mock.timers.setTime(START + 100); await repository.appendEvent(terminal);
      } else if (mode !== "active") terminal = await retire(state, context, 100);
      await release(state, context, terminal, 110, mode === "missing" ? { mandateEventId: "missing" } : mode === "hash" ? { mandateEventHash: OTHER } : {});
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, bytes = await readFile(path);
      await assert.rejects(run(state.dir), /actual retired mandate event/);
      assert.deepEqual(await readFile(path), bytes);
    });
  });
  for (const mode of ["effective", "created", "predecessor"] as const) test(`held retirement rejects ${kind} ${mode} chronology`, async (context) => {
    await fixture(context, { count: mode === "predecessor" ? 1 : 0 }, async (state) => {
      const repository = new InvestmentMandateFileRepository(state.dir), activated = (await repository.readSnapshot()).events[0]!;
      const base = mandateEvent(state.manual.mandate, "retired", mode === "predecessor" ? 90 : mode === "effective" ? 150 : 100, activated.mandateEventId);
      const { mandateEventId: _id, mandateEventHash: _hash, ...payload } = base;
      const terminal = createInvestmentMandateEvent({ ...payload, createdAt: at(mode === "predecessor" ? 90 : 160) });
      context.mock.timers.setTime(START + 160); await repository.appendEvent(terminal);
      await release(state, context, terminal, 170, {}, mode === "predecessor" ? 95 : 120);
      await assert.rejects(run(state.dir), /chronology mismatch/);
    });
  });
  test(`held retirement rechecks ${kind} actual prior consumption before accepting a release`, async (context) => {
    await fixture(context, { wrongDelta: true }, async (state) => {
      await release(state, context, await retire(state, context));
      await assert.rejects(run(state.dir), /differs from actual filled notional/);
    });
  });
  test(`held retirement preserves ${kind} missing or corrupted terminal and fill sources`, async (context) => {
    await fixture(context, {}, async (state) => {
      await release(state, context, await retire(state, context));
      const capacityPath = createOpeningCapacityReservationEventPaths(state.dir).eventsPath, capacity = await readFile(capacityPath);
      for (const path of [createInvestmentMandatePaths(state.dir).eventsPath, createPaperFillExecutionPaths(state.dir).recordsPath]) {
        const original = await readFile(path);
        for (const damaged of ["", "broken\n"]) {
          await writeFile(path, damaged);
          await assert.rejects(run(state.dir));
          assert.equal(await readFile(path, "utf8"), damaged); assert.deepEqual(await readFile(capacityPath), capacity);
          await writeFile(path, original);
        }
      }
      assert.equal((await run(state.dir)).bindings.length, 1);
    });
  });
  test(`held retirement leaves ${kind} unbound request cancellation explicitly unverified`, async (context) => {
    await fixture(context, { count: 0 }, async (state) => {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      await unlink(path); context.mock.timers.setTime(START + 20);
      const repository = new OpeningCapacityReservationEventFileRepository(state.dir);
      await repository.append(state.manual.root);
      context.mock.timers.setTime(START + 100);
      const root = state.manual.root;
      const cancelled = createOpeningCapacityReservationEvent({ eventType: "released", portfolioId: PORTFOLIO, policyHash: root.policyHash, bucket: root.bucket,
        reservationId: root.reservationId, reservationHash: root.reservationHash, previousCapacityReservationEventId: root.capacityReservationEventId,
        capacityLedgerVersion: 2, remainingReservedNotionalKrw: 0, occupiesNewPositionSlot: false, asOf: at(100), createdAt: at(100),
        releaseReasonCode: "cancelled", releaseOrigin: { originKind: "request_cancelled", requestOrManualEventId: "not-authenticated" } });
      await repository.append(cancelled);
      const result = await run(state.dir);
      assert.deepEqual(result.bindings, []); assert.deepEqual(result.unverifiedReleaseEventIds, [cancelled.capacityReservationEventId]);
      assert.equal(result.consumption.mandates.roots.length, 1);
    });
  });
  test(`held retirement does not fabricate releases for ${kind} active or exhausted reservations`, async (context) => {
    for (const count of [0, 3]) await fixture(context, { count }, async (state) => {
      const result = await run(state.dir);
      assert.deepEqual(result.bindings, []); assert.deepEqual(result.unverifiedReleaseEventIds, []);
      assert.equal(result.consumption.bindings.length, count);
    });
  });
}

test("held retirement keeps mandate and capacity locks during consumption and releases them after consumer failure", async (context) => {
  await manualFixture(context, { increase: true }, async (state) => {
    await release(state, context, await retire(state, context));
    await assert.rejects(hold(state.dir, async (sources) => {
      assert.equal(bind(query(state.dir), sources).bindings[0]!.releasedNotionalKrw, 60);
      await assert.rejects(new InvestmentMandateFileRepository(state.dir, options).readSnapshot(), /lock|timeout/i);
      await assert.rejects(new OpeningCapacityReservationEventFileRepository(state.dir, options).withDurableVerifiedHistory(async () => {}), /lock|timeout/i);
      context.mock.timers.setTime(START + 179);
      assert.throws(() => bind(query(state.dir), sources), /clock moved backwards/);
      context.mock.timers.setTime(START + 180);
      throw new Error("consumer failed");
    }), /consumer failed/);
    assert.equal((await run(state.dir)).bindings.length, 1);
  });
});
