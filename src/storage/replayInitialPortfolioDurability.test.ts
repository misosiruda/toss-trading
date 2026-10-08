import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { initialOptions, initialPortfolio, seedInitialSnapshot } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE,
  reserveReplayInitialPortfolioObservation } from "./replayInitialPortfolioObservationStore.js";

for (const failure of ["reservation-write", "reservation-sync", "reservation-directory-sync", "write", "file-sync", "directory-sync"] as const) {
  test("initial portfolio " + failure + " failure blocks first provider and preserves reservation", async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "initial-durable-failure-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await seedInitialSnapshot(root);
    let observed = false, reserved = false, injected = false, calls = 0;
    const original = fs.open;
    const fail = async () => { injected = true; throw Object.assign(Error("private-storage-path-detail"), { code: "EIO" }); };
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (failure === "reservation-directory-sync" && reserved && String(args[0]) === root) return fail();
      if (failure === "directory-sync" && observed && String(args[0]) === root) return fail();
      const handle = await original(...args);
      if (String(args[0]).endsWith(REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE) && typeof args[1] === "number") {
        reserved = true;
        if (failure === "reservation-write") t.mock.method(handle, "writeFile", fail);
        if (failure === "reservation-sync") t.mock.method(handle, "sync", fail);
      }
      if (String(args[0]).endsWith(REPLAY_INITIAL_PORTFOLIO_FILE) && typeof args[1] === "number") {
        observed = true;
        if (failure === "write") t.mock.method(handle, "writeFile", fail);
        if (failure === "file-sync") t.mock.method(handle, "sync", fail);
      }
      return handle;
    });
    syncBuiltinESMExports();
    const options = { ...initialOptions(root), decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } };
    try {
      await assert.rejects(runHistoricalReplayWorkflow(options), error => error instanceof Error
        && /initial portfolio observation .* failed/.test(error.message) && !error.message.includes("private-storage"));
      assert.equal(injected, true); assert.equal(calls, 0);
      assert.equal((await fs.stat(join(root, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE))).isFile(), true);
      mock.mock.restore(); syncBuiltinESMExports();
      const entries = await fs.readdir(root), before = await Promise.all(entries.map(name => fs.readFile(join(root, name))));
      await assert.rejects(runHistoricalReplayWorkflow(options), /reservation failed/);
      assert.equal(calls, 0); assert.deepEqual(await fs.readdir(root), entries);
      assert.deepEqual(await Promise.all(entries.map(name => fs.readFile(join(root, name)))), before);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}

test("durable snapshot sync completes before the first real synthetic provider call", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "initial-durable-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedInitialSnapshot(root);
  let entered!: () => void, release!: () => void, calls = 0, syncFinished = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = fs.open;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(REPLAY_INITIAL_PORTFOLIO_FILE) && typeof args[1] === "number") {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => { entered(); await gate; await sync(); syncFinished = true; });
    }
    return handle;
  });
  syncBuiltinESMExports();
  const run = runHistoricalReplayWorkflow({ ...initialOptions(root), decisionProvider: { decide: async packet => {
    calls++; assert.equal(syncFinished, true);
    const record = JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8"));
    assert.equal(record.initialPortfolio.status, "recorded");
    return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
  } } });
  try { await started; assert.equal(calls, 0); release(); const result = await run; assert.equal(result.status, "completed"); assert.equal(calls, 1); }
  finally { release(); await run.catch(() => {}); mock.mock.restore(); syncBuiltinESMExports(); }
});

test("reservation captures identity once and duplicate observer calls never replace snapshot", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "initial-reservation-capture-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = { storageBaseDir: root, identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 },
    startedAt: "2026-10-07T00:00:00.000Z", origin: "generated" as const };
  const observer = await reserveReplayInitialPortfolioObservation(input);
  input.identity.runId = "child_other"; input.startedAt = "2027-10-07T00:00:00.000Z"; input.storageBaseDir = "changed";
  await observer(initialPortfolio());
  const path = join(root, REPLAY_INITIAL_PORTFOLIO_FILE), before = await fs.readFile(path);
  const record = JSON.parse(before.toString());
  assert.equal(record.identity.runId, "child_one"); assert.equal(record.startedAt, "2026-10-07T00:00:00.000Z");
  await assert.rejects(observer({ ...initialPortfolio(), cashKrw: 1 }), /already attempted/);
  assert.deepEqual(await fs.readFile(path), before);
});

test("competing initial observation reservations admit exactly one immutable writer", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "initial-reservation-race-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = { storageBaseDir: root, identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 },
    startedAt: "2026-10-07T00:00:00.000Z", origin: "generated" as const };
  const results = await Promise.allSettled([reserveReplayInitialPortfolioObservation(input), reserveReplayInitialPortfolioObservation(input)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(results.filter(item => item.status === "rejected").length, 1);
  const winner = results.find(item => item.status === "fulfilled")!;
  if (winner.status === "fulfilled") await winner.value(initialPortfolio());
  assert.equal(JSON.parse(await fs.readFile(join(root, REPLAY_INITIAL_PORTFOLIO_FILE), "utf8")).initialPortfolio.status, "recorded");
});

test("directory alias cannot place a new initial observation in the target directory", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "initial-reservation-alias-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = join(root, "target"), alias = join(root, "alias");
  await fs.mkdir(target); await fs.symlink(target, alias, "junction");
  await assert.rejects(reserveReplayInitialPortfolioObservation({ storageBaseDir: alias,
    identity: { runId: "child_one", batchId: "batch_one", runIndex: 1 },
    startedAt: "2026-10-07T00:00:00.000Z", origin: "generated" }), /reservation failed/);
  assert.deepEqual(await fs.readdir(target), []);
});
