import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { initialOptions, seedInitialSnapshot } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "./replayInitialPortfolioObservationStore.js";

test("initial reservation publishes every directory ancestor before the first provider", async t => {
  const root = await fs.mkdtemp(join(tmpdir(), "child-ancestor-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = join(root, "grandparent", "parent", "child"), synced: string[] = [];
  await seedInitialSnapshot(storage);
  const original = fs.open;
  let reserved = false;
  const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE) && typeof args[1] === "number") reserved = true;
    if (args[1] === "r" && reserved) {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => { await sync(); synced.push(resolve(String(args[0]))); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  let calls = 0;
  try {
    await runHistoricalReplayWorkflow({ ...initialOptions(storage), decisionProvider: { decide: async packet => {
      calls++;
      const expected: string[] = [];
      for (let current = storage; ; current = dirname(current)) {
        expected.push(current);
        if (dirname(current) === current) break;
      }
      assert.deepEqual(synced.slice(0, expected.length), expected);
      return { attempted: true, decision: { packetId: packet.packetId, summary: "synthetic hold", decisions: [] }, failure: null, command: null };
    } } });
    assert.equal(calls, 1);
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

for (const ancestor of ["grandparent", "existing-root"] as const) for (const operation of ["open", "sync", "close"] as const) {
  test(`initial ${ancestor} directory ${operation} failure blocks outputs and provider`, async t => {
    const root = await fs.mkdtemp(join(tmpdir(), "child-ancestor-failure-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const storage = join(root, "grandparent", "parent", "child");
    await seedInitialSnapshot(storage);
    const target = ancestor === "grandparent" ? join(root, "grandparent") : root;
    const original = fs.open;
    let injected = false, calls = 0;
    const fail = async () => { injected = true; throw Object.assign(Error("private-ancestor-path"), { code: "EIO" }); };
    const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const match = args[1] === "r" && String(args[0]) === target;
      if (match && operation === "open") return fail();
      const handle = await original(...args);
      if (match && operation === "sync") t.mock.method(handle, "sync", fail);
      if (match && operation === "close") {
        const close = handle.close.bind(handle);
        t.mock.method(handle, "close", async () => { await close(); return fail(); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    const options = () => ({ ...initialOptions(storage), decisionProvider: { decide: async () => { calls++; throw Error("must not run"); } } });
    try {
      await assert.rejects(runHistoricalReplayWorkflow(options()), error => error instanceof Error
        && "code" in error && error.code === "DURABILITY_UNAVAILABLE" && !error.message.includes("private-ancestor"));
      assert.equal(injected, true);
      assert.equal(calls, 0);
      const entries = (await fs.readdir(storage)).sort();
      assert.deepEqual(entries, ["historical-market-snapshots.jsonl", REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE].sort());
      const before = await Promise.all(entries.map(name => fs.readFile(join(storage, name))));
      mock.mock.restore(); syncBuiltinESMExports();
      await assert.rejects(runHistoricalReplayWorkflow(options()), /reservation failed/);
      assert.deepEqual(await Promise.all(entries.map(name => fs.readFile(join(storage, name)))), before);
      assert.equal(calls, 0);
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
}
