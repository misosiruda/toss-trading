import assert from "node:assert/strict";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { NodeProcessRunner } from "../ai/processRunner.js";
import { CodexCliDecisionProvider } from "../ai/codexCliDecisionProvider.js";
import { TossOpenApiReadOnlyHttpClient } from "../broker/tossOpenApiReadOnlyHttpClient.js";
import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";
import { HistoricalReplayAuditLogRecorder } from "../replay/historicalReplayAuditLog.js";
import { HistoricalReplayProgressRecorder } from "../replay/historicalReplayProgress.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH, paperExperimentExecutionFacts } from "../storage/paperExperimentExecutionReceipt.js";
import { inspectPaperExperimentAttempt } from "../storage/paperExperimentStore.js";
import { EXPERIMENT_TEST_RUNTIME, experimentFixtureJson } from "../storage/paperExperimentTestFixtures.js";
import { runHistoricalReplayWorkflow } from "./historicalReplayWorkflow.js";
import { createPaperExperimentFixtureProvider, PaperExperimentExecutionError, runPaperExperimentWorkflow } from "./paperExperimentWorkflow.js";

async function setup() {
  const rootDir = await mkdtemp(join(tmpdir(), "paper-experiment-workflow-"));
  return { rootDir, protectedPaths: [] as string[], runtimeIdentity: EXPERIMENT_TEST_RUNTIME,
    inputJson: await experimentFixtureJson(), createdAt: new Date() };
}
async function json(path: string) { return JSON.parse(await readFile(path, "utf8")); }
async function tree(path: string): Promise<unknown> {
  const entries = await readdir(path, { withFileTypes: true });
  return Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => [entry.name,
    entry.isDirectory() ? await tree(join(path, entry.name)) : await readFile(join(path, entry.name), "utf8")]));
}
function semantic(result: Awaited<ReturnType<typeof runPaperExperimentWorkflow>>) {
  const { manifestPath, ...manifest } = result.result.report.reproducibility; void manifestPath;
  return { replay: result.result.replayResult, report: { ...result.result.report, reproducibility: manifest } };
}

test("golden fixture uses existing Risk/fill/report and retains complete execution evidence", async () => {
  const options = await setup(); const inputBytes = options.inputJson;
  const run = await runPaperExperimentWorkflow(options);
  const inspection = await inspectPaperExperimentAttempt(options, run.attemptId);
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.state?.executionReceiptRequired, true);
  assert.equal(inspection.state?.artifactInventory?.length, 12);
  assert.deepEqual(run.result.report.replaySummary, { packetCount: 3, decisionProviderCallCount: 3, decisionSkippedCount: 0,
    decisionRecordCount: 3, decisionItemCount: 3, tradeCount: 1, rejectedCount: 2 });
  assert.ok(run.result.report.costSummary.totalCostKrw > 0);
  assert.equal(run.result.report.benchmarks.cashOnly.finalNetWorthKrw, 1_000_000);
  const timeline = (await readFile(join(run.artifactRoot, "replay/historical-replay-portfolio-timeline.jsonl"), "utf8")).trim().split("\n");
  assert.ok(timeline.length > 3); // Preserve all intra-tick effects; progress keeps the last row.
  const receipt = await json(join(run.artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH));
  assert.deepEqual(paperExperimentExecutionFacts(receipt), { providerFailureCount: 0, noCandidateTickCount: 0, decisionRejectedEventCount: 0 });
  assert.equal(options.inputJson, inputBytes);
});

test("independent outputs and explicit retry preserve identical semantic results, hashes and parent bytes", async () => {
  const a = await setup(); const b = await setup();
  const first = await runPaperExperimentWorkflow(a); const before = await tree(first.artifactRoot);
  const second = await runPaperExperimentWorkflow(b);
  assert.deepEqual(semantic(first), semantic(second));
  const { inputJson, ...retryOptions } = a; void inputJson;
  const retry = await runPaperExperimentWorkflow({ ...retryOptions, parentAttemptId: first.attemptId, createdAt: new Date() });
  assert.notEqual(retry.attemptId, first.attemptId);
  assert.equal((await inspectPaperExperimentAttempt(a, retry.attemptId)).state?.parentAttemptId, first.attemptId);
  assert.deepEqual(semantic(first), semantic(retry)); assert.deepEqual(await tree(first.artifactRoot), before);
});

test("all effective policy/cost values reach runner metadata, manifests and actual fills", async () => {
  const options = await setup(); const base = await runPaperExperimentWorkflow(options);
  const changed = JSON.parse(options.inputJson);
  changed.configuration.executionPolicy.feeBps = 55; changed.configuration.executionPolicy.halfSpreadBps = 7;
  changed.configuration.samplingPolicy.maxDecisionCalls = 1;
  const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(changed) }, { workflow: async (actual) => {
    assert.equal(actual.executionPolicy?.feeBps, 55); assert.equal(actual.executionPolicy?.halfSpreadBps, 7);
    assert.equal(actual.samplingPolicy?.metadata().maxDecisionCalls, 1);
    assert.ok(actual.riskPolicy); assert.ok(actual.allocationPolicy); assert.equal(actual.universeManifest?.symbols[0]?.lifecycleStatusSource, "explicit");
    return runHistoricalReplayWorkflow(actual);
  } });
  assert.notEqual(base.inputHash, run.inputHash);
  assert.notEqual(base.result.researchManifest.costModelHash, run.result.researchManifest.costModelHash);
  assert.ok(run.result.report.costSummary.feeKrw > base.result.report.costSummary.feeKrw);
  assert.equal(run.result.report.replaySummary.decisionProviderCallCount, 1);
  assert.equal(run.result.report.replaySummary.decisionSkippedCount, 2);
  assert.equal((await inspectPaperExperimentAttempt(options, run.attemptId)).status, "completed");
});

for (const scenario of ["hold", "risk_denial", "no_candidate", "provider_failure", "wrong_packet", "bad_ref", "bad_symbol", "bad_schema"] as const) {
  test(`negative scenario remains distinguishable: ${scenario}`, async () => {
    const options = await setup(); const input = JSON.parse(options.inputJson);
    if (scenario === "risk_denial") input.configuration.riskPolicy = { maxBudgetPerDecisionKrw: 1 };
    if (scenario === "no_candidate") {
      input.configuration.clock.startAt = "2024-12-31T00:00:00.000Z";
      input.configuration.maxSnapshotAgeSeconds = 1;
    }
    const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) }, { workflow: (actual) => runHistoricalReplayWorkflow({
      ...actual, decisionProvider: createPaperExperimentFixtureProvider((packet) => {
        const decision = new FirstPricedHistoricalDecisionProvider().decide(packet);
        if (scenario === "provider_failure") return null;
        if (scenario === "wrong_packet") decision.packetId = "wrong";
        if (scenario === "bad_ref") decision.decisions[0]!.dataRefs = ["fixture:other"];
        if (scenario === "bad_symbol") decision.decisions[0]!.symbol = "FIXTURE_OTHER";
        if (scenario === "bad_schema") return { ...decision, decisions: [{ action: "BUY" }] };
        if (scenario === "hold") decision.decisions = decision.decisions.map((item) => ({ ...item, action: "VIRTUAL_HOLD", budgetKrw: 0,
          holdReasonCode: "INSUFFICIENT_EVIDENCE" }));
        return decision;
      })
    }) });
    assert.equal((await inspectPaperExperimentAttempt(options, run.attemptId)).status, "completed");
    const facts = paperExperimentExecutionFacts(await json(join(run.artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH)));
    if (scenario === "hold") { assert.equal(run.result.report.decisionOutcome.byAction.VIRTUAL_HOLD, 3); assert.equal(run.result.report.replaySummary.tradeCount, 0); }
    else if (scenario === "risk_denial") { assert.ok(run.result.report.riskSummary.rejectedCount > 0); assert.equal(run.result.report.replaySummary.tradeCount, 0); }
    else if (scenario === "no_candidate") { assert.equal(facts.noCandidateTickCount, 1); assert.equal(facts.providerFailureCount, 0); }
    else { assert.equal(facts.providerFailureCount, 3); assert.equal(run.result.report.replaySummary.tradeCount, 0); assert.equal(run.result.report.replaySummary.decisionRecordCount, 0); }
  });
}

test("bad input and occupied attempt never invoke the runner or change existing bytes", async () => {
  const options = await setup(); let calls = 0;
  const workflow = async () => { calls++; throw new Error("must not run"); };
  await assert.rejects(runPaperExperimentWorkflow({ ...options, inputJson: "{}" }, { workflow }), { code: "INVALID_INPUT" });
  assert.deepEqual(await readdir(options.rootDir), []);
  const attemptId = "exp-existing"; await mkdir(join(options.rootDir, attemptId));
  await writeFile(join(options.rootDir, attemptId, "virtual-portfolio.json"), "sentinel"); const before = await tree(options.rootDir);
  await assert.rejects(runPaperExperimentWorkflow({ ...options, attemptId }, { workflow }), { code: "ATTEMPT_EXISTS" });
  assert.equal(calls, 0); assert.deepEqual(await tree(options.rootDir), before);
});

test("nonempty replay or changed materialized source is rejected before runner starts", async () => {
  for (const kind of ["portfolio", "source"] as const) {
    const options = await setup(); let calls = 0;
    await assert.rejects(runPaperExperimentWorkflow(options, { workflow: async () => { calls++; throw new Error(); },
      onPrepared: async ({ artifactRoot }) => writeFile(join(artifactRoot, kind === "portfolio" ? "replay/virtual-portfolio.json" : "input/historical-market-snapshots.jsonl"), "sentinel") }), PaperExperimentExecutionError);
    assert.equal(calls, 0);
    const id = (await readdir(options.rootDir))[0]!;
    assert.notEqual((await inspectPaperExperimentAttempt(options, id)).status, "completed");
  }
});

for (const phase of ["manifest_start", "progress_start", "audit_start", "runner", "report_write", "progress_complete", "audit_complete", "manifest_tamper", "report_tamper", "terminal_state"] as const) {
  test(`outer lifecycle is fail-closed at ${phase}`, async (t) => {
    const options = await setup(); let artifactRoot = "";
    if (phase === "progress_start" || phase === "progress_complete") t.mock.method(HistoricalReplayProgressRecorder.prototype,
      phase === "progress_start" ? "start" : "complete", async () => { throw new Error("injected"); });
    if (phase === "audit_start" || phase === "audit_complete") t.mock.method(HistoricalReplayAuditLogRecorder.prototype,
      phase === "audit_start" ? "start" : "complete", async () => { throw new Error("injected"); });
    let failure: PaperExperimentExecutionError | undefined;
    try { await runPaperExperimentWorkflow(options, { onPrepared: (attempt) => { artifactRoot = attempt.artifactRoot; }, workflow: async (actual) => {
      if (phase === "runner") throw new Error("injected");
      if (phase === "manifest_start" || phase === "report_write") await mkdir(join(actual.storageBaseDir,
        phase === "manifest_start" ? "historical-replay-research-manifest.json" : "historical-replay-report.json"));
      const result = await runHistoricalReplayWorkflow(actual);
      if (phase === "manifest_tamper") { const p = result.researchManifestPath; const value = await json(p); value.promptHash = createReplayResearchHash({ altered: true }); await writeFile(p, JSON.stringify(value)); }
      if (phase === "report_tamper") { const value = await json(result.reportPath); value.portfolio.finalCashKrw++; await writeFile(result.reportPath, JSON.stringify(value)); }
      if (phase === "terminal_state") await writeFile(join(artifactRoot, "experiment-run.json"), "{}");
      return result;
    } }); } catch (error) { assert.ok(error instanceof PaperExperimentExecutionError); failure = error; }
    assert.ok(failure); assert.notEqual((await inspectPaperExperimentAttempt(options, failure.attemptId)).status, "completed");
    assert.equal(failure.failureRecorded, phase !== "terminal_state");
    assert.ok((await readdir(artifactRoot)).includes("input"));
  });
}

test("completed receipt corruption/removal is detected on read without repairing artifacts", async () => {
  for (const corruption of ["missing", "truncated", "facts", "digest"] as const) {
    const options = await setup(); const run = await runPaperExperimentWorkflow(options);
    const path = join(run.artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH);
    if (corruption === "missing") await rm(path);
    else if (corruption === "truncated") await writeFile(path, "{");
    else { const receipt = await json(path); if (corruption === "facts") receipt.auditEvents.pop(); else receipt.artifactDigests.report = createReplayResearchHash({}); await writeFile(path, JSON.stringify(receipt)); }
    const before = await tree(run.artifactRoot);
    assert.equal((await inspectPaperExperimentAttempt(options, run.attemptId)).status, "incomplete");
    assert.deepEqual(await tree(run.artifactRoot), before);
  }
});

test("hostile AI/live environment cannot select any external execution path", async (t) => {
  let externalCalls = 0;
  const forbidden = () => { externalCalls++; throw new Error("External call forbidden in fixture workflow"); };
  for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"] as const) t.mock.method(childProcess, method, forbidden);
  t.mock.method(NodeProcessRunner.prototype, "run", forbidden);
  t.mock.method(CodexCliDecisionProvider.prototype, "decide", forbidden);
  t.mock.method(TossOpenApiReadOnlyHttpClient.prototype, "requestJson", forbidden);
  t.mock.method(globalThis, "fetch", forbidden); t.mock.method(http, "request", forbidden);
  t.mock.method(https, "request", forbidden); t.mock.method(net, "connect", forbidden);
  t.mock.method(net, "createConnection", forbidden); t.mock.method(tls, "connect", forbidden);
  t.mock.method(http, "get", forbidden); t.mock.method(https, "get", forbidden);
  syncBuiltinESMExports();
  const previous = { ...process.env };
  Object.assign(process.env, { AI_DECISION_ENABLED: "true", AI_DECISION_MODE: "live", CODEX_PATH: "/must-not-run", BROKER_PROVIDER: "live", TRADING_ENABLED: "true" });
  try {
    const options = await setup(); const run = await runPaperExperimentWorkflow(options);
    assert.equal(run.result.report.mode, "paper_only"); assert.equal(run.result.report.replaySummary.tradeCount, 1);
    assert.equal(externalCalls, 0);
    assert.deepEqual(paperExperimentExecutionFacts(await json(join(run.artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH))),
      { providerFailureCount: 0, noCandidateTickCount: 0, decisionRejectedEventCount: 0 });
  } finally { process.env = previous; t.mock.restoreAll(); syncBuiltinESMExports(); }
});
