import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildRuntimeLoadExperimentInventory } from "./runtimeLoadExperimentFixturePreparationTestFixtures.js";
import { runRuntimeLoadExperiment } from "./runtimeLoadExperimentHarnessTestFixtures.js";
import type {
  RuntimeLoadExperimentCaseId, RuntimeLoadExperimentFailureReason, RuntimeLoadExperimentFileId,
  RuntimeLoadExperimentObservation, RuntimeLoadExperimentWireReport,
} from "./runtimeLoadExperimentProtocolTestFixtures.js";

const supported = process.version === "v24.19.0" && process.platform === "linux" && process.arch === "x64";
const actual = { skip: supported ? false : "C2-B actual observations require Node 24.19.0 Linux x64" };
type Observed = Extract<RuntimeLoadExperimentWireReport, { status: "observed" | "counterexample"; events: unknown }>;
function digest(source: string): string { return `sha256:${createHash("sha256").update(source).digest("hex")}`; }
function source(caseId: RuntimeLoadExperimentCaseId, path: string): string {
  const row = buildRuntimeLoadExperimentInventory(caseId).find((item) => item.path === path);
  assert.ok(row); return row.source;
}
async function collected(caseId: RuntimeLoadExperimentCaseId): Promise<RuntimeLoadExperimentWireReport> {
  const result = await runRuntimeLoadExperiment(caseId);
  assert.equal(result.status, "collected", `${caseId}: ${JSON.stringify(result)}`);
  if (result.status !== "collected") throw new Error("expected collected synthetic observation");
  assert.equal(result.termination, "confirmed"); assert.equal(result.cleanup, "removed");
  assert.equal(result.report.caseId, caseId);
  for (const field of ["runtime", "dependencies", "result", "comparability"] as const) {
    assert.equal(result.report[field], "unavailable");
  }
  for (const field of ["completeRuntime", "completeConfiguration", "completeInput"] as const) {
    assert.equal(result.report[field], false);
  }
  assert.doesNotMatch(JSON.stringify(result), /\/tmp\/|\/workspace\/|asset-original|__c2bEsmEvaluations/);
  return result.report;
}
async function observed(caseId: RuntimeLoadExperimentCaseId, status: "observed" | "counterexample",
  observations: readonly RuntimeLoadExperimentObservation[]): Promise<Observed> {
  const report = await collected(caseId);
  if (report.status === "rejected") throw new Error("unexpected synthetic rejection");
  if (report.schemaVersion === "runtime_conditional_package_experiment.v1") throw new Error("unexpected conditional report");
  assert.equal(report.status, status);
  assert.equal(report.evidence, "synthetic_fixture_observation");
  for (const item of observations) assert.ok(report.observations.includes(item), `${caseId}: ${item}`);
  return report;
}
function supplied(report: Observed, fileId: RuntimeLoadExperimentFileId, expected: string,
  supply: "snapshot" | "delegated" = "snapshot"): void {
  assert.ok(report.events.some((event) => event.kind === "load" && event.fileId === fileId
    && event.sourceDigest === digest(expected) && event.supply === supply));
}

const firstCases = [
  ["esm_first", "f02", "leaf.mjs"], ["cjs_first", "f04", "leaf.cjs"],
  ["esm_cjs_first", "f04", "leaf.cjs"], ["json_import_first", "f05", "data.json"],
  ["json_require_first", "f05", "data.json"],
] as const;
for (const [caseId, fileId, path] of firstCases) {
  test(`C2-B actual ${caseId} registers before first fixture load and supplies exact source`, actual, async () => {
    const report = await observed(caseId, "observed", ["REGISTRATION_PRECEDES_LOAD", "ORIGINAL_VALUE"]);
    supplied(report, fileId, source(caseId, path));
  });
}
for (const caseId of ["esm_cache", "cjs_cache"] as const) {
  test(`C2-B actual ${caseId} reuses identity without a second evaluation`, actual, async () => {
    const report = await observed(caseId, "observed", ["SAME_OBJECT", "EVALUATED_ONCE", "CACHE_CALLBACK_ABSENT"]);
    assert.equal(report.events.filter((event) => event.kind === "load").length, 2);
  });
}
for (const caseId of ["json_import_require", "json_require_import"] as const) {
  test(`C2-B actual ${caseId} returns the same JSON object across module systems`, actual, async () => {
    const report = await observed(caseId, "observed", ["SAME_OBJECT", "ORIGINAL_VALUE"]);
    supplied(report, "f05", source(caseId, "data.json"));
  });
}
test("C2-B actual JSON cache ignores newly supplied B bytes and preserves cached A identity", actual, async () => {
  const report = await observed("json_cache_source_b", "counterexample", ["SAME_OBJECT", "ORIGINAL_VALUE", "SUPPLIED_SOURCE_UNUSED"]);
  const a = source("json_cache_source_b", "data.json");
  const b = source("json_cache_source_b", "data.replacement.json");
  assert.notEqual(digest(a), digest(b));
  supplied(report, "f05", a); supplied(report, "f05", b);
});
test("C2-B actual fresh JSON B control evaluates supplied B rather than the A file", actual, async () => {
  const report = await observed("json_fresh_b", "observed", ["REPLACEMENT_VALUE", "REGISTRATION_PRECEDES_LOAD"]);
  supplied(report, "f05", source("json_fresh_b", "data.replacement.json"));
  assert.ok(!report.events.some((event) => event.kind === "load"
    && event.sourceDigest === digest(source("json_fresh_b", "data.json"))));
});
test("C2-B actual delayed new import is recorded before explicit closure", actual, async () => {
  const report = await observed("late_new", "observed", ["LATE_LOAD_RECORDED"]);
  supplied(report, "f06", source("late_new", "late.mjs"));
});
test("C2-B actual cached CommonJS still executes after observation closure without callbacks", actual, async () => {
  await observed("closed_cached", "counterexample", ["CLOSED_CACHE_UNOBSERVED", "SAME_OBJECT", "EVALUATED_ONCE"]);
});
test("C2-B actual snapshot supply survives a controlled file rewrite", actual, async () => {
  const report = await observed("race_snapshot", "observed", ["ORIGINAL_VALUE", "EVALUATED_ONCE"]);
  supplied(report, "f02", source("race_snapshot", "leaf.mjs"));
});
test("C2-B actual default loader sees replacement bytes after the same controlled rewrite", actual, async () => {
  const report = await observed("race_default", "counterexample", ["REPLACEMENT_VALUE", "EVALUATED_ONCE"]);
  supplied(report, "f02", source("race_default", "leaf.replacement.mjs"), "delegated");
});
test("C2-B actual late registration misses already cached application evaluation", actual, async () => {
  const report = await observed("late_registration", "counterexample", ["LATE_REGISTRATION_MISSED", "CACHE_CALLBACK_ABSENT"]);
  assert.deepEqual(report.events, []);
});
for (const caseId of ["chain_short_circuit", "chain_deregister"] as const) {
  test(`C2-B actual ${caseId} defeats observer coverage`, actual, async () => {
    const report = await observed(caseId, "counterexample", ["CHAIN_BYPASS_OBSERVED", "ORIGINAL_VALUE"]);
    assert.deepEqual(report.events, []);
  });
}
test("C2-B actual later hook rewrites source after the observer supplied original bytes", actual, async () => {
  const report = await observed("chain_rewrite", "counterexample", ["CHAIN_REWRITE_OBSERVED", "REPLACEMENT_VALUE"]);
  supplied(report, "f02", source("chain_rewrite", "leaf.mjs"));
});
test("C2-B actual default package resolver consumes metadata outside module load observation", actual, async () => {
  const report = await observed("metadata_default", "counterexample", ["METADATA_BYTES_UNAVAILABLE", "REPLACEMENT_VALUE"]);
  assert.ok(report.events.every((event) => !["f08", "f11"].includes(event.fileId)));
  assert.ok(report.events.some((event) => event.kind === "resolve" && event.fileId === "f10"
    && event.parentId === "bootstrap" && event.route === "delegated"));
  supplied(report, "f10", source("metadata_default", "node_modules/c2b-fixture/replacement.mjs"), "delegated");
});
test("C2-B actual fixed fs asset read is outside loader event coverage", actual, async () => {
  const report = await observed("asset_outside_loader", "counterexample", ["ASSET_READ_UNOBSERVED"]);
  assert.ok(report.events.every((event) => event.fileId !== "f07"));
});
for (const [caseId, reason] of [
  ["closed_new", "LOAD_CLOSED"], ["reject_mapping", "MAPPING_UNSUPPORTED"],
  ["reject_query", "QUERY_UNSUPPORTED"], ["reject_attribute", "ATTRIBUTE_UNSUPPORTED"],
  ["reject_format", "FORMAT_UNSUPPORTED"], ["reject_alias", "PATH_UNSAFE"],
  ["cap_events_over", "EVENT_LIMIT"],
] as const) {
  test(`C2-B actual ${caseId} returns fixed ${reason} rejection`, actual, async () => {
    const report = await collected(caseId);
    assert.equal(report.status, "rejected");
    if (report.status !== "rejected") throw new Error("expected rejection");
    assert.equal(report.reason, reason); assert.equal(report.evidence, "unavailable");
    assert.ok(!("events" in report)); assert.ok(!("observations" in report));
  });
}
for (const caseId of ["cap_inventory", "cap_source", "cap_total", "cap_bootstrap"] as const) {
  test(`C2-B actual ${caseId} accepts the exact configured boundary`, actual, async () => {
    const report = await observed(caseId, "observed", ["REGISTRATION_PRECEDES_LOAD", "ORIGINAL_VALUE"]);
    if (caseId === "cap_source") supplied(report, "f16", source(caseId, "extra.mjs"));
  });
}
test("C2-B actual 128 resolve callbacks are retained at the event boundary", actual, async () => {
  const report = await observed("cap_events", "observed", []);
  assert.equal(report.events.length, 128);
  assert.ok(report.events.every((event) => event.kind === "resolve" && event.fileId === "f04"));
});
const failures: readonly (readonly [RuntimeLoadExperimentCaseId, RuntimeLoadExperimentFailureReason, "not_started" | "confirmed"])[] = [
  ["cap_inventory_over", "FIXTURE_PREPARATION_FAILED", "not_started"],
  ["cap_source_over", "FIXTURE_PREPARATION_FAILED", "not_started"],
  ["cap_total_over", "FIXTURE_PREPARATION_FAILED", "not_started"],
  ["cap_bootstrap_over", "BOOTSTRAP_LIMIT", "not_started"],
  ...(["transport_empty", "transport_truncated", "transport_multiple", "transport_unknown_key",
    "transport_case_mismatch", "transport_stdout"] as const).map((caseId) => [caseId, "INVALID_REPORT", "confirmed"] as const),
  ["transport_stdout_over", "STDOUT_LIMIT", "confirmed"], ["transport_stderr_over", "STDERR_LIMIT", "confirmed"],
  ["transport_exit", "EXIT_FAILURE", "confirmed"], ["transport_signal", "SIGNAL_EXIT", "confirmed"],
  ["transport_timeout", "DEADLINE_EXCEEDED", "confirmed"],
];
for (const [caseId, reason, termination] of failures) {
  test(`C2-B actual ${caseId} withholds report and confirms owned-root cleanup`, actual, async () => {
    assert.deepEqual(await runRuntimeLoadExperiment(caseId), {
      status: "failed", reason, report: null, termination, cleanup: "removed",
    });
  });
}
for (const caseId of ["transport_valid", "transport_stderr"] as const) {
  test(`C2-B actual ${caseId} accepts complete canonical wire only after close`, actual, async () => {
    const report = await observed(caseId, "observed", []);
    assert.deepEqual(report.events, []); assert.deepEqual(report.observations, []);
  });
}
test("C2-B actual child does not inherit parent preload, search path or synthetic secret markers", actual, async () => {
  const hostile = { NODE_OPTIONS: "--not-a-real-c2b-option", NODE_PATH: "/c2b-not-a-real-path",
    C2B_TEST_SECRET: "synthetic-do-not-emit-92", TRADING_ENABLED: "true", AI_DECISION_ENABLED: "true" };
  const previous = Object.fromEntries(Object.keys(hostile).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, hostile);
    const report = await observed("esm_first", "observed", ["ORIGINAL_VALUE"]);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-do-not-emit-92|c2b-not-a-real-path/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test("C2-B bootstrap is a bounded standalone built-in-only test fixture", async () => {
  // Literal tracked source/compiled references also keep the changed-test dependency runner honest.
  const sourceText = await readFile("src/replay/runtimeLoadExperimentTestChild.ts", "utf8");
  const compiled = await readFile("dist/replay/runtimeLoadExperimentTestChild.js", "utf8");
  assert.ok(Buffer.byteLength(compiled) <= 65536);
  const imports = [...sourceText.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(imports.length >= 5 && imports.every((specifier) => specifier?.startsWith("node:")));
  assert.doesNotMatch(compiled, /sourceMappingURL=data:/);
});
