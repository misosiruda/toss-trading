import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initialOptions, initialPortfolio, seedInitialSnapshot } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { reserveReplayInitialPortfolioObservation, REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "./replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE, REPLAY_SOURCE_OBSERVATION_MAX_FILE_BYTES } from "./replaySourceObservationStore.js";
import { prepareReplaySourceSnapshot } from "../domain/replaySourceSnapshot.js";
import { createStoragePaths } from "./repositories.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";

for (const failure of ["open", "write", "file-sync", "file-close", "directory-open", "directory-sync", "directory-close"] as const) {
  test(`source ${failure} failure stops provider and preserves all existing observations`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "source-durable-failure-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    let sourceOpened = false, injected = false, calls = 0;
    const original = fs.open;
    const fail = async () => { injected = true; throw Object.assign(Error("private-source-path-detail"), { code: "EIO" }); };
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const isSource = String(args[0]).endsWith(REPLAY_SOURCE_OBSERVATION_FILE) && typeof args[1] === "number";
      const isDirectory = sourceOpened && String(args[0]) === root && args[1] === "r";
      if (isSource && failure === "open") return fail();
      if (isDirectory && failure === "directory-open") return fail();
      const handle = await original(...args);
      if (isSource) {
        sourceOpened = true;
        if (failure === "write") t.mock.method(handle, "writeFile", fail);
        if (failure === "file-sync") t.mock.method(handle, "sync", fail);
        if (failure === "file-close") { const close = handle.close.bind(handle); t.mock.method(handle, "close", async () => { await close(); return fail(); }); }
      }
      if (isDirectory) {
        if (failure === "directory-sync") t.mock.method(handle, "sync", fail);
        if (failure === "directory-close") { const close = handle.close.bind(handle); t.mock.method(handle, "close", async () => { await close(); return fail(); }); }
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      const options = { ...initialOptions(root), decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
      await assert.rejects(runHistoricalReplayWorkflow(options), error => error instanceof Error && error.message === "source observation storage failed");
      assert.equal(injected, true); assert.equal(calls, 0);
      assert.equal((await fs.stat(join(root, REPLAY_INITIAL_PORTFOLIO_FILE))).isFile(), true);
      assert.equal((await fs.stat(join(root, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE))).isFile(), true);
      assert.equal((await fs.readdir(root)).includes("historical-replay-report.json"), false);
      assert.equal((await fs.readdir(root)).includes("historical-replay-progress.json"), false);
      mock.mock.restore(); syncBuiltinESMExports();
      const names = (await fs.readdir(root)).sort(), bytes = await Promise.all(names.map(name => fs.readFile(join(root, name))));
      await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
      assert.equal(calls, 0);
      assert.deepEqual((await fs.readdir(root)).sort(), names);
      assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(root, name)))), bytes);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("source directory sync completes before existing artifact initialization and first provider", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-durable-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  let sourceOpened = false, synced = false, calls = 0;
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(REPLAY_SOURCE_OBSERVATION_FILE) && typeof args[1] === "number") sourceOpened = true;
    if (sourceOpened && String(args[0]) === root && args[1] === "r" && !synced) {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => { entered(); await gate; await sync(); synced = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const run = runHistoricalReplayWorkflow({ ...initialOptions(root), decisionProvider: { decide: async packet => {
    calls++; assert.equal(synced, true);
    assert.equal((await fs.stat(createStoragePaths(root).historicalReplayResearchManifestPath)).isFile(), true);
    return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
  } } });
  try {
    await waiting; assert.equal(calls, 0);
    assert.equal((await fs.readdir(root)).includes("historical-replay-research-manifest.json"), false);
    release(); assert.equal((await run).status, "completed"); assert.equal(calls, 1);
  } finally { release(); await run.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

test("orphan source alone rejects before overwriting old artifacts or creating a reservation", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-orphan-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = join(root, REPLAY_SOURCE_OBSERVATION_FILE); await fs.writeFile(path, "original-source");
  await assert.rejects(runHistoricalReplayWorkflow(initialOptions(root)), /reservation failed/);
  assert.deepEqual(await fs.readdir(root), [REPLAY_SOURCE_OBSERVATION_FILE]);
  assert.equal(await fs.readFile(path, "utf8"), "original-source");
});

test("source observer is one-shot, follows its own durable initial writer and never mixes child identity", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-writer-binding-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ["child_one", "child_two"]) {
    const directory = join(root, name);
    const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: directory,
      identity: { runId: name, batchId: "batch_one", runIndex: name === "child_one" ? 1 : 2 },
      startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
    const portfolio = initialPortfolio(); portfolio.cashKrw = name === "child_one" ? 100 : 200;
    await writer(portfolio);
    const observed = prepareReplaySourceSnapshot([]);
    await writer.observeSource(observed);
    const file = join(directory, REPLAY_SOURCE_OBSERVATION_FILE), before = await fs.readFile(file);
    const source = JSON.parse(before.toString()), initial = JSON.parse(await fs.readFile(join(directory, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    assert.equal(source.identity.runId, name);
    assert.equal(source.initialObservation.observationHash, createReplayResearchHash(initial));
    assert.equal(source.initialObservation.initialPortfolio.contentHash, initial.initialPortfolio.contentHash);
    await assert.rejects(writer.observeSource(observed), /already attempted/);
    assert.deepEqual(await fs.readFile(file), before);
  }
  const one = JSON.parse(await fs.readFile(join(root, "child_one", REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  const two = JSON.parse(await fs.readFile(join(root, "child_two", REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  assert.notEqual(one.initialObservation.observationHash, two.initialObservation.observationHash);
  assert.notEqual(one.initialObservation.initialPortfolio.contentHash, two.initialObservation.initialPortfolio.contentHash);
});

test("source attempt before durable initial state cannot be retried or publish payload", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-unavailable-writer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
    identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 }, startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
  await assert.rejects(writer.observeSource({ status: "unavailable", reason: "retention_unavailable" }), /initial state unavailable/);
  await writer(initialPortfolio());
  await assert.rejects(writer.observeSource({ status: "unavailable", reason: "retention_unavailable" }), /already attempted/);
  assert.equal((await fs.readdir(root)).includes(REPLAY_SOURCE_OBSERVATION_FILE), false);
});

test("maximal escaped identity envelope remains within the separate 64 KiB allowance", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-envelope-bound-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
    identity: { runId: "a".repeat(256), batchId: "\u0000".repeat(4096), runIndex: Number.MAX_SAFE_INTEGER },
    startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
  await writer(initialPortfolio()); await writer.observeSource(prepareReplaySourceSnapshot([]));
  const raw = await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE));
  const overheadIncludingNewline = raw.length - 2;
  assert.ok(overheadIncludingNewline < 65_536);
  assert.equal(REPLAY_SOURCE_OBSERVATION_MAX_FILE_BYTES, 16_777_216 + 65_536);
});

for (const reason of ["unsupported_shape", "redacted", "limit", "retention_unavailable"] as const) {
  test(`typed ${reason} retains no source content and its write cannot be ignored`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "source-unavailable-durable-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
      identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 }, startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
    await writer(initialPortfolio());
    const original = fs.open;
    let injected = false;
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (String(args[0]).endsWith(REPLAY_SOURCE_OBSERVATION_FILE) && typeof args[1] === "number") {
        t.mock.method(handle, "sync", async () => { injected = true; throw Error("private sync detail"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(writer.observeSource({ status: "unavailable", reason }), /^Error: source observation storage failed$/);
      assert.equal(injected, true);
      const partial = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
      assert.deepEqual(partial.source, { status: "unavailable", reason });
      await assert.rejects(writer.observeSource({ status: "unavailable", reason }), /already attempted/);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("source binding uses the emitted initial record even if its file is later changed", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "source-initial-replacement-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
    identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 }, startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
  await writer(initialPortfolio());
  const path = join(root, REPLAY_INITIAL_PORTFOLIO_FILE);
  const initial = JSON.parse(await fs.readFile(path, "utf8"));
  const changed = structuredClone(initial); changed.identity.runId = "another_child";
  await fs.writeFile(path, JSON.stringify(changed));
  await writer.observeSource(prepareReplaySourceSnapshot([]));
  const source = JSON.parse(await fs.readFile(join(root, REPLAY_SOURCE_OBSERVATION_FILE), "utf8"));
  assert.equal(source.identity.runId, "child_one");
  assert.equal(source.initialObservation.observationHash, createReplayResearchHash(initial));
  assert.notEqual(source.initialObservation.observationHash, createReplayResearchHash(changed));
  assert.equal(source.completeInput, false);
});
