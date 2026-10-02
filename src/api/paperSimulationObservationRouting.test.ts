import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { acceptPaperSimulation, paperSimulationObservationPath } from "../storage/paperSimulationObservationStore.js";
import { readBatchReplayRuns } from "./localOperationsReaders.js";
import { simulationServer } from "./paperSimulationTestFixtures.js";

const id = "paper_sim_20261002000000000_routing";
const acceptedAt = "2026-10-02T00:00:00.000Z";

// HEAD has no response body: observe whether the real HTTP route opened the exact
// observation file, as well as checking GET's projection for the same request.
test("HTTP GET and HEAD keep exact observation IDs separate from normalized legacy run lookup", async (context) => {
  const root = await fs.mkdtemp(join(tmpdir(), "simulation-observation-routing-"));
  const storageBaseDir = join(root, "paper");
  await acceptPaperSimulation(storageBaseDir, id, acceptedAt);
  const observationPath = paperSimulationObservationPath(storageBaseDir, id);
  const outputDir = dirname(observationPath);
  const runId = `${id}_run_000000`;
  const runDir = join(outputDir, "runs", runId);
  const runsPath = join(outputDir, "batch-replay-runs.jsonl");
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(runsPath, `${JSON.stringify({ runId, batchId: id, storageBaseDir: runDir, status: "completed" })}\n`);
  await fs.writeFile(join(outputDir, "batch-replay-manifest.json"), JSON.stringify({
    batchId: id, status: "completed", runsPath, completedAt: acceptedAt
  }));
  await fs.writeFile(join(runDir, "historical-replay-progress.json"), JSON.stringify({ status: "completed" }));
  await fs.mkdir(storageBaseDir);
  await fs.writeFile(join(storageBaseDir, "batch-replay-aggregate-report.json"), JSON.stringify({ sourceRunsPath: runsPath }));
  const server = await simulationServer({ storageBaseDir, env: {} });
  const before = await snapshot(root);
  const originalOpen = fs.open;
  let observationOpens = 0;
  const open = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === observationPath) observationOpens += 1;
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  const queries = [
    "", "runId", "runId=", "runId=%20", "runId=+", "runId=%0A", "runId=%09%0D%0A",
    `runId=${id}`, `runId=%70${id.slice(1)}`, // URL decoding once still yields the exact ID.
    `runId=%20${id}`, `runId=${id}%20`, `runId=%20${id}%20`,
    `runId=${id}%0A`, `runId=%0A${id}`, `runId=+${id}+`,
    `runId=%2520${id}%2520`, `runId=%20${runId}%20`
  ];
  try {
    for (const query of queries) {
      const path = `/batch/replay/runs?includeLatestRunArtifacts=1${query ? `&${query}` : ""}`;
      const decoded = new URL(path, server.baseUrl).searchParams.get("runId");
      const normalized = decoded?.trim() || null;
      const exact = decoded === id;
      for (const method of ["GET", "HEAD"] as const) {
        observationOpens = 0;
        const response = await fetch(`${server.baseUrl}${path}`, { method });
        assert.equal(response.status, 200, `${method} ${query}`);
        const text = await response.text();
        assert.equal(observationOpens, exact ? 1 : 0, `${method} ${query} must not read aliased evidence`);
        if (method === "HEAD") { assert.equal(text, ""); continue; }
        const body = JSON.parse(text) as Record<string, unknown>;
        const observation = body["simulationObservation"];
        if (decoded === null) assert.equal(observation, null, query);
        else if (exact) {
          assert.equal((observation as { status: string }).status, "available", query);
          assert.equal((observation as { outcome: string }).outcome, "unknown", query);
        } else assert.deepEqual(observation, { status: "invalid", simulationRunId: decoded }, query);
        assert.equal(body["count"], 1, query);
        assert.equal(body["totalCount"], 1, query);
        const matching = normalized === id || normalized === runId;
        assert.equal((body["selectedRun"] as { runId: string } | null)?.runId ?? null, matching ? runId : null, query);
        const artifacts = body["latestRunArtifacts"] as { runId: string; status: string } | null;
        assert.equal(artifacts?.runId ?? null, matching || normalized === null ? runId : null, query);
        if (artifacts) assert.equal(artifacts.status, "ok", query);
      }
    }
    assert.deepEqual(await snapshot(root), before);
  } finally {
    open.mock.restore(); syncBuiltinESMExports();
    await server.close(); await fs.rm(root, { recursive: true, force: true });
  }
});

test("explicit null observation lookup differs from empty and omitted override values", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "simulation-observation-raw-option-"));
  const storageBaseDir = join(root, "paper");
  await acceptPaperSimulation(storageBaseDir, id, acceptedAt);
  try {
    assert.equal((await readBatchReplayRuns(storageBaseDir, 10, { runId: null }))["simulationObservation"], null);
    assert.equal((await readBatchReplayRuns(storageBaseDir, 10, { runId: id, observationRunId: null }))["simulationObservation"], null);
    const empty = await readBatchReplayRuns(storageBaseDir, 10, { runId: id, observationRunId: "" });
    assert.deepEqual(empty["simulationObservation"], { status: "invalid", simulationRunId: "" });
    const omitted = await readBatchReplayRuns(storageBaseDir, 10, { runId: id });
    assert.equal((omitted["simulationObservation"] as { status: string }).status, "available");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

async function snapshot(path: string): Promise<unknown> {
  const stat = await fs.lstat(path);
  const metadata = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
  if (stat.isFile()) return { ...metadata, bytes: (await fs.readFile(path)).toString("base64") };
  const entries = await fs.readdir(path); entries.sort();
  return { ...metadata, entries: await Promise.all(entries.map(async (name) => [name, await snapshot(join(path, name))])) };
}
