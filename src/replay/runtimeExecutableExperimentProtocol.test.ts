import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRuntimeExecutableExperimentWireReport, RUNTIME_EXECUTABLE_EXPERIMENT_MAX_WIRE_BYTES,
  type RuntimeExecutableExperimentCaseId, type RuntimeExecutableExperimentWireReport,
} from "./runtimeExecutableExperimentProtocolTestFixtures.js";
function report(caseId: RuntimeExecutableExperimentCaseId): RuntimeExecutableExperimentWireReport {
  const a = { digest: "sha256:" + "a".repeat(64), bytes: 134217728 };
  const b = { digest: "sha256:" + "b".repeat(64), bytes: 134217728 };
  const other = caseId === "same_version_other_bytes";
  return {
    schemaVersion: "runtime_executable_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false,
    status: caseId === "image_matches_path" ? "observed" : "counterexample",
    evidence: "synthetic_fixture_observation", nodeVersion: "v24.19.0",
    reference: a, imageBefore: other ? b : a, imageAfter: other ? b : a,
    pathAfter: caseId === "path_unlinked" ? null : caseId === "path_replaced" || other ? b : a,
    ownedFdMatchesImage: true, pathMatchesImage: caseId === "image_matches_path" || other,
    procLinkDeleted: caseId === "path_replaced" || caseId === "path_unlinked",
    observation: caseId === "image_matches_path" ? "image_matches_path" :
      caseId === "path_replaced" ? "path_replacement_preserves_running_file" :
      caseId === "path_unlinked" ? "path_absence_preserves_running_file" : "version_label_does_not_identify_bytes",
  };
}
const wire = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const cases = ["image_matches_path", "path_replaced", "path_unlinked", "same_version_other_bytes"] as const;
test("executable wire preserves partial observations for all four fixed scenarios", () => {
  for (const id of cases) assert.deepEqual(parseRuntimeExecutableExperimentWireReport(wire(report(id)), id), report(id));
});
test("executable schema maximum is 957 bytes and distinct from the raw 4096-byte transport cap", () => {
  const lengths = cases.map((id) => wire(report(id)).length);
  assert.equal(Math.max(...lengths), RUNTIME_EXECUTABLE_EXPERIMENT_MAX_WIRE_BYTES);
  assert.equal(RUNTIME_EXECUTABLE_EXPERIMENT_MAX_WIRE_BYTES, 957);
});
test("executable wire rejects noncanonical bytes, duplicate keys, framing and case mismatch", () => {
  const value = report("image_matches_path"), bytes = wire(value), text = bytes.toString();
  for (const invalid of [
    Buffer.from(" " + text), Buffer.from(text.trimEnd()), Buffer.concat([bytes, bytes]),
    Buffer.from(text.replace('"caseId":', '"caseId":"image_matches_path","caseId":')),
    Buffer.from(text.replace("unavailable", "\\u0075navailable")),
    Buffer.from([0xff]), Buffer.alloc(4097), Buffer.from("{}\n"),
  ]) assert.throws(() => parseRuntimeExecutableExperimentWireReport(invalid, "image_matches_path"), { message: "INVALID_REPORT" });
  assert.throws(() => parseRuntimeExecutableExperimentWireReport(bytes, "path_replaced"), { message: "INVALID_REPORT" });
});
test("executable wire rejects unknown fields, promotions, unbounded samples and false identity claims", () => {
  const value = report("image_matches_path");
  for (const patch of [
    { extra: "PRIVATE" }, { runtime: "verified" }, { completeRuntime: true }, { completeConfiguration: true },
    { completeInput: true }, { dependencies: "verified" }, { result: "available" }, { comparability: "available" },
    { nodeVersion: "v24.19.1" }, { ownedFdMatchesImage: false }, { pathMatchesImage: false }, { procLinkDeleted: true },
    { reference: { ...value.reference, bytes: 134217729 } }, { reference: { ...value.reference, bytes: -1 } },
    { reference: { ...value.reference, bytes: 0.5 } }, { reference: { ...value.reference, digest: "sha256:SECRET" } },
    { imageAfter: { ...value.imageAfter, digest: "sha256:" + "b".repeat(64) } }, { pathAfter: null },
  ]) assert.throws(() => parseRuntimeExecutableExperimentWireReport(wire({ ...value, ...patch }), "image_matches_path"),
    { message: "INVALID_REPORT" });
});
test("executable counterexamples require their exact observed difference instead of a matching label", () => {
  for (const id of cases.slice(1)) {
    const value = report(id);
    assert.throws(() => parseRuntimeExecutableExperimentWireReport(wire({ ...value, status: "observed" }), id),
      { message: "INVALID_REPORT" });
    const noDifference = { ...value, pathAfter: value.imageAfter, pathMatchesImage: true, procLinkDeleted: false,
      reference: value.imageBefore };
    assert.throws(() => parseRuntimeExecutableExperimentWireReport(wire(noDifference), id), { message: "INVALID_REPORT" });
  }
});
test("executable transport-fault case cannot issue an otherwise valid observation", () => {
  for (const id of ["transport_invalid", "transport_exit", "transport_stdout_limit", "transport_stderr_limit"] as const) {
    assert.throws(() => parseRuntimeExecutableExperimentWireReport(wire({ ...report("image_matches_path"), caseId: id }), id),
      { message: "INVALID_REPORT" });
  }
});
