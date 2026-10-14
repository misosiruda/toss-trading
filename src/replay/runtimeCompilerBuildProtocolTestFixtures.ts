// Finite test-only build observations; neither runtime admission nor a durable receipt.
export const COMPILER_BUILD_POSITIVE_CASES = ["baseline","compiler_snapshot_aba","compiler_reread_aba","input_snapshot_aba","input_reread_aba","both_snapshot_aba","both_reread_aba","callback_cap","read_cap","resolution_cap"] as const;
export const COMPILER_BUILD_NEGATIVE_CASES = {"cache_before_hook":"CACHE_PREPOPULATED","artifact_mismatch":"ARTIFACT_MISMATCH","artifact_cap_over":"ARTIFACT_LIMIT","unlisted_builtin":"LOAD_UNLISTED","unlisted_module":"LOAD_UNLISTED","callback_cap_over":"LOAD_LIMIT","unlisted_import":"UNLISTED_RESOLUTION","type_error":"COMPILER_DIAGNOSTIC","stale_output":"STALE_OUTPUT","extra_output":"UNLISTED_OUTPUT","duplicate_output":"DUPLICATE_OUTPUT","missing_output":"INCOMPLETE_OUTPUT","source_object_mismatch":"SOURCE_MISMATCH","source_text_mismatch":"SOURCE_MISMATCH","missing_source":"INCOMPLETE_INPUT","duplicate_source":"INCOMPLETE_INPUT","options_mutation":"SOURCE_MISMATCH","compiler_throw":"COMPILER_FAILURE","compiler_object_mismatch":"COMPILER_IDENTITY","cache_object_mismatch":"LOAD_INCOMPLETE","unlisted_read":"UNLISTED_READ","read_cap_over":"READ_LIMIT","resolution_cap_over":"RESOLUTION_LIMIT","input_cap_over":"INPUT_LIMIT","output_cap_over":"OUTPUT_LIMIT","output_cap":"OUTPUT_MISMATCH","source_extra":"INCOMPLETE_INPUT","source_missing":"INCOMPLETE_INPUT","restore_failure":"COMPILER_DIAGNOSTIC"} as const;
export type CompilerBuildCaseId = typeof COMPILER_BUILD_POSITIVE_CASES[number] | keyof typeof COMPILER_BUILD_NEGATIVE_CASES;
export const COMPILER_BUILD_CASES: readonly CompilerBuildCaseId[] =
  [...COMPILER_BUILD_POSITIVE_CASES, ...Object.keys(COMPILER_BUILD_NEGATIVE_CASES) as (keyof typeof COMPILER_BUILD_NEGATIVE_CASES)[]];
export const COMPILER_BUILD_REJECTIONS = ["CACHE_PREPOPULATED","ARTIFACT_MISMATCH","ARTIFACT_LIMIT","LOAD_UNLISTED","LOAD_LIMIT","UNLISTED_RESOLUTION","COMPILER_DIAGNOSTIC","STALE_OUTPUT","UNLISTED_OUTPUT","DUPLICATE_OUTPUT","INCOMPLETE_OUTPUT","SOURCE_MISMATCH","INCOMPLETE_INPUT","COMPILER_FAILURE","COMPILER_IDENTITY","LOAD_INCOMPLETE","UNLISTED_READ","READ_LIMIT","RESOLUTION_LIMIT","INPUT_LIMIT","OUTPUT_LIMIT","OUTPUT_MISMATCH","STARTUP_UNSUPPORTED","ARTIFACT_UNSAFE","INPUT_UNSAFE","INPUT_CHANGED","INPUT_INVALID","LOAD_FORMAT","ARTIFACT_RESTORE_FAILED","INPUT_RESTORE_FAILED"] as const;
export type CompilerBuildRejection = typeof COMPILER_BUILD_REJECTIONS[number];
export const COMPILER_BUILD_RESTORATION_STATES = ["not_changed", "confirmed", "unconfirmed"] as const;
export type CompilerBuildRestoration = typeof COMPILER_BUILD_RESTORATION_STATES[number];
export const COMPILER_BUILD_CONSTANTS = {"artifactA":"sha256:3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675","artifactB":"sha256:ee733b7a5349430d9e46a995f815f777cb520421d92a44062f8aecf12ad2dcf3","inputA":"sha256:2bdea39bca1bf39d5af133d20018c7b7b55e5dc00229068f4d2bfee1cec63a17","inputB":"sha256:d9d1b2b6685d61de6d70967870ac9a9801d4e7ff633b17d0f91b47329dbfcff7","outputA":"sha256:533f5a5e504038e4f64ae9acbe37cff8768dd035e3a501a948894c5ae46e0c90","outputB":"sha256:9dff7b0d301dcea56c07266aa59c9dda22e32055e97b9205dd6f774acdb9d0c3","options":"sha256:21aff3ef4aeab8c795691f3eeae2343f5623b7fe29fab296befb015a6e31dc4d"} as const;
export const COMPILER_BUILD_BUILTINS = ["crypto", "fs", "os", "path", "perf_hooks"] as const;
export const COMPILER_ARTIFACT_LIMIT = 10 * 1024 * 1024;
export const COMPILER_BUILD_STDOUT_LIMIT = 2048;
export const COMPILER_BUILD_STDERR_LIMIT = 4096;
export const COMPILER_BUILD_MAX_WIRE_BYTES = 1376;
export const COMPILER_BUILD_MAX_REJECTED_BYTES = 416;
export function compilerBuildSourcesForTest(): Map<string,string> {
  return new Map(Object.entries({"entry.ts":"import { value } from \"./value.js\";\nexport const observed: string = value;\n","value.ts":"export const value: string = \"snapshot-A\";\n","lib.d.ts":"interface Array<T> { length: number; [n: number]: T }\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction extends Function {}\ninterface NewableFunction extends Function {}\ninterface IArguments {}\ninterface Number {}\ninterface Object {}\ninterface RegExp {}\ninterface String {}\n"}));
}
export const COMPILER_BUILD_GOLDEN_OUTPUTS = {"entry.js":"import { value } from \"./value.js\";\nexport const observed = value;\n","value.js":"export const value = \"snapshot-A\";\n"} as const;
export function compilerBuildCommonForTest(caseId: CompilerBuildCaseId) {
  return { schemaVersion: "compiler_build_experiment.v1" as const, caseId,
    runtime: "unavailable" as const, dependencies: "unavailable" as const,
    result: "unavailable" as const, comparability: "unavailable" as const,
    completeRuntime: false as const, completeConfiguration: false as const, completeInput: false as const };
}
type Common = ReturnType<typeof compilerBuildCommonForTest>;
export type CompilerBuildReport = Common & (
  | { status: "observed" | "counterexample"; evidence: "fixed_compiler_build_observation";
      compilerVersion: "5.9.3"; artifactBytes: 9112572 | 9112608; capturedArtifact: string;
      suppliedArtifact: string; restoredArtifact: string; compilerLoadCount: 1;
      builtinLoads: readonly string[]; cacheSameObject: true; compilerObjectSame: true;
      observedMarker: 0 | 202; callbackCount: 12 | 32; inputFileCount: 3; outputFileCount: 2;
      capturedInput: string; consumedInput: string; restoredInput: string; emittedOutput: string;
      optionsDigest: string; sourceFileObjectsSame: true; diskBeforeAfterMatch: true }
  | { status: "rejected"; evidence: "unavailable"; reason: CompilerBuildRejection;
      artifactRestoration: CompilerBuildRestoration; inputRestoration: CompilerBuildRestoration }
);
export type CompilerBuildFailureReason = "INVALID_CASE" | "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT"
  | "SPAWN_FAILURE" | "EXIT_FAILURE" | "SIGNAL_EXIT" | "DEADLINE_EXCEEDED" | "STDOUT_LIMIT" | "STDERR_LIMIT"
  | "INVALID_REPORT" | "ROOT_OBSERVATION_FAILURE" | "ROOT_OBSERVATION_UNCONFIRMED" | "ALLOCATION_LIMIT" | "RESTORE_UNCONFIRMED";
// cleanup_not_performed means no deletion was requested, not that path identity or existence is guaranteed.
export type CompilerBuildParentResult =
  | { status: "collected"; report: CompilerBuildReport; termination: "confirmed"; cleanup: "cleanup_not_performed" }
  | { status: "unsupported"; reason: "RUNTIME_UNSUPPORTED"; report: null; termination: "not_started"; cleanup: "not_created" }
  | { status: "failed"; reason: CompilerBuildFailureReason;
      report: Extract<CompilerBuildReport,{status:"rejected"}> | null;
      termination: "not_started" | "confirmed" | "unconfirmed";
      cleanup: "not_created" | "cleanup_not_performed" };
export function isCompilerBuildCaseId(value: unknown): value is CompilerBuildCaseId {
  return typeof value === "string" && (COMPILER_BUILD_CASES as readonly string[]).includes(value);
}
/** Frozen schema/golden oracle only. The child independently observes its actual values. */
export function expectedCompilerBuildObservationForTest(caseId: CompilerBuildCaseId): CompilerBuildReport {
  if (!(COMPILER_BUILD_POSITIVE_CASES as readonly string[]).includes(caseId)) throw new Error("INVALID_CASE");
  const compilerB = caseId === "compiler_reread_aba" || caseId === "both_reread_aba";
  const inputB = caseId === "input_reread_aba" || caseId === "both_reread_aba";
  const c = COMPILER_BUILD_CONSTANTS;
  return { ...compilerBuildCommonForTest(caseId), status: compilerB || inputB ? "counterexample" : "observed",
    evidence: "fixed_compiler_build_observation", compilerVersion: "5.9.3",
    artifactBytes: compilerB ? 9112608 : 9112572, capturedArtifact: c.artifactA,
    suppliedArtifact: compilerB ? c.artifactB : c.artifactA, restoredArtifact: c.artifactA,
    compilerLoadCount: 1, builtinLoads: COMPILER_BUILD_BUILTINS, cacheSameObject: true, compilerObjectSame: true,
    observedMarker: compilerB ? 202 : 0, callbackCount: caseId === "callback_cap" ? 32 : 12,
    inputFileCount: 3, outputFileCount: 2, capturedInput: c.inputA, consumedInput: inputB ? c.inputB : c.inputA,
    restoredInput: c.inputA, emittedOutput: inputB ? c.outputB : c.outputA,
    optionsDigest: c.options, sourceFileObjectsSame: true, diskBeforeAfterMatch: true };
}
export function parseCompilerBuildReport(bytes: Buffer, expected: CompilerBuildCaseId): CompilerBuildReport {
  const invalid = (): never => { throw new Error("INVALID_REPORT"); };
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > COMPILER_BUILD_MAX_WIRE_BYTES ||
      !isCompilerBuildCaseId(expected)) invalid();
    const v = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as Record<string,unknown>;
    if (v === null || typeof v !== "object" || Array.isArray(v)) invalid();
    let canonical: CompilerBuildReport;
    if (v.status === "rejected") {
      if (!(COMPILER_BUILD_REJECTIONS as readonly unknown[]).includes(v.reason) ||
        !(COMPILER_BUILD_RESTORATION_STATES as readonly unknown[]).includes(v.artifactRestoration) ||
        !(COMPILER_BUILD_RESTORATION_STATES as readonly unknown[]).includes(v.inputRestoration)) invalid();
      canonical = { ...compilerBuildCommonForTest(expected), status: "rejected", evidence: "unavailable",
        reason: v.reason as CompilerBuildRejection, artifactRestoration: v.artifactRestoration as CompilerBuildRestoration,
        inputRestoration: v.inputRestoration as CompilerBuildRestoration };
    } else canonical = expectedCompilerBuildObservationForTest(expected);
    if (!bytes.equals(Buffer.from(JSON.stringify(canonical)+"\n"))) invalid();
    return canonical;
  } catch { return invalid(); }
}
