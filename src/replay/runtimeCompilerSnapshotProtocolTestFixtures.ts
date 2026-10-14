// Test-only observations. This is neither a durable receipt nor runtime admission.
export const COMPILER_SNAPSHOT_CASES = [
  "snapshot_baseline", "snapshot_after_disk_aba", "reread_during_disk_aba",
  "unlisted_import", "type_error", "stale_output", "extra_output",
] as const;
export type CompilerSnapshotCase = typeof COMPILER_SNAPSHOT_CASES[number];
export const COMPILER_SNAPSHOT_FILE_LIMIT = 16_384;
export const COMPILER_SNAPSHOT_REPORT_LIMIT = 2_048;
export type CompilerSnapshotFailure =
  "INVALID_CASE" | "FIXTURE_PREPARATION_FAILED" | "INPUT_UNSAFE" | "INPUT_LIMIT" | "INPUT_CHANGED" |
  "INPUT_INVALID" | "UNLISTED_READ" | "READ_LIMIT" | "UNLISTED_RESOLUTION" | "RESOLUTION_LIMIT" |
  "SOURCE_MISMATCH" | "INCOMPLETE_INPUT" | "OUTPUT_LIMIT" | "UNLISTED_OUTPUT" | "DUPLICATE_OUTPUT" |
  "OUTPUT_MISMATCH" | "INCOMPLETE_OUTPUT" | "STALE_OUTPUT" | "COMPILER_DIAGNOSTIC" |
  "COMPILER_FAILURE" | "CLEANUP_FAILURE";
export class CompilerSnapshotError extends Error {
  constructor(readonly reason: CompilerSnapshotFailure) { super(reason); }
}
export interface CompilerSnapshotReport {
  schemaVersion: "compiler_snapshot_experiment.v1";
  caseId: CompilerSnapshotCase;
  status: "observed" | "counterexample";
  evidence: "synthetic_compiler_observation";
  runtime: "unavailable";
  dependencies: "unavailable";
  result: "unavailable";
  comparability: "unavailable";
  completeRuntime: false;
  completeConfiguration: false;
  completeInput: false;
  compilerVersion: "5.9.3";
  inputFileCount: 3;
  outputFileCount: 2;
  capturedInput: string;
  consumedInput: string;
  restoredInput: string;
  emittedOutput: string;
  optionsDigest: string;
  captureMatchesConsumed: boolean;
  beforeAfterMatch: true;
}
export type CompilerSnapshotResult =
  { status: "collected"; report: CompilerSnapshotReport; cleanup: "removed" } |
  { status: "failed"; reason: CompilerSnapshotFailure; report: null; cleanup: "not_created" | "removed" | "retained" } |
  { status: "unsupported"; reason: "RUNTIME_UNSUPPORTED"; report: null; cleanup: "not_created" };
export function isCompilerSnapshotCase(value: unknown): value is CompilerSnapshotCase {
  return typeof value === "string" && COMPILER_SNAPSHOT_CASES.some((name) => name === value);
}
const FIELDS = [
  "schemaVersion", "caseId", "status", "evidence", "runtime", "dependencies", "result", "comparability",
  "completeRuntime", "completeConfiguration", "completeInput", "compilerVersion", "inputFileCount",
  "outputFileCount", "capturedInput", "consumedInput", "restoredInput", "emittedOutput", "optionsDigest",
  "captureMatchesConsumed", "beforeAfterMatch",
] as const;
export function parseCompilerSnapshotReport(bytes: Buffer, expected: CompilerSnapshotCase): CompilerSnapshotReport {
  const invalid = (): never => { throw new Error("INVALID_COMPILER_SNAPSHOT_REPORT"); };
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > COMPILER_SNAPSHOT_REPORT_LIMIT) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (JSON.stringify(value) + "\n" !== text || value === null || typeof value !== "object" || Array.isArray(value)) invalid();
    const r = value as Record<string, unknown>;
    if (Object.keys(r).length !== FIELDS.length || FIELDS.some((key) => !Object.hasOwn(r, key))) invalid();
    if (r.schemaVersion !== "compiler_snapshot_experiment.v1" || r.caseId !== expected ||
      !isCompilerSnapshotCase(expected) || r.evidence !== "synthetic_compiler_observation" ||
      r.runtime !== "unavailable" || r.dependencies !== "unavailable" || r.result !== "unavailable" ||
      r.comparability !== "unavailable" || r.completeRuntime !== false || r.completeConfiguration !== false ||
      r.completeInput !== false || r.compilerVersion !== "5.9.3" || r.inputFileCount !== 3 || r.outputFileCount !== 2 ||
      r.beforeAfterMatch !== true || r.capturedInput !== r.restoredInput) invalid();
    for (const key of ["capturedInput", "consumedInput", "restoredInput", "emittedOutput", "optionsDigest"]) {
      if (typeof r[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(r[key] as string)) invalid();
    }
    if (expected === "reread_during_disk_aba") {
      if (r.status !== "counterexample" || r.captureMatchesConsumed !== false || r.capturedInput === r.consumedInput) invalid();
    } else if (expected === "snapshot_baseline" || expected === "snapshot_after_disk_aba") {
      if (r.status !== "observed" || r.captureMatchesConsumed !== true || r.capturedInput !== r.consumedInput) invalid();
    } else invalid();
    return r as unknown as CompilerSnapshotReport;
  } catch { return invalid(); }
}
