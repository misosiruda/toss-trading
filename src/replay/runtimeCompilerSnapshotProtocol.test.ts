import assert from "node:assert/strict";
import test from "node:test";
import { parseCompilerSnapshotReport, type CompilerSnapshotCase, type CompilerSnapshotReport } from "./runtimeCompilerSnapshotProtocolTestFixtures.js";
const cases = ["snapshot_baseline", "snapshot_after_disk_aba", "reread_during_disk_aba"] as const;
function report(caseId: typeof cases[number]): CompilerSnapshotReport {
  const changed = caseId === "reread_during_disk_aba";
  return {
    schemaVersion: "compiler_snapshot_experiment.v1", caseId, status: changed ? "counterexample" : "observed",
    evidence: "synthetic_compiler_observation", runtime: "unavailable", dependencies: "unavailable",
    result: "unavailable", comparability: "unavailable", completeRuntime: false, completeConfiguration: false,
    completeInput: false, compilerVersion: "5.9.3", inputFileCount: 3, outputFileCount: 2,
    capturedInput: "sha256:" + "a".repeat(64), consumedInput: "sha256:" + (changed ? "b" : "a").repeat(64),
    restoredInput: "sha256:" + "a".repeat(64), emittedOutput: "sha256:" + "c".repeat(64),
    optionsDigest: "sha256:" + "d".repeat(64), captureMatchesConsumed: !changed, beforeAfterMatch: true,
  };
}
const wire = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const invalid = (bytes: Buffer, expected: CompilerSnapshotCase = "snapshot_baseline") =>
  assert.throws(() => parseCompilerSnapshotReport(bytes, expected), { message: "INVALID_COMPILER_SNAPSHOT_REPORT" });
test("compiler observation preserves all unavailable flags in each actual success case", () => {
  for (const id of cases) assert.deepEqual(parseCompilerSnapshotReport(wire(report(id)), id), report(id));
});
test("compiler schema-valid maximum is exactly 908 bytes within the 2048-byte record cap", () => {
  assert.deepEqual(cases.map((id) => wire(report(id)).length), [896, 902, 908]);
});
test("compiler report rejects duplicate keys, alternative escapes, framing, malformed UTF-8 and overflow", () => {
  const s = wire(report("snapshot_baseline")).toString();
  for (const b of [Buffer.from(s.trimEnd()), Buffer.from(" " + s), Buffer.from(s + s),
    Buffer.from(s.replace('"caseId":', '"caseId":"snapshot_baseline","caseId":')),
    Buffer.from(s.replace("unavailable", "\\u0075navailable")), Buffer.from([0xff]), Buffer.alloc(2_049)]) invalid(b);
});
test("compiler report rejects promoted, missing, unknown or differently typed fields", () => {
  const value = report("snapshot_baseline");
  for (const patch of [{ private: "SECRET" }, { runtime: "verified" }, { dependencies: "verified" },
    { result: "available" }, { comparability: "available" }, { completeRuntime: true }, { completeConfiguration: true },
    { completeInput: true }, { inputFileCount: 4 }, { outputFileCount: 1 }, { compilerVersion: "5.9.4" },
    { emittedOutput: "sha256:SECRET" }, { optionsDigest: null }, { capturedInput: [] }, { beforeAfterMatch: false }]) invalid(wire({ ...value, ...patch }));
  const { emittedOutput: _removed, ...missing } = value; invalid(wire(missing));
});
test("compiler case semantics reject false binding and false disk restoration claims", () => {
  const a = report("snapshot_baseline"), b = report("reread_during_disk_aba");
  invalid(wire({ ...a, consumedInput: b.consumedInput }));
  invalid(wire({ ...a, restoredInput: b.consumedInput }));
  invalid(wire({ ...a, captureMatchesConsumed: false }));
  invalid(wire({ ...b, consumedInput: b.capturedInput }), b.caseId);
  invalid(wire({ ...b, status: "observed" }), b.caseId);
  invalid(wire(a), "snapshot_after_disk_aba");
  for (const id of ["unlisted_import", "type_error", "stale_output", "extra_output"] as const) invalid(wire({ ...a, caseId: id }), id);
});
