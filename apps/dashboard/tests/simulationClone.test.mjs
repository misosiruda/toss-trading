import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createReplayResearchHash } from "../../../dist/replay/replayRunManifest.js";
import { validatePaperSimulationCandidate } from "../../../dist/api/paperSimulationConfig.js";
const copy = value => JSON.parse(JSON.stringify(value));
async function load(file, modules = {}, globals = {}) {
  const source = await readFile(new URL("../src/" + file, import.meta.url), "utf8"); const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, AbortSignal, Buffer, TextDecoder, require: name => { if (!(name in modules)) throw Error("Unexpected import " + name); return modules[name]; }, ...globals }); return exports;
}
const candidate = await load("lib/simulationCandidate.ts");
const clone = await load("lib/simulationClone.ts", { "./simulationCandidate": candidate });
const id = "paper_sim_20261001000000000_clone-source";
function request() {
  return { mode: "paper_only", runType: "batch_replay", runCount: 3, sourceDataDir: "data/synthetic-clone", universe: { preset: "original-metadata", market: "mixed_global" },
    window: { mode: "random_month", seed: "original-seed", startAt: "2024-01-01", endAt: "2024-12-31", windowMonths: 2 },
    samplingPolicy: { decisionFrequency: "once_per_week", stepSeconds: 86400, maxDecisionCalls: 5, maxCodexCallsPerRun: 7 }, capital: { initialCashKrw: 900000 },
    decisionProvider: { mode: "dry_run_fixture", modelId: "original-fixture-model", outputSchema: "schemas/virtual-decision.schema.json" }, riskProfile: "balanced", paperExitPolicy: "none",
    executionCosts: { feeBps: 12.5, taxBps: 0, slippageBps: 0.125 }, costModel: "standard", benchmarkPolicy: "cash_equal_weight_initial_hold" };
}
function source(config = request()) {
  const body = { mode: "paper_only", readOnly: true, status: "available", schemaVersion: "paper_simulation_canonical_request.v1", simulationRunId: id, batchId: id, acceptedAt: "2026-10-01T00:00:00.000Z",
    sourceRuntime: { schemaVersion: "paper_simulation_source_runtime.v1", sourceRuntimeId: "aaaaaaaa-1234-4567-8123-abcdefabcdef", nodeVersion: process.version, executionModelVersion: "execution_simulator.v4" }, requestedConfig: config };
  return { ...body, canonicalRequestHash: createReplayResearchHash({ schemaVersion: body.schemaVersion, simulationRunId: id, batchId: id, acceptedAt: body.acceptedAt, sourceRuntime: body.sourceRuntime, requestedConfig: config, redacted: false }) };
}
test("clone preserves original whole-batch metadata, optional omissions, random seed/range and caller decimals", () => {
  for (const absentCount of [false, true]) for (const absentCosts of [false, true]) {
    const original = request(); if (absentCount) delete original.runCount; if (absentCosts) delete original.executionCosts;
    const payload = source(original), read = clone.readCloneSource(payload, id), draft = clone.faithfulCloneDraft(read);
    assert.ok(read); assert.ok(draft); assert.deepEqual(copy(candidate.typedCandidate(draft, read.requestedConfig)), original);
    assert.equal(draft.runCount, absentCount ? "" : "3"); assert.equal(draft.feeBps, absentCosts ? "" : "12.5");
    assert.equal("sha256:" + createHash("sha256").update(clone.cloneCanonicalText(read)).digest("hex"), payload.canonicalRequestHash);
    const edited = candidate.typedCandidate({ ...draft, seed: "edited-seed", initialCashKrw: "800000" }, original);
    assert.equal(edited.window.seed, "edited-seed"); assert.equal(edited.capital.initialCashKrw, 800000);
    assert.deepEqual(copy(edited.universe), original.universe); assert.deepEqual(copy(edited.decisionProvider), original.decisionProvider);
    assert.equal(edited.samplingPolicy.maxCodexCallsPerRun, 7);
    const validated = validatePaperSimulationCandidate(edited, {});
    assert.ok(candidate.readValidation(copy(validated), edited));
    assert.deepEqual(validated.requestedConfig, copy(edited)); assert.equal(validated.effectiveConfig.samplingPolicy.maxCodexCallsPerRun, 0);
  }
});
test("optional omissions become explicit only after owned edits; partial costs never fill with defaults", () => {
  const original = request(); delete original.runCount; delete original.executionCosts;
  const draft = clone.cloneDraft(source(original));
  assert.equal(candidate.typedCandidate({ ...draft, feeBps: "1" }, original), null);
  assert.deepEqual(copy(candidate.typedCandidate({ ...draft, feeBps: "0", taxBps: "2.5", slippageBps: "0.5", runCount: "2" }, original).executionCosts), { feeBps: 0, taxBps: 2.5, slippageBps: 0.5 });
  const validation = validatePaperSimulationCandidate(original, {}); validation.effectiveConfig.costModel.executionPolicy.feeBps = -1;
  assert.equal(candidate.readValidation(copy(validation), original), null);
});
test("inherited provider/model/schema and cap never switch to fixture or enable current provider guard", () => {
  const original = request(); original.decisionProvider.mode = "codex_paper_only"; original.decisionProvider.modelId = "synthetic-codex-model";
  const read = clone.readCloneSource(source(original), id), copied = candidate.typedCandidate(clone.faithfulCloneDraft(read), original);
  assert.deepEqual(copy(copied), original); assert.throws(() => validatePaperSimulationCandidate(copied, {}));
  // DTO parser boundary only: never enable or invoke the Codex provider.
  const dto = copy(validatePaperSimulationCandidate(request(), {})); dto.requestedConfig = copy(original);
  dto.effectiveConfig.decisionProvider = copy(original.decisionProvider); dto.effectiveConfig.samplingPolicy.maxCodexCallsPerRun = 7;
  assert.ok(candidate.readValidation(dto, original));
  dto.effectiveConfig.decisionProvider.modelId = "different-model"; assert.equal(candidate.readValidation(dto, original), null);
  dto.effectiveConfig.decisionProvider.modelId = original.decisionProvider.modelId; dto.effectiveConfig.decisionProvider.outputSchema = "different-schema"; assert.equal(candidate.readValidation(dto, original), null);
});
test("incomplete, unknown, masked, unsafe identity and malformed DTOs stay unavailable without defaults", () => {
  const original = source(); const negatives = [
    v => v.status = "unavailable", v => v.schemaVersion = "future", v => v.batchId = id + "_child", v => v.simulationRunId = "latest", v => v.canonicalRequestHash = "missing", v => v.acceptedAt = "invalid",
    v => v.sourceRuntime.sourceRuntimeId = "aaaaaaaa-****-****-****-abcdefabcdef", v => v.sourceRuntime.schemaVersion = "future", v => v.sourceRuntime.nodeVersion = "abcdefghijklmnop.abcdefgh.ijklmnop",
    v => v.requestedConfig.window.seed = "abcdefghijklmnop.abcdefgh.ijklmnop", v => v.requestedConfig.sourceDataDir = "123-456-789", v => v.requestedConfig.decisionProvider.modelId = "***.***.***",
    v => v.requestedConfig.executionCosts = { feeBps: 1 }, v => v.requestedConfig.executionCosts.taxBps = -1, v => v.requestedConfig.runCount = null, v => v.requestedConfig.costModel = "high_cost",
    v => v.requestedConfig.benchmarkPolicy = "cash_only", v => v.requestedConfig.token = "must-not-restore", v => delete v.requestedConfig.samplingPolicy.maxCodexCallsPerRun, v => delete v.requestedConfig.window.seed,
    v => delete v.requestedConfig.universe.preset, v => delete v.requestedConfig.decisionProvider.modelId, v => v.requestedConfig.window.childWindow = {}, v => v.debug = "never-forward"
  ];
  for (const mutate of negatives) { const bad = copy(original); mutate(bad); assert.equal(clone.readCloneSource(bad, id), null); }
  for (const target of ["latest", id + "/child", id + "\n", "../escape"]) assert.equal(clone.readCloneSource(original, target), null);
  assert.deepEqual(original, source());
});
test("raw clone draft restoration requires fresh source/hash and never restores tokens, receipts or legacy cost defaults", () => {
  const original = source(), draft = clone.cloneDraft(original); draft.seed = "edited";
  const envelope = copy(clone.cloneDraftEnvelope(original, { ...draft, token: "private", receipt: {}, admission: "response_unknown" }));
  assert.deepEqual(Object.keys(envelope).sort(), ["canonicalRequestHash", "draft", "sourceId"]);
  assert.equal("token" in envelope.draft, false); assert.equal("receipt" in envelope.draft, false); assert.equal("admission" in envelope.draft, false);
  assert.deepEqual(copy(clone.restoreCloneDraft(envelope, original)), copy(draft));
  for (const bad of [{ ...envelope, sourceId: "another" }, { ...envelope, canonicalRequestHash: "sha256:" + "0".repeat(64) }, { ...envelope, token: "private" }]) assert.equal(clone.restoreCloneDraft(bad, original), null);
  const incomplete = copy(envelope); for (const key of ["feeBps", "taxBps", "slippageBps"]) delete incomplete.draft[key];
  assert.equal(clone.restoreCloneDraft(incomplete, original), null);
});
test("clone GET BFF is bounded, exact-ID/hash bound, read-only and rejects HEAD/malformed queries before upstream", async () => {
  let payload = source(), upstreamStatus = 200, calls = [], bodyOverride;
  const route = await load("app/dashboard/experiments/clone/route.ts", {
    "node:crypto": { createHash }, "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/dashboardViewModels": { readOperationsApiConfig: () => ({ baseUrl: "http://127.0.0.1:8789" }) }, "@/lib/simulationClone": clone
  }, { fetch: async (url, init) => { calls.push({ url, init }); return bodyOverride === undefined ? Response.json(payload, { status: upstreamStatus }) : new Response(bodyOverride, { status: upstreamStatus }); } });
  const req = query => ({ nextUrl: new URL("http://127.0.0.1:3002/dashboard/experiments/clone" + query) });
  assert.equal((await route.HEAD()).status, 405);
  for (const query of ["", "?simulationRunId=latest", "?simulationRunId=" + id + "&simulationRunId=" + id, "?simulationRunId=" + id + "&extra=1"]) assert.equal((await route.GET(req(query))).status, 400);
  assert.equal(calls.length, 0);
  const url = "?simulationRunId=" + id; const response = await route.GET(req(url)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), payload);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "http://127.0.0.1:8789/paper/simulations/request?simulationRunId=" + id); assert.equal(calls[0].init.method, "GET"); assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.body, undefined); assert.equal(calls[0].init.headers.authorization, undefined); assert.equal(calls[0].init.headers["x-toss-trading-dashboard-mutation-token"], undefined);
  for (const mutate of [v => v.requestedConfig.window.seed = "changed-with-old-hash", v => v.canonicalRequestHash = "sha256:" + "0".repeat(64), v => v.batchId = "another", v => v.debug = "never-forward", v => v.requestedConfig = {}]) {
    payload = source(); mutate(payload); const bad = await route.GET(req(url)); assert.equal((await bad.json()).status, "unavailable");
  }
  payload = source(); upstreamStatus = 503; assert.equal((await (await route.GET(req(url))).json()).status, "unavailable"); upstreamStatus = 200;
  for (const body of ["x".repeat(32769), "{", Uint8Array.from([0xff])]) { bodyOverride = body; assert.equal((await (await route.GET(req(url))).json()).status, "unavailable"); }
});
