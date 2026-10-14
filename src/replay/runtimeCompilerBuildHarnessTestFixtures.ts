// Test-only process owner. Never imported by production runners or public APIs.
import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { EventEmitter } from "node:events";
import {
  prepareCompilerBuildFixture, CompilerBuildPreparationError,
} from "./runtimeCompilerBuildPreparationTestFixtures.js";
import {
  isCompilerBuildCaseId, parseCompilerBuildReport,
  COMPILER_BUILD_STDOUT_LIMIT, COMPILER_BUILD_STDERR_LIMIT,
  type CompilerBuildCaseId, type CompilerBuildFailureReason,
  type CompilerBuildParentResult, type CompilerBuildReport,
} from "./runtimeCompilerBuildProtocolTestFixtures.js";

const EXECUTION_MS = 10_000;
const GRACE_MS = 1_000;
export const COMPILER_BUILD_ALLOCATION_LIMIT = 40;
const CHILD_ENV = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C", NODE_DISABLE_COMPILE_CACHE: "1" });
type FailedResult = Extract<CompilerBuildParentResult, { status: "failed" }>;
type RootIdentity = { dev: number; ino: number; directory: boolean; symlink: boolean };
// The dependency seam is only for deterministic unit faults. The ordinary entry point has no options.
export interface CompilerBuildOwnedChildForTest extends EventEmitter {
  readonly pid?: number | undefined;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  kill(signal: NodeJS.Signals): boolean;
}
export interface CompilerBuildHarnessDependenciesForTest {
  runtime: { version: string; platform: string; arch: string };
  createRoot(caseId: CompilerBuildCaseId): Promise<string>;
  inspectRoot(root: string): Promise<RootIdentity>;
  prepareFixture(caseId: CompilerBuildCaseId, root: string): Promise<string>;
  spawnChild(bootstrap: string, caseId: CompilerBuildCaseId, root: string): CompilerBuildOwnedChildForTest;
  now(): number;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(timer: unknown): void;
}
interface Capture {
  failure: CompilerBuildFailureReason | null;
  termination: FailedResult["termination"];
  bytes: Buffer | null;
}
function failed(reason: CompilerBuildFailureReason, termination: FailedResult["termination"],
  cleanup: FailedResult["cleanup"]): FailedResult {
  return { status: "failed", reason, report: null, termination, cleanup };
}
function sameRoot(first: RootIdentity, next: RootIdentity): boolean {
  return first.directory && !first.symlink && next.directory && !next.symlink
    && first.dev === next.dev && first.ino === next.ino;
}

type RootObservation = { status: "observed"; identity: RootIdentity } | { status: "failed" | "unconfirmed" };
// A bounded read-only observation cannot authorize a later pathname deletion.
function observeRoot(deps: CompilerBuildHarnessDependenciesForTest, root: string,
  expected?: RootIdentity): Promise<RootObservation> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: unknown;
    const deadline = deps.now() + GRACE_MS;
    const settle = (outcome: RootObservation): void => {
      if (settled) return;
      settled = true;
      deps.clearTimer(timer);
      resolve(deps.now() >= deadline ? { status: "unconfirmed" } : outcome);
    };
    const armTimer = (): void => {
      if (settled) return;
      const remaining = deadline - deps.now();
      if (remaining <= 0) settle({ status: "unconfirmed" });
      else timer = deps.setTimer(armTimer, Math.ceil(remaining));
    };
    armTimer();
    void (async () => {
      try {
        const current = await deps.inspectRoot(root);
        if (settled) return;
        if (!current.directory || current.symlink || (expected !== undefined && !sameRoot(expected, current))) {
          settle({ status: "failed" }); return;
        }
        settle({ status: "observed", identity: current });
      } catch { settle({ status: "failed" }); }
    })();
  });
}

function captureChild(deps: CompilerBuildHarnessDependenciesForTest, bootstrap: string,
  caseId: CompilerBuildCaseId, root: string): Promise<Capture> {
  return new Promise((resolve) => {
    let child: CompilerBuildOwnedChildForTest;
    const t0 = deps.now();
    try { child = deps.spawnChild(bootstrap, caseId, root); }
    catch { resolve({ failure: "SPAWN_FAILURE", termination: "not_started", bytes: null }); return; }
    let spawned = false;
    let spawnFailed = false;
    let exited = false;
    let closed = false;
    let finished = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let failure: CompilerBuildFailureReason | null = null;
    let stdoutLength = 0;
    let stderrLength = 0;
    const chunks: Buffer[] = [];
    let deadlineTimer: unknown;
    let graceTimer: unknown;
    let phase: "running" | "term" | "kill" = "running";
    let termSent = false;
    let killSent = false;
    const signalOwned = (signal: "SIGTERM" | "SIGKILL"): void => {
      if (!spawned || spawnFailed || exited || closed || finished || !Number.isInteger(child.pid)
        || (child.pid ?? 0) <= 0) return;
      if (signal === "SIGTERM" ? termSent : killSent) return;
      if (signal === "SIGTERM") termSent = true; else killSent = true;
      try { if (!child.kill(signal)) failure ??= "EXIT_FAILURE"; }
      catch { failure ??= "EXIT_FAILURE"; }
      // kill success/error is never treated as exit or close evidence.
    };
    const finish = (termination: Capture["termination"]): void => {
      if (finished) return;
      finished = true;
      deps.clearTimer(deadlineTimer);
      deps.clearTimer(graceTimer);
      resolve({ failure, termination, bytes: failure === null ? Buffer.concat(chunks) : null });
      chunks.length = 0;
    };
    const beginFailure = (): void => {
      if (phase !== "running" || finished || closed) return;
      phase = "term";
      deps.clearTimer(deadlineTimer);
      signalOwned("SIGTERM");
      if (finished || closed) return;
      graceTimer = deps.setTimer(() => {
        if (finished || closed) return;
        phase = "kill";
        signalOwned("SIGKILL");
        if (finished || closed) return;
        graceTimer = deps.setTimer(() => {
          if (finished || closed) return;
          finish(spawnFailed ? "not_started" : "unconfirmed");
        }, GRACE_MS);
      }, GRACE_MS);
    };
    const latch = (reason: CompilerBuildFailureReason): void => {
      failure ??= reason;
      chunks.length = 0;
      beginFailure();
    };
    const checkDeadline = (): void => {
      if (!finished && deps.now() - t0 >= EXECUTION_MS) latch("DEADLINE_EXCEEDED");
    };
    child.on("spawn", () => {
      if (finished || spawnFailed) return;
      spawned = true;
      checkDeadline();
      if (phase === "term") signalOwned("SIGTERM");
      if (phase === "kill") signalOwned("SIGKILL");
    });
    child.on("error", () => {
      if (finished) return;
      if (!spawned && child.pid === undefined) {
        spawnFailed = true;
        checkDeadline();
        latch("SPAWN_FAILURE");
      } else {
        checkDeadline();
        latch("EXIT_FAILURE");
      }
    });
    const receive = (stream: "stdout" | "stderr", chunk: unknown): void => {
      if (finished) return;
      checkDeadline();
      if (!Buffer.isBuffer(chunk)) { latch("INVALID_REPORT"); return; }
      const limit = stream === "stdout" ? COMPILER_BUILD_STDOUT_LIMIT : COMPILER_BUILD_STDERR_LIMIT;
      const total = (stream === "stdout" ? stdoutLength : stderrLength) + chunk.byteLength;
      if (stream === "stdout") stdoutLength = Math.min(total, limit + 1);
      else stderrLength = Math.min(total, limit + 1);
      if (total > limit) { latch(stream === "stdout" ? "STDOUT_LIMIT" : "STDERR_LIMIT"); return; }
      if (stream === "stdout" && failure === null) chunks.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", (chunk: unknown) => receive("stdout", chunk));
    child.stderr?.on("data", (chunk: unknown) => receive("stderr", chunk));
    const streamError = (): void => { if (!finished) { checkDeadline(); latch("EXIT_FAILURE"); } };
    child.stdout?.on("error", streamError);
    child.stderr?.on("error", streamError);
    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      exited = true;
      exitCode = code;
      exitSignal = signal;
      checkDeadline();
      if (signal !== null) latch("SIGNAL_EXIT");
      else if (code !== 0) latch("EXIT_FAILURE");
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return;
      closed = true;
      checkDeadline();
      if (spawnFailed) { failure ??= "SPAWN_FAILURE"; finish("not_started"); return; }
      if (!spawned || (code === null && signal === null)) {
        failure ??= "EXIT_FAILURE"; finish("unconfirmed"); return;
      }
      if (signal !== null) failure ??= "SIGNAL_EXIT";
      else if (code !== 0) failure ??= "EXIT_FAILURE";
      if (exited && (exitCode !== code || exitSignal !== signal)) failure ??= "EXIT_FAILURE";
      finish("confirmed");
    });
    if (child.stdout === null || child.stderr === null) latch("SPAWN_FAILURE");
    const armDeadline = (): void => {
      if (finished || phase !== "running") return;
      const remaining = EXECUTION_MS - (deps.now() - t0);
      if (remaining <= 0) latch("DEADLINE_EXCEEDED");
      else deadlineTimer = deps.setTimer(armDeadline, Math.ceil(remaining));
    };
    armDeadline();
  });
}

export function createCompilerBuildHarnessForTest(deps: CompilerBuildHarnessDependenciesForTest):
  (caseId: unknown) => Promise<CompilerBuildParentResult> {
  let halted: CompilerBuildFailureReason | null = null;
  let allocations = 0;
  // Serial ownership consumes the finite budget before allocation and retains every failure.
  let queue: Promise<void> = Promise.resolve();
  async function run(caseInput: unknown): Promise<CompilerBuildParentResult> {
    if (!isCompilerBuildCaseId(caseInput)) return failed("INVALID_CASE", "not_started", "not_created");
    if (halted !== null) return failed(halted, "not_started", "not_created");
    if (deps.runtime.version !== "v24.19.0" || deps.runtime.platform !== "linux" || deps.runtime.arch !== "x64") {
      return { status: "unsupported", reason: "RUNTIME_UNSUPPORTED", report: null,
        termination: "not_started", cleanup: "not_created" };
    }
    if (allocations >= COMPILER_BUILD_ALLOCATION_LIMIT) {
      halted = "ALLOCATION_LIMIT";
      return failed(halted, "not_started", "not_created");
    }
    allocations++;
    let root: string;
    try { root = await deps.createRoot(caseInput); }
    catch {
      halted = "FIXTURE_PREPARATION_FAILED";
      return failed(halted, "not_started", "not_created");
    }
    const initial = await observeRoot(deps, root);
    if (initial.status !== "observed") {
      halted = initial.status === "unconfirmed" ? "ROOT_OBSERVATION_UNCONFIRMED" : "ROOT_OBSERVATION_FAILURE";
      return failed(halted, "not_started", "cleanup_not_performed");
    }
    const identity = initial.identity;
    let capture: Capture = { failure: "FIXTURE_PREPARATION_FAILED", termination: "not_started", bytes: null };
    let bootstrap: string | undefined;
    try {
      bootstrap = await deps.prepareFixture(caseInput, root);
    } catch (error) {
      capture = { failure: error instanceof CompilerBuildPreparationError
        && error.reason === "BOOTSTRAP_LIMIT" ? "BOOTSTRAP_LIMIT" : "FIXTURE_PREPARATION_FAILED",
      termination: "not_started", bytes: null };
    }
    if (bootstrap !== undefined) {
      // A failed lifecycle observer cannot be relabeled as pre-spawn preparation failure.
      capture = await captureChild(deps, bootstrap, caseInput, root).catch((): Capture => ({
        failure: "EXIT_FAILURE", termination: "unconfirmed", bytes: null,
      }));
    }
    if (capture.failure !== null || capture.termination !== "confirmed") {
      halted = capture.failure ?? "EXIT_FAILURE";
      return failed(halted, capture.termination, "cleanup_not_performed");
    }
    let report: CompilerBuildReport;
    try { report = parseCompilerBuildReport(capture.bytes ?? Buffer.alloc(0), caseInput); }
    catch {
      halted = "INVALID_REPORT";
      return failed(halted, "confirmed", "cleanup_not_performed");
    }
    if (report.status === "rejected" && (report.artifactRestoration === "unconfirmed" || report.inputRestoration === "unconfirmed")) {
      halted = "RESTORE_UNCONFIRMED";
      return { status: "failed", reason: halted, report, termination: "confirmed", cleanup: "cleanup_not_performed" };
    }
    const observation = (await observeRoot(deps, root, identity)).status;
    if (observation !== "observed") {
      halted = observation === "unconfirmed" ? "ROOT_OBSERVATION_UNCONFIRMED" : "ROOT_OBSERVATION_FAILURE";
      return failed(halted, "confirmed", "cleanup_not_performed");
    }
    return { status: "collected", report, termination: "confirmed", cleanup: "cleanup_not_performed" };
  }
  return (caseId) => {
    const result = queue.then(() => run(caseId));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
const preservedRoots: { caseId: CompilerBuildCaseId; root: string }[] = [];
/** Local test evidence only, never serialized into the child protocol. */
export function compilerBuildPreservedRootsForTest(): readonly Readonly<{ caseId: CompilerBuildCaseId; root: string }>[] {
  return preservedRoots.map(record => ({ ...record }));
}
const realHarness = createCompilerBuildHarnessForTest({
  runtime: { version: process.version, platform: process.platform, arch: process.arch },
  createRoot: async (caseId) => {
    const root = await mkdtemp(join(tmpdir(), "runtime-compiler-build-"));
    preservedRoots.push({ caseId, root });
    return root;
  },
  inspectRoot: async (root) => {
    const stat = await lstat(root);
    return { dev: stat.dev, ino: stat.ino, directory: stat.isDirectory(), symlink: stat.isSymbolicLink() };
  },
  prepareFixture: prepareCompilerBuildFixture,
  spawnChild: (bootstrap, caseId, root): ChildProcess => spawn(process.execPath, [bootstrap, caseId], {
    cwd: root, env: { ...CHILD_ENV }, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }),
  now: () => performance.now(),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (timer) => { if (timer !== undefined) clearTimeout(timer as NodeJS.Timeout); },
});
export function runCompilerBuild(caseId: unknown): Promise<CompilerBuildParentResult> {
  return realHarness(caseId);
}
