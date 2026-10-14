// Independent, finite schema/golden oracle. Never imported at runtime by the child.
export const COMPILER_OUTPUT_POSITIVE_CASES = ["baseline","output_snapshot_aba","output_reread_aba","output_same_value_substitution","cache_before_hook","hook_rewrite","callback_cap","output_byte_cap"] as const;
export const COMPILER_OUTPUT_NEGATIVE_CASES = {"stale_output":"STALE_OUTPUT","extra_output":"UNLISTED_OUTPUT","duplicate_output":"DUPLICATE_OUTPUT","missing_output":"INCOMPLETE_OUTPUT","unlisted_import":"OUTPUT_UNLISTED","unlisted_parent":"OUTPUT_UNLISTED","query_url":"OUTPUT_UNLISTED","fragment_url":"OUTPUT_UNLISTED","import_attributes":"OUTPUT_UNLISTED","format_mismatch":"OUTPUT_FORMAT","snapshot_swap":"OUTPUT_MISMATCH","supply_mutation":"OUTPUT_MISMATCH","hook_deregister":"OUTPUT_HOOK_LOST","late_load":"OUTPUT_CLOSED","artifact_mismatch":"ARTIFACT_MISMATCH","compiler_object_mismatch":"COMPILER_IDENTITY","type_error":"COMPILER_DIAGNOSTIC","options_mutation":"SOURCE_MISMATCH","source_object_mismatch":"SOURCE_MISMATCH","input_cap_over":"INPUT_LIMIT","output_cap_over":"OUTPUT_LIMIT","callback_cap_over":"OUTPUT_CALLBACK_LIMIT","import_failure":"OUTPUT_IMPORT_FAILED","restore_failure":"COMPILER_DIAGNOSTIC","input_extra":"INCOMPLETE_INPUT","input_missing":"INCOMPLETE_INPUT","source_text_mismatch":"SOURCE_MISMATCH","compiler_callback_cap_over":"LOAD_LIMIT","unlisted_read":"UNLISTED_READ","read_cap_over":"READ_LIMIT","resolution_cap_over":"RESOLUTION_LIMIT"} as const;
export type CompilerOutputCaseId = typeof COMPILER_OUTPUT_POSITIVE_CASES[number] | keyof typeof COMPILER_OUTPUT_NEGATIVE_CASES;
export const COMPILER_OUTPUT_CASES: readonly CompilerOutputCaseId[] =
  [...COMPILER_OUTPUT_POSITIVE_CASES, ...Object.keys(COMPILER_OUTPUT_NEGATIVE_CASES) as (keyof typeof COMPILER_OUTPUT_NEGATIVE_CASES)[]];
export const COMPILER_OUTPUT_REJECTIONS = ["STALE_OUTPUT","UNLISTED_OUTPUT","DUPLICATE_OUTPUT","INCOMPLETE_OUTPUT","OUTPUT_UNLISTED","OUTPUT_FORMAT","OUTPUT_MISMATCH","OUTPUT_HOOK_LOST","OUTPUT_CLOSED","ARTIFACT_MISMATCH","COMPILER_IDENTITY","COMPILER_DIAGNOSTIC","SOURCE_MISMATCH","INPUT_LIMIT","OUTPUT_LIMIT","OUTPUT_CALLBACK_LIMIT","OUTPUT_IMPORT_FAILED","INCOMPLETE_INPUT","LOAD_LIMIT","UNLISTED_READ","READ_LIMIT","RESOLUTION_LIMIT","STARTUP_UNSUPPORTED","ARTIFACT_UNSAFE","INPUT_UNSAFE","INPUT_CHANGED","INPUT_INVALID","LOAD_UNLISTED","LOAD_FORMAT","LOAD_INCOMPLETE","COMPILER_FAILURE","OUTPUT_UNSAFE","OUTPUT_CHANGED","OUTPUT_INVALID","ARTIFACT_RESTORE_FAILED","INPUT_RESTORE_FAILED","OUTPUT_RESTORE_FAILED"] as const;
export type CompilerOutputRejection = typeof COMPILER_OUTPUT_REJECTIONS[number];
export const COMPILER_OUTPUT_RESTORATION_STATES = ["not_changed", "confirmed", "unconfirmed"] as const;
export type CompilerOutputRestoration = typeof COMPILER_OUTPUT_RESTORATION_STATES[number];
export const COMPILER_OUTPUT_CONSTANTS = {"artifactA":"sha256:3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675","inputA":"sha256:2bdea39bca1bf39d5af133d20018c7b7b55e5dc00229068f4d2bfee1cec63a17","outputA":"sha256:533f5a5e504038e4f64ae9acbe37cff8768dd035e3a501a948894c5ae46e0c90","outputB":"sha256:9dff7b0d301dcea56c07266aa59c9dda22e32055e97b9205dd6f774acdb9d0c3","options":"sha256:21aff3ef4aeab8c795691f3eeae2343f5623b7fe29fab296befb015a6e31dc4d","outputSame":"sha256:fdb1fedea900f28693fd4649d720a825f3109cee8690a8fedae1d531ddf7f097","outputCap":"sha256:e9d8ac43a158d83b35512483b5d87621ce669e6f2fc933cefdd21755ca7f05a3"} as const;
export const COMPILER_ARTIFACT_LIMIT = 10 * 1024 * 1024;
export const COMPILER_OUTPUT_STDOUT_LIMIT = 2048;
export const COMPILER_OUTPUT_STDERR_LIMIT = 4096;
export const COMPILER_OUTPUT_MAX_WIRE_BYTES = 1276;
export const COMPILER_OUTPUT_MAX_REJECTED_BYTES = 457;
export function compilerOutputSourcesForTest(): Map<string,string> { return new Map(Object.entries({"entry.ts":"import { value } from \"./value.js\";\nexport const observed: string = value;\n","value.ts":"export const value: string = \"snapshot-A\";\n","lib.d.ts":"interface Array<T> { length: number; [n: number]: T }\ninterface Boolean {}\ninterface Function {}\ninterface CallableFunction extends Function {}\ninterface NewableFunction extends Function {}\ninterface IArguments {}\ninterface Number {}\ninterface Object {}\ninterface RegExp {}\ninterface String {}\n"})); }
export const COMPILER_OUTPUT_GOLDEN_OUTPUTS = {"entry.js":"import { value } from \"./value.js\";\nexport const observed = value;\n","value.js":"export const value = \"snapshot-A\";\n"} as const;
export function compilerOutputCommonForTest(caseId: CompilerOutputCaseId) {
  return { schemaVersion: "compiler_output_experiment.v1" as const, caseId,
    runtime: "unavailable" as const, dependencies: "unavailable" as const,
    result: "unavailable" as const, comparability: "unavailable" as const,
    completeRuntime: false as const, completeConfiguration: false as const, completeInput: false as const };
}
type Common = ReturnType<typeof compilerOutputCommonForTest>;
export type CompilerOutputReport = Common & (
  | { status: "observed" | "counterexample"; evidence: "fixed_compiler_output_observation";
      compilerVersion: "5.9.3"; artifactBytes: 9112572; compilerArtifact: string; compilerLoadCount: 1;
      compilerCacheSameObject: true; compilerObjectSame: true; consumedInput: string; optionsDigest: string;
      sourceFileObjectsSame: true; emittedOutput: string; suppliedOutput: string; preloadedOutput: string;
      outputFileCount: 2; outputLoadCount: 0 | 2; observedValue: "snapshot-A" | "snapshot-B";
      cacheSameNamespace: true; outputCallbacks: 2 | 5 | 8; restoredOutput: string;
      artifactUnchanged: true; inputUnchanged: true; outputRestoration: "confirmed" }
  | { status: "rejected"; evidence: "unavailable"; reason: CompilerOutputRejection;
      artifactRestoration: CompilerOutputRestoration; inputRestoration: CompilerOutputRestoration;
      outputRestoration: CompilerOutputRestoration }
);
export type CompilerOutputFailureReason = "INVALID_CASE" | "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT"
  | "SPAWN_FAILURE" | "EXIT_FAILURE" | "SIGNAL_EXIT" | "DEADLINE_EXCEEDED" | "STDOUT_LIMIT" | "STDERR_LIMIT"
  | "INVALID_REPORT" | "ROOT_OBSERVATION_FAILURE" | "ROOT_OBSERVATION_UNCONFIRMED" | "ALLOCATION_LIMIT" | "RESTORE_UNCONFIRMED";
// No deletion requested; this does not guarantee that a pathname still has the observed identity.
export type CompilerOutputParentResult =
  | { status: "collected"; report: CompilerOutputReport; termination: "confirmed"; cleanup: "cleanup_not_performed" }
  | { status: "unsupported"; reason: "RUNTIME_UNSUPPORTED"; report: null; termination: "not_started"; cleanup: "not_created" }
  | { status: "failed"; reason: CompilerOutputFailureReason; report: Extract<CompilerOutputReport,{status:"rejected"}> | null;
      termination: "not_started" | "confirmed" | "unconfirmed"; cleanup: "not_created" | "cleanup_not_performed" };
export function isCompilerOutputCaseId(value: unknown): value is CompilerOutputCaseId {
  return typeof value === "string" && (COMPILER_OUTPUT_CASES as readonly string[]).includes(value);
}
export function expectedCompilerOutputObservationForTest(caseId: CompilerOutputCaseId): CompilerOutputReport {
  if (!(COMPILER_OUTPUT_POSITIVE_CASES as readonly string[]).includes(caseId)) throw new Error("INVALID_CASE");
  const c=COMPILER_OUTPUT_CONSTANTS, cached=caseId==="cache_before_hook";
  const changed=["output_reread_aba","output_same_value_substitution","cache_before_hook","hook_rewrite","output_byte_cap"].includes(caseId);
  return { ...compilerOutputCommonForTest(caseId),status:changed?"counterexample":"observed",evidence:"fixed_compiler_output_observation",
    compilerVersion:"5.9.3",artifactBytes:9112572,compilerArtifact:c.artifactA,compilerLoadCount:1,
    compilerCacheSameObject:true,compilerObjectSame:true,consumedInput:c.inputA,optionsDigest:c.options,
    sourceFileObjectsSame:true,emittedOutput:c.outputA,
    suppliedOutput:cached?"unavailable":caseId==="output_reread_aba"?c.outputB:caseId==="output_same_value_substitution"?c.outputSame:caseId==="output_byte_cap"?c.outputCap:c.outputA,
    preloadedOutput:cached?c.outputB:"unavailable",outputFileCount:2,outputLoadCount:cached?0:2,
    observedValue:["output_reread_aba","cache_before_hook","hook_rewrite"].includes(caseId)?"snapshot-B":"snapshot-A",
    cacheSameNamespace:true,outputCallbacks:cached?2:caseId==="callback_cap"?8:5,restoredOutput:c.outputA,
    artifactUnchanged:true,inputUnchanged:true,outputRestoration:"confirmed" };
}
export function parseCompilerOutputReport(bytes: Buffer, expected: CompilerOutputCaseId): CompilerOutputReport {
  const invalid=():never=>{throw new Error("INVALID_REPORT");};
  try {
    if (!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>COMPILER_OUTPUT_MAX_WIRE_BYTES||!isCompilerOutputCaseId(expected)) invalid();
    const v=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as Record<string,unknown>;
    if(v===null||typeof v!=="object"||Array.isArray(v))invalid();
    let canonical:CompilerOutputReport;
    if(v.status==="rejected"){
      if(!(COMPILER_OUTPUT_REJECTIONS as readonly unknown[]).includes(v.reason)||
        !(COMPILER_OUTPUT_RESTORATION_STATES as readonly unknown[]).includes(v.artifactRestoration)||
        !(COMPILER_OUTPUT_RESTORATION_STATES as readonly unknown[]).includes(v.inputRestoration)||
        !(COMPILER_OUTPUT_RESTORATION_STATES as readonly unknown[]).includes(v.outputRestoration))invalid();
      canonical={...compilerOutputCommonForTest(expected),status:"rejected",evidence:"unavailable",reason:v.reason as CompilerOutputRejection,
        artifactRestoration:v.artifactRestoration as CompilerOutputRestoration,inputRestoration:v.inputRestoration as CompilerOutputRestoration,
        outputRestoration:v.outputRestoration as CompilerOutputRestoration};
    }else canonical=expectedCompilerOutputObservationForTest(expected);
    if(!bytes.equals(Buffer.from(JSON.stringify(canonical)+"\n")))invalid();
    return canonical;
  }catch{return invalid();}
}
