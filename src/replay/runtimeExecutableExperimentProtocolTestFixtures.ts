// A bounded test-only wire. No receipt, admission capability, or completeness promotion.
export const RUNTIME_EXECUTABLE_EXPERIMENT_CASE_IDS = [
  "image_matches_path", "path_replaced", "path_unlinked", "same_version_other_bytes",
  "transport_invalid", "transport_exit", "transport_stdout_limit", "transport_stderr_limit",
] as const;
export type RuntimeExecutableExperimentCaseId = typeof RUNTIME_EXECUTABLE_EXPERIMENT_CASE_IDS[number];
export const RUNTIME_EXECUTABLE_EXPERIMENT_MAX_WIRE_BYTES = 957;
export const RUNTIME_EXECUTABLE_EXPERIMENT_STDOUT_LIMIT = 4096;
export const RUNTIME_EXECUTABLE_EXPERIMENT_STDERR_LIMIT = 4096;
export const RUNTIME_EXECUTABLE_EXPERIMENT_OBSERVATIONS = [
  "image_matches_path", "path_replacement_preserves_running_file",
  "path_absence_preserves_running_file", "version_label_does_not_identify_bytes",
] as const;
type Observation = typeof RUNTIME_EXECUTABLE_EXPERIMENT_OBSERVATIONS[number];
type Sample = { digest: string; bytes: number };
export interface RuntimeExecutableExperimentWireReport {
  schemaVersion: "runtime_executable_experiment.v1";
  caseId: RuntimeExecutableExperimentCaseId;
  runtime: "unavailable";
  dependencies: "unavailable";
  result: "unavailable";
  comparability: "unavailable";
  completeRuntime: false;
  completeConfiguration: false;
  completeInput: false;
  status: "observed" | "counterexample";
  evidence: "synthetic_fixture_observation";
  nodeVersion: "v24.19.0";
  reference: Sample;
  imageBefore: Sample;
  imageAfter: Sample;
  pathAfter: Sample | null;
  ownedFdMatchesImage: boolean;
  pathMatchesImage: boolean;
  procLinkDeleted: boolean;
  observation: Observation;
}
export type RuntimeExecutableExperimentFailureReason =
  "INVALID_CASE" | "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT" | "BINARY_LIMIT" |
  "SPAWN_FAILURE" | "EXIT_FAILURE" | "SIGNAL_EXIT" | "DEADLINE_EXCEEDED" |
  "STDOUT_LIMIT" | "STDERR_LIMIT" | "INVALID_REPORT" | "CLEANUP_FAILURE" | "CLEANUP_UNCONFIRMED";
export type RuntimeExecutableExperimentParentResult =
  { status: "collected"; report: RuntimeExecutableExperimentWireReport; termination: "confirmed"; cleanup: "removed" } |
  { status: "failed"; reason: RuntimeExecutableExperimentFailureReason; report: null;
    termination: "not_started" | "confirmed" | "unconfirmed"; cleanup: "not_created" | "removed" | "retained" | "unconfirmed" } |
  { status: "unsupported"; reason: "RUNTIME_UNSUPPORTED"; report: null; termination: "not_started"; cleanup: "not_created" };

export function isRuntimeExecutableExperimentCaseId(input: unknown): input is RuntimeExecutableExperimentCaseId {
  return typeof input === "string" && RUNTIME_EXECUTABLE_EXPERIMENT_CASE_IDS.some((id) => input === id);
}
function invalid(): never { throw new Error("INVALID_REPORT"); }
function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key))) invalid();
  return input as Record<string, unknown>;
}
function sample(input: unknown): Sample {
  const value = record(input, ["digest", "bytes"]);
  if (typeof value.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.digest) ||
    !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 1 || (value.bytes as number) > 134217728) invalid();
  return value as Sample;
}
function equal(a: Sample, b: Sample): boolean { return a.digest === b.digest && a.bytes === b.bytes; }

export function parseRuntimeExecutableExperimentWireReport(bytes: Buffer, expected: RuntimeExecutableExperimentCaseId):
  RuntimeExecutableExperimentWireReport {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > RUNTIME_EXECUTABLE_EXPERIMENT_STDOUT_LIMIT) invalid();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    if (JSON.stringify(parsed) + "\n" !== text) invalid();
    const value = record(parsed, [
      "schemaVersion", "caseId", "runtime", "dependencies", "result", "comparability",
      "completeRuntime", "completeConfiguration", "completeInput", "status", "evidence", "nodeVersion",
      "reference", "imageBefore", "imageAfter", "pathAfter", "ownedFdMatchesImage", "pathMatchesImage",
      "procLinkDeleted", "observation",
    ]);
    if (value.schemaVersion !== "runtime_executable_experiment.v1" || value.caseId !== expected ||
      !isRuntimeExecutableExperimentCaseId(value.caseId) || value.runtime !== "unavailable" ||
      value.dependencies !== "unavailable" || value.result !== "unavailable" || value.comparability !== "unavailable" ||
      value.completeRuntime !== false || value.completeConfiguration !== false || value.completeInput !== false ||
      value.evidence !== "synthetic_fixture_observation" || value.nodeVersion !== "v24.19.0" ||
      value.ownedFdMatchesImage !== true || typeof value.pathMatchesImage !== "boolean" ||
      typeof value.procLinkDeleted !== "boolean") invalid();
    const reference = sample(value.reference), before = sample(value.imageBefore), after = sample(value.imageAfter);
    const path = value.pathAfter === null ? null : sample(value.pathAfter);
    if (!equal(before, after)) invalid();
    if (expected === "image_matches_path") {
      if (value.status !== "observed" || value.observation !== "image_matches_path" || !equal(reference, before) ||
        path === null || !equal(path, after) || !value.pathMatchesImage || value.procLinkDeleted) invalid();
    } else if (expected === "path_replaced") {
      if (value.status !== "counterexample" || value.observation !== "path_replacement_preserves_running_file" ||
        !equal(reference, before) || path === null || equal(path, after) || value.pathMatchesImage || !value.procLinkDeleted) invalid();
    } else if (expected === "path_unlinked") {
      if (value.status !== "counterexample" || value.observation !== "path_absence_preserves_running_file" ||
        !equal(reference, before) || path !== null || value.pathMatchesImage || !value.procLinkDeleted) invalid();
    } else if (expected === "same_version_other_bytes") {
      if (value.status !== "counterexample" || value.observation !== "version_label_does_not_identify_bytes" ||
        equal(reference, before) || path === null || !equal(path, after) || !value.pathMatchesImage || value.procLinkDeleted) invalid();
    } else invalid(); // Transport-fault cases never issue a valid observation.
    return value as unknown as RuntimeExecutableExperimentWireReport;
  } catch { return invalid(); }
}
