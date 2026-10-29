import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRuntimeLoadExperimentInventory } from "./runtimeLoadExperimentFixturePreparationTestFixtures.js";
import { runRuntimeLoadExperiment } from "./runtimeLoadExperimentHarnessTestFixtures.js";
import { parseRuntimeLoadExperimentWireReport, RUNTIME_LOAD_EXPERIMENT_CASE_IDS } from "./runtimeLoadExperimentProtocolTestFixtures.js";
import { PACKAGE_METADATA_CASE_IDS } from "./runtimePackageMetadataProtocolTestFixtures.js";
import { CONDITIONAL_PACKAGE_CASE_IDS } from "./runtimeConditionalPackageProtocolTestFixtures.js";
import { DEPENDENCY_INVENTORY_CASE_IDS, DEPENDENCY_INVENTORY_MAX_WIRE_BYTES, DEPENDENCY_PLAN_DIGEST,
  dependencyInventoryPlan, dependencyInventoryGoldenReport, parseDependencyInventoryReport,
} from "./runtimeDependencyInventoryProtocolTestFixtures.js";

const digest = (source: string) => `sha256:${createHash("sha256").update(source).digest("hex")}`;
const wire = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const actual = { skip: process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64"
  ? false : "C2-B4 actual observations require Node 24.19.0 Linux x64" };
const noReports = ["inventory_missing", "inventory_restore_fault", "inventory_over"];

test("C2-B4 preserves every prior 90 case inventory byte at main 6d168f93", () => {
  const cases = [...RUNTIME_LOAD_EXPERIMENT_CASE_IDS, ...PACKAGE_METADATA_CASE_IDS, ...CONDITIONAL_PACKAGE_CASE_IDS];
  assert.equal(cases.length, 90);
  assert.equal(digest(JSON.stringify(cases.map((id) => [id, buildRuntimeLoadExperimentInventory(id)]))),
    "sha256:2a03489325ea9737eb3007fe4dab2b69f211107d99203b7a0706047db98358e3");
});
test("C2-B4 freezes independent 785 byte plan and 1198 byte report before producer", () => {
  assert.equal(Buffer.byteLength(dependencyInventoryPlan()), 785);
  assert.equal(digest(dependencyInventoryPlan()), DEPENDENCY_PLAN_DIGEST);
  assert.equal(CONDITIONAL_PACKAGE_CASE_IDS.length, 23);
  const reports = DEPENDENCY_INVENTORY_CASE_IDS.filter((id) => !noReports.includes(id)).map(dependencyInventoryGoldenReport);
  assert.equal(DEPENDENCY_INVENTORY_MAX_WIRE_BYTES, 1198);
  assert.equal(Math.max(...reports.map((r) => wire(r).length)), 1198);
  const max = wire(dependencyInventoryGoldenReport("inventory_snapshot_aba"));
  assert.deepEqual(parseDependencyInventoryReport(max, "inventory_snapshot_aba"), JSON.parse(max.toString()));
  assert.throws(() => parseDependencyInventoryReport(Buffer.concat([max, Buffer.from(" ")]), "inventory_snapshot_aba"), /^Error: INVALID_REPORT$/);
});
for (const caseId of DEPENDENCY_INVENTORY_CASE_IDS.filter((id) => !noReports.includes(id))) {
  test(`C2-B4 dispatch accepts only independent canonical ${caseId} wire`, () => {
    const report = dependencyInventoryGoldenReport(caseId);
    assert.deepEqual(parseRuntimeLoadExperimentWireReport(wire(report), caseId), report);
    for (const schemaVersion of ["runtime_load_experiment.v1", "runtime_package_metadata_experiment.v1", "runtime_conditional_package_experiment.v1"]) {
      assert.throws(() => parseRuntimeLoadExperimentWireReport(wire({ ...report, schemaVersion }), caseId), /^Error: INVALID_REPORT$/);
    }
    assert.throws(() => parseRuntimeLoadExperimentWireReport(wire(report), "conditional_import"), /^Error: INVALID_REPORT$/);
  });
}
const baseline = dependencyInventoryGoldenReport("inventory_match");
if (baseline.status === "rejected") throw new Error("invalid golden");
const mutations: readonly (readonly [string, unknown])[] = [
  ["plan digest", { ...baseline, plan: { ...baseline.plan, sourceDigest: `sha256:${"0".repeat(64)}` } }],
  ["file count", { ...baseline, plan: { ...baseline.plan, fileCount: 5 } }],
  ["missing plan", { ...baseline, plan: undefined }],
  ["binding", { ...baseline, bindings: baseline.bindings.slice(0, 1) }],
  ["parent", { ...baseline, bindings: baseline.bindings.map((b) => ({ ...b, parentId: "bootstrap" })) }],
  ["source", { ...baseline, bindings: baseline.bindings.map((b) => ({ ...b, sourceDigest: DEPENDENCY_PLAN_DIGEST })) }],
  ["token", { ...baseline, token: 1202 }], ["restoration", { ...baseline, diskRestored: false }],
  ["runtime", { ...baseline, runtime: "verified" }], ["complete", { ...baseline, completeRuntime: true }],
  ["unknown", { ...baseline, raw: "synthetic-private-do-not-echo" }],
];
for (const [name, report] of mutations) test(`C2-B4 rejects substituted ${name} report without echo`, () => {
  assert.throws(() => parseDependencyInventoryReport(wire(report), "inventory_match"), /^Error: INVALID_REPORT$/);
});
for (const [name, bytes] of [
  ["empty", Buffer.alloc(0)], ["invalid UTF8", Buffer.from([0xff, 0x0a])],
  ["missing LF", wire(baseline).subarray(0, -1)], ["extra LF", Buffer.concat([wire(baseline), Buffer.from("\n")])],
  ["duplicate key", Buffer.from(wire(baseline).toString().replace('"token":', '"token":1101,"token":'))],
] as const) test(`C2-B4 rejects ${name} wire`, () => {
  assert.throws(() => parseDependencyInventoryReport(bytes, "inventory_match"), /^Error: INVALID_REPORT$/);
});
for (const caseId of DEPENDENCY_INVENTORY_CASE_IDS) {
  test(`C2-B4 actual ${caseId} binds planned files before conditional transitive consumption`, actual, async () => {
    const result = await runRuntimeLoadExperiment(caseId);
    if (noReports.includes(caseId)) {
      assert.deepEqual(result, { status: "failed", reason: caseId === "inventory_over" ? "FIXTURE_PREPARATION_FAILED" : "EXIT_FAILURE",
        report: null, termination: caseId === "inventory_over" ? "not_started" : "confirmed", cleanup: "removed" });
      return;
    }
    assert.equal(result.status, "collected", JSON.stringify(result));
    if (result.status !== "collected") throw new Error("expected observation");
    assert.equal(result.termination, "confirmed"); assert.equal(result.cleanup, "removed");
    const report = result.report;
    assert.deepEqual(report, dependencyInventoryGoldenReport(caseId));
    if (report.schemaVersion !== "runtime_dependency_inventory_experiment.v1") throw new Error("unexpected schema");
    for (const key of ["runtime", "dependencies", "result", "comparability"] as const) assert.equal(report[key], "unavailable");
    for (const key of ["completeRuntime", "completeConfiguration", "completeInput"] as const) assert.equal(report[key], false);
    assert.doesNotMatch(JSON.stringify(report), /\/tmp\/|\/var\/|node_modules|process.env|synthetic-private/);
    if (report.status === "rejected") { assert.equal(report.resolved, 0); assert.equal(report.loaded, 0); }
    else {
      assert.equal(report.plan.sourceDigest, DEPENDENCY_PLAN_DIGEST); assert.equal(report.plan.fileCount, 6);
      assert.equal(report.bindings.length, 2); assert.equal(report.bindings[1]!.parentId, report.bindings[0]!.target);
      assert.equal(report.token, 1101); assert.equal(report.diskRestored, true);
    }
  });
}
test("C2-B4 child dependency graph retains fixed plan anchor and unchanged bootstrap cap", async () => {
  const source = await readFile("src/replay/runtimeLoadExperimentTestChild.ts", "utf8");
  const compiled = await readFile("dist/replay/runtimeLoadExperimentTestChild.js", "utf8");
  for (const id of DEPENDENCY_INVENTORY_CASE_IDS) assert.ok(source.includes(`"${id}"`));
  assert.ok(source.includes(DEPENDENCY_PLAN_DIGEST)); assert.ok(Buffer.byteLength(compiled) <= 65536);
  assert.equal(buildRuntimeLoadExperimentInventory("inventory_over")[6]!.source.length, 4097);
});
