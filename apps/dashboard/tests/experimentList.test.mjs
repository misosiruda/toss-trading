import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = await readFile(new URL("../src/lib/dashboardViewModels.ts", import.meta.url), "utf8");
const { normalizeExperimentListView, readExperimentListPageData, readRunDetailPageData } = await import(
  `data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(source, { mode: "strip" }))}`
);
const startedAt = "2026-06-18T13:41:59+09:00";
const completedAt = "2026-06-18T13:42:00+09:00";

function run(overrides = {}) {
  return {
    batchId: "paper_sim_20260618134159000_fixture",
    runId: "paper_sim_20260618134159000_fixture_run_000000_2026-06",
    status: "completed",
    runIndex: 0,
    startedAt,
    completedAt,
    window: { startAt: "2026-06-01T00:00:00.000Z", endAt: "2026-06-30T23:59:59.000Z" },
    marketRegime: { label: "sideways" },
    summary: { totalReturnRatio: 0, finalVirtualNetWorthKrw: 0, tradeCount: 0,
      rejectedCount: 0, aiDecisionFailureCount: 0 },
    ...overrides
  };
}

function payload(runs = [run()], overrides = {}) {
  const statusCounts = {};
  for (const row of runs) {
    const status = typeof row?.status === "string" ? row.status : "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  return {
    mode: "paper_only", readOnly: true, status: "ok", aggregateStatus: "missing",
    batchId: run().batchId, batchStatus: "completed", batchStartedAt: startedAt,
    batchUpdatedAt: completedAt, batchCompletedAt: completedAt,
    requestedRunCount: 1, manifestCounts: { completed: 1, skipped: 0, failed: 0 },
    riskProfile: "balanced", decisionProviderMode: "codex_cli", initialCashKrw: 1_000_000,
    activeRun: null, activeRunProgressStatus: "missing", runs, count: runs.length,
    totalCount: runs.length, statusCounts, corruptLineCount: 0,
    ...overrides
  };
}

function warnings(view) {
  return Object.fromEntries(view.warnings.map(({ code, count }) => [code, count]));
}

function configureApi(t, name = "DASHBOARD_OPS_API_BASE_URL") {
  for (const key of ["DASHBOARD_OPS_API_BASE_URL", "OPS_API_BASE_URL"]) {
    const original = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
  process.env[name] = "http://ops.test/private/";
}

test("experiment list projects all persisted terminal statuses and only safe actual fields", () => {
  const statuses = ["completed", "completed_with_failures", "failed", "skipped"];
  const view = normalizeExperimentListView(payload(statuses.map((status, index) =>
    run({ status, runId: `run_${index}` }))));
  assert.equal(view.sourceLabel, "API-selected/latest-unverified");
  assert.deepEqual(view.rows.map((row) => row.status), statuses);
  assert.equal(view.projectedTerminalCount, 4);
  assert.equal(view.projectedActiveCount, 0);
  assert.equal(view.excludedRowCount, 0);
  assert.equal(view.rows[0].detailHref, "/dashboard/lab/runs/run_0");
  assert.equal(view.rows[0].provenance, "bound_manifest");
  assert.equal(view.rows[0].windowStartAt, "2026-06-01T00:00:00.000Z");
  assert.equal(view.aggregateStatus, "missing");
  assert.equal(view.batchStartedAt, startedAt);
  assert.deepEqual(view.warnings, []);
});

test("experiment list keeps wrapper, endpoint, aggregate, and batch statuses independent", async (t) => {
  configureApi(t);
  for (const endpointStatus of ["ok", "running", "missing", "blocked", "degraded"]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(payload([], {
      status: endpointStatus, aggregateStatus: "corrupt", batchStatus: "completed_with_failures"
    })));
    const { experimentList } = await readExperimentListPageData();
    assert.equal(experimentList.status, "ok");
    assert.equal(experimentList.data.endpointStatus, endpointStatus);
    assert.equal(experimentList.data.aggregateStatus, "corrupt");
    assert.equal(experimentList.data.batchStatus, "completed_with_failures");
  }
});

test("experiment list preserves valid rows in partial malformed sources without leaking diagnostics", () => {
  const secret = "/private/runner/API-token-value";
  const view = normalizeExperimentListView(payload([
    run({ storageBaseDir: secret, reportPath: secret, error: secret, skipReason: secret }),
    null, [], { status: "completed" }, run({ runId: "unsafe/../id" }),
    run({ runId: "old_row", status: secret })
  ], { status: "degraded", corruptLineCount: 3, sourceRunsPath: secret,
    sourceDataDir: secret, warnings: [secret], latestRunArtifacts: { error: secret } }));
  assert.equal(view.rows.length, 1);
  assert.equal(view.count, 6);
  assert.equal(view.excludedRowCount, 5);
  assert.equal(view.unknownStatusCount, 3);
  assert.equal(warnings(view).corrupt_lines, 3);
  assert.equal(JSON.stringify(view).includes(secret), false);
  for (const key of ["storageBaseDir", "reportPath", "error", "skipReason", "sourceRunsPath",
    "sourceDataDir", "latestRunArtifacts", "portfolioPolicy", "sourceKind"])
    assert.equal(JSON.stringify(view).includes(`"${key}"`), false);
});

test("experiment list never promotes arbitrary saved statuses into queued or running rows", () => {
  const arbitrary = ["accepted", "queued", "running", "active", "cancelled", "unknown", "", "__proto__"];
  const input = payload([run(), ...arbitrary.map((status, index) => run({ runId: `other_${index}`, status }))]);
  // Define raw JSON keys without invoking object prototype setters.
  input.statusCounts = Object.fromEntries([["completed", 1], ...arbitrary.map((status) => [status, 1])]);
  const view = normalizeExperimentListView(input);
  assert.equal(view.rows.length, 1);
  assert.equal(view.projectedActiveCount, 0);
  assert.equal(view.unknownStatusCount, arbitrary.length);
  assert.equal(warnings(view).row_status_unknown, arbitrary.length);
  assert.deepEqual(view.statusCounts, { completed: 1 });
});

test("experiment list rejects explicitly contradictory child mode while preserving legacy omitted mode", () => {
  const view = normalizeExperimentListView(payload([
    run({ runId: "legacy_mode_omitted" }),
    run({ runId: "paper_mode_explicit", mode: "paper_only" }),
    run({ runId: "live_mode", mode: "live" }),
    run({ runId: "null_mode", mode: null }),
    run({ runId: "invalid_mode", mode: 1 })
  ], { batchStatus: "running", activeRun: { runId: "live_mode" } }));
  assert.deepEqual(view.rows.map(({ runId }) => runId), ["legacy_mode_omitted", "paper_mode_explicit"]);
  assert.equal(view.count, 5);
  assert.equal(view.excludedRowCount, 3);
  assert.equal(warnings(view).row_invalid, 3);
  assert.equal(view.projectedActiveCount, 0);
  assert.equal(warnings(view).active_run_terminal_duplicate, 1);
  const active = normalizeExperimentListView(payload([], {
    batchStatus: "running", activeRun: { runId: "live_active", mode: "live" }
  }));
  assert.deepEqual(active.rows, []);
  assert.equal(warnings(active).active_run_invalid, 1);
});

test("experiment list derives active-only rows from bound running manifest without inventing counts", () => {
  const view = normalizeExperimentListView(payload([], {
    status: "running", batchStatus: "running", batchCompletedAt: null,
    manifestCounts: { completed: 0, skipped: 0, failed: 0 },
    activeRunProgressStatus: "ok",
    activeRun: { runId: "active_child", runIndex: 0, startedAt,
      summary: { totalReturnRatio: 0.7 }, storageBaseDir: "/private/active" }
  }));
  assert.equal(view.rows[0].runId, "active_child");
  assert.equal(view.rows[0].status, "running");
  assert.equal(view.rows[0].batchId, view.batchId);
  assert.equal(view.rows[0].totalReturnRatio, null);
  assert.equal(view.rows[0].completedAt, null);
  assert.equal(view.count, 0);
  assert.equal(view.totalCount, 0);
  assert.equal(view.projectedTerminalCount, 0);
  assert.equal(view.projectedActiveCount, 1);
});

test("experiment list deduplicates terminal/active rows with last valid stored row winning", () => {
  const view = normalizeExperimentListView(payload([
    run({ runId: "same_child", status: "failed", completedAt: "2099-01-01T00:00:00Z" }),
    run({ runId: "same_child", status: "completed" })
  ], { batchStatus: "running", activeRun: { runId: "same_child" } }));
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].status, "completed");
  assert.equal(view.count, 2);
  assert.equal(view.excludedRowCount, 1);
  assert.equal(warnings(view).row_duplicate, 1);
  assert.equal(warnings(view).active_run_terminal_duplicate, 1);
  assert.equal(view.projectedActiveCount, 0);
  assert.deepEqual(view.statusCounts, { failed: 1, completed: 1 });
});

test("exact child detail uses the same duplicate terminal record as the list while retaining detail fields", async (t) => {
  configureApi(t);
  const input = payload([
    run({ runId: "same_child", status: "failed", summary: { tradeCount: 1 }, error: "earlier failure" }),
    run({ runId: "same_child", status: "completed", summary: { tradeCount: 2 },
      storageBaseDir: "/private/final-run", reportPath: "/private/final-report.json", error: null })
  ], { sourceRunsPath: "/private/source.jsonl", selectedRun: run({ runId: "same_child", status: "failed" }) });
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), "http://ops.test/private/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=same_child");
    return Response.json(input);
  });
  const list = normalizeExperimentListView(input);
  const { runDetail } = await readRunDetailPageData("same_child");
  assert.equal(runDetail.status, "ok");
  assert.equal(runDetail.data.run.status, list.rows[0].status);
  assert.equal(runDetail.data.run.tradeCount, list.rows[0].tradeCount);
  assert.equal(runDetail.data.run.status, "completed");
  assert.equal(runDetail.data.run.tradeCount, 2);
  assert.equal(runDetail.data.run.storageBaseDir, "/private/final-run");
  assert.equal(runDetail.data.run.reportPath, "/private/final-report.json");
  assert.equal(runDetail.data.run.error, null);
  assert.equal(runDetail.data.sourceRunsPath, "/private/source.jsonl");
  assert.equal(JSON.stringify(list).includes("/private/"), false);
  assert.equal(Object.hasOwn(list, "terminalRecordsById"), false);
});

test("exact child detail ignores later ineligible terminal candidates using the list eligibility rules", async (t) => {
  configureApi(t);
  const input = payload([
    run({ runId: "same_child", status: "failed", summary: { tradeCount: 1 } }),
    run({ runId: "same_child", status: "completed", summary: { tradeCount: 2 } }),
    run({ runId: "same_child", status: "queued", summary: { tradeCount: 90 } }),
    run({ runId: "same_child", status: "failed", mode: "live", summary: { tradeCount: 91 } }),
    run({ runId: "same_child", status: "failed", batchId: "other_batch", summary: { tradeCount: 92 } })
  ]);
  t.mock.method(globalThis, "fetch", async () => Response.json(input));
  const list = normalizeExperimentListView(input);
  const detail = (await readRunDetailPageData("same_child")).runDetail.data;
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].status, "completed");
  assert.equal(list.rows[0].tradeCount, 2);
  assert.equal(detail.run.status, list.rows[0].status);
  assert.equal(detail.run.tradeCount, list.rows[0].tradeCount);
  assert.equal(warnings(list).row_status_unknown, 1);
  assert.equal(warnings(list).row_invalid, 1);
  assert.equal(warnings(list).row_batch_mismatch, 1);
});

test("exact child detail and unbound list agree for normal legacy raw batch identifiers", async (t) => {
  configureApi(t);
  const batchId = "batch smoke/2025";
  const runId = "batch_smoke_2025_run_000000_2025-01";
  const input = payload([
    run({ batchId, runId, status: "failed", summary: { tradeCount: 1 } }),
    run({ batchId, runId, status: "completed", summary: { tradeCount: 2 } })
  ], { batchId });
  t.mock.method(globalThis, "fetch", async () => Response.json(input));
  const list = normalizeExperimentListView(input);
  const detail = (await readRunDetailPageData(runId)).runDetail.data;
  assert.equal(list.rows[0].provenance, "unbound_stored");
  assert.equal(list.rows[0].batchId, null);
  assert.equal(detail.run.status, list.rows[0].status);
  assert.equal(detail.run.tradeCount, list.rows[0].tradeCount);
  assert.equal(detail.run.batchId, batchId);
});

test("shared exact-child selection preserves outside-window selectedRun, batch aliases, and active detail", async (t) => {
  configureApi(t);
  const batchId = run().batchId;
  let input = payload([run({ runId: "recent_child" })], {
    selectedRun: run({ runId: "older_child", status: "failed", summary: { tradeCount: 4 } })
  });
  t.mock.method(globalThis, "fetch", async () => Response.json(input));
  const outside = (await readRunDetailPageData("older_child")).runDetail.data;
  assert.equal(outside.runId, "older_child");
  assert.equal(outside.run.tradeCount, 4);
  const selectedAlias = (await readRunDetailPageData(batchId)).runDetail.data;
  assert.equal(selectedAlias.runId, "older_child");
  input = payload([run({ runId: "earlier_child" }), run({ runId: "recent_child" })]);
  const storedAlias = (await readRunDetailPageData(batchId)).runDetail.data;
  assert.equal(storedAlias.runId, "recent_child");
  input = payload([], { batchStatus: "running", activeRun: { runId: "active_child", runIndex: 0, startedAt } });
  const activeChild = (await readRunDetailPageData("active_child")).runDetail.data;
  assert.equal(activeChild.runId, "active_child");
  assert.equal(activeChild.run.status, "running");
  const activeAlias = (await readRunDetailPageData(batchId)).runDetail.data;
  assert.equal(activeAlias.runId, "active_child");
});

test("experiment list rejects inconsistent active metadata but retains valid stored rows", () => {
  for (const batchStatus of [null, "unknown", "completed", "completed_with_failures", "failed", "skipped"]) {
    const view = normalizeExperimentListView(payload([run()], {
      batchStatus, activeRun: { runId: "untrusted_active", status: "running" }
    }));
    assert.equal(view.rows.length, 1);
    assert.equal(view.projectedActiveCount, 0);
    assert.equal(warnings(view).active_run_inconsistent, 1);
  }
  for (const activeRun of [{}, [], { runId: "../unsafe" }, "running"]) {
    const view = normalizeExperimentListView(payload([run()], { batchStatus: "running", activeRun }));
    assert.equal(view.rows.length, 1);
    assert.equal(warnings(view).active_run_invalid, 1);
  }
});

test("experiment list makes no-manifest fallback provenance explicit and never activates an observation", () => {
  const view = normalizeExperimentListView(payload([run(), run({ runId: "unbound", batchId: null })], {
    batchId: null, batchStatus: null, batchStartedAt: null, batchUpdatedAt: null,
    batchCompletedAt: null, requestedRunCount: null, initialCashKrw: null, manifestCounts: {},
    activeRun: { runId: "unbound_active" },
    simulationObservation: { status: "accepted", runId: "accepted_only" }
  }));
  assert.equal(view.rows.length, 2);
  assert.ok(view.rows.every((row) => row.provenance === "unbound_stored"));
  assert.equal(view.projectedActiveCount, 0);
  assert.equal(warnings(view).unbound_rows, 2);
  assert.equal(warnings(view).active_run_unbound, 1);
  assert.deepEqual(view.manifestCounts, { completed: null, skipped: null, failed: null });
  const acceptedOnly = normalizeExperimentListView(payload([], {
    batchId: null, batchStatus: null, simulationObservation: { status: "accepted", runId: "accepted_only" }
  }));
  assert.deepEqual(acceptedOnly.rows, []);
  const unboundRunning = normalizeExperimentListView(payload([run()], {
    batchId: null, batchStatus: "running", activeRun: { runId: "not_bound" }
  }));
  assert.equal(unboundRunning.projectedActiveCount, 0);
  assert.equal(warnings(unboundRunning).active_run_unbound, 1);
});

test("experiment list excludes known batch mismatches and never falls back to manifest-only terminal rows", () => {
  const view = normalizeExperimentListView(payload([
    run(), run({ runId: "mismatch", batchId: "other_batch" }), run({ runId: "missing_batch", batchId: null })
  ]));
  assert.equal(view.rows.length, 1);
  assert.equal(view.count, 3);
  assert.equal(view.excludedRowCount, 2);
  assert.equal(warnings(view).row_batch_mismatch, 2);
  const manifestOnly = normalizeExperimentListView(payload([], { manifestCounts: { completed: 20 } }));
  assert.deepEqual(manifestOnly.rows, []);
  const mismatchActive = normalizeExperimentListView(payload([run({ runId: "collision", batchId: "other" })], {
    batchStatus: "running", activeRun: { runId: "collision" }
  }));
  assert.deepEqual(mismatchActive.rows, []);
  assert.equal(warnings(mismatchActive).active_run_terminal_duplicate, 1);
});

test("experiment list preserves workflow-generated children when legacy raw batch ID is not link-safe", () => {
  // historicalBatchReplayWorkflow preserves raw batchId while safeArtifactPathPart
  // sanitizes only the generated child ID and artifact path components.
  const batchId = "batch smoke/2025";
  const runId = "batch_smoke_2025_run_000000_2025-01";
  const view = normalizeExperimentListView(payload([run({
    mode: "paper_only", batchId, runId,
    window: { startAt: "2025-01-01T00:00:00Z", endAt: "2025-02-01T00:00:00Z" }
  })], { batchId, batchStatus: "running", activeRun: { runId: "batch_smoke_2025_run_000001_2025-02" } }));
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].runId, runId);
  assert.equal(view.rows[0].detailHref, `/dashboard/lab/runs/${runId}`);
  assert.equal(view.rows[0].batchId, null);
  assert.equal(view.rows[0].provenance, "unbound_stored");
  assert.equal(view.batchId, null);
  assert.equal(view.count, 1);
  assert.equal(view.projectedTerminalCount, 1);
  assert.equal(view.excludedRowCount, 0);
  assert.equal(view.projectedActiveCount, 0);
  assert.equal(warnings(view).batch_metadata_invalid, 1);
  assert.equal(warnings(view).row_metadata_invalid, 1);
  assert.equal(warnings(view).unbound_rows, 1);
  assert.equal(warnings(view).active_run_unbound, 1);
  assert.equal(JSON.stringify(view).includes(batchId), false);
});

test("experiment list safely redacts malformed batch metadata without dropping independently valid children", () => {
  const malformedBatchIds = [
    { path: "/private/runner" }, ["private", "runner"], "batch\ncontrol", "batch\u0000control",
    "https://private.example/batch?token=secret", "../private/batch", "a".repeat(256)
  ];
  for (const batchId of malformedBatchIds) {
    for (const selectedBatchId of [null, batchId]) {
      const view = normalizeExperimentListView(payload([
        run({ runId: "safe_child", batchId }),
        run({ runId: "../unsafe_child", batchId })
      ], { batchId: selectedBatchId, batchStatus: "running", activeRun: { runId: "safe_active" } }));
      assert.equal(view.rows.length, 1);
      assert.equal(view.rows[0].runId, "safe_child");
      assert.equal(view.rows[0].batchId, null);
      assert.equal(view.rows[0].provenance, "unbound_stored");
      assert.equal(view.count, 2);
      assert.equal(view.excludedRowCount, 1);
      assert.equal(view.projectedActiveCount, 0);
      assert.equal(warnings(view).row_metadata_invalid, 1);
      assert.equal(warnings(view).row_invalid, 1);
      assert.equal(JSON.stringify(view).includes("private"), false);
      assert.equal(JSON.stringify(view).includes("control"), false);
      assert.equal(JSON.stringify(view).includes("secret"), false);
    }
    const bound = normalizeExperimentListView(payload([run(), run({ runId: "invalid_batch_child", batchId })]));
    assert.equal(bound.rows.length, 1);
    assert.equal(bound.rows[0].runId, run().runId);
    assert.equal(bound.excludedRowCount, 1);
    assert.equal(warnings(bound).row_batch_mismatch, 1);
  }
});

test("experiment list preserves raw 100/150 window counts separately from projections and manifest counts", () => {
  const runs = Array.from({ length: 100 }, (_, index) => run({ runId: `run_${index}` }));
  runs[0].batchId = "other_batch";
  const view = normalizeExperimentListView(payload(runs, {
    totalCount: 150, statusCounts: { completed: 140, failed: 5, arbitrary: 5 },
    requestedRunCount: 200, manifestCounts: { completed: 120, failed: 10, skipped: 10 },
    batchStatus: "running", activeRun: { runId: "active_child" }
  }));
  assert.equal(view.count, 100);
  assert.equal(view.totalCount, 150);
  assert.equal(view.projectedTerminalCount, 99);
  assert.equal(view.projectedActiveCount, 1);
  assert.equal(view.excludedRowCount, 1);
  assert.equal(view.requestedRunCount, 200);
  assert.equal(view.manifestCounts.completed, 120);
  assert.deepEqual(view.statusCounts, { completed: 140, failed: 5 });
  assert.equal(view.unknownStatusCount, 5);
});

test("experiment list degrades malformed requested and manifest counts without losing valid children", () => {
  const invalidCounts = [-1, 0.5, "1", "", false, {}, [], Infinity, NaN];
  for (const requestedRunCount of invalidCounts) {
    const view = normalizeExperimentListView(payload([run()], { requestedRunCount }));
    assert.equal(view.rows.length, 1);
    assert.equal(view.count, 1);
    assert.equal(view.totalCount, 1);
    assert.deepEqual(view.statusCounts, { completed: 1 });
    assert.equal(view.requestedRunCount, null);
    assert.equal(warnings(view).batch_metadata_invalid, 1);
  }
  for (const completed of invalidCounts) {
    const view = normalizeExperimentListView(payload([run()], {
      manifestCounts: { completed, skipped: 0, failed: 2 }
    }));
    assert.equal(view.rows.length, 1);
    assert.deepEqual(view.manifestCounts, { completed: null, skipped: 0, failed: 2 });
    assert.equal(warnings(view).batch_metadata_invalid, 1);
  }
  for (const manifestCounts of [-1, 0.5, "1", "", false, []]) {
    const view = normalizeExperimentListView(payload([run()], { manifestCounts }));
    assert.equal(view.rows.length, 1);
    assert.deepEqual(view.manifestCounts, { completed: null, skipped: null, failed: null });
    assert.equal(warnings(view).batch_metadata_invalid, 1);
  }
  for (const unknown of [null, undefined]) {
    const view = normalizeExperimentListView(payload([run()], {
      requestedRunCount: unknown, manifestCounts: unknown
    }));
    assert.equal(view.rows.length, 1);
    assert.equal(view.requestedRunCount, null);
    assert.deepEqual(view.manifestCounts, { completed: null, skipped: null, failed: null });
    assert.deepEqual(view.warnings, []);
    const nullableFields = normalizeExperimentListView(payload([run()], {
      manifestCounts: { completed: unknown, failed: unknown }
    }));
    assert.deepEqual(nullableFields.manifestCounts, { completed: null, skipped: null, failed: null });
    assert.deepEqual(nullableFields.warnings, []);
  }
});

test("experiment list retains genuine zero, null, and malformed metric distinctions", () => {
  const zero = normalizeExperimentListView(payload([run()], { initialCashKrw: 0, requestedRunCount: 0 }));
  for (const key of ["totalReturnRatio", "finalVirtualNetWorthKrw", "tradeCount", "rejectedCount", "aiDecisionFailureCount"])
    assert.equal(zero.rows[0][key], 0);
  assert.equal(zero.initialCashKrw, 0);
  const empty = normalizeExperimentListView(payload([run({ summary: {}, runIndex: null, startedAt: null })]));
  assert.equal(empty.rows[0].tradeCount, null);
  assert.equal(empty.rows[0].runIndex, null);
  assert.equal(empty.rows[0].startedAt, null);
  for (const bad of ["0", "", false, Infinity, NaN, {}, []]) {
    const view = normalizeExperimentListView(payload([run({
      summary: { totalReturnRatio: bad, finalVirtualNetWorthKrw: bad, tradeCount: bad }
    })]));
    assert.equal(view.rows[0].totalReturnRatio, null);
    assert.equal(view.rows[0].finalVirtualNetWorthKrw, null);
    assert.equal(view.rows[0].tradeCount, null);
    assert.equal(warnings(view).row_metadata_invalid, 1);
  }
  const negative = normalizeExperimentListView(payload([run({ summary: {
    totalReturnRatio: -0.1, tradeCount: -1, rejectedCount: 0.5
  } })]));
  assert.equal(negative.rows[0].totalReturnRatio, -0.1);
  assert.equal(negative.rows[0].tradeCount, null);
  assert.equal(negative.rows[0].rejectedCount, null);
});

test("experiment list accepts only complete valid ordered actual period pairs and strict timestamps", () => {
  for (const window of [null, {}, { startAt: startedAt }, { startAt: completedAt, endAt: startedAt },
    { startAt: "2026-02-30T00:00:00Z", endAt: completedAt },
    { startAt: "2026-06-01", endAt: "2026-06-30" }]) {
    const view = normalizeExperimentListView(payload([run({ window })]));
    assert.equal(view.rows[0].windowStartAt, null);
    assert.equal(view.rows[0].windowEndAt, null);
  }
  for (const bad of ["", "yesterday", "2026-02-29T12:00:00Z", "2026-06-18T24:00:00Z", "/private/date"]) {
    const view = normalizeExperimentListView(payload([run({ startedAt: bad })], { batchUpdatedAt: bad }));
    assert.equal(view.rows[0].startedAt, null);
    assert.equal(view.batchUpdatedAt, null);
  }
  const leap = normalizeExperimentListView(payload([run({ startedAt: "2024-02-29T12:00:00.123456Z" })]));
  assert.equal(leap.rows[0].startedAt, "2024-02-29T12:00:00.123456Z");
});

test("experiment list omits unsafe identifiers and bounds all client-visible metadata strings", () => {
  for (const bad of ["../parent", "/absolute", "C:\\private", "a.b", "a%2Fb", "a?query", "<script>", "a\n", "a".repeat(256)]) {
    const view = normalizeExperimentListView(payload([run(), run({ runId: bad })]));
    assert.equal(view.rows.length, 1);
    assert.equal(view.excludedRowCount, 1);
  }
  for (const id of [run().runId, "-legacy_run_000001_2026-06", "KR_US-01"]) {
    const view = normalizeExperimentListView(payload([run({ runId: id })]));
    assert.equal(view.rows[0].detailHref, `/dashboard/lab/runs/${encodeURIComponent(id)}`);
  }
  const view = normalizeExperimentListView(payload([run({ marketRegime: { label: "https://private.test" } })], {
    riskProfile: "/private/profile", decisionProviderMode: "a".repeat(65), batchStatus: "raw runner error",
    aggregateStatus: "/private/path", activeRunProgressStatus: "https://private.test"
  }));
  assert.equal(view.riskProfile, null);
  assert.equal(view.decisionProviderMode, null);
  assert.equal(view.rows[0].marketRegimeLabel, null);
  assert.equal(view.batchStatus, null);
  assert.equal(view.aggregateStatus, null);
  assert.equal(view.activeRunProgressStatus, null);
  assert.equal(JSON.stringify(view).includes("private"), false);
  assert.equal(JSON.stringify(view).includes("raw runner error"), false);
  const unsafeBatch = normalizeExperimentListView(payload([run()], {
    batchId: "/private/batch", batchStatus: "running", activeRun: { runId: "not_bound" }
  }));
  assert.equal(unsafeBatch.rows.length, 1);
  assert.equal(unsafeBatch.rows[0].provenance, "unbound_stored");
  assert.equal(unsafeBatch.projectedActiveCount, 0);
  assert.equal(warnings(unsafeBatch).batch_metadata_invalid, 1);
});

test("experiment list preserves full workflow child IDs through the 255 ASCII component limit", () => {
  const batchId = "b".repeat(145);
  const generatedChild = `${batchId}_run_000000_2025-01`;
  assert.equal(generatedChild.length, 164);
  for (const runId of [generatedChild, "r".repeat(255)]) {
    const view = normalizeExperimentListView(payload([run({ batchId, runId })], { batchId }));
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0].runId, runId);
    assert.equal(view.rows[0].detailHref, `/dashboard/lab/runs/${runId}`);
    assert.equal(view.rows[0].batchId, batchId);
    assert.equal(view.rows[0].provenance, "bound_manifest");
    assert.equal(view.excludedRowCount, 0);
    assert.deepEqual(view.warnings, []);
  }
  const tooLong = normalizeExperimentListView(payload([run({ runId: "r".repeat(256) })]));
  assert.deepEqual(tooLong.rows, []);
  assert.equal(tooLong.count, 1);
  assert.equal(tooLong.excludedRowCount, 1);
  assert.equal(warnings(tooLong).row_invalid, 1);
});

test("experiment list rejects unsafe envelopes and malformed source counts", () => {
  const invalid = [null, [], {}, ...[
    { mode: "live" }, { readOnly: false }, { runs: null }, { status: "corrupt" },
    { count: null }, { count: "1" }, { count: -1 }, { count: 1.5 }, { count: 0 },
    { totalCount: 0 }, { totalCount: Infinity }, { corruptLineCount: -1 },
    { statusCounts: null }, { statusCounts: { completed: "1" } },
    { statusCounts: { completed: 2 } }, { statusCounts: { completed: -1 } },
    { totalCount: Number.MAX_SAFE_INTEGER + 1 }
  ].map((change) => payload([run()], change)),
  payload(Array.from({ length: 101 }, (_, index) => run({ runId: `run_${index}` })))];
  for (const input of invalid) assert.equal(normalizeExperimentListView(input), null);
});

test("experiment list fetches configured API once using a no-store GET and exposes no API URL", async (t) => {
  configureApi(t);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json(payload());
  });
  const result = await readExperimentListPageData();
  assert.equal(result.experimentList.status, "ok");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "http://ops.test/private/batch/replay/runs?limit=100");
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(requests[0].init.headers.accept, "application/json");
  assert.equal(requests[0].init.body, undefined);
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes("http://ops.test"), false);
  assert.equal(result.experimentList.endpoint, "/batch/replay/runs?limit=100");
});

test("experiment list uses existing OPS_API_BASE_URL fallback", async (t) => {
  configureApi(t, "OPS_API_BASE_URL");
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(String(url), "http://ops.test/private/batch/replay/runs?limit=100");
    return Response.json(payload());
  });
  assert.equal((await readExperimentListPageData()).experimentList.status, "ok");
});

test("experiment list marks malformed JSON and unsafe envelope invalid, distinct from network offline", async (t) => {
  configureApi(t);
  for (const [response, expected] of [
    [new Response("{broken json"), "invalid"],
    [Response.json(payload([], { mode: "live" })), "invalid"],
    [Response.json(payload([], { count: -1 })), "invalid"],
    [new Response(null, { status: 503 }), "offline"]
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    const result = await readExperimentListPageData();
    assert.equal(result.experimentList.status, expected);
    assert.equal(result.experimentList.data, null);
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("http://private/api?token=secret /runner/path"); });
  const result = await readExperimentListPageData();
  assert.equal(result.experimentList.status, "offline");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("/runner/path"), false);
});

test("experiment list aborts once at the existing 2000ms timeout without retry or mutation", async (t) => {
  configureApi(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    signal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () =>
      reject(new DOMException("aborted private endpoint", "AbortError")), { once: true }));
  });
  const pending = readExperimentListPageData();
  t.mock.timers.tick(1999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(result.experimentList.status, "offline");
  assert.equal(calls, 1);
});
