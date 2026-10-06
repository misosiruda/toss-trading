import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createPaperSimulationRun } from "../api/paperSimulationRuns.js";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import test, { type TestContext } from "node:test";
import { simulationConfig, simulationHeaders, simulationServer } from "../api/paperSimulationTestFixtures.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { acceptPaperSimulation, paperSimulationObservationPath, readPaperSimulationObservation } from "./paperSimulationObservationStore.js";
import { PAPER_SIMULATION_RUNTIME_FILE, paperSimulationRequestPath, readPaperSimulationRequest } from "./paperSimulationRequestStore.js";
const id = "paper_sim_20261006120000000_fixture";
const time = "2026-10-06T12:00:00.000Z";
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "canonical-paper-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, storage: join(root, "paper") };
}
async function snapshot(root: string): Promise<unknown> {
  const result: unknown[] = [];
  for (const name of (await fs.readdir(root)).sort()) {
    const path = join(root, name); const stat = await fs.lstat(path);
    result.push([name, stat.mtimeMs, stat.isDirectory() ? await snapshot(path) : await fs.readFile(path, "hex")]);
  }
  return result;
}
test("durable canonical preserves whole batch random window, original omissions and caller decimals before acceptance", async t => {
  const { root, storage } = await fixture(t);
  const config = { ...simulationConfig(), runType: "batch_replay" as const, executionCosts: { feeBps: 0, taxBps: 2.5, slippageBps: 0.125 } };
  delete config.runCount;
  await acceptPaperSimulation(storage, id, time, { requestedConfig: config });
  const before = await snapshot(root);
  const read = await readPaperSimulationRequest(storage, id);
  assert.equal(read.status, "available");
  if (read.status !== "available") return;
  assert.deepEqual(read.requestedConfig, config);
  assert.equal("runCount" in read.requestedConfig, false);
  assert.equal(read.batchId, id); assert.equal(read.acceptedAt, time);
  const raw = JSON.parse(await fs.readFile(paperSimulationRequestPath(storage, id), "utf8"));
  assert.equal(createReplayResearchHash(raw), read.canonicalRequestHash);
  const event = JSON.parse((await fs.readFile(paperSimulationObservationPath(storage, id), "utf8")).trim());
  assert.equal(event.canonicalRequestHash, read.canonicalRequestHash);
  const observation = await readPaperSimulationObservation(storage, id);
  assert.equal(observation.status, "available"); assert.equal("canonicalRequestHash" in observation, false);
  assert.deepEqual(await snapshot(root), before);
});
test("legacy, child, latest and missing evidence never allocate or reconstruct a request", async t => {
  const { root, storage } = await fixture(t);
  const before = await snapshot(root);
  for (const target of [id, "latest", id + "/child", "../escape"]) assert.equal((await readPaperSimulationRequest(storage, target)).status, "unavailable");
  assert.deepEqual(await snapshot(root), before);
  await acceptPaperSimulation(storage, id, time);
  const legacy = await snapshot(root);
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
  assert.deepEqual(await snapshot(root), legacy);
});
test("masking never persists original credential-shaped values and disables request restoration", async t => {
  const { storage } = await fixture(t);
  const secret = "abcdefghijklmnop.abcdefgh.ijklmnop";
  await acceptPaperSimulation(storage, id, time, { requestedConfig: { ...simulationConfig(), decisionProvider: { ...simulationConfig().decisionProvider, modelId: secret } } });
  const raw = await fs.readFile(paperSimulationRequestPath(storage, id), "utf8");
  assert.equal(raw.includes(secret), false); assert.equal(JSON.parse(raw).redacted, true);
  const read = await readPaperSimulationRequest(storage, id);
  assert.equal(read.status, "unavailable"); assert.equal("requestedConfig" in read, false);
});
for (const change of ["hash", "batch", "runtime", "unknown", "version", "oversized", "torn", "acceptance", "lock"] as const) {
  test("fail closed without repair on " + change, async t => {
    const { root, storage } = await fixture(t);
    await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
    const path = paperSimulationRequestPath(storage, id);
    const raw = JSON.parse(await fs.readFile(path, "utf8"));
    if (change === "hash") raw.requestedConfig.capital.initialCashKrw += 1;
    if (change === "batch") raw.batchId = "paper_sim_20261006120000000_other";
    if (change === "runtime") raw.sourceRuntime.sourceRuntimeId = "00000000-0000-4000-8000-000000000000";
    if (change === "unknown") raw.requestedConfig.unknown = "ignored is forbidden";
    if (change === "version") raw.schemaVersion = "future";
    await fs.writeFile(path, change === "oversized" ? "x".repeat(16_385) : change === "torn" ? "{" : JSON.stringify(raw));
    if (change === "acceptance") await fs.writeFile(paperSimulationObservationPath(storage, id), "{}");
    if (change === "lock") await fs.mkdir(paperSimulationObservationPath(storage, id) + ".paper-log.lock");
    const before = await snapshot(root);
    assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
    assert.deepEqual(await snapshot(root), before);
  });
}
test("unaliased canonical evidence rejects a hard link", async t => {
  const { root, storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  await fs.link(paperSimulationRequestPath(storage, id), join(root, "alias"));
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
});
test("HTTP create starts one runner after durable exact request, GET is read-only and HEAD/malformed queries cannot read", async t => {
  const { root, storage } = await fixture(t); let runs = 0; let runnerRequestStatus: string | undefined;
  const server = await simulationServer({ storageBaseDir: storage, env: {}, now: () => new Date(time), paperSimulationRunner: async input => {
    runs++; runnerRequestStatus = (await readPaperSimulationRequest(storage, input.batchId)).status;
    return { mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId, status: "completed", outputDir: "synthetic", manifestPath: "synthetic", runsPath: "synthetic" };
  } });
  t.after(server.close);
  const input = { ...simulationConfig(), privateHeader: "discard unknown JSON" };
  const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(input) });
  assert.equal(response.status, 202); const accepted = await response.json() as { batchId: string };
  const before = await snapshot(root);
  const query = "/paper/simulations/request?simulationRunId=" + accepted.batchId;
  const read = await fetch(server.baseUrl + query); assert.equal(read.status, 200);
  const body = await read.json() as { status: string; requestedConfig: unknown };
  assert.equal(body.status, "available"); assert.deepEqual(body.requestedConfig, simulationConfig());
  assert.equal(runs, 1); assert.equal(runnerRequestStatus, "available");
  for (const suffix of ["", "?simulationRunId=latest", "?simulationRunId=" + accepted.batchId + "&simulationRunId=" + accepted.batchId, "?simulationRunId=" + accepted.batchId + "&extra=1"]) {
    const bad = await fetch(server.baseUrl + "/paper/simulations/request" + suffix); assert.equal(bad.status, 400); await bad.text();
  }
  const head = await fetch(server.baseUrl + query, { method: "HEAD" }); assert.equal(head.status, 405);
  assert.deepEqual(await snapshot(root), before);
});
test("source runtime corruption blocks admission with 503 and zero runner, keeping reserved barrier", async t => {
  const { storage } = await fixture(t);
  const batchRoot = dirname(dirname(paperSimulationRequestPath(storage, id)));
  await fs.mkdir(batchRoot, { recursive: true }); await fs.writeFile(join(batchRoot, PAPER_SIMULATION_RUNTIME_FILE), "{}");
  let runs = 0;
  const server = await simulationServer({ storageBaseDir: storage, env: {}, now: () => new Date(time), paperSimulationRunner: async () => { runs++; throw Error("must not run"); } });
  t.after(server.close);
  const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST", headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(simulationConfig()) });
  assert.equal(response.status, 503); const body = await response.json() as { error: string }; assert.equal(body.error, "paper_simulation_admission_failed");
  assert.equal(runs, 0);
  const dirs = (await fs.readdir(batchRoot)).filter(name => name.startsWith("paper_sim_")); assert.equal(dirs.length, 1);
  assert.deepEqual(await fs.readdir(join(batchRoot, dirs[0]!)), []);
});

test("canonical file fsync failure returns 503, leaves bytes and reservation but no acceptance or runner", async t => {
  const { storage } = await fixture(t); let runs = 0;
  const originalOpen = fs.open;
  const mocked = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith("paper-simulation-request.json") && typeof args[1] === "number") {
      t.mock.method(handle, "sync", async () => { throw Object.assign(Error("synthetic-private-error"), { code: "EIO" }); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const options = { storageBaseDir: storage, env: {}, now: () => new Date(time), paperSimulationRunner: async () => { runs++; throw Error("must not run"); } };
  try {
    await assert.rejects(createPaperSimulationRun(simulationConfig(), options), (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 503);
    assert.equal(runs, 0);
    const batchRoot = dirname(dirname(paperSimulationRequestPath(storage, id)));
    const ids = (await fs.readdir(batchRoot)).filter(name => name.startsWith("paper_sim_"));
    assert.equal(ids.length, 1); assert.deepEqual(await fs.readdir(join(batchRoot, ids[0]!)), ["paper-simulation-request.json"]);
    assert.equal((await readPaperSimulationRequest(storage, ids[0]!)).status, "unavailable");
    mocked.mock.restore(); syncBuiltinESMExports();
    await assert.rejects(createPaperSimulationRun(simulationConfig(), options), (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 409);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});
test("canonical file fsync completes before acceptance, 202 and runner dispatch", async t => {
  const { storage } = await fixture(t); const originalOpen = fs.open;
  let entered!: () => void, release!: () => void, settled = false, runs = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mocked = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith("paper-simulation-request.json") && typeof args[1] === "number") {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => { entered(); await gate; await sync(); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const options = { storageBaseDir: storage, env: {}, now: () => new Date(time), paperSimulationRunner: async () => { runs++; throw Error("synthetic runner ends"); } };
  const create = createPaperSimulationRun(simulationConfig(), options).then(value => { settled = true; return value; });
  try {
    await started; assert.equal(settled, false); assert.equal(runs, 0);
    const batchRoot = dirname(dirname(paperSimulationRequestPath(storage, id)));
    const ids = (await fs.readdir(batchRoot)).filter(name => name.startsWith("paper_sim_"));
    await assert.rejects(fs.lstat(paperSimulationObservationPath(storage, ids[0]!)), { code: "ENOENT" });
    release(); const accepted = await create;
    assert.equal(accepted.status, "accepted"); assert.equal(runs, 1);
    // The rejected synthetic runner is contained; wait for its durable failure before fixture cleanup.
    for (let i = 0; i < 100; i++) {
      const observed = await readPaperSimulationObservation(storage, accepted.batchId);
      if (observed.status === "available" && observed.outcome === "runner_failed") break;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  } finally { release(); await create; mocked.mock.restore(); syncBuiltinESMExports(); }
});
test("copying same-ID request and acceptance to a different source runtime stays unavailable", async t => {
  const a = await fixture(t), b = await fixture(t);
  for (const f of [a, b]) await acceptPaperSimulation(f.storage, id, time, { requestedConfig: simulationConfig() });
  for (const path of [paperSimulationRequestPath, paperSimulationObservationPath]) await fs.writeFile(path(b.storage, id), await fs.readFile(path(a.storage, id)));
  assert.equal((await readPaperSimulationRequest(b.storage, id)).status, "unavailable");
  assert.equal((await readPaperSimulationRequest(a.storage, id)).status, "available");
});
test("invalid UTF-8 and an expired read budget fail closed without mutation", async t => {
  const { storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  let tick = 0; const clock = t.mock.method(performance, "now", () => { tick += 1001; return tick; });
  try { assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable"); } finally { clock.mock.restore(); }
  await fs.writeFile(paperSimulationRequestPath(storage, id), Buffer.from([0xff]));
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
});

test("an existing runtime marker still requires file fsync before another admission", async t => {
  const { storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  const originalOpen = fs.open;
  const mocked = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith(PAPER_SIMULATION_RUNTIME_FILE) && typeof args[1] === "number") {
      t.mock.method(handle, "sync", async () => { throw Object.assign(Error("synthetic-marker-sync"), { code: "EIO" }); });
    }
    return handle;
  });
  syncBuiltinESMExports(); let runs = 0;
  const config = simulationConfig(); config.window.seed = "another";
  try {
    await assert.rejects(createPaperSimulationRun(config, { storageBaseDir: storage, env: {}, now: () => new Date(time), paperSimulationRunner: async () => { runs++; throw Error("must not run"); } }),
      (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 503);
    assert.equal(runs, 0);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});
test("a correctly rehashed request from another Node version is unavailable", async t => {
  const { storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  const path = paperSimulationRequestPath(storage, id);
  const record = JSON.parse(await fs.readFile(path, "utf8")); record.sourceRuntime.nodeVersion = "v0.0.0";
  await fs.writeFile(path, JSON.stringify(record));
  const event = JSON.parse((await fs.readFile(paperSimulationObservationPath(storage, id), "utf8")).trim());
  event.canonicalRequestHash = createReplayResearchHash(record);
  await fs.writeFile(paperSimulationObservationPath(storage, id), JSON.stringify(event) + "\n");
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
});

test("a batch directory alias is rejected without reading through the alias", async t => {
  const { root, storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  const batch = dirname(paperSimulationRequestPath(storage, id)), moved = join(root, "moved");
  await fs.rename(batch, moved); await fs.symlink(moved, batch, process.platform === "win32" ? "junction" : "dir");
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
});
test("a canonical symlink is rejected", { skip: process.platform === "win32" ? "Windows file symlink requires privileges; Linux verification required" : false }, async t => {
  const { root, storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  const path = paperSimulationRequestPath(storage, id), moved = join(root, "moved");
  await fs.rename(path, moved); await fs.symlink(moved, path);
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
});
test("byte-identical canonical replacement during a read is unavailable", async t => {
  const { root, storage } = await fixture(t);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  const path = paperSimulationRequestPath(storage, id), bytes = await fs.readFile(path);
  const originalOpen = fs.open; let replaced = false;
  const mocked = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === path && typeof args[1] === "number") {
      const read = handle.read.bind(handle);
      t.mock.method(handle, "read", async (...readArgs: Parameters<typeof handle.read>) => {
        const result = await read(...readArgs);
        if (!replaced) { replaced = true; await fs.rename(path, join(root, "original")); await fs.writeFile(path, bytes); }
        return result;
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try { assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable"); assert.equal(replaced, true); }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});
