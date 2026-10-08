import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initialPortfolio } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { sourceOptions } from "../replay/codexReplaySourceTestFixtures.js";
import { reserveReplayInitialPortfolioObservation, REPLAY_INITIAL_PORTFOLIO_FILE } from "./replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE, writeReplaySourceObservation } from "./replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE, REPLAY_SETTINGS_OBSERVATION_MAX_FILE_BYTES, writeReplaySettingsObservation } from "./replaySettingsObservationStore.js";
import { prepareReplaySourceSnapshot } from "../domain/replaySourceSnapshot.js";
import { prepareReplaySettingsSnapshot } from "../domain/replaySettingsSnapshot.js";
import { replaySettingsObservationSchema } from "../domain/replaySettingsObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

const identity = { runId: "child_one", batchId: "batch_one", runIndex: 1 };
const startedAt = "2026-10-08T00:00:00.000Z";
const settings = () => prepareReplaySettingsSnapshot(sourceOptions());

for (const before of ["initial", "source"] as const) {
  test(`settings attempt before durable ${before} consumes its attempt without publishing`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-before-source-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root, identity, startedAt, origin: "generated" });
    if (before === "source") await writer(initialPortfolio());
    await assert.rejects(writer.observeSettings(settings()), /preceding state unavailable/);
    if (before === "initial") await writer(initialPortfolio());
    await writer.observeSource(prepareReplaySourceSnapshot([]));
    await assert.rejects(writer.observeSettings(settings()), /already attempted/);
    assert.equal((await fs.readdir(root)).includes(REPLAY_SETTINGS_OBSERVATION_FILE), false);
  });
}

test("settings reference binds immutable emitted records despite file replacement", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-emitted-binding-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root, identity, startedAt, origin: "generated" });
  await writer(initialPortfolio()); await writer.observeSource(prepareReplaySourceSnapshot([]));
  const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
  const source = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  await fs.writeFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), JSON.stringify({ ...source, identity: { ...identity, runId: "replacement" } }));
  await fs.writeFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), JSON.stringify({ ...initial, identity: { ...identity, runId: "replacement" } }));
  const observed = settings(); assert.equal(observed.status, "recorded");
  await writer.observeSettings(observed);
  const bytes = await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE));
  const record = replaySettingsObservationSchema.parse(JSON.parse(bytes.toString()));
  assert.deepEqual(record.identity, identity);
  assert.equal(record.initialObservation.observationHash, createReplayResearchHash(initial));
  assert.equal(record.sourceObservation.observationHash, createReplayResearchHash(source));
  assert.equal(Object.hasOwn(record.sourceObservation.source, "snapshot"), false);
  assert.deepEqual(record.settings, observed);
  assert.equal(record.completeInput, false); assert.equal(record.completeConfiguration, false);
  assert.equal(initial.configuration, "unavailable"); assert.equal(source.configuration, "unavailable");
  await assert.rejects(writer.observeSettings(observed), /already attempted/);
  assert.deepEqual(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE)), bytes);
  for (const changes of [{ schemaVersion: "replay_settings_observation.v2" }, { completeConfiguration: true },
    { clock: "recorded" }, { comparability: "comparable" }, { extra: true }]) {
    assert.equal(replaySettingsObservationSchema.safeParse({ ...record, ...changes }).success, false);
  }
});

for (const reason of ["unsupported_shape", "limit", "retention_unavailable", "redacted"] as const) {
  test(`source ${reason} binding keeps exact state and existing redaction barrier`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-source-state-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root, identity, startedAt, origin: "generated" });
    const portfolio = initialPortfolio(); portfolio.portfolioId = "account:123456-123-123456";
    await writer(portfolio); await writer.observeSource({ status: "unavailable", reason });
    if (reason === "redacted") {
      await assert.rejects(writer.observeSettings(settings()), /^Error: settings observation storage failed$/);
      assert.equal((await fs.readdir(root)).includes(REPLAY_SETTINGS_OBSERVATION_FILE), false);
    } else {
      await writer.observeSettings(settings());
      const record = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
      assert.deepEqual(record.sourceObservation.source, { status: "unavailable", reason });
      assert.deepEqual(record.initialObservation.initialPortfolio, { status: "unavailable", reason: "redacted" });
    }
  });
}

test("source receipt is small, frozen and settings writer rejects mixed identity, lineage, version and content", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-source-receipt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root, identity, startedAt, origin: "generated" });
  await writer(initialPortfolio());
  const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
  const sourceReference = await writeReplaySourceObservation({ storageBaseDir: root, initialObservation: initial,
    source: prepareReplaySourceSnapshot([]) });
  assert.equal(Object.isFrozen(sourceReference), true);
  assert.equal(Object.isFrozen(sourceReference.sourceObservation.source), true);
  assert.ok(JSON.stringify(sourceReference).length < 2_000);
  const variants = [
    { ...sourceReference, identity: { ...identity, runId: "another_child" } },
    { ...sourceReference, startedAt: "2026-10-09T00:00:00.000Z" },
    { ...sourceReference, reservationHash: `sha256:${"0".repeat(64)}` },
    { ...sourceReference, initialObservation: { ...sourceReference.initialObservation, observationHash: `sha256:${"0".repeat(64)}` } },
    { ...sourceReference, sourceObservation: { ...sourceReference.sourceObservation, schemaVersion: "replay_source_observation.v2" } }
  ];
  for (const variant of variants) {
    await assert.rejects(writeReplaySettingsObservation({ storageBaseDir: root, initialObservation: initial,
      sourceReference: variant as typeof sourceReference, settings: settings() }), /^Error: settings observation storage failed$/);
    assert.equal((await fs.readdir(root)).includes(REPLAY_SETTINGS_OBSERVATION_FILE), false);
  }
  const bad = settings(); assert.equal(bad.status, "recorded"); if (bad.status !== "recorded") return;
  await assert.rejects(writeReplaySettingsObservation({ storageBaseDir: root, initialObservation: initial,
    sourceReference, settings: { ...bad, contentHash: `sha256:${"0".repeat(64)}` } }), /^Error: settings observation storage failed$/);
});

test("maximal escaped child identity fits settings envelope allowance", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-envelope-bound-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
    identity: { runId: "a".repeat(256), batchId: "\u0000".repeat(4096), runIndex: Number.MAX_SAFE_INTEGER }, startedAt, origin: "generated" });
  await writer(initialPortfolio()); await writer.observeSource(prepareReplaySourceSnapshot([]));
  const observed = settings(); assert.equal(observed.status, "recorded"); if (observed.status !== "recorded") return;
  await writer.observeSettings(observed);
  const raw = await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE));
  assert.ok(raw.length - Buffer.byteLength(JSON.stringify(observed.snapshot)) < 65_536);
  assert.equal(REPLAY_SETTINGS_OBSERVATION_MAX_FILE_BYTES, 4_194_304 + 65_536);
});

test("failed source cannot authorize settings and the rejected settings attempt stays consumed", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-failed-source-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root, identity, startedAt, origin: "generated" });
  await writer(initialPortfolio());
  const source = prepareReplaySourceSnapshot([]); assert.equal(source.status, "recorded"); if (source.status !== "recorded") return;
  await assert.rejects(writer.observeSource({ ...source, contentHash: `sha256:${"0".repeat(64)}` }), /source observation storage failed/);
  await assert.rejects(writer.observeSettings(settings()), /preceding state unavailable/);
  await assert.rejects(writer.observeSettings(settings()), /already attempted/);
  assert.equal((await fs.readdir(root)).includes(REPLAY_SETTINGS_OBSERVATION_FILE), false);
});
