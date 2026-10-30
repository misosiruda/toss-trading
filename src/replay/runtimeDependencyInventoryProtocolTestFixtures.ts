// Finite synthetic dependency plan; not an npm lock or production admission credential.
import { createHash } from "node:crypto";
import { conditionalPackageGoldenReport, type ConditionalPackageReport } from "./runtimeConditionalPackageProtocolTestFixtures.js";

export const DEPENDENCY_INVENTORY_CASE_IDS = Object.freeze([
  "inventory_match", "inventory_snapshot_aba", "inventory_reread_aba", "inventory_plan_json",
  "inventory_plan_duplicate", "inventory_plan_unknown", "inventory_plan_version", "inventory_plan_missing",
  "inventory_plan_reorder", "inventory_plan_rebound", "inventory_stale_metadata", "inventory_stale_selected",
  "inventory_stale_unselected", "inventory_extra_file", "inventory_extra_package", "inventory_extra_directory",
  "inventory_missing", "inventory_restore_fault", "inventory_over",
] as const);
export type DependencyInventoryCaseId = typeof DEPENDENCY_INVENTORY_CASE_IDS[number];
export function isDependencyInventoryCaseId(value: unknown): value is DependencyInventoryCaseId {
  return typeof value === "string" && DEPENDENCY_INVENTORY_CASE_IDS.some((id) => id === value);
}
export const DEPENDENCY_PLAN_DIGEST = "sha256:2e7f03d7626bc3932c5174bcc334508b2a50873fd2918f83947492b881398606";
export function dependencyInventoryPlan(): string {
  const digest = (source: string) => `sha256:${createHash("sha256").update(source).digest("hex")}`;
  // Independent literals, never computed from the observed inventory or producer output.
  const sources = [
    ["f08", '{"name":"c2b-fixture","exports":{"import":"./original.mjs","default":"./replacement.mjs"},"type":"module"}\n'],
    ["f09", "import value from 'c2c-leaf';\nexport default {token:value.token+1000};\n"],
    ["f10", "import value from 'c2c-leaf';\nexport default {token:value.token+2000};\n"],
    ["f01", '{"name":"c2c-leaf","exports":{"import":"./original.mjs","default":"./replacement.mjs"},"type":"module"}\n'],
    ["f02", "export default {token:101};\n"], ["f03", "export default {token:202};\n"],
  ] as const;
  return `${JSON.stringify({ schemaVersion: "c2_dependency_snapshot_plan.v1",
    packages: [{ name: "c2b-fixture", files: ["f08", "f09", "f10"] }, { name: "c2c-leaf", files: ["f01", "f02", "f03"] }],
    files: sources.map(([id, source]) => ({ id, sourceDigest: digest(source) })) })}\n`;
}
type Common = Omit<ConditionalPackageReport, "schemaVersion" | "caseId" | "status" | "evidence"> & {
  schemaVersion: "runtime_dependency_inventory_experiment.v1"; caseId: DependencyInventoryCaseId;
};
type Success = Extract<ConditionalPackageReport, { status: "observed" | "counterexample" }>;
export type DependencyInventoryReport = Common & (
  | { status: "observed"; evidence: "synthetic_fixture_observation"; bindings: Success["bindings"];
      token: 1101; diskRestored: true; plan: { sourceDigest: string; fileCount: 6 } }
  | { status: "rejected"; evidence: "unavailable"; reason: "PLAN_UNSUPPORTED" | "INVENTORY_MISMATCH"; resolved: 0; loaded: 0 }
);
function invalid(): never { throw new Error("INVALID_REPORT"); }
export function dependencyInventoryGoldenReport(caseId: DependencyInventoryCaseId): DependencyInventoryReport {
  if (!isDependencyInventoryCaseId(caseId) || ["inventory_missing", "inventory_restore_fault", "inventory_over"].includes(caseId)) invalid();
  const original = conditionalPackageGoldenReport("conditional_import");
  if (original.status === "rejected") invalid();
  const { status: _status, evidence: _evidence, bindings, token: _token, diskRestored: _disk, ...oldCommon } = original;
  const common = { ...oldCommon, schemaVersion: "runtime_dependency_inventory_experiment.v1", caseId } as const;
  if (["inventory_match", "inventory_snapshot_aba"].includes(caseId)) return { ...common, status: "observed",
    evidence: "synthetic_fixture_observation", bindings, token: 1101, diskRestored: true,
    plan: { sourceDigest: DEPENDENCY_PLAN_DIGEST, fileCount: 6 } };
  const reason = caseId.startsWith("inventory_plan_") || caseId === "inventory_reread_aba" ? "PLAN_UNSUPPORTED" : "INVENTORY_MISMATCH";
  return { ...common, status: "rejected", evidence: "unavailable", reason, resolved: 0, loaded: 0 };
}
// Maximum schema-valid canonical report, including LF, fixed before producer implementation.
export const DEPENDENCY_INVENTORY_MAX_WIRE_BYTES = 1198;
export function parseDependencyInventoryReport(bytes: Buffer, caseId: DependencyInventoryCaseId): DependencyInventoryReport {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > DEPENDENCY_INVENTORY_MAX_WIRE_BYTES) invalid();
  const expected = dependencyInventoryGoldenReport(caseId);
  if (!bytes.equals(Buffer.from(`${JSON.stringify(expected)}\n`))) invalid();
  return expected;
}
