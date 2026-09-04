import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createRuntimePortfolioPolicyPaths, RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";

const dependencies = new ImmutablePolicyDependencyRepository({
  selectionPolicies: [], riskParameters: [], riskRuleSets: [], drawdownSemantics: [], sessionCalendars: [], scheduleBoundaries: []
});

test("runtime policy concurrent reads serialize real exclusive locks", async () => {
  await withDirectory(async (directory) => {
    const repository = new RuntimePortfolioPolicyFileRepository(directory, dependencies);
    const values = await Promise.all(Array.from({ length: 40 }, () => repository.readAll()));
    assert.deepEqual(values, Array.from({ length: 40 }, () => []));
    await assert.rejects(fs.readFile(createRuntimePortfolioPolicyPaths(directory).lockPath), { code: "ENOENT" });
  });
});

test("runtime policy retries transient Windows EPERM only during exclusive acquisition", { skip: process.platform !== "win32" }, async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx" && ++attempts <= 2) throw error("EPERM");
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    try { assert.deepEqual(await new RuntimePortfolioPolicyFileRepository(directory, dependencies).readAll(), []); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 3);
  });
});

test("runtime policy permanent acquisition denial times out even with frozen wall time", { skip: process.platform !== "win32" }, async (context) => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === lockPath && args[1] === "wx") { attempts += 1; throw error("EPERM"); }
      return originalOpen(...args);
    });
    syncBuiltinESMExports();
    context.mock.timers.enable({ apis: ["Date"], now: 0 });
    try {
      const repository = new RuntimePortfolioPolicyFileRepository(directory, dependencies, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
      await assert.rejects(repository.readAll(), (value: Error) => /lock is unavailable/.test(value.message) && (value.cause as NodeJS.ErrnoException).code === "EPERM");
    } finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
    assert.ok(attempts >= 1);
  });
});

test("runtime policy does not retry other acquisition errors or token fsync failure", async (context) => {
  for (const phase of ["open", "sync"] as const) await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyPaths(directory);
    const originalOpen = fs.open;
    let attempts = 0;
    const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (args[0] !== lockPath || args[1] !== "wx") return originalOpen(...args);
      attempts += 1;
      if (phase === "open") throw error("EACCES");
      const handle = await originalOpen(...args);
      context.mock.method(handle, "sync", async () => { throw error("EPERM"); });
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(new RuntimePortfolioPolicyFileRepository(directory, dependencies).readAll(), { code: phase === "open" ? "EACCES" : "EPERM" });
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(attempts, 1);
  });
});

test("runtime policy leaves abandoned locks untouched after bounded contention", async () => {
  await withDirectory(async (directory) => {
    const { lockPath } = createRuntimePortfolioPolicyPaths(directory);
    await fs.writeFile(lockPath, "abandoned\n");
    const repository = new RuntimePortfolioPolicyFileRepository(directory, dependencies, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    await assert.rejects(repository.readAll(), /lock is unavailable/);
    assert.equal(await fs.readFile(lockPath, "utf8"), "abandoned\n");
  });
});

function error(code: string) { return Object.assign(new Error(`injected ${code}`), { code }); }
async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "toss-runtime-policy-lock-"));
  try { await run(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
