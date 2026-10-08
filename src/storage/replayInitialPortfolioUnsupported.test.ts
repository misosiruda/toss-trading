import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { initialOptions, seedInitialSnapshot } from "../workflows/historicalReplayInitialPortfolioTestFixtures.js";
import { REPLAY_INITIAL_PORTFOLIO_FILE, REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE } from "./replayInitialPortfolioObservationStore.js";

for (const code of ["EPERM", "ENOTSUP", "EIO"]) for (const stage of ["reservation", "parent", "observation"]) {
  for (const operation of ["open", "sync"]) {
    test(`${code} on ${stage} directory ${operation} fails closed before provider`, async t => {
      const root = await fs.mkdtemp(join(tmpdir(), "child-directory-unavailable-"));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      await seedInitialSnapshot(root);
      let reserved = false, observed = false, injected = false, calls = 0;
      const original = fs.open;
      const fail = async () => { injected = true; throw Object.assign(Error("private-path"), { code }); };
      const mock = t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (typeof args[1] === "number") {
          if (String(args[0]).endsWith(REPLAY_INITIAL_PORTFOLIO_RESERVATION_FILE)) reserved = true;
          if (String(args[0]).endsWith(REPLAY_INITIAL_PORTFOLIO_FILE)) observed = true;
        }
        const target = args[1] === "r" && (stage === "parent" ? reserved && String(args[0]) === dirname(root)
          : String(args[0]) === root && (stage === "reservation" ? reserved && !observed : observed));
        if (target && operation === "open") return fail();
        const handle = await original(...args);
        if (target && operation === "sync") t.mock.method(handle, "sync", fail);
        return handle;
      });
      syncBuiltinESMExports();
      const options = () => ({ ...initialOptions(root), decisionProvider: { decide: async () => {
        calls++; throw Error("must not run");
      } } });
      try {
        await assert.rejects(runHistoricalReplayWorkflow(options()), error => error instanceof Error
          && "code" in error && error.code === "DURABILITY_UNAVAILABLE" && !error.message.includes("private-path"));
        assert.equal(injected, true); assert.equal(calls, 0);
        assert.equal(observed, stage === "observation");
        mock.mock.restore(); syncBuiltinESMExports();
        const entries = (await fs.readdir(root)).sort();
        const before = await Promise.all(entries.map(name => fs.readFile(join(root, name))));
        await assert.rejects(runHistoricalReplayWorkflow(options()), /reservation failed/);
        assert.equal(calls, 0); assert.deepEqual((await fs.readdir(root)).sort(), entries);
        assert.deepEqual(await Promise.all(entries.map(name => fs.readFile(join(root, name)))), before);
      } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    });
  }
}
