import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function load(file, globals = {}) {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, AbortSignal, Buffer, TextDecoder, ...globals });
  return exports;
}
const clone = value => JSON.parse(JSON.stringify(value));

test("raw numeric edits stay invalid; typed request contains only supported fixture conditions", async () => {
  const { emptySimulationDraft, typedCandidate } = await load("lib/simulationCandidate.ts");
  assert.equal(typedCandidate(emptySimulationDraft), null);
  const draft = { ...emptySimulationDraft, sourceDataDir: "data/synthetic", startAt: "2026-01-01", endAt: "2026-01-02", seed: "test", initialCashKrw: "500000", runCount: "3" };
  const candidate = typedCandidate(draft);
  assert.equal(candidate.capital.initialCashKrw, 500000);
  assert.equal(candidate.runCount, 3, "client does not normalize the single count");
  assert.equal(candidate.decisionProvider.mode, "dry_run_fixture");
  assert.equal(candidate.samplingPolicy.maxCodexCallsPerRun, 0);
  for (const invalid of ["", " ", "1.2", "1e3", "9007199254740992", "-1"]) assert.equal(typedCandidate({ ...draft, initialCashKrw: invalid }), null);
});

test("validation and acceptance require exact current request, complete envelope and consistent exact ID", async () => {
  const { emptySimulationDraft, typedCandidate, readValidation, acceptedSimulationId } = await load("lib/simulationCandidate.ts");
  const candidate = clone(typedCandidate({ ...emptySimulationDraft, sourceDataDir: "data/synthetic", startAt: "2026-01-01", endAt: "2026-01-02", seed: "test", initialCashKrw: "500000" }));
  const response = JSON.parse(await readFile(new URL("../../../docs/plans/experiment-workspace-redesign/validation-response.example.json", import.meta.url), "utf8"));
  response.requestedConfig = candidate;
  response.effectiveConfig.sourceDataDir = candidate.sourceDataDir;
  response.effectiveConfig.window.seed = candidate.window.seed;
  response.effectiveConfig.paperExitPolicy = null;
  response.notices = [];
  assert.ok(readValidation(response, candidate));
  for (const mutation of [v => v.requestedConfig.capital.initialCashKrw++, v => v.sourceDataKind = "synthetic", v => v.replayRunnerStarted = true, v => delete v.effectiveConfig.window, v => v.effectiveConfig.samplingPolicy.maxCodexCallsPerRun = 1, v => v.notices = [{}], v => v.effectiveConfig.costModel = {}]) {
    const bad = clone(response); mutation(bad); assert.equal(readValidation(bad, candidate), null);
  }
  // Every required field in the actual effective contract must survive transport.
  const requiredLeaves = (value, prefix = []) => Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object" && !Array.isArray(child) ? requiredLeaves(child, [...prefix, key]) : [[...prefix, key]]);
  for (const path of requiredLeaves(response.effectiveConfig)) {
    for (const replacement of [undefined, { invalid: true }]) {
      const bad = clone(response);
      const parent = path.slice(0, -1).reduce((node, key) => node[key], bad.effectiveConfig);
      if (replacement === undefined) delete parent[path.at(-1)]; else parent[path.at(-1)] = replacement;
      assert.equal(readValidation(bad, candidate), null, `reject incomplete/type-invalid ${path.join(".")}`);
    }
  }
  for (const [selection, policy] of [["take_profit_stop_loss", { takeProfitMode: "full_exit", takeProfitRatio: 0.15, stopLossRatio: 0.08 }], ["rebalance_threshold", { takeProfitMode: "full_exit", rebalanceMaxPositionWeightRatio: 0.4 }]]) {
    const variant = clone(response);
    variant.requestedConfig.paperExitPolicy = selection;
    variant.effectiveConfig.paperExitPolicy = policy;
    assert.ok(readValidation(variant, variant.requestedConfig));
    for (const key of Object.keys(policy)) {
      const bad = clone(variant); delete bad.effectiveConfig.paperExitPolicy[key];
      assert.equal(readValidation(bad, bad.requestedConfig), null);
    }
  }
  const aggressive = clone(response);
  aggressive.requestedConfig.riskProfile = aggressive.effectiveConfig.riskProfile = "aggressive_paper";
  const rampKeys = ["deploymentRampDays", "maxInitialDeploymentRatio", "maxDailyGrossBuyRatio", "maxInitialOpenPositions", "maxNewPositionsPerDay", "maxConcurrentPositions", "positionSlotRampDays"];
  for (const key of rampKeys) aggressive.effectiveConfig.allocationPolicy[key] = 1;
  assert.ok(readValidation(aggressive, aggressive.requestedConfig));
  for (const key of rampKeys) {
    const bad = clone(aggressive); delete bad.effectiveConfig.allocationPolicy[key];
    assert.equal(readValidation(bad, bad.requestedConfig), null);
  }
  const random = clone(response);
  random.requestedConfig.window.mode = random.effectiveConfig.window.mode = "random_month";
  random.effectiveConfig.window.fixedWindow = null;
  random.effectiveConfig.window.windowMonths = 1;
  assert.ok(readValidation(random, random.requestedConfig));
  const id = "paper_sim_20261003000000000_test";
  const accepted = { mode: "paper_only", mutation: "paper_simulation_create", status: "accepted", simulationRunId: id, batchId: id, readOnlyLiveTrading: true, dataAvailabilityChecked: false, requestedConfig: candidate, effectiveConfig: response.effectiveConfig, notices: [] };
  assert.equal(acceptedSimulationId(accepted, response), id);
  for (const bad of [{ ...accepted, batchId: "other" }, { ...accepted, simulationRunId: `${id}\n`, batchId: `${id}\n` }, { ...accepted, requestedConfig: {} }, { ...accepted, effectiveConfig: {} }]) assert.equal(acceptedSimulationId(bad, response), null);
});

test("simulation validation BFF guards intent/origin/JSON/body before one read-only upstream call", async () => {
  const calls = [];
  const { POST } = await load("app/dashboard/experiments/validate/route.ts", {
    require(name) {
      if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      assert.equal(name, "@/lib/dashboardViewModels");
      return { readOperationsApiConfig: () => ({ baseUrl: "http://127.0.0.1:8789" }) };
    },
    fetch: async (url, init) => { calls.push({ url, init }); return Response.json({ status: "valid" }); }
  });
  const headers = { host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "content-type": "application/json", "x-toss-trading-dashboard-intent": "paper-simulation-validate" };
  const request = (changes = {}, body = "{}") => Object.assign(new Request("http://127.0.0.1:3002/dashboard/experiments/validate", { method: "POST", headers: { ...headers, ...changes }, body }), { nextUrl: new URL("http://127.0.0.1:3002") });
  for (const [req, status] of [
    [request({ "x-toss-trading-dashboard-intent": "paper-policy-validate" }), 403],
    [request({ "x-toss-trading-dashboard-intent": "paper-simulation-create" }), 403],
    [request({ origin: "http://evil.test" }), 403], [request({ origin: "null" }), 403],
    [request({ "sec-fetch-site": "cross-site" }), 403], [request({ "content-type": "text/plain" }), 415],
    [request({}, "null"), 400], [request({}, "[]"), 400], [request({}, "{"), 400], [request({}, JSON.stringify({ value: "가".repeat(12000) })), 413]
  ]) { assert.equal((await POST(req)).status, status); assert.equal(calls.length, 0); }
  assert.equal((await POST(request())).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8789/paper/simulations/validate");
  assert.equal(calls[0].init.headers["x-toss-trading-operation"], "paper-simulation-validate");
  assert.equal(calls[0].init.body, "{}");
  assert.equal(calls[0].init.headers["x-toss-trading-dashboard-mutation-token"], undefined);
});

test("exact-ID observations remain independent of missing index, child outcome and invalid wrappers", async (t) => {
  let payload;
  let status = 200;
  t.mock.method(globalThis, "fetch", async () => Response.json(payload, { status }));
  const source = await readFile(new URL("../src/lib/dashboardViewModels.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { readRunDetailPageData } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  const id = "paper_sim_20261003000000000_test";
  const accepted = { status: "available", schemaVersion: "paper_simulation_observation.v1", simulationRunId: id, batchId: id, acceptedAt: "2026-10-03T00:00:00.000Z", outcome: "unknown", runnerFailure: null };
  const base = { mode: "paper_only", readOnly: true, status: "missing", runs: [], batchId: null, simulationObservation: accepted };
  async function view() { return (await readRunDetailPageData(id)).runDetail; }
  payload = base;
  assert.equal((await view()).data.simulationObservation.outcome, "unknown");
  const failed = { ...accepted, outcome: "runner_failed", runnerFailure: { observedAt: "2026-10-03T00:00:01.000Z", reasonCode: "runner_rejected" } };
  payload = { ...base, simulationObservation: failed };
  assert.equal((await view()).data.simulationObservation.outcome, "runner_failed");
  for (const observation of [undefined, null, ...["missing", "invalid", "unavailable"].map(status => ({ status, simulationRunId: id }))]) {
    payload = { ...base, simulationObservation: observation };
    assert.equal((await view()).status, "ok");
  }
  for (const bad of [{ ...accepted, batchId: "wrong" }, { ...failed, simulationRunId: "wrong" }, { ...failed, runnerFailure: null }, { ...accepted, runnerFailure: failed.runnerFailure }]) {
    payload = { ...base, simulationObservation: bad }; assert.equal((await view()).data.simulationObservation.status, "invalid");
  }
  for (const childStatus of ["completed", "completed_with_failures", "failed", "skipped"]) {
    payload = { ...base, status: "ok", batchId: id, batchStatus: "completed_with_failures", simulationObservation: failed, runs: [{ runId: "child", batchId: id, status: childStatus }] };
    const result = await view();
    assert.equal(result.data.run.status, childStatus);
    assert.equal(result.data.simulationObservation.outcome, "runner_failed");
  }
  payload = { ...base, mode: "live" };
  assert.equal((await view()).status, "invalid");
  status = 503; payload = base;
  assert.equal((await view()).status, "offline");
});
