// Test-only trusted bootstrap. Its emitted JS is copied into a parent-owned temp root.
// Only built-ins are imported statically; every application load below is a fixed fixture.
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, ftruncateSync, linkSync, lstatSync, openSync,
  readSync, realpathSync, symlinkSync, unlinkSync, writeFileSync, writeSync,
  type Stats,
} from "node:fs";
import { createRequire, registerHooks, type ModuleHooks } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CONDITIONAL_CASE_IDS = [
  "conditional_import", "conditional_root_default", "conditional_leaf_default",
  "conditional_snapshot_aba", "conditional_reread_aba", "conditional_leaf_json",
  "conditional_leaf_duplicate", "conditional_leaf_unknown", "conditional_leaf_nested",
  "conditional_leaf_array", "conditional_leaf_escape", "conditional_leaf_name", "conditional_leaf_mixed",
  "conditional_root_shape", "conditional_conditions_extra", "conditional_conditions_missing",
  "conditional_conditions_duplicate", "conditional_direct_leaf", "conditional_attribute",
  "conditional_unknown_package", "conditional_subpath", "conditional_restore_fault", "conditional_over",
] as const;
const METADATA_CASE_IDS = [
  "metadata_snapshot", "metadata_snapshot_aba", "metadata_reread_aba",
  "metadata_json", "metadata_duplicate", "metadata_unknown", "metadata_condition", "metadata_array",
  "metadata_escape", "metadata_query", "metadata_format", "metadata_name", "metadata_parent",
  "metadata_attribute", "metadata_subpath", "metadata_restore_fault", "metadata_over",
] as const;
const CASE_IDS = [
  ...CONDITIONAL_CASE_IDS,
  ...METADATA_CASE_IDS,
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
] as const;
type CaseId = typeof CASE_IDS[number];
type FileId = "f01" | "f02" | "f03" | "f04" | "f05" | "f06" | "f07" | "f08"
  | "f09" | "f10" | "f11" | "f12" | "f13" | "f14" | "f15" | "f16";
type Format = "module" | "commonjs" | "json";
type ParentId = "bootstrap" | FileId;
type Reason = "MAPPING_UNSUPPORTED" | "QUERY_UNSUPPORTED" | "ATTRIBUTE_UNSUPPORTED" | "FORMAT_UNSUPPORTED"
  | "PATH_UNSAFE" | "INVENTORY_LIMIT" | "SOURCE_LIMIT" | "TOTAL_SOURCE_LIMIT" | "EVENT_LIMIT" | "LOAD_CLOSED"
  | "METADATA_UNSUPPORTED" | "CONDITIONS_UNSUPPORTED";
type Observation = "REGISTRATION_PRECEDES_LOAD" | "LATE_REGISTRATION_MISSED" | "ORIGINAL_VALUE"
  | "REPLACEMENT_VALUE" | "SAME_OBJECT" | "EVALUATED_ONCE" | "CACHE_CALLBACK_ABSENT" | "SUPPLIED_SOURCE_UNUSED"
  | "LATE_LOAD_RECORDED" | "CLOSED_CACHE_UNOBSERVED" | "CHAIN_BYPASS_OBSERVED" | "CHAIN_REWRITE_OBSERVED"
  | "METADATA_BYTES_UNAVAILABLE" | "ASSET_READ_UNOBSERVED";
type Event =
  | { kind: "resolve"; fileId: FileId; parentId: ParentId; route: "snapshot" | "delegated" }
  | { kind: "load"; fileId: FileId; format: Format; sourceDigest: string; supply: "snapshot" | "delegated" };
interface Snapshot {
  readonly id: FileId;
  readonly path: string;
  readonly url: string;
  readonly source: string;
  readonly digest: string;
  readonly identity: Stats;
  readonly format: Format | null;
}
const INVENTORY: readonly (readonly [FileId, string, Format | null])[] = [
  ["f01", "entry.mjs", "module"], ["f02", "leaf.mjs", "module"],
  ["f03", "entry.cjs", "commonjs"], ["f04", "leaf.cjs", "commonjs"],
  ["f05", "data.json", "json"], ["f06", "late.mjs", "module"], ["f07", "asset.txt", null],
  ["f08", "node_modules/c2b-fixture/package.json", null],
  ["f09", "node_modules/c2b-fixture/original.mjs", "module"],
  ["f10", "node_modules/c2b-fixture/replacement.mjs", "module"], ["f11", "package.json", null],
  // Replacement files are fixed version inputs, never executable registry destinations.
  ["f12", "leaf.replacement.mjs", null], ["f13", "leaf.replacement.cjs", null],
  ["f14", "data.replacement.json", null], ["f15", "package.replacement.json", null],
  ["f16", "extra.mjs", "module"],
];
class Rejection extends Error {
  readonly reason: Reason;
  constructor(reason: Reason) { super(reason); this.reason = reason; }
}
function check(condition: unknown): asserts condition {
  // This message and every other exception are swallowed at the process boundary.
  if (!condition) throw new Error("FIXTURE_ASSERTION_FAILED");
}
function reject(reason: Reason): never { throw new Rejection(reason); }
function digest(source: string): string { return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`; }
function sameIdentity(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function regularFile(stat: Stats): boolean { return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1; }
function ascii(bytes: Uint8Array): string {
  if (bytes.length > 4_096) reject("SOURCE_LIMIT");
  if (!bytes.every((value) => value < 128)) reject("PATH_UNSAFE");
  return Buffer.from(bytes).toString("ascii");
}
function common(caseId: CaseId) {
  return {
    schemaVersion: "runtime_load_experiment.v1", caseId,
    runtime: "unavailable", dependencies: "unavailable", result: "unavailable", comparability: "unavailable",
    completeRuntime: false, completeConfiguration: false, completeInput: false,
  } as const;
}
function observed(caseId: CaseId, counterexample: boolean, events: Event[], observations: Observation[]) {
  return { ...common(caseId), status: counterexample ? "counterexample" : "observed",
    evidence: "synthetic_fixture_observation", events, observations } as const;
}
function writeOutput(fd: 1 | 2, value: string | Buffer): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(fd, bytes, offset, bytes.length - offset);
    check(count > 0);
    offset += count;
  }
}
function emit(report: unknown): void { writeOutput(1, `${JSON.stringify(report)}\n`); }
// Private helper: all callers below use repository-fixed literals, never user source or a caller path.
async function importFixed(specifier: string, options?: ImportCallOptions): Promise<{ default: unknown }> {
  return import(specifier, options);
}
function rejected(caseId: CaseId, reason: Reason): void {
  emit({ ...common(caseId), status: "rejected", evidence: "unavailable", reason });
}

// Transport fixtures deliberately do not claim module observations. Bytes are fixed, non-private filler.
function runTransport(caseId: CaseId): boolean {
  if (!caseId.startsWith("transport_")) return false;
  const report = observed(caseId, false, [], []);
  const wire = `${JSON.stringify(report)}\n`;
  switch (caseId) {
    case "transport_valid": emit(report); break;
    case "transport_empty": break;
    case "transport_truncated": writeOutput(1, wire.slice(0, -2)); break;
    case "transport_multiple": writeOutput(1, wire + wire); break;
    case "transport_unknown_key": emit({ ...report, unexpected: false }); break;
    case "transport_case_mismatch": emit({ ...report, caseId: "transport_valid" }); break;
    case "transport_stdout": writeOutput(1, Buffer.alloc(32_768, 120)); break;
    case "transport_stdout_over": writeOutput(1, Buffer.alloc(32_769, 120)); break;
    case "transport_stderr": writeOutput(2, Buffer.alloc(4_096, 120)); emit(report); break;
    case "transport_stderr_over": writeOutput(2, Buffer.alloc(4_097, 120)); emit(report); break;
    case "transport_exit": emit(report); process.exitCode = 1; break;
    case "transport_signal": process.kill(process.pid, "SIGTERM"); break;
    case "transport_timeout": setInterval(() => {}, 1_000); break;
    default: check(false);
  }
  return true;
}

async function experiment(caseId: CaseId): Promise<void> {
  const root = process.cwd();
  const rootIdentity = lstatSync(root);
  const bootstrapUrl = pathToFileURL(join(root, "bootstrap.mjs")).href;
  check(import.meta.url === bootstrapUrl && rootIdentity.isDirectory() && !rootIdentity.isSymbolicLink()
    && realpathSync(root) === root);
  const snapshots = new Map<FileId, Snapshot>();
  const paths = new Set<string>();
  const fileIdentities = new Set<string>();
  let totalBytes = 0;
  function checkRoot(): void {
    const now = lstatSync(root);
    if (!now.isDirectory() || now.isSymbolicLink() || !sameIdentity(rootIdentity, now)
      || realpathSync(root) !== root) reject("PATH_UNSAFE");
  }
  function checkAncestors(path: string): void {
    checkRoot();
    let directory = dirname(path);
    while (directory !== root) {
      if (!directory.startsWith(`${root}/`)) reject("PATH_UNSAFE");
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) reject("PATH_UNSAFE");
      directory = dirname(directory);
    }
  }
  function boundedRead(path: string): { source: string; identity: Stats } {
    checkAncestors(path);
    const before = lstatSync(path);
    if (!regularFile(before) || realpathSync(path) !== path) reject("PATH_UNSAFE");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (!regularFile(opened) || !sameIdentity(before, opened)) reject("PATH_UNSAFE");
      const bytes = Buffer.alloc(4_097);
      let used = 0;
      while (used < bytes.length) {
        const count = readSync(fd, bytes, used, bytes.length - used, used);
        if (count === 0) break;
        used += count;
      }
      if (used > 4_096) reject("SOURCE_LIMIT");
      const after = fstatSync(fd);
      const finalPath = lstatSync(path);
      if (!regularFile(after) || !regularFile(finalPath) || !sameIdentity(opened, after)
        || !sameIdentity(opened, finalPath) || opened.size !== after.size || after.size !== used
        || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) reject("PATH_UNSAFE");
      checkAncestors(path);
      return { source: ascii(bytes.subarray(0, used)), identity: after };
    } finally { closeSync(fd); }
  }
  const conditional = CONDITIONAL_CASE_IDS.some((id) => id === caseId);
  const inventory: typeof INVENTORY = conditional ? [
    ["f01", "node_modules/c2c-leaf/package.json", null], ["f02", "node_modules/c2c-leaf/original.mjs", "module"],
    ["f03", "node_modules/c2c-leaf/replacement.mjs", "module"], ["f04", "leaf.package.replacement.json", null],
    ...INVENTORY.slice(4),
  ] : INVENTORY;
  for (const [id, relative, format] of inventory) {
    if (snapshots.size >= 16) reject("INVENTORY_LIMIT");
    const path = join(root, relative);
    if (paths.has(path)) reject("PATH_UNSAFE");
    const { source, identity } = boundedRead(path);
    const identityKey = `${identity.dev}:${identity.ino}`;
    if (fileIdentities.has(identityKey)) reject("PATH_UNSAFE");
    totalBytes += Buffer.byteLength(source, "utf8");
    if (totalBytes > 32_768) reject("TOTAL_SOURCE_LIMIT");
    paths.add(path);
    fileIdentities.add(identityKey);
    snapshots.set(id, Object.freeze({ id, path, url: pathToFileURL(path).href, source,
      digest: digest(source), identity, format }));
  }
  function snap(id: FileId): Snapshot { const value = snapshots.get(id); check(value); return value; }
  function replace(id: FileId, replacement: FileId): void {
    const target = snap(id);
    checkAncestors(target.path);
    const before = lstatSync(target.path);
    if (!regularFile(before) || !sameIdentity(before, target.identity)) reject("PATH_UNSAFE");
    const fd = openSync(target.path, constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(fd);
      if (!regularFile(opened) || !sameIdentity(opened, before)) reject("PATH_UNSAFE");
      ftruncateSync(fd, 0);
      writeFileSync(fd, snap(replacement).source, "utf8");
    } finally { closeSync(fd); }
    check(boundedRead(target.path).source === snap(replacement).source);
  }
  async function expectRejection(action: () => unknown | Promise<unknown>, reason: Reason): Promise<void> {
    let actual: Reason | null = null;
    try { await action(); } catch (error) { if (error instanceof Rejection) actual = error.reason; else throw error; }
    check(actual === reason);
  }
  if (caseId === "reject_alias") {
    const target = snap("f02");
    const other = snap("f16");
    // Two bounded known-path faults, without creating a seventeenth inventory path.
    unlinkSync(target.path);
    symlinkSync(other.path, target.path);
    await expectRejection(() => boundedRead(target.path), "PATH_UNSAFE");
    unlinkSync(target.path);
    writeFileSync(target.path, target.source, { encoding: "utf8", flag: "wx" });
    check(boundedRead(target.path).source === target.source);
    unlinkSync(target.path);
    linkSync(other.path, target.path);
    await expectRejection(() => boundedRead(target.path), "PATH_UNSAFE");
    unlinkSync(target.path);
    writeFileSync(target.path, target.source, { encoding: "utf8", flag: "wx" });
    check(boundedRead(other.path).source === other.source && boundedRead(target.path).source === target.source);
    rejected(caseId, "PATH_UNSAFE");
    return;
  }
  // Count the target's extra version as well as the separate fixed replacement input.
  if (["race_snapshot", "race_default", "chain_rewrite"].includes(caseId)) totalBytes += snap("f12").source.length;
  if (caseId === "json_cache_source_b" || caseId === "json_fresh_b") totalBytes += snap("f14").source.length;
  if (caseId === "metadata_default") totalBytes += snap("f15").source.length;
  if (["metadata_snapshot_aba", "metadata_reread_aba", "metadata_restore_fault"].includes(caseId)) {
    totalBytes += snap("f15").source.length;
  }
  if (["conditional_snapshot_aba", "conditional_reread_aba", "conditional_restore_fault"].includes(caseId)) {
    totalBytes += snap("f15").source.length + snap("f04").source.length;
  }
  if (totalBytes > 32_768) reject("TOTAL_SOURCE_LIMIT");
  check(snapshots.size === 16);
  if (caseId === "cap_inventory") check(paths.size === 16);
  if (caseId === "cap_source") check([...snapshots.values()].some((item) => item.source.length === 4_096));
  if (caseId === "cap_total") check(totalBytes === 32_768);

  if (conditional) {
    const bindings: { metadataId: FileId; parentId: "bootstrap" | FileId; conditions: string[];
      metadataDigest: string; target: FileId; selectedCondition: string; consumption: "snapshot" | "reread";
      sourceDigest: string }[] = [];
    const ownedHooks: ModuleHooks[] = [];
    const reread = caseId === "conditional_reread_aba";
    let rootTarget: Snapshot | null = null;
    let pending: { module: Snapshot; binding: Omit<typeof bindings[number], "sourceDigest"> } | null = null;
    let resolved = 0;
    let resultToken: number | null = null;
    let rejection: Reason | null = null;
    let changed = false;
    const conditions = (input: readonly string[]): string[] => {
      const values = [...input].sort();
      if (JSON.stringify(values) !== '["import","module-sync","node","node-addons"]') reject("CONDITIONS_UNSUPPORTED");
      return values;
    };
    try {
      if (["conditional_snapshot_aba", "conditional_reread_aba", "conditional_restore_fault"].includes(caseId)) {
        replace("f08", "f15"); replace("f01", "f04"); changed = true;
      }
      ownedHooks.push(registerHooks({
        resolve(specifier, context) {
          const rootRequest = resolved === 0 && specifier === "c2b-fixture" && context.parentURL === bootstrapUrl;
          const leafRequest = resolved === 1 && bindings.length === 1 && specifier === "c2c-leaf"
            && rootTarget !== null && context.parentURL === rootTarget.url;
          if ((!rootRequest && !leafRequest) || pending !== null) reject("MAPPING_UNSUPPORTED");
          const active = conditions(context.conditions);
          attributes(context.importAttributes, "module");
          const metadataId = rootRequest ? "f08" : "f01";
          const source = reread ? boundedRead(snap(metadataId).path).source : snap(metadataId).source;
          let parsed: unknown;
          try { parsed = JSON.parse(source); } catch { reject("METADATA_UNSUPPORTED"); }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) reject("METADATA_UNSUPPORTED");
          const value = parsed as Record<string, unknown>;
          if (JSON.stringify(Object.keys(value)) !== '["name","exports","type"]'
            || `${JSON.stringify(value)}\n` !== source || value.name !== (rootRequest ? "c2b-fixture" : "c2c-leaf")
            || value.type !== "module" || typeof value.exports !== "object" || value.exports === null
            || Array.isArray(value.exports)) reject("METADATA_UNSUPPORTED");
          const exports = value.exports as Record<string, unknown>;
          const keys = Object.keys(exports);
          if (![ '["import","default"]', '["default","import"]' ].includes(JSON.stringify(keys))
            || Object.values(exports).some((target) => target !== "./original.mjs" && target !== "./replacement.mjs")) {
            reject("METADATA_UNSUPPORTED");
          }
          const selectedCondition = keys.find((key) => key === "default" || active.includes(key));
          check(selectedCondition !== undefined);
          const replacement = exports[selectedCondition] === "./replacement.mjs";
          const target = rootRequest ? replacement ? "f10" : "f09" : replacement ? "f03" : "f02";
          const module = snap(target);
          pending = { module, binding: { metadataId, parentId: rootRequest ? "bootstrap" : rootTarget!.id,
            conditions: active, metadataDigest: digest(source), target, selectedCondition,
            consumption: reread ? "reread" : "snapshot" } };
          if (rootRequest) rootTarget = module;
          resolved += 1;
          return { url: module.url, format: "module", shortCircuit: true };
        },
        load(url, context) {
          if (pending === null || url !== pending.module.url || bindings.length + 1 !== resolved) reject("MAPPING_UNSUPPORTED");
          conditions(context.conditions);
          attributes(context.importAttributes, "module");
          if (context.format !== "module") reject("FORMAT_UNSUPPORTED");
          const module = pending.module;
          check(digest(module.source) === module.digest);
          bindings.push({ ...pending.binding, sourceDigest: module.digest }); pending = null;
          return { format: "module", source: module.source, shortCircuit: true };
        },
      }));
      if (caseId.startsWith("conditional_conditions_")) ownedHooks.push(registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier !== "c2c-leaf") return nextResolve(specifier, context);
          // Fixed hook-chain faults, not observations of altered OS startup settings.
          const changedConditions = caseId === "conditional_conditions_extra" ? [...context.conditions, "unsupported"]
            : caseId === "conditional_conditions_missing" ? context.conditions.filter((key) => key !== "import")
            : [...context.conditions, "import"];
          return nextResolve(specifier, { ...context, conditions: changedConditions });
        },
      }));
      resultToken = token((await importFixed(caseId === "conditional_direct_leaf" ? "c2c-leaf" : "c2b-fixture")).default);
      const expected = (reread || caseId === "conditional_root_default" ? 2000 : 1000)
        + (reread || caseId === "conditional_leaf_default" ? 202 : 101);
      check(resolved === 2 && bindings.length === 2 && pending === null && resultToken === expected);
    } catch (error) {
      if (!(error instanceof Rejection) || !["MAPPING_UNSUPPORTED", "METADATA_UNSUPPORTED",
        "CONDITIONS_UNSUPPORTED", "ATTRIBUTE_UNSUPPORTED"].includes(error.reason)) throw error;
      rejection = error.reason;
    } finally {
      for (const hook of ownedHooks.reverse()) hook.deregister();
      if (changed) {
        replace("f08", "f08");
        if (caseId !== "conditional_restore_fault") replace("f01", "f01");
      }
      for (const id of ["f08", "f01"] as const) check(boundedRead(snap(id).path).source === snap(id).source);
    }
    const envelope = { ...common(caseId), schemaVersion: "runtime_conditional_package_experiment.v1" };
    if (rejection !== null) emit({ ...envelope, status: "rejected", evidence: "unavailable", reason: rejection,
      resolved, loaded: bindings.length });
    else emit({ ...envelope, status: reread ? "counterexample" : "observed", evidence: "synthetic_fixture_observation",
      bindings, token: resultToken, diskRestored: true });
    return;
  }

  if (METADATA_CASE_IDS.some((id) => id === caseId)) {
    // A closed flat-exports subset, not a general Node/package resolver. The immutable string
    // read here is the exact JSON parser input; no filesystem metadata fallback is used.
    const metadataSource = snap("f08").source;
    const metadataEvents: Event[] = [];
    const ownedHooks: ModuleHooks[] = [];
    let binding: { sourceDigest: string; target: "f09" | "f10"; consumption: "snapshot" | "reread";
      diskRestored: true } | null = null;
    let chosen: Snapshot | null = null;
    let rejection: Reason | null = null;
    let changed = false;
    const reread = caseId === "metadata_reread_aba";
    try {
      if (["metadata_snapshot_aba", "metadata_reread_aba", "metadata_restore_fault"].includes(caseId)) {
        replace("f08", "f15"); changed = true;
      }
      ownedHooks.push(registerHooks({
        resolve(specifier, context) {
          if (specifier !== "c2b-fixture" || context.parentURL !== bootstrapUrl || metadataEvents.length !== 0) {
            reject("MAPPING_UNSUPPORTED");
          }
          attributes(context.importAttributes, "module");
          const source = reread ? boundedRead(snap("f08").path).source : metadataSource;
          let parsed: unknown;
          try { parsed = JSON.parse(source); } catch { reject("METADATA_UNSUPPORTED"); }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) reject("METADATA_UNSUPPORTED");
          const value = parsed as Record<string, unknown>;
          if (JSON.stringify(Object.keys(value)) !== '["name","exports","type"]'
            || `${JSON.stringify(value)}\n` !== source || value.name !== "c2b-fixture" || value.type !== "module"
            || (value.exports !== "./original.mjs" && value.exports !== "./replacement.mjs")) reject("METADATA_UNSUPPORTED");
          const target = value.exports === "./original.mjs" ? "f09" : "f10";
          chosen = snap(target);
          binding = { sourceDigest: digest(source), target, consumption: reread ? "reread" : "snapshot", diskRestored: true };
          metadataEvents.push({ kind: "resolve", fileId: target, parentId: "bootstrap", route: "snapshot" });
          return { url: chosen.url, format: "module", shortCircuit: true };
        },
        load(url, context) {
          if (chosen === null || url !== chosen.url || metadataEvents.length !== 1) reject("MAPPING_UNSUPPORTED");
          attributes(context.importAttributes, "module");
          if (context.format !== "module") reject("FORMAT_UNSUPPORTED");
          check(digest(chosen.source) === chosen.digest);
          metadataEvents.push({ kind: "load", fileId: chosen.id, format: "module", sourceDigest: chosen.digest, supply: "snapshot" });
          return { format: "module", source: chosen.source, shortCircuit: true };
        },
      }));
      if (caseId === "metadata_parent") {
        // Fixed fault in the actual resolve chain; this does not claim a genuine second caller.
        ownedHooks.push(registerHooks({ resolve(specifier, context, nextResolve) {
          return nextResolve(specifier, { ...context, parentURL: snap("f01").url });
        } }));
      }
      const value = (await importFixed(caseId === "metadata_subpath" ? "c2b-fixture/extra" : "c2b-fixture",
        caseId === "metadata_attribute" ? { with: { unsupported: "fixed" } } : undefined)).default;
      check(binding !== null && metadataEvents.length === 2 && token(value) === (reread ? 202 : 101));
    } catch (error) {
      if (!(error instanceof Rejection) || !["METADATA_UNSUPPORTED", "MAPPING_UNSUPPORTED", "ATTRIBUTE_UNSUPPORTED"].includes(error.reason)) throw error;
      check(metadataEvents.length === 0 && binding === null);
      rejection = error.reason;
    } finally {
      for (const hook of ownedHooks.reverse()) hook.deregister();
      if (changed && caseId !== "metadata_restore_fault") replace("f08", "f08");
      // A failed restoration prevents any report, even when import succeeded.
      check(boundedRead(snap("f08").path).source === metadataSource);
    }
    const envelope = { ...common(caseId), schemaVersion: "runtime_package_metadata_experiment.v1" };
    if (rejection !== null) emit({ ...envelope, status: "rejected", evidence: "unavailable", reason: rejection });
    else emit({ ...envelope, status: reread ? "counterexample" : "observed", evidence: "synthetic_fixture_observation",
      metadata: binding, events: metadataEvents, observations: [reread ? "REPLACEMENT_VALUE" : "ORIGINAL_VALUE"] });
    return;
  }

  const events: Event[] = [];
  const observations: Observation[] = [];
  const hooks: ModuleHooks[] = [];
  let closed = false;
  let registered = false;
  let callbackCount = 0;
  let jsonB = caseId === "json_fresh_b";
  const globals = globalThis as typeof globalThis & { __c2bEsmEvaluations?: number; __c2bCjsEvaluations?: number };
  const esmEvaluations = (): number => globals.__c2bEsmEvaluations ?? 0;
  const cjsEvaluations = (): number => globals.__c2bCjsEvaluations ?? 0;
  check(esmEvaluations() === 0 && cjsEvaluations() === 0);
  const require = createRequire(bootstrapUrl);
  function note(observation: Observation, condition: unknown): void {
    check(condition);
    if (!observations.includes(observation)) observations.push(observation);
    check(observations.length <= 16);
  }
  function record(event: Event): void {
    // Count only real callbacks, including the rejected 129th one; never invent a load.
    callbackCount += 1;
    if (events.length >= 128) reject("EVENT_LIMIT");
    events.push(event);
  }
  function parentId(url: string | undefined): ParentId {
    if (url === bootstrapUrl) return "bootstrap";
    const item = [...snapshots.values()].find((candidate) => candidate.url === url && candidate.format !== null);
    if (!item) reject("MAPPING_UNSUPPORTED");
    return item.id;
  }
  function attributes(value: unknown, format: Format): void {
    // Node 24.19.0's CJS hooks pass undefined although the installed type declares an object.
    if (value === undefined) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) reject("ATTRIBUTE_UNSUPPORTED");
    const attributes = value as Record<string, unknown>;
    const keys = Object.keys(attributes);
    if (keys.length === 0) return;
    if (format !== "json" || keys.length !== 1 || keys[0] !== "type" || attributes.type !== "json") {
      reject("ATTRIBUTE_UNSUPPORTED");
    }
  }
  function mapped(specifier: string, parent: ParentId): Snapshot {
    if (specifier.includes("?") || specifier.includes("#")) reject("QUERY_UNSUPPORTED");
    // Exact caller + specifier registry. Canonical URLs are allowed only for bootstrap-owned imports.
    const bootstrapIds: readonly FileId[] = ["f01", "f02", "f03", "f04", "f05", "f06", "f16"];
    let item: Snapshot | undefined;
    if (parent === "bootstrap") {
      item = bootstrapIds.map(snap).find((candidate) => specifier === candidate.url
        || specifier === `./${candidate.path.slice(root.length + 1)}`);
    } else if (parent === "f01") {
      const expected = caseId === "esm_cjs_first" ? snap("f04") : snap("f02");
      if (specifier === (caseId === "esm_cjs_first" ? "./leaf.cjs" : "./leaf.mjs")) item = expected;
    } else if (parent === "f03" && specifier === "./leaf.cjs") item = snap("f04");
    if (!item || item.format === null) reject("MAPPING_UNSUPPORTED");
    return item;
  }
  function loadTarget(url: string): Snapshot {
    if (url.includes("?") || url.includes("#")) reject("QUERY_UNSUPPORTED");
    const item = [...snapshots.values()].find((candidate) => candidate.url === url && candidate.format !== null);
    if (!item || ((item.id === "f09" || item.id === "f10") && caseId !== "metadata_default")) {
      reject("MAPPING_UNSUPPORTED");
    }
    return item;
  }
  function defaultSource(source: unknown): string {
    if (typeof source === "string") {
      if (Buffer.byteLength(source, "utf8") > 4_096) reject("SOURCE_LIMIT");
      if (!/^[\x00-\x7f]*$/.test(source)) reject("PATH_UNSAFE");
      return source;
    }
    if (ArrayBuffer.isView(source)) return ascii(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    if (source instanceof ArrayBuffer) return ascii(new Uint8Array(source));
    check(false);
  }
  function registerObserver(): ModuleHooks {
    check(!registered);
    registered = true;
    const hook = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (closed) reject("LOAD_CLOSED");
        const parent = parentId(context.parentURL);
        if (caseId === "metadata_default" && parent === "bootstrap" && specifier === "c2b-fixture") {
          attributes(context.importAttributes, "module");
          // This one negative delegates only the fixed local package. Default resolution is not evidence
          // of which package metadata bytes Node consumed. An out-of-inventory result is never loaded.
          const result = nextResolve(specifier, context);
          const item = [snap("f09"), snap("f10")].find((candidate) => candidate.url === result.url);
          if (!item) reject("MAPPING_UNSUPPORTED");
          if (result.format != null && result.format !== "module") reject("FORMAT_UNSUPPORTED");
          record({ kind: "resolve", fileId: item.id, parentId: parent, route: "delegated" });
          return result;
        }
        const item = mapped(specifier, parent);
        check(item.format !== null);
        attributes(context.importAttributes, item.format);
        record({ kind: "resolve", fileId: item.id, parentId: parent, route: "snapshot" });
        return { url: item.url, format: item.format, shortCircuit: true };
      },
      load(url, context, nextLoad) {
        if (closed) reject("LOAD_CLOSED");
        const item = loadTarget(url);
        check(item.format !== null);
        attributes(context.importAttributes, item.format);
        if (context.format != null && context.format !== item.format) reject("FORMAT_UNSUPPORTED");
        if ((caseId === "race_default" && item.id === "f02")
          || (caseId === "metadata_default" && (item.id === "f09" || item.id === "f10"))) {
          const result = nextLoad(url, { ...context, format: item.format });
          if (result.format !== item.format) reject("FORMAT_UNSUPPORTED");
          const source = defaultSource(result.source);
          record({ kind: "load", fileId: item.id, format: item.format, sourceDigest: digest(source), supply: "delegated" });
          return result;
        }
        const source = item.id === "f05" && jsonB ? snap("f14") : item;
        check(digest(source.source) === source.digest);
        record({ kind: "load", fileId: item.id, format: item.format, sourceDigest: source.digest, supply: "snapshot" });
        return { format: item.format, source: source.source, shortCircuit: true };
      },
    });
    hooks.push(hook);
    return hook;
  }
  function token(value: unknown): number | null {
    return typeof value === "object" && value !== null && "token" in value && typeof value.token === "number"
      ? value.token : null;
  }
  function original(value: unknown): void { note("ORIGINAL_VALUE", token(value) === 101); }
  function replacement(value: unknown): void { note("REPLACEMENT_VALUE", token(value) === 202); }
  function loadCount(): number { return events.filter((event) => event.kind === "load").length; }
  function supplied(id: FileId, source: FileId = id): boolean {
    return events.some((event) => event.kind === "load" && event.fileId === id && event.sourceDigest === snap(source).digest);
  }
  function firstLoad(id: FileId): void {
    const resolution = events.findIndex((event) => event.kind === "resolve" && event.fileId === id);
    const loading = events.findIndex((event) => event.kind === "load" && event.fileId === id);
    note("REGISTRATION_PRECEDES_LOAD", registered && supplied(id) && resolution >= 0 && resolution < loading);
  }
  const importEsm = async (): Promise<unknown> => (await importFixed("./entry.mjs")).default;
  const importJson = async (): Promise<unknown> => (await importFixed("./data.json", { with: { type: "json" } })).default;
  let isCounterexample = false;
  try {
    if (caseId === "late_registration") {
      const first: unknown = require("./leaf.cjs");
      check(cjsEvaluations() === 1 && events.length === 0);
      registerObserver();
      const second: unknown = require("./leaf.cjs");
      original(first);
      note("SAME_OBJECT", first === second);
      note("EVALUATED_ONCE", cjsEvaluations() === 1);
      note("LATE_REGISTRATION_MISSED", events.length === 0 && callbackCount === 0);
      note("CACHE_CALLBACK_ABSENT", events.length === 0);
      isCounterexample = true;
    } else {
      if (caseId === "race_snapshot" || caseId === "race_default") {
        check(snap("f02").digest !== snap("f12").digest);
        replace("f02", "f12");
      }
      if (caseId === "metadata_default") {
        check(snap("f08").digest !== snap("f15").digest);
        replace("f08", "f15");
      }
      const observer = registerObserver();
      switch (caseId) {
        case "esm_first": case "cap_inventory": case "cap_source": case "cap_total": case "cap_bootstrap": {
          const value = await importEsm(); original(value); firstLoad("f02");
          note("EVALUATED_ONCE", esmEvaluations() === 1);
          if (caseId === "cap_source") {
            const maximum = (await importFixed("./extra.mjs")).default;
            check(snap("f16").source.length === 4_096 && token(maximum) === 404 && supplied("f16"));
          }
          break;
        }
        case "cjs_first": {
          const value: unknown = require("./entry.cjs"); original(value); firstLoad("f04");
          note("EVALUATED_ONCE", cjsEvaluations() === 1); break;
        }
        case "esm_cjs_first": {
          const value = await importEsm(); original(value); firstLoad("f04");
          note("EVALUATED_ONCE", cjsEvaluations() === 1 && esmEvaluations() === 0); break;
        }
        case "json_import_first": { original(await importJson()); firstLoad("f05"); break; }
        case "json_require_first": { original(require("./data.json")); firstLoad("f05"); break; }
        case "json_fresh_b": {
          const value = await importJson(); replacement(value);
          note("REGISTRATION_PRECEDES_LOAD", registered && supplied("f05", "f14") && !supplied("f05"));
          check(snap("f05").digest !== snap("f14").digest); break;
        }
        case "esm_cache": {
          const first = await importEsm(); const loads = loadCount(); const second = await importEsm();
          original(first); firstLoad("f02"); note("SAME_OBJECT", first === second);
          note("EVALUATED_ONCE", esmEvaluations() === 1);
          // Resolution may repeat. This observation concerns absence of the cached graph's load callback.
          note("CACHE_CALLBACK_ABSENT", loads > 0 && loadCount() === loads); break;
        }
        case "cjs_cache": {
          const first: unknown = require("./entry.cjs"); const count = events.length;
          const second: unknown = require("./entry.cjs");
          original(first); firstLoad("f04"); note("SAME_OBJECT", first === second);
          note("EVALUATED_ONCE", cjsEvaluations() === 1);
          note("CACHE_CALLBACK_ABSENT", count > 0 && events.length === count); break;
        }
        case "json_import_require": {
          const first = await importJson(); const loads = loadCount(); const second: unknown = require("./data.json");
          original(first); firstLoad("f05"); note("SAME_OBJECT", first === second);
          note("CACHE_CALLBACK_ABSENT", loads > 0 && loadCount() === loads); break;
        }
        case "json_require_import": {
          const first: unknown = require("./data.json"); const second = await importJson();
          original(first); original(second); firstLoad("f05"); note("SAME_OBJECT", first === second); break;
        }
        case "json_cache_source_b": {
          const first: unknown = require("./data.json");
          original(first); firstLoad("f05"); check(supplied("f05") && !supplied("f05", "f14"));
          jsonB = true;
          const before = events.length;
          const second = await importJson();
          original(second); note("SAME_OBJECT", first === second);
          note("SUPPLIED_SOURCE_UNUSED", snap("f05").digest !== snap("f14").digest && token(second) === 101
            && second === first && events.slice(before).some((event) => event.kind === "load"
              && event.fileId === "f05" && event.sourceDigest === snap("f14").digest && event.supply === "snapshot"));
          isCounterexample = true; break;
        }
        case "late_new": {
          // The first fixture runner has returned before this separate, explicitly awaited load.
          const value = await importEsm(); original(value); firstLoad("f02");
          const before = events.length;
          await Promise.resolve();
          const late = (await importFixed("./late.mjs")).default;
          note("LATE_LOAD_RECORDED", token(late) === 303 && events.slice(before)
            .some((event) => event.kind === "load" && event.fileId === "f06" && event.sourceDigest === snap("f06").digest));
          break;
        }
        case "closed_new": {
          original(await importEsm()); closed = true;
          await expectRejection(() => importFixed("./late.mjs"), "LOAD_CLOSED");
          rejected(caseId, "LOAD_CLOSED"); return;
        }
        case "closed_cached": {
          const first: unknown = require("./leaf.cjs"); const count = events.length; closed = true;
          const second: unknown = require("./leaf.cjs");
          original(second); note("SAME_OBJECT", first === second); note("EVALUATED_ONCE", cjsEvaluations() === 1);
          note("CLOSED_CACHE_UNOBSERVED", closed && count > 0 && events.length === count && first === second);
          isCounterexample = true; break;
        }
        case "race_snapshot": {
          original(await importEsm()); firstLoad("f02");
          check(boundedRead(snap("f02").path).source === snap("f12").source && supplied("f02")
            && !supplied("f02", "f12"));
          note("EVALUATED_ONCE", esmEvaluations() === 1); break;
        }
        case "race_default": {
          replacement(await importEsm());
          check(!supplied("f02") && events.some((event) => event.kind === "load" && event.fileId === "f02"
            && event.supply === "delegated" && event.sourceDigest === snap("f12").digest));
          note("EVALUATED_ONCE", esmEvaluations() === 1); isCounterexample = true; break;
        }
        case "chain_short_circuit": {
          let chainResolves = 0; let chainLoads = 0;
          hooks.push(registerHooks({
            resolve(specifier, context) {
              const item = mapped(specifier, parentId(context.parentURL));
              check(item.id === "f02"); attributes(context.importAttributes, "module"); chainResolves += 1;
              return { url: item.url, format: "module", shortCircuit: true };
            },
            load(url, context) {
              check(url === snap("f02").url); attributes(context.importAttributes, "module"); chainLoads += 1;
              return { format: "module", source: snap("f02").source, shortCircuit: true };
            },
          }));
          original((await importFixed("./leaf.mjs")).default);
          note("EVALUATED_ONCE", esmEvaluations() === 1);
          note("CHAIN_BYPASS_OBSERVED", chainResolves === 1 && chainLoads === 1 && events.length === 0);
          isCounterexample = true; break;
        }
        case "chain_rewrite": {
          let rewrites = 0;
          hooks.push(registerHooks({
            load(url, context, nextLoad) {
              check(url === snap("f02").url);
              const result = nextLoad(url, context);
              check(result.source === snap("f02").source && result.format === "module"); rewrites += 1;
              return { format: "module", source: snap("f12").source, shortCircuit: true };
            },
          }));
          replacement((await importFixed("./leaf.mjs")).default);
          note("EVALUATED_ONCE", esmEvaluations() === 1);
          note("CHAIN_REWRITE_OBSERVED", rewrites === 1 && supplied("f02") && !supplied("f02", "f12")
            && snap("f02").digest !== snap("f12").digest);
          isCounterexample = true; break;
        }
        case "chain_deregister": {
          observer.deregister(); hooks.splice(hooks.indexOf(observer), 1);
          original((await importFixed("./leaf.mjs")).default);
          note("EVALUATED_ONCE", esmEvaluations() === 1);
          note("CHAIN_BYPASS_OBSERVED", events.length === 0 && callbackCount === 0);
          isCounterexample = true; break;
        }
        case "metadata_default": {
          replacement((await importFixed("c2b-fixture")).default);
          check(events.some((event) => event.kind === "resolve" && event.fileId === "f10" && event.route === "delegated")
            && supplied("f10"));
          note("METADATA_BYTES_UNAVAILABLE", !events.some((event) => event.fileId === "f08" || event.fileId === "f11")
            && boundedRead(snap("f08").path).source === snap("f15").source);
          isCounterexample = true; break;
        }
        case "asset_outside_loader": {
          original(await importEsm()); firstLoad("f02"); const count = events.length;
          // An actual fixed fs read in the trusted bootstrap, not a sandbox or fixture-code containment test.
          const source = boundedRead(snap("f07").path).source;
          note("ASSET_READ_UNOBSERVED", source === "asset-original" && events.length === count
            && !events.some((event) => event.fileId === "f07"));
          isCounterexample = true; break;
        }
        case "reject_mapping": {
          await expectRejection(() => importFixed("./unknown.mjs"), "MAPPING_UNSUPPORTED");
          check(loadCount() === 0); rejected(caseId, "MAPPING_UNSUPPORTED"); return;
        }
        case "reject_query": {
          await expectRejection(() => importFixed("./leaf.mjs?fixed"), "QUERY_UNSUPPORTED");
          await expectRejection(() => importFixed("./leaf.mjs#fixed"), "QUERY_UNSUPPORTED");
          check(loadCount() === 0); rejected(caseId, "QUERY_UNSUPPORTED"); return;
        }
        case "reject_attribute": {
          await expectRejection(() => importFixed("./leaf.mjs", { with: { unsupported: "fixed" } }), "ATTRIBUTE_UNSUPPORTED");
          check(loadCount() === 0); rejected(caseId, "ATTRIBUTE_UNSUPPORTED"); return;
        }
        case "reject_format": {
          hooks.push(registerHooks({ resolve(specifier, context, nextResolve) {
            const result = nextResolve(specifier, context); return { ...result, format: "wasm" };
          } }));
          await expectRejection(() => importFixed("./leaf.mjs"), "FORMAT_UNSUPPORTED");
          check(loadCount() === 0); rejected(caseId, "FORMAT_UNSUPPORTED"); return;
        }
        case "cap_events": case "cap_events_over": {
          for (let index = 0; index < 128; index += 1) check(require.resolve("./leaf.cjs") === snap("f04").path);
          check(events.length === 128 && callbackCount === 128 && events.every((event) => event.kind === "resolve")
            && cjsEvaluations() === 0);
          if (caseId === "cap_events_over") {
            await expectRejection(() => require.resolve("./leaf.cjs"), "EVENT_LIMIT");
            check(Number(callbackCount) === 129 && events.length === 128 && cjsEvaluations() === 0);
            rejected(caseId, "EVENT_LIMIT"); return;
          }
          break;
        }
        // Preparation-only overflows must never reach an executing child.
        case "cap_inventory_over": case "cap_source_over": case "cap_total_over": case "cap_bootstrap_over":
          check(false); break;
        default: check(false);
      }
    }
    closed = true;
    emit(observed(caseId, isCounterexample, events, observations));
  } finally {
    closed = true;
    for (const hook of hooks.reverse()) hook.deregister();
  }
}

async function main(): Promise<void> {
  const input = process.argv[2];
  // The parent validates before spawn too. An invalid invocation never echoes its arguments.
  check(process.argv.length === 3 && CASE_IDS.some((item) => item === input));
  check(process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64");
  const caseId = input as CaseId;
  if (!runTransport(caseId)) await experiment(caseId);
}
// Assertion/runtime failures have no invented wire report and no raw error output.
main().catch(() => { process.exitCode = 1; });
