import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initialOptions, initialPortfolio, initialTime } from "./historicalReplayInitialPortfolioTestFixtures.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { createStoragePaths, FileHistoricalMarketSnapshotStore, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "../storage/replaySourceObservationStore.js";
import { runCodexHistoricalReplay } from "../replay/codexHistoricalReplayRunner.js";

const marker = "SYNTHETIC_CREDENTIAL_SENTINEL";
const credentialRefs = [
  `https://fixture.invalid/history?token=${marker}`,
  `https://fixture.invalid/history?access_token=${marker}`,
  `Authorization: Bearer ${marker}`,
  `authorization:\tbearer ${marker}`,
  `Bearer ${marker}`,
  `X-Api-Key: ${marker}`,
  `https://fixture.invalid/history?%74oken=${marker}`,
  `https://synthetic:${marker}@fixture.invalid/history`
];
function snapshot(ref: string) {
  return { snapshotId: "synthetic_source", market: "KR" as const, symbol: "005930", observedAt: initialTime,
    interval: "1m" as const, lastPriceKrw: 110, sourceRefs: [ref], createdAt: initialTime };
}

for (const [index, ref] of credentialRefs.entries()) {
  test(`credential source ${index} is durably unavailable with no provider or auxiliary emission`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "source-credential-closed-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const paths = createStoragePaths(root);
    await new FileHistoricalMarketSnapshotStore(paths.historicalMarketSnapshotsPath).append(snapshot(ref));
    // The same source ref may already be present in a stored holding. The earlier initial artifact must also be safe.
    const portfolio = initialPortfolio(); portfolio.positions[0]!.priceSourceRefs = [ref];
    await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio);
    const inputNames = new Set(await fs.readdir(root));
    const originalInputs = await Promise.all([...inputNames].map(async name => [name, await fs.readFile(join(root, name))] as const));
    const messages: unknown[][] = [];
    for (const method of ["log", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => { messages.push(args); });
    let providers = 0, ticks = 0;
    const options = initialOptions(root);
    const clockTicks = options.clock.ticks.bind(options.clock);
    t.mock.method(options.clock, "ticks", () => { ticks++; return clockTicks(); });
    await assert.rejects(runHistoricalReplayWorkflow({ ...options, decisionProvider: { decide: async () => {
      providers++; throw Error("must not execute");
    } } }), error => error instanceof Error && error.message === "source input requires redaction" &&
      !String(error.stack).includes(marker) && !String(error.stack).includes(ref));
    assert.equal(providers, 0);
    // The existing workflow plan reads the clock once for metadata; runner tick enumeration never starts.
    assert.equal(ticks, 1);
    assert.equal(JSON.stringify(messages).includes(marker), false);
    const emitted = (await fs.readdir(root)).filter(name => !inputNames.has(name)).sort();
    assert.deepEqual(emitted, [REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE, REPLAY_SOURCE_OBSERVATION_FILE].sort());
    for (const name of emitted) {
      const text = await fs.readFile(join(root, name), "utf8");
      assert.equal(text.includes(marker), false, name);
      assert.equal(text.includes(ref), false, name);
    }
    const source = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
    const initial = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    assert.deepEqual(source.source, { status: "unavailable", reason: "redacted" });
    assert.deepEqual(initial.initialPortfolio, { status: "unavailable", origin: "stored_portfolio", reason: "redacted" });
    assert.deepEqual(source.initialObservation.initialPortfolio, { status: "unavailable", reason: "redacted" });
    const before = await Promise.all(emitted.map(name => fs.readFile(join(root, name))));
    await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
    assert.deepEqual(await Promise.all(emitted.map(name => fs.readFile(join(root, name)))), before);
    for (const [name, original] of originalInputs) assert.deepEqual(await fs.readFile(join(root, name)), original);
  });
}

test("direct source observer cannot turn a detected credential into executable input by mutating its copy", async t => {
  const options = initialOptions("unused"); let ticks = 0, providers = 0, observed = false;
  t.mock.method(options.clock, "ticks", () => { ticks++; return []; });
  await assert.rejects(runCodexHistoricalReplay({ ...options,
    onSourceSnapshots: value => { assert.deepEqual(value, { status: "unavailable", reason: "redacted" }); observed = true;
      if (value.status === "unavailable") value.reason = "limit"; },
    decisionProvider: { decide: async () => { providers++; throw Error("must not execute"); } }
  }, { initialPortfolio: initialPortfolio(), snapshots: [snapshot(credentialRefs[0]!)] }), /^Error: source input requires redaction$/);
  assert.equal(observed, true); assert.equal(ticks, 0); assert.equal(providers, 0);
});

test("ordinary public URLs and legitimate replay identities still execute with recorded source", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-public-url-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ref = "https://fixture.invalid/token/history?symbol=005930&token_count=10";
  await new FileHistoricalMarketSnapshotStore(createStoragePaths(root).historicalMarketSnapshotsPath).append(snapshot(ref));
  const options = { ...initialOptions(root), runId: "ord_abcdef_run_000001", batchId: "exec_abcdef_batch" };
  const result = await runHistoricalReplayWorkflow(options);
  assert.equal(result.status, "completed"); assert.equal(result.replayResult.decisionProviderCallCount, 1);
  const source = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  assert.equal(source.identity.runId, options.runId); assert.equal(source.identity.batchId, options.batchId);
  assert.equal(source.source.status, "recorded"); assert.deepEqual(source.source.snapshot[0].sourceRefs, [ref]);
});
