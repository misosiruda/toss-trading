import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { initialOptions, initialPortfolio, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "../storage/replaySettingsObservationStore.js";
import { replaySettingsObservationSchema } from "../domain/replaySettingsObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

for (const sourceShape of ["missing", "valid"] as const) {
  test(`bound workflow records runner settings after ${sourceShape} actual source`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-bound-workflow-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    if (sourceShape === "valid") await seedInitialSnapshot(root);
    const options = { ...initialOptions(root), executionPolicy: { feeBps: 17, halfSpreadBps: -3 },
      riskPolicy: { minCashReserveRatio: 0, maxPositionWeightRatio: 1 }, paperExitPolicy: {} };
    const result = await runHistoricalReplayWorkflow(options);
    assert.equal(result.status, "completed");
    const record = replaySettingsObservationSchema.parse(JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8")));
    const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    const source = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
    assert.equal(record.initialObservation.observationHash, createReplayResearchHash(initial));
    assert.equal(record.sourceObservation.observationHash, createReplayResearchHash(source));
    assert.equal(record.settings.status, "recorded"); if (record.settings.status !== "recorded") return;
    assert.equal(record.settings.snapshot.packetIdPrefix, options.packetIdPrefix);
    assert.deepEqual(record.settings.snapshot.constraints, options.constraints);
    assert.equal(record.settings.snapshot.executionPolicy?.feeBps, 17);
    // The workflow normalized before the runner boundary; A does not reconstruct earlier input presence.
    assert.equal(record.settings.snapshot.executionPolicy?.halfSpreadBps, 0);
    assert.equal(record.settings.snapshot.executionPolicy?.fillRatio, 1);
    assert.deepEqual(record.settings.snapshot.paperExitPolicy, {});
    assert.equal(result.replayResult.paperExitPolicy, null);
    assert.equal(record.settings.contentHash, createReplayResearchHash({ schemaVersion: record.settings.snapshotVersion, snapshot: record.settings.snapshot }));
    for (const key of ["clock", "sampler", "provider", "admission", "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[key], "unavailable");
    assert.equal(record.completeConfiguration, false); assert.equal(record.completeInput, false);
  });
}

for (const unavailable of ["limit", "unsupported_shape"] as const) {
  test(`settings ${unavailable} retains the existing supported workflow`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-unavailable-workflow-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const options = initialOptions(root);
    if (unavailable === "limit") options.constraints.allowedActions = Array.from({ length: 129 }, () => "VIRTUAL_HOLD" as const);
    else options.riskPolicy = { ...options.riskPolicy, futureUnusedField: "synthetic" } as NonNullable<typeof options.riskPolicy>;
    let calls = 0;
    options.decisionProvider = { decide: async packet => {
      calls++; return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
    } };
    assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
    assert.equal(calls, 1);
    const record = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.deepEqual(record.settings, { status: "unavailable", reason: unavailable });
    assert.equal((await fs.stat(join(root, "historical-replay-report.json"))).isFile(), true);
  });
}

const credentials = [
  "https://example.test/prices?token=SYNTHETIC_SETTINGS_SECRET",
  "Authorization: Bearer SYNTHETIC_SETTINGS_SECRET",
  "source=token=SYNTHETIC_SETTINGS_SECRET"
];
for (const credential of credentials) {
  test(`detected credential settings stop before every auxiliary output: ${credential.split("=")[0]}`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-redacted-workflow-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    const portfolio = initialPortfolio();
    portfolio.positions[0]!.priceSourceRefs = [credential];
    await new FileVirtualPortfolioStore(createStoragePaths(root).virtualPortfolioPath).write(portfolio);
    const inputNames = new Set(await fs.readdir(root));
    const inputBytes = await Promise.all([...inputNames].map(name => fs.readFile(join(root, name))));
    let calls = 0;
    const options = { ...initialOptions(root), packetIdPrefix: credential,
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
    await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: settings input requires redaction$/);
    assert.equal(calls, 0);
    const names = await fs.readdir(root);
    const outputNames = names.filter(name => !inputNames.has(name));
    assert.deepEqual(await Promise.all([...inputNames].map(name => fs.readFile(join(root, name)))), inputBytes);
    assert.deepEqual(outputNames.sort(), [REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE, REPLAY_INITIAL_PORTFOLIO_FILE,
      REPLAY_SOURCE_OBSERVATION_FILE, REPLAY_SETTINGS_OBSERVATION_FILE].sort());
    for (const name of outputNames) {
      const raw = await fs.readFile(join(root, name), "utf8");
      assert.equal(raw.includes("SYNTHETIC_SETTINGS_SECRET"), false);
      assert.equal(raw.includes(credential), false);
    }
    const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    const settings = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.deepEqual(initial.initialPortfolio, { status: "unavailable", origin: "stored_portfolio", reason: "redacted" });
    assert.deepEqual(settings.settings, { status: "unavailable", reason: "redacted" });
    const before = await Promise.all(names.map(name => fs.readFile(join(root, name))));
    await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
    assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(root, name)))), before);
    assert.equal(calls, 0);
  });
}

test("source redaction retains its earlier stop and does not publish a settings record", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-source-redacted-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const store = new FileHistoricalMarketSnapshotStore(createStoragePaths(root).historicalMarketSnapshotsPath);
  const records = (await store.readAll()).records;
  records[0]!.sourceRefs = [credentials[0]!]; await store.replaceAll(records);
  await assert.rejects(runHistoricalReplayWorkflow({ ...initialOptions(root), packetIdPrefix: credentials[0]! }), /^Error: source input requires redaction$/);
  assert.equal((await fs.readdir(root)).includes(REPLAY_SETTINGS_OBSERVATION_FILE), false);
  assert.equal((await fs.readdir(root)).includes("historical-replay-progress.json"), false);
});

for (const alias of ["file", "directory", "symlink", "hardlink"] as const) {
  test(`existing ${alias} settings output rejects before reservation`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-orphan-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const path = join(root, REPLAY_SETTINGS_OBSERVATION_FILE);
    if (alias === "file") await fs.writeFile(path, "original settings");
    if (alias === "directory") await fs.mkdir(path);
    if (alias === "symlink" || alias === "hardlink") {
      const target = join(root, "original-target"); await fs.writeFile(target, "original target");
      if (alias === "symlink") await fs.symlink(target, path); else await fs.link(target, path);
    }
    const names = (await fs.readdir(root)).sort();
    await assert.rejects(runHistoricalReplayWorkflow(initialOptions(root)), /reservation failed/);
    assert.deepEqual((await fs.readdir(root)).sort(), names);
    if (alias !== "directory") assert.match(await fs.readFile(path, "utf8"), /original/);
  });
}

test("standalone workflow keeps observation omission without inventing child settings lineage", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-standalone-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = initialOptions(root); delete options.runId; delete options.batchId; delete options.batchRunIndex;
  assert.equal((await runHistoricalReplayWorkflow(options)).status, "completed");
  assert.equal((await fs.readdir(root)).includes(REPLAY_SETTINGS_OBSERVATION_FILE), false);
});
