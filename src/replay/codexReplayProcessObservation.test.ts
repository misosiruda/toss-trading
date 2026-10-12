import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { createReplayProcessObservation, type ReplayProcessObservationBinding } from "../domain/replayProcessObservation.js";
import { processObservationFixture } from "../domain/replayProcessObservationTestFixtures.js";
import { PAPER_COST_MODEL_VERSION, PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { runCodexHistoricalReplay, resolveReplayProcessObservationContext,
  type ReplayProcessObservationContext } from "./codexHistoricalReplayRunner.js";
import { sourceOptions, sourcePortfolio, sourceSnapshot, sourceGate, sourceDecision } from "./codexReplaySourceTestFixtures.js";

const replayInput = () => ({ initialPortfolio: sourcePortfolio(), snapshots: [sourceSnapshot()] });
const binding = (): ReplayProcessObservationBinding => structuredClone(processObservationFixture().processEvidence.binding);

async function capture(actual = binding()): Promise<ReplayProcessObservationContext> {
  let handle: ReplayProcessObservationContext | undefined;
  await runCodexHistoricalReplay(sourceOptions({ processObservationBinding: actual,
    onProcessObservation: context => { handle = context; } }), replayInput());
  assert.ok(handle);
  return handle;
}

test("actual runner captures exactly five process/model fields into a frozen empty opaque handle", async () => {
  const actual = binding(), handle = await capture(actual), evidence = resolveReplayProcessObservationContext(handle);
  assert.equal(Object.isFrozen(handle), true);
  assert.equal(Object.getPrototypeOf(handle), null);
  assert.deepEqual(Reflect.ownKeys(handle), []);
  assert.equal(JSON.stringify(handle), "{}");
  assert.deepEqual(evidence.binding, actual);
  assert.deepEqual(evidence.process, { status: "recorded", nodeVersion: process.version, platform: process.platform,
    architecture: process.arch, costModelVersion: PAPER_COST_MODEL_VERSION, executionModelVersion: PAPER_EXECUTION_MODEL_VERSION });
  for (const value of [evidence, evidence.binding, evidence.binding.identity, evidence.process]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { evidence.binding.identity.runId = "changed"; }, TypeError);
  assert.throws(() => { Object.assign(evidence.process, { platform: "win32" }); }, TypeError);
  assert.throws(() => { Object.assign(handle, { process: {} }); }, TypeError);
  assert.strictEqual(resolveReplayProcessObservationContext(handle), evidence);
});

test("resolver checks exact issued ownership before touching fake, clone, prototype, accessor or proxy handles", async () => {
  const actual = await capture(); let calls = 0;
  const trap = () => { calls++; throw Error("must not execute"); };
  const accessor = {}; Object.defineProperty(accessor, "process", { get: trap, enumerable: true });
  const revoked = Proxy.revocable(actual, {}); revoked.revoke();
  for (const value of [null, undefined, "context", {}, JSON.parse(JSON.stringify(actual)), structuredClone(actual),
    Object.create(actual), accessor, new Proxy(actual, { get: trap, getPrototypeOf: trap, ownKeys: trap }), revoked.proxy,
    { process: processObservationFixture().record.process }, resolveReplayProcessObservationContext(actual)]) {
    assert.throws(() => resolveReplayProcessObservationContext(value), { message: "process observation context unavailable" });
  }
  assert.equal(calls, 0);
});

test("an authentic different-child handle with equal process scalars cannot bind the actual durable B", async () => {
  const f = processObservationFixture(), first = await capture(f.processEvidence.binding);
  const otherBinding = structuredClone(f.processEvidence.binding); otherBinding.identity.runId += "_other";
  const other = await capture(otherBinding);
  assert.deepEqual(resolveReplayProcessObservationContext(first).process, resolveReplayProcessObservationContext(other).process);
  assert.throws(() => createReplayProcessObservation({ admission: f.admission, evidence: resolveReplayProcessObservationContext(other) }),
    { message: "process observation admission binding mismatch" });
  assert.equal(createReplayProcessObservation({ admission: f.admission, evidence: resolveReplayProcessObservationContext(first) }).identity.runId, f.b.identity.runId);
});

test("capture precedes first await and snapshots binding, process scalar values and mandatory callback", async () => {
  const actual = binding(), original = structuredClone(actual), gate = sourceGate(), events: string[] = [];
  const version = Object.getOwnPropertyDescriptor(process, "version")!;
  let handle: ReplayProcessObservationContext | undefined, replacementCalls = 0;
  const options = sourceOptions({ processObservationBinding: actual,
    onInitialPortfolio: () => { events.push("initial"); return gate.promise; },
    onSourceSnapshots: () => { events.push("source"); }, onSettings: () => { events.push("settings"); },
    onProcessObservation: context => { events.push("process"); handle = context; },
    decisionProvider: { decide: async packet => { events.push("provider"); return sourceDecision(packet); } }
  });
  try {
    const run = runCodexHistoricalReplay(options, replayInput());
    assert.deepEqual(events, ["initial"]);
    actual.identity.runId = "later_child"; actual.startedAt = "2026-10-08T10:00:00.000Z";
    options.processObservationBinding = binding();
    options.onProcessObservation = () => { replacementCalls++; };
    Object.defineProperty(process, "version", { ...version, value: "v999.999.999" });
    gate.release();
    await run;
    assert.ok(handle);
    const evidence = resolveReplayProcessObservationContext(handle);
    assert.deepEqual(evidence.binding, original);
    assert.equal(evidence.process.status === "recorded" && evidence.process.nodeVersion, version.value);
    assert.equal(replacementCalls, 0);
    assert.deepEqual(events, ["initial", "source", "settings", "process", "provider"]);
  } finally { gate.release(); Object.defineProperty(process, "version", version); }
});

test("deleting the process callback during initial persistence cannot skip the captured mandatory observer", async () => {
  let calls = 0;
  const options = sourceOptions({ processObservationBinding: binding(), onProcessObservation: () => { calls++; } });
  options.onInitialPortfolio = () => { delete options.onProcessObservation; delete options.processObservationBinding; };
  await runCodexHistoricalReplay(options, replayInput());
  assert.equal(calls, 1);
});

test("process observer failure blocks ticks and provider with the captured callback", async () => {
  let ticks = 0, providers = 0;
  const options = sourceOptions({ processObservationBinding: binding(), onProcessObservation: () => { throw Error("synthetic persistence failed"); },
    decisionProvider: { decide: async packet => { providers++; return sourceDecision(packet); } } });
  options.clock.ticks = () => { ticks++; return []; };
  await assert.rejects(runCodexHistoricalReplay(options, replayInput()), { message: "synthetic persistence failed" });
  assert.equal(ticks, 0); assert.equal(providers, 0);
});

test("process accessor and opaque data descriptors yield genuine content-free unavailable without execution", async () => {
  const version = Object.getOwnPropertyDescriptor(process, "version")!;
  let calls = 0;
  const trap = () => { calls++; throw Error("never execute process value"); };
  for (const descriptor of [
    { configurable: true, enumerable: true, get: trap },
    { configurable: true, enumerable: true, value: new Proxy({}, { get: trap, getPrototypeOf: trap, ownKeys: trap }) },
    { configurable: true, enumerable: true, value: "v24.19.0-custom" },
    { configurable: true, enumerable: true, value: "v" + "9".repeat(20_000) }
  ]) {
    try {
      Object.defineProperty(process, "version", descriptor);
      const handle = await capture();
      assert.deepEqual(resolveReplayProcessObservationContext(handle).process, { status: "unavailable", reason: "unsupported_process_observation" });
    } finally { Object.defineProperty(process, "version", version); }
  }
  assert.equal(calls, 0);
});

test("selected process binding and callback must be coherent own data without accessor or proxy execution", async () => {
  let calls = 0;
  const trap = () => { calls++; throw Error("must not execute binding"); };
  for (const corrupt of ["binding_absent", "callback_absent", "binding_accessor", "callback_accessor", "nested_accessor", "binding_proxy"] as const) {
    const actual = binding(), options = sourceOptions({ processObservationBinding: actual, onProcessObservation: () => { calls++; } });
    if (corrupt === "binding_absent") delete options.processObservationBinding;
    if (corrupt === "callback_absent") delete options.onProcessObservation;
    if (corrupt === "binding_accessor") Object.defineProperty(options, "processObservationBinding", { get: trap });
    if (corrupt === "callback_accessor") Object.defineProperty(options, "onProcessObservation", { get: trap });
    if (corrupt === "nested_accessor") Object.defineProperty(actual.identity, "runId", { get: trap, enumerable: true });
    if (corrupt === "binding_proxy") options.processObservationBinding = new Proxy(actual, { get: trap, getPrototypeOf: trap, ownKeys: trap });
    await assert.rejects(runCodexHistoricalReplay(options, replayInput()), { message: "process observation binding unavailable" });
  }
  assert.equal(calls, 0);
});

test("receiptless legacy runner does not inspect process or recursively inspect opaque runtime dependencies", async () => {
  const version = Object.getOwnPropertyDescriptor(process, "version")!; let processReads = 0, opaqueReads = 0, providers = 0;
  const trap = () => { opaqueReads++; throw Error("opaque dependency must not be traversed"); };
  const options = sourceOptions({ decisionProvider: { decide: async packet => { providers++; return sourceDecision(packet); } } });
  for (const runtime of [options.clock, options.decisionProvider]) Object.defineProperty(runtime, "opaque", { enumerable: true, get: trap });
  try {
    Object.defineProperty(process, "version", { configurable: true, get: () => { processReads++; throw Error("legacy must not inspect process"); } });
    const result = await runCodexHistoricalReplay(new Proxy(options, {}), replayInput());
    assert.equal(result.status, "completed");
  } finally { Object.defineProperty(process, "version", version); }
  assert.equal(processReads, 0); assert.equal(opaqueReads, 0); assert.equal(providers, 1);
});

test("bound process capture leaves opaque clock/provider state and unrelated runner accessors untouched", async () => {
  let opaqueReads = 0, observed = 0;
  const trap = () => { opaqueReads++; throw Error("opaque runtime state must not be read"); };
  const options = sourceOptions({ processObservationBinding: binding(), onSettings: () => {},
    onProcessObservation: () => { observed++; } });
  for (const runtime of [options, options.clock, options.decisionProvider]) Object.defineProperty(runtime, "opaque", { enumerable: true, get: trap });
  const result = await runCodexHistoricalReplay(options, replayInput());
  assert.equal(result.status, "completed"); assert.equal(observed, 1); assert.equal(opaqueReads, 0);
});
