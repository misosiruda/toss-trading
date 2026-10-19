// Test-only process owner. Never imported by production runners or public APIs.
import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { EventEmitter } from "node:events";
import {
  prepareCompilerLoadFixture, CompilerLoadPreparationError,
} from "./runtimeCompilerLoadPreparationTestFixtures.js";
import {
  isCompilerLoadCaseId, parseCompilerLoadReport,
  COMPILER_LOAD_STDOUT_LIMIT, COMPILER_LOAD_STDERR_LIMIT,
  type CompilerLoadCaseId, type CompilerLoadFailureReason,
  type CompilerLoadParentResult, type CompilerLoadReport,
} from "./runtimeCompilerLoadProtocolTestFixtures.js";

const EXECUTION_MS = 10_000;
const GRACE_MS = 1_000;
const CHILD_ENV = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C", NODE_DISABLE_COMPILE_CACHE: "1" });
type FailedResult = Extract<CompilerLoadParentResult, { status: "failed" }>;
type RootIdentity = { dev: number; ino: number; directory: boolean; symlink: boolean };

// This bounded, test-only snapshot is not runtime admission evidence. The handle and the
// original returned Promise identify one invocation, including queued calls of the same case.
declare const compilerLoadObservationBrand: unique symbol;
export interface CompilerLoadObservationForTest {
  readonly [compilerLoadObservationBrand]: true;
}
type CleanupPhase = "pre_inspect" | "inspect_pending" | "inspect_observed"
  | "remove_pending" | "remove_observed";
type CleanupTrigger = "timer" | "inspect" | "remove" | "error";
type CleanupErrorPhase = "inspect" | "identity" | "remove";
export interface CompilerLoadCleanupSnapshotForTest {
  readonly availability: "available";
  readonly caseId: CompilerLoadCaseId;
  readonly phase: CleanupPhase;
  readonly inspectSubmitted: boolean;
  readonly removeRequests: 0 | 1;
  readonly settlementTrigger: CleanupTrigger;
  readonly errorPhase: CleanupErrorPhase | null;
  readonly deadline: number;
  readonly postInspectAt: number | null;
  readonly settleAt: number;
  readonly outcome: "removed" | "retained" | "unconfirmed";
  readonly parsedStatus: CompilerLoadReport["status"] | null;
  readonly parsedRejection: Extract<CompilerLoadReport, { status: "rejected" }>["reason"] | null;
}
interface ObservationState {
  claimed: boolean;
  run: Promise<CompilerLoadParentResult> | null;
  snapshot: Readonly<CompilerLoadCleanupSnapshotForTest> | null;
}
const observations = new WeakMap<object, ObservationState>();
const observationUnavailable = Object.freeze({ availability: "unavailable" as const });
export function createCompilerLoadObservationForTest(): CompilerLoadObservationForTest {
  const handle = Object.freeze({}) as CompilerLoadObservationForTest;
  observations.set(handle, { claimed: false, run: null, snapshot: null });
  return handle;
}
function claimObservation(handle: unknown): ObservationState | undefined {
  if (typeof handle !== "object" || handle === null) return undefined;
  const state = observations.get(handle);
  if (state === undefined || state.claimed) return undefined;
  state.claimed = true;
  return state;
}
export function readCompilerLoadObservationForTest(handle: unknown, run: Promise<CompilerLoadParentResult>):
  Readonly<CompilerLoadCleanupSnapshotForTest> | typeof observationUnavailable {
  if (typeof handle !== "object" || handle === null) return observationUnavailable;
  const state = observations.get(handle);
  return state !== undefined && state.run === run && state.snapshot !== null
    ? state.snapshot : observationUnavailable;
}
function keepCleanupSnapshot(state: ObservationState | undefined, snapshot: CompilerLoadCleanupSnapshotForTest): void {
  if (state === undefined || state.snapshot !== null) return;
  // Diagnostic failure cannot relabel the harness result. No path, wire bytes, or Error text is retained.
  try {
    if (!Number.isFinite(snapshot.deadline) || !Number.isFinite(snapshot.settleAt)
      || (snapshot.postInspectAt !== null && !Number.isFinite(snapshot.postInspectAt))) return;
    state.snapshot = Object.freeze(snapshot);
  } catch { /* The reader reports unavailable; the original verdict is preserved. */ }
}
// The dependency seam is only for deterministic unit faults. Observation handles cannot configure execution.
export interface CompilerLoadOwnedChildForTest extends EventEmitter {
  readonly pid?: number | undefined;
  stdout: EventEmitter | null;
  stderr: EventEmitter | null;
  kill(signal: NodeJS.Signals): boolean;
}
export interface CompilerLoadHarnessDependenciesForTest {
  runtime: { version: string; platform: string; arch: string };
  createRoot(): Promise<string>;
  inspectRoot(root: string): Promise<RootIdentity>;
  prepareFixture(caseId: CompilerLoadCaseId, root: string): Promise<string>;
  removeRoot(root: string): Promise<void>;
  spawnChild(bootstrap: string, caseId: CompilerLoadCaseId, root: string): CompilerLoadOwnedChildForTest;
  now(): number;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(timer: unknown): void;
}
interface Capture {
  failure: CompilerLoadFailureReason | null;
  termination: FailedResult["termination"];
  bytes: Buffer | null;
}
function failed(reason: CompilerLoadFailureReason, termination: FailedResult["termination"],
  cleanup: FailedResult["cleanup"]): FailedResult {
  return { status: "failed", reason, report: null, termination, cleanup };
}
function sameRoot(first: RootIdentity, next: RootIdentity): boolean {
  return first.directory && !first.symlink && next.directory && !next.symlink
    && first.dev === next.dev && first.ino === next.ino;
}

function captureChild(deps: CompilerLoadHarnessDependenciesForTest, bootstrap: string,
  caseId: CompilerLoadCaseId, root: string): Promise<Capture> {
  return new Promise((resolve) => {
    let child: CompilerLoadOwnedChildForTest;
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
    let failure: CompilerLoadFailureReason | null = null;
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
    const latch = (reason: CompilerLoadFailureReason): void => {
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
      const limit = stream === "stdout" ? COMPILER_LOAD_STDOUT_LIMIT : COMPILER_LOAD_STDERR_LIMIT;
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

export function createCompilerLoadHarnessForTest(deps: CompilerLoadHarnessDependenciesForTest):
  (caseId: unknown, observation?: CompilerLoadObservationForTest) => Promise<CompilerLoadParentResult> {
  let halted: CompilerLoadFailureReason | null = null;
  // Serial ownership prevents concurrent callers from launching past an unresolved cleanup.
  let queue: Promise<void> = Promise.resolve();
  async function run(caseInput: unknown, observation: ObservationState | undefined): Promise<CompilerLoadParentResult> {
    if (!isCompilerLoadCaseId(caseInput)) return failed("INVALID_CASE", "not_started", "not_created");
    if (halted !== null) return failed(halted, "not_started", "not_created");
    if (deps.runtime.version !== "v24.19.0" || deps.runtime.platform !== "linux" || deps.runtime.arch !== "x64") {
      return { status: "unsupported", reason: "RUNTIME_UNSUPPORTED", report: null,
        termination: "not_started", cleanup: "not_created" };
    }
    let root: string;
    try { root = await deps.createRoot(); }
    catch { return failed("FIXTURE_PREPARATION_FAILED", "not_started", "not_created"); }
    let identity: RootIdentity;
    try {
      identity = await deps.inspectRoot(root);
      if (!identity.directory || identity.symlink) throw new Error("UNSAFE_ROOT");
    } catch {
      halted = "CLEANUP_FAILURE";
      return failed("FIXTURE_PREPARATION_FAILED", "not_started", "retained");
    }
    let capture: Capture = { failure: "FIXTURE_PREPARATION_FAILED", termination: "not_started", bytes: null };
    let bootstrap: string | undefined;
    try {
      bootstrap = await deps.prepareFixture(caseInput, root);
    } catch (error) {
      capture = { failure: error instanceof CompilerLoadPreparationError
        && error.reason === "BOOTSTRAP_LIMIT" ? "BOOTSTRAP_LIMIT" : "FIXTURE_PREPARATION_FAILED",
      termination: "not_started", bytes: null };
    }
    if (bootstrap !== undefined) {
      // A failed lifecycle observer cannot be relabeled as pre-spawn preparation failure.
      capture = await captureChild(deps, bootstrap, caseInput, root).catch((): Capture => ({
        failure: "EXIT_FAILURE", termination: "unconfirmed", bytes: null,
      }));
    }
    if (capture.termination === "unconfirmed") {
      halted = capture.failure ?? "EXIT_FAILURE";
      return failed(halted, "unconfirmed", "retained");
    }
    let report: CompilerLoadReport | null = null;
    if (capture.failure === null) {
      try { report = parseCompilerLoadReport(capture.bytes ?? Buffer.alloc(0), caseInput); }
      catch { capture.failure = "INVALID_REPORT"; }
    }
    // Identity verification is part of cleanup's bounded observation, not an unbounded prelude.
    const cleanup = await new Promise<"removed" | "retained" | "unconfirmed">((resolve) => {
      let settled = false;
      let timer: unknown;
      let phase: CleanupPhase = "pre_inspect";
      let inspectSubmitted = false;
      let removeRequests: 0 | 1 = 0;
      let errorPhase: CleanupErrorPhase = "inspect";
      let postInspectAt: number | null = null;
      const deadline = deps.now() + GRACE_MS;
      const settle = (outcome: "removed" | "retained" | "unconfirmed", trigger: CleanupTrigger): void => {
        if (settled) return;
        settled = true;
        deps.clearTimer(timer);
        const settleAt = deps.now();
        const decided = settleAt >= deadline ? "unconfirmed" : outcome;
        if (observation !== undefined) keepCleanupSnapshot(observation, {
          availability: "available", caseId: caseInput, phase, inspectSubmitted, removeRequests,
          settlementTrigger: trigger, errorPhase: trigger === "error" ? errorPhase : null,
          deadline, postInspectAt, settleAt, outcome: decided,
          parsedStatus: report?.status ?? null,
          parsedRejection: report?.status === "rejected" ? report.reason : null,
        });
        resolve(decided);
      };
      const armTimer = (): void => {
        if (settled) return;
        const remaining = deadline - deps.now();
        if (remaining <= 0) settle("unconfirmed", "timer");
        else timer = deps.setTimer(armTimer, Math.ceil(remaining));
      };
      armTimer();
      void (async () => {
        try {
          phase = "inspect_pending";
          inspectSubmitted = true;
          const current = await deps.inspectRoot(root);
          if (settled) return; // Do not initiate removal after the observation deadline.
          phase = "inspect_observed";
          postInspectAt = deps.now();
          if (postInspectAt >= deadline) { settle("unconfirmed", "inspect"); return; }
          errorPhase = "identity";
          if (!sameRoot(identity, current)) throw new Error("ROOT_CHANGED");
          phase = "remove_pending";
          errorPhase = "remove";
          removeRequests = 1;
          await deps.removeRoot(root); // One request; no retries after an uncertain outcome.
          phase = "remove_observed";
          settle("removed", "remove");
        } catch { settle("retained", "error"); }
      })();
    });
    if (cleanup !== "removed") {
      const reason = cleanup === "unconfirmed" ? "CLEANUP_UNCONFIRMED" : "CLEANUP_FAILURE";
      halted = reason;
      return failed(capture.failure ?? reason, capture.termination, cleanup);
    }
    if (capture.failure !== null) return failed(capture.failure, capture.termination, "removed");
    if (report === null || capture.termination !== "confirmed") return failed("INVALID_REPORT", capture.termination, "removed");
    return { status: "collected", report, termination: "confirmed", cleanup: "removed" };
  }
  return (caseId, handle) => {
    const observation = claimObservation(handle);
    const result = queue.then(() => run(caseId, observation));
    if (observation !== undefined) observation.run = result;
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}
const realHarness = createCompilerLoadHarnessForTest({
  runtime: { version: process.version, platform: process.platform, arch: process.arch },
  createRoot: () => mkdtemp(join(tmpdir(), "runtime-compiler-load-")),
  inspectRoot: async (root) => {
    const stat = await lstat(root);
    return { dev: stat.dev, ino: stat.ino, directory: stat.isDirectory(), symlink: stat.isSymbolicLink() };
  },
  prepareFixture: prepareCompilerLoadFixture,
  removeRoot: (root) => rm(root, { recursive: true, force: false, maxRetries: 0 }),
  spawnChild: (bootstrap, caseId, root): ChildProcess => spawn(process.execPath, [bootstrap, caseId], {
    cwd: root, env: { ...CHILD_ENV }, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }),
  now: () => performance.now(),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (timer) => { if (timer !== undefined) clearTimeout(timer as NodeJS.Timeout); },
});
export function runCompilerLoad(caseId: unknown, observation?: CompilerLoadObservationForTest): Promise<CompilerLoadParentResult> {
  return realHarness(caseId, observation);
}
