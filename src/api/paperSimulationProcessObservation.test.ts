import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME } from "../domain/replayAdmissionLineage.js";
import { REPLAY_PROCESS_OBSERVATION_FILE_NAME } from "../domain/replayProcessObservation.js";
import type { MarketPacket } from "../domain/schemas.js";
import { sourceSnapshot } from "../replay/codexReplaySourceTestFixtures.js";
import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";
import { createBatchReplayArtifactPaths, safeArtifactPathPart } from "../storage/artifactPaths.js";
import { paperSimulationObservationPath } from "../storage/paperSimulationObservationStore.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import type { BatchReplayManifest, BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";
import { admissionAcceptedAt, admissionRoot } from "../workflows/historicalReplayAdmissionTestFixtures.js";
import { assertNoLegacyReplayArtifacts, assertNoProcessObservation, failProcessDurability,
  processFailureMarker, readProcessArtifacts } from "../workflows/historicalReplayProcessObservationTestFixtures.js";
import type { PaperSimulationCreateResponse } from "./paperSimulationRuns.js";
import { simulationConfig, simulationHeaders, simulationServer } from "./paperSimulationTestFixtures.js";

async function httpFixture(t: TestContext, empty = false) {
  const root = await admissionRoot(t), storageBaseDir = join(root, "paper");
  await fs.mkdir("data", { recursive: true });
  const source = await fs.mkdtemp(join("data", "process-observation-fixture-"));
  t.after(() => fs.rm(source, { recursive: true, force: true }));
  const store = new FileHistoricalMarketSnapshotStore(createStoragePaths(source).historicalMarketSnapshotsPath);
  if (!empty) for (const month of ["01", "02", "03"]) {
    const time = `2024-${month}-01T00:00:00+09:00`;
    await store.append(sourceSnapshot({ snapshotId: `process_month_${month}`, observedAt: time, createdAt: time }));
  }
  const config = simulationConfig(); config.sourceDataDir = relative(process.cwd(), source);
  config.window.mode = "fixed_range"; config.window.startAt = "2024-01-01"; config.window.endAt = "2024-01-02";
  config.samplingPolicy.stepSeconds = 2_592_000; config.samplingPolicy.maxDecisionCalls = 2;
  // Only the deterministic decision fixture changes. HTTP, batch, child runner and all observation writers are real.
  const provider = t.mock.method(FirstPricedHistoricalDecisionProvider.prototype, "decide", (packet: MarketPacket) => ({
    packetId: packet.packetId, summary: "Synthetic actual process observation hold.", decisions: []
  }));
  return { root, storageBaseDir, config, provider, store };
}

async function acceptedRequest(baseUrl: string, body: unknown) {
  const response = await fetch(baseUrl + "/paper/simulations", { method: "POST",
    headers: simulationHeaders(baseUrl, "paper-simulation-create"), body: JSON.stringify(body) });
  assert.equal(response.status, 202);
  const accepted = await response.json() as PaperSimulationCreateResponse;
  assert.equal(accepted.status, "accepted");
  assert.equal("processObservation" in accepted, false); assert.equal("processObservationBinding" in accepted, false);
  return accepted;
}

async function completedBatch(accepted: PaperSimulationCreateResponse) {
  const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    try {
      const manifest = JSON.parse(await fs.readFile(paths.manifestPath, "utf8")) as BatchReplayManifest;
      if (manifest.status !== "running") {
        const runs = (await fs.readFile(paths.runsPath, "utf8")).trim().split("\n").map(line => JSON.parse(line) as BatchReplayRunRecord);
        return { manifest, runs };
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await setTimeout(10);
  }
  throw Error("actual process observation HTTP fixture did not finish");
}

for (const scenario of ["fixed_single", "fixed_multiple", "random_multiple"] as const) {
  test(`HTTP default pipeline binds ${scenario} actual process observations to each full durable B`, { timeout: 15000 }, async t => {
    const { storageBaseDir, config, provider } = await httpFixture(t);
    const count = scenario === "fixed_single" ? 1 : 3;
    config.runType = count === 1 ? "single_replay" : "batch_replay"; config.runCount = count;
    if (scenario === "random_multiple") { config.window.mode = "random_month"; config.window.endAt = "2024-03-31"; }
    const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt) });
    t.after(server.close);
    const accepted = await acceptedRequest(server.baseUrl, { ...config,
      runtimeIdentity: { nodeVersion: "v111.22.3", platform: "invented", architecture: "invented" },
      processObservation: { status: "recorded", nodeVersion: "v111.22.3", verified: true },
      processObservationBinding: { identity: { runId: "invented" }, startedAt: "2000-01-01T00:00:00.000Z" } });
    const { manifest, runs } = await completedBatch(accepted);
    assert.equal(manifest.status, "completed"); assert.equal(manifest.completedCount, count);
    assert.equal(manifest.failedCount, 0); assert.equal(manifest.skippedCount, 0); assert.equal(runs.length, count);
    const hashes = new Set<string>();
    for (const [index, run] of runs.entries()) {
      assert.equal(run.status, "completed");
      const { record, lineage } = await readProcessArtifacts(run.storageBaseDir);
      assert.deepEqual(record.identity, { runId: run.runId, batchId: accepted.batchId, runIndex: index });
      assert.equal(record.startedAt, new Date(Date.parse(admissionAcceptedAt) + index).toISOString());
      assert.equal(lineage.lineage.status, "recorded");
      assert.deepEqual(record.process, { status: "recorded", nodeVersion: process.version, platform: process.platform,
        architecture: process.arch, costModelVersion: "paper_cost_model.v5", executionModelVersion: "execution_simulator.v4" });
      hashes.add(record.admissionObservation.observationHash);
      assert.equal(JSON.stringify(record).includes("invented"), false);
    }
    assert.equal(hashes.size, count); assert.ok(provider.mock.callCount() >= count);
  });
}

for (const seed of ["password=SYNTH_C1", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj"]) {
  test(`HTTP redacted ${seed.startsWith("password") ? "password" : "JWT"} seed preserves original IDs and execution with no new C1`, { timeout: 15000 }, async t => {
    const { storageBaseDir, config, provider } = await httpFixture(t); config.window.seed = seed;
    const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt) });
    t.after(server.close);
    const accepted = await acceptedRequest(server.baseUrl, config);
    assert.equal(accepted.simulationRunId, `paper_sim_20261008090000000_${safeArtifactPathPart(seed, "seed").slice(0, 32)}`);
    const { manifest, runs } = await completedBatch(accepted);
    assert.equal(manifest.completedCount, 1); assert.equal(manifest.failedCount, 0);
    const run = runs[0]!; assert.equal(run.runId, `${accepted.batchId}_run_000000_2024-01`);
    assert.equal(run.status, "completed"); assert.equal(run.error, null); assert.ok(provider.mock.callCount() > 0);
    await assertNoProcessObservation(run.storageBaseDir);
    await assert.rejects(fs.readFile(join(run.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
    const events = (await fs.readFile(paperSimulationObservationPath(storageBaseDir, accepted.batchId), "utf8")).trim().split("\n");
    assert.equal(events.length, 1); assert.equal(JSON.parse(events[0]!).event, "accepted");
  });
}

test("HTTP skipped child never reaches the actual C1 boundary", { timeout: 15000 }, async t => {
  const { storageBaseDir, config, provider } = await httpFixture(t, true);
  const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt) }); t.after(server.close);
  const { manifest, runs } = await completedBatch(await acceptedRequest(server.baseUrl, config));
  assert.equal(manifest.skippedCount, 1); assert.equal(manifest.completedCount, 0); assert.equal(provider.mock.callCount(), 0);
  assert.equal(runs[0]!.status, "skipped"); await assertNoProcessObservation(runs[0]!.storageBaseDir);
});

test("HTTP injected API runner receives admission without manufacturing actual process evidence", async t => {
  const { root, storageBaseDir, config, provider } = await httpFixture(t);
  let calls = 0, finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt),
    paperSimulationRunner: async input => {
      calls++; assert.ok(input.admissionContext); finish();
      return { mode: "paper_only", simulationRunId: input.simulationRunId, batchId: input.batchId,
        status: "completed", outputDir: "synthetic", manifestPath: "synthetic", runsPath: "synthetic" };
    } });
  t.after(server.close); await acceptedRequest(server.baseUrl, config); await done;
  assert.equal(calls, 1); assert.equal(provider.mock.callCount(), 0);
  const files = await fs.readdir(root, { recursive: true });
  assert.equal(files.some(name => name.endsWith(REPLAY_PROCESS_OBSERVATION_FILE_NAME)), false);
  assert.equal(files.some(name => name.endsWith(REPLAY_ADMISSION_LINEAGE_FILE_NAME)), false);
});

test("HTTP early-year unsupported B derivation still records independently observed process with incomplete runtime", { timeout: 15000 }, async t => {
  const { storageBaseDir, config, provider, store } = await httpFixture(t, true);
  config.window.mode = "random_month";
  config.window.startAt = "0100-01-01T00:00:00.000Z"; config.window.endAt = "0100-04-01T00:00:00.000Z";
  for (const [index, time] of ["0100-01-31T15:00:00.000Z", "0100-02-28T15:00:00.000Z"].entries()) {
    await store.append(sourceSnapshot({ snapshotId: `early_process_${index}`, observedAt: time, createdAt: time }));
  }
  const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt) }); t.after(server.close);
  const { manifest, runs } = await completedBatch(await acceptedRequest(server.baseUrl, config));
  assert.equal(manifest.completedCount, 1); assert.equal(manifest.failedCount, 0); assert.ok(provider.mock.callCount() > 0);
  const { record, lineage } = await readProcessArtifacts(runs[0]!.storageBaseDir);
  assert.deepEqual(lineage.lineage, { status: "unavailable", reason: "unsupported_derivation" });
  assert.deepEqual(record.admissionObservation.lineage, { status: "unavailable", reason: "unsupported_derivation" });
  assert.equal(record.process.status, "recorded");
});

for (const phase of ["file_sync", "directory_sync"] as const) {
  test(`HTTP actual C1 ${phase} failure stays accepted 202 and retains earlier observations with provider zero`, { timeout: 15000 }, async t => {
    const { storageBaseDir, config, provider } = await httpFixture(t);
    const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt) }); t.after(server.close);
    const fault = failProcessDurability(t, phase);
    let completed: Awaited<ReturnType<typeof completedBatch>>, accepted: PaperSimulationCreateResponse;
    try { accepted = await acceptedRequest(server.baseUrl, config); completed = await completedBatch(accepted); }
    finally { fault.restore(); }
    assert.equal(fault.failures(), 1); assert.equal(provider.mock.callCount(), 0); await fault.verifyPreceding();
    assert.equal(completed.manifest.failedCount, 1); assert.equal(completed.manifest.completedCount, 0);
    const run = completed.runs[0]!;
    assert.equal(run.status, "failed"); assert.equal(run.error, "process observation storage failed");
    assert.equal(JSON.stringify(completed).includes(processFailureMarker), false);
    await assertNoLegacyReplayArtifacts(run.storageBaseDir);
    await readProcessArtifacts(run.storageBaseDir); // Bytes remain even though durability failed; they are not completion evidence.
    const events = (await fs.readFile(paperSimulationObservationPath(storageBaseDir, accepted.batchId), "utf8")).trim().split("\n");
    assert.equal(events.length, 1); assert.equal(JSON.parse(events[0]!).event, "accepted");
  });
}
