/**
 * Test-only HTTP fixtures for Next's SERVER-side fetch. Browser interception
 * cannot replace these SSR requests. This is never used by the default suite.
 *
 * Safety: fixed loopback host/port; fixed scenario whitelist; in-memory data;
 * no filesystem, subprocess, provider, credentials, or outbound network access;
 * no CORS; no-store responses; runner-only control header with browser-origin
 * rejection. The control marker is a test protocol marker, NOT a secret.
 */
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = 8791;
const MARKER = "experiment-list-ssr-fixture-v1";
const CONTROL_HEADER = "x-experiment-list-test-runner";
const BATCH = "fixture_batch";
const START = "2026-06-27T00:01:00.000Z";
const END = "2026-06-27T00:05:00.000Z";

function terminal(runId, status = "completed", overrides = {}) {
  return {
    mode: "paper_only", batchId: BATCH, runId, runIndex: 0, status,
    startedAt: START,
    completedAt: status.startsWith("completed") ? END : null,
    failedAt: status === "failed" ? END : null,
    skippedAt: status === "skipped" ? END : null,
    window: { startAt: "2024-01-01T00:00:00.000Z", endAt: "2024-02-01T00:00:00.000Z" },
    marketRegime: { label: "bull" },
    summary: {
      totalReturnRatio: 0.025, finalVirtualNetWorthKrw: 1025000,
      tradeCount: 1, rejectedCount: 0, aiDecisionFailureCount: 0,
    },
    error: null, skipReason: null,
    ...overrides,
  };
}

function active(runId = "fixture_running", overrides = {}) {
  return {
    runId, runIndex: 4, startedAt: START,
    window: { startAt: "2024-02-01T00:00:00.000Z", endAt: "2024-03-01T00:00:00.000Z" },
    marketRegime: { label: "bear" },
    ...overrides,
  };
}

function envelope(runs = [terminal("fixture_completed")], overrides = {}) {
  const statusCounts = {};
  for (const run of runs) statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
  return {
    mode: "paper_only", readOnly: true, status: "ok", aggregateStatus: "missing",
    batchId: BATCH, batchStatus: "completed", batchStartedAt: START,
    batchUpdatedAt: END, batchCompletedAt: END, requestedRunCount: runs.length,
    manifestCounts: { completed: runs.filter((run) => run.status.startsWith("completed")).length,
      skipped: statusCounts.skipped ?? 0, failed: statusCounts.failed ?? 0 },
    initialCashKrw: 1000000, decisionProviderMode: "dry_run_fixture", riskProfile: "balanced",
    activeRun: null, activeRunProgressStatus: null, activeRunProgress: null,
    sourceRunsPath: "fixture-only/batch-replay-runs.jsonl", runs, selectedRun: null,
    count: runs.length, totalCount: runs.length, statusCounts, corruptLineCount: 0,
    aiDecisionFailureRunCount: 0, latestRunArtifacts: null,
    ...overrides,
  };
}

const runningEnvelope = (runs, overrides = {}) => envelope(runs, {
  status: "running", batchStatus: "running", batchCompletedAt: null,
  activeRun: active(), activeRunProgressStatus: "ok", requestedRunCount: runs.length + 1,
  ...overrides,
});

const scenarios = Object.freeze({
  "valid-terminal": () => envelope(),
  "all-statuses": () => runningEnvelope([
    terminal("fixture_completed"),
    terminal("fixture_completed_with_failures", "completed_with_failures", { runIndex: 1 }),
    terminal("fixture_failed", "failed", { runIndex: 2 }),
    terminal("fixture_skipped", "skipped", { runIndex: 3 }),
  ]),
  "empty": () => envelope([]),
  "active-only": () => runningEnvelope([]),
  "active-terminal-dedup": () => runningEnvelope([terminal("fixture_running")]),
  "running-corrupt": () => runningEnvelope([terminal("fixture_completed")], { corruptLineCount: 2 }),
  "missing": () => envelope([], { status: "missing", batchId: null, batchStatus: null,
    sourceRunsPath: null, requestedRunCount: null, manifestCounts: {},
    batchStartedAt: null, batchUpdatedAt: null, batchCompletedAt: null,
    initialCashKrw: null, decisionProviderMode: null, riskProfile: null }),
  "blocked": () => envelope([], { status: "blocked" }),
  "degraded": () => envelope([terminal("fixture_completed")], { status: "degraded", corruptLineCount: 1 }),
  "no-manifest": () => envelope([terminal("fixture_unbound")], { batchId: null, batchStatus: null,
    batchStartedAt: null, batchUpdatedAt: null, batchCompletedAt: null,
    requestedRunCount: null, manifestCounts: {},
    initialCashKrw: null, decisionProviderMode: null, riskProfile: null }),
  "terminal-stale-active": () => envelope([terminal("fixture_completed")], { activeRun: active() }),
  "null-batch-stale-active": () => envelope([terminal("fixture_completed")], { batchStatus: null, activeRun: active() }),
  "unknown-batch-stale-active": () => envelope([terminal("fixture_completed")], { batchStatus: "future_status", activeRun: active() }),
  "mismatched-row": () => envelope([
    terminal("fixture_completed"),
    terminal("fixture_other_batch", "completed", { batchId: "other_fixture_batch" }),
  ]),
  "unknown-row": () => envelope([
    terminal("fixture_completed"), terminal("fixture_unknown", "future_status"),
  ]),
  "nullable-zero": () => envelope([
    terminal("fixture_null", "completed", { summary: {
      totalReturnRatio: null, finalVirtualNetWorthKrw: null, tradeCount: null,
      rejectedCount: null, aiDecisionFailureCount: null,
    } }),
    terminal("fixture_zero", "completed", { summary: {
      totalReturnRatio: 0, finalVirtualNetWorthKrw: 0, tradeCount: 0,
      rejectedCount: 0, aiDecisionFailureCount: 0,
    } }),
  ]),
  "bounded-window": () => envelope(Array.from({ length: 100 }, (_, index) =>
    terminal(`fixture_window_${String(index + 50).padStart(3, "0")}`, "completed", { runIndex: index + 50 })), {
    count: 100, totalCount: 150, requestedRunCount: 150,
    statusCounts: { completed: 150 }, manifestCounts: { completed: 150, skipped: 0, failed: 0 },
  }),
  "long-identifiers": () => envelope([terminal(`fixture_${"x".repeat(247)}`)], { batchId: BATCH }),
  "legacy-batch-id": () => envelope([
    terminal("batch_smoke_2025_run_000000_2025-02", "completed", { batchId: "batch smoke/2025" }),
  ], { batchId: "batch smoke/2025" }),
  "partial-manifest-metadata": () => envelope([terminal("fixture_completed")], {
    requestedRunCount: -1, manifestCounts: { completed: -1, skipped: 0, failed: 0 },
  }),
  "duplicate-terminal-detail": () => envelope([
    terminal("fixture_duplicate", "failed", { summary: { tradeCount: 1 } }),
    terminal("fixture_duplicate", "completed", { summary: { tradeCount: 2 } }),
  ]),
  "unknown-endpoint": () => envelope([], { status: "future_status" }),
  "malformed-envelope": () => ({ mode: "paper_only", readOnly: true, status: "ok", runs: "not-an-array" }),
  "malformed-json": () => null,
  "offline-500": () => null,
  "timeout": () => null,
});
let scenario = "valid-terminal";
let requests = [];

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, { fixture: MARKER });
    return;
  }
  if (url.pathname.startsWith("/__experiment-list-fixture/")) {
    if (request.headers[CONTROL_HEADER] !== MARKER || request.headers.origin || request.headers["sec-fetch-mode"]) {
      send(response, 403, { error: "test_runner_required" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/__experiment-list-fixture/requests") {
      send(response, 200, { scenario, requests });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__experiment-list-fixture/scenario") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 1024) { send(response, 413, { error: "body_too_large" }); return; }
      }
      let name;
      try { name = JSON.parse(body).scenario; } catch { send(response, 400, { error: "invalid_json" }); return; }
      if (typeof name !== "string" || !Object.hasOwn(scenarios, name)) {
        send(response, 400, { error: "unknown_scenario" }); return;
      }
      scenario = name;
      requests = [];
      send(response, 200, { fixture: MARKER, scenario });
      return;
    }
    send(response, 404, { error: "not_found" });
    return;
  }
  if (request.method !== "GET" || url.pathname !== "/batch/replay/runs") {
    send(response, 404, { error: "fixture_route_not_found" }); return;
  }
  requests = [...requests.slice(-99), url.pathname + url.search];
  // Snapshot before a timeout so a subsequent scenario cannot change this response.
  const selectedScenario = scenario;
  if (selectedScenario === "timeout") {
    const timer = setTimeout(() => send(response, 200, envelope()), 5_000);
    response.on("close", () => clearTimeout(timer));
    return;
  }
  if (selectedScenario === "offline-500") { send(response, 500, { error: "synthetic_unavailable" }); return; }
  if (selectedScenario === "malformed-json") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end("{ not valid JSON"); return;
  }
  const payload = scenarios[selectedScenario]();
  const runId = url.searchParams.get("runId");
  if (runId && payload && Array.isArray(payload.runs)) {
    // Match the backend's first-record selection even for duplicate child IDs.
    // The list/detail adapter must reconcile this against eligible terminal rows.
    payload.selectedRun = payload.runs.find((run) => run.runId === runId) ?? null;
  }
  send(response, 200, payload);
});
server.listen(PORT, HOST, () => process.stdout.write(`${MARKER} http://${HOST}:${PORT}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
