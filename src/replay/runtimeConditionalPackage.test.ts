import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRuntimeLoadExperimentInventory } from "./runtimeLoadExperimentFixturePreparationTestFixtures.js";
import { runRuntimeLoadExperiment } from "./runtimeLoadExperimentHarnessTestFixtures.js";
import { parseRuntimeLoadExperimentWireReport, RUNTIME_LOAD_EXPERIMENT_CASE_IDS } from "./runtimeLoadExperimentProtocolTestFixtures.js";
import { PACKAGE_METADATA_CASE_IDS } from "./runtimePackageMetadataProtocolTestFixtures.js";
import {
  CONDITIONAL_PACKAGE_CASE_IDS, CONDITIONAL_PACKAGE_MAX_WIRE_BYTES, conditionalPackageGoldenReport,
  parseConditionalPackageReport,
} from "./runtimeConditionalPackageProtocolTestFixtures.js";

const actual = { skip: process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64"
  ? false : "C2-B3 actual observations require Node 24.19.0 Linux x64" };
const wire = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const failureCases = ["conditional_restore_fault", "conditional_over"];

test("C2-B3 preserves all 67 legacy cases and fixture bytes at main 5941bd47", () => {
  const cases = [...RUNTIME_LOAD_EXPERIMENT_CASE_IDS, ...PACKAGE_METADATA_CASE_IDS];
  assert.equal(cases.length, 67);
  assert.equal(createHash("sha256").update(JSON.stringify(cases.map((id) => [id, buildRuntimeLoadExperimentInventory(id)]))).digest("hex"),
    "e0771b8a7a570eb50107a144178d43c06aa6c27659ed7dc640c356be3dd602a8");
});

test("C2-B3 independent finite canonical wire freezes 1088 bytes including LF before producer", () => {
  const sizes = CONDITIONAL_PACKAGE_CASE_IDS.filter((id) => !failureCases.includes(id)).map((id) => wire(conditionalPackageGoldenReport(id)).length);
  assert.equal(CONDITIONAL_PACKAGE_MAX_WIRE_BYTES, 1088);
  assert.equal(Math.max(...sizes), 1088);
  const maximum = wire(conditionalPackageGoldenReport("conditional_root_default"));
  assert.equal(maximum.length, 1088);
  assert.deepEqual(parseConditionalPackageReport(maximum, "conditional_root_default"), JSON.parse(maximum.toString()));
  assert.throws(() => parseConditionalPackageReport(Buffer.concat([maximum, Buffer.from(" ")]), "conditional_root_default"), /^Error: INVALID_REPORT$/);
});

for (const caseId of CONDITIONAL_PACKAGE_CASE_IDS.filter((id) => !failureCases.includes(id))) {
  test(`C2-B3 protocol dispatch keeps legacy schemas separate for ${caseId}`, () => {
    const report = conditionalPackageGoldenReport(caseId);
    assert.deepEqual(parseRuntimeLoadExperimentWireReport(wire(report), caseId), report);
    for (const schemaVersion of ["runtime_load_experiment.v1", "runtime_package_metadata_experiment.v1"]) {
      assert.throws(() => parseRuntimeLoadExperimentWireReport(wire({ ...report, schemaVersion }), caseId), /^Error: INVALID_REPORT$/);
    }
    assert.throws(() => parseRuntimeLoadExperimentWireReport(wire(report), "metadata_snapshot"), /^Error: INVALID_REPORT$/);
  });
}

const baseline = conditionalPackageGoldenReport("conditional_import");
if (baseline.status === "rejected") throw new Error("invalid golden");
const baselineBytes = wire(baseline);
const clone = () => structuredClone(baseline);
const mutations: readonly (readonly [string, () => unknown])[] = [
  ["metadata digest", () => { const r = clone(); r.bindings[1]!.metadataDigest = `sha256:${"0".repeat(64)}`; return r; }],
  ["source digest", () => { const r = clone(); r.bindings[1]!.sourceDigest = r.bindings[0]!.sourceDigest; return r; }],
  ["parent", () => { const r = clone(); r.bindings[1]!.parentId = "bootstrap"; return r; }],
  ["condition", () => { const r = clone(); r.bindings[1]!.selectedCondition = "default"; return r; }],
  ["conditions", () => { const r = clone(); r.bindings[1]!.conditions.pop(); return r; }],
  ["target", () => { const r = clone(); r.bindings[1]!.target = "f03"; return r; }],
  ["order", () => { const r = clone(); r.bindings.reverse(); return r; }],
  ["missing binding", () => { const r = clone(); r.bindings.pop(); return r; }],
  ["extra binding", () => { const r = clone(); r.bindings.push(r.bindings[0]!); return r; }],
  ["token", () => ({ ...baseline, token: 2202 })],
  ["restoration", () => ({ ...baseline, diskRestored: false })],
  ["runtime promotion", () => ({ ...baseline, runtime: "verified" })],
  ["complete promotion", () => ({ ...baseline, completeInput: true })],
  ["unknown field", () => ({ ...baseline, raw: "synthetic-private-do-not-echo" })],
];
for (const [name, mutate] of mutations) test(`C2-B3 protocol rejects substituted ${name}`, () => {
  assert.throws(() => parseConditionalPackageReport(wire(mutate()), "conditional_import"), /^Error: INVALID_REPORT$/);
});
for (const [name, bytes] of [
  ["invalid UTF8", Buffer.from([0xff, 0x0a])], ["empty", Buffer.alloc(0)],
  ["missing LF", baselineBytes.subarray(0, -1)], ["extra LF", Buffer.concat([baselineBytes, Buffer.from("\n")])],
  ["duplicate key", Buffer.from(baselineBytes.toString().replace('"token":', '"token":1101,"token":'))],
  ["reordered keys", wire(Object.assign({ caseId: baseline.caseId }, baseline))],
] as const) test(`C2-B3 protocol rejects ${name}`, () => {
  assert.throws(() => parseConditionalPackageReport(bytes, "conditional_import"), /^Error: INVALID_REPORT$/);
});

for (const caseId of CONDITIONAL_PACKAGE_CASE_IDS) {
  test(`C2-B3 actual ${caseId} binds conditional transitive consumption without promotion`, actual, async () => {
    const result = await runRuntimeLoadExperiment(caseId);
    if (caseId === "conditional_restore_fault" || caseId === "conditional_over") {
      assert.deepEqual(result, { status: "failed", reason: caseId === "conditional_over" ? "FIXTURE_PREPARATION_FAILED" : "EXIT_FAILURE",
        report: null, termination: caseId === "conditional_over" ? "not_started" : "confirmed", cleanup: "removed" });
      return;
    }
    assert.equal(result.status, "collected", JSON.stringify(result));
    if (result.status !== "collected") throw new Error("expected actual observation");
    assert.equal(result.termination, "confirmed"); assert.equal(result.cleanup, "removed");
    const report = result.report;
    assert.deepEqual(report, conditionalPackageGoldenReport(caseId));
    for (const key of ["runtime", "dependencies", "result", "comparability"] as const) assert.equal(report[key], "unavailable");
    for (const key of ["completeRuntime", "completeConfiguration", "completeInput"] as const) assert.equal(report[key], false);
    assert.doesNotMatch(JSON.stringify(report), /\/tmp\/|\/var\/|node_modules|process.env|synthetic-private/);
    if (report.schemaVersion !== "runtime_conditional_package_experiment.v1") throw new Error("unexpected schema");
    if (report.status !== "rejected") {
      assert.equal(report.bindings.length, 2);
      assert.equal(report.bindings[0]!.parentId, "bootstrap");
      assert.equal(report.bindings[1]!.parentId, report.bindings[0]!.target);
      assert.equal(report.token, caseId === "conditional_reread_aba" ? 2202 : caseId === "conditional_root_default" ? 2101
        : caseId === "conditional_leaf_default" ? 1202 : 1101);
    } else {
      const count = ["conditional_direct_leaf", "conditional_root_shape"].includes(caseId) ? 0 : 1;
      assert.equal(report.resolved, count); assert.equal(report.loaded, count);
    }
  });
}

test("C2-B3 changed-test dependency graph keeps the standalone bootstrap within its unchanged bound", async () => {
  const source = await readFile("src/replay/runtimeLoadExperimentTestChild.ts", "utf8");
  const compiled = await readFile("dist/replay/runtimeLoadExperimentTestChild.js", "utf8");
  for (const id of CONDITIONAL_PACKAGE_CASE_IDS) assert.ok(source.includes(`"${id}"`));
  assert.ok(Buffer.byteLength(compiled) <= 65536);
  assert.equal(buildRuntimeLoadExperimentInventory("conditional_over")[0]!.source.length, 4097);
});
