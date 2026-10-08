import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME } from "../domain/replayAdmissionLineage.js";
import { heldSourcePortfolio, sourceGate } from "../replay/codexReplaySourceTestFixtures.js";
import { resolvePaperSimulationAdmissionContext, type PaperSimulationAdmissionContext } from "../storage/paperSimulationObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";
import { createStoragePaths, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { captureReplayWorkflowAdmission } from "./historicalReplayAdmission.js";
import { issuedWorkflowFixture, readAdmissionArtifacts } from "./historicalReplayAdmissionTestFixtures.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";

test("actual workflow binds generated cash and the exact durable A record before its first provider call", async t => {
  const fixture = await issuedWorkflowFixture(t, { index: 1 });
  const { options, admissionContext } = fixture;
  const original = options.decisionProvider!.decide;
  let observedBeforeProvider = false;
  options.decisionProvider!.decide = async (packet, context) => {
    const { lineage } = await readAdmissionArtifacts(options.storageBaseDir);
    assert.equal(lineage.lineage.status, "recorded"); observedBeforeProvider = true;
    return original(packet, context);
  };
  const result = await runHistoricalReplayWorkflow(options);
  assert.equal(result.status, "completed"); assert.ok(observedBeforeProvider); assert.equal(fixture.providers(), 1);
  const { initial, settings, lineage } = await readAdmissionArtifacts(options.storageBaseDir);
  const evidence = resolvePaperSimulationAdmissionContext(admissionContext);
  assert.equal(evidence.status, "available"); assert.equal(lineage.lineage.status, "recorded");
  if (evidence.status !== "available" || lineage.lineage.status !== "recorded") return;
  assert.deepEqual(lineage.lineage.receipt, evidence.receipt);
  assert.equal(lineage.lineage.initialCapitalRelation, "generated_matches_admission");
  assert.equal(lineage.lineage.plannedWindow.seed, "token:1");
  assert.equal(initial.initialPortfolio.status, "recorded"); assert.equal(settings.settings.status, "recorded");
  if (initial.initialPortfolio.status !== "recorded" || settings.settings.status !== "recorded") return;
  assert.equal(initial.initialPortfolio.snapshot.cashKrw, fixture.snapshot.effectiveConfig.capital.initialCashKrw);
  assert.deepEqual(initial.initialPortfolio.snapshot.positions, []);
  assert.equal(settings.settings.snapshot.maxSnapshotAgeSeconds, 86_400);
});

test("actual stored cash zero and holdings override requested capital without changing the admission", async t => {
  const { options, snapshot } = await issuedWorkflowFixture(t);
  const stored = heldSourcePortfolio();
  await new FileVirtualPortfolioStore(createStoragePaths(options.storageBaseDir).virtualPortfolioPath).write(stored);
  await runHistoricalReplayWorkflow(options);
  const { initial, lineage } = await readAdmissionArtifacts(options.storageBaseDir);
  assert.equal(lineage.lineage.status, "recorded");
  if (lineage.lineage.status !== "recorded" || initial.initialPortfolio.status !== "recorded") return;
  assert.equal(lineage.lineage.initialCapitalRelation, "stored_portfolio_precedence");
  assert.equal(initial.initialPortfolio.origin, "stored_portfolio");
  assert.equal(initial.initialPortfolio.snapshot.cashKrw, 0);
  assert.deepEqual(initial.initialPortfolio.snapshot.positions, stored.positions);
  assert.notEqual(snapshot.effectiveConfig.capital.initialCashKrw, 0);
});

for (const kind of ["plain", "serialized", "prototype", "proxy", "revoked_proxy", "context_getter"] as const) {
  test(`workflow rejects ${kind} context without executing getters, proxy traps, provider or legacy artifacts`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options, admissionContext } = fixture;
    let inspected = 0;
    const forbidden = () => { inspected++; throw Error("synthetic forged context inspected"); };
    const before = (await readdir(options.storageBaseDir)).sort();
    let forged: unknown;
    if (kind === "plain") forged = { verified: true, get receipt() { return forbidden(); } };
    if (kind === "serialized") forged = JSON.parse(JSON.stringify(admissionContext));
    if (kind === "prototype") forged = Object.create(admissionContext);
    if (kind === "proxy") forged = new Proxy(admissionContext, { get: forbidden, ownKeys: forbidden, getPrototypeOf: forbidden });
    if (kind === "revoked_proxy") { const proxy = Proxy.revocable(admissionContext, {}); proxy.revoke(); forged = proxy.proxy; }
    if (kind === "context_getter") Object.defineProperty(options, "admissionContext", { get: forbidden });
    else options.admissionContext = forged as PaperSimulationAdmissionContext;
    await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: replay admission context unavailable$/);
    assert.equal(inspected, 0); assert.equal(fixture.providers(), 0);
    assert.deepEqual((await readdir(options.storageBaseDir)).sort(), before);
  });
}

for (const kind of ["unbound", "cross_batch", "child_id", "index", "time", "window", "mode", "settings", "age_default", "generated_cash"] as const) {
  test(`workflow rejects actual ${kind} mismatch before provider and legacy output`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    if (kind === "unbound") delete options.runId;
    if (kind === "cross_batch") options.batchId = "paper_sim_20261008090000000_another";
    if (kind === "child_id") options.runId += "_changed";
    if (kind === "index") options.batchRunIndex = 2;
    if (kind === "time") options.generatedAt = new Date("2026-10-08T09:00:00.001Z");
    if (kind === "window") options.windowSelection!.seed = "changed:0";
    if (kind === "mode") options.admissionWindowSamplingMode = "random";
    if (kind === "settings") options.constraints.allowedActions.reverse();
    if (kind === "age_default") options.maxSnapshotAgeSeconds = 300;
    if (kind === "generated_cash") options.initialCashKrw = 100_000;
    await assert.rejects(runHistoricalReplayWorkflow(options), /^(?:Error: replay admission mapping mismatch|Error: admission lineage observation storage failed)$/);
    assert.equal(fixture.providers(), 0);
    const names = await readdir(options.storageBaseDir);
    assert.equal(names.includes(REPLAY_ADMISSION_LINEAGE_FILE_NAME), false);
    const paths = createStoragePaths(options.storageBaseDir);
    for (const path of [paths.historicalReplayRunMetadataPath, paths.historicalReplayResearchManifestPath,
      paths.historicalReplayProgressPath, paths.historicalReplayPacketLogPath, paths.historicalReplayReportPath])
      await assert.rejects(readFile(path), { code: "ENOENT" });
  });
}

for (const kind of ["window_getter", "window_proxy", "mode_getter", "identity_getter"] as const) {
  test(`workflow never inspects an actual ${kind} when capturing B metadata`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    let inspected = 0;
    const forbidden = () => { inspected++; throw Error("synthetic B metadata inspected"); };
    if (kind === "window_getter") Object.defineProperty(options.windowSelection!, "seed", { get: forbidden });
    if (kind === "window_proxy") options.windowSelection = new Proxy(options.windowSelection!, { get: forbidden, ownKeys: forbidden });
    if (kind === "mode_getter") Object.defineProperty(options, "admissionWindowSamplingMode", { get: forbidden });
    if (kind === "identity_getter") Object.defineProperty(options, "runId", { get: forbidden });
    const before = (await readdir(options.storageBaseDir)).sort();
    await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: replay admission mapping mismatch$/);
    assert.equal(inspected, 0); assert.equal(fixture.providers(), 0);
    assert.deepEqual((await readdir(options.storageBaseDir)).sort(), before);
  });
}

for (const kind of ["context", "window", "identity", "date", "mode_getter"] as const) {
  test(`workflow rechecks ${kind} changed during input-read await before planning or output`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    const before = (await readdir(options.storageBaseDir)).sort();
    const gate = sourceGate(), entered = sourceGate(); let inspected = 0;
    const original = FileVirtualPortfolioStore.prototype.read;
    t.mock.method(FileVirtualPortfolioStore.prototype, "read", async function (this: FileVirtualPortfolioStore) {
      entered.release(); await gate.promise; return original.call(this);
    });
    const rejected = assert.rejects(runHistoricalReplayWorkflow(options), /replay admission (?:context unavailable|mapping mismatch)/);
    await entered.promise;
    if (kind === "context") options.admissionContext = {} as PaperSimulationAdmissionContext;
    if (kind === "window") options.windowSelection!.selectedMonth = "2024-02";
    if (kind === "identity") options.runId += "_mutated";
    if (kind === "date") options.generatedAt!.setUTCMilliseconds(9);
    if (kind === "mode_getter") Object.defineProperty(options, "admissionWindowSamplingMode", {
      get() { inspected++; throw Error("synthetic late getter"); }
    });
    gate.release(); await rejected;
    assert.equal(inspected, 0); assert.equal(fixture.providers(), 0);
    assert.deepEqual((await readdir(options.storageBaseDir)).sort(), before);
  });
}

for (const unavailable of ["input_missing", "redacted"] as const) {
  test(`genuine ${unavailable} context omits B before inspecting its identity envelope and preserves execution`, async t => {
    const fixture = await issuedWorkflowFixture(t, { unavailable }), { options, admissionContext } = fixture;
    assert.deepEqual(resolvePaperSimulationAdmissionContext(admissionContext), { status: "unavailable", reason: unavailable });
    let inspected = 0;
    const forbidden = () => { inspected++; throw Error("unavailable identity must not be inspected"); };
    assert.equal(captureReplayWorkflowAdmission(new Proxy({}, { get: forbidden, ownKeys: forbidden,
      getOwnPropertyDescriptor: forbidden }), admissionContext), undefined);
    Object.defineProperty(options, "admissionWindowSamplingMode", { get: forbidden });
    assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
    assert.equal(inspected, 0); assert.equal(fixture.providers(), 1);
    await assert.rejects(readFile(join(options.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
    const settings = JSON.parse(await readFile(join(options.storageBaseDir, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.equal(settings.admission, "unavailable");
  });
}

test("legacy bound workflow with no admission context retains A and produces no B", async t => {
  const fixture = await issuedWorkflowFixture(t), { options } = fixture;
  delete options.admissionContext; delete options.admissionWindowSamplingMode;
  options.maxSnapshotAgeSeconds = 300;
  assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
  assert.equal(fixture.providers(), 1);
  await assert.rejects(readFile(join(options.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
  const settings = JSON.parse(await readFile(join(options.storageBaseDir, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
  assert.equal(settings.settings.snapshot.maxSnapshotAgeSeconds, 300); assert.equal(settings.admission, "unavailable");
});

test("opaque clock callback cannot change detached child identity, planned window or accepted time", async t => {
  const fixture = await issuedWorkflowFixture(t), { options } = fixture;
  const originalRunId = options.runId, originalWindow = structuredClone(options.windowSelection);
  const originalTime = options.generatedAt!.toISOString();
  const metadata = options.clock.metadata.bind(options.clock);
  t.mock.method(options.clock, "metadata", () => {
    options.runId = "callback_changed_child"; options.batchId = "callback_changed_batch"; options.batchRunIndex = 9;
    options.windowSelection!.seed = "callback_changed:9"; options.windowSelection!.selectedMonth = "2024-02";
    options.generatedAt!.setUTCFullYear(2030);
    return metadata();
  });
  assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
  const { lineage } = await readAdmissionArtifacts(options.storageBaseDir);
  assert.equal(lineage.identity.runId, originalRunId); assert.equal(lineage.identity.runIndex, 0);
  assert.equal(lineage.startedAt, originalTime); assert.equal(lineage.lineage.status, "recorded");
  if (lineage.lineage.status === "recorded") assert.deepEqual(lineage.lineage.plannedWindow, originalWindow);
  const metadataRecord = JSON.parse(await readFile(createStoragePaths(options.storageBaseDir).historicalReplayRunMetadataPath, "utf8"));
  assert.deepEqual(metadataRecord.identity, lineage.identity);
  assert.equal(fixture.providers(), 1);
});

for (const phase of ["file_sync", "directory_sync"] as const) {
  test(`actual workflow B ${phase} failure retains observations and reservation with provider zero`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    const target = join(options.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME);
    const original = fs.open; let reachedB = false, failures = 0;
    const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (String(args[0]) === target) reachedB = true;
      if ((phase === "file_sync" && String(args[0]) === target) ||
        (phase === "directory_sync" && reachedB && String(args[0]) === options.storageBaseDir && args[1] === "r")) {
        t.mock.method(handle, "sync", async () => { failures++; throw Error("synthetic admission durability failure"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: admission lineage observation storage failed$/); }
    finally { open.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(failures, 1); assert.equal(fixture.providers(), 0);
    const paths = createStoragePaths(options.storageBaseDir);
    for (const path of [paths.historicalReplayRunMetadataPath, paths.historicalReplayResearchManifestPath,
      paths.historicalReplayProgressPath, paths.historicalReplayPacketLogPath, paths.historicalReplayReportPath])
      await assert.rejects(readFile(path), { code: "ENOENT" });
    const names = (await readdir(options.storageBaseDir)).sort();
    assert.ok(names.includes(REPLAY_ADMISSION_LINEAGE_FILE_NAME)); assert.ok(names.includes(REPLAY_SETTINGS_OBSERVATION_FILE));
    const before = await Promise.all(names.map(name => readFile(join(options.storageBaseDir, name))));
    await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
    assert.equal(fixture.providers(), 0); assert.deepEqual((await readdir(options.storageBaseDir)).sort(), names);
    assert.deepEqual(await Promise.all(names.map(name => readFile(join(options.storageBaseDir, name)))), before);
  });
}
