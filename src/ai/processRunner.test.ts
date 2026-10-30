import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";
import { NodeProcessRunner, PROCESS_RUN_LIMITS, type ProcessRunOptions } from "./processRunner.js";

const runner = new NodeProcessRunner();
const run = (code: string, options: Partial<ProcessRunOptions> = {}) =>
  runner.run(process.execPath, ["--input-type=commonjs", "-e", code], { timeoutMs: 10_000, ...options });

test("process runner preserves bounded stdout stderr and stdin", async () => {
  const result = await run('process.stdin.pipe(process.stdout); process.stderr.write("diagnostic");', { stdin: "fixture input" });
  assert.equal(result.stdout, "fixture input");
  assert.equal(result.stderr, "diagnostic");
  assert.equal(result.exitCode, 0);
  assert.equal(result.termination, "closed");
  assert.equal(result.failureReason, undefined);
});

for (const stream of ["stdout", "stderr"] as const) {
  for (const bytes of [7, 8, 9]) {
    test(`process runner ${stream} boundary ${bytes} bytes`, async () => {
      const result = await run(`process.${stream}.write("x".repeat(${bytes}));`,
        { maxStdoutBytes: 8, maxStderrBytes: 8 });
      assert.equal(result.termination, "closed");
      if (bytes <= 8) {
        assert.equal(result[stream], "x".repeat(bytes));
        assert.equal(result.failureReason, undefined);
      } else {
        assert.equal(result.failureReason, `${stream}_limit`);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
    });
  }
}

test("byte accounting preserves split UTF8 and rejects cumulative multibyte overflow", async () => {
  const script = 'const b=Buffer.from("가나"); process.stdout.write(b.subarray(0,2)); setTimeout(()=>process.stdout.end(b.subarray(2)),20);';
  const exact = await run(script, { maxStdoutBytes: 6 });
  assert.equal(exact.stdout, "가나");
  assert.equal(exact.failureReason, undefined);
  const exceeded = await run(script, { maxStdoutBytes: 5 });
  assert.equal(exceeded.failureReason, "stdout_limit");
  assert.equal(exceeded.stdout, "");
});

test("process runner timeout confirms direct child close and discards output", async () => {
  const result = await run('process.stdout.write("partial");setInterval(()=>{},1000);', { timeoutMs: 500 });
  assert.equal(result.failureReason, "timeout");
  assert.equal(result.timedOut, true);
  assert.equal(result.termination, "closed");
  assert.equal(result.stdout, "");
});

test("output rejection closes a child even when it installs a SIGTERM handler", async () => {
  // POSIX needs SIGKILL; Windows terminates directly. Both must confirm close.
  const result = await run('process.on("SIGTERM",()=>{});process.stdout.write("overflow");setInterval(()=>{},1000);',
    { maxStdoutBytes: 2, terminationGraceMs: 50, killGraceMs: 2000 });
  assert.equal(result.failureReason, "stdout_limit");
  assert.equal(result.termination, "closed");
  assert.equal(result.stdout, "");
});

test("missing executable returns fixed failure without exposing command or error", async () => {
  const result = await runner.run("missing-fixture-executable-840", [], { timeoutMs: 1000 });
  assert.equal(result.failureReason, "spawn_failed");
  assert.equal(result.termination, "not_started");
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("normal nonzero exit remains distinguishable from transport failure", async () => {
  const result = await run('process.stderr.write("fixture");process.exitCode=7;');
  assert.equal(result.exitCode, 7);
  assert.equal(result.failureReason, undefined);
  assert.equal(result.termination, "closed");
});

test("process limits reject invalid input before spawn", async () => {
  for (const invalid of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    await assert.rejects(runner.run("must-not-spawn", [], { timeoutMs: invalid }), /invalid process execution limit/);
  }
  for (const key of ["maxStdoutBytes", "maxStderrBytes", "terminationGraceMs", "killGraceMs"]) {
    await assert.rejects(run("", { [key]: Infinity }), /invalid process execution limit/);
  }
  assert.equal(PROCESS_RUN_LIMITS.maxStdoutBytes, 8 * 1024 * 1024);
  assert.equal(PROCESS_RUN_LIMITS.maxStderrBytes, 256 * 1024);
});

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined = 840;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: NodeJS.Signals[] = [];
  unreferenced = false;
  behavior: "silent" | "false" | "throw" | "error" | "close" = "silent";
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.behavior === "throw") throw new Error("must not leak");
    if (this.behavior === "error") this.emit("error", new Error("must not leak"));
    if (this.behavior === "close") this.emit("close", 0);
    return this.behavior !== "false";
  }
  unref(): void { this.unreferenced = true; }
}

test("lifecycle failures have bounded settlement and never signal an observed exited child", async (t) => {
  for (const behavior of ["silent", "false", "throw", "error", "close", "exited", "pipe_error"] as const) {
    await t.test(behavior, async (context) => {
      const child = new FakeChild();
      if (behavior !== "exited" && behavior !== "pipe_error") child.behavior = behavior;
      const mock = context.mock.method(childProcess, "spawn", () => child as unknown as ReturnType<typeof childProcess.spawn>);
      syncBuiltinESMExports();
      try {
        const started = performance.now();
        const pending = runner.run("fixture", [], { timeoutMs: 25, terminationGraceMs: 10, killGraceMs: 10 });
        if (behavior === "exited") { child.exitCode = 0; child.emit("exit", 0); }
        if (behavior === "pipe_error") child.stdin.emit("error", new Error("private fixture"));
        const result = await pending;
        assert.ok(performance.now() - started < 2000, "settlement must not depend on close arriving");
        assert.equal(result.termination, behavior === "close" ? "closed" : "unconfirmed");
        assert.equal(result.failureReason, behavior === "pipe_error" ? "process_error" : "timeout");
        assert.equal(result.terminationRequestFailed, ["false", "throw", "error"].includes(behavior));
        assert.deepEqual(child.signals, behavior === "exited" ? [] : behavior === "close" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        if (behavior !== "close") {
          assert.equal(child.unreferenced, true);
          assert.equal(child.stdout.destroyed, true);
          assert.equal(child.stderr.destroyed, true);
        }
        child.emit("error", new Error("late"));
        child.emit("close", 0);
        assert.equal(result.termination, behavior === "close" ? "closed" : "unconfirmed");
      } finally {
        mock.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
});
