import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";

import { JsonlStore } from "../storage/jsonlStore.js";
import { acceptPaperSimulation, paperSimulationObservationPath, readPaperSimulationObservation } from "../storage/paperSimulationObservationStore.js";
import type { LocalOperationsServerOptions } from "./localOperationsTypes.js";
import { readBatchReplayRuns } from "./localOperationsReaders.js";
import { createPaperSimulationRun, PaperSimulationRequestError, type PaperSimulationRunnerInput, type PaperSimulationRunnerResult } from "./paperSimulationRuns.js";
import { simulationConfig, simulationHeaders, simulationServer } from "./paperSimulationTestFixtures.js";

const acceptedAt = "2026-10-02T00:00:00.000Z";
const expectedId = "paper_sim_20261002000000000_ux02a-fixture";
const secret = "synthetic-token-DO-NOT-PERSIST /private/provider/secret.env";

for (const failure of ["sync", "async"] as const) {
  test(`accepted exact ID retains ${failure} runner rejection before a manifest without error secrets`, async () => {
    const root = await mkdtemp(join(tmpdir(), "simulation-observation-api-"));
    const storageBaseDir = join(root, "paper");
    let calls = 0;
    const error = new Error(secret, { cause: { token: secret } });
    const options: LocalOperationsServerOptions = {
      storageBaseDir, env: {}, now: () => new Date(acceptedAt),
      paperSimulationRunner: (input) => {
        calls += 1;
        assert.equal(input.simulationRunId, expectedId);
        if (failure === "sync") throw error;
        return Promise.reject(error);
      }
    };
    const server = await simulationServer(options);
    try {
      const response = await fetch(`${server.baseUrl}/paper/simulations`, {
        method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"),
        body: JSON.stringify(simulationConfig())
      });
      assert.equal(response.status, 202);
      const accepted = await response.json() as Record<string, unknown>;
      assert.equal(accepted["simulationRunId"], expectedId);
      await waitFor(async () => {
        const observed = await readPaperSimulationObservation(storageBaseDir, expectedId);
        return observed.status === "available" && observed.outcome === "runner_failed";
      });
      const result = await fetch(`${server.baseUrl}/batch/replay/runs?runId=${expectedId}&includeLatestRunArtifacts=1`);
      const body = await result.json() as Record<string, unknown>;
      assert.equal(body["status"], "missing");
      assert.equal(body["batchId"], null);
      assert.equal(body["selectedRun"], null);
      assert.deepEqual(body["runs"], []);
      assert.equal(body["count"], 0);
      assert.deepEqual(body["simulationObservation"], {
        status: "available", schemaVersion: "paper_simulation_observation.v1",
        simulationRunId: expectedId, batchId: expectedId, acceptedAt,
        outcome: "runner_failed", runnerFailure: { observedAt: acceptedAt, reasonCode: "runner_rejected" }
      });
      const bytes = await readFile(paperSimulationObservationPath(storageBaseDir, expectedId), "utf8");
      assert.equal(bytes.trim().split("\n").length, 2);
      assert.doesNotMatch(bytes + JSON.stringify(body) + JSON.stringify(accepted), /DO-NOT-PERSIST|private\/provider|secret\.env|stack|cause/);
      assert.deepEqual(await readdir(dirname(paperSimulationObservationPath(storageBaseDir, expectedId))), ["paper-simulation-observations.jsonl"]);
      assert.equal(calls, 1);
    } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
  });
}

test("accepted append completes before dispatch and 202; options slot is reserved before first await", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "simulation-admission-order-"));
  let release!: () => void;
  let appendEntered!: () => void;
  const entered = new Promise<void>((resolve) => { appendEntered = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const original = JsonlStore.prototype.appendDurably;
  const append = context.mock.method(JsonlStore.prototype, "appendDurably", async function (this: JsonlStore<unknown>, value: unknown) {
    appendEntered(); await blocked; return original.call(this, value);
  });
  let calls = 0;
  let dispatchedObservation: unknown;
  let dispatchFinished = false;
  const storageBaseDir = join(root, "paper");
  const options: LocalOperationsServerOptions = {
    storageBaseDir, env: {}, now: () => new Date(acceptedAt),
    paperSimulationRunner: async (input) => {
      calls += 1;
      dispatchedObservation = await readPaperSimulationObservation(storageBaseDir, input.simulationRunId);
      dispatchFinished = true;
      return runnerResult(input);
    }
  };
  try {
    let settled = false;
    const first = createPaperSimulationRun(simulationConfig(), options).then((value) => { settled = true; return value; });
    await assert.rejects(createPaperSimulationRun(simulationConfig(), options), requestCode("paper_simulation_already_running"));
    await entered;
    assert.equal(settled, false);
    assert.equal(calls, 0);
    release();
    const accepted = await first;
    assert.equal(accepted.status, "accepted");
    await waitFor(() => Promise.resolve(dispatchFinished));
    assert.equal(calls, 1);
    assert.equal((dispatchedObservation as { status: string }).status, "available"); // Lock released before dispatch.
    assert.equal(append.mock.callCount(), 1);
  } finally { release(); append.mock.restore(); await rm(root, { recursive: true, force: true }); }
});

test("accepted persistence failure returns no 202, starts no runner, and preserves the reservation barrier", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "simulation-admission-failed-"));
  const storageBaseDir = join(root, "paper");
  let calls = 0;
  const options: LocalOperationsServerOptions = {
    storageBaseDir, env: {}, now: () => new Date(acceptedAt),
    paperSimulationRunner: async (input) => { calls += 1; return runnerResult(input); }
  };
  const append = context.mock.method(JsonlStore.prototype, "appendDurably", async () => { throw new Error(secret); });
  const server = await simulationServer(options);
  try {
    const response = await fetch(`${server.baseUrl}/paper/simulations`, {
      method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(simulationConfig())
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /paper_simulation_admission_failed/);
    assert.doesNotMatch(body, /DO-NOT-PERSIST|secret\.env/);
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(dirname(paperSimulationObservationPath(storageBaseDir, expectedId))), []);
    append.mock.restore();
    await assert.rejects(createPaperSimulationRun(simulationConfig(), options), requestCode("paper_simulation_id_conflict"));
    assert.equal(calls, 0);
  } finally { append.mock.restore(); await server.close(); await rm(root, { recursive: true, force: true }); }
});

test("restart accepted-only observations stay unknown and repeated GET/HEAD never mutate or rerun", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-restart-"));
  const storageBaseDir = join(root, "paper");
  await acceptPaperSimulation(storageBaseDir, expectedId, acceptedAt);
  let calls = 0;
  const server = await simulationServer({
    storageBaseDir, env: {}, now: () => new Date(acceptedAt),
    paperSimulationRunner: async (input) => { calls += 1; return runnerResult(input); }
  });
  try {
    const before = await treeSnapshot(root);
    for (const method of ["GET", "HEAD", "GET", "HEAD"]) {
      const response = await fetch(`${server.baseUrl}/batch/replay/runs?runId=${expectedId}`, { method });
      assert.equal(response.status, 200);
      if (method === "GET") {
        const body = await response.json() as { simulationObservation: { outcome: string; runnerFailure: unknown } };
        assert.equal(body.simulationObservation.outcome, "unknown");
        assert.equal(body.simulationObservation.runnerFailure, null);
      } else assert.equal(await response.text(), "");
    }
    assert.deepEqual(await treeSnapshot(root), before);
    assert.equal(calls, 0);
    const retry = await fetch(`${server.baseUrl}/paper/simulations`, {
      method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(simulationConfig())
    });
    assert.equal(retry.status, 409);
    await retry.text();
    assert.deepEqual(await treeSnapshot(root), before);
    assert.equal(calls, 0);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});

test("same millisecond, normalized seed and truncated seed collisions preserve every existing byte", async () => {
  for (const seeds of [["same", "same"], ["x/y", "x y"], [`${"a".repeat(32)}1`, `${"a".repeat(32)}2`]]) {
    const root = await mkdtemp(join(tmpdir(), "simulation-id-collision-"));
    const storageBaseDir = join(root, "paper");
    let calls = 0;
    const options = (): LocalOperationsServerOptions => ({
      storageBaseDir, env: {}, now: () => new Date(acceptedAt),
      paperSimulationRunner: async (input) => { calls += 1; return runnerResult(input); }
    });
    try {
      const config = simulationConfig(); config.window.seed = seeds[0]!;
      const accepted = await createPaperSimulationRun(config, options());
      const outputDir = dirname(paperSimulationObservationPath(storageBaseDir, accepted.simulationRunId));
      await writeFile(join(outputDir, "batch-replay-runs.jsonl"), "old-run-bytes\n");
      const before = await treeSnapshot(root);
      config.window.seed = seeds[1]!;
      await assert.rejects(createPaperSimulationRun(config, options()), requestCode("paper_simulation_id_conflict"));
      assert.deepEqual(await treeSnapshot(root), before);
      assert.equal(calls, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("separate processes sharing an ID admit exactly one runner", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-cross-process-"));
  const storageBaseDir = join(root, "paper");
  const code = `
    import { createPaperSimulationRun } from './dist/api/paperSimulationRuns.js';
    import { simulationConfig } from './dist/api/paperSimulationTestFixtures.js';
    import { appendFile } from 'node:fs/promises';
    try {
      await createPaperSimulationRun(simulationConfig(), {
        storageBaseDir: ${JSON.stringify(storageBaseDir)}, env: {}, now: () => new Date(${JSON.stringify(acceptedAt)}),
        paperSimulationRunner: async (input) => { await appendFile(${JSON.stringify(join(root, "runners"))}, 'started\\n'); return {}; }
      });
      console.log('accepted');
    } catch (error) { console.log(error.code); }
  `;
  try {
    const results = await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd() })));
    assert.deepEqual(results.map((result) => result.stdout.trim()).sort(), ["accepted", "paper_simulation_id_conflict"]);
    assert.equal(await readFile(join(root, "runners"), "utf8"), "started\n");
    const observed = await readPaperSimulationObservation(storageBaseDir, expectedId);
    assert.equal(observed.status, "available");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runner failure record rejection is contained without retries or unhandled rejection; the next token stays held", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "simulation-failure-write-"));
  const storageBaseDir = join(root, "paper");
  const original = JsonlStore.prototype.appendDurably;
  let failureWrites = 0;
  const append = context.mock.method(JsonlStore.prototype, "appendDurably", async function (this: JsonlStore<unknown>, value: unknown) {
    if ((value as { event: string }).event === "runner_failed") { failureWrites += 1; throw new Error(secret); }
    return original.call(this, value);
  });
  let calls = 0;
  let finish!: (value: PaperSimulationRunnerResult) => void;
  let activeInput!: PaperSimulationRunnerInput;
  const nextRunner = new Promise<PaperSimulationRunnerResult>((resolve) => { finish = resolve; });
  const options: LocalOperationsServerOptions = {
    storageBaseDir, env: {}, now: () => new Date(acceptedAt),
    paperSimulationRunner: async (input) => {
      calls += 1;
      if (calls === 1) throw new Error(secret);
      activeInput = input;
      return nextRunner;
    }
  };
  try {
    await createPaperSimulationRun(simulationConfig(), options);
    await waitFor(async () => failureWrites === 1 && (await readdir(dirname(paperSimulationObservationPath(storageBaseDir, expectedId)))).length === 1);
    const observed = await readPaperSimulationObservation(storageBaseDir, expectedId);
    assert.equal(observed.status === "available" && observed.outcome, "unknown");
    const config = simulationConfig(); config.window.seed = "next-token";
    await createPaperSimulationRun(config, options);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const third = simulationConfig(); third.window.seed = "third-token";
    await assert.rejects(createPaperSimulationRun(third, options), requestCode("paper_simulation_already_running"));
    assert.equal(calls, 2);
    assert.equal(failureWrites, 1);
    assert.doesNotMatch(await readFile(paperSimulationObservationPath(storageBaseDir, expectedId), "utf8"), /DO-NOT-PERSIST/);
    finish(runnerResult(activeInput)); await nextRunner;
  } finally { append.mock.restore(); await rm(root, { recursive: true, force: true }); }
});

test("observation lookup never adopts aggregate run identity or normalizes the requested ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "simulation-lookup-isolation-"));
  const storageBaseDir = join(root, "paper");
  await mkdir(storageBaseDir);
  await acceptPaperSimulation(storageBaseDir, expectedId, acceptedAt);
  const runsDir = join(root, "batch-replay", "legacy");
  await mkdir(runsDir);
  const runsPath = join(runsDir, "batch-replay-runs.jsonl");
  await writeFile(runsPath, `${JSON.stringify({ runId: "legacy_run", batchId: "legacy", status: "completed" })}\n`);
  await writeFile(join(storageBaseDir, "batch-replay-aggregate-report.json"), JSON.stringify({ sourceRunsPath: runsPath }));
  try {
    const result = await readBatchReplayRuns(storageBaseDir, 10, { runId: expectedId, includeLatestRunArtifacts: true });
    assert.equal(result["selectedRun"], null);
    assert.equal(result["latestRunArtifacts"], null);
    assert.equal(result["count"], 1);
    assert.equal(result["totalCount"], 1);
    assert.equal((result["simulationObservation"] as { outcome: string }).outcome, "unknown");
    const alias = await readBatchReplayRuns(storageBaseDir, 10, { runId: ` ${expectedId} ` });
    assert.equal((alias["simulationObservation"] as { status: string }).status, "invalid");
    assert.equal((await readBatchReplayRuns(storageBaseDir, 10))["simulationObservation"], null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function requestCode(code: string) {
  return (error: unknown) => error instanceof PaperSimulationRequestError && error.code === code;
}
function runnerResult(input: PaperSimulationRunnerInput): PaperSimulationRunnerResult {
  return { mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId,
    status: "completed", outputDir: "fixture", manifestPath: "fixture", runsPath: "fixture" };
}
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = performance.now() + 5000;
  do { if (await condition()) return; await setTimeout(10); } while (performance.now() < deadline);
  assert.fail("observation did not settle");
}
async function treeSnapshot(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const info = await stat(path);
    result[entry.name] = entry.isDirectory() ? { mtimeMs: info.mtimeMs, entries: await treeSnapshot(path) }
      : { mtimeMs: info.mtimeMs, bytes: (await readFile(path)).toString("base64") };
  }
  return result;
}
