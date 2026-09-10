import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createManualAssignmentPaths, ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";

test("manual assignment locks serialize concurrent real reads and release only their own token", async () => {
  await withDirectory(async (directory) => {
    const repository = new ManualAssignmentFileRepository(directory);
    const values = await Promise.all(Array.from({ length: 40 }, () => repository.readAll()));
    assert.deepEqual(values, Array.from({ length: 40 }, () => []));
    await assert.rejects(fs.readFile(createManualAssignmentPaths(directory).lockPath), { code: "ENOENT" });
  });
});

test("manual assignment lock retries transient EPERM exclusively on Windows acquisition", async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createManualAssignmentPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx" && ++attempts <= 2) throw failure("EPERM");
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      const repository = new ManualAssignmentFileRepository(directory);
      if (process.platform === "win32") {
        assert.deepEqual(await repository.readAll(), []);
        assert.equal(attempts, 3);
      } else {
        await assert.rejects(repository.readAll(), { code: "EPERM" });
        assert.equal(attempts, 1);
      }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("manual assignment lock permanent contention is bounded with frozen wall time and retains its cause", async (context) => {
  for (const code of ["EEXIST", "EPERM"]) await withDirectory(async (directory) => {
    const { lockPath } = createManualAssignmentPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const denied = failure(code);
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx") { attempts += 1; throw denied; }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      const repository = new ManualAssignmentFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
      await assert.rejects(repository.readAll(), (value: Error) => code === "EPERM" && process.platform !== "win32"
        ? value === denied : /lock is unavailable/.test(value.message) && value.cause === denied);
    } finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(attempts >= 1);
    await assert.rejects(fs.readFile(lockPath), { code: "ENOENT" });
  });
});

test("manual assignment lock does not retry denied open or initialization failures and preserves failed barriers", async (context) => {
  for (const phase of ["open", "write", "sync"] as const) for (const code of ["EACCES", "EEXIST", "EPERM"]) {
    if (phase === "open" && code !== "EACCES") continue;
    await withDirectory(async (directory) => {
      const { lockPath } = createManualAssignmentPaths(directory);
      const originalOpen = fs.open;
      let attempts = 0;
      const denied = failure(code);
      const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (args[0] !== lockPath || args[1] !== "wx") return originalOpen(...args);
        attempts += 1;
        if (phase === "open") throw denied;
        const handle = await originalOpen(...args);
        context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => {
          await fs.writeFile(lockPath, "replacement-or-partial-token\n");
          throw denied;
        });
        return handle;
      });
      syncBuiltinESMExports();
      try { await assert.rejects(new ManualAssignmentFileRepository(directory).readAll(), (value) => value === denied); }
      finally { mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(attempts, 1);
      if (phase === "open") await assert.rejects(fs.readFile(lockPath), { code: "ENOENT" });
      else assert.equal(await fs.readFile(lockPath, "utf8"), "replacement-or-partial-token\n");
    });
  }
});

test("manual assignment lock preserves abandoned tokens and times out despite frozen wall time", async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createManualAssignmentPaths(directory);
    await fs.writeFile(lockPath, "abandoned\n");
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      const repository = new ManualAssignmentFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 500 });
      await assert.rejects(repository.readAll(), (value: Error) => /lock is unavailable/.test(value.message) &&
        (value.cause as NodeJS.ErrnoException).code === "EEXIST");
    } finally { context.mock.timers.reset(); }
    assert.equal(await fs.readFile(lockPath, "utf8"), "abandoned\n");
  });
});

test("manual assignment lock never reacquires or deletes a replaced ownership token", async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createManualAssignmentPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === lockPath && args[1] === "wx") {
        attempts += 1;
        const originalSync = handle.sync.bind(handle);
        context.mock.method(handle, "sync", async () => { await originalSync(); await fs.writeFile(lockPath, "replacement\n"); });
      }
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new ManualAssignmentFileRepository(directory).readAll(), /lock ownership changed/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(lockPath, "utf8"), "replacement\n");
  });
});

test("manual assignment lock never retries a consumer error and releases its valid token", async () => {
  for (const code of ["EEXIST", "EPERM"]) await withDirectory(async (directory) => {
    const { lockPath } = createManualAssignmentPaths(directory);
    let invoked = 0;
    const denied = failure(code);
    await assert.rejects(new ManualAssignmentFileRepository(directory).withDurableVerifiedHistory(async () => {
      invoked += 1;
      throw denied;
    }), (value) => value === denied);
    assert.equal(invoked, 1);
    await assert.rejects(fs.readFile(lockPath), { code: "ENOENT" });
  });
});

function failure(code: string) { return Object.assign(new Error(`injected ${code}`), { code }); }
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "toss-manual-assignment-lock-"));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
