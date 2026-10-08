import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { REPLAY_ADMISSION_LINEAGE_FILE_NAME } from "../domain/replayAdmissionLineage.js";
import { REPLAY_PROCESS_OBSERVATION_FILE_NAME } from "../domain/replayProcessObservation.js";
import { sourcePortfolio, sourceSnapshot } from "../replay/codexReplaySourceTestFixtures.js";
import { paperSimulationRequestPath } from "../storage/paperSimulationRequestStore.js";
import { REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { issuedWorkflowFixture } from "./historicalReplayAdmissionTestFixtures.js";
import { assertNoLegacyReplayArtifacts, assertNoProcessObservation, failProcessDurability,
  processDurabilityPhases, processFailureMarker, readProcessArtifacts } from "./historicalReplayProcessObservationTestFixtures.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";

test("actual workflow has exact durable process and B references before its first provider call", async t => {
  const fixture = await issuedWorkflowFixture(t, { index: 1 }), { options } = fixture;
  const original = options.decisionProvider!.decide;
  let beforeProvider = false;
  options.decisionProvider!.decide = async (packet, context) => {
    const { record } = await readProcessArtifacts(options.storageBaseDir);
    assert.deepEqual(record.process, { status: "recorded", nodeVersion: process.version, platform: process.platform,
      architecture: process.arch, costModelVersion: "paper_cost_model.v5", executionModelVersion: "execution_simulator.v4" });
    assert.equal(record.identity.runIndex, 1); beforeProvider = true;
    return original(packet, context);
  };
  assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
  assert.equal(beforeProvider, true); assert.equal(fixture.providers(), 1);
});

for (const shape of ["supported", "unsupported", "accessor"] as const) {
  test(`actual process ${shape} descriptor is captured after admission without executing getters or rereading it`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    const canonicalPath = paperSimulationRequestPath(join(fixture.root, "paper"), options.batchId!);
    const canonicalBefore = await fs.readFile(canonicalPath, "utf8");
    const admittedVersion = JSON.parse(canonicalBefore).sourceRuntime.nodeVersion;
    const descriptor = Object.getOwnPropertyDescriptor(process, "version")!;
    const originalOpen = fs.open; let traps = 0, restoredAtInitial = false;
    const marker = "SYNTHETIC_PROCESS_SCALAR_SENTINEL";
    const open = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]) === join(options.storageBaseDir, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE)) {
        Object.defineProperty(process, "version", descriptor); restoredAtInitial = true;
      }
      return originalOpen(...args);
    });
    try {
      // Node synchronizes process's named exports too, so install the accessor only after the fs mock is linked.
      syncBuiltinESMExports();
      Object.defineProperty(process, "version", shape === "accessor"
        ? { configurable: true, get() { traps++; throw Error(marker); } }
        : { ...descriptor, value: shape === "supported" ? "v123.45.6" : marker });
      assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
    }
    finally { Object.defineProperty(process, "version", descriptor); open.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(traps, 0); assert.equal(restoredAtInitial, true); assert.equal(fixture.providers(), 1);
    assert.equal(await fs.readFile(canonicalPath, "utf8"), canonicalBefore);
    const { record } = await readProcessArtifacts(options.storageBaseDir);
    if (shape === "supported") {
      assert.equal(record.process.status, "recorded");
      if (record.process.status === "recorded") {
        assert.equal(record.process.nodeVersion, "v123.45.6");
        assert.notEqual(record.process.nodeVersion, admittedVersion);
        assert.equal(record.process.platform, process.platform); assert.equal(record.process.architecture, process.arch);
      }
    } else assert.deepEqual(record.process, { status: "unavailable", reason: "unsupported_process_observation" });
    assert.equal(JSON.stringify(record).includes(marker), false);
  });
}

for (const mode of ["legacy", "standalone", "canonical_only", "redacted"] as const) {
  test(`${mode} actual workflow emits no C1 and never inspects process descriptors for new evidence`, async t => {
    const fixture = await issuedWorkflowFixture(t, mode === "canonical_only" ? { unavailable: "input_missing" }
      : mode === "redacted" ? { unavailable: "redacted" } : {});
    const { options } = fixture;
    if (mode === "legacy" || mode === "standalone") { delete options.admissionContext; delete options.admissionWindowSamplingMode; }
    if (mode === "standalone") { delete options.runId; delete options.batchId; delete options.batchRunIndex; }
    let inspected = 0;
    const descriptor = Object.getOwnPropertyDescriptor;
    const mock = t.mock.method(Object, "getOwnPropertyDescriptor", (value: unknown, key: PropertyKey) => {
      if (value === process && ["version", "platform", "arch"].includes(String(key))) inspected++;
      return descriptor(value, key);
    });
    try { assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed"); }
    finally { mock.mock.restore(); }
    assert.equal(inspected, 0); assert.equal(fixture.providers(), 1);
    await assertNoProcessObservation(options.storageBaseDir);
    await assert.rejects(fs.readFile(join(options.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
  });
}

for (const reason of ["settings_unavailable", "initial_unavailable"] as const) {
  test(`actual process stays independently recorded when durable B reports ${reason}`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    if (reason === "settings_unavailable") options.packetIdPrefix = "public_documentation_" + "X".repeat(150);
    else await new FileVirtualPortfolioStore(createStoragePaths(options.storageBaseDir).virtualPortfolioPath)
      .write(sourcePortfolio({ portfolioId: "P".repeat(121) }));
    assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
    const { record, lineage } = await readProcessArtifacts(options.storageBaseDir);
    assert.deepEqual(lineage.lineage, { status: "unavailable", reason });
    assert.deepEqual(record.admissionObservation.lineage, { status: "unavailable", reason });
    assert.equal(record.process.status, "recorded"); assert.equal(fixture.providers(), 1);
  });
}

for (const kind of ["source_redacted", "settings_redacted", "settings_inspection"] as const) {
  test(`${kind} actual early stop cannot create C1, legacy artifacts or call providers`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    const marker = "SYNTHETIC_PROCESS_EARLY_STOP";
    if (kind === "source_redacted") await new FileHistoricalMarketSnapshotStore(createStoragePaths(options.storageBaseDir).historicalMarketSnapshotsPath)
      .append(sourceSnapshot({ snapshotId: "redacted_fixture", sourceRefs: [`https://fixture.invalid?token=${marker}`] }));
    else options.packetIdPrefix = kind === "settings_redacted" ? `api_key=${marker}` : "X".repeat(4097) + `api_key=${marker}`;
    const expected = kind === "source_redacted" ? "source input requires redaction"
      : kind === "settings_redacted" ? "settings input requires redaction" : "settings credential inspection unavailable";
    await assert.rejects(runHistoricalReplayWorkflow(options), error => error instanceof Error && error.message === expected);
    assert.equal(fixture.providers(), 0);
    await assertNoProcessObservation(options.storageBaseDir); await assertNoLegacyReplayArtifacts(options.storageBaseDir);
    await assert.rejects(fs.readFile(join(options.storageBaseDir, REPLAY_ADMISSION_LINEAGE_FILE_NAME)), { code: "ENOENT" });
  });
}

for (const phase of processDurabilityPhases) {
  test(`actual C1 ${phase} failure preserves A/B/reservation and prevents every legacy artifact and runner tick`, async t => {
    const fixture = await issuedWorkflowFixture(t), { options } = fixture;
    let ticks = 0;
    const clockTicks = options.clock.ticks.bind(options.clock);
    t.mock.method(options.clock, "ticks", () => { ticks++; return clockTicks(); });
    const fault = failProcessDurability(t, phase);
    try { await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: process observation storage failed$/); }
    finally { fault.restore(); }
    assert.equal(fault.failures(), 1); assert.equal(fixture.providers(), 0);
    assert.equal(ticks, 1); // Existing planning metadata reads ticks; the actual runner must not enumerate them.
    await fault.verifyPreceding(); await assertNoLegacyReplayArtifacts(options.storageBaseDir);
    const names = (await fs.readdir(options.storageBaseDir)).sort();
    assert.equal(names.includes(REPLAY_PROCESS_OBSERVATION_FILE_NAME), phase !== "file_open");
    const bytes = await Promise.all(names.map(name => fs.readFile(join(options.storageBaseDir, name))));
    for (const output of bytes) assert.equal(output.includes(Buffer.from(processFailureMarker)), false);
    await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
    assert.equal(fixture.providers(), 0); assert.deepEqual((await fs.readdir(options.storageBaseDir)).sort(), names);
    assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(options.storageBaseDir, name)))), bytes);
  });
}
