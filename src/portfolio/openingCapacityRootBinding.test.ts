import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CandidateAssignmentFileRepository } from "./candidateAssignmentFiles.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { SelectorOpeningCapacityReservationFileRepository } from "./selectorOpeningCapacityReservationFiles.js";
import { OpeningCapacityReservationEventFileRepository, createOpeningCapacityReservationEventPaths } from "./openingCapacityReservationEventFiles.js";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { bindOpeningCapacityRootOrigins as bind } from "./openingCapacityRootBinding.js";
import { fixture as manualFixture, PORTFOLIO, OTHER, START, at } from "./storedManualOpeningCapacityTestFixtures.js";
import { fixture as selectorFixture } from "./storedSelectorOpeningCapacityTestFixtures.js";

type Sources = Parameters<typeof bind> extends [unknown, ...infer Rest] ? Rest : never;
const options = { lockTimeoutMs: 100, lockRetryDelayMs: 3 };
const query = (baseDir: string) => ({ baseDir, portfolioId: PORTFOLIO });
async function hold<T>(dir: string, operation: (sources: Sources) => Promise<T>) {
  return new ManualAssignmentFileRepository(dir, options).withDurableVerifiedHistory((manual) =>
    new CandidateAssignmentFileRepository(dir, options).withDurableVerifiedHistory((assignments, inputs, requests, snapshots) =>
      new ManualOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(manual, snapshots, (manualReservations) =>
        new SelectorOpeningCapacityReservationFileRepository(dir, options).withDurableVerifiedHistoryFromSources(assignments, inputs, requests, snapshots, (selectorReservations) =>
          new OpeningCapacityReservationEventFileRepository(dir, options).withDurableVerifiedHistory((events) =>
            operation([manual, manualReservations, selectorReservations, events]))))));
}
async function temporary(operation: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "capacity-root-binding-"));
  try { await operation(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("capacity root binding requires all four actual same-directory live sources even for empty roots", async () => {
  await temporary(async (dir) => {
    let expired!: Sources;
    await hold(dir, async (sources) => {
      expired = sources;
      assert.deepEqual(bind(query(dir), ...sources), []);
      assert.deepEqual(bind(query(join(dir, "unused", "..")), ...sources), []);
      await hold(join(dir, "foreign"), async (foreign) => {
        for (let i = 0; i < sources.length; i++) {
          assert.deepEqual(sources[i], foreign[i]);
          const copy = [...sources] as Sources; copy[i] = { ...sources[i] } as never;
          assert.throws(() => bind(query(dir), ...copy), /durable observation lease/);
          copy[i] = foreign[i] as never;
          assert.throws(() => bind(query(dir), ...copy), /different source path/);
        }
      });
      assert.throws(() => bind({ ...query(dir), trusted: true } as never, ...sources));
    });
    await hold(dir, async (fresh) => {
      for (let i = 0; i < fresh.length; i++) {
        const copy = [...fresh] as Sources; copy[i] = expired[i] as never;
        assert.throws(() => bind(query(dir), ...copy), /durable observation lease/);
      }
    });
  });
});

test("capacity root binding rejects wall clock rollback and retains all locks through consumer failure", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: START });
  await temporary(async (dir) => {
    await assert.rejects(hold(dir, async (sources) => {
      context.mock.timers.setTime(START - 1);
      assert.throws(() => bind(query(dir), ...sources), /clock moved backwards/);
      context.mock.timers.setTime(START);
      assert.deepEqual(bind(query(dir), ...sources), []);
      await assert.rejects(new OpeningCapacityReservationEventFileRepository(dir, options).readAll(), /lock|timeout/i);
      await assert.rejects(new ManualAssignmentFileRepository(dir, options).readAll(), /lock|timeout/i);
      throw new Error("consumer failure");
    }), /consumer failure/);
    await hold(dir, async (sources) => assert.deepEqual(bind(query(dir), ...sources), []));
  });
});

for (const [kind, fixture] of [["manual", manualFixture], ["selector", selectorFixture]] as const) {
  test(`capacity root binding authenticates ${kind} issuance with successors and restart without writing`, async (context) => {
    await fixture(context, { count: 0 }, async (state) => {
      const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
      const before = await readFile(path, "utf8");
      const result = await hold(state.dir, async (sources) => bind(query(state.dir), ...sources));
      assert.equal(result.length, 1);
      assert.equal(result[0]!.sourceKind, kind);
      assert.deepEqual(result[0]!.event, state.manual.root);
      assert.deepEqual(result[0]!.eventOrigin.event, state.manual.root);
      assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result[0]));
      assert.ok(Date.parse(result[0]!.reservationOrigin.committedAt) < Date.parse(result[0]!.event.asOf));
      assert.deepEqual(await hold(state.dir, async (sources) => bind(query(state.dir), ...sources)), result);
      await hold(state.dir, async (sources) => assert.deepEqual(bind({ baseDir: state.dir, portfolioId: "other" }, ...sources), []));
      assert.equal(await readFile(path, "utf8"), before);
    });
  });

  for (const [label, patch] of [
    ["policy", { policyHash: OTHER }], ["bucket", { bucket: "swing" }],
    ["amount", { remainingReservedNotionalKrw: 99 }], ["hash", { reservationHash: OTHER }],
    ["missing issuance", { reservationId: "missing" }],
    ["same-time issuance", { asOf: at(kind === "manual" ? 10 : 15) }]
  ] as const) {
    test(`capacity root binding rejects ${kind} ${label} claims without rewriting bytes`, async (context) => {
      await fixture(context, { count: 0 }, async (state) => {
        const path = createOpeningCapacityReservationEventPaths(state.dir).eventsPath;
        const { capacityReservationEventId: _id, capacityReservationEventHash: _hash, ...payload } = state.manual.root;
        if (payload.eventType !== "reserved") throw new Error("fixture requires a root");
        const candidate = { ...payload, ...patch };
        if (candidate.reservationSource.sourceKind === "manual") {
          candidate.reservationSource = { ...candidate.reservationSource,
            manualCapacityReservationId: candidate.reservationId, manualCapacityReservationHash: candidate.reservationHash };
        }
        const event = createOpeningCapacityReservationEvent(candidate as OpeningCapacityReservationEvent);
        // This synthetic journal is replaced before acquiring any source lease.
        await unlink(path);
        await new OpeningCapacityReservationEventFileRepository(state.dir).append(event);
        const bytes = await readFile(path, "utf8");
        await assert.rejects(hold(state.dir, async (sources) => bind(query(state.dir), ...sources)),
          /does not match|lineage|source is missing|must precede/);
        assert.equal(await readFile(path, "utf8"), bytes);
      });
    });
  }
}
