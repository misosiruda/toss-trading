import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SimulatedClock } from "../replay/simulatedClock.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { createStoragePaths, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { replayInitialPortfolioObservationSchema } from "../domain/replayInitialPortfolioObservation.js";
import { initialOptions, initialPortfolio, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";

test("batch child persists the exact runner initial portfolio before replay", async t => {
  const storageBaseDir = await mkdtemp(join(tmpdir(), "child-initial-state-"));
  t.after(() => rm(storageBaseDir, { recursive: true, force: true }));
  const result = await runHistoricalReplayWorkflow({
    storageBaseDir, runId: "batch_fixture_run_000001", batchId: "batch_fixture", batchRunIndex: 1,
    generatedAt: new Date("2026-10-07T00:00:00.000Z"), initialCashKrw: 0,
    clock: new SimulatedClock({ startAt: new Date("2025-01-02T00:00:00Z"), endAt: new Date("2025-01-02T00:00:00Z"), stepSeconds: 60 }),
    packetIdPrefix: "initial_fixture", packetExpiresInSeconds: 60, maxCandidates: 10, maxSnapshotAgeSeconds: 300,
    constraints: { maxNewPositions: 3, maxBudgetPerSymbolKrw: 100_000, allowedActions: ["VIRTUAL_HOLD"] }
  });
  const record = JSON.parse(await readFile(join(storageBaseDir, "historical-replay-initial-portfolio.json"), "utf8"));
  assert.equal(record.schemaVersion, "replay_initial_portfolio_observation.v1");
  assert.deepEqual(record.identity, { runId: "batch_fixture_run_000001", batchId: "batch_fixture", runIndex: 1 });
  assert.equal(record.initialPortfolio.status, "recorded");
  assert.equal(record.initialPortfolio.origin, "generated");
  assert.deepEqual(record.initialPortfolio.snapshot, result.replayResult.initialPortfolio);
  assert.equal(record.initialPortfolio.snapshot.cashKrw, 0);
  assert.equal(record.comparability, "unavailable");
});

test("stored initial cash and all holdings fields override requested cash and remain before mark-to-market", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-stored-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = createStoragePaths(root), portfolio = initialPortfolio();
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio);
  await seedInitialSnapshot(root);
  const result = await runHistoricalReplayWorkflow(initialOptions(root));
  const record = replayInitialPortfolioObservationSchema.parse(JSON.parse(await readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8")));
  const reservation = JSON.parse(await readFile(join(root, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), "utf8"));
  assert.equal(record.reservationHash, createReplayResearchHash(reservation));
  assert.equal(record.initialPortfolio.status, "recorded");
  if (record.initialPortfolio.status !== "recorded") return;
  assert.equal(record.initialPortfolio.origin, "stored_portfolio");
  assert.deepEqual(record.initialPortfolio.snapshot, portfolio);
  assert.deepEqual(result.replayResult.initialPortfolio, portfolio);
  assert.notEqual(result.replayResult.finalPortfolio.positions[0]!.marketPriceKrw, portfolio.positions[0]!.marketPriceKrw);
  const metadata = JSON.parse(await readFile(paths.historicalReplayRunMetadataPath, "utf8"));
  assert.deepEqual(record.identity, metadata.identity);
  assert.equal(metadata.configuration.initialCashKrw, 100_000);
  assert.equal(record.initialPortfolio.snapshot.cashKrw, 0);
  for (const field of ["admission", "source", "configuration", "runtime", "dependencies", "result", "comparability"] as const) assert.equal(record[field], "unavailable");
  assert.equal(record.completeInput, false);
  for (const update of [{ schemaVersion: "replay_initial_portfolio_observation.v2" }, { completeInput: true }, { invented: true }]) {
    assert.equal(replayInitialPortfolioObservationSchema.safeParse({ ...record, ...update }).success, false);
  }
});

test("same child storage is immutable and rejected before rewriting existing replay artifacts", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-state-reuse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await runHistoricalReplayWorkflow(initialOptions(root));
  const entries = await readdir(root), before = await Promise.all(entries.map(name => readFile(join(root, name))));
  let calls = 0;
  await assert.rejects(runHistoricalReplayWorkflow({ ...initialOptions(root), initialCashKrw: 200_000,
    decisionProvider: { decide: async () => { calls++; throw Error("must not call"); } } }), /observation reservation failed/);
  assert.equal(calls, 0);
  assert.deepEqual(await readdir(root), entries);
  assert.deepEqual(await Promise.all(entries.map(name => readFile(join(root, name)))), before);
});

test("orphan existing observation blocks admission without overwriting a prior report", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-state-orphan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = createStoragePaths(root).historicalReplayReportPath;
  await writeFile(report, "old-report"); await writeFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "old-observation");
  await assert.rejects(runHistoricalReplayWorkflow(initialOptions(root)), /observation reservation failed/);
  assert.equal(await readFile(report, "utf8"), "old-report");
  assert.equal(await readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"), "old-observation");
});

test("redacted initial state records unavailable without exposing sensitive contents or individual hashes", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-state-redacted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const portfolio = initialPortfolio(); portfolio.positions[0]!.priceSourceRefs = ["account:123456-123-123456"];
  await new FileVirtualPortfolioStore(createStoragePaths(root).virtualPortfolioPath).write(portfolio);
  const result = await runHistoricalReplayWorkflow(initialOptions(root));
  assert.equal(result.status, "completed");
  const raw = await readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"), record = JSON.parse(raw);
  assert.equal(raw.includes("123456"), false);
  assert.deepEqual(record.initialPortfolio, { status: "unavailable", origin: "stored_portfolio", reason: "redacted" });
});

test("standalone historical workflow does not synthesize a child binding", async t => {
  const root = await mkdtemp(join(tmpdir(), "standalone-initial-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = initialOptions(root); delete options.runId; delete options.batchId; delete options.batchRunIndex;
  await runHistoricalReplayWorkflow(options);
  assert.equal((await readdir(root)).includes(REPLAY_INITIAL_PORTFOLIO_FILE), false);
  assert.equal((await readdir(root)).includes(REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE), false);
});

test("same initial input and synthetic AI metadata with different decisions never gains comparability", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-synthetic-divergence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const observations = [], results = [];
  for (const mode of ["hold", "buy"] as const) {
    const storage = join(root, mode); await seedInitialSnapshot(storage);
    const options = initialOptions(storage);
    options.constraints.allowedActions = ["VIRTUAL_BUY", "VIRTUAL_HOLD"];
    const provider = new FirstPricedHistoricalDecisionProvider();
    const result = await runHistoricalReplayWorkflow({ ...options,
      decisionProviderMetadata: { mode: "codex_cli", modelId: "same-synthetic-model" },
      decisionProvider: { decide: async packet => ({ attempted: true, failure: null, command: null,
        decision: mode === "buy" ? provider.decide(packet) : { packetId: packet.packetId, summary: "synthetic hold", decisions: [] } }) }
    });
    results.push(result);
    const observation = replayInitialPortfolioObservationSchema.parse(JSON.parse(await readFile(join(storage, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8")));
    observations.push(observation);
    assert.equal(observation.comparability, "unavailable"); assert.equal(observation.runtime, "unavailable");
    assert.equal(observation.result, "unavailable"); assert.equal(observation.completeInput, false);
  }
  assert.deepEqual(observations[0]!.initialPortfolio, observations[1]!.initialPortfolio);
  assert.notDeepEqual(results[0]!.replayResult.decisions, results[1]!.replayResult.decisions);
});
