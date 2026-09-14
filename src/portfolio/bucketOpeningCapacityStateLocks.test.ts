import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BucketOpeningCapacityStateFileRepository, createBucketOpeningCapacityStatePaths } from "./bucketOpeningCapacityStateFiles.js";

test("opening capacity locks serialize concurrent readers and preserve missing state", async () => {
  await directory(async (dir) => {
    const results = await Promise.all(Array.from({ length: 20 }, () => new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot()));
    assert.deepEqual(results, Array(20).fill(null));
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test("opening capacity locks retry transient acquisition EPERM only on Windows", async (context) => {
  await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx" && ++attempts <= 2) throw failure("EPERM");
      return original(...args);
    });
    syncBuiltinESMExports();
    try {
      const repository = new BucketOpeningCapacityStateFileRepository(dir);
      if (process.platform === "win32") { assert.equal(await repository.readVerifiedSnapshot(), null); assert.equal(attempts, 3); }
      else { await assert.rejects(repository.readVerifiedSnapshot(), { code: "EPERM" }); assert.equal(attempts, 1); }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("opening capacity locks bound persistent contention with frozen wall time and retain the cause", async (context) => {
  for (const code of ["EEXIST", "EPERM"]) await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.open, denied = failure(code);
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx") { attempts += 1; throw denied; }
      return original(...args);
    });
    syncBuiltinESMExports(); context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir, { lockTimeoutMs: 30, lockRetryDelayMs: 500 }).readVerifiedSnapshot(),
        (error: Error) => code === "EPERM" && process.platform !== "win32" ? error === denied : /lock is unavailable/.test(error.message) && error.cause === denied);
      assert.ok(attempts >= 1);
    } finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("opening capacity lock initialization and denied open failures are not retried or erased", async (context) => {
  for (const phase of ["open", "write", "sync"] as const) for (const code of ["EACCES", "EEXIST", "EPERM"]) {
    if (phase === "open" && code !== "EACCES") continue;
    await directory(async (dir) => {
      const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.open, denied = failure(code);
      let attempts = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] !== lockPath || args[1] !== "wx") return original(...args);
        attempts += 1;
        if (phase === "open") throw denied;
        const handle = await original(...args);
        context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => {
          await fs.writeFile(lockPath, "partial-or-replaced\n"); throw denied;
        });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot(), (error) => error === denied); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(attempts, 1);
      if (phase === "open") assert.deepEqual(await fs.readdir(dir), []);
      else assert.equal(await fs.readFile(lockPath, "utf8"), "partial-or-replaced\n");
    });
  }
});

test("opening capacity locks never remove abandoned or replaced ownership barriers", async (context) => {
  await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir);
    await fs.writeFile(lockPath, "abandoned\n");
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir, { lockTimeoutMs: 30 }).readVerifiedSnapshot(), /lock is unavailable/); }
    finally { context.mock.timers.reset(); }
    assert.equal(await fs.readFile(lockPath, "utf8"), "abandoned\n");
  });
  await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.open;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === lockPath && args[1] === "wx") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await sync(); await fs.writeFile(lockPath, "replacement\n"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot(), /lock ownership changed/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await fs.readFile(lockPath, "utf8"), "replacement\n");
  });
});

test("opening capacity state read errors are not treated as acquisition contention", async (context) => {
  for (const code of ["EEXIST", "EPERM"]) await directory(async (dir) => {
    const { statePath } = createBucketOpeningCapacityStatePaths(dir), original = fs.readFile, denied = failure(code);
    let calls = 0;
    const mock = context.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
      if (args[0] === statePath) { calls += 1; throw denied; }
      return original(...args);
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot(), (error) => error === denied); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(calls, 1); assert.deepEqual(await fs.readdir(dir), []);
  });
});

function failure(code: string) { return Object.assign(new Error(`injected ${code}`), { code }); }
async function directory(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "toss-capacity-state-lock-"));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
