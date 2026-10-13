import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildRuntimeLoadExperimentInventory, prepareRuntimeLoadExperimentFixture,
  RUNTIME_LOAD_EXPERIMENT_FIXTURE_PATHS, RuntimeLoadExperimentPreparationError,
} from "./runtimeLoadExperimentFixturePreparationTestFixtures.js";

test("C2-B fixed inventory has sixteen unique ASCII versions and is deeply frozen", () => {
  const inventory = buildRuntimeLoadExperimentInventory("esm_first");
  assert.deepEqual(inventory.map((row) => row.path), RUNTIME_LOAD_EXPERIMENT_FIXTURE_PATHS);
  assert.equal(new Set(inventory.map((row) => row.path)).size, 16);
  assert.ok(Object.isFrozen(inventory) && inventory.every(Object.isFrozen));
  assert.ok(inventory.every((row) => /^[\x00-\x7f]*$/.test(row.source) && Buffer.byteLength(row.source) <= 4096));
  assert.ok(inventory.reduce((sum, row) => sum + Buffer.byteLength(row.source), 0) < 32768);
});
test("C2-B source and aggregate cap fixtures differ by exactly one byte", () => {
  assert.equal(buildRuntimeLoadExperimentInventory("cap_source")[15]!.source.length, 4096);
  assert.equal(buildRuntimeLoadExperimentInventory("cap_source_over")[15]!.source.length, 4097);
  for (const [caseId, expected] of [["cap_total", 32768], ["cap_total_over", 32769]] as const) {
    const rows = buildRuntimeLoadExperimentInventory(caseId);
    assert.equal(rows.reduce((sum, row) => sum + Buffer.byteLength(row.source), 0), expected);
    assert.ok(rows.every((row) => Buffer.byteLength(row.source) <= 4096));
  }
  assert.equal(buildRuntimeLoadExperimentInventory("cap_inventory").length, 16);
  assert.equal(buildRuntimeLoadExperimentInventory("cap_inventory_over").length, 17);
});
test("C2-B JSON A/B and ESM A/B fixture values and bytes are genuinely distinct", () => {
  const rows = buildRuntimeLoadExperimentInventory("json_cache_source_b");
  assert.equal(JSON.parse(rows[4]!.source).token, 101); assert.equal(JSON.parse(rows[13]!.source).token, 202);
  assert.notEqual(rows[4]!.source, rows[13]!.source); assert.notEqual(rows[1]!.source, rows[11]!.source);
});
for (const caseId of ["cap_inventory_over", "cap_source_over", "cap_total_over", "cap_bootstrap_over"] as const) {
  test(`C2-B ${caseId} preparation rejects before writing any fixture`, async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-load-preparation-test-"));
    try {
      await assert.rejects(prepareRuntimeLoadExperimentFixture(caseId, root), (error: unknown) =>
        error instanceof RuntimeLoadExperimentPreparationError
        && error.reason === (caseId === "cap_bootstrap_over" ? "BOOTSTRAP_LIMIT" : "FIXTURE_PREPARATION_FAILED"));
      assert.deepEqual(await readdir(root), []);
    } finally { await rm(root, { recursive: true, force: false }); }
  });
}
test("C2-B prepared bootstrap exact maximum is 65536 bytes and inventory remains sixteen files", async () => {
  const root = await mkdtemp(join(tmpdir(), "runtime-load-preparation-test-"));
  try {
    const bootstrap = await prepareRuntimeLoadExperimentFixture("cap_bootstrap", root);
    assert.equal(bootstrap, join(root, "bootstrap.mjs")); assert.equal((await stat(bootstrap)).size, 65536);
    for (const path of RUNTIME_LOAD_EXPERIMENT_FIXTURE_PATHS) assert.ok((await stat(join(root, path))).isFile());
  } finally { await rm(root, { recursive: true, force: false }); }
});
