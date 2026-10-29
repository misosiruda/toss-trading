// Test-only, fixed synthetic inventory. No caller-supplied source/path/env is executed.
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeLoadExperimentCaseId } from "./runtimeLoadExperimentProtocolTestFixtures.js";

export class RuntimeLoadExperimentPreparationError extends Error {
  constructor(readonly reason: "FIXTURE_PREPARATION_FAILED" | "BOOTSTRAP_LIMIT") {
    super(reason);
  }
}

export const RUNTIME_LOAD_EXPERIMENT_FIXTURE_PATHS = Object.freeze([
  "entry.mjs", "leaf.mjs", "entry.cjs", "leaf.cjs", "data.json", "late.mjs", "asset.txt",
  "node_modules/c2b-fixture/package.json", "node_modules/c2b-fixture/original.mjs",
  "node_modules/c2b-fixture/replacement.mjs", "package.json", "leaf.replacement.mjs",
  "leaf.replacement.cjs", "data.replacement.json", "package.replacement.json", "extra.mjs"
] as const);

type InventoryEntry = Readonly<{ path: string; source: string }>;
const failure = () => new RuntimeLoadExperimentPreparationError("FIXTURE_PREPARATION_FAILED");
const esm = (token: number) => `globalThis.__c2bEsmEvaluations=(globalThis.__c2bEsmEvaluations??0)+1;\nexport const token=${token};\nexport const identity={token};\nexport default identity;\n`;
const cjs = (token: number) => `globalThis.__c2bCjsEvaluations=(globalThis.__c2bCjsEvaluations??0)+1;\nmodule.exports={token:${token}};\n`;
const packageSource = (name: string) => JSON.stringify({ name: "c2b-fixture", exports: `./${name}.mjs`, type: "module" }) + "\n";

/** The only variation is an enumerated fixture case, never arbitrary program input. */
export function buildRuntimeLoadExperimentInventory(caseId: RuntimeLoadExperimentCaseId): readonly InventoryEntry[] {
  const sources = [
    `import value from './${caseId === "esm_cjs_first" ? "leaf.cjs" : "leaf.mjs"}';\nexport default value;\n`,
    esm(101), "module.exports=require('./leaf.cjs');\n", cjs(101), '{"token":101}\n',
    "export const token=303;\nexport default {token};\n", "asset-original",
    packageSource("original"), "export default {token:101};\n", "export default {token:202};\n",
    '{"type":"module"}\n', esm(202), cjs(202), '{"token":202}\n', packageSource("replacement"),
    "export default {token:404};\n"
  ];
  const entries: InventoryEntry[] = RUNTIME_LOAD_EXPERIMENT_FIXTURE_PATHS.map((path, index) => ({ path, source: sources[index]! }));
  const metadataFaults: Readonly<Record<string, string>> = {
    metadata_json: "{\n",
    metadata_duplicate: '{"name":"c2b-fixture","exports":"./replacement.mjs","exports":"./original.mjs","type":"module"}\n',
    metadata_unknown: '{"name":"c2b-fixture","exports":"./original.mjs","type":"module","main":"./original.mjs"}\n',
    metadata_condition: '{"name":"c2b-fixture","exports":{"import":"./original.mjs"},"type":"module"}\n',
    metadata_array: '{"name":"c2b-fixture","exports":["./original.mjs"],"type":"module"}\n',
    metadata_escape: '{"name":"c2b-fixture","exports":"../original.mjs","type":"module"}\n',
    metadata_query: '{"name":"c2b-fixture","exports":"./original.mjs?fixed","type":"module"}\n',
    metadata_format: '{"name":"c2b-fixture","exports":"./original.mjs","type":"commonjs"}\n',
    metadata_name: '{"name":"other-fixture","exports":"./original.mjs","type":"module"}\n',
    metadata_over: " ".repeat(4097),
  };
  const metadataFault = metadataFaults[caseId];
  if (metadataFault !== undefined) entries[7] = { ...entries[7]!, source: metadataFault };
  if (caseId === "cap_inventory_over") entries.push({ path: "extra-over.mjs", source: "export default 0;\n" });
  if (caseId === "cap_source" || caseId === "cap_source_over") {
    const last = entries[15]!;
    entries[15] = { ...last, source: last.source.padEnd(caseId === "cap_source" ? 4096 : 4097, " ") };
  }
  if (caseId === "cap_total" || caseId === "cap_total_over") {
    let remaining = (caseId === "cap_total" ? 32768 : 32769) - entries.reduce((sum, row) => sum + row.source.length, 0);
    for (let index = entries.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const row = entries[index]!;
      const addition = Math.min(4096 - row.source.length, remaining);
      entries[index] = { ...row, source: row.source + " ".repeat(addition) };
      remaining -= addition;
    }
    if (remaining !== 0) throw failure();
  }
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

function validateInventory(entries: readonly InventoryEntry[], caseId: RuntimeLoadExperimentCaseId): void {
  if (entries.length > 16 || new Set(entries.map((entry) => entry.path)).size !== entries.length) throw failure();
  let total = 0;
  for (const entry of entries) {
    if (!RUNTIME_LOAD_EXPERIMENT_FIXTURE_PATHS.some((path) => path === entry.path) ||
      !/^[\x00-\x7f]*$/.test(entry.source) || Buffer.byteLength(entry.source) > 4096) throw failure();
    total += Buffer.byteLength(entry.source);
  }
  // Replacement files are inventory inputs; a supplied/replaced target's second version also counts.
  if (["race_snapshot", "race_default", "chain_rewrite"].includes(caseId)) total += Buffer.byteLength(entries[11]!.source);
  if (caseId === "json_cache_source_b" || caseId === "json_fresh_b") total += Buffer.byteLength(entries[13]!.source);
  if (caseId === "metadata_default") total += Buffer.byteLength(entries[14]!.source);
  if (["metadata_snapshot_aba", "metadata_reread_aba", "metadata_restore_fault"].includes(caseId)) {
    total += Buffer.byteLength(entries[14]!.source);
  }
  if (total > 32768) throw failure();
}

async function readBootstrap(): Promise<string> {
  const path = fileURLToPath(new URL("./runtimeLoadExperimentTestChild.js", import.meta.url));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw failure();
  if (before.size > 65536) throw new RuntimeLoadExperimentPreparationError("BOOTSTRAP_LIMIT");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw failure();
    const buffer = Buffer.alloc(65537);
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, size);
      if (part.bytesRead === 0) break;
      size += part.bytesRead;
    }
    if (size > 65536) throw new RuntimeLoadExperimentPreparationError("BOOTSTRAP_LIMIT");
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (size !== before.size || after.size !== size || after.dev !== opened.dev || after.ino !== opened.ino ||
      pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino || !pathAfter.isFile() || pathAfter.nlink !== 1) throw failure();
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally {
    await handle.close();
  }
}

/** Called only with a newly owned temp directory by the test harness. */
export async function prepareRuntimeLoadExperimentFixture(caseId: RuntimeLoadExperimentCaseId, rootDir: string): Promise<string> {
  try {
    const root = await lstat(rootDir);
    if (!root.isDirectory() || root.isSymbolicLink()) throw failure();
    const inventory = buildRuntimeLoadExperimentInventory(caseId);
    validateInventory(inventory, caseId);
    let bootstrap = await readBootstrap();
    if (caseId === "cap_bootstrap" || caseId === "cap_bootstrap_over") {
      bootstrap += "\n".repeat((caseId === "cap_bootstrap" ? 65536 : 65537) - Buffer.byteLength(bootstrap));
    }
    if (Buffer.byteLength(bootstrap) > 65536) throw new RuntimeLoadExperimentPreparationError("BOOTSTRAP_LIMIT");
    for (const entry of inventory) {
      const path = join(rootDir, entry.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, entry.source, { flag: "wx", mode: 0o600 });
    }
    const bootstrapPath = join(rootDir, "bootstrap.mjs");
    await writeFile(bootstrapPath, bootstrap, { flag: "wx", mode: 0o600 });
    return bootstrapPath;
  } catch (error) {
    if (error instanceof RuntimeLoadExperimentPreparationError) throw error;
    throw failure();
  }
}
