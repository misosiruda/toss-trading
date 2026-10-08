import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initialOptions, initialPortfolio, seedInitialSnapshot } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { reserveReplayInitialPortfolioObservation, REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "./replayInitialPortfolioObservationStore.js";
import { REPLAY_SOURCE_OBSERVATION_FILE } from "./replaySourceObservationStore.js";
import { REPLAY_SETTINGS_OBSERVATION_FILE } from "./replaySettingsObservationStore.js";
import { prepareReplaySourceSnapshot } from "../domain/replaySourceSnapshot.js";

for (const failure of ["open", "write", "file-sync", "file-close", "directory-open", "directory-sync", "directory-close"] as const) {
  test(`settings ${failure} failure preserves preceding records and prevents legacy publication`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-durable-failure-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    let settingsOpened = false, injected = false, calls = 0;
    const original = fs.open;
    const fail = async () => { injected = true; throw Object.assign(Error("synthetic-private-settings-detail"), { code: "EIO" }); };
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const isSettings = String(args[0]).endsWith(REPLAY_SETTINGS_OBSERVATION_FILE) && typeof args[1] === "number";
      const isDirectory = settingsOpened && String(args[0]) === root && args[1] === "r";
      if (isSettings && failure === "open") return fail();
      if (isDirectory && failure === "directory-open") return fail();
      const handle = await original(...args);
      if (isSettings) {
        settingsOpened = true;
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
      await assert.rejects(runHistoricalReplayWorkflow(options), /^Error: settings observation storage failed$/);
      assert.equal(injected, true); assert.equal(calls, 0);
      for (const name of [REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE, REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_SOURCE_OBSERVATION_FILE]) {
        assert.equal((await fs.stat(join(root, name))).isFile(), true);
      }
      assert.equal((await fs.readdir(root)).some(name => /report|progress|research-manifest|packets/.test(name)), false);
      mock.mock.restore(); syncBuiltinESMExports();
      const names = (await fs.readdir(root)).sort(), bytes = await Promise.all(names.map(name => fs.readFile(join(root, name))));
      await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
      assert.equal(calls, 0);
      assert.deepEqual((await fs.readdir(root)).sort(), names);
      assert.deepEqual(await Promise.all(names.map(name => fs.readFile(join(root, name)))), bytes);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("settings directory close is a barrier before legacy outputs and first provider", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-durable-barrier-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  let settingsOpened = false, closed = false, calls = 0;
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(REPLAY_SETTINGS_OBSERVATION_FILE) && typeof args[1] === "number") settingsOpened = true;
    if (settingsOpened && String(args[0]) === root && args[1] === "r" && !closed) {
      const close = handle.close.bind(handle);
      t.mock.method(handle, "close", async () => { entered(); await gate; await close(); closed = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const run = runHistoricalReplayWorkflow({ ...initialOptions(root), decisionProvider: { decide: async packet => {
    calls++; assert.equal(closed, true);
    assert.equal((await fs.stat(join(root, "historical-replay-research-manifest.json"))).isFile(), true);
    return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
  } } });
  try {
    await waiting; assert.equal(calls, 0);
    assert.equal((await fs.readdir(root)).includes("historical-replay-research-manifest.json"), false);
    release(); assert.equal((await run).status, "completed"); assert.equal(calls, 1);
  } finally { release(); await run.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

for (const reason of ["unsupported_shape", "redacted", "limit", "inspection_unavailable"] as const) {
  test(`settings typed ${reason} write failure is fatal and cannot be retried`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "settings-unavailable-durable-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
      identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 }, startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
    await writer(initialPortfolio()); await writer.observeSource(prepareReplaySourceSnapshot([]));
    const original = fs.open;
    let injected = false;
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (String(args[0]).endsWith(REPLAY_SETTINGS_OBSERVATION_FILE) && typeof args[1] === "number") {
        t.mock.method(handle, "sync", async () => { injected = true; throw Error("private settings sync detail"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(writer.observeSettings({ status: "unavailable", reason }), /^Error: settings observation storage failed$/);
      assert.equal(injected, true);
      const partial = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
      assert.deepEqual(partial.settings, { status: "unavailable", reason });
      await assert.rejects(writer.observeSettings({ status: "unavailable", reason }), /already attempted/);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("settings callback re-entry while its write is pending cannot publish twice", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "settings-reentrant-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writer = await reserveReplayInitialPortfolioObservation({ storageBaseDir: root,
    identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 }, startedAt: "2026-10-08T00:00:00.000Z", origin: "generated" });
  await writer(initialPortfolio()); await writer.observeSource(prepareReplaySourceSnapshot([]));
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(REPLAY_SETTINGS_OBSERVATION_FILE) && typeof args[1] === "number") {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => { entered(); await gate; await sync(); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const first = writer.observeSettings({ status: "unavailable", reason: "unsupported_shape" });
  try {
    await waiting;
    await assert.rejects(writer.observeSettings({ status: "unavailable", reason: "limit" }), /already attempted/);
    release(); await first;
    const record = JSON.parse(await fs.readFile(join(root, REPLAY_SETTINGS_OBSERVATION_FILE), "utf8"));
    assert.deepEqual(record.settings, { status: "unavailable", reason: "unsupported_shape" });
  } finally { release(); await first.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});
