import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createCompilerLoadHarnessForTest, type CompilerLoadHarnessDependenciesForTest,
  type CompilerLoadOwnedChildForTest } from "./runtimeCompilerLoadHarnessTestFixtures.js";
import { CompilerLoadPreparationError } from "./runtimeCompilerLoadPreparationTestFixtures.js";
import { COMPILER_ARTIFACT_A, COMPILER_ARTIFACT_A_BYTES, COMPILER_LOAD_INPUT, COMPILER_LOAD_OUTPUT,
  COMPILER_LOAD_BUILTINS, type CompilerLoadCaseId, type CompilerLoadReport,
  type CompilerLoadParentResult } from "./runtimeCompilerLoadProtocolTestFixtures.js";
function report(caseId: CompilerLoadCaseId = "snapshot_baseline"): CompilerLoadReport {
  return { schemaVersion: "compiler_load_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false,
    status: "observed", evidence: "fixed_compiler_load_observation", compilerVersion: "5.9.3",
    artifactBytes: COMPILER_ARTIFACT_A_BYTES, capturedArtifact: COMPILER_ARTIFACT_A,
    suppliedArtifact: COMPILER_ARTIFACT_A, restoredArtifact: COMPILER_ARTIFACT_A,
    captureMatchesSupplied: true, diskBeforeAfterMatch: true, compilerLoadCount: 1,
    builtinLoads: COMPILER_LOAD_BUILTINS, cacheSameObject: true, observedMarker: 0,
    inputDigest: COMPILER_LOAD_INPUT, outputDigest: COMPILER_LOAD_OUTPUT, callbackCount: 12 };
}
function encode(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value)}\n`); }
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
class FakeChild extends EventEmitter implements CompilerLoadOwnedChildForTest {
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
function fixture(overrides: Partial<CompilerLoadHarnessDependenciesForTest> = {}) {
  const clock = new Clock();
  const child = new FakeChild();
  const calls = { roots: 0, preparations: 0, spawns: 0, removals: 0, inspections: 0 };
  const deps: CompilerLoadHarnessDependenciesForTest = {
    runtime: { version: "v24.19.0", platform: "linux", arch: "x64" },
    createRoot: async () => { calls.roots++; return "/owned-fixture"; },
    inspectRoot: async () => { calls.inspections++; return { dev: 1, ino: 2, directory: true, symlink: false }; },
    prepareFixture: async () => { calls.preparations++; return "/owned-fixture/bootstrap.mjs"; },
    removeRoot: async () => { calls.removals++; },
    spawnChild: () => { calls.spawns++; return child; },
    now: () => clock.current, setTimer: clock.set, clearTimer: clock.clear,
    ...overrides,
  };
  const run = createCompilerLoadHarnessForTest(deps);
  const start = async () => {
    const result = run("snapshot_baseline");
    await flush();
    child.emit("spawn");
    return { result };
  };
  return { clock, child, calls, deps, run, start };
}
function assertFailed(result: CompilerLoadParentResult, reason: string,
  termination = "confirmed", cleanup = "removed"): void {
  assert.deepEqual(result, { status: "failed", reason, report: null, termination, cleanup });
}

test("compiler load invalid input and unsupported runtime never create or spawn", async () => {
  const f = fixture();
  for (const value of [undefined, null, {}, [], "unknown", "../snapshot_baseline", 0])
    assertFailed(await f.run(value), "INVALID_CASE", "not_started", "not_created");
  assert.equal(f.calls.roots, 0);
  for (const runtime of [{ version: "v24.18.0", platform: "linux", arch: "x64" },
    { version: "v24.19.0", platform: "win32", arch: "x64" }, { version: "v24.19.0", platform: "linux", arch: "arm64" }]) {
    const other = fixture({ runtime });
    assert.deepEqual(await other.run("snapshot_baseline"), { status: "unsupported", reason: "RUNTIME_UNSUPPORTED",
      report: null, termination: "not_started", cleanup: "not_created" });
    assert.equal(other.calls.roots, 0);
  }
});

test("compiler load success waits for close and confirmed cleanup, including post-exit bytes", async () => {
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

test("compiler load invalid framing after exit fails without sending signals after close", async () => {
  const f = fixture(); const { result } = await f.start();
  f.child.output(); f.child.emit("exit", 0, null); f.child.stdout.emit("data", Buffer.from("extra"));
  f.child.emit("close", 0, null);
  assertFailed(await result, "INVALID_REPORT"); assert.deepEqual(f.child.signals, []);
});

test("compiler load raw stdout 2048 and 2049 boundaries never become padded report success", async () => {
  for (const count of [2_048, 2_049]) {
    const f = fixture(); const { result } = await f.start();
    f.child.stdout.emit("data", Buffer.alloc(2_047, 32));
    f.child.stdout.emit("data", Buffer.alloc(count - 2_047, 32));
    assert.deepEqual(f.child.signals, count === 2_049 ? ["SIGTERM"] : []);
    f.child.close(); assertFailed(await result, count === 2_049 ? "STDOUT_LIMIT" : "INVALID_REPORT");
  }
});

test("compiler load stderr 4096 bytes is counted only, 4097 bytes fails even with a valid report", async () => {
  for (const count of [4_096, 4_097]) {
    const f = fixture(); const { result } = await f.start(); f.child.output();
    f.child.stderr.emit("data", Buffer.alloc(count, 120)); f.child.close();
    const outcome = await result;
    if (count === 4_096) assert.equal(outcome.status, "collected");
    else assertFailed(outcome, "STDERR_LIMIT");
    assert.equal(JSON.stringify(outcome).includes("xxxxxxxx"), false);
  }
});

test("compiler load first failure survives subsequent stderr, timeout and valid output", async () => {
  const f = fixture(); const { result } = await f.start();
  f.child.stdout.emit("data", Buffer.alloc(2_049)); f.child.stderr.emit("data", Buffer.alloc(4_097));
  f.child.output(); f.child.close(7);
  assertFailed(await result, "STDOUT_LIMIT"); assert.deepEqual(f.child.signals, ["SIGTERM"]);
});

test("compiler load nonzero and signal exits discard otherwise valid reports", async () => {
  for (const [code, signal, reason] of [[7, null, "EXIT_FAILURE"], [null, "SIGTERM", "SIGNAL_EXIT"]] as const) {
    const f = fixture(); const { result } = await f.start(); f.child.output(); f.child.close(code, signal);
    assertFailed(await result, reason); assert.deepEqual(f.child.signals, []);
  }
});

test("compiler load monotonic deadline is 10000ms, with independent term and kill grace", async () => {
  const f = fixture(); const { result } = await f.start();
  f.clock.advance(9_999); assert.deepEqual(f.child.signals, []);
  f.clock.advance(1); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  f.clock.advance(999); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  f.clock.advance(1); assert.deepEqual(f.child.signals, ["SIGTERM", "SIGKILL"]);
  f.child.close(null, "SIGKILL");
  assertFailed(await result, "DEADLINE_EXCEEDED"); assert.equal(f.clock.timers.size, 0);
});

test("compiler load deadline is checked on close even if the timer callback has not run", async () => {
  for (const elapsed of [9_999, 10_000]) {
    const f = fixture(); const { result } = await f.start(); f.child.output();
    f.clock.current = elapsed; f.child.close(); const outcome = await result;
    if (elapsed === 9_999) assert.equal(outcome.status, "collected"); else assertFailed(outcome, "DEADLINE_EXCEEDED");
    assert.deepEqual(f.child.signals, []);
  }
});

test("compiler load exit before timeout disables both signal guards but does not prove close", async () => {
  const f = fixture(); const { result } = await f.start(); f.child.output(); f.child.emit("exit", 0, null);
  f.clock.advance(12_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, []); assert.equal(f.calls.removals, 0);
  assertFailed(await f.run("snapshot_baseline"), "DEADLINE_EXCEEDED", "not_started", "not_created");
  assert.equal(f.calls.spawns, 1);
});

test("compiler load exit during TERM grace prevents later KILL but still collects close", async () => {
  const f = fixture(); const { result } = await f.start(); f.clock.advance(10_000);
  f.child.emit("exit", null, "SIGTERM"); f.clock.advance(1_000);
  assert.deepEqual(f.child.signals, ["SIGTERM"]); f.child.emit("close", null, "SIGTERM");
  assertFailed(await result, "DEADLINE_EXCEEDED");
});

test("compiler load successful signal delivery without close retains root and blocks queued child", async () => {
  const f = fixture(); const { result } = await f.start();
  const queued = f.run("snapshot_after_disk_aba"); f.clock.advance(12_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained");
  assertFailed(await queued, "DEADLINE_EXCEEDED", "not_started", "not_created");
  assert.equal(f.calls.spawns, 1); assert.equal(f.calls.removals, 0);
  f.child.close(); await flush(); assert.equal(f.calls.removals, 0);
});

test("compiler load invalid pid, unobserved spawn and already exited children are never signaled", async () => {
  for (const pid of [undefined, 0, -1, Number.NaN, 1.5]) {
    const f = fixture(); f.child.pid = pid; const { result } = await f.start(); f.clock.advance(12_000);
    assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained"); assert.deepEqual(f.child.signals, []);
  }
  const f = fixture(); const result = f.run("snapshot_baseline"); await flush(); f.clock.advance(12_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained"); assert.deepEqual(f.child.signals, []);
});

test("compiler load spawn throws or pre-spawn error is not a running child kill error", async () => {
  const thrown = fixture({ spawnChild: () => { throw new Error("PRIVATE_ERROR"); } });
  assertFailed(await thrown.run("snapshot_baseline"), "SPAWN_FAILURE", "not_started");
  const f = fixture(); f.child.pid = undefined;
  const result = f.run("snapshot_baseline"); await flush();
  f.child.emit("error", new Error("PRIVATE_ERROR")); f.child.emit("close", -2, null);
  assertFailed(await result, "SPAWN_FAILURE", "not_started"); assert.deepEqual(f.child.signals, []);
});

test("compiler load post-spawn error and kill errors never imply termination", async () => {
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

test("compiler load a late spawn is signaled only after spawn confirmation", async () => {
  const f = fixture(); const result = f.run("snapshot_baseline"); await flush();
  f.clock.advance(10_000); assert.deepEqual(f.child.signals, []);
  f.child.emit("spawn"); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  f.child.close(null, "SIGTERM"); assertFailed(await result, "DEADLINE_EXCEEDED");
});

test("compiler load preparation errors are fixed and owned root is removed without spawning", async () => {
  for (const reason of ["FIXTURE_PREPARATION_FAILED", "BOOTSTRAP_LIMIT"] as const) {
    const f = fixture({ prepareFixture: async () => { throw new CompilerLoadPreparationError(reason); } });
    assertFailed(await f.run("snapshot_baseline"), reason, "not_started");
    assert.equal(f.calls.spawns, 0); assert.equal(f.calls.removals, 1);
  }
  const f = fixture({ createRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  assertFailed(await f.run("snapshot_baseline"), "FIXTURE_PREPARATION_FAILED", "not_started", "not_created");
});

test("compiler load root replacement or symlink is retained without deleting another directory", async () => {
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

test("compiler load cleanup rejection preserves first transport failure and blocks additional child", async () => {
  const f = fixture({ removeRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  const { result } = await f.start(); f.child.close(7);
  assertFailed(await result, "EXIT_FAILURE", "confirmed", "retained");
  assertFailed(await f.run("snapshot_baseline"), "CLEANUP_FAILURE", "not_started", "not_created");
  assert.equal(f.calls.spawns, 1); assert.deepEqual(f.child.signals, []);
});

test("compiler load cleanup syscall is attempted once and unknown completion blocks queued child", async () => {
  let removes = 0; let complete: (() => void) | undefined;
  const f = fixture({ removeRoot: () => { removes++; return new Promise<void>((resolve) => { complete = resolve; }); } });
  const { result } = await f.start(); f.child.output(); f.child.close(); const queued = f.run("snapshot_after_disk_aba");
  await flush(); f.clock.advance(999); let settled = false; void result.then(() => { settled = true; });
  await flush(); assert.equal(settled, false); f.clock.advance(1);
  assertFailed(await result, "CLEANUP_UNCONFIRMED", "confirmed", "unconfirmed");
  assertFailed(await queued, "CLEANUP_UNCONFIRMED", "not_started", "not_created");
  assert.equal(removes, 1); assert.equal(f.calls.spawns, 1); assert.deepEqual(f.child.signals, []);
  complete?.(); await flush(); assertFailed(await f.run("snapshot_after_disk_aba"), "CLEANUP_UNCONFIRMED", "not_started", "not_created");
});

test("compiler load stalled cleanup identity check times out and cannot initiate a late remove", async () => {
  let inspections = 0; let complete: ((value: { dev: number; ino: number; directory: boolean; symlink: boolean }) => void) | undefined;
  const identity = { dev: 1, ino: 2, directory: true, symlink: false };
  const f = fixture({ inspectRoot: () => ++inspections === 1 ? Promise.resolve(identity)
    : new Promise((resolve) => { complete = resolve; }) });
  const { result } = await f.start(); f.child.output(); f.child.close(); await flush(); f.clock.advance(1_000);
  assertFailed(await result, "CLEANUP_UNCONFIRMED", "confirmed", "unconfirmed");
  complete?.(identity); await flush(); assert.equal(f.calls.removals, 0);
});

test("compiler load pre-spawn error with an allocated pid does not assert not-started or delete root", async () => {
  const f = fixture(); const result = f.run("snapshot_baseline"); await flush();
  f.child.emit("error", new Error("PRIVATE_ERROR")); f.clock.advance(2_000);
  assertFailed(await result, "EXIT_FAILURE", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, []); assert.equal(f.calls.removals, 0);
});

test("compiler load stream errors latch failure and later valid report cannot replace it", async () => {
  for (const stream of ["stdout", "stderr"] as const) {
    const f = fixture(); const { result } = await f.start();
    f.child[stream].emit("error", new Error("PRIVATE_ERROR")); f.child.output(); f.child.close();
    assertFailed(await result, "EXIT_FAILURE"); assert.deepEqual(f.child.signals, ["SIGTERM"]);
  }
});

test("compiler load no actual close status and inconsistent close status are not success", async () => {
  const f = fixture(); const { result } = await f.start(); f.child.output(); f.child.emit("close", null, null);
  assertFailed(await result, "EXIT_FAILURE", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, []); assert.equal(f.calls.removals, 0);
  const other = fixture(); const started = await other.start(); other.child.output();
  other.child.emit("exit", 0, null); other.child.emit("close", 1, null);
  assertFailed(await started.result, "EXIT_FAILURE"); assert.deepEqual(other.child.signals, []);
});

test("compiler load TERM-triggered close is consumed before scheduling any further signal", async () => {
  const f = fixture(); const { result } = await f.start();
  f.child.onKill = () => { f.child.close(null, "SIGTERM"); return true; };
  f.clock.advance(10_000);
  assertFailed(await result, "DEADLINE_EXCEEDED");
  assert.deepEqual(f.child.signals, ["SIGTERM"]); assert.equal(f.clock.timers.size, 0);
});

test("compiler load rechecks the owned pid immediately before escalation", async () => {
  const f = fixture(); const { result } = await f.start(); f.clock.advance(10_000);
  f.child.pid = undefined; f.clock.advance(2_000);
  assertFailed(await result, "DEADLINE_EXCEEDED", "unconfirmed", "retained");
  assert.deepEqual(f.child.signals, ["SIGTERM"]);
});

test("compiler load initial root identity failure retains it without preparing or deleting", async () => {
  const f = fixture({ inspectRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  assertFailed(await f.run("snapshot_baseline"), "FIXTURE_PREPARATION_FAILED", "not_started", "retained");
  assert.equal(f.calls.preparations, 0); assert.equal(f.calls.spawns, 0); assert.equal(f.calls.removals, 0);
  assertFailed(await f.run("snapshot_baseline"), "CLEANUP_FAILURE", "not_started", "not_created");
});

test("compiler load cleanup failure without transport failure has its own fixed reason", async () => {
  const f = fixture({ removeRoot: async () => { throw new Error("PRIVATE_ERROR"); } });
  const { result } = await f.start(); f.child.output(); f.child.close();
  assertFailed(await result, "CLEANUP_FAILURE", "confirmed", "retained"); assert.deepEqual(f.child.signals, []);
});

test("compiler load an early deadline callback re-arms against the monotonic boundary", async () => {
  const f = fixture(); const { result } = await f.start();
  const early = [...f.clock.timers.values()][0]; assert.ok(early);
  f.clock.timers.clear(); f.clock.current = 9_999.25; early.callback();
  assert.deepEqual(f.child.signals, []);
  assert.equal([...f.clock.timers.values()][0]?.at, 10_000.25);
  f.clock.current = 10_000; f.child.output(); f.child.close();
  assertFailed(await result, "DEADLINE_EXCEEDED");
});

test("compiler load cleanup deadline is enforced before a delayed timer callback", async () => {
  let complete: (() => void) | undefined;
  const f = fixture({ removeRoot: () => new Promise<void>((resolve) => { complete = resolve; }) });
  const { result } = await f.start(); f.child.output(); f.child.close(); await flush();
  f.clock.current = 1_000; complete?.();
  assertFailed(await result, "CLEANUP_UNCONFIRMED", "confirmed", "unconfirmed");
  assert.equal(f.clock.timers.size, 0);
});
