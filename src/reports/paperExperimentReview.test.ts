import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { PAPER_EXPERIMENT_ARTIFACTS } from "../storage/paperExperimentContract.js";
import { PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH } from "../storage/paperExperimentExecutionReceipt.js";
import { createPaperExperimentAttempt } from "../storage/paperExperimentStore.js";
import { EXPERIMENT_TEST_RUNTIME, experimentFixtureJson, writeExperimentEvidence } from "../storage/paperExperimentTestFixtures.js";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { createPaperExperimentFixtureProvider, runPaperExperimentWorkflow } from "../workflows/paperExperimentWorkflow.js";
import { createPaperExperimentReview, renderPaperExperimentReviewMarkdown } from "./paperExperimentReview.js";
import { comparePaperExperimentEvidence, paperExperimentSemanticProjection, readPaperExperimentReviewEvidence } from "./paperExperimentReviewEvidence.js";
import { writePaperExperimentReview } from "./paperExperimentReviewOutput.js";

async function setup() {
  const rootDir = await fs.mkdtemp(join(tmpdir(), "paper-experiment-review-"));
  return { rootDir, protectedPaths: [] as string[], runtimeIdentity: EXPERIMENT_TEST_RUNTIME,
    inputJson: await experimentFixtureJson(), createdAt: new Date() };
}
async function tree(path: string): Promise<unknown> {
  return Promise.all((await fs.readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name)).map(async (entry) => [entry.name,
    entry.isDirectory() ? await tree(join(path, entry.name)) : (await fs.readFile(join(path, entry.name))).toString("base64")]));
}
async function json(path: string) { return JSON.parse(await fs.readFile(path, "utf8")); }

test("review projects exact existing costs/benchmarks and each action's packet/Risk/fill/portfolio evidence", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options); const before = await tree(run.artifactRoot);
  const review = await createPaperExperimentReview(options, run.attemptId);
  assert.equal(review.execution.status, "completed"); assert.equal(review.execution.integrity, "verified");
  assert.equal(review.inputEligibility.status, "available_fixture"); assert.equal(review.researchQuality.status, "usable_fixture");
  assert.deepEqual(review.costs!.value, run.result.report.costSummary);
  assert.deepEqual(review.benchmarks!.value, run.result.report.benchmarks);
  assert.deepEqual(review.statistics!.value.advancedPerformance, run.result.report.advancedPerformance);
  assert.equal(review.benchmarks!.value.cashOnly.feeDragKrw, 0);
  assert.equal(review.actions!.length, 3); assert.ok(review.actions![0]!.trades.length > 0);
  assert.ok(review.actions!.some((row) => row.risk.some((risk) => !risk.approved)));
  assert.ok(review.actions!.every((row) => row.item.dataRefs.length > 0 && row.portfolio.length > 0));
  const text = renderPaperExperimentReviewMarkdown(review);
  assert.match(text, /동일 초기 현금/); assert.match(text, /비용 0 및 packet/); assert.match(text, /판단 불가|결론낼 수 없다/);
  assert.match(text, /\]\(\.\.\/\.\.\/replay\/historical-replay-decisions.jsonl#\/0\/decisions\/0\)/);
  assert.equal(review.question!.evidence.field, "/question");
  assert.ok(!JSON.stringify(review).includes(options.rootDir)); assert.ok(!text.includes(options.rootDir));
  assert.deepEqual(await tree(run.artifactRoot), before);
});

for (const kind of ["hold", "risk_denial", "provider_failure", "no_candidate", "sampling_skip"] as const) {
  test(`review distinguishes ${kind} without guessing from absent decisions`, async () => {
    const options = await setup(); const input = JSON.parse(options.inputJson);
    if (kind === "risk_denial") input.configuration.riskPolicy = { maxBudgetPerDecisionKrw: 1 };
    if (kind === "no_candidate") { input.configuration.clock.startAt = "2024-12-31T00:00:00.000Z"; input.configuration.maxSnapshotAgeSeconds = 1; }
    if (kind === "sampling_skip") input.configuration.samplingPolicy.maxDecisionCalls = 1;
    const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) }, { workflow: (actual) => runHistoricalReplayWorkflow({
      ...actual, decisionProvider: createPaperExperimentFixtureProvider((packet) => {
        if (kind === "provider_failure") return null;
        const decision = new FirstPricedHistoricalDecisionProvider().decide(packet);
        if (kind === "hold") decision.decisions = decision.decisions.map((item) => ({ ...item, action: "VIRTUAL_HOLD", budgetKrw: 0, holdReasonCode: "INSUFFICIENT_EVIDENCE" }));
        return decision;
      })
    }) });
    const review = await createPaperExperimentReview(options, run.attemptId);
    assert.equal(review.execution.status, "completed");
    if (kind === "provider_failure") {
      assert.equal(review.researchQuality.status, "provider_failure"); assert.equal(review.researchQuality.providerFailureCount, 3);
      assert.ok(review.operationalEvidence!.events.some((row) => row.value.eventType === "HISTORICAL_AI_DECISION_FAILED"));
    } else if (kind === "no_candidate") {
      assert.equal(review.inputEligibility.status, "insufficient_data"); assert.equal(review.researchQuality.noCandidateTickCount, 1);
    } else if (kind === "sampling_skip") {
      assert.equal(review.outcomes!.value.sampling.decisionsSkipped, 2);
      assert.equal(review.operationalEvidence!.sampling.value.filter((row) => !row.shouldEvaluate).length, 2);
    } else if (kind === "hold") assert.ok(review.actions!.every((row) => row.item.action === "VIRTUAL_HOLD" && row.trades.length === 0));
    else assert.ok(review.actions!.every((row) => row.trades.length === 0 && row.risk.some((risk) => !risk.approved)));
  });
}

test("same fixed input in separate empty roots and retry compare identically without changing either source", async () => {
  const a = await setup(), b = await setup();
  const first = await runPaperExperimentWorkflow(a), second = await runPaperExperimentWorkflow(b);
  const before = await tree(first.artifactRoot), otherBefore = await tree(second.artifactRoot);
  const review = await createPaperExperimentReview(a, first.attemptId, { location: b, attemptId: second.attemptId });
  assert.equal(review.comparison!.status, "identical", JSON.stringify(review.comparison));
  assert.equal(review.comparison!.leftHash, review.comparison!.rightHash);
  const { inputJson, ...retryOptions } = a; void inputJson;
  const retry = await runPaperExperimentWorkflow({ ...retryOptions, parentAttemptId: first.attemptId, createdAt: new Date() });
  assert.equal((await createPaperExperimentReview(a, first.attemptId, { location: a, attemptId: retry.attemptId })).comparison!.status, "identical");
  assert.deepEqual(await tree(first.artifactRoot), before); assert.deepEqual(await tree(second.artifactRoot), otherBefore);
});

test("comparison rejects input, code, dependency lock and Node differences instead of ranking returns", async () => {
  const a = await setup(); const first = await runPaperExperimentWorkflow(a);
  for (const kind of ["cost", "risk", "coverage", "revision", "lock", "node"]) {
    const input = JSON.parse(a.inputJson), runtimeIdentity = { ...a.runtimeIdentity };
    if (kind === "cost") input.configuration.executionPolicy.feeBps = 10;
    if (kind === "risk") input.configuration.riskPolicy = { maxBudgetPerDecisionKrw: 1 };
    if (kind === "coverage") input.configuration.maxSnapshotAgeSeconds = 1;
    if (kind === "revision") runtimeIdentity.implementationRevision = "2".repeat(40);
    if (kind === "lock") runtimeIdentity.dependencyLockHash = createReplayResearchHash("another-lock");
    if (kind === "node") runtimeIdentity.nodeVersion = "v22.0.0";
    const other = await runPaperExperimentWorkflow({ ...a, inputJson: JSON.stringify(input), runtimeIdentity });
    const comparison = (await createPaperExperimentReview(a, first.attemptId, { location: a, attemptId: other.attemptId })).comparison!;
    assert.equal(comparison.status, "incomparable", kind); assert.equal(comparison.leftHash, null);
    assert.ok(comparison.reasons.includes(["lock", "node", "revision"].includes(kind) ? "RUNTIME_MISMATCH" : "INPUT_MISMATCH"));
  }
});

test("semantic projection strips only documented operational fields and preserves every meaningful evidence family", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const evidence = await readPaperExperimentReviewEvidence(options, run.attemptId);
  const altered = structuredClone(evidence);
  altered.metadata!.identity.runId = "exp-another"; altered.metadata!.logPaths.runMetadataPath = "/another/location";
  altered.metadata!.updatedAt = "2026-10-03T00:00:00.000Z";
  altered.progress!.updatedAt = "2026-10-03T00:00:00.000Z"; altered.progress!.finalReportPath = "/another/report";
  altered.manifest!.runId = "exp-another"; altered.metadata!.researchManifest.runId = "exp-another";
  altered.execution!.runId = "exp-another"; altered.execution!.expectedManifest.runId = "exp-another";
  altered.execution!.artifactDigests.manifest = createReplayResearchHash("identity-only");
  altered.execution!.artifactDigests.report = createReplayResearchHash("path-only");
  altered.report!.reproducibility.manifestPath = "/another/manifest";
  assert.deepEqual(paperExperimentSemanticProjection(evidence), paperExperimentSemanticProjection(altered));
  const mutations = [
    (e: typeof evidence) => { e.decisions![0]!.decisions[0]!.dataRefs = ["different-source"]; },
    (e: typeof evidence) => { e.risks![0]!.rejectCodes.push("CHANGED"); },
    (e: typeof evidence) => { e.trades![0]!.totalCostKrw = 999; },
    (e: typeof evidence) => { e.report!.costSummary.feeKrw++; },
    (e: typeof evidence) => { e.manifest!.coverageHash = createReplayResearchHash("coverage"); },
    (e: typeof evidence) => { e.timeline![0]!.simulatedAt = "2025-01-02T00:00:00.000Z"; },
    (e: typeof evidence) => { e.progress!.simulatedAt = "2025-01-02T00:00:00.000Z"; },
    (e: typeof evidence) => { e.execution!.warnings.push("retained warning"); },
    (e: typeof evidence) => { e.execution!.samplingDecisions[0]!.candidateFingerprint = "changed"; },
    (e: typeof evidence) => { e.packets!.reverse(); },
    (e: typeof evidence) => { e.timeline!.reverse(); },
    (e: typeof evidence) => { e.timeline![0]!.portfolio.cashKrw++; },
    (e: typeof evidence) => { e.execution!.auditEvents[0]!.summary = "changed retained evidence"; },
    (e: typeof evidence) => { e.execution!.auditEvents[0]!.createdAt = "2025-01-02T00:00:00.000Z"; }
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidence); changed.inspection.state!.attemptId = "exp-other"; mutate(changed);
    // Pure projection coverage test only; persisted corruption is rejected before comparison below.
    assert.equal(comparePaperExperimentEvidence(evidence, changed).status, "mismatch");
  }
});

for (const corruption of ["missing", "json", "utf8", "row_truncation", "torn_row", "report_number", "receipt", "input", "state"] as const) {
  test(`review fails closed for ${corruption} and never converts missing evidence to zero`, async () => {
    const options = await setup(); const run = await runPaperExperimentWorkflow(options);
    let path = join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.report);
    if (corruption === "missing") await fs.rm(path);
    else if (corruption === "json") await fs.writeFile(path, "{");
    else if (corruption === "utf8") await fs.writeFile(path, Buffer.from([0xff]));
    else if (corruption === "report_number") { const report = await json(path); report.costSummary.feeKrw++; await fs.writeFile(path, JSON.stringify(report)); }
    else if (corruption === "receipt") await fs.rm(join(run.artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH));
    else if (corruption === "input") await fs.writeFile(join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.input), "{}");
    else if (corruption === "state") await fs.writeFile(join(run.artifactRoot, "experiment-run.json"), "{}");
    else {
      path = join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.decisions); const text = await fs.readFile(path, "utf8");
      await fs.writeFile(path, corruption === "row_truncation" ? text.split("\n").slice(1).join("\n") : text.slice(0, -2));
    }
    const before = await tree(run.artifactRoot);
    const review = await createPaperExperimentReview(options, run.attemptId, { location: options, attemptId: run.attemptId });
    assert.equal(review.execution.status, "incomplete"); assert.equal(review.researchQuality.status, "unavailable");
    assert.equal(review.researchQuality.providerFailureCount, null); assert.equal(review.costs, null); assert.equal(review.benchmarks, null);
    assert.equal(review.actions, null); assert.equal(review.comparison!.status, "incomparable");
    assert.deepEqual(await tree(run.artifactRoot), before);
  });
}

test("prepared, running and failed attempts retain partial evidence without inferring liveness or research success", async () => {
  const options = await setup(); const owner = await createPaperExperimentAttempt({ ...options, executionReceiptRequired: true });
  for (const status of ["prepared", "running", "failed"]) {
    if (status === "running") await owner.start(new Date());
    if (status === "failed") await owner.fail("execution_failed", new Date());
    const review = await createPaperExperimentReview(options, owner.attemptId);
    assert.equal(review.execution.storedStatus, status);
    assert.equal(review.execution.status, status === "failed" ? "failed" : "incomplete");
    assert.equal(review.costs, null); assert.equal(review.actions, null); assert.equal(review.researchQuality.providerFailureCount, null);
    assert.equal(review.inputEligibility.status, "available_fixture");
  }
});

test("legacy storage-only completion cannot impersonate executed evidence", async () => {
  const options = await setup(); const owner = await createPaperExperimentAttempt(options);
  await owner.start(new Date()); await writeExperimentEvidence(owner); await owner.complete(new Date());
  const review = await createPaperExperimentReview(options, owner.attemptId);
  assert.equal(review.execution.storedStatus, "completed"); assert.equal(review.execution.status, "incomplete");
  assert.equal(review.execution.errorCode, "EXECUTION_RECEIPT_REQUIRED"); assert.equal(review.costs, null);
});

test("review never launches any process or network request and ignores malformed unknown files", async (t) => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  await fs.writeFile(join(run.artifactRoot, "unexpected-secret-file"), "{not-json");
  let calls = 0; const forbidden = () => { calls++; throw new Error("must not execute"); };
  t.mock.method(globalThis, "fetch", forbidden);
  for (const method of ["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync"] as const) t.mock.method(childProcess, method, forbidden);
  syncBuiltinESMExports();
  try { assert.equal((await createPaperExperimentReview(options, run.attemptId)).execution.status, "completed"); assert.equal(calls, 0); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test("untrusted question/source text is escaped and credentials/local paths never become report links", async () => {
  const options = await setup(); const input = JSON.parse(options.inputJson);
  input.question = '[click](file:///home/alice/secret) <script>alert(1)</script> token=SECRET_VALUE sk-abcdefghijklmno\nC:\\Users\\alice\\secrets.txt';
  input.source.coverageDescription = '/home/alice/private token=SECOND_SECRET';
  input.evaluation.reviewQuestions = ['![x](https://evil.invalid/steal) <img src=x onerror=alert(1)>'];
  const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) });
  const review = await createPaperExperimentReview(options, run.attemptId); const text = renderPaperExperimentReviewMarkdown(review);
  for (const secret of ["SECRET_VALUE", "SECOND_SECRET", "sk-abcdefghijklmno", "/home/alice", "C:\\Users", "https://evil.invalid"]) {
    assert.ok(!JSON.stringify(review).includes(secret), secret); assert.ok(!text.includes(secret), secret);
  }
  assert.ok(!text.includes("<script>")); assert.ok(!text.includes("<img")); assert.ok(!text.includes("[click]("));
  assert.match(text, /&lt;script&gt;/); assert.equal(review.question!.evidence.field, "/question");
});

test("safe output generations are separate and atomic; repeated reviews preserve source/replay and earlier outputs", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const input = await tree(join(run.artifactRoot, "input")), replay = await tree(join(run.artifactRoot, "replay"));
  const state = await fs.readFile(join(run.artifactRoot, "experiment-run.json"));
  const first = await writePaperExperimentReview(options, run.attemptId);
  const firstTree = await tree(join(run.artifactRoot, "review", first.reviewId));
  const second = await writePaperExperimentReview(options, run.attemptId);
  assert.notEqual(first.reviewId, second.reviewId);
  assert.deepEqual(await tree(join(run.artifactRoot, "review", first.reviewId)), firstTree);
  assert.deepEqual(await tree(join(run.artifactRoot, "input")), input); assert.deepEqual(await tree(join(run.artifactRoot, "replay")), replay);
  assert.deepEqual(await fs.readFile(join(run.artifactRoot, "experiment-run.json")), state);
  const marker = await json(join(run.artifactRoot, first.files.completion));
  assert.equal(marker.jsonDigest, createReplayResearchHash(await json(join(run.artifactRoot, first.files.json))));
  assert.equal(marker.markdownDigest, createReplayResearchHash(await fs.readFile(join(run.artifactRoot, first.files.markdown), "utf8")));
  assert.deepEqual((await fs.readdir(join(run.artifactRoot, "review", first.reviewId))).sort(), ["review-complete.json", "review.json", "review.md"]);
});

test("review reader rejects symlink, hardlink and malicious stored paths without reading outside bytes", async () => {
  for (const kind of ["symlink", "hardlink", "stored_path"]) {
    const options = await setup(); const run = await runPaperExperimentWorkflow(options);
    const outside = join(await fs.mkdtemp(join(tmpdir(), "review-outside-")), "secret"); await fs.writeFile(outside, "PRIVATE_SENTINEL");
    const path = join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.report);
    if (kind === "stored_path") {
      const report = await json(path); report.reproducibility.manifestPath = outside; await fs.writeFile(path, JSON.stringify(report));
    } else { await fs.rm(path); await (kind === "symlink" ? fs.symlink(outside, path) : fs.link(outside, path)); }
    const review = await createPaperExperimentReview(options, run.attemptId);
    assert.equal(review.execution.status, "incomplete"); assert.ok(!JSON.stringify(review).includes("PRIVATE_SENTINEL"));
    assert.equal(await fs.readFile(outside, "utf8"), "PRIVATE_SENTINEL");
  }
});

test("review output rejects aliased directories, traversal and protected overlaps", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const outside = await fs.mkdtemp(join(tmpdir(), "review-output-outside-")); await fs.writeFile(join(outside, "sentinel"), "unchanged");
  await fs.symlink(outside, join(run.artifactRoot, "review"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(writePaperExperimentReview(options, run.attemptId), { code: "PATH_UNSAFE" });
  await assert.rejects(writePaperExperimentReview(options, "../outside"), { code: "INVALID_REQUEST" });
  await assert.rejects(writePaperExperimentReview({ ...options, protectedPaths: [options.rootDir] }, run.attemptId), { code: "PATH_UNSAFE" });
  assert.deepEqual(await fs.readdir(outside), ["sentinel"]);
});

test("output write/sync/rename crash preserves partial generation without completion marker or source changes", async (t) => {
  for (const phase of ["write", "sync", "rename"]) {
    const options = await setup(); const run = await runPaperExperimentWorkflow(options);
    const replay = await tree(join(run.artifactRoot, "replay"));
    const originalOpen = fs.open.bind(fs); const originalRename = fs.rename.bind(fs);
    if (phase === "rename") t.mock.method(fs, "rename", async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (String(from).endsWith("review.md.tmp")) throw new Error("fault");
      return originalRename(from, to);
    });
    else t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).endsWith("review.md.tmp")) t.mock.method(handle, phase === "write" ? "writeFile" : "sync", async () => { throw new Error("fault"); });
      return handle;
    });
    syncBuiltinESMExports();
    try { await assert.rejects(writePaperExperimentReview(options, run.attemptId), { code: "IO_FAILURE" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    const generations = await fs.readdir(join(run.artifactRoot, "review")); assert.equal(generations.length, 1);
    const names = await fs.readdir(join(run.artifactRoot, "review", generations[0]!));
    assert.ok(names.includes("review.md.tmp")); assert.ok(!names.includes("review-complete.json"));
    assert.deepEqual(await tree(join(run.artifactRoot, "replay")), replay);
    const next = await writePaperExperimentReview(options, run.attemptId);
    assert.notEqual(next.reviewId, generations[0]);
    assert.equal((await createPaperExperimentReview(options, run.attemptId)).execution.status, "completed");
  }
});

test("public review rejects malformed comparison identity before exposing caller text", async () => {
  const options = await setup();
  for (const id of ["../private/path", "token=PRIVATE_SECRET", "exp-one\ncontrol", "x".repeat(81)]) {
    await assert.rejects(createPaperExperimentReview(options, "exp-one", { location: options, attemptId: id }), { code: "INVALID_REQUEST" });
  }
});

test("a changing read snapshot cannot retain trusted execution or input eligibility", async (t) => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const original = fs.open.bind(fs); let stateReads = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === join(run.artifactRoot, "experiment-run.json") && ++stateReads === 2) {
      await fs.writeFile(join(run.artifactRoot, "experiment-run.json"), "{}");
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const review = await createPaperExperimentReview(options, run.attemptId);
    assert.equal(review.execution.status, "incomplete"); assert.equal(review.inputEligibility.integrity, "unavailable");
    assert.equal(review.costs, null); assert.equal(review.researchQuality.providerFailureCount, null);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test("concurrent review publication allocates distinct complete generations", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const results = await Promise.all([writePaperExperimentReview(options, run.attemptId), writePaperExperimentReview(options, run.attemptId)]);
  assert.notEqual(results[0].reviewId, results[1].reviewId);
  for (const result of results) assert.equal((await json(join(run.artifactRoot, result.files.completion))).reviewId, result.reviewId);
});

test("claim references use exact hash fields and RFC JSON pointer roots for complete derivation inputs", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const review = await createPaperExperimentReview(options, run.attemptId);
  const input = await json(join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.input));
  const decisions = (await fs.readFile(join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.decisions), "utf8"))
    .trimEnd().split("\n").map((line) => JSON.parse(line));
  const pointer = (document: unknown, field: string): unknown => {
    assert.ok(field === "" || field.startsWith("/"));
    return field === "" ? document : field.slice(1).split("/").reduce<unknown>((value, key) => {
      assert.ok(value !== null && typeof value === "object");
      return (value as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, document);
  };
  for (const action of review.actions!) {
    assert.equal(pointer(decisions, action.decisionHashEvidence.field), action.decisionHash);
    assert.deepEqual(pointer(decisions, action.evidence.field), action.item);
    assert.ok(action.packetHashEvidence); assert.equal(pointer(decisions, action.packetHashEvidence.field), action.packetHash);
    const packets = (await fs.readFile(join(run.artifactRoot, PAPER_EXPERIMENT_ARTIFACTS.packets), "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(pointer(packets, action.simulatedAtEvidence.field), action.simulatedAt);
    assert.match(action.decisionHashEvidence.field, /^\/\d+\/decisionHash$/);
    assert.ok(renderPaperExperimentReviewMarkdown(review).includes(`historical-replay-decisions.jsonl#${action.decisionHashEvidence.field})`));
  }
  assert.equal(pointer({}, "/"), undefined); // RFC 6901: slash selects an empty key, never the whole document.
  assert.equal(review.coverage!.evidence.field, "");
  const coverageInput = pointer(input, review.coverage!.evidence.field) as typeof input;
  for (const field of ["source", "configuration", "universe", "evaluation"]) assert.deepEqual(coverageInput[field], input[field]);
  assert.equal(review.coverage!.evidence.href, "../../input/experiment-input.json#");
  assert.deepEqual(review.coverage!.derivation, { algorithm: "parsePaperExperimentInput", inputs: [review.coverage!.evidence] });
  assert.equal(review.operationalEvidence!.facts.derivation.algorithm, "paperExperimentExecutionFacts");
  const state = await json(join(run.artifactRoot, "experiment-run.json"));
  assert.equal(pointer(state, review.inputEligibility.inputHashEvidence.field), review.inputEligibility.inputHash);
  assert.deepEqual(pointer(state, review.inputEligibility.runtimeIdentityEvidence.field), review.inputEligibility.runtimeIdentity);
  assert.equal(pointer(state, review.execution.storedStatusEvidence.field), review.execution.storedStatus);
  assert.equal(pointer(state, review.execution.terminationReasonEvidence.field), review.execution.terminationReason);
  assert.equal(review.execution.derivation.inputs.length, 13);
  assert.equal(review.researchQuality.derivation.inputs.length, 13);
  for (const name of ["experiment-run.json", "experiment-input.json", "paper-experiment-execution.json"]) {
    assert.ok(review.researchQuality.derivation.inputs.some((row) => row.artifact === name));
  }
  assert.equal(review.scope!.evidence.field, ""); assert.equal(review.manifest!.evidence.field, "");
  assert.equal(review.outcomes!.evidence.field, ""); assert.equal(review.statistics!.evidence.field, "");
  assert.ok(renderPaperExperimentReviewMarkdown(review).includes("](../../input/experiment-input.json#)"));
});
