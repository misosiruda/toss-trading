import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository as Repository,
  getDurablePortfolioSizingSnapshotObservation } from "./portfolioSizingSnapshotFiles.js";

for (const direction of ["frozen", "backward"] as const) {
  test(`snapshot lock contention expires with ${direction} wall time without deleting the owner`, async (context) => {
    await withDirectory(async (directory) => {
      const { lockPath, recordsPath } = createPortfolioSizingSnapshotPaths(directory);
      await fs.writeFile(lockPath, "existing-owner\n");
      let wall = 0, rescued = false;
      const clock = context.mock.method(Date, "now", () => direction === "frozen" ? 0 : --wall);
      // A regression must fail instead of hanging the whole suite. Only the test clock is restored.
      const watchdog = setTimeout(() => { rescued = true; clock.mock.restore(); }, 2000);
      try {
        await assert.rejects(new Repository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readAll(), /lock is unavailable/);
        assert.equal(rescued, false, "lock deadline depended on the stopped or reversed wall clock");
      } finally { clearTimeout(watchdog); clock.mock.restore(); }
      assert.equal(await fs.readFile(lockPath, "utf8"), "existing-owner\n");
      await assert.rejects(fs.readFile(recordsPath), { code: "ENOENT" });
    });
  });
}

test("snapshot lock tolerates forward wall jumps during transient contention", async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createPortfolioSizingSnapshotPaths(directory), original = fs.open;
    let wall = 0, attempts = 0;
    const clock = context.mock.method(Date, "now", () => wall);
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx" && ++attempts <= 2) {
        wall += 86_400_000;
        throw Object.assign(new Error("synthetic contention"), { code: "EEXIST" });
      }
      return original(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await new Repository(directory, { lockTimeoutMs: 1000, lockRetryDelayMs: 3 }).readAll(), []);
      assert.equal(attempts, 3);
    } finally { clock.mock.restore(); mock.mock.restore(); syncBuiltinESMExports(); }
    await assert.rejects(fs.readFile(lockPath), { code: "ENOENT" });
  });
});

test("snapshot lock clock does not replace durable observation wall timestamps", async (context) => {
  await withDirectory(async (directory) => {
    const now = Date.parse("2026-09-18T00:00:00.000Z");
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      await new Repository(directory).withDurableVerifiedHistory(async (history) => {
        assert.equal(getDurablePortfolioSizingSnapshotObservation(history).observedAt, new Date(now).toISOString());
      });
    } finally { context.mock.timers.reset(); }
  });
});

async function withDirectory(operation: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "snapshot-lock-clock-"));
  try { await operation(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
