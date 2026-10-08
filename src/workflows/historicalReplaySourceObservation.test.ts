import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { initialOptions, initialPortfolio, initialTime, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { replaySourceObservationSchema } from "../domain/replaySourceObservation.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

for (const shape of ["missing", "empty", "blank", "corrupt", "valid-and-corrupt"] as const) {
  test(`source observation preserves actual parsed consumption for ${shape}`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "source-consumption-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const sourcePath = createStoragePaths(root).historicalMarketSnapshotsPath;
    if (shape === "empty") await fs.writeFile(sourcePath, "");
    if (shape === "blank") await fs.writeFile(sourcePath, "\n \n\t\n");
    if (shape === "corrupt") await fs.writeFile(sourcePath, "{private malformed source\n");
    if (shape === "valid-and-corrupt") { await seedInitialSnapshot(root); await fs.appendFile(sourcePath, "{private malformed source\n"); }
    const expected = await new FileHistoricalMarketSnapshotStore(sourcePath).readAll();
    const result = await runHistoricalReplayWorkflow(initialOptions(root));
    assert.equal(result.status, "completed");
    const raw = await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8");
    const record = replaySourceObservationSchema.parse(JSON.parse(raw));
    const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    const reservation = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), "utf8"));
    assert.equal(record.source.status, "recorded");
    if (record.source.status !== "recorded") return;
    assert.deepEqual(record.source.snapshot, expected.records);
    assert.equal(record.source.contentHash, createReplayResearchHash({ schemaVersion: "replay_source_snapshot.v1", snapshot: expected.records }));
    assert.deepEqual(record.identity, initial.identity);
    assert.equal(record.startedAt, initial.startedAt);
    assert.equal(record.reservationHash, createReplayResearchHash(reservation));
    assert.equal(record.initialObservation.observationHash, createReplayResearchHash(initial));
    assert.deepEqual(record.initialObservation.initialPortfolio, {
      status: initial.initialPortfolio.status, snapshotVersion: initial.initialPortfolio.snapshotVersion,
      contentHash: initial.initialPortfolio.contentHash
    });
    assert.equal(initial.source, "unavailable");
    for (const field of ["sourceFileIdentity", "sourceReadCompleteness", "sourceTrust", "acquisition", "admission", "configuration", "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[field], "unavailable");
    assert.equal(record.completeInput, false);
    assert.equal(raw.includes(sourcePath), false);
    assert.equal(raw.includes("private malformed"), false);
    for (const change of [{ completeInput: true }, { schemaVersion: "replay_source_observation.v2" }, { originVerified: true }]) {
      assert.equal(replaySourceObservationSchema.safeParse({ ...record, ...change }).success, false);
    }
  });
}

test("existing stored input without origin metadata is recorded; labels do not grant acquisition trust", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-stored-positive-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const path = createStoragePaths(root).historicalMarketSnapshotsPath;
  const record = (await new FileHistoricalMarketSnapshotStore(path).readAll()).records[0]!;
  record.sourceRefs = ["ordinary_stored_reference", "fixture_label_is_not_origin_proof"];
  await new FileHistoricalMarketSnapshotStore(path).replaceAll([record]);
  await runHistoricalReplayWorkflow(initialOptions(root));
  const observation = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  assert.equal(observation.source.status, "recorded");
  assert.deepEqual(observation.source.snapshot, [record]);
  assert.equal(observation.sourceTrust, "unavailable");
  assert.equal(observation.acquisition, "unavailable");
});

test("source reference binds an unavailable initial observation without leaking initial content", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-initial-unavailable-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const portfolio = initialPortfolio(); portfolio.portfolioId = "account:123456-123-123456";
  await new FileVirtualPortfolioStore(createStoragePaths(root).virtualPortfolioPath).write(portfolio);
  await seedInitialSnapshot(root);
  await runHistoricalReplayWorkflow(initialOptions(root));
  const raw = await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8");
  const observation = replaySourceObservationSchema.parse(JSON.parse(raw));
  const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
  assert.deepEqual(observation.initialObservation.initialPortfolio, { status: "unavailable", reason: "redacted" });
  assert.equal(observation.initialObservation.observationHash, createReplayResearchHash(initial));
  assert.equal(raw.includes("123456"), false);
  assert.equal(observation.source.status, "recorded");
  assert.equal(observation.completeInput, false);
});

test("redacted source records unavailable and blocks legacy artifact publication", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-redacted-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await new FileHistoricalMarketSnapshotStore(createStoragePaths(root).historicalMarketSnapshotsPath).append({
    snapshotId: "snapshot_redacted", market: "KR", symbol: "005930", observedAt: initialTime,
    interval: "1m", lastPriceKrw: 110, sourceRefs: ["ord_sensitive12345"], createdAt: initialTime
  });
  await assert.rejects(runHistoricalReplayWorkflow(initialOptions(root)), /^Error: source input requires redaction$/);
  const raw = await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8");
  const observation = JSON.parse(raw);
  assert.deepEqual(observation.source, { status: "unavailable", reason: "redacted" });
  assert.equal(raw.includes("sensitive12345"), false);
  assert.equal(raw.includes("snapshot_redacted"), false);
});

test("source file replacement after capture cannot alter actual child consumption or its hash", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-file-replacement-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const path = createStoragePaths(root).historicalMarketSnapshotsPath;
  let calls = 0;
  const result = await runHistoricalReplayWorkflow({ ...initialOptions(root), decisionProvider: { decide: async packet => {
    calls++;
    const before = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
    assert.equal(before.source.snapshot[0].lastPriceKrw, 110);
    assert.equal(packet.candidates[0]!.lastPriceKrw, 110);
    await fs.writeFile(path, "replacement after actual capture\n");
    return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
  } } });
  assert.equal(result.status, "completed"); assert.equal(calls, 1);
  const after = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  assert.equal(after.source.snapshot[0].lastPriceKrw, 110);
  assert.equal(after.source.contentHash, createReplayResearchHash({ schemaVersion: after.source.snapshotVersion, snapshot: after.source.snapshot }));
});

test("standalone workflow does not create a source observation or invented child binding", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-standalone-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = initialOptions(root); delete options.runId; delete options.batchId; delete options.batchRunIndex;
  await runHistoricalReplayWorkflow(options);
  assert.equal((await fs.readdir(root)).includes(REPLAY_SOURCE_OBSERVATION_FILE), false);
});
