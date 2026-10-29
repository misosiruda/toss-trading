// Closed synthetic protocol; never admission or runtime completeness evidence.
import { createHash } from "node:crypto";

export const CONDITIONAL_PACKAGE_CASE_IDS = Object.freeze([
  "conditional_import", "conditional_root_default", "conditional_leaf_default",
  "conditional_snapshot_aba", "conditional_reread_aba", "conditional_leaf_json",
  "conditional_leaf_duplicate", "conditional_leaf_unknown", "conditional_leaf_nested",
  "conditional_leaf_array", "conditional_leaf_escape", "conditional_leaf_name", "conditional_leaf_mixed",
  "conditional_root_shape", "conditional_conditions_extra", "conditional_conditions_missing",
  "conditional_conditions_duplicate", "conditional_direct_leaf", "conditional_attribute",
  "conditional_unknown_package", "conditional_subpath", "conditional_restore_fault", "conditional_over",
] as const);
export type ConditionalPackageCaseId = typeof CONDITIONAL_PACKAGE_CASE_IDS[number];
export function isConditionalPackageCaseId(value: unknown): value is ConditionalPackageCaseId {
  return typeof value === "string" && CONDITIONAL_PACKAGE_CASE_IDS.some((id) => id === value);
}
interface Binding {
  metadataId: "f08" | "f01";
  parentId: "bootstrap" | "f09" | "f10";
  conditions: string[];
  metadataDigest: string;
  target: "f09" | "f10" | "f02" | "f03";
  selectedCondition: "import" | "default";
  consumption: "snapshot" | "reread";
  sourceDigest: string;
}
interface Common {
  schemaVersion: "runtime_conditional_package_experiment.v1";
  caseId: ConditionalPackageCaseId;
  runtime: "unavailable"; dependencies: "unavailable"; result: "unavailable"; comparability: "unavailable";
  completeRuntime: false; completeConfiguration: false; completeInput: false;
}
export type ConditionalPackageReport = Common & (
  | { status: "observed" | "counterexample"; evidence: "synthetic_fixture_observation";
      bindings: Binding[]; token: number; diskRestored: true }
  | { status: "rejected"; evidence: "unavailable"; reason: string; resolved: number; loaded: number }
);
const digest = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
function invalid(): never { throw new Error("INVALID_REPORT"); }

// Independent expected bytes, not imported from preparation or the producer.
export function conditionalPackageGoldenReport(caseId: ConditionalPackageCaseId): ConditionalPackageReport {
  if (!isConditionalPackageCaseId(caseId) || ["conditional_restore_fault", "conditional_over"].includes(caseId)) invalid();
  const common = { schemaVersion: "runtime_conditional_package_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false } as const;
  if (!["conditional_import", "conditional_root_default", "conditional_leaf_default",
    "conditional_snapshot_aba", "conditional_reread_aba"].includes(caseId)) {
    const count = ["conditional_root_shape", "conditional_direct_leaf"].includes(caseId) ? 0 : 1;
    const reason = caseId.startsWith("conditional_conditions_") ? "CONDITIONS_UNSUPPORTED"
      : caseId === "conditional_attribute" ? "ATTRIBUTE_UNSUPPORTED"
      : ["conditional_direct_leaf", "conditional_unknown_package", "conditional_subpath"].includes(caseId)
        ? "MAPPING_UNSUPPORTED" : "METADATA_UNSUPPORTED";
    return { ...common, status: "rejected", evidence: "unavailable", reason, resolved: count, loaded: count };
  }
  const reread = caseId === "conditional_reread_aba";
  const rootDefault = caseId === "conditional_root_default";
  const leafDefault = caseId === "conditional_leaf_default";
  const rootB = reread || rootDefault;
  const leafB = reread || leafDefault;
  function metadata(name: string, defaultFirst: boolean): string {
    const exports = defaultFirst ? { default: "./replacement.mjs", import: "./original.mjs" }
      : { import: reread ? "./replacement.mjs" : "./original.mjs", default: "./replacement.mjs" };
    return `${JSON.stringify({ name, exports, type: "module" })}\n`;
  }
  const bindings: Binding[] = [{ metadataId: "f08", parentId: "bootstrap",
    conditions: ["import", "module-sync", "node", "node-addons"],
    metadataDigest: digest(metadata("c2b-fixture", rootDefault)), target: rootB ? "f10" : "f09",
    selectedCondition: rootDefault ? "default" : "import", consumption: reread ? "reread" : "snapshot",
    sourceDigest: digest(`import value from 'c2c-leaf';\nexport default {token:value.token+${rootB ? 2000 : 1000}};\n`) },
  { metadataId: "f01", parentId: rootB ? "f10" : "f09",
    conditions: ["import", "module-sync", "node", "node-addons"],
    metadataDigest: digest(metadata("c2c-leaf", leafDefault)), target: leafB ? "f03" : "f02",
    selectedCondition: leafDefault ? "default" : "import", consumption: reread ? "reread" : "snapshot",
    sourceDigest: digest(`export default {token:${leafB ? 202 : 101}};\n`) }];
  return { ...common, status: reread ? "counterexample" : "observed", evidence: "synthetic_fixture_observation",
    bindings, token: (rootB ? 2000 : 1000) + (leafB ? 202 : 101), diskRestored: true };
}
// Maximum of the finite canonical wire, including LF, frozen before producer implementation.
export const CONDITIONAL_PACKAGE_MAX_WIRE_BYTES = 1088;
export function parseConditionalPackageReport(bytes: Buffer, caseId: ConditionalPackageCaseId): ConditionalPackageReport {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > CONDITIONAL_PACKAGE_MAX_WIRE_BYTES) invalid();
  const expected = conditionalPackageGoldenReport(caseId);
  if (!bytes.equals(Buffer.from(`${JSON.stringify(expected)}\n`))) invalid();
  return expected;
}
