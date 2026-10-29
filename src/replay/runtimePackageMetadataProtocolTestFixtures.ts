// Closed synthetic fixture protocol, never runtime admission evidence.
import { createHash } from "node:crypto";
import type {
  RuntimeLoadExperimentEvent, RuntimeLoadExperimentObservation,
} from "./runtimeLoadExperimentProtocolTestFixtures.js";

export const PACKAGE_METADATA_CASE_IDS = Object.freeze([
  "metadata_snapshot", "metadata_snapshot_aba", "metadata_reread_aba",
  "metadata_json", "metadata_duplicate", "metadata_unknown", "metadata_condition", "metadata_array",
  "metadata_escape", "metadata_query", "metadata_format", "metadata_name", "metadata_parent",
  "metadata_attribute", "metadata_subpath", "metadata_restore_fault", "metadata_over",
] as const);
export type PackageMetadataCaseId = typeof PACKAGE_METADATA_CASE_IDS[number];
interface Common {
  schemaVersion: "runtime_package_metadata_experiment.v1";
  caseId: PackageMetadataCaseId;
  runtime: "unavailable";
  dependencies: "unavailable";
  result: "unavailable";
  comparability: "unavailable";
  completeRuntime: false;
  completeConfiguration: false;
  completeInput: false;
}
export type PackageMetadataReport = Common & (
  | { status: "observed" | "counterexample"; evidence: "synthetic_fixture_observation";
      metadata: { sourceDigest: string; target: "f09" | "f10"; consumption: "snapshot" | "reread"; diskRestored: true };
      events: RuntimeLoadExperimentEvent[]; observations: RuntimeLoadExperimentObservation[] }
  | { status: "rejected"; evidence: "unavailable";
      reason: "METADATA_UNSUPPORTED" | "MAPPING_UNSUPPORTED" | "ATTRIBUTE_UNSUPPORTED" }
);
export function isPackageMetadataCaseId(value: unknown): value is PackageMetadataCaseId {
  return typeof value === "string" && PACKAGE_METADATA_CASE_IDS.some((item) => item === value);
}
const digest = (source: string) => `sha256:${createHash("sha256").update(source).digest("hex")}`;
function invalid(): never { throw new Error("INVALID_REPORT"); }

// Finite independent golden contract: no caller bytes, digest, path, or status is trusted.
export function packageMetadataGoldenReport(caseId: PackageMetadataCaseId): PackageMetadataReport {
  if (!isPackageMetadataCaseId(caseId) || caseId === "metadata_restore_fault" || caseId === "metadata_over") invalid();
  const common = {
    schemaVersion: "runtime_package_metadata_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false,
  } as const;
  if (!["metadata_snapshot", "metadata_snapshot_aba", "metadata_reread_aba"].includes(caseId)) {
    const reason = caseId === "metadata_attribute" ? "ATTRIBUTE_UNSUPPORTED"
      : caseId === "metadata_parent" || caseId === "metadata_subpath" ? "MAPPING_UNSUPPORTED" : "METADATA_UNSUPPORTED";
    return { ...common, status: "rejected", evidence: "unavailable", reason };
  }
  const reread = caseId === "metadata_reread_aba";
  const target = reread ? "f10" : "f09";
  const metadata = reread
    ? '{"name":"c2b-fixture","exports":"./replacement.mjs","type":"module"}\n'
    : '{"name":"c2b-fixture","exports":"./original.mjs","type":"module"}\n';
  const source = reread ? "export default {token:202};\n" : "export default {token:101};\n";
  return { ...common, status: reread ? "counterexample" : "observed", evidence: "synthetic_fixture_observation",
    metadata: { sourceDigest: digest(metadata), target, consumption: reread ? "reread" : "snapshot", diskRestored: true },
    events: [
      { kind: "resolve", fileId: target, parentId: "bootstrap", route: "snapshot" },
      { kind: "load", fileId: target, format: "module", sourceDigest: digest(source), supply: "snapshot" },
    ], observations: [reread ? "REPLACEMENT_VALUE" : "ORIGINAL_VALUE"] };
}

// Exact maximum of the finite versioned wire (including LF); frozen before producer implementation.
export const PACKAGE_METADATA_MAX_WIRE_BYTES = 783;
export function parsePackageMetadataReport(bytes: Buffer, caseId: PackageMetadataCaseId): PackageMetadataReport {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > PACKAGE_METADATA_MAX_WIRE_BYTES) invalid();
  const expected = packageMetadataGoldenReport(caseId);
  if (!bytes.equals(Buffer.from(`${JSON.stringify(expected)}\n`, "utf8"))) invalid();
  return expected;
}
