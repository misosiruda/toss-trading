// Test-only synthetic observation protocol. This is not runtime admission evidence.
import {
  isConditionalPackageCaseId, parseConditionalPackageReport, type ConditionalPackageCaseId, type ConditionalPackageReport,
} from "./runtimeConditionalPackageProtocolTestFixtures.js";
import {
  isPackageMetadataCaseId, parsePackageMetadataReport, type PackageMetadataCaseId, type PackageMetadataReport,
} from "./runtimePackageMetadataProtocolTestFixtures.js";
export const RUNTIME_LOAD_EXPERIMENT_CASE_IDS = Object.freeze([
  "esm_first", "cjs_first", "esm_cjs_first", "json_import_first", "json_require_first", "json_fresh_b",
  "esm_cache", "cjs_cache", "json_import_require", "json_require_import", "json_cache_source_b",
  "late_new", "closed_new", "closed_cached", "race_snapshot", "race_default", "late_registration",
  "chain_short_circuit", "chain_rewrite", "chain_deregister", "metadata_default", "asset_outside_loader",
  "reject_mapping", "reject_query", "reject_attribute", "reject_format", "reject_alias",
  "cap_inventory", "cap_inventory_over", "cap_source", "cap_source_over", "cap_total", "cap_total_over",
  "cap_bootstrap", "cap_bootstrap_over", "cap_events", "cap_events_over",
  "transport_valid", "transport_empty", "transport_truncated", "transport_multiple", "transport_unknown_key",
  "transport_case_mismatch", "transport_stdout", "transport_stdout_over", "transport_stderr", "transport_stderr_over",
  "transport_exit", "transport_signal", "transport_timeout",
] as const);
export type RuntimeLoadExperimentCaseId = typeof RUNTIME_LOAD_EXPERIMENT_CASE_IDS[number] | PackageMetadataCaseId | ConditionalPackageCaseId;
export const RUNTIME_LOAD_EXPERIMENT_FILE_IDS = Object.freeze([
  "f01", "f02", "f03", "f04", "f05", "f06", "f07", "f08",
  "f09", "f10", "f11", "f12", "f13", "f14", "f15", "f16",
] as const);
export type RuntimeLoadExperimentFileId = typeof RUNTIME_LOAD_EXPERIMENT_FILE_IDS[number];
export const RUNTIME_LOAD_EXPERIMENT_OBSERVATIONS = Object.freeze([
  "REGISTRATION_PRECEDES_LOAD", "LATE_REGISTRATION_MISSED", "ORIGINAL_VALUE", "REPLACEMENT_VALUE",
  "SAME_OBJECT", "EVALUATED_ONCE", "CACHE_CALLBACK_ABSENT", "SUPPLIED_SOURCE_UNUSED",
  "LATE_LOAD_RECORDED", "CLOSED_LOAD_REJECTED", "CLOSED_CACHE_UNOBSERVED", "CHAIN_BYPASS_OBSERVED",
  "CHAIN_REWRITE_OBSERVED", "METADATA_BYTES_UNAVAILABLE", "ASSET_READ_UNOBSERVED", "EXPECTED_REJECTION",
] as const);
export type RuntimeLoadExperimentObservation = typeof RUNTIME_LOAD_EXPERIMENT_OBSERVATIONS[number];
export const RUNTIME_LOAD_EXPERIMENT_REJECTION_REASONS = Object.freeze([
  "MAPPING_UNSUPPORTED", "QUERY_UNSUPPORTED", "ATTRIBUTE_UNSUPPORTED", "FORMAT_UNSUPPORTED", "PATH_UNSAFE",
  "INVENTORY_LIMIT", "SOURCE_LIMIT", "TOTAL_SOURCE_LIMIT", "EVENT_LIMIT", "LOAD_CLOSED",
] as const);
export type RuntimeLoadExperimentRejectionReason = typeof RUNTIME_LOAD_EXPERIMENT_REJECTION_REASONS[number];
export type RuntimeLoadExperimentEvent =
  | { kind: "resolve"; fileId: RuntimeLoadExperimentFileId; parentId: "bootstrap" | RuntimeLoadExperimentFileId;
      route: "snapshot" | "delegated" }
  | { kind: "load"; fileId: RuntimeLoadExperimentFileId; format: "module" | "commonjs" | "json";
      sourceDigest: string; supply: "snapshot" | "delegated" };
interface RuntimeLoadExperimentCommon {
  schemaVersion: "runtime_load_experiment.v1";
  caseId: RuntimeLoadExperimentCaseId;
  runtime: "unavailable";
  dependencies: "unavailable";
  result: "unavailable";
  comparability: "unavailable";
  completeRuntime: false;
  completeConfiguration: false;
  completeInput: false;
}
export type RuntimeLoadExperimentWireReport = ConditionalPackageReport | PackageMetadataReport | RuntimeLoadExperimentCommon & (
  | { status: "observed" | "counterexample"; evidence: "synthetic_fixture_observation";
      events: RuntimeLoadExperimentEvent[]; observations: RuntimeLoadExperimentObservation[] }
  | { status: "rejected"; evidence: "unavailable"; reason: RuntimeLoadExperimentRejectionReason }
);
export type RuntimeLoadExperimentFailureReason =
  | "INVALID_CASE" | "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT" | "SPAWN_FAILURE"
  | "EXIT_FAILURE" | "SIGNAL_EXIT" | "DEADLINE_EXCEEDED" | "STDOUT_LIMIT" | "STDERR_LIMIT"
  | "INVALID_REPORT" | "CLEANUP_FAILURE" | "CLEANUP_UNCONFIRMED";
export type RuntimeLoadExperimentParentResult =
  | { status: "collected"; report: RuntimeLoadExperimentWireReport; termination: "confirmed"; cleanup: "removed" }
  | { status: "unsupported"; reason: "RUNTIME_UNSUPPORTED"; report: null; termination: "not_started"; cleanup: "not_created" }
  | { status: "failed"; reason: RuntimeLoadExperimentFailureReason; report: null;
      termination: "not_started" | "confirmed" | "unconfirmed";
      cleanup: "not_created" | "removed" | "retained" | "unconfirmed" };

export const RUNTIME_LOAD_EXPERIMENT_MAX_WIRE_BYTES = 21_335;
export const RUNTIME_LOAD_EXPERIMENT_STDOUT_LIMIT = 32_768;
export const RUNTIME_LOAD_EXPERIMENT_STDERR_LIMIT = 4_096;
const commonKeys = ["schemaVersion", "caseId", "runtime", "dependencies", "result", "comparability",
  "completeRuntime", "completeConfiguration", "completeInput", "status", "evidence"];
function invalid(): never { throw new Error("INVALID_REPORT"); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || !keys.every((key) => fields.includes(key))) invalid();
}
function member(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}
export function isRuntimeLoadExperimentCaseId(value: unknown): value is RuntimeLoadExperimentCaseId {
  return member(value, RUNTIME_LOAD_EXPERIMENT_CASE_IDS) || isPackageMetadataCaseId(value) || isConditionalPackageCaseId(value);
}

export function parseRuntimeLoadExperimentWireReport(
  bytes: Buffer, expectedCaseId: RuntimeLoadExperimentCaseId,
): RuntimeLoadExperimentWireReport {
  try {
    if (isConditionalPackageCaseId(expectedCaseId)) return parseConditionalPackageReport(bytes, expectedCaseId);
    if (isPackageMetadataCaseId(expectedCaseId)) return parsePackageMetadataReport(bytes, expectedCaseId);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > RUNTIME_LOAD_EXPERIMENT_MAX_WIRE_BYTES
      || !isRuntimeLoadExperimentCaseId(expectedCaseId)) invalid();
    const value = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (value.schemaVersion !== "runtime_load_experiment.v1" || value.caseId !== expectedCaseId
      || !["runtime", "dependencies", "result", "comparability"].every((key) => value[key] === "unavailable")
      || !["completeRuntime", "completeConfiguration", "completeInput"].every((key) => value[key] === false)) invalid();
    if (value.status === "rejected") {
      exact(value, [...commonKeys, "reason"]);
      if (value.evidence !== "unavailable" || !member(value.reason, RUNTIME_LOAD_EXPERIMENT_REJECTION_REASONS)) invalid();
    } else {
      exact(value, [...commonKeys, "events", "observations"]);
      if (!member(value.status, ["observed", "counterexample"])
        || value.evidence !== "synthetic_fixture_observation" || !Array.isArray(value.events)
        || value.events.length > 128 || !Array.isArray(value.observations) || value.observations.length > 16
        || new Set(value.observations).size !== value.observations.length
        || !value.observations.every((item) => member(item, RUNTIME_LOAD_EXPERIMENT_OBSERVATIONS))) invalid();
      for (const item of value.events) {
        const event = object(item);
        if (!member(event.fileId, RUNTIME_LOAD_EXPERIMENT_FILE_IDS)) invalid();
        if (event.kind === "resolve") {
          exact(event, ["kind", "fileId", "parentId", "route"]);
          if (!member(event.parentId, ["bootstrap", ...RUNTIME_LOAD_EXPERIMENT_FILE_IDS])
            || !member(event.route, ["snapshot", "delegated"])) invalid();
        } else if (event.kind === "load") {
          exact(event, ["kind", "fileId", "format", "sourceDigest", "supply"]);
          if (!member(event.format, ["module", "commonjs", "json"])
            || !member(event.supply, ["snapshot", "delegated"])
            || typeof event.sourceDigest !== "string" || event.sourceDigest.length !== 71
            || !/^sha256:[0-9a-f]{64}$/.test(event.sourceDigest)) invalid();
        } else invalid();
      }
    }
    if (!bytes.equals(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"))) invalid();
    return value as unknown as RuntimeLoadExperimentWireReport;
  } catch {
    // Never expose input, parser diagnostics, paths, or exception causes.
    return invalid();
  }
}
