import assert from "node:assert/strict";
import test from "node:test";
import { link, mkdtemp, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPILER_SNAPSHOT_VERSION, COMPILER_SNAPSHOT_OPTIONS_DIGEST, compilerInventoryDigestForTest,
  fixedCompilerSourcesForTest,
} from "./runtimeCompilerSnapshotCompilerTestFixtures.js";
import {
  createCompilerSnapshotExperimentForTest, readCompilerSnapshotSourcesForTest, runRuntimeCompilerSnapshotExperiment,
  type CompilerSnapshotExperimentDependenciesForTest,
} from "./runtimeCompilerSnapshotExperimentTestFixtures.js";
import { COMPILER_SNAPSHOT_CASES, CompilerSnapshotError, type CompilerSnapshotReport } from "./runtimeCompilerSnapshotProtocolTestFixtures.js";

const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64" && COMPILER_SNAPSHOT_VERSION === "5.9.3";
test("actual Linux/compiler cases distinguish snapshot supply from disk ABA rereads", {
  skip: supported ? false : "Requires Node v24.19.0 Linux x64 and TypeScript 5.9.3",
}, async (t) => {
  const reports = new Map<string, CompilerSnapshotReport>();
  const failures = { unlisted_import: "UNLISTED_RESOLUTION", type_error: "COMPILER_DIAGNOSTIC",
    stale_output: "STALE_OUTPUT", extra_output: "UNLISTED_OUTPUT" } as const;
  for (const id of COMPILER_SNAPSHOT_CASES) await t.test(id, async () => {
    const result = await runRuntimeCompilerSnapshotExperiment(id);
    assert.equal(result.cleanup, "removed");
    if (id in failures) {
      assert.equal(result.status, "failed"); if (result.status !== "failed") assert.fail("Expected fixed failure");
      assert.equal(result.reason, failures[id as keyof typeof failures]); assert.equal(result.report, null);
    } else {
      assert.equal(result.status, "collected"); if (result.status !== "collected") assert.fail("Missing real compiler observation");
      const report = result.report;
      assert.equal(report.runtime, "unavailable"); assert.equal(report.dependencies, "unavailable");
      assert.equal(report.result, "unavailable"); assert.equal(report.comparability, "unavailable");
      assert.equal(report.completeRuntime, false); assert.equal(report.completeConfiguration, false); assert.equal(report.completeInput, false);
      assert.equal(report.inputFileCount, 3); assert.equal(report.outputFileCount, 2);
      assert.equal(report.capturedInput, report.restoredInput);
      assert.equal(report.optionsDigest, COMPILER_SNAPSHOT_OPTIONS_DIGEST);
      reports.set(id, report);
    }
  });
  assert.equal(reports.size, 3, "All three actual compiler observations must succeed before their comparison");
  const baseline = reports.get("snapshot_baseline")!, snapshot = reports.get("snapshot_after_disk_aba")!, reread = reports.get("reread_during_disk_aba")!;
  assert.equal(snapshot.emittedOutput, baseline.emittedOutput);
  assert.equal(snapshot.consumedInput, baseline.consumedInput);
  assert.equal(reread.capturedInput, baseline.capturedInput);
  assert.equal(reread.restoredInput, baseline.restoredInput);
  assert.notEqual(reread.consumedInput, baseline.consumedInput);
  assert.notEqual(reread.emittedOutput, baseline.emittedOutput);
  assert.equal(reread.captureMatchesConsumed, false);
});

async function withSources(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "compiler-snapshot-reader-test-"));
  try {
    for (const [id, text] of fixedCompilerSourcesForTest()) await writeFile(join(root, id), text, { flag: "wx" });
    await run(root);
  } finally { await rm(root, { recursive: true, force: false, maxRetries: 0 }); }
}
const linux = { skip: process.platform === "linux" ? false : "Linux file identity contract" };
test("actual fixed file reader preserves exact bytes including multibyte boundary", linux, async () => {
  await withSources(async (root) => {
    assert.deepEqual(await readCompilerSnapshotSourcesForTest(root), new Map([...fixedCompilerSourcesForTest()].sort(([a], [b]) => a.localeCompare(b))));
    await writeFile(join(root, "value.ts"), "é".repeat(8_192));
    assert.equal(Buffer.byteLength((await readCompilerSnapshotSourcesForTest(root)).get("value.ts")!), 16_384);
    await writeFile(join(root, "value.ts"), "é".repeat(8_192) + "x");
    await assert.rejects(readCompilerSnapshotSourcesForTest(root), { reason: "INPUT_LIMIT" });
  });
});
test("actual fixed file reader refuses extra, linked and invalid UTF-8 input", linux, async () => {
  await withSources(async (root) => {
    await writeFile(join(root, "extra.ts"), "SECRET");
    await assert.rejects(readCompilerSnapshotSourcesForTest(root), { reason: "INPUT_UNSAFE" });
    await unlink(join(root, "extra.ts"));
    await unlink(join(root, "value.ts")); await symlink("entry.ts", join(root, "value.ts"));
    await assert.rejects(readCompilerSnapshotSourcesForTest(root), { reason: "INPUT_UNSAFE" });
    await unlink(join(root, "value.ts")); await link(join(root, "entry.ts"), join(root, "value.ts"));
    await assert.rejects(readCompilerSnapshotSourcesForTest(root), { reason: "INPUT_UNSAFE" });
    await unlink(join(root, "value.ts")); await writeFile(join(root, "value.ts"), Buffer.from([0xff]));
    await assert.rejects(readCompilerSnapshotSourcesForTest(root), { reason: "INPUT_INVALID" });
  });
});
function setup() {
  const counts = { created: 0, prepared: 0, compiled: 0, removed: 0, inspected: 0 };
  const source = fixedCompilerSourcesForTest();
  const identity = { dev: 1, ino: 2, directory: true, symlink: false };
  const deps: CompilerSnapshotExperimentDependenciesForTest = {
    runtime: { node: "v24.19.0", platform: "linux", arch: "x64", compiler: "5.9.3" },
    createRoot: async () => { counts.created++; return "/owned-test-fixture"; },
    inspectRoot: async () => { counts.inspected++; return { ...identity }; },
    prepare: async () => { counts.prepared++; },
    read: async () => new Map(source),
    replaceValue: async () => { throw new Error("Unit fixture only supports baseline"); },
    compile: (input) => { counts.compiled++; return { consumedInput: compilerInventoryDigestForTest(input),
      emittedOutput: "sha256:" + "e".repeat(64), optionsDigest: COMPILER_SNAPSHOT_OPTIONS_DIGEST, outputs: new Map() }; },
    removeRoot: async () => { counts.removed++; },
  };
  return { counts, deps, identity };
}
test("actual descriptor/path replacement during capture rejects equal-content new inode", linux, async () => {
  await withSources(async (root) => {
    await assert.rejects(readCompilerSnapshotSourcesForTest(root, async (id) => {
      if (id !== "entry.ts") return;
      await rename(join(root, id), join(root, "retained-original.ts"));
      await writeFile(join(root, id), fixedCompilerSourcesForTest().get(id)!, { flag: "wx" });
    }), { reason: "INPUT_CHANGED" });
  });
});
test("actual missing path after open and unavailable directory use fixed errors", linux, async () => {
  await withSources(async (root) => {
    await assert.rejects(readCompilerSnapshotSourcesForTest(root, async (id) => {
      if (id === "entry.ts") await unlink(join(root, id));
    }), { reason: "INPUT_INVALID" });
    await assert.rejects(readCompilerSnapshotSourcesForTest(join(root, "missing-private-path")),
      (error: unknown) => error instanceof CompilerSnapshotError && error.message === "INPUT_INVALID");
  });
});
test("unknown case and unsupported runtime allocate nothing and never inspect caller objects", async () => {
  const a = setup(); const run = createCompilerSnapshotExperimentForTest(a.deps);
  const hostile = new Proxy({}, { get() { throw new Error("PRIVATE"); }, ownKeys() { throw new Error("PRIVATE"); } });
  assert.deepEqual(await run(hostile), { status: "failed", reason: "INVALID_CASE", report: null, cleanup: "not_created" });
  assert.equal(a.counts.created, 0);
  for (const key of ["node", "platform", "arch", "compiler"] as const) {
    const b = setup(); b.deps.runtime[key] = "unsupported";
    assert.equal((await createCompilerSnapshotExperimentForTest(b.deps)("snapshot_baseline")).status, "unsupported");
    assert.equal(b.counts.created, 0);
  }
});
test("preparation and compiler failures preserve fixed first reason without publishing raw errors", async () => {
  const a = setup(); a.deps.prepare = async () => { throw new Error("PRIVATE_PATH_SECRET"); };
  assert.deepEqual(await createCompilerSnapshotExperimentForTest(a.deps)("snapshot_baseline"),
    { status: "failed", reason: "FIXTURE_PREPARATION_FAILED", report: null, cleanup: "removed" });
  assert.equal(a.counts.compiled, 0); assert.equal(a.counts.removed, 1);
  const b = setup(); b.deps.compile = () => { throw new Error("PRIVATE_COMPILER_DIAGNOSTIC"); };
  assert.deepEqual(await createCompilerSnapshotExperimentForTest(b.deps)("snapshot_baseline"),
    { status: "failed", reason: "COMPILER_FAILURE", report: null, cleanup: "removed" });
});
test("initial root identity failure retains the root and prevents the next allocation", async () => {
  const a = setup(); a.deps.inspectRoot = async () => { throw new Error("identity unavailable"); };
  const run = createCompilerSnapshotExperimentForTest(a.deps);
  assert.deepEqual(await run("snapshot_baseline"), { status: "failed", reason: "FIXTURE_PREPARATION_FAILED", report: null, cleanup: "retained" });
  assert.equal((await run("snapshot_baseline")).cleanup, "not_created");
  assert.equal(a.counts.created, 1); assert.equal(a.counts.removed, 0);
});
test("changed root is never removed and observed compiler output is withheld", async () => {
  const a = setup();
  a.deps.inspectRoot = async () => ({ ...a.identity, ino: ++a.counts.inspected >= 3 ? 99 : 2 });
  const run = createCompilerSnapshotExperimentForTest(a.deps);
  assert.deepEqual(await run("snapshot_baseline"), { status: "failed", reason: "CLEANUP_FAILURE", report: null, cleanup: "retained" });
  assert.equal(a.counts.compiled, 1); assert.equal(a.counts.removed, 0);
  assert.equal((await run("snapshot_baseline")).cleanup, "not_created");
});
test("cleanup failure serializes queued callers and preserves an earlier compiler reason", async () => {
  const a = setup(); a.deps.compile = () => { throw new CompilerSnapshotError("COMPILER_DIAGNOSTIC"); };
  a.deps.removeRoot = async () => { a.counts.removed++; throw new Error("PRIVATE"); };
  const run = createCompilerSnapshotExperimentForTest(a.deps);
  const [first, next] = await Promise.all([run("snapshot_baseline"), run("snapshot_baseline")]);
  assert.deepEqual(first, { status: "failed", reason: "COMPILER_DIAGNOSTIC", report: null, cleanup: "retained" });
  assert.deepEqual(next, { status: "failed", reason: "CLEANUP_FAILURE", report: null, cleanup: "not_created" });
  assert.equal(a.counts.created, 1); assert.equal(a.counts.removed, 1);
});
test("changed post-build input cannot be relabeled as restored or complete", async () => {
  const a = setup(); let reads = 0;
  a.deps.read = async () => {
    const source = fixedCompilerSourcesForTest();
    if (++reads > 1) source.set("value.ts", "CHANGED");
    return source;
  };
  assert.deepEqual(await createCompilerSnapshotExperimentForTest(a.deps)("snapshot_baseline"),
    { status: "failed", reason: "OUTPUT_MISMATCH", report: null, cleanup: "removed" });
});
