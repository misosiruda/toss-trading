import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { cp, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { capturePaperExperimentBuild, PAPER_EXPERIMENT_BUILD_RECEIPT } from "../replay/paperExperimentRuntime.js";
import { parsePaperExperimentArguments } from "./paperExperiment.js";

const command = promisify(execFile);
const originalRoot = process.cwd();
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "paper-experiment-cli-"));
  await Promise.all(["src", "dist"].map((name) => cp(join(originalRoot, name), join(root, name), { recursive: true })));
  await mkdir(join(root, "scripts"));
  for (const name of ["package.json", "package-lock.json", "tsconfig.json", ".gitignore", "scripts/paperExperiment.mjs"]) {
    await cp(join(originalRoot, name), join(root, name));
  }
  await symlink(join(originalRoot, "node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  execFileSync("git", ["init", "-q"], { cwd: root }); execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=Experiment Test", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "synthetic test snapshot"], { cwd: root });
  await rm(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT), { force: true });
  return root;
}
async function bind(root: string) {
  // Test harness copies this test build and its exact source into a clean synthetic Git repository.
  // The supported launcher build is exercised separately, rather than claiming these copies are compilation.
  const receipt = await capturePaperExperimentBuild(root);
  await writeFile(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT), JSON.stringify(receipt));
  return receipt;
}
async function cli(root: string, args: string[], options: { launcher?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const entry = options.launcher ? "scripts/paperExperiment.mjs" : "dist/cli/paperExperiment.js";
  try {
    const result = await command(process.execPath, [entry, ...args], { cwd: root, env: options.env ?? process.env, maxBuffer: 2 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  }
}
function last(output: string) { return JSON.parse(output.trim().split("\n").at(-1)!); }
const fixture = "src/replay/fixtures/paper-experiment.v1.json";
async function readTree(path: string): Promise<unknown> {
  try { return Promise.all((await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)).map(async (e) => [e.name,
    e.isDirectory() ? await readTree(join(path, e.name)) : (await readFile(join(path, e.name))).toString("base64")])); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

test("strict argument parser rejects cancel/resume, provider, output, unknown and repeated options", () => {
  for (const args of [["cancel"], ["resume", "--attempt", "exp-old"], ["run", "--input", "a", "--output-dir", "x"],
    ["run", "--provider", "codex"], ["run", "--input", "a", "--input", "b"], ["inspect", "--attempt", "../old"], ["review", "--attempt", "exp-one", "--compare-attempt", "../other"],
    ["review", "--attempt", "exp-one", "--compare-attempt", "exp-two", "--compare-attempt", "exp-three"]]) {
    assert.throws(() => parsePaperExperimentArguments(args));
  }
  assert.deepEqual(parsePaperExperimentArguments(["inspect", "--attempt", "exp-one"]), { command: "inspect", attempt: "exp-one" });
});

test("launcher unsupported commands fail without changing data, dist or receipt", async () => {
  const root = await sandbox(); const before = await readTree(join(root, "dist"));
  for (const args of [["cancel", "--attempt", "exp-one"], ["resume", "--attempt", "exp-one"], ["run", "--input", fixture, "--cancel"]]) {
    const result = await cli(root, args, { launcher: true }); assert.notEqual(result.code, 0); assert.match(result.stderr, /INVALID_COMMAND/);
  }
  assert.deepEqual(await readTree(join(root, "dist")), before); assert.equal(await readTree(join(root, "data")), null);
});

test("run admission rejects missing binding, modified dist, dirty source, lock/Node receipt mismatch", async () => {
  const root = await sandbox();
  assert.equal(last((await cli(root, ["run", "--input", fixture])).stdout).error, "BUILD_UNBOUND");
  const binding = await bind(root);
  const compiled = join(root, "dist/paper/decisionIdentity.js"); const bytes = await readFile(compiled);
  await writeFile(compiled, `${bytes.toString()}\n// stale compiled module\n`);
  assert.equal(last((await cli(root, ["run", "--input", fixture])).stdout).error, "BUILD_UNBOUND"); await writeFile(compiled, bytes);
  for (const altered of [
    { ...binding, runtimeIdentity: { ...binding.runtimeIdentity, nodeVersion: "v22.0.0" } },
    { ...binding, runtimeIdentity: { ...binding.runtimeIdentity, dependencyLockHash: `sha256:${"a".repeat(64)}` } },
    { ...binding, runtimeIdentity: { ...binding.runtimeIdentity, implementationRevision: "b".repeat(40) } },
    { ...binding, sourceHash: `sha256:${"c".repeat(64)}` }
  ]) {
    await writeFile(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT), JSON.stringify(altered));
    assert.equal(last((await cli(root, ["run", "--input", fixture])).stdout).error, "BUILD_UNBOUND");
  }
  await writeFile(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT), JSON.stringify(binding));
  await writeFile(join(root, "src/dirty.ts"), "export const dirty = true;\n");
  assert.equal(last((await cli(root, ["run", "--input", fixture])).stdout).error, "DIRTY_SOURCE");
  assert.equal(await readTree(join(root, "data")), null);
});

test("clean supported launcher builds and binds real HEAD/lock/Node; fresh inspect and retry retain source", async () => {
  const root = await sandbox();
  const validated = await cli(root, ["validate", "--input", fixture], { launcher: true });
  assert.equal(validated.code, 0, validated.stdout + validated.stderr);
  assert.equal(last(validated.stdout).runtimeIdentity.implementationRevision, execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
  assert.equal(last(validated.stdout).runtimeIdentity.nodeVersion, process.version);
  assert.equal(await readTree(join(root, "data")), null);
  const hostile = { ...process.env, AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "live", TRADING_ENABLED: "true", BROKER_PROVIDER: "live",
    CODEX_PATH: "must-not-run", GIT_DIR: join(root, "wrong"), GIT_INDEX_FILE: join(root, "wrong-index"), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "must-not-run" };
  const run = await cli(root, ["run", "--input", fixture], { env: hostile }); assert.equal(run.code, 0, run.stdout + run.stderr);
  const first = last(run.stdout); let before = await readTree(first.artifactRoot);
  const inspected = await cli(root, ["inspect", "--attempt", first.attemptId], { launcher: true });
  assert.equal(inspected.code, 0, inspected.stdout + inspected.stderr); assert.equal(last(inspected.stdout).quality, "usable_fixture");
  assert.deepEqual(await readTree(first.artifactRoot), before);
  const evidenceBefore = { input: await readTree(join(first.artifactRoot, "input")), replay: await readTree(join(first.artifactRoot, "replay")) };
  const distBeforeReview = await readTree(join(root, "dist"));
  const reviewed = await cli(root, ["review", "--attempt", first.attemptId], { launcher: true });
  assert.equal(reviewed.code, 0, reviewed.stdout + reviewed.stderr);
  assert.equal(last(reviewed.stdout).review.execution.status, "completed");
  assert.deepEqual(await readTree(join(root, "dist")), distBeforeReview);
  assert.deepEqual({ input: await readTree(join(first.artifactRoot, "input")), replay: await readTree(join(first.artifactRoot, "replay")) }, evidenceBefore);
  before = await readTree(first.artifactRoot);
  const retry = await cli(root, ["retry", "--attempt", first.attemptId]); assert.equal(retry.code, 0, retry.stdout + retry.stderr);
  assert.notEqual(last(retry.stdout).attemptId, first.attemptId); assert.equal(last(retry.stdout).inputHash, first.inputHash);
  assert.deepEqual(await readTree(first.artifactRoot), before);
  const comparison = await cli(root, ["review", "--attempt", first.attemptId, "--compare-attempt", last(retry.stdout).attemptId], { launcher: true });
  assert.equal(comparison.code, 0, comparison.stdout + comparison.stderr);
  assert.equal(last(comparison.stdout).review.comparison.status, "identical");
  const selfComparison = await cli(root, ["review", "--attempt", first.attemptId, "--compare-attempt", first.attemptId], { launcher: true });
  assert.equal(selfComparison.code, 1); assert.equal(last(selfComparison.stdout).review.comparison.status, "incomparable");
  assert.ok(last(selfComparison.stdout).review.comparison.reasons.includes("DISTINCT_ATTEMPTS_REQUIRED"));
  const secondRoot = await mkdtemp(join(tmpdir(), "paper-experiment-cli-second-root-"));
  for (const name of ["src", "dist", "scripts", ".git", "package.json", "package-lock.json", "tsconfig.json", ".gitignore"]) {
    await cp(join(root, name), join(secondRoot, name), { recursive: true });
  }
  await symlink(join(originalRoot, "node_modules"), join(secondRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  // A root-bound build receipt is regenerated by the supported launcher; source HEAD stays identical.
  const independentRun = await cli(secondRoot, ["run", "--input", fixture], { launcher: true });
  assert.equal(independentRun.code, 0, independentRun.stdout + independentRun.stderr);
  const independentReview = await cli(secondRoot, ["review", "--attempt", last(independentRun.stdout).attemptId], { launcher: true });
  assert.equal(independentReview.code, 0, independentReview.stdout + independentReview.stderr);
  assert.deepEqual(last(independentReview.stdout).review.costs, last(reviewed.stdout).review.costs);
  const { createPaperExperimentReview } = await import("../reports/paperExperimentReview.js");
  const crossRoot = await createPaperExperimentReview({ rootDir: join(root, "data/paper-experiments"), protectedPaths: [] }, first.attemptId,
    { location: { rootDir: join(secondRoot, "data/paper-experiments"), protectedPaths: [] }, attemptId: last(independentRun.stdout).attemptId });
  assert.equal(crossRoot.comparison!.status, "identical");
  before = await readTree(first.artifactRoot);
  await rm(join(root, fixture)); // Existing inspect has no source/build/Git admission and does not repair anything.
  await rm(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT));
  const retained = await cli(root, ["inspect", "--attempt", first.attemptId], { launcher: true }); assert.equal(retained.code, 0);
  const withoutBuild = await cli(root, ["review", "--attempt", first.attemptId, "--compare-attempt", last(retry.stdout).attemptId], { launcher: true });
  assert.equal(withoutBuild.code, 0, withoutBuild.stdout + withoutBuild.stderr);
  assert.equal(last(withoutBuild.stdout).review.comparison.status, "identical");
  before = await readTree(first.artifactRoot);
  assert.equal(last((await cli(root, ["retry", "--attempt", first.attemptId])).stdout).error, "DIRTY_SOURCE");
  assert.deepEqual(await readTree(first.artifactRoot), before);
});

test("revision mismatch, malformed and oversized input allocate no attempt", async () => {
  const root = await sandbox(); await bind(root);
  const inputDir = await mkdtemp(join(tmpdir(), "experiment-bad-input-")); const input = join(inputDir, "input.json");
  const raw = JSON.parse(await readFile(join(root, fixture), "utf8")); raw.implementationRevision = "a".repeat(40);
  for (const [bytes, expected] of [[JSON.stringify(raw), "REVISION_MISMATCH"], ["{", "INVALID_JSON"], ["x".repeat(2 * 1024 * 1024 + 1), "INPUT_INTEGRITY"]]) {
    await writeFile(input, bytes!); const result = await cli(root, ["run", "--input", input!]);
    assert.equal(result.code, 1); assert.equal(last(result.stdout).error, expected);
  }
  assert.equal(await readTree(join(root, "data")), null);
});

for (const signal of ["SIGINT", "SIGKILL"] as const) {
  test(`${signal} preserves partial evidence; fresh inspect stays incomplete and retry uses a new attempt`, { skip: process.platform === "win32" ? "POSIX signal receipt; Windows termination requires its own platform run" : false }, async () => {
    const root = await sandbox(); await bind(root);
    const inputDir = await mkdtemp(join(tmpdir(), "experiment-interrupt-input-")); const input = join(inputDir, "input.json");
    const raw = JSON.parse(await readFile(join(root, fixture), "utf8"));
    raw.configuration.clock.endAt = "2025-01-01T01:39:00.000Z"; raw.configuration.clock.stepSeconds = 60;
    raw.configuration.samplingPolicy.maxDecisionCalls = 100;
    await writeFile(input, JSON.stringify(raw));
    const child = spawn(process.execPath, ["dist/cli/paperExperiment.js", "run", "--input", input], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let id: string | undefined; let artifactRoot: string | undefined;
    let interruptedReplay = false;
    const interruptAfterReplayEvidence = async (path: string) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
        try {
          const evidence = await readFile(join(path, "replay/historical-replay-portfolio-timeline.jsonl"), "utf8");
          if (evidence.trim().length > 0) { interruptedReplay = true; child.kill(signal); return; }
        } catch { /* The recorder has not started yet. */ }
        await delay(2);
      }
    };
    child.stdout.on("data", (chunk) => { stdout += chunk.toString();
      for (const line of stdout.split("\n").filter(Boolean)) {
        const event = JSON.parse(line); if (event.event === "attempt_prepared" && id === undefined) {
          id = event.attemptId; artifactRoot = event.artifactRoot;
          if (signal === "SIGKILL") void interruptAfterReplayEvidence(event.artifactRoot);
          else child.kill(signal);
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((accept, reject) => {
      child.once("error", reject); child.once("exit", (code, exitSignal) => accept({ code, signal: exitSignal }));
    });
    assert.ok(id, stdout + stderr); assert.ok(artifactRoot); assert.equal(result.signal, signal);
    if (signal === "SIGKILL") {
      assert.equal(interruptedReplay, true);
      assert.ok((await readFile(join(artifactRoot, "replay/historical-replay-portfolio-timeline.jsonl"), "utf8")).trim().length > 0);
    }
    let before = await readTree(artifactRoot);
    const inspection = await cli(root, ["inspect", "--attempt", id]); assert.equal(last(inspection.stdout).status, "incomplete");
    assert.deepEqual(await readTree(artifactRoot), before);
    const retainedBeforeReview = { input: await readTree(join(artifactRoot, "input")), replay: await readTree(join(artifactRoot, "replay")) };
    const reviewed = await cli(root, ["review", "--attempt", id], { launcher: true });
    assert.equal(reviewed.code, 1); assert.equal(last(reviewed.stdout).review.execution.status, "incomplete");
    assert.equal(last(reviewed.stdout).review.costs, null);
    assert.deepEqual({ input: await readTree(join(artifactRoot, "input")), replay: await readTree(join(artifactRoot, "replay")) }, retainedBeforeReview);
    before = await readTree(artifactRoot);
    const retry = await cli(root, ["retry", "--attempt", id]); assert.equal(retry.code, 0, retry.stdout + retry.stderr);
    assert.notEqual(last(retry.stdout).attemptId, id); assert.deepEqual(await readTree(artifactRoot), before);
  });
}


test("failed supported build invalidates old receipt and never creates an attempt", async () => {
  const root = await sandbox(); await bind(root);
  await writeFile(join(root, "src/broken.ts"), "export const broken: = ;\n");
  execFileSync("git", ["add", "src/broken.ts"], { cwd: root });
  execFileSync("git", ["-c", "user.name=Experiment Test", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "broken synthetic build"], { cwd: root });
  const result = await cli(root, ["run", "--input", fixture], { launcher: true });
  assert.equal(result.code, 1); assert.match(result.stderr, /BUILD_OR_RUNTIME_FAILED/);
  await assert.rejects(readFile(join(root, PAPER_EXPERIMENT_BUILD_RECEIPT)), { code: "ENOENT" });
  assert.equal(await readTree(join(root, "data")), null);
});


test("launcher rejects nested output symlink and hardlink before compiler can overwrite outside bytes", async () => {
  const root = await sandbox();
  const outside = await mkdtemp(join(tmpdir(), "experiment-alias-sentinel-"));
  const sentinel = join(outside, "decisionIdentity.js"); await writeFile(sentinel, "outside sentinel");
  await rm(join(root, "dist/paper"), { recursive: true });
  await symlink(outside, join(root, "dist/paper"), process.platform === "win32" ? "junction" : "dir");
  const alias = await cli(root, ["run", "--input", fixture], { launcher: true });
  assert.equal(alias.code, 1); assert.match(alias.stderr, /BUILD_UNBOUND/);
  assert.equal(await readFile(sentinel, "utf8"), "outside sentinel");
  await rm(join(root, "dist/paper")); await mkdir(join(root, "dist/paper"));
  await link(sentinel, join(root, "dist/paper/decisionIdentity.js"));
  const hardlink = await cli(root, ["run", "--input", fixture], { launcher: true });
  assert.equal(hardlink.code, 1); assert.match(hardlink.stderr, /BUILD_UNBOUND/);
  assert.equal(await readFile(sentinel, "utf8"), "outside sentinel");
  assert.equal(await readTree(join(root, "data")), null);
});


test("CLI exposes retained attempt path on preparation failure, including failed initial/failure state writes", async () => {
  const root = await sandbox(); await bind(root);
  for (const phase of ["initial_state", "input", "input_and_failure_marker"]) {
    const script = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const original = fs.open.bind(fs); const phase = ${JSON.stringify(phase)};
      fs.open = async (...args) => {
        if ((Number(args[1]) & 1) && String(args[0]).endsWith(phase === 'initial_state' ? 'experiment-run.json' : 'experiment-input.json')) throw new Error('synthetic preparation fault');
        return original(...args);
      };
      if (phase === 'input_and_failure_marker') fs.rename = async () => { throw new Error('synthetic state fault'); };
      syncBuiltinESMExports();
      const {paperExperimentMain} = await import('./dist/cli/paperExperiment.js');
      process.exitCode = await paperExperimentMain(['run', '--input', ${JSON.stringify(fixture)}]);`;
    let stdout = "";
    try { await command(process.execPath, ["--input-type=module", "-e", script], { cwd: root }); assert.fail("fault must fail"); }
    catch (error) { assert.equal((error as {code:number}).code, 1); stdout = (error as {stdout:string}).stdout; }
    const result = last(stdout); assert.equal(result.stage, "preparation"); assert.equal(result.error, "IO_FAILURE");
    assert.equal(typeof result.attemptId, "string"); assert.equal(result.artifactRoot, join(root, "data/paper-experiments", result.attemptId));
    assert.equal(result.failureRecorded, phase === "input");
    const before = await readTree(result.artifactRoot); assert.notEqual(before, null);
    const inspection = await cli(root, ["inspect", "--attempt", result.attemptId]);
    assert.equal(last(inspection.stdout).status, "incomplete"); assert.deepEqual(await readTree(result.artifactRoot), before);
  }
});
