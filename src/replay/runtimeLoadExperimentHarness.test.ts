import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createRuntimeLoadExperimentHarnessForTest, type RuntimeLoadExperimentHarnessDependenciesForTest,
  type RuntimeLoadExperimentOwnedChildForTest,
} from "./runtimeLoadExperimentHarnessTestFixtures.js";
import { RuntimeLoadExperimentPreparationError } from "./runtimeLoadExperimentFixturePreparationTestFixtures.js";
import {
  parseRuntimeLoadExperimentWireReport, RUNTIME_LOAD_EXPERIMENT_CASE_IDS,
  RUNTIME_LOAD_EXPERIMENT_OBSERVATIONS, RUNTIME_LOAD_EXPERIMENT_REJECTION_REASONS,
  RUNTIME_LOAD_EXPERIMENT_MAX_WIRE_BYTES,
  type RuntimeLoadExperimentCaseId, type RuntimeLoadExperimentWireReport,
  type RuntimeLoadExperimentParentResult,
} from "./runtimeLoadExperimentProtocolTestFixtures.js";

function report(caseId: RuntimeLoadExperimentCaseId = "transport_valid"): RuntimeLoadExperimentWireReport {
  return {
    schemaVersion: "runtime_load_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false,
    status: "observed", evidence: "synthetic_fixture_observation", events: [], observations: [],
  };
}
function encode(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value)}\n`); }
function invalid(bytes: Buffer, caseId: RuntimeLoadExperimentCaseId = "transport_valid"): void {
  assert.throws(() => parseRuntimeLoadExperimentWireReport(bytes, caseId), { message: "INVALID_REPORT" });
}
class Clock {
  current = 0;
  serial = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  set = (callback: () => void, milliseconds: number): number => {
    const id = ++this.serial;
    this.timers.set(id, { at: this.current + milliseconds, callback });
    return id;
  };
  clear = (timer: unknown): void => { this.timers.delete(timer as number); };
  advance(milliseconds: number): void {
    const end = this.current + milliseconds;
    for (;;) {
      const next = [...this.timers.entries()].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (next === undefined) break;
      this.current = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.current = end;
  }
}
class FakeChild extends EventEmitter implements RuntimeLoadExperimentOwnedChildForTest {
  pid: number | undefined = 42;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  signals: NodeJS.Signals[] = [];
  onKill: ((signal: NodeJS.Signals) => boolean) | undefined;
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return this.onKill?.(signal) ?? true;
  }
  output(value: unknown = report()): void { this.stdout.emit("data", encode(value)); }
  close(code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}
async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fixture(overrides: Partial<RuntimeLoadExperimentHarnessDependenciesForTest> = {}) {
  const clock = new Clock();
  const child = new FakeChild();
  const calls = { roots: 0, preparations: 0, spawns: 0, removals: 0, inspections: 0 };
  const deps: RuntimeLoadExperimentHarnessDependenciesForTest = {
    runtime: { version: "v24.19.0", platform: "linux", arch: "x64" },
    createRoot: async () => { calls.roots++; return "/owned-fixture"; },
    inspectRoot: async () => { calls.inspections++; return { dev: 1, ino: 2, directory: true, symlink: false }; },
    prepareFixture: async () => { calls.preparations++; return "/owned-fixture/bootstrap.mjs"; },
    removeRoot: async () => { calls.removals++; },
    spawnChild: () => { calls.spawns++; return child; },
    now: () => clock.current, setTimer: clock.set, clearTimer: clock.clear,
    ...overrides,
  };
  const run = createRuntimeLoadExperimentHarnessForTest(deps);
  const start = async () => {
    const result = run("transport_valid");
    await flush();
    child.emit("spawn");
    return { result };
  };
  return { clock, child, calls, deps, run, start };
}
function assertFailed(result: RuntimeLoadExperimentParentResult, reason: string,
  termination = "confirmed", cleanup = "removed"): void {
  assert.deepEqual(result, { status: "failed", reason, report: null, termination, cleanup });
}

test("load experiment wire accepts every fixed case and rejection without completeness claims", () => {
  assert.equal(new Set(RUNTIME_LOAD_EXPERIMENT_CASE_IDS).size, RUNTIME_LOAD_EXPERIMENT_CASE_IDS.length);
  for (const caseId of RUNTIME_LOAD_EXPERIMENT_CASE_IDS) {
    const value = report(caseId);
    assert.deepEqual(parseRuntimeLoadExperimentWireReport(encode(value), caseId), value);
  }
  for (const reason of RUNTIME_LOAD_EXPERIMENT_REJECTION_REASONS) {
    const { events: _events, observations: _observations, ...common } = report() as Extract<RuntimeLoadExperimentWireReport, { status: "observed" | "counterexample"; events: unknown }>;
    const value = { ...common, status: "rejected", evidence: "unavailable", reason };
    assert.deepEqual(parseRuntimeLoadExperimentWireReport(encode(value), "transport_valid"), value);
  }
});

test("load experiment schema-valid maximum is exactly 21335 bytes, separate from transport cap", () => {
  const value = { ...report("transport_case_mismatch"), status: "counterexample",
    events: Array.from({ length: 128 }, () => ({ kind: "load", fileId: "f16", format: "commonjs",
      sourceDigest: `sha256:${"f".repeat(64)}`, supply: "delegated" })),
    observations: [...RUNTIME_LOAD_EXPERIMENT_OBSERVATIONS] };
  const bytes = encode(value);
  assert.equal(bytes.length, 21_335);
  assert.equal(bytes.length, RUNTIME_LOAD_EXPERIMENT_MAX_WIRE_BYTES);
  assert.deepEqual(parseRuntimeLoadExperimentWireReport(bytes, "transport_case_mismatch"), value);
  invalid(Buffer.concat([bytes, Buffer.from(" ")]), "transport_case_mismatch");
  invalid(encode({ ...value, events: [...value.events, value.events[0]] }), "transport_case_mismatch");
});

test("load experiment wire rejects noncanonical framing, duplicates, malformed UTF-8 and case mismatch", () => {
  const valid = encode(report());
  for (const bytes of [Buffer.alloc(0), valid.subarray(0, valid.length - 2), valid.subarray(0, valid.length - 1),
    Buffer.concat([valid, valid]), Buffer.concat([Buffer.from("log\n"), valid]),
    Buffer.concat([Buffer.from(" "), valid]), Buffer.concat([valid, Buffer.from("\n")]),
    Buffer.from(valid.toString().replace('"caseId":', '"caseId":"esm_first","caseId":')),
    Buffer.from(valid.toString().replace('"schemaVersion"', '"schema\\u0056ersion"')),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]), Buffer.from([0xc3, 0x28]),
    encode({ ...report(), caseId: "esm_first" }), Buffer.alloc(32_768), Buffer.alloc(32_769)]) invalid(bytes);
});

test("load experiment wire has exact fields and fixed nested enums, arrays and false claims", () => {
  const event = { kind: "load", fileId: "f01", format: "module", sourceDigest: `sha256:${"a".repeat(64)}`, supply: "snapshot" };
  const valid = { ...report(), events: [event, { kind: "resolve", fileId: "f16", parentId: "bootstrap", route: "delegated" }],
    observations: ["ORIGINAL_VALUE"] };
  assert.deepEqual(parseRuntimeLoadExperimentWireReport(encode(valid), "transport_valid"), valid);
  const values: unknown[] = [null, [], 4, "raw", { ...valid, extra: "PRIVATE" }, { ...valid, completeRuntime: true },
    { ...valid, completeConfiguration: true }, { ...valid, completeInput: true }, { ...valid, runtime: "verified" },
    { ...valid, dependencies: null }, { ...valid, result: "success" }, { ...valid, comparability: true },
    { ...valid, schemaVersion: "other" }, { ...valid, status: "collected" }, { ...valid, evidence: "verified" },
    { ...valid, observations: ["ORIGINAL_VALUE", "ORIGINAL_VALUE"] }, { ...valid, observations: ["PRIVATE"] },
    { ...valid, observations: [...RUNTIME_LOAD_EXPERIMENT_OBSERVATIONS, "ORIGINAL_VALUE"] },
    { ...valid, observations: {} }, { ...valid, events: {} }, { ...valid, events: [null] },
    { ...valid, events: [{ ...event, extra: "PRIVATE" }] }, { ...valid, events: [{ ...event, kind: "other" }] },
    { ...valid, events: [{ ...event, fileId: "f17" }] }, { ...valid, events: [{ ...event, format: "builtin" }] },
    { ...valid, events: [{ ...event, supply: "default" }] }, { ...valid, events: [{ ...event, sourceDigest: `sha256:${"A".repeat(64)}` }] },
    { ...valid, events: [{ ...event, sourceDigest: "PRIVATE" }] },
    { ...valid, events: [{ ...event, sourceDigest: `sha256:${"a".repeat(64)}\n` }] },
    { ...valid, events: [{ kind: "resolve", fileId: "f01", parentId: "f17", route: "snapshot" }] },
    { ...valid, events: [{ kind: "resolve", fileId: "f01", parentId: "bootstrap", route: "other" }] },
    { ...valid, status: "rejected", evidence: "unavailable", reason: "PATH_UNSAFE" }];
  for (const key of Object.keys(report())) {
    const missing: Record<string, unknown> = { ...report() }; delete missing[key]; values.push(missing);
  }
  for (const value of values) invalid(encode(value));
});

test("load experiment invalid input and unsupported runtime never create or spawn", async () => {
  const f = fixture();
  for (const value of [undefined, null, {}, [], "unknown", "../transport_valid", 0])
    assertFailed(await f.run(value), "INVALID_CASE", "not_started", "not_created");
  assert.equal(f.calls.roots, 0);
  for (const runtime of [{ version: "v24.18.0", platform: "linux", arch: "x64" },
    { version: "v24.19.0", platform: "win32", arch: "x64" }, { version: "v24.19.0", platform: "linux", arch: "arm64" }]) {
    const other = fixture({ runtime });
    assert.deepEqual(await other.run("transport_valid"), { status: "unsupported", reason: "RUNTIME_UNSUPPORTED",
      report: null, termination: "not_started", cleanup: "not_created" });
    assert.equal(other.calls.roots, 0);
  }
});

test("load experiment success waits for close and confirmed cleanup, including post-exit bytes", async () => {
  const removals: (() => void)[] = [];
  const f = fixture({ removeRoot: () => new Promise<void>((resolve) => { removals.push(resolve); }) });
  const { result } = await f.start();
  let settled = false; void result.then(() => { settled = true; });
  const bytes = encode(report());
  f.child.stdout.emit("data", bytes.subarray(0, 25));
  f.child.emit("exit", 0, null);
  await flush(); assert.equal(settled, false); assert.equal(removals.length, 0);
  f.child.stdout.emit("data", bytes.subarray(25));
  f.child.emit("close", 0, null);
  await flush(); assert.equal(settled, false); assert.equal(removals.length, 1);
  assert.equal(typeof removals[0], "function");
  removals[0]!();
  assert.deepEqual(await result, { status: "collected", report: report(), termination: "confirmed", cleanup: "removed" });
  assert.deepEqual(f.child.signals, []); assert.equal(f.clock.timers.size, 0);
});

test("load experiment invalid framing after exit fails without sending signals after close", async () => {
  const f = fixture(); const { result } = await f.start();
  f.child.output(); f.child.emit("exit", 0, null); f.child.stdout.emit("data", Buffer.from("extra"));
  f.child.emit("close", 0, null);
  assertFailed(await result, "INVALID_REPORT"); assert.deepEqual(f.child.signals, []);
});

test("load experiment raw stdout 32768 and 32769 boundaries never become padded report success", async () => {
  for (const count of [32_768, 32_769]) {
    const f = fixture(); const { result } = await f.start();
    f.child.stdout.emit("data", Buffer.alloc(32_767, 32));
    f.child.stdout.emit("data", Buffer.alloc(count - 32_767, 32));
    assert.deepEqual(f.child.signals, count === 32_769 ? ["SIGTERM"] : []);
    f.child.close(); assertFailed(await result, count === 32_769 ? "STDOUT_LIMIT" : "INVALID_REPORT");
  }
});

test("load experiment stderr 4096 bytes is counted only, 4097 bytes fails even with a valid report", async () => {
  for (const count of [4_096, 4_097]) {
    const f = fixture(); const { result } = await f.start(); f.child.output();
    f.child.stderr.emit("data", Buffer.alloc(count, 120)); f.child.close();
    const outcome = await result;
    if (count === 4_096) assert.equal(outcome.status, "collected");
    else assertFailed(outcome, "STDERR_LIMIT");
    assert.equal(JSON.stringify(outcome).includes("xxxxxxxx"), false);
  }
});

test("load experiment first failure survives subsequent stderr, timeout and valid output", async () => {
  const f = fixture(); const { result } = await f.start();
  f.child.stdout.emit("data", Buffer.alloc(32_769)); f.child.stderr.emit("data", Buffer.alloc(4_097));
  f.child.output(); f.child.close(7);
  assertFailed(await result, "STDOUT_LIMIT"); assert.deepEqual(f.child.signals, ["SIGTERM"]);
});

test("load experiment nonzero and signal exits discard otherwise valid reports", async () => {
  for (const [code, signal, reason] of [[7, null, "EXIT_FAILURE"], [null, "SIGTERM", "SIGNAL_EXIT"]] as const) {
    const f = fixture(); const { result } = await f.start(); f.child.output(); f.child.close(code, signal);
    assertFailed(await result, reason); assert.deepEqual(f.child.signals, []);
  }
});

test("load experiment monotonic deadline is 10000ms, with independent term and kill grace", async () => {
  const f = fixture(); const { result } = await f.start();
  f.clock.advance(9_999); assert.deepEqual(f.child.signals, []);
  f.clock.advance(1); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  f.clock.advance(999); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  f.clock.advance(1); assert.deepEqual(f.child.signals, ["SIGTERM", "SIGKILL"]);
  f.child.close(null, "SIGKILL");
  assertFailed(await result, "DEADLINE_EXCEEDED"); assert.equal(f.clock.timers.size, 0);
});

test("load experiment deadline is checked on close even if the timer callback has not run", async () => {
  for (const elapsed of [9_999, 10_000]) {
    const f = fixture(); const { result } = await f.start(); f.child.output();
    f.clock.current = elapsed; f.child.close(); const outcome = await result;
    if (elapsed === 9_999) assert.equal(outcome.status, "collected"); else assertFailed(outcome, "DEADLINE_EXCEEDED");
    assert.deepEqual(f.child.signals, []);
  }
});

test("load experiment exit before timeout disables both signal guards but does not prove close", async () => {
  const f = fixture(); const { result } = await f.start(); f.child.output(); f.child.emit("exit", 0, null);
  f.clock.advance(12_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, []); assert.equal(f.calls.removals, 0);
  assertFailed(await f.run("transport_valid"), "DEADLINE_EXCEEDED", "not_started", "not_created");
  assert.equal(f.calls.spawns, 1);
});

test("load experiment exit during TERM grace prevents later KILL but still collects close", async () => {
  const f = fixture(); const { result } = await f.start(); f.clock.advance(10_000);
  f.child.emit("exit", null, "SIGTERM"); f.clock.advance(1_000);
  assert.deepEqual(f.child.signals, ["SIGTERM"]); f.child.emit("close", null, "SIGTERM");
  assertFailed(await result, "DEADLINE_EXCEEDED");
});

test("load experiment successful signal delivery without close retains root and blocks queued child", async () => {
  const f = fixture(); const { result } = await f.start();
  const queued = f.run("esm_first"); f.clock.advance(12_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained");
  assertFailed(await queued, "DEADLINE_EXCEEDED", "not_started", "not_created");
  assert.equal(f.calls.spawns, 1); assert.equal(f.calls.removals, 0);
  f.child.close(); await flush(); assert.equal(f.calls.removals, 0);
});

test("load experiment invalid pid, unobserved spawn and already exited children are never signaled", async () => {
  for (const pid of [undefined, 0, -1, Number.NaN, 1.5]) {
    const f = fixture(); f.child.pid = pid; const { result } = await f.start(); f.clock.advance(12_000);
    assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained"); assert.deepEqual(f.child.signals, []);
  }
  const f = fixture(); const result = f.run("transport_valid"); await flush(); f.clock.advance(12_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained"); assert.deepEqual(f.child.signals, []);
});

test("load experiment spawn throws or pre-spawn error is not a running child kill error", async () => {
  const thrown = fixture({ spawnChild: () => { throw new Error("PRIVATE_ERROR"); } });
  assertFailed(await thrown.run("transport_valid"), "SPAWN_FAILURE", "not_started");
  const f = fixture(); f.child.pid = undefined;
  const result = f.run("transport_valid"); await flush();
  f.child.emit("error", new Error("PRIVATE_ERROR")); f.child.emit("close", -2, null);
  assertFailed(await result, "SPAWN_FAILURE", "not_started"); assert.deepEqual(f.child.signals, []);
});

test("load experiment post-spawn error and kill errors never imply termination", async () => {
  for (const behavior of ["throw", "return-false", "error-event"] as const) {
    const f = fixture(); const { result } = await f.start();
    f.child.onKill = () => {
      if (behavior === "throw") throw new Error("PRIVATE_ERROR");
      if (behavior === "error-event") f.child.emit("error", new Error("PRIVATE_ERROR"));
      return false;
    };
    f.child.emit("error", new Error("PRIVATE_ERROR")); f.clock.advance(2_000);
    assertFailed(await result, "EXIT_FAILURE", "unconfirmed", "retained");
    assert.deepEqual(f.child.signals, ["SIGTERM", "SIGKILL"]); assert.equal(f.calls.removals, 0);
  }
});

test("load experiment a late spawn is signaled only after spawn confirmation", async () => {
  const f = fixture(); const result = f.run("transport_valid"); await flush();
  f.clock.advance(10_000); assert.deepEqual(f.child.signals, []);
  f.child.emit("spawn"); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  f.child.close(null, "SIGTERM"); assertFailed(await result, "DEADLINE_EXCEEDED");
});

test("load experiment preparation errors are fixed and owned root is removed without spawning", async () => {
  for (const reason of ["FIXTURE_PREPARATION_FAILED", "BOOTSTRAP_LIMIT"] as const) {
    const f = fixture({ prepareFixture: async () => { throw new RuntimeLoadExperimentPreparationError(reason); } });
    assertFailed(await f.run("transport_valid"), reason, "not_started");
    assert.equal(f.calls.spawns, 0); assert.equal(f.calls.removals, 1);
  }
  const f = fixture({ createRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  assertFailed(await f.run("transport_valid"), "FIXTURE_PREPARATION_FAILED", "not_started", "not_created");
});

test("load experiment root replacement or symlink is retained without deleting another directory", async () => {
  for (const replacement of [{ dev: 2, ino: 2, directory: true, symlink: false },
    { dev: 1, ino: 3, directory: true, symlink: false }, { dev: 1, ino: 2, directory: true, symlink: true },
    { dev: 1, ino: 2, directory: false, symlink: false }]) {
    let calls = 0;
    const f = fixture({ inspectRoot: async () => ++calls === 1
      ? { dev: 1, ino: 2, directory: true, symlink: false } : replacement });
    const { result } = await f.start(); f.child.output(); f.child.close();
    assertFailed(await result, "CLEANUP_FAILURE", "confirmed", "retained"); assert.equal(f.calls.removals, 0);
    assert.deepEqual(f.child.signals, []);
  }
});

test("load experiment cleanup rejection preserves first transport failure and blocks additional child", async () => {
  const f = fixture({ removeRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  const { result } = await f.start(); f.child.close(7);
  assertFailed(await result, "EXIT_FAILURE", "confirmed", "retained");
  assertFailed(await f.run("transport_valid"), "CLEANUP_FAILURE", "not_started", "not_created");
  assert.equal(f.calls.spawns, 1); assert.deepEqual(f.child.signals, []);
});

test("load experiment cleanup syscall is attempted once and unknown completion blocks queued child", async () => {
  let removes = 0; let complete: (() => void) | undefined;
  const f = fixture({ removeRoot: () => { removes++; return new Promise<void>((resolve) => { complete = resolve; }); } });
  const { result } = await f.start(); f.child.output(); f.child.close(); const queued = f.run("esm_first");
  await flush(); f.clock.advance(999); let settled = false; void result.then(() => { settled = true; });
  await flush(); assert.equal(settled, false); f.clock.advance(1);
  assertFailed(await result, "CLEANUP_UNCONFIRMED", "confirmed", "unconfirmed");
  assertFailed(await queued, "CLEANUP_UNCONFIRMED", "not_started", "not_created");
  assert.equal(removes, 1); assert.equal(f.calls.spawns, 1); assert.deepEqual(f.child.signals, []);
  complete?.(); await flush(); assertFailed(await f.run("esm_first"), "CLEANUP_UNCONFIRMED", "not_started", "not_created");
});

test("load experiment stalled cleanup identity check times out and cannot initiate a late remove", async () => {
  let inspections = 0; let complete: ((value: { dev: number; ino: number; directory: boolean; symlink: boolean }) => void) | undefined;
  const identity = { dev: 1, ino: 2, directory: true, symlink: false };
  const f = fixture({ inspectRoot: () => ++inspections === 1 ? Promise.resolve(identity)
    : new Promise((resolve) => { complete = resolve; }) });
  const { result } = await f.start(); f.child.output(); f.child.close(); await flush(); f.clock.advance(1_000);
  assertFailed(await result, "CLEANUP_UNCONFIRMED", "confirmed", "unconfirmed");
  complete?.(identity); await flush(); assert.equal(f.calls.removals, 0);
});

test("load experiment pre-spawn error with an allocated pid does not assert not-started or delete root", async () => {
  const f = fixture(); const result = f.run("transport_valid"); await flush();
  f.child.emit("error", new Error("PRIVATE_ERROR")); f.clock.advance(2_000);
  assertFailed(await result, "EXIT_FAILURE", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, []); assert.equal(f.calls.removals, 0);
});

test("load experiment stream errors latch failure and later valid report cannot replace it", async () => {
  for (const stream of ["stdout", "stderr"] as const) {
    const f = fixture(); const { result } = await f.start();
    f.child[stream].emit("error", new Error("PRIVATE_ERROR")); f.child.output(); f.child.close();
    assertFailed(await result, "EXIT_FAILURE"); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  }
});

test("load experiment no actual close status and inconsistent close status are not success", async () => {
  const f = fixture(); const { result } = await f.start(); f.child.output(); f.child.emit("close", null, null);
  assertFailed(await result, "EXIT_FAILURE", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, []); assert.equal(f.calls.removals, 0);
  const other = fixture(); const started = await other.start(); other.child.output();
  other.child.emit("exit", 0, null); other.child.emit("close", 1, null);
  assertFailed(await started.result, "EXIT_FAILURE"); assert.deepEqual(other.child.signals, []);
});

test("load experiment TERM-triggered close is consumed before scheduling any further signal", async () => {
  const f = fixture(); const { result } = await f.start();
  f.child.onKill = () => { f.child.close(null, "SIGTERM"); return true; };
  f.clock.advance(10_000);
  assertFailed(await result, "DEADLINE_EXCEEDED");
  assert.deepEqual(f.child.signals, ["SIGTERM"]); assert.equal(f.clock.timers.size, 0);
});

test("load experiment rechecks the owned pid immediately before escalation", async () => {
  const f = fixture(); const { result } = await f.start(); f.clock.advance(10_000);
  f.child.pid = undefined; f.clock.advance(2_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, ["SIGTERM"]);
});

test("load experiment initial root identity failure retains it without preparing or deleting", async () => {
  const f = fixture({ inspectRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  assertFailed(await f.run("transport_valid"), "FIXTURE_PREPARATION_FAILED", "not_started", "retained");
  assert.equal(f.calls.preparations, 0); assert.equal(f.calls.spawns, 0); assert.equal(f.calls.removals, 0);
  assertFailed(await f.run("transport_valid"), "CLEANUP_FAILURE", "not_started", "not_created");
});

test("load experiment cleanup failure without transport failure has its own fixed reason", async () => {
  const f = fixture({ removeRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  const { result } = await f.start(); f.child.output(); f.child.close();
  assertFailed(await result, "CLEANUP_FAILURE", "confirmed", "retained"); assert.deepEqual(f.child.signals, []);
});

test("load experiment an early deadline callback re-arms against the monotonic boundary", async () => {
  const f = fixture(); const { result } = await f.start();
  const early = [...f.clock.timers.values()][0]; assert.ok(early);
  f.clock.timers.clear(); f.clock.current = 9_999.25; early.callback();
  assert.deepEqual(f.child.signals, []);
  assert.equal([...f.clock.timers.values()][0]?.at, 10_000.25);
  f.clock.current = 10_000; f.child.output(); f.child.close();
  assertFailed(await result, "DEADLINE_EXCEEDED");
});

test("load experiment cleanup deadline is enforced before a delayed timer callback", async () => {
  let complete: (() => void) | undefined;
  const f = fixture({ removeRoot: () => new Promise<void>((resolve) => { complete = resolve; }) });
  const { result } = await f.start(); f.child.output(); f.child.close(); await flush();
  f.clock.current = 1_000; complete?.();
  assertFailed(await result, "CLEANUP_UNCONFIRMED", "confirmed", "unconfirmed");
  assert.equal(f.clock.timers.size, 0);
});
