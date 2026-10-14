// Fixed test-only compiler-load observations; never runtime admission evidence.
export const COMPILER_LOAD_CASES = ["snapshot_baseline", "snapshot_after_disk_aba", "reread_during_disk_aba",
  "cache_before_hook", "artifact_mismatch", "unlisted_builtin", "unlisted_module",
  "callback_cap", "callback_cap_over", "artifact_cap_over"] as const;
export type CompilerLoadCaseId = typeof COMPILER_LOAD_CASES[number];
export const COMPILER_ARTIFACT_LIMIT = 10 * 1024 * 1024;
export const COMPILER_ARTIFACT_A_BYTES = 9_112_572;
export const COMPILER_ARTIFACT_B_BYTES = 9_112_608;
export const COMPILER_ARTIFACT_A = "sha256:3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675";
export const COMPILER_ARTIFACT_B = "sha256:ee733b7a5349430d9e46a995f815f777cb520421d92a44062f8aecf12ad2dcf3";
export const COMPILER_LOAD_INPUT = "sha256:5bebe5892144e93811698b7ea8f0b449227c33d057fd3c08294e32e94fe2524a";
export const COMPILER_LOAD_OUTPUT = "sha256:a2098bd92b10bf8b816d24b7556b1ce8c49a879d130489065ef1051c17e042f6";
export const COMPILER_LOAD_BUILTINS = ["crypto", "fs", "os", "path", "perf_hooks"] as const;
export const COMPILER_LOAD_STDOUT_LIMIT = 2048;
export const COMPILER_LOAD_STDERR_LIMIT = 4096;
export const COMPILER_LOAD_MAX_WIRE_BYTES = 1041;
export const COMPILER_LOAD_REJECTIONS = ["STARTUP_UNSUPPORTED", "ARTIFACT_UNSAFE", "ARTIFACT_LIMIT",
  "ARTIFACT_MISMATCH", "CACHE_PREPOPULATED", "LOAD_UNLISTED", "LOAD_FORMAT", "LOAD_LIMIT",
  "LOAD_INCOMPLETE", "COMPILER_FAILURE", "ARTIFACT_RESTORE_FAILED"] as const;
export type CompilerLoadRejection = typeof COMPILER_LOAD_REJECTIONS[number];
interface Common {
  schemaVersion: "compiler_load_experiment.v1"; caseId: CompilerLoadCaseId;
  runtime: "unavailable"; dependencies: "unavailable"; result: "unavailable"; comparability: "unavailable";
  completeRuntime: false; completeConfiguration: false; completeInput: false;
}
export type CompilerLoadReport = Common & (
  | { status: "observed" | "counterexample"; evidence: "fixed_compiler_load_observation";
      compilerVersion: "5.9.3"; artifactBytes: number; capturedArtifact: string; suppliedArtifact: string;
      restoredArtifact: string; captureMatchesSupplied: boolean; diskBeforeAfterMatch: true;
      compilerLoadCount: 1; builtinLoads: readonly string[]; cacheSameObject: true; observedMarker: 0 | 202;
      inputDigest: string; outputDigest: string; callbackCount: 12 | 32 }
  | { status: "rejected"; evidence: "unavailable"; reason: CompilerLoadRejection }
);
export type CompilerLoadFailureReason = "INVALID_CASE" | "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT"
  | "SPAWN_FAILURE" | "EXIT_FAILURE" | "SIGNAL_EXIT" | "DEADLINE_EXCEEDED" | "STDOUT_LIMIT" | "STDERR_LIMIT"
  | "INVALID_REPORT" | "CLEANUP_FAILURE" | "CLEANUP_UNCONFIRMED";
export type CompilerLoadParentResult =
  | { status: "collected"; report: CompilerLoadReport; termination: "confirmed"; cleanup: "removed" }
  | { status: "unsupported"; reason: "RUNTIME_UNSUPPORTED"; report: null; termination: "not_started"; cleanup: "not_created" }
  | { status: "failed"; reason: CompilerLoadFailureReason; report: null;
      termination: "not_started" | "confirmed" | "unconfirmed"; cleanup: "not_created" | "removed" | "retained" | "unconfirmed" };
export function isCompilerLoadCaseId(value: unknown): value is CompilerLoadCaseId {
  return typeof value === "string" && (COMPILER_LOAD_CASES as readonly string[]).includes(value);
}
const common = ["schemaVersion", "caseId", "runtime", "dependencies", "result", "comparability",
  "completeRuntime", "completeConfiguration", "completeInput", "status", "evidence"];
function invalid(): never { throw new Error("INVALID_REPORT"); }
export function parseCompilerLoadReport(bytes: Buffer, expected: CompilerLoadCaseId): CompilerLoadReport {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > COMPILER_LOAD_MAX_WIRE_BYTES || !isCompilerLoadCaseId(expected)) invalid();
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>;
    if (typeof v !== "object" || v === null || Array.isArray(v) || v.schemaVersion !== "compiler_load_experiment.v1" || v.caseId !== expected ||
      !["runtime", "dependencies", "result", "comparability"].every(k => v[k] === "unavailable") ||
      !["completeRuntime", "completeConfiguration", "completeInput"].every(k => v[k] === false)) invalid();
    let keys: string[];
    if (v.status === "rejected") {
      keys = [...common, "reason"];
      if (v.evidence !== "unavailable" || !(COMPILER_LOAD_REJECTIONS as readonly unknown[]).includes(v.reason)) invalid();
    } else {
      keys = [...common, "compilerVersion", "artifactBytes", "capturedArtifact", "suppliedArtifact", "restoredArtifact",
        "captureMatchesSupplied", "diskBeforeAfterMatch", "compilerLoadCount", "builtinLoads", "cacheSameObject",
        "observedMarker", "inputDigest", "outputDigest", "callbackCount"];
      const counter = expected === "reread_during_disk_aba";
      if (!["snapshot_baseline", "snapshot_after_disk_aba", "reread_during_disk_aba", "callback_cap"].includes(expected) ||
        v.status !== (counter ? "counterexample" : "observed") || v.evidence !== "fixed_compiler_load_observation" ||
        v.compilerVersion !== "5.9.3" || v.artifactBytes !== (counter ? COMPILER_ARTIFACT_B_BYTES : COMPILER_ARTIFACT_A_BYTES) ||
        v.capturedArtifact !== COMPILER_ARTIFACT_A || v.restoredArtifact !== COMPILER_ARTIFACT_A ||
        v.suppliedArtifact !== (counter ? COMPILER_ARTIFACT_B : COMPILER_ARTIFACT_A) || v.captureMatchesSupplied !== !counter ||
        v.diskBeforeAfterMatch !== true || v.compilerLoadCount !== 1 || v.cacheSameObject !== true ||
        JSON.stringify(v.builtinLoads) !== JSON.stringify(COMPILER_LOAD_BUILTINS) || v.observedMarker !== (counter ? 202 : 0) ||
        v.inputDigest !== COMPILER_LOAD_INPUT || v.outputDigest !== COMPILER_LOAD_OUTPUT ||
        v.callbackCount !== (expected === "callback_cap" ? 32 : 12)) invalid();
    }
    if (Object.keys(v).length !== keys.length || !Object.keys(v).every(k => keys.includes(k)) ||
      !bytes.equals(Buffer.from(JSON.stringify(v) + "\n"))) invalid();
    return v as unknown as CompilerLoadReport;
  } catch { return invalid(); }
}
