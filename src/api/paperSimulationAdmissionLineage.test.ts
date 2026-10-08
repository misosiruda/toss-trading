import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME } from "../domain/replayAdmissionLineage.js";
import type { MarketPacket } from "../domain/schemas.js";
import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";
import { parseMarketCalendarFixture } from "../replay/marketCalendar.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { sourceSnapshot } from "../replay/codexReplaySourceTestFixtures.js";
import { createBatchReplayArtifactPaths, safeArtifactPathPart } from "../storage/artifactPaths.js";
import { paperSimulationInputPath } from "../storage/paperSimulationInputStore.js";
import { acceptPaperSimulationWithAdmissionContext, paperSimulationObservationPath } from "../storage/paperSimulationObservationStore.js";
import { paperSimulationRequestPath, readPaperSimulationRequest } from "../storage/paperSimulationRequestStore.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import { runHistoricalBatchReplay, type BatchReplayManifest, type BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";
import { admissionAcceptedAt, admissionRoot, readAdmissionArtifacts } from "../workflows/historicalReplayAdmissionTestFixtures.js";
import { resolvePaperSimulationConfig } from "./paperSimulationConfig.js";
import type { PaperSimulationCreateResponse } from "./paperSimulationRuns.js";
import { simulationConfig, simulationHeaders, simulationServer } from "./paperSimulationTestFixtures.js";

async function sourceFixture(t: TestContext, empty = false) {
  await mkdir("data", { recursive: true });
  const source = await mkdtemp(join("data", "admission-lineage-fixture-"));
  t.after(() => rm(source, { recursive: true, force: true }));
  const store = new FileHistoricalMarketSnapshotStore(createStoragePaths(source).historicalMarketSnapshotsPath);
  if (!empty) for (const month of ["01", "02", "03"]) {
    const time = `2024-${month}-01T00:00:00+09:00`;
    await store.append(sourceSnapshot({ snapshotId: `admission_month_${month}`, observedAt: time, createdAt: time }));
  }
  return relative(process.cwd(), source);
}

function holdProvider(t: TestContext) {
  // Keep the real default API adapter, batch, workflow, Risk Engine and observation writers.
  // Only the deterministic runtime decision fixture is replaced; no external provider is used.
  return t.mock.method(FirstPricedHistoricalDecisionProvider.prototype, "decide", (packet: MarketPacket) => ({
    packetId: packet.packetId, summary: "Synthetic admission integration hold.", decisions: []
  }));
}

for (const scenario of ["random_multiple", "fixed_multiple_token", "single_count_override", "batch_count_omission"] as const) {
  test(`HTTP default API to actual batch and children preserves ${scenario} admission lineage`, { timeout: 15000 }, async t => {
    const root = await admissionRoot(t), storageBaseDir = join(root, "paper");
    const config = simulationConfig(); config.sourceDataDir = await sourceFixture(t);
    config.runType = scenario === "single_count_override" ? "single_replay" : "batch_replay";
    config.runCount = scenario === "single_count_override" ? 7 : 3;
    if (scenario === "batch_count_omission") delete config.runCount;
    config.window.mode = scenario === "random_multiple" ? "random_month" : "fixed_range";
    config.window.seed = scenario === "random_multiple" ? "  multi-month  " : "token";
    config.window.startAt = "2024-01-01";
    config.window.endAt = scenario === "random_multiple" ? "2024-03-31" : "2024-01-02";
    config.window.windowMonths = scenario === "random_multiple" ? 1 : 7;
    config.samplingPolicy.stepSeconds = 2_592_000; config.samplingPolicy.maxDecisionCalls = 2;
    config.riskProfile = "balanced";
    if (scenario === "fixed_multiple_token") {
      config.paperExitPolicy = "take_profit_stop_loss";
      config.executionCosts = { feeBps: 12.5, taxBps: 25, slippageBps: 5.5 };
    }
    const env = { PAPER_SIMULATION_TICK_DELAY_MS: "3" }, expected = resolvePaperSimulationConfig(config, env);
    const provider = holdProvider(t);
    const server = await simulationServer({ storageBaseDir, env, now: () => new Date(admissionAcceptedAt) });
    t.after(server.close);
    const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
      headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
    assert.equal(response.status, 202);
    const accepted = await response.json() as PaperSimulationCreateResponse;
    env.PAPER_SIMULATION_TICK_DELAY_MS = "4999";
    assert.equal(accepted.status, "accepted"); assert.equal("admissionContext" in accepted, false);
    assert.equal("receipt" in accepted, false);
    const expectedCount = scenario === "single_count_override" ? 1 : scenario === "batch_count_omission" ? 5 : 3;
    assert.equal(accepted.requestedRunCount, expectedCount); assert.equal(accepted.effectiveConfig.runCount, expectedCount);
    assert.deepEqual(accepted.requestedConfig, config); assert.deepEqual(accepted.notices, expected.notices);
    const expectedId = `paper_sim_20261008090000000_${safeArtifactPathPart(config.window.seed, "seed").slice(0, 32)}`;
    assert.equal(accepted.simulationRunId, expectedId); assert.equal(accepted.batchId, expectedId);
    const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
    const manifest = await waitForManifest(paths.manifestPath);
    assert.equal(manifest.status, "completed"); assert.equal(manifest.completedCount, expectedCount);
    assert.equal(manifest.failedCount, 0); assert.equal(manifest.skippedCount, 0);
    const runs = await readRuns(paths.runsPath); assert.equal(runs.length, expectedCount);
    const canonical = JSON.parse(await readFile(paperSimulationRequestPath(storageBaseDir, expectedId), "utf8"));
    const input = JSON.parse(await readFile(paperSimulationInputPath(storageBaseDir, expectedId), "utf8"));
    const acceptedEvents = (await readFile(paperSimulationObservationPath(storageBaseDir, expectedId), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(acceptedEvents.length, 1); const event = acceptedEvents[0]; assert.equal(event.event, "accepted");
    assert.equal(event.canonicalRequestHash, createReplayResearchHash(canonical));
    assert.equal(event.inputProvenanceHash, createReplayResearchHash(input));
    assert.deepEqual(input.snapshot, expected);
    for (const [index, run] of runs.entries()) {
      assert.equal(run.status, "completed"); assert.equal(run.runIndex, index);
      assert.equal(run.runId, `${expectedId}_run_${String(index).padStart(6, "0")}_${safeArtifactPathPart(run.window.selectedMonth, "window")}`);
      const { initial, settings, lineage } = await readAdmissionArtifacts(run.storageBaseDir);
      assert.equal(lineage.identity.runId, run.runId); assert.equal(lineage.identity.runIndex, index);
      assert.equal(lineage.startedAt, new Date(Date.parse(admissionAcceptedAt) + index).toISOString());
      assert.equal(lineage.lineage.status, "recorded"); assert.equal(settings.settings.status, "recorded");
      if (lineage.lineage.status !== "recorded" || settings.settings.status !== "recorded") continue;
      assert.deepEqual(lineage.lineage.receipt, { receiptVersion: "paper_simulation_admission_receipt.v1",
        simulationRunId: expectedId, batchId: expectedId, acceptedAt: admissionAcceptedAt,
        canonicalVersion: canonical.schemaVersion, canonicalRequestHash: event.canonicalRequestHash,
        inputVersion: input.schemaVersion, inputProvenanceHash: event.inputProvenanceHash });
      assert.equal(lineage.lineage.mappingVersion, "paper_simulation_child_mapping.v1");
      assert.equal(lineage.lineage.effectiveRunCount, expectedCount);
      assert.equal(lineage.lineage.windowMode, config.window.mode);
      assert.equal(lineage.lineage.normalizedBatchSeed, config.window.seed.trim());
      assert.equal(lineage.lineage.plannedWindow.seed, `${config.window.seed.trim()}:${index}`);
      assert.deepEqual(lineage.lineage.plannedWindow, run.window);
      assert.equal(lineage.lineage.expectedSettingsHash, settings.settings.contentHash);
      assert.equal(lineage.lineage.initialCapitalRelation, "generated_matches_admission");
      if (initial.initialPortfolio.status === "recorded") {
        assert.equal(initial.initialPortfolio.snapshot.cashKrw, config.capital.initialCashKrw);
        assert.deepEqual(initial.initialPortfolio.snapshot.positions, []);
      } else assert.fail("generated initial portfolio must be recorded");
      const applied = settings.settings.snapshot;
      assert.equal(applied.packetIdPrefix, `packet_${expectedId}_${index}`);
      assert.equal(applied.packetExpiresInSeconds, 60); assert.equal(applied.maxCandidates, 10);
      assert.equal(applied.maxSnapshotAgeSeconds, 86_400); assert.equal(applied.tickDelayMs, 3);
      assert.deepEqual(applied.constraints, expected.effectiveConfig.constraints);
      assert.deepEqual(applied.executionPolicy, expected.effectiveConfig.costModel.executionPolicy);
      assert.deepEqual(applied.riskPolicy, expected.effectiveConfig.riskPolicy);
      assert.deepEqual(applied.allocationPolicy, expected.effectiveConfig.allocationPolicy);
      for (const key of ["universeManifest", "candidateStrategyBucket", "marketRegimeAllocationPolicy"]) assert.equal(key in applied, false);
      if (config.paperExitPolicy === "none") assert.equal("paperExitPolicy" in applied, false);
      else assert.deepEqual(applied.paperExitPolicy, expected.effectiveConfig.paperExitPolicy);
      if (config.window.mode === "fixed_range") {
        assert.equal(accepted.effectiveConfig.window.windowMonths, null);
        assert.equal(lineage.lineage.plannedWindow.windowMonths, 7);
        assert.equal(lineage.lineage.plannedWindow.selectedCandidateIndex, 0);
        assert.equal(lineage.lineage.plannedWindow.candidateCount, 1);
        assert.equal(lineage.lineage.plannedWindow.startAt, "2023-12-31T15:00:00.000Z");
        assert.equal(lineage.lineage.plannedWindow.endAt, "2024-01-02T14:59:59.999Z");
      } else assert.equal(lineage.lineage.plannedWindow.candidateCount, 3);
    }
    assert.ok(provider.mock.callCount() >= expectedCount);
  });
}

for (const seed of ["password=SYNTH_B", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGlj"]) {
  test(`HTTP default runner keeps redacted admission and original derived IDs without emitting B (${seed.startsWith("password") ? "password" : "JWT"})`, { timeout: 15000 }, async t => {
    const root = await admissionRoot(t), storageBaseDir = join(root, "paper"), config = simulationConfig();
    config.sourceDataDir = await sourceFixture(t); config.window.mode = "fixed_range";
    config.window.startAt = "2024-01-01"; config.window.endAt = "2024-01-02"; config.window.seed = seed;
    config.samplingPolicy.stepSeconds = 2_592_000;
    const provider = holdProvider(t);
    const server = await simulationServer({ storageBaseDir, env: {}, now: () => new Date(admissionAcceptedAt) });
    t.after(server.close);
    const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
      headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
    assert.equal(response.status, 202); const accepted = await response.json() as PaperSimulationCreateResponse;
    assert.equal(accepted.simulationRunId, `paper_sim_20261008090000000_${safeArtifactPathPart(seed, "seed").slice(0, 32)}`);
    const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
    const manifest = await waitForManifest(paths.manifestPath);
    assert.equal(manifest.status, "completed"); assert.equal(manifest.completedCount, 1);
    const runs = await readRuns(paths.runsPath); assert.equal(runs.length, 1); assert.ok(provider.mock.callCount() > 0);
    assert.equal(runs[0]!.runId, `${accepted.batchId}_run_000000_2024-01`);
    await assert.rejects(readFile(join(runs[0]!.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
    const events = (await readFile(paperSimulationObservationPath(storageBaseDir, accepted.batchId), "utf8")).trim().split("\n");
    assert.equal(events.length, 1); assert.equal(JSON.parse(events[0]!).event, "accepted");
    const input = JSON.parse(await readFile(paperSimulationInputPath(storageBaseDir, accepted.batchId), "utf8"));
    if (!seed.startsWith("password")) assert.equal(input.redacted, true);
  });
}

test("HTTP availability-skipped child creates no consumed admission artifact", { timeout: 15000 }, async t => {
  const root = await admissionRoot(t), config = simulationConfig();
  config.sourceDataDir = await sourceFixture(t, true); config.window.mode = "fixed_range";
  config.window.startAt = "2024-01-01"; config.window.endAt = "2024-01-02";
  const provider = holdProvider(t);
  const server = await simulationServer({ storageBaseDir: join(root, "paper"), env: {}, now: () => new Date(admissionAcceptedAt) });
  t.after(server.close);
  const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
    headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
  assert.equal(response.status, 202); const accepted = await response.json() as PaperSimulationCreateResponse;
  const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
  const manifest = await waitForManifest(paths.manifestPath);
  assert.equal(manifest.skippedCount, 1); assert.equal(manifest.completedCount, 0); assert.equal(provider.mock.callCount(), 0);
  const [run] = await readRuns(paths.runsPath); assert.equal(run!.status, "skipped");
  await assert.rejects(readFile(join(run!.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
});

test("direct legacy batch without context keeps its default age 300 and emits no B", async t => {
  const root = await admissionRoot(t), source = await sourceFixture(t); holdProvider(t);
  const result = await runHistoricalBatchReplay({ sourceDataDir: source, outputBaseDir: join(root, "batch"),
    batchId: "legacy_batch", seed: "legacy", runCount: 1,
    rangeStart: new Date("2024-01-01T00:00:00+09:00"), rangeEnd: new Date("2024-01-31T23:59:59.999+09:00"),
    stepSeconds: 2_592_000, generatedAt: new Date(admissionAcceptedAt) });
  assert.equal(result.completedCount, 1);
  const [run] = result.records;
  await assert.rejects(readFile(join(run!.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
  const settings = JSON.parse(await readFile(join(run!.storageBaseDir, "historical-replay-settings-observation.json"), "utf8"));
  assert.equal(settings.settings.snapshot.maxSnapshotAgeSeconds, 300); assert.equal(settings.admission, "unavailable");
});

test("actual calendar-filtered batch remains unsupported when its sole random candidate coincides with the API plan", async t => {
  const root = await admissionRoot(t), config = simulationConfig();
  config.sourceDataDir = await sourceFixture(t, true);
  config.window.startAt = "2024-01-01"; config.window.endAt = "2024-01-31";
  config.samplingPolicy.stepSeconds = 2_592_000;
  const time = "2024-01-01T00:00:00+09:00";
  await new FileHistoricalMarketSnapshotStore(createStoragePaths(config.sourceDataDir).historicalMarketSnapshotsPath)
    .append(sourceSnapshot({ observedAt: time, createdAt: time }));
  const snapshot = resolvePaperSimulationConfig(config, {}), effective = snapshot.effectiveConfig;
  const batchId = "paper_sim_20261008090000000_calendar";
  const admissionContext = await acceptPaperSimulationWithAdmissionContext(join(root, "paper"), batchId, admissionAcceptedAt,
    { requestedConfig: snapshot.requestedConfig, inputSnapshot: snapshot });
  const provider = holdProvider(t);
  const result = await runHistoricalBatchReplay({ sourceDataDir: config.sourceDataDir, outputBaseDir: join(root, "output"),
    batchId, admissionContext, seed: effective.window.seed, runCount: effective.runCount,
    rangeStart: new Date(effective.window.rangeStartAt), rangeEnd: new Date(effective.window.rangeEndAt),
    windowMonths: effective.window.windowMonths!, windowSamplingMode: "random", timezoneOffsetMinutes: 540,
    generatedAt: new Date(admissionAcceptedAt), stepSeconds: effective.samplingPolicy.stepSeconds,
    tickDelayMs: effective.tickDelayMs, initialCashKrw: effective.capital.initialCashKrw,
    packetIdPrefix: `packet_${batchId}`, packetExpiresInSeconds: 60, maxCandidates: 10, maxSnapshotAgeSeconds: 86_400,
    constraints: effective.constraints, executionPolicy: effective.costModel.executionPolicy,
    riskPolicy: effective.riskPolicy, allocationPolicy: effective.allocationPolicy,
    calendarValidation: { rules: [{ market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }],
      fixtures: [parseMarketCalendarFixture({ calendarId: "synthetic-calendar", exchange: "KRX", market: "KR",
        timezone: "Asia/Seoul", sessionDate: "2024-01-01", marketOpen: time,
        marketClose: "2024-01-01T23:59:59+09:00", isHoliday: false,
        sourceRefs: ["fixture:calendar"], createdAt: admissionAcceptedAt })] }
  });
  assert.equal(result.completedCount, 1); assert.ok(provider.mock.callCount() > 0);
  const run = result.records[0]!; assert.equal(run.window.candidateCount, 1); assert.equal(run.window.selectedCandidateIndex, 0);
  const { lineage } = await readAdmissionArtifacts(run.storageBaseDir);
  assert.deepEqual(lineage.lineage, { status: "unavailable", reason: "unsupported_derivation" });
});

for (const mode of ["random_month", "fixed_range"] as const) {
  test(`HTTP default pipeline preserves ${mode === "random_month" ? "early0100" : "extended-local"} execution with unsupported B derivation`, { timeout: 15000 }, async t => {
    const root = await admissionRoot(t), config = simulationConfig();
    config.sourceDataDir = await sourceFixture(t, true); config.window.mode = mode;
    config.window.startAt = mode === "random_month" ? "0100-01-01T00:00:00.000Z" : "9999-12-31T15:00:00.000Z";
    config.window.endAt = mode === "random_month" ? "0100-04-01T00:00:00.000Z" : "9999-12-31T23:00:00.000Z";
    config.samplingPolicy.stepSeconds = 2_592_000;
    const store = new FileHistoricalMarketSnapshotStore(createStoragePaths(config.sourceDataDir).historicalMarketSnapshotsPath);
    const times = mode === "random_month" ? ["0100-01-31T15:00:00.000Z", "0100-02-28T15:00:00.000Z"] : [config.window.startAt];
    for (const [index, time] of times.entries()) await store.append(sourceSnapshot({ snapshotId: `boundary_${index}`, observedAt: time, createdAt: time }));
    const provider = holdProvider(t);
    const server = await simulationServer({ storageBaseDir: join(root, "paper"), env: {}, now: () => new Date(admissionAcceptedAt) });
    t.after(server.close);
    const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
      headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(config) });
    assert.equal(response.status, 202); const accepted = await response.json() as PaperSimulationCreateResponse;
    const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
    const manifest = await waitForManifest(paths.manifestPath);
    assert.equal(manifest.completedCount, 1); assert.equal(manifest.failedCount, 0); assert.equal(manifest.skippedCount, 0);
    const [run] = await readRuns(paths.runsPath); assert.equal(run!.status, "completed"); assert.ok(provider.mock.callCount() > 0);
    const { lineage } = await readAdmissionArtifacts(run!.storageBaseDir);
    assert.deepEqual(lineage.lineage, { status: "unavailable", reason: "unsupported_derivation" });
    if (mode === "random_month") assert.match(run!.window.selectedMonth, /^100-/);
    else assert.equal(run!.window.selectedMonth, "+010000");
  });
}

test("HTTP clone from the stored request runs a new actual child bound to its new admission", { timeout: 15000 }, async t => {
  const root = await admissionRoot(t), storageBaseDir = join(root, "paper"), config = simulationConfig();
  config.sourceDataDir = await sourceFixture(t); config.window.mode = "fixed_range";
  config.window.startAt = "2024-01-01"; config.window.endAt = "2024-01-02";
  config.samplingPolicy.stepSeconds = 2_592_000;
  let now = admissionAcceptedAt;
  const env = { PAPER_SIMULATION_TICK_DELAY_MS: "0" }, provider = holdProvider(t);
  const server = await simulationServer({ storageBaseDir, env, now: () => new Date(now) });
  t.after(server.close);
  const create = async (body: unknown) => {
    const response = await fetch(server.baseUrl + "/paper/simulations", { method: "POST",
      headers: simulationHeaders(server.baseUrl, "paper-simulation-create"), body: JSON.stringify(body) });
    assert.equal(response.status, 202); const accepted = await response.json() as PaperSimulationCreateResponse;
    const paths = createBatchReplayArtifactPaths(accepted.outputBaseDir, accepted.batchId);
    assert.equal((await waitForManifest(paths.manifestPath)).completedCount, 1);
    const [run] = await readRuns(paths.runsPath);
    return { accepted, ...await readAdmissionArtifacts(run!.storageBaseDir) };
  };
  const original = await create(config);
  const stored = await readPaperSimulationRequest(storageBaseDir, original.accepted.simulationRunId);
  assert.equal(stored.status, "available"); if (stored.status !== "available") return;
  now = "2026-10-08T09:00:01.000Z"; env.PAPER_SIMULATION_TICK_DELAY_MS = "1";
  const clone = await create(stored.requestedConfig);
  assert.notEqual(clone.accepted.simulationRunId, original.accepted.simulationRunId);
  assert.deepEqual(clone.accepted.requestedConfig, original.accepted.requestedConfig);
  assert.equal(original.lineage.lineage.status, "recorded"); assert.equal(clone.lineage.lineage.status, "recorded");
  if (original.lineage.lineage.status !== "recorded" || clone.lineage.lineage.status !== "recorded") return;
  const before = original.lineage.lineage.receipt, after = clone.lineage.lineage.receipt;
  assert.equal(before.batchId, original.accepted.batchId); assert.equal(after.batchId, clone.accepted.batchId);
  assert.equal(before.acceptedAt, admissionAcceptedAt); assert.equal(after.acceptedAt, now);
  assert.notEqual(after.canonicalRequestHash, before.canonicalRequestHash);
  assert.notEqual(after.inputProvenanceHash, before.inputProvenanceHash);
  assert.equal(clone.accepted.effectiveConfig.tickDelayMs, 1); assert.equal(original.accepted.effectiveConfig.tickDelayMs, 0);
  assert.notEqual(clone.lineage.lineage.expectedSettingsHash, original.lineage.lineage.expectedSettingsHash);
  assert.equal(provider.mock.callCount(), 2);
});

async function readRuns(path: string): Promise<BatchReplayRunRecord[]> {
  return (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line) as BatchReplayRunRecord);
}
async function waitForManifest(path: string): Promise<BatchReplayManifest> {
  const deadline = performance.now() + 10_000; let last: BatchReplayManifest | undefined;
  while (performance.now() < deadline) {
    try {
      last = JSON.parse(await readFile(path, "utf8")) as BatchReplayManifest;
      if (last.status !== "running") return last;
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await setTimeout(10);
  }
  throw Error(`actual admission fixture did not finish: ${JSON.stringify(last)}`);
}
