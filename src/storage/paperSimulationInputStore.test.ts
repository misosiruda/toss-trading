import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { syncBuiltinESMExports } from "node:module";
import { simulationConfig, simulationHeaders, simulationServer } from "../api/paperSimulationTestFixtures.js";
import type { PaperSimulationRunnerInput } from "../api/paperSimulationRuns.js";
import { resolvePaperSimulationConfig } from "../api/paperSimulationConfig.js";
import { paperSimulationRequestPath, readPaperSimulationRequest } from "./paperSimulationRequestStore.js";
import { acceptPaperSimulation, paperSimulationObservationPath } from "./paperSimulationObservationStore.js";
import { paperSimulationInputPath, readPaperSimulationInput } from "./paperSimulationInputStore.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import type { TestContext } from "node:test";

const id = "paper_sim_20261007090000000_ux02a-fixture";
const time = "2026-10-07T09:00:00.000Z";
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "simulation-input-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, storage: join(root, "paper") };
}
async function admit(storage: string, config = simulationConfig()) {
  const snapshot = resolvePaperSimulationConfig(config, { PAPER_SIMULATION_TICK_DELAY_MS: "17" });
  await acceptPaperSimulation(storage, id, time, { requestedConfig: config, inputSnapshot: snapshot });
  return snapshot;
}
async function fingerprint(root: string): Promise<unknown> {
  return Promise.all((await fs.readdir(root)).sort().map(async name => {
    const path = join(root, name), stat = await fs.lstat(path);
    return [name, stat.mtimeMs, stat.isDirectory() ? await fingerprint(path) : await fs.readFile(path, "hex")];
  }));
}
async function rebind(storage: string) {
  const path = paperSimulationObservationPath(storage, id);
  const event = JSON.parse((await fs.readFile(path, "utf8")).trim());
  event.inputProvenanceHash = createReplayResearchHash(JSON.parse(await fs.readFile(paperSimulationInputPath(storage, id), "utf8")));
  await fs.writeFile(path, JSON.stringify(event) + "\n");
}

test("HTTP acceptance durably preserves the exact runner input and notices, including omissions", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "simulation-input-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = join(root, "paper");
  let actual: PaperSimulationRunnerInput | undefined;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let beforeDispatch: Awaited<ReturnType<typeof readPaperSimulationInput>> | undefined;
  const env = { PAPER_SIMULATION_TICK_DELAY_MS: "17" };
  const config = { ...simulationConfig(), runType: "batch_replay" as const,
    executionCosts: { feeBps: 0, taxBps: 2.5, slippageBps: 0.125 } };
  delete config.runCount;
  const expected = resolvePaperSimulationConfig(config, env);
  const server = await simulationServer({ storageBaseDir: storage, env,
    now: () => new Date("2026-10-07T09:00:00.000Z"), paperSimulationRunner: async input => {
      actual = input;
      beforeDispatch = await readPaperSimulationInput(storage, input.batchId);
      finish();
      return { mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId,
        status: "completed", outputDir: "synthetic", manifestPath: "synthetic", runsPath: "synthetic" };
    } });
  t.after(server.close);
  const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
    headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
  assert.equal(response.status, 202);
  const accepted = await response.json() as { batchId: string };
  await finished;
  const path = join(dirname(paperSimulationRequestPath(storage, accepted.batchId)), "paper-simulation-input.json");
  const record = JSON.parse(await fs.readFile(path, "utf8"));
  assert.deepEqual(record.snapshot, expected);
  assert.deepEqual(record.snapshot.requestedConfig, actual?.config);
  assert.deepEqual(record.snapshot.effectiveConfig, actual?.effectiveConfig);
  assert.equal("runCount" in record.snapshot.requestedConfig, false);
  assert.equal(record.snapshot.effectiveConfig.runCount, 5);
  assert.equal(record.snapshot.effectiveConfig.tickDelayMs, 17);
  assert.equal(beforeDispatch?.status, "available");
  env.PAPER_SIMULATION_TICK_DELAY_MS = "5000";
  const before = await fingerprint(root);
  const read = await readPaperSimulationInput(storage, accepted.batchId);
  assert.equal(read.status, "available");
  if (read.status !== "available") return;
  assert.deepEqual(read.snapshot, expected);
  assert.equal(read.childInput, "unavailable"); assert.equal(read.runtime, "unavailable");
  assert.equal(read.source, "unavailable"); assert.equal(read.initialPortfolio, "unavailable");
  assert.equal(read.dependencies, "unavailable");
  assert.equal(read.result, "unavailable"); assert.equal(read.comparability, "unavailable");
  assert.equal(read.inputProvenanceHash, createReplayResearchHash(record));
  assert.equal((await readPaperSimulationRequest(storage, accepted.batchId)).status, "available");
  assert.deepEqual(await fingerprint(root), before);
});

test("legacy canonical and validation remain read-only and do not manufacture admission history", async t => {
  const { root, storage } = await fixture(t);
  const before = await fingerprint(root);
  for (const target of [id, "latest", id + "/child", "../escape"]) {
    assert.equal((await readPaperSimulationInput(storage, target)).status, "unavailable");
  }
  const server = await simulationServer({ storageBaseDir: storage, env: {} }); t.after(server.close);
  const validation = await fetch(server.baseUrl + "/paper/simulations/validate", { method: "POST",
    headers: simulationHeaders(server.baseUrl), body: JSON.stringify(simulationConfig()) });
  assert.equal(validation.status, 200); await validation.text();
  assert.deepEqual(await fingerprint(root), before);
  await acceptPaperSimulation(storage, id, time, { requestedConfig: simulationConfig() });
  const legacy = await fingerprint(root);
  assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable");
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "available");
  assert.deepEqual(await fingerprint(root), legacy);
});

test("all existing risk/window/exit variants preserve snapshots without interpreting current defaults", async t => {
  for (const profile of ["conservative", "balanced", "aggressive_paper"] as const) {
    for (const exit of ["none", "take_profit_stop_loss", "rebalance_threshold"] as const) {
      const { storage } = await fixture(t);
      const config = simulationConfig(); config.riskProfile = profile; config.paperExitPolicy = exit;
      config.window.mode = "fixed_range"; config.runCount = 3; config.universe.market = "us";
      const expected = await admit(storage, config);
      const read = await readPaperSimulationInput(storage, id);
      assert.equal(read.status, "available");
      if (read.status !== "available") continue;
      assert.deepEqual(read.snapshot, expected);
      assert.equal(read.snapshot.requestedConfig.runCount, 3);
      assert.equal(read.snapshot.effectiveConfig.runCount, 1);
      assert.equal(read.snapshot.effectiveConfig.window.windowMonths, null);
      assert.equal("executionCosts" in read.snapshot.requestedConfig, false);
    }
  }
});

for (const change of ["version", "effective-version", "unknown", "nested-unknown", "missing-default",
  "missing-notices", "requested-mismatch", "batch", "canonical-hash", "redacted", "accepted-hash", "lock",
  "oversized", "utf8", "torn-log"] as const) {
  test("admission reader rejects " + change + " without repairing even rehashed evidence", async t => {
    const { root, storage } = await fixture(t); await admit(storage);
    const path = paperSimulationInputPath(storage, id);
    const record = JSON.parse(await fs.readFile(path, "utf8"));
    if (change === "version") record.schemaVersion = "future";
    if (change === "effective-version") record.effectiveSchemaVersion = "future";
    if (change === "unknown") record.unknown = true;
    if (change === "nested-unknown") record.snapshot.effectiveConfig.costModel.executionPolicy.unknown = true;
    if (change === "missing-default") delete record.snapshot.effectiveConfig.costModel.executionPolicy.halfSpreadBps;
    if (change === "missing-notices") delete record.snapshot.notices;
    if (change === "requested-mismatch") record.snapshot.requestedConfig.capital.initialCashKrw += 1;
    if (change === "batch") record.batchId = id + "x";
    if (change === "canonical-hash") record.canonicalRequestHash = "sha256:" + "0".repeat(64);
    if (change === "redacted") record.redacted = true;
    await fs.writeFile(path, JSON.stringify(record));
    await rebind(storage);
    if (change === "accepted-hash") {
      const event = JSON.parse((await fs.readFile(paperSimulationObservationPath(storage, id), "utf8")).trim());
      delete event.inputProvenanceHash;
      await fs.writeFile(paperSimulationObservationPath(storage, id), JSON.stringify(event) + "\n");
    }
    if (change === "lock") await fs.mkdir(paperSimulationObservationPath(storage, id) + ".paper-log.lock");
    if (change === "oversized") await fs.writeFile(path, " ".repeat(32_769));
    if (change === "utf8") await fs.writeFile(path, Buffer.from([255]));
    if (change === "torn-log") await fs.appendFile(paperSimulationObservationPath(storage, id), "{");
    const before = await fingerprint(root);
    assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable");
    assert.deepEqual(await fingerprint(root), before);
  });
}

test("historical admission remains readable across Node changes while canonical clone keeps compatibility gate", async t => {
  const { storage } = await fixture(t); const expected = await admit(storage);
  const canonicalPath = paperSimulationRequestPath(storage, id);
  const canonical = JSON.parse(await fs.readFile(canonicalPath, "utf8"));
  canonical.sourceRuntime.nodeVersion = "v0.0.0";
  await fs.writeFile(canonicalPath, JSON.stringify(canonical));
  const canonicalHash = createReplayResearchHash(canonical);
  const path = paperSimulationInputPath(storage, id);
  const record = JSON.parse(await fs.readFile(path, "utf8")); record.canonicalRequestHash = canonicalHash;
  await fs.writeFile(path, JSON.stringify(record));
  const eventPath = paperSimulationObservationPath(storage, id);
  const event = JSON.parse((await fs.readFile(eventPath, "utf8")).trim()); event.canonicalRequestHash = canonicalHash;
  await fs.writeFile(eventPath, JSON.stringify(event) + "\n"); await rebind(storage);
  const read = await readPaperSimulationInput(storage, id);
  assert.equal(read.status, "available"); assert.deepEqual(read.status === "available" && read.snapshot, expected);
  assert.equal(read.runtime, "unavailable");
  assert.equal((await readPaperSimulationRequest(storage, id)).status, "unavailable");
});

test("credential-shaped request fields are masked at rest and cannot become available input", async t => {
  const { storage } = await fixture(t); const config = simulationConfig();
  const secret = "abcdefghijklmnop.abcdefgh.ijklmnop"; config.decisionProvider.modelId = secret;
  await admit(storage, config);
  const text = await fs.readFile(paperSimulationInputPath(storage, id), "utf8");
  assert.equal(text.includes(secret), false); assert.equal(JSON.parse(text).redacted, true);
  assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable");
});

test("copying admission and canonical evidence into another namespace cannot restore availability", async t => {
  const a = await fixture(t), b = await fixture(t);
  await admit(a.storage); await admit(b.storage);
  for (const path of [paperSimulationInputPath, paperSimulationRequestPath, paperSimulationObservationPath]) {
    await fs.copyFile(path(a.storage, id), path(b.storage, id));
  }
  assert.equal((await readPaperSimulationInput(a.storage, id)).status, "available");
  assert.equal((await readPaperSimulationInput(b.storage, id)).status, "unavailable");
});

test("hardlinked files, aliased directories and exhausted monotonic budgets fail closed", async t => {
  const { root, storage } = await fixture(t); await admit(storage);
  let tick = 0; const clock = t.mock.method(performance, "now", () => { tick += 1001; return tick; });
  try { assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable"); }
  finally { clock.mock.restore(); }
  const path = paperSimulationInputPath(storage, id), alias = join(root, "alias");
  await fs.link(path, alias);
  assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable"); await fs.unlink(alias);
  const moved = join(root, "moved"), dir = dirname(path); await fs.rename(dir, moved);
  await fs.symlink(moved, dir, process.platform === "win32" ? "junction" : "dir");
  assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable");
  await fs.unlink(dir);
});

test("file replacement after reading is detected before returning an available snapshot", async t => {
  const { storage } = await fixture(t); await admit(storage);
  const path = paperSimulationInputPath(storage, id), original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]) === path) {
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => {
        await close(); await fs.rename(path, path + ".old"); await fs.copyFile(path + ".old", path);
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try { assert.equal((await readPaperSimulationInput(storage, id)).status, "unavailable"); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
});
