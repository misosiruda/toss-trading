import { createHash } from "node:crypto";
import { dependencyInventoryPlan, type DependencyInventoryCaseId } from "./runtimeDependencyInventoryProtocolTestFixtures.js";
type Entry = Readonly<{ path: string; source: string }>;
export function dependencyInventoryPaths(caseId: DependencyInventoryCaseId, base: readonly string[]): string[] {
  const paths = [...base]; paths[6] = "dependency.plan.json"; paths[15] = "dependency.plan.changed.json";
  if (caseId === "inventory_extra_file") paths[5] = "node_modules/c2c-leaf/extra.mjs";
  if (caseId === "inventory_extra_package") paths[5] = "node_modules/c2c-other/extra.mjs";
  if (caseId === "inventory_extra_directory") paths[5] = "node_modules/c2c-leaf/unlisted/extra.mjs";
  return paths;
}
export function dependencyInventoryFixture(caseId: DependencyInventoryCaseId, base: readonly Entry[]): Entry[] {
  const paths = dependencyInventoryPaths(caseId, base.map((row) => row.path));
  const rows = base.map((row, i) => ({ ...row, path: paths[i]! }));
  const plan = dependencyInventoryPlan();
  const changed = plan.replace('"c2_dependency_snapshot_plan.v1"', '"c2_dependency_snapshot_plan.v2"');
  rows[6] = { ...rows[6]!, source: plan }; rows[15] = { ...rows[15]!, source: changed };
  const parsed = JSON.parse(plan) as { files: { id: string; sourceDigest: string }[] };
  const faults: Readonly<Record<string, string>> = {
    inventory_plan_json: "{\n",
    inventory_plan_duplicate: plan.replace('"files":', '"files":[],"files":'),
    inventory_plan_unknown: plan.replace('"packages":', '"unknown":false,"packages":'),
    inventory_plan_version: changed,
    inventory_plan_missing: `${JSON.stringify({ ...parsed, files: parsed.files.slice(1) })}\n`,
    inventory_plan_reorder: `${JSON.stringify({ ...parsed, files: [...parsed.files].reverse() })}\n`,
    inventory_over: " ".repeat(4097),
  };
  if (faults[caseId] !== undefined) rows[6] = { ...rows[6]!, source: faults[caseId]! };
  if (caseId === "inventory_stale_metadata") rows[0] = { ...rows[0]!, source: rows[3]!.source };
  if (caseId === "inventory_stale_selected") rows[1] = { ...rows[1]!, source: rows[2]!.source };
  if (caseId === "inventory_stale_unselected") rows[2] = { ...rows[2]!, source: "export default {token:999};\n" };
  if (caseId === "inventory_plan_rebound") {
    rows[1] = { ...rows[1]!, source: "export default {token:999};\n" };
    parsed.files.find((row) => row.id === "f02")!.sourceDigest = `sha256:${createHash("sha256").update(rows[1].source).digest("hex")}`;
    rows[6] = { ...rows[6]!, source: `${JSON.stringify(parsed)}\n` };
  }
  return caseId === "inventory_missing" ? rows.filter((_row, i) => i !== 2) : rows;
}
