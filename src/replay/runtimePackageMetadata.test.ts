import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRuntimeLoadExperimentInventory } from "./runtimeLoadExperimentFixturePreparationTestFixtures.js";
import { runRuntimeLoadExperiment } from "./runtimeLoadExperimentHarnessTestFixtures.js";
import {
  parseRuntimeLoadExperimentWireReport, RUNTIME_LOAD_EXPERIMENT_CASE_IDS,
} from "./runtimeLoadExperimentProtocolTestFixtures.js";
import {
  PACKAGE_METADATA_CASE_IDS, PACKAGE_METADATA_MAX_WIRE_BYTES, packageMetadataGoldenReport,
  parsePackageMetadataReport,
} from "./runtimePackageMetadataProtocolTestFixtures.js";

const digest = (source: string) => `sha256:${createHash("sha256").update(source).digest("hex")}`;
const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64";
const actual = { skip: supported ? false : "C2-B2 actual observations require Node 24.19.0 Linux x64" };
const wire = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const transportFailures = ["metadata_restore_fault", "metadata_over"];

test("C2-B2 preserves every original C2-B case and inventory byte at main 37f738f", () => {
  assert.equal(RUNTIME_LOAD_EXPERIMENT_CASE_IDS.length, 50);
  const snapshot = JSON.stringify(RUNTIME_LOAD_EXPERIMENT_CASE_IDS.map((id) => [id, buildRuntimeLoadExperimentInventory(id)]));
  assert.equal(createHash("sha256").update(snapshot).digest("hex"),
    "27953f079b2b1f694b63ac8a959b86495080b7080ce934cb1e9527abb332aef4");
});

test("C2-B2 finite canonical wire has an independently fixed 783 byte maximum including LF", () => {
  const reports = PACKAGE_METADATA_CASE_IDS.filter((id) => !transportFailures.includes(id)).map(packageMetadataGoldenReport);
  assert.equal(PACKAGE_METADATA_MAX_WIRE_BYTES, 783);
  assert.equal(Math.max(...reports.map((report) => wire(report).length)), 783);
  const largest = wire(packageMetadataGoldenReport("metadata_reread_aba"));
  assert.equal(largest.length, 783);
  assert.deepEqual(parsePackageMetadataReport(largest, "metadata_reread_aba"), JSON.parse(largest.toString()));
  assert.throws(() => parsePackageMetadataReport(Buffer.concat([largest, Buffer.from(" ")]), "metadata_reread_aba"), /^Error: INVALID_REPORT$/);
});

for (const caseId of PACKAGE_METADATA_CASE_IDS.filter((id) => !transportFailures.includes(id))) {
  test(`C2-B2 dispatch accepts only its own canonical ${caseId} report`, () => {
    const report = packageMetadataGoldenReport(caseId);
    assert.deepEqual(parseRuntimeLoadExperimentWireReport(wire(report), caseId), report);
    assert.throws(() => parseRuntimeLoadExperimentWireReport(wire({ ...report, schemaVersion: "runtime_load_experiment.v1" }), caseId));
    assert.throws(() => parseRuntimeLoadExperimentWireReport(wire(report), "metadata_default"));
  });
}

const baseline = packageMetadataGoldenReport("metadata_snapshot");
assert.notEqual(baseline.status, "rejected");
const baselineWire = wire(baseline);
const invalidWires: readonly (readonly [string, Buffer])[] = [
  ["empty", Buffer.alloc(0)],
  ["invalid UTF8", Buffer.from([0xff, 0x0a])],
  ["missing LF", baselineWire.subarray(0, -1)],
  ["extra LF", Buffer.concat([baselineWire, Buffer.from("\n")])],
  ["multiple documents", Buffer.concat([baselineWire, baselineWire])],
  ["whitespace", Buffer.from(` ${baselineWire.toString()}`)],
  ["duplicate key", Buffer.from(baselineWire.toString().replace('"caseId":', '"caseId":"metadata_snapshot","caseId":'))],
  ["reordered keys", wire(Object.assign({ caseId: "metadata_snapshot" }, baseline))],
  ["case mismatch", wire({ ...baseline, caseId: "metadata_snapshot_aba" })],
  ["status promotion", wire({ ...baseline, status: "counterexample" })],
  ["runtime promotion", wire({ ...baseline, runtime: "verified" })],
  ["complete flag", wire({ ...baseline, completeRuntime: true })],
  ["unknown field", wire({ ...baseline, raw: "synthetic-private-do-not-echo" })],
  ["digest substitution", Buffer.from(baselineWire.toString().replace(/sha256:[a-f0-9]{64}/, `sha256:${"0".repeat(64)}`))],
  ["target substitution", Buffer.from(baselineWire.toString().replace('"target":"f09"', '"target":"f10"'))],
  ["false restoration", Buffer.from(baselineWire.toString().replace('"diskRestored":true', '"diskRestored":false'))],
];
for (const [name, bytes] of invalidWires) {
  test(`C2-B2 protocol rejects ${name} without raw content`, () => {
    assert.throws(() => parsePackageMetadataReport(bytes, "metadata_snapshot"), /^Error: INVALID_REPORT$/);
  });
}

for (const caseId of PACKAGE_METADATA_CASE_IDS) {
  test(`C2-B2 actual ${caseId} uses owned child and preserves unavailable boundaries`, actual, async () => {
    const result = await runRuntimeLoadExperiment(caseId);
    if (caseId === "metadata_restore_fault" || caseId === "metadata_over") {
      assert.deepEqual(result, { status: "failed",
        reason: caseId === "metadata_over" ? "FIXTURE_PREPARATION_FAILED" : "EXIT_FAILURE", report: null,
        termination: caseId === "metadata_over" ? "not_started" : "confirmed", cleanup: "removed" });
      return;
    }
    assert.equal(result.status, "collected", JSON.stringify(result));
    if (result.status !== "collected") throw new Error("expected actual observation");
    assert.equal(result.termination, "confirmed");
    assert.equal(result.cleanup, "removed");
    const report = result.report;
    assert.equal(report.schemaVersion, "runtime_package_metadata_experiment.v1");
    assert.equal(report.caseId, caseId);
    for (const key of ["runtime", "dependencies", "result", "comparability"] as const) assert.equal(report[key], "unavailable");
    for (const key of ["completeRuntime", "completeConfiguration", "completeInput"] as const) assert.equal(report[key], false);
    assert.doesNotMatch(JSON.stringify(report), /\/tmp\/|\/var\/|node_modules|process.env|synthetic-private/);
    if (report.schemaVersion !== "runtime_package_metadata_experiment.v1") throw new Error("unexpected legacy report");
    if (report.status === "rejected") {
      assert.ok(!["metadata_snapshot", "metadata_snapshot_aba", "metadata_reread_aba"].includes(caseId));
      assert.equal(report.reason, caseId === "metadata_attribute" ? "ATTRIBUTE_UNSUPPORTED"
        : caseId === "metadata_parent" || caseId === "metadata_subpath" ? "MAPPING_UNSUPPORTED" : "METADATA_UNSUPPORTED");
      assert.ok(!("events" in report) && !("metadata" in report));
      return;
    }
    const reread = caseId === "metadata_reread_aba";
    assert.equal(report.status, reread ? "counterexample" : "observed");
    assert.deepEqual(report.metadata, {
      sourceDigest: digest(reread
        ? '{"name":"c2b-fixture","exports":"./replacement.mjs","type":"module"}\n'
        : '{"name":"c2b-fixture","exports":"./original.mjs","type":"module"}\n'),
      target: reread ? "f10" : "f09", consumption: reread ? "reread" : "snapshot", diskRestored: true,
    });
    assert.deepEqual(report.events, [
      { kind: "resolve", fileId: reread ? "f10" : "f09", parentId: "bootstrap", route: "snapshot" },
      { kind: "load", fileId: reread ? "f10" : "f09", format: "module",
        sourceDigest: digest(reread ? "export default {token:202};\n" : "export default {token:101};\n"), supply: "snapshot" },
    ]);
    assert.deepEqual(report.observations, [reread ? "REPLACEMENT_VALUE" : "ORIGINAL_VALUE"]);
  });
}

test("C2-B2 changed-test graph retains the standalone child and frozen case list", async () => {
  const source = await readFile("src/replay/runtimeLoadExperimentTestChild.ts", "utf8");
  const compiled = await readFile("dist/replay/runtimeLoadExperimentTestChild.js", "utf8");
  for (const caseId of PACKAGE_METADATA_CASE_IDS) assert.ok(source.includes(`"${caseId}"`));
  assert.ok(Buffer.byteLength(compiled) <= 65_536);
  assert.equal(buildRuntimeLoadExperimentInventory("metadata_over")[7]?.source.length, 4097);
});
