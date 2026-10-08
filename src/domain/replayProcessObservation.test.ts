import assert from "node:assert/strict";
import test from "node:test";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { durableAdmissionLineageReference, replayAdmissionLineageSchema } from "./replayAdmissionLineage.js";
import { createReplayProcessObservation, REPLAY_PROCESS_OBSERVATION_MAX_BYTES,
  replayProcessObservationSchema, replayProcessScalarObservationSchema, replayProcessObservationBindingSchema } from "./replayProcessObservation.js";
import { processObservationFixture } from "./replayProcessObservationTestFixtures.js";

test("actual durable B reference is detached, deeply frozen and hashes the whole unchanged B record", () => {
  const f = processObservationFixture(), before = JSON.stringify(f.b), reference = durableAdmissionLineageReference(f.b);
  assert.equal(JSON.stringify(f.b), before);
  assert.equal(reference.admissionObservation.observationHash, createReplayResearchHash(f.b));
  assert.deepEqual(reference.admissionObservation.lineage, { status: "recorded", mappingVersion: "paper_simulation_child_mapping.v1" });
  assert.equal(JSON.stringify(reference).includes("seed"), false);
  assert.equal(JSON.stringify(reference).includes("receipt"), false);
  for (const value of [reference, reference.identity, reference.initialObservation, reference.initialObservation.initialPortfolio,
    reference.sourceObservation, reference.sourceObservation.source, reference.settingsObservation, reference.settingsObservation.settings,
    reference.admissionObservation, reference.admissionObservation.lineage]) assert.equal(Object.isFrozen(value), true);
  f.b.identity.runId = "later";
  f.b.lineage = { status: "unavailable", reason: "initial_unavailable" };
  assert.notEqual(reference.identity.runId, "later");
  assert.equal(reference.admissionObservation.lineage.status, "recorded");
});

test("process record binds B and preserves unavailable facets and incomplete claims", () => {
  const f = processObservationFixture(), { record } = f;
  for (const key of ["identity", "startedAt", "reservationHash", "initialObservation", "sourceObservation", "settingsObservation", "admissionObservation"] as const) {
    assert.deepEqual(record[key], f.admission[key]);
  }
  for (const key of ["implementation", "sourceBuild", "dependencyLock", "loadedDependencies", "nodeArtifact", "runtimeConfiguration",
    "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[key], "unavailable");
  assert.equal(record.completeRuntime, false); assert.equal(record.completeConfiguration, false); assert.equal(record.completeInput, false);
  assert.deepEqual(record.process, f.processEvidence.process);
  f.processEvidence.binding.identity.runId = "later";
  Object.assign(f.processEvidence.process, { nodeVersion: "v999.999.999" });
  assert.notEqual(record.identity.runId, "later");
  assert.equal(record.process.status === "recorded" && record.process.nodeVersion, "v24.19.0");
});

for (const field of ["runId", "batchId", "runIndex", "startedAt"] as const) {
  test(`same process scalar values cannot bind another child ${field}`, () => {
    const f = processObservationFixture(), evidence = structuredClone(f.processEvidence);
    if (field === "startedAt") evidence.binding.startedAt = "2026-10-08T09:00:00.001Z";
    else if (field === "runIndex") evidence.binding.identity.runIndex = 1;
    else evidence.binding.identity[field] += "z";
    assert.throws(() => createReplayProcessObservation({ admission: f.admission, evidence }), { message: "process observation admission binding mismatch" });
  });
}

test("genuine unavailable process remains content-free and independent of unavailable B lineage", () => {
  const f = processObservationFixture();
  for (const reason of ["unsupported_derivation", "settings_unavailable", "initial_unavailable"] as const) {
    const b = replayAdmissionLineageSchema.parse({ ...f.b, lineage: { status: "unavailable", reason } });
    const admission = durableAdmissionLineageReference(b);
    const record = createReplayProcessObservation({ admission, evidence: { ...f.processEvidence,
      process: { status: "unavailable", reason: "unsupported_process_observation" } } });
    assert.deepEqual(record.process, { status: "unavailable", reason: "unsupported_process_observation" });
    assert.deepEqual(record.admissionObservation.lineage, { status: "unavailable", reason });
    const observed = createReplayProcessObservation({ admission, evidence: f.processEvidence });
    assert.equal(observed.process.status, "recorded");
  }
});

test("strict parser rejects unsupported claims, false presence, extra fields and malformed independent references", () => {
  const { record } = processObservationFixture();
  assert.deepEqual(replayProcessObservationSchema.parse(record), record);
  for (const changes of [{ extra: true }, { schemaVersion: "replay_child_process_observation.v2" }, { phase: "completed" }, { mode: "live" },
    { completeInput: true }, { completeRuntime: true }, { completeConfiguration: true }, { runtime: "recorded" },
    { dependencies: "recorded" }, { result: "completed" }, { comparability: "comparable" },
    { identity: { ...record.identity, runIndex: 20 } }, { identity: { ...record.identity, runId: "x".repeat(257) } },
    { identity: { ...record.identity, batchId: "legacy" } }, { startedAt: "2026-10-08T09:00:00Z" },
    { startedAt: "2026-02-30T00:00:00.000Z" }, { process: undefined }, { process: { status: "recorded" } },
    { process: { status: "unavailable", reason: "unsupported_process_observation", nodeVersion: "v24.19.0" } }]) {
    assert.equal(replayProcessObservationSchema.safeParse({ ...record, ...changes }).success, false);
  }
  for (const key of ["initialObservation", "sourceObservation", "settingsObservation", "admissionObservation"] as const) {
    for (const changes of [{ extra: true }, { observationHash: record[key].observationHash + "\n" }, { observationHash: "sha256:bad" }]) {
      assert.equal(replayProcessObservationSchema.safeParse({ ...record, [key]: { ...record[key], ...changes } }).success, false);
    }
  }
  assert.equal(replayProcessObservationSchema.safeParse({ ...record, admissionObservation: { ...record.admissionObservation,
    lineage: { status: "unavailable", reason: "redacted" } } }).success, false);
});

test("frozen process scalar grammar accepts supported endpoints and rejects suffixes, coercions and unbounded labels", () => {
  const { processEvidence: { process } } = processObservationFixture();
  for (const nodeVersion of ["v0.0.0", "v999.999.999"]) assert.equal(replayProcessScalarObservationSchema.safeParse({ ...process, nodeVersion }).success, true);
  for (const nodeVersion of ["v01.1.1", "v1.00.1", "v1.1.01", "v1000.1.1", "v1.1.1-custom", "1.1.1", "v1.1.1\n", 24, {}]) {
    assert.equal(replayProcessScalarObservationSchema.safeParse({ ...process, nodeVersion }).success, false);
  }
  for (const change of [{ platform: "unknown" }, { architecture: "unknown" }, { costModelVersion: "paper_cost_model.v6" },
    { executionModelVersion: "execution_simulator.v5" }]) assert.equal(replayProcessScalarObservationSchema.safeParse({ ...process, ...change }).success, false);
});

test("parser and pure producer reject proxies, accessors, custom prototypes and serialization hooks without executing", () => {
  const f = processObservationFixture(); let calls = 0;
  const trap = () => { calls++; throw Error("do not execute"); };
  const accessor = { ...f.record }; Object.defineProperty(accessor, "process", { enumerable: true, get: trap });
  const revoked = Proxy.revocable(f.record, {}); revoked.revoke();
  for (const value of [accessor, new Proxy(f.record, { get: trap, getPrototypeOf: trap, ownKeys: trap }), revoked.proxy,
    { ...f.record, process: new Proxy(f.record.process, { get: trap, ownKeys: trap }) },
    Object.assign(Object.create({}), f.record), { ...f.record, toJSON: trap }, { ...f.record, [Symbol()]: true }]) {
    assert.equal(replayProcessObservationSchema.safeParse(value).success, false);
  }
  const input = { admission: f.admission, evidence: f.processEvidence };
  Object.defineProperty(input, "evidence", { enumerable: true, get: trap });
  assert.throws(() => createReplayProcessObservation(input), { message: "process observation admission binding mismatch" });
  assert.equal(calls, 0);
});

test("production strict-schema maximum is measured separately from storage UTF-8 byte guards", () => {
  const { record } = processObservationFixture();
  const maximum = replayProcessObservationSchema.parse({ ...record,
    identity: { runId: "z".repeat(256), batchId: `paper_sim_99991231235959999_${"z".repeat(32)}`, runIndex: 19 },
    process: { ...record.process, nodeVersion: "v999.999.999", platform: "freebsd", architecture: "loong64" }
  });
  const bytes = Buffer.byteLength(JSON.stringify(maximum) + "\n", "utf8");
  assert.equal(bytes, 2_448);
  assert.ok(bytes < REPLAY_PROCESS_OBSERVATION_MAX_BYTES);
  const unavailable = replayProcessObservationSchema.parse({ ...maximum,
    process: { status: "unavailable", reason: "unsupported_process_observation" } });
  assert.equal(Buffer.byteLength(JSON.stringify(unavailable) + "\n", "utf8"), 2_329);
  assert.equal(REPLAY_PROCESS_OBSERVATION_MAX_BYTES, 4_096);
});

test("an inherited serialization accessor is rejected without execution", () => {
  const { record } = processObservationFixture(); let calls = 0;
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  let accepted = true;
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, get: () => { calls++; throw Error("must not serialize"); } });
    accepted = replayProcessObservationSchema.safeParse(record).success;
  } finally {
    if (previous) Object.defineProperty(Object.prototype, "toJSON", previous);
    else Reflect.deleteProperty(Object.prototype, "toJSON");
  }
  assert.equal(accepted, false); assert.equal(calls, 0);
});

for (const kind of ["getter", "callable"] as const) {
  for (const parserName of ["scalar", "binding", "record"] as const) {
    test(`ordinary Array.prototype ${kind} is never executed by invalid ${parserName} parsing`, () => {
      const f = processObservationFixture();
      const cases = {
        scalar: { parser: replayProcessScalarObservationSchema, value: { ...f.processEvidence.process, nodeVersion: "invalid" } },
        binding: { parser: replayProcessObservationBindingSchema,
          value: { ...f.processEvidence.binding, identity: { ...f.processEvidence.binding.identity, runIndex: 20 } } },
        record: { parser: replayProcessObservationSchema, value: { ...f.record, mode: "live" } }
      };
      const { parser, value } = cases[parserName], previous = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let calls = 0, accepted = true, safeError: string | undefined, parseError: string | undefined;
      const trap = () => { calls++; throw Error("synthetic serialization marker"); };
      assert.strictEqual(Object.getPrototypeOf(Array.prototype), Object.prototype);
      try {
        Object.defineProperty(Array.prototype, "toJSON", kind === "getter"
          ? { configurable: true, get: trap } : { configurable: true, value: trap });
        const result = parser.safeParse(value);
        accepted = result.success;
        if (!result.success) safeError = result.error.message;
        try { parser.parse(value); } catch (error) { parseError = (error as Error).message; }
      } finally {
        if (previous) Object.defineProperty(Array.prototype, "toJSON", previous);
        else Reflect.deleteProperty(Array.prototype, "toJSON");
      }
      assert.equal(calls, 0); assert.equal(accepted, false);
      assert.equal(safeError, "Unsupported process observation shape");
      assert.equal(parseError, "Unsupported process observation shape");
    });
  }
}

test("inert non-callable toJSON data on standard prototypes preserves valid and invalid parsing", () => {
  const f = processObservationFixture();
  for (const prototype of [Object.prototype, Array.prototype]) {
    const previous = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let valid = false, invalid = true, failure: string | undefined;
    try {
      Object.defineProperty(prototype, "toJSON", { configurable: true, value: "inert synthetic value" });
      valid = replayProcessObservationSchema.safeParse(f.record).success &&
        replayProcessObservationBindingSchema.safeParse(f.processEvidence.binding).success &&
        replayProcessScalarObservationSchema.safeParse(f.processEvidence.process).success;
      const result = replayProcessScalarObservationSchema.safeParse({ ...f.processEvidence.process, nodeVersion: "invalid" });
      invalid = result.success;
      if (!result.success) failure = result.error.message;
    } finally {
      if (previous) Object.defineProperty(prototype, "toJSON", previous);
      else Reflect.deleteProperty(prototype, "toJSON");
    }
    assert.equal(valid, true); assert.equal(invalid, false); assert.equal(failure, "Invalid process observation data");
  }
});

test("pure producer rejects Array.prototype serialization hooks before Zod error construction", () => {
  const f = processObservationFixture(), previous = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  let calls = 0, message: string | undefined;
  try {
    Object.defineProperty(Array.prototype, "toJSON", { configurable: true, get: () => { calls++; throw Error("synthetic producer marker"); } });
    try { createReplayProcessObservation({ admission: f.admission, evidence: f.processEvidence }); }
    catch (error) { message = (error as Error).message; }
  } finally {
    if (previous) Object.defineProperty(Array.prototype, "toJSON", previous);
    else Reflect.deleteProperty(Array.prototype, "toJSON");
  }
  assert.equal(calls, 0); assert.equal(message, "process observation admission binding mismatch");
});

test("unexpected Array prototype chain is rejected without inspecting its proxy or getter", () => {
  const { record } = processObservationFixture(), previous = Object.getPrototypeOf(Array.prototype);
  let calls = 0, accepted = true, message: string | undefined;
  const trap = () => { calls++; throw Error("synthetic unexpected prototype marker"); };
  const prototype = {}; Object.defineProperty(prototype, "toJSON", { get: trap });
  const unexpected = new Proxy(prototype, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
  try {
    Object.setPrototypeOf(Array.prototype, unexpected);
    const result = replayProcessObservationSchema.safeParse(record);
    accepted = result.success;
    if (!result.success) message = result.error.message;
  } finally { Object.setPrototypeOf(Array.prototype, previous); }
  assert.equal(calls, 0); assert.equal(accepted, false); assert.equal(message, "Unsupported process observation shape");
});
