import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";

const dependencies = new ImmutablePolicyDependencyRepository({
  selectionPolicies: [], riskParameters: [], riskRuleSets: [], drawdownSemantics: [], sessionCalendars: [], scheduleBoundaries: []
});

test("activation locks serialize concurrent real reads and release only their own token", async () => {
  await withDirectory(async (directory) => {
    const repository = new RuntimePortfolioPolicyActivationFileRepository(directory, [], dependencies);
    const values = await Promise.all(Array.from({ length: 40 }, () => repository.readAll()));
    assert.deepEqual(values, Array.from({ length: 40 }, () => []));
    await assert.rejects(fs.readFile(createRuntimePortfolioPolicyActivationPaths(directory).lockPath), { code: "ENOENT" });
  });
});

test("activation lock retries transient Windows EPERM only during exclusive acquisition", { skip: process.platform !== "win32" }, async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyActivationPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx" && ++attempts <= 2) throw failure("EPERM");
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try { assert.deepEqual(await new RuntimePortfolioPolicyActivationFileRepository(directory, [], dependencies).readAll(), []); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 3);
  });
});

test("activation lock denial remains bounded with frozen wall time and retains the cause", { skip: process.platform !== "win32" }, async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyActivationPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx") { attempts += 1; throw failure("EPERM"); }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      const repository = new RuntimePortfolioPolicyActivationFileRepository(directory, [], dependencies, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
      await assert.rejects(repository.readAll(), (value: Error) => /lock is unavailable/.test(value.message) && (value.cause as NodeJS.ErrnoException).code === "EPERM");
    } finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(attempts >= 1);
  });
});

test("activation lock does not retry permission errors or token write and fsync failures", async (context) => {
  for (const phase of ["open", "write", "sync"] as const) await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyActivationPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] !== lockPath || args[1] !== "wx") return originalOpen(...args);
      attempts += 1;
      if (phase === "open") throw failure("EACCES");
      const handle = await originalOpen(...args);
      context.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => { throw failure("EPERM"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(new RuntimePortfolioPolicyActivationFileRepository(directory, [], dependencies).readAll(), { code: phase === "open" ? "EACCES" : "EPERM" }); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 1);
    await assert.rejects(fs.readFile(lockPath), { code: "ENOENT" });
  });
});

test("activation lock preserves abandoned locks and times out despite frozen wall time", async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyActivationPaths(directory);
    await fs.writeFile(lockPath, "abandoned\n");
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      const repository = new RuntimePortfolioPolicyActivationFileRepository(directory, [], dependencies, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
      await assert.rejects(repository.readAll(), (value: Error) => /lock is unavailable/.test(value.message) && (value.cause as NodeJS.ErrnoException).code === "EEXIST");
    } finally { context.mock.timers.reset(); }
    assert.equal(await fs.readFile(lockPath, "utf8"), "abandoned\n");
  });
});

test("activation lock never reacquires or deletes a replaced ownership token", async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyActivationPaths(directory);
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
    try { await assert.rejects(new RuntimePortfolioPolicyActivationFileRepository(directory, [], dependencies).readAll(), /lock ownership changed/); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(lockPath, "utf8"), "replacement\n");
  });
});

function failure(code: string) { return Object.assign(new Error(`injected ${code}`), { code }); }
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "toss-activation-lock-"));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
