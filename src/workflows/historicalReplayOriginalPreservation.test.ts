import assert from "node:assert/strict";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStoragePaths, FileVirtualPortfolioStore } from "../storage/repositories.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "../storage/replayInitialPortfolioObservationStore.js";
import { HistoricalReplayAuditLogRecorder } from "../replay/historicalReplayAuditLog.js";
import { HistoricalReplayProgressRecorder } from "../replay/historicalReplayProgress.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { initialOptions, initialPortfolio, seedInitialSnapshot } from "./historicalReplayInitialPortfolioTestFixtures.js";

const outputKeys = ["historicalReplayReportPath", "historicalReplayProgressPath", "historicalReplayRunMetadataPath",
  "historicalReplayResearchManifestPath", "historicalReplayPacketLogPath", "historicalReplayDecisionLogPath",
  "historicalReplayRiskDecisionLogPath", "historicalReplayTradeLogPath", "historicalReplayPortfolioTimelinePath"] as const;

for (const kind of ["file", "hardlink", "symlink"] as const) for (const key of outputKeys) {
  test(`legacy ${kind} ${key} blocks initialization, concurrent attempts and retry without changing bytes`, async t => {
    const root = await mkdtemp(join(tmpdir(), "child-original-preservation-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const storage = join(root, "child"); await mkdir(storage);
    await seedInitialSnapshot(storage);
    await new FileVirtualPortfolioStore(createStoragePaths(storage).virtualPortfolioPath).write(initialPortfolio());
    const output = createStoragePaths(storage)[key], target = join(root, "original");
    const bytes = Buffer.from(`synthetic original ${key}\n\0`);
    await writeFile(target, bytes);
    if (kind === "file") await writeFile(output, bytes);
    else if (kind === "hardlink") await link(target, output);
    else await symlink(target, output);
    const entries = (await readdir(storage)).sort();
    const before = await Promise.all(entries.map(name => readFile(join(storage, name))));
    const stat = await lstat(output);
    let calls = 0, starts = 0;
    t.mock.method(HistoricalReplayAuditLogRecorder.prototype, "start", async () => { starts++; });
    t.mock.method(HistoricalReplayProgressRecorder.prototype, "start", async () => { starts++; });
    const attempt = () => runHistoricalReplayWorkflow({ ...initialOptions(storage),
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } });
    const results = await Promise.allSettled([attempt(), attempt()]);
    await assert.rejects(attempt(), /reservation failed/);
    assert.equal(starts, 0); assert.equal(calls, 0);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") assert.match(String(result.reason), /reservation failed/);
    }
    assert.deepEqual((await readdir(storage)).sort(), entries);
    assert.deepEqual(await Promise.all(entries.map(name => readFile(join(storage, name)))), before);
    assert.deepEqual(await readFile(target), bytes);
    assert.equal((await lstat(output)).ino, stat.ino);
    if (kind === "symlink") assert.equal(await readlink(output), target);
  });
}

for (const name of [REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE]) {
  test(`orphan ${name} rejects attempts and retry before any initialization`, async t => {
    const root = await mkdtemp(join(tmpdir(), "child-orphan-preservation-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    await writeFile(join(root, name), "synthetic orphan\n");
    const entries = (await readdir(root)).sort(), before = await Promise.all(entries.map(n => readFile(join(root, n))));
    let calls = 0, starts = 0;
    t.mock.method(HistoricalReplayAuditLogRecorder.prototype, "start", async () => { starts++; });
    t.mock.method(HistoricalReplayProgressRecorder.prototype, "start", async () => { starts++; });
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(runHistoricalReplayWorkflow({ ...initialOptions(root),
      decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } }), /reservation failed/);
    assert.equal(starts, 0); assert.equal(calls, 0);
    assert.deepEqual((await readdir(root)).sort(), entries);
    assert.deepEqual(await Promise.all(entries.map(n => readFile(join(root, n)))), before);
  });
}

test("legacy audit log bytes survive the unmocked workflow entry", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-real-legacy-entry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const paths = createStoragePaths(root);
  await Promise.all(outputKeys.map(key => writeFile(paths[key], `original ${key}\n`)));
  let calls = 0;
  const outcome = await runHistoricalReplayWorkflow({ ...initialOptions(root), decisionProvider: { decide: async () => {
    calls++; throw Error("must not run");
  } } }).then(() => null, error => error);
  const changed = [];
  for (const key of outputKeys) if (await readFile(paths[key], "utf8") !== `original ${key}\n`) changed.push(key);
  t.diagnostic(JSON.stringify({ changed, providerCalls: calls, outcome: String(outcome) }));
  assert.deepEqual(changed, []);
  assert.equal(calls, 0); assert.match(String(outcome), /reservation failed/);
});

test("dangling output symlink also rejects without creating its target", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-dangling-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = createStoragePaths(root).historicalReplayReportPath, target = join(root, "missing-target");
  await symlink(target, output);
  await assert.rejects(runHistoricalReplayWorkflow(initialOptions(root)), /reservation failed/);
  assert.equal(await readlink(output), target);
  await assert.rejects(lstat(target), { code: "ENOENT" });
  assert.deepEqual(await readdir(root), ["historical-replay-report.json"]);
});

test("fresh competing workflows admit one writer, preserve its bytes on retry and allow unchanged inputs", async t => {
  const root = await mkdtemp(join(tmpdir(), "child-fresh-race-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  const paths = createStoragePaths(root);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({ ...initialPortfolio(), cashKrw: 100_000, positions: [] });
  const inputPaths = [paths.virtualPortfolioPath, paths.historicalMarketSnapshotsPath];
  const inputs = await Promise.all(inputPaths.map(path => readFile(path)));
  let calls = 0;
  const attempt = () => runHistoricalReplayWorkflow({ ...initialOptions(root), decisionProvider: { decide: async packet => {
    calls++; return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
  } } });
  const results = await Promise.allSettled([attempt(), attempt()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected");
  assert.ok(rejected); assert.match(String(rejected.reason), /reservation failed/);
  assert.equal(calls, 1);
  const entries = (await readdir(root)).sort(), before = await Promise.all(entries.map(name => readFile(join(root, name))));
  await assert.rejects(attempt(), /reservation failed/);
  assert.equal(calls, 1); assert.deepEqual((await readdir(root)).sort(), entries);
  assert.deepEqual(await Promise.all(entries.map(name => readFile(join(root, name)))), before);
  assert.deepEqual(await Promise.all(inputPaths.map(path => readFile(path))), inputs);
});
