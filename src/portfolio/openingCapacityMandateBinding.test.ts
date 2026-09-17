import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { InvestmentMandateFileRepository, assertDurableInvestmentMandateSource, createInvestmentMandatePaths } from "./investmentMandateFiles.js";
import { createInvestmentMandateRecord } from "./investmentMandate.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { bindOpeningCapacityMandateOrigins as bind, type OpeningCapacityMandateSources as Sources } from "./openingCapacityMandateBinding.js";
import { fixture as manualFixture, PORTFOLIO, OTHER, START, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture } from "./storedSelectorOpeningCapacityTestFixtures.js";

const options = { lockTimeoutMs: 100, lockRetryDelayMs: 3 };
const query = (baseDir: string) => ({ baseDir, portfolioId: PORTFOLIO });
async function hold<T>(dir: string, operation: (sources: Sources) => Promise<T>, beforeEvents: () => void = () => {}) {
  return new ManualAssignmentFileRepository(dir, options).withDurableVerifiedHistory((manual) =>
    new CandidateAssignmentFileRepository(dir, options).withDurableVerifiedHistory((assignments, inputs, requests, snapshots) =>
      new ManualOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(manual, snapshots, (manualReservations) =>
        new SelectorOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots, (selectorReservations) =>
          new InvestmentMandateFileRepository(dir, options).withDurableVerifiedHistory((mandates) => {
            beforeEvents();
            return new OpeningCapacityReservationEventFileRepository(dir, options).withDurableVerifiedHistory((events) =>
              operation({ manual, requests, inputs, assignments, manualReservations, selectorReservations, mandates, events }));
          })))));
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "capacity-mandate-binding-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("capacity mandate binding rejects copied foreign and expired sources even with no roots", async () => {
  await temporary(async (dir) => {
    let expired!: Sources;
    await hold(dir, async (sources) => {
      expired = sources;
      assert.deepEqual(bind(query(dir), sources), { roots: [], bindings: [] });
      assert.deepEqual(bind(query(join(dir, "unused", "..")), sources), { roots: [], bindings: [] });
      await hold(join(dir, "foreign"), async (foreign) => {
        for (const key of Object.keys(sources) as (keyof Sources)[]) {
          assert.deepEqual(sources[key], foreign[key]);
          assert.throws(() => bind(query(dir), { ...sources, [key]: { ...sources[key] } }), /verified|durable observation lease/);
          assert.throws(() => bind(query(dir), { ...sources, [key]: foreign[key] }), /different source path/);
        }
      });
      assert.throws(() => bind({ ...query(dir), trusted: true } as never, sources));
    });
    await hold(dir, async (fresh) => {
      for (const key of Object.keys(fresh) as (keyof Sources)[]) {
        assert.throws(() => bind(query(dir), { ...fresh, [key]: expired[key] }), /verified|durable observation lease/);
      }
    });
    await new InvestmentMandateFileRepository(dir).withVerifiedHistory(async (history) => {
      assert.throws(() => assertDurableInvestmentMandateSource(history, dir), /durable observation lease/);
    });
    await new InvestmentMandateFileRepository(relative(process.cwd(), dir)).withDurableVerifiedHistory(async (history) => {
      assert.doesNotThrow(() => assertDurableInvestmentMandateSource(history, dir));
    });
  });
});

test("capacity mandate binding rejects reversed observation time and releases owned locks after consumer failure", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await assert.rejects(hold(dir, async (sources) => {
      context.mock.timers.setTime(START - 1);
      assert.throws(() => bind(query(dir), sources), /clock moved backwards/);
      context.mock.timers.setTime(START);
      assert.deepEqual(bind(query(dir), sources).bindings, []);
      await assert.rejects(new InvestmentMandateFileRepository(dir, options).readSnapshot(), /lock|timeout/i);
      throw new Error("consumer failure");
    }), /consumer failure/);
    await hold(dir, async (sources) => assert.deepEqual(bind(query(dir), sources).bindings, []));
    await hold(dir, async (sources) => {
      assert.throws(() => bind(query(dir), sources), /clock moved backwards/);
    }, () => context.mock.timers.setTime(START - 1));
  });
});

for (const [kind, fixture] of [["manual", manualFixture], ["selector", selectorFixture]] as const) {
  test(`capacity mandate binding authenticates ${kind} sources and restart without mutation`, async (context) => {
    await fixture(context, { count: 0, mandateState: "proposed" }, async (state) => {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const before = await readFile(path, "utf8");
      const result = await hold(state.dir, async (sources) => bind(query(state.dir), sources));
      assert.equal(result.roots.length, 1); assert.equal(result.bindings.length, 1);
      assert.equal(result.bindings[0]!.sourceKind, kind);
      assert.deepEqual(result.bindings[0]!.mandate, state.manual.mandate);
      assert.deepEqual(result.bindings[0]!.event, state.manual.bound);
      assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.bindings)); assert.ok(Object.isFrozen(result.bindings[0]));
      assert.deepEqual(await hold(state.dir, async (sources) => bind(query(state.dir), sources)), result);
      assert.equal(await readFile(path, "utf8"), before);
      await hold(state.dir, async (sources) => assert.deepEqual(bind({ ...query(state.dir), portfolioId: "other" }, sources), { roots: [], bindings: [] }));
      // An issued but unbound root is not a mandate binding and must remain visible as a root.
      await unlink(path);
      await new OpeningCapacityReservationEventFileRepository(state.dir).append(state.manual.root);
      await hold(state.dir, async (sources) => {
        const unbound = bind(query(state.dir), sources);
        assert.equal(unbound.roots.length, 1); assert.equal(unbound.bindings.length, 0);
      });
    });
  });

  for (const label of ["missing", "hash", "policy", "bucket", "symbol", "weight", "early", "late", "evidence", "slot", "amount", "reservation", "assignment"] as const) {
    test(`capacity mandate binding rejects ${kind} ${label} mandate claims`, async (context) => {
      await fixture(context, { count: 0, mandateState: "proposed" }, async (state) => {
        const { mandateId: _id, mandateHash: _hash, ...payload } = state.manual.mandate;
        const lineage = payload.assignmentSource === "manual_policy" && payload.manualAuthorizationScope === "open_or_increase" ? payload.capacityReservation : undefined;
        const patches = { policy: { policyHash: OTHER }, bucket: { bucket: "swing", reviewAfter: at(1000),
          reviewCadence: { mode: "scheduled", boundaryRefs: [{ scheduleBoundaryRecordId: "boundary", version: "v1", hash: OTHER, lineageHash: OTHER }] } },
          symbol: { symbol: "000660" }, weight: { targetWeightRatio: 0.11 }, early: { createdAt: at(19) }, late: { createdAt: at(41) }, evidence: { evidenceRefs: ["different"] },
          slot: lineage ? { capacityReservation: { ...lineage, reservedSlotOrdinal: 22 } } : { reservedSlotOrdinal: 22 },
          amount: { maximumOpeningNotionalKrw: 101, ...(lineage ? { capacityReservation: { ...lineage, reservedMaximumNotionalKrw: 101 } } : { reservedMaximumNotionalKrw: 101 }) },
          reservation: lineage ? { capacityReservation: { ...lineage, manualCapacityReservationHash: OTHER } } : { openingCapacityReservationHash: OTHER },
          assignment: lineage ? { manualAssignmentEventId: "missing" } : { candidateAssignmentId: "missing" } };
        const record = label === "missing" || label === "hash" ? state.manual.mandate :
          createInvestmentMandateRecord({ ...payload, ...patches[label] } as Parameters<typeof createInvestmentMandateRecord>[0]);
        const recordsPath = createInvestmentMandatePaths(state.dir).recordsPath;
        await unlink(recordsPath);
        if (label !== "missing") await new InvestmentMandateFileRepository(state.dir).appendRecord(record);
        const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
        await unlink(path);
        const capacity = new OpeningCapacityReservationEventFileRepository(state.dir);
        context.mock.timers.setTime(START + 20);
        await capacity.append(state.manual.root);
        const { capacityReservationEventId: _eventId, capacityReservationEventHash: _eventHash, ...boundPayload } = state.manual.bound;
        if (boundPayload.eventType !== "bound_to_mandate") throw new Error("fixture requires bound event");
        context.mock.timers.setTime(START + 40);
        await capacity.append(createOpeningCapacityReservationEvent({ ...boundPayload, mandateId: record.mandateId,
          mandateHash: label === "hash" ? OTHER : record.mandateHash }));
        context.mock.timers.setTime(START + 60);
        const before = await readFile(path, "utf8");
        await assert.rejects(hold(state.dir, async (sources) => bind(query(state.dir), sources)),
          /source is missing or differs|chronology|lineage|mismatch|does not match/);
        assert.equal(await readFile(path, "utf8"), before);
      });
    });
  }
}

test("capacity mandate binding retains manual increase lineage without granting activation", async (context) => {
  await manualFixture(context, { count: 0, increase: true, mandateState: "proposed" }, async (state) => {
    await hold(state.dir, async (sources) => {
      const result = bind(query(state.dir), sources);
      const binding = result.bindings[0]!;
      assert.equal(binding.sourceKind, "manual");
      if (binding.sourceKind !== "manual") throw new Error("manual binding expected");
      assert.equal(binding.mandate.capacityReservation.reservationKind, "increase_existing");
      assert.deepEqual(sources.mandates.events, []);
    });
  });
});
