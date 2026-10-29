import type { ConditionalPackageCaseId } from "./runtimeConditionalPackageProtocolTestFixtures.js";

type Entry = Readonly<{ path: string; source: string }>;
export const CONDITIONAL_PACKAGE_LEAF_PATHS = Object.freeze([
  "node_modules/c2c-leaf/package.json", "node_modules/c2c-leaf/original.mjs",
  "node_modules/c2c-leaf/replacement.mjs", "leaf.package.replacement.json",
]);
export function conditionalPackageInventory(caseId: ConditionalPackageCaseId, base: readonly Entry[]): Entry[] {
  const metadata = (name: string, replacement = false, defaultFirst = false) => `${JSON.stringify({ name,
    exports: defaultFirst ? { default: "./replacement.mjs", import: "./original.mjs" }
      : { import: replacement ? "./replacement.mjs" : "./original.mjs", default: "./replacement.mjs" }, type: "module" })}\n`;
  const rows = base.map((row) => ({ ...row }));
  const leaf = metadata("c2c-leaf", false, caseId === "conditional_leaf_default");
  const faults: Readonly<Record<string, string>> = {
    conditional_leaf_json: "{\n",
    conditional_leaf_duplicate: leaf.replace('"import":', '"import":"./replacement.mjs","import":'),
    conditional_leaf_unknown: leaf.replace('"import":', '"development":'),
    conditional_leaf_nested: leaf.replace('"./original.mjs"', '{"node":"./original.mjs"}'),
    conditional_leaf_array: leaf.replace('"./original.mjs"', '["./original.mjs"]'),
    conditional_leaf_escape: leaf.replace('"./original.mjs"', '"../original.mjs"'),
    conditional_leaf_name: leaf.replace('"c2c-leaf"', '"other-leaf"'),
    conditional_leaf_mixed: leaf.replace('"import":', '".":'),
    conditional_over: " ".repeat(4097),
  };
  const leafSources = [faults[caseId] ?? leaf, "export default {token:101};\n",
    "export default {token:202};\n", metadata("c2c-leaf", true)];
  for (let i = 0; i < 4; i += 1) rows[i] = { path: CONDITIONAL_PACKAGE_LEAF_PATHS[i]!, source: leafSources[i]! };
  rows[7] = { ...rows[7]!, source: caseId === "conditional_root_shape" ? '{"name":"c2b-fixture","exports":"./original.mjs","type":"module"}\n'
    : metadata("c2b-fixture", false, caseId === "conditional_root_default") };
  const specifier = caseId === "conditional_unknown_package" ? "c2c-other" : caseId === "conditional_subpath" ? "c2c-leaf/extra" : "c2c-leaf";
  const attributes = caseId === "conditional_attribute" ? " with { unsupported: 'fixed' }" : "";
  for (const [index, amount] of [[8, 1000], [9, 2000]] as const) rows[index] = { ...rows[index]!,
    source: `import value from '${specifier}'${attributes};\nexport default {token:value.token+${amount}};\n` };
  rows[14] = { ...rows[14]!, source: metadata("c2b-fixture", true) };
  return rows;
}
