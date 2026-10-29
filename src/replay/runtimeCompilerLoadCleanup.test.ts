import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeCompilerLoadFixtureForTest } from "./runtimeCompilerLoadCleanupTestFixtures.js";

test("compiler cleanup submits only the fixed two unlinks followed by rmdir", async () => {
  const calls: string[] = [];
  await removeCompilerLoadFixtureForTest("owned", {
    unlink: async (path) => { calls.push(`unlink:${path}`); },
    rmdir: async (path) => { calls.push(`rmdir:${path}`); },
  });
  assert.deepEqual(calls, [`unlink:${join("owned", "compiler.cjs")}`, `unlink:${join("owned", "bootstrap.mjs")}`, "rmdir:owned"]);
});

test("compiler cleanup tolerates only absent inventory files and preserves other error identity", async () => {
  for (const code of ["ENOENT", "EACCES", "EISDIR"]) {
    const error = Object.assign(new Error(code), { code }), calls: string[] = [];
    const result = removeCompilerLoadFixtureForTest("owned", {
      unlink: async (path) => { calls.push(path); throw error; },
      rmdir: async () => { calls.push("rmdir"); },
    });
    if (code === "ENOENT") { await result; assert.equal(calls.length, 3); }
    else { await assert.rejects(result, (seen) => seen === error); assert.equal(calls.length, 1); }
  }
  for (const code of ["ENOENT", "ENOTEMPTY"]) {
    const error = Object.assign(new Error(code), { code });
    await assert.rejects(removeCompilerLoadFixtureForTest("owned", {
      unlink: async () => undefined, rmdir: async () => { throw error; },
    }), (seen) => seen === error);
  }
});

test("compiler cleanup awaits each unlink and does not submit further removal after rejection", async () => {
  let reject!: (reason: unknown) => void;
  const first = new Promise<void>((_resolve, fail) => { reject = fail; });
  const calls: string[] = [], error = new Error("first unlink");
  const result = removeCompilerLoadFixtureForTest("owned", {
    unlink: (path) => { calls.push(path); return first; },
    rmdir: async () => { calls.push("rmdir"); },
  });
  assert.deepEqual(calls, [join("owned", "compiler.cjs")]);
  reject(error);
  await assert.rejects(result, (seen) => seen === error);
  assert.equal(calls.length, 1);
});

test("compiler cleanup waits for the second unlink and propagates its failure without rmdir", async () => {
  let reject!: (reason: unknown) => void;
  const second = new Promise<void>((_resolve, fail) => { reject = fail; });
  const calls: string[] = [], error = new Error("second unlink");
  const result = removeCompilerLoadFixtureForTest("owned", {
    unlink: async (path) => { calls.push(path); if (calls.length === 2) await second; },
    rmdir: async () => { calls.push("rmdir"); },
  });
  for (let i = 0; i < 8 && calls.length < 2; i++) await Promise.resolve();
  assert.equal(calls.length, 2);
  reject(error);
  await assert.rejects(result, (seen) => seen === error);
  assert.equal(calls.length, 2);
});

test("compiler cleanup removes complete and partially prepared real fixtures", async () => {
  for (const names of [[], ["compiler.cjs"], ["bootstrap.mjs"], ["compiler.cjs", "bootstrap.mjs"]]) {
    const root = await mkdtemp(join(tmpdir(), "compiler-cleanup-test-"));
    try {
      for (const name of names) await writeFile(join(root, name), "synthetic");
      await removeCompilerLoadFixtureForTest(root);
      await assert.rejects(readdir(root), { code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("compiler cleanup retains unexpected files and directories without recursive traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "compiler-cleanup-test-"));
  try {
    await writeFile(join(root, "compiler.cjs"), "known");
    await mkdir(join(root, "unexpected"));
    await writeFile(join(root, "unexpected", "keep"), "preserved");
    await writeFile(join(root, "extra"), "preserved too");
    await assert.rejects(removeCompilerLoadFixtureForTest(root), { code: "ENOTEMPTY" });
    assert.equal(await readFile(join(root, "unexpected", "keep"), "utf8"), "preserved");
    assert.equal(await readFile(join(root, "extra"), "utf8"), "preserved too");
    await assert.rejects(readFile(join(root, "compiler.cjs")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compiler cleanup unlinks a known symlink without following its target", { skip: process.platform === "win32" }, async () => {
  const parent = await mkdtemp(join(tmpdir(), "compiler-cleanup-test-")), root = join(parent, "owned");
  try {
    await mkdir(root);
    const target = join(parent, "keep");
    await writeFile(target, "preserved");
    await symlink(target, join(root, "compiler.cjs"));
    await removeCompilerLoadFixtureForTest(root);
    assert.equal(await readFile(target, "utf8"), "preserved");
    await assert.rejects(readdir(root), { code: "ENOENT" });
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("compiler cleanup never traverses a directory at a known filename", async () => {
  const root = await mkdtemp(join(tmpdir(), "compiler-cleanup-test-"));
  try {
    await mkdir(join(root, "compiler.cjs"));
    await writeFile(join(root, "compiler.cjs", "keep"), "preserved");
    await assert.rejects(removeCompilerLoadFixtureForTest(root));
    assert.equal(await readFile(join(root, "compiler.cjs", "keep"), "utf8"), "preserved");
  } finally { await rm(root, { recursive: true, force: true }); }
});
