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
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir);
    assert.equal((await fs.readdir(lockPath)).length, 20);
    for (const entry of await fs.readdir(lockPath)) {
      const token = await fs.readFile(join(lockPath, entry, "owner"), "utf8");
      assert.equal(await fs.readFile(join(lockPath, entry, `${token.trim()}.released`), "utf8"), token);
    }
  });
});

test("opening capacity locks retry transient acquisition EPERM only on Windows", async (context) => {
  await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.mkdir;
    let attempts = 0;
    const mock = context.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {
      if (args[0] === join(lockPath, "1") && ++attempts <= 2) throw failure("EPERM");
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
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.mkdir, denied = failure(code);
    let attempts = 0;
    const mock = context.mock.method(fs, "mkdir", async (...args: Parameters<typeof fs.mkdir>) => {
      if (args[0] === join(lockPath, "1")) { attempts += 1; throw denied; }
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
      const ownerPath = join(lockPath, "1", "owner");
      let attempts = 0;
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] !== ownerPath || args[1] !== "wx") return original(...args);
        attempts += 1;
        if (phase === "open") throw denied;
        const handle = await original(...args);
        context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => {
          await fs.writeFile(ownerPath, "partial-or-replaced\n"); throw denied;
        });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot(), (error) => error === denied); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(attempts, 1);
      if (phase === "open") await assert.rejects(fs.readFile(ownerPath), { code: "ENOENT" });
      else assert.equal(await fs.readFile(ownerPath, "utf8"), "partial-or-replaced\n");
      assert.deepEqual(await fs.readdir(lockPath), ["1"]);
      await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir, { lockTimeoutMs: 30 }).readVerifiedSnapshot(), /lock is unavailable/);
      assert.deepEqual(await fs.readdir(lockPath), ["1"]);
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
    const ownerPath = join(lockPath, "1", "owner");
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await original(...args);
      if (args[0] === ownerPath && args[1] === "wx") {
        const sync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await sync(); await fs.writeFile(ownerPath, "replacement\n"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot(), /lock ownership changed/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(await fs.readFile(ownerPath, "utf8"), "replacement\n");
  });
});

test("opening capacity release preserves a replacement after final ownership read", async (context) => {
  await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), original = fs.readFile;
    const replacement = "11111111-1111-4111-8111-111111111111\n";
    let calls = 0, replacedPath = "";
    const mock = context.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
      const result = await original(...args);
      if ((args[0] === lockPath || args[0] === join(lockPath, "1", "owner")) && ++calls === 2) {
        replacedPath = String(args[0]); await fs.writeFile(replacedPath, replacement);
      }
      return result;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir).readVerifiedSnapshot(), /ownership changed/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.notEqual(replacedPath, "");
    assert.equal(await fs.readFile(replacedPath, "utf8"), replacement);
    await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir, { lockTimeoutMs: 30 }).readVerifiedSnapshot(), /lock is unavailable/);
    assert.equal(await fs.readFile(replacedPath, "utf8"), replacement);
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
    assert.equal(calls, 1);
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), token = await fs.readFile(join(lockPath, "1", "owner"), "utf8");
    assert.equal(await fs.readFile(join(lockPath, "1", `${token.trim()}.released`), "utf8"), token);
  });
});

test("opening capacity lock incomplete release markers and invalid generation chains remain barriers", async () => {
  for (const variant of ["missing-owner", "partial-release", "gap", "unknown"] as const) await directory(async (dir) => {
    const { lockPath } = createBucketOpeningCapacityStatePaths(dir), token = "11111111-1111-4111-8111-111111111111\n";
    const entry = variant === "gap" ? "2" : variant === "unknown" ? "invalid" : "1";
    await fs.mkdir(join(lockPath, entry), { recursive: true });
    if (variant === "partial-release") {
      await fs.writeFile(join(lockPath, entry, "owner"), token);
      await fs.writeFile(join(lockPath, entry, `${token.trim()}.released`), "");
    }
    const before = await fs.readdir(lockPath);
    await assert.rejects(new BucketOpeningCapacityStateFileRepository(dir, { lockTimeoutMs: 30 }).readVerifiedSnapshot(),
      /lock is unavailable|generation chain has a gap|generation is invalid/);
    assert.deepEqual(await fs.readdir(lockPath), before);
  });
});

function failure(code: string) { return Object.assign(new Error(`injected ${code}`), { code }); }
async function directory(run: (dir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(join(tmpdir(), "toss-capacity-state-lock-"));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
