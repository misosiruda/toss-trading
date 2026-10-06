import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";

import { FirstPricedHistoricalDecisionProvider } from "../replay/historicalReplayRunner.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { PAPER_EXPERIMENT_ARTIFACTS } from "../storage/paperExperimentContract.js";
import { PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH } from "../storage/paperExperimentExecutionReceipt.js";
import { createPaperExperimentAttempt } from "../storage/paperExperimentStore.js";
import { EXPERIMENT_TEST_RUNTIME, experimentFixtureJson, writeExperimentEvidence } from "../storage/paperExperimentTestFixtures.js";
import { runHistoricalReplayWorkflow } from "../workflows/historicalReplayWorkflow.js";
import { createPaperExperimentFixtureProvider, runPaperExperimentWorkflow } from "../workflows/paperExperimentWorkflow.js";
import { createPaperExperimentReview, renderPaperExperimentReviewMarkdown, safePaperExperimentReviewValue } from "./paperExperimentReview.js";
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

test("comparison identity includes validated physical storage namespace without publishing it", async (t) => {
  const parent = await fs.mkdtemp(join(tmpdir(), "paper-experiment-origin-")), base = await setup();
  const attemptId = "exp-same-backend-id", a = { ...base, rootDir: join(parent, "Case") };
  const first = await runPaperExperimentWorkflow({ ...a, attemptId });
  let caseAlias = false;
  try { caseAlias = (await fs.stat(join(parent, "case"))).ino === (await fs.stat(a.rootDir)).ino; }
  catch { /* Case-distinct path does not exist yet. */ }
  const b = { ...base, rootDir: join(parent, caseAlias ? "Other" : "case") };
  const second = await runPaperExperimentWorkflow({ ...b, attemptId });
  t.diagnostic(caseAlias ? "case-insensitive alias also self-rejects" : "case-distinct roots remain distinct");
  const before = await tree(first.artifactRoot), otherBefore = await tree(second.artifactRoot);
  const left = await readPaperExperimentReviewEvidence(a, attemptId), right = await readPaperExperimentReviewEvidence(b, attemptId);
  assert.notEqual(left.storageOrigin, right.storageOrigin);
  assert.equal(comparePaperExperimentEvidence(left, right).status, "identical");
  assert.deepEqual(paperExperimentSemanticProjection(left), paperExperimentSemanticProjection(right));
  const review = await createPaperExperimentReview(a, attemptId, { location: b, attemptId });
  assert.equal(review.comparison!.status, "identical");
  for (const output of [JSON.stringify(review), renderPaperExperimentReviewMarkdown(review), JSON.stringify(paperExperimentSemanticProjection(left))]) {
    assert.ok(!output.includes("storageOrigin")); assert.ok(!output.includes(left.storageOrigin!));
  }
  for (const rootDir of [a.rootDir, a.rootDir + "/.", a.rootDir + "//", ...(caseAlias ? [join(parent, "case")] : [])]) {
    const self = await createPaperExperimentReview(a, attemptId, { location: { ...a, rootDir }, attemptId });
    assert.equal(self.comparison!.status, "incomparable"); assert.ok(self.comparison!.reasons.includes("DISTINCT_ATTEMPTS_REQUIRED"));
  }
  const previous = process.cwd();
  try {
    process.chdir(dirname(a.rootDir));
    const relative = await createPaperExperimentReview({ ...a, rootDir: basename(a.rootDir) }, attemptId, { location: a, attemptId });
    assert.ok(relative.comparison!.reasons.includes("DISTINCT_ATTEMPTS_REQUIRED"));
  } finally { process.chdir(previous); }
  for (const origin of [null, undefined, "", "sha256:invalid"]) {
    const unknown = { ...right, storageOrigin: origin } as typeof right;
    assert.ok(comparePaperExperimentEvidence(left, unknown).reasons.includes("VERIFIED_STORAGE_ORIGIN_REQUIRED"));
  }
  const linked = join(parent, "linked"); await fs.symlink(a.rootDir, linked, process.platform === "win32" ? "junction" : "dir");
  for (const rootDir of [linked, join(parent, "missing"), a.rootDir + "/../Case"]) {
    const invalid = await createPaperExperimentReview(a, attemptId, { location: { ...a, rootDir }, attemptId });
    assert.equal(invalid.comparison!.status, "incomparable");
    assert.ok(invalid.comparison!.reasons.includes("VERIFIED_STORAGE_ORIGIN_REQUIRED"));
  }
  assert.deepEqual(await tree(first.artifactRoot), before); assert.deepEqual(await tree(second.artifactRoot), otherBefore);
  const receipt = join(second.artifactRoot, PAPER_EXPERIMENT_EXECUTION_RECEIPT_PATH), bytes = await fs.readFile(receipt);
  await fs.writeFile(receipt, "{}");
  try { assert.ok((await createPaperExperimentReview(a, attemptId, { location: b, attemptId })).comparison!.reasons.includes("VERIFIED_EXECUTION_REQUIRED")); }
  finally { await fs.writeFile(receipt, bytes); }
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

test("reader snapshots relative location and protected paths before awaiting filesystem reads", async (t) => {
  const options = await setup(), run = await runPaperExperimentWorkflow(options);
  const baseline = await readPaperExperimentReviewEvidence(options, run.attemptId);
  const previous = process.cwd(), original = fs.open.bind(fs);
  const location = { rootDir: basename(options.rootDir), protectedPaths: [] as string[] };
  let changed = false;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (!changed && String(args[0]) === join(run.artifactRoot, "experiment-run.json")) {
      changed = true; location.rootDir = "missing"; location.protectedPaths.push(options.rootDir); process.chdir(previous);
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    process.chdir(dirname(options.rootDir));
    const evidence = await readPaperExperimentReviewEvidence(location, run.attemptId);
    assert.ok(changed); assert.equal(evidence.verified, true); assert.equal(evidence.storageOrigin, baseline.storageOrigin);
  } finally { process.chdir(previous); t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test("a physically replaced namespace cannot retain a stable verified read", async (t) => {
  const options = await setup(), run = await runPaperExperimentWorkflow(options);
  const before = await tree(run.artifactRoot), replacement = options.rootDir + "-replacement", originalRoot = options.rootDir + "-original";
  await fs.cp(options.rootDir, replacement, { recursive: true });
  const original = fs.open.bind(fs); let stateReads = 0;
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]) === join(run.artifactRoot, "experiment-run.json") && ++stateReads === 2) {
      await fs.rename(options.rootDir, originalRoot); await fs.rename(replacement, options.rootDir);
    }
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const evidence = await readPaperExperimentReviewEvidence(options, run.attemptId);
    assert.equal(evidence.verified, false); assert.equal(evidence.storageOrigin, null); assert.equal(evidence.inspection.input, null);
    assert.equal(evidence.inspection.errorCode, "ARTIFACT_INTEGRITY");
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(await tree(run.artifactRoot), before); assert.deepEqual(await tree(join(originalRoot, run.attemptId)), before);
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

test("review redaction masks labeled account/order/execution IDs across text and structured aliases", async () => {
  const cases = [
    ["orderId=ORDER_PRIVATE_17", "ORDER_PRIVATE_17"],
    ["order.id=ORDER_DOT_PRIVATE_17", "ORDER_DOT_PRIVATE_17"],
    ["execution.id=EXEC_DOT_PRIVATE_28", "EXEC_DOT_PRIVATE_28"],
    ["account.number=22345678901234", "22345678901234"],
    ['{"broker.order.id":"head\\\"PRIVATE_DOTTED_TAIL"}', "PRIVATE_DOTTED_TAIL"],
    ["note: Proxy.Authorization: Basic PRIVATE_DOTTED_AUTH", "PRIVATE_DOTTED_AUTH"],
    ["Set.Cookie: a=PRIVATE_DOTTED_COOKIE_A; b=PRIVATE_DOTTED_COOKIE_B", "PRIVATE_DOTTED_COOKIE_B"],
    ['{"order\\u002eid":"PRIVATE_ESCAPED_KEY"}', "PRIVATE_ESCAPED_KEY"],
    [JSON.stringify(JSON.stringify({ "execution.id": 'head, PRIVATE_ENCODED_TAIL; "more"' })), "PRIVATE_ENCODED_TAIL"],
    ["executionId=EXECUTION_PRIVATE_28", "EXECUTION_PRIVATE_28"],
    ["accountNumber=12345678901234", "12345678901234"],
    ["ORDER_ID: 'QUOTED ORDER PRIVATE'", "QUOTED ORDER PRIVATE"],
    ['{"Execution-Id":"QUOTED EXECUTION PRIVATE"}', "QUOTED EXECUTION PRIVATE"],
    ['"account_number": "99887766554433"', "99887766554433"],
    ["Account No=1122 3344 5566", "3344"],
    ["order-number=ORDER_NUMBER_PRIVATE", "ORDER_NUMBER_PRIVATE"],
    ["execution_no=EXECUTION_NUMBER_PRIVATE", "EXECUTION_NUMBER_PRIVATE"],
    ["path:/home/private/identifier", "/home/private/identifier"],
    ['"path":"/home/alice/PRIVATE_PATH"', "/home/alice/PRIVATE_PATH"],
    ["Authorization: Bearer BEARER_PRIVATE", "BEARER_PRIVATE"],
    ["Authorization: Basic BASIC_PRIVATE", "BASIC_PRIVATE"],
    ["Cookie: a=COOKIE_A_PRIVATE; b=COOKIE_B_PRIVATE", "COOKIE_B_PRIVATE"],
    ['"cookie":"a=QUOTED_COOKIE_PRIVATE; b=OTHER_COOKIE_PRIVATE"', "OTHER_COOKIE_PRIVATE"],
    ["password=UNQUOTED MULTIWORD PRIVATE", "MULTIWORD PRIVATE"],
    ["API-KEY: API_KEY_PRIVATE", "API_KEY_PRIVATE"],
    ["access_token=PRIVATE_ACCESS", "PRIVATE_ACCESS"],
    ["refreshToken: PRIVATE_REFRESH", "PRIVATE_REFRESH"],
    ["client_secret=PRIVATE_CLIENT", "PRIVATE_CLIENT"],
    ["authToken=PRIVATE_AUTH", "PRIVATE_AUTH"],
    ['{"orderId":"head\\"PRIVATE_QUOTED_TAIL"}', "PRIVATE_QUOTED_TAIL"],
    ['{"password":"head\\"PRIVATE_PASSWORD_TAIL"}', "PRIVATE_PASSWORD_TAIL"],
    ['{"Authorization":"head\\"PRIVATE_AUTH_TAIL"}', "PRIVATE_AUTH_TAIL"],
    ['{"Cookie":"head\\"PRIVATE_COOKIE_TAIL"}', "PRIVATE_COOKIE_TAIL"],
    ['{"Cookie":"head\\\\\\"PRIVATE_COOKIE_ESCAPE_TAIL"}', "PRIVATE_COOKIE_ESCAPE_TAIL"],
    ['"path":"/tmp/one PRIVATE_QUOTED_PATH"', "PRIVATE_QUOTED_PATH"],
    ['a path "/tmp/one PRIVATE_STANDALONE_PATH" here', "PRIVATE_STANDALONE_PATH"],
    ["path=/tmp/one PRIVATE_SPACED_PATH", "PRIVATE_SPACED_PATH"],
    ["safe=ok orderId=PRIVATE_CHAIN", "PRIVATE_CHAIN"],
    ["note: accountNumber=PRIVATE_NESTED", "PRIVATE_NESTED"],
    ["sourceRef=fixture:paper-experiment.v1 token=PRIVATE_NESTED_TOKEN", "PRIVATE_NESTED_TOKEN"],
    ["note: Password: PRIVATE_NESTED_PASSWORD", "PRIVATE_NESTED_PASSWORD"],
    ['{"note":"orderId=PRIVATE_STRING_CHILD"}', "PRIVATE_STRING_CHILD"],
    ['note="token=PRIVATE_TOKEN_IN_QUOTED_NOTE"', "PRIVATE_TOKEN_IN_QUOTED_NOTE"],
    ['password="head\\\nPRIVATE_LF_TAIL"', "PRIVATE_LF_TAIL"],
    ['orderId="head\\\r\nPRIVATE_CRLF_TAIL"', "PRIVATE_CRLF_TAIL"],
    ['Authorization: "head\\\nPRIVATE_HEADER_LF_TAIL"', "PRIVATE_HEADER_LF_TAIL"],
    ['Cookie: "head\\\r\nPRIVATE_HEADER_CRLF_TAIL"; other=PRIVATE_COOKIE_OTHER', "PRIVATE_COOKIE_OTHER"],
    ['path="/tmp/head\\\nPRIVATE_PATH_LF_TAIL"', "PRIVATE_PATH_LF_TAIL"],
    ['path="/tmp/head\\\r\nPRIVATE_PATH_CRLF_TAIL"', "PRIVATE_PATH_CRLF_TAIL"],
    ["token=head\\\nPRIVATE_UNQUOTED_LF_TAIL", "PRIVATE_UNQUOTED_LF_TAIL"],
    ["path=/tmp/head\\\r\nPRIVATE_PATH_UNQUOTED_CRLF", "PRIVATE_PATH_UNQUOTED_CRLF"]
  ];
  for (const [text, privateValue] of cases) assert.ok(!safePaperExperimentReviewValue(text!).includes(privateValue!), text);
  const protectedValues = { orderId: "STRUCTURED_ORDER_PRIVATE", execution_id: "STRUCTURED_EXEC_PRIVATE",
    "account-number": "STRUCTURED_ACCOUNT_PRIVATE", password: "STRUCTURED_PASSWORD_PRIVATE",
    api_key: "STRUCTURED_API_PRIVATE", authToken: "STRUCTURED_TOKEN_PRIVATE", nested: [{ executionNo: "STRUCTURED_NUMBER_PRIVATE" }] };
  assert.ok(!JSON.stringify(safePaperExperimentReviewValue(protectedValues)).includes("PRIVATE"));
  for (const safe of ["fixture:paper-experiment.v1", "sha256:" + "a".repeat(64), "2025-01-01T00:00:00.000Z"]) {
    assert.equal(safePaperExperimentReviewValue(safe), safe);
  }
  assert.equal(safePaperExperimentReviewValue({ executionModelVersion: "paper_cost_model.v5", packetId: "fixture_packet_1" }).executionModelVersion, "paper_cost_model.v5");
  const options = await setup(), input = JSON.parse(options.inputJson);
  input.question = cases.slice(0, 10).map(([text]) => text).join("\n");
  input.source.coverageDescription = cases.slice(10, 20).map(([text]) => text).join("\n");
  input.evaluation.reviewQuestions = Array.from({ length: Math.ceil((cases.length - 20) / 10) },
    (_, index) => cases.slice(20 + index * 10, 30 + index * 10).map(([text]) => text).join("\n"));
  const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) });
  const before = await tree(join(run.artifactRoot, "input"));
  const written = await writePaperExperimentReview(options, run.attemptId);
  for (const path of [written.files.json, written.files.markdown]) {
    const output = await fs.readFile(join(run.artifactRoot, path), "utf8");
    for (const [, privateValue] of cases) assert.ok(!output.includes(privateValue!), `${path}: ${privateValue}`);
  }
  assert.deepEqual(await tree(join(run.artifactRoot, "input")), before);
});

test("all labeled-key separators share normalization across text, structured values and header spans", () => {
  const keys = [["order", "id"], ["execution", "number"], ["account", "no"], ["api", "key"],
    ["access", "token"], ["refresh", "token"], ["client", "secret"], ["auth", "token"],
    ["pass", "word"], ["proxy", "authorization"], ["set", "cookie"]];
  const separators = ["", ".", "..", "_", "-", " ", "\t", "._- \t"];
  for (const parts of keys) for (const separator of separators) for (const upper of [false, true]) {
    const key = parts.join(separator), label = upper ? key.toUpperCase() : key;
    const secret = "PRIVATE_SEPARATOR_SENTINEL";
    for (const text of [`${label}=${secret}`, `"${label}":"${secret}"`, `safe=ok ${label}='${secret}'`,
      `note: broker.${label}=${secret}`, `note="${label}=${secret}"`,
      `"${label}":"head\\\"${secret}"`, `${label}="head\\\n${secret}"`,
      JSON.stringify(JSON.stringify({ [label]: secret })),
      JSON.stringify(JSON.stringify(JSON.stringify({ [label]: secret }))),
      JSON.stringify(JSON.stringify({ [label]: `head, ${secret}; \"tail\"` })),
      JSON.stringify(JSON.stringify(JSON.stringify({ [label]: `head, ${secret}; \\tail\nmore` }))),
      `{"${label.replace(/./g, (letter) => "\\u" + letter.charCodeAt(0).toString(16).padStart(4, "0"))}":"${secret}"}`]) {
      assert.ok(!safePaperExperimentReviewValue(text).includes(secret), text);
    }
    assert.equal(safePaperExperimentReviewValue({ [label]: secret })[label], "[비공개]");
    if (parts.at(-1) === "cookie" || parts.at(-1) === "authorization") {
      const header = `${label}: a=FIRST; b=${secret}`;
      assert.ok(!safePaperExperimentReviewValue(header).includes(secret), header);
    }
  }
  const safe = { "execution.model.version": "paper_cost_model.v5", "source.ref": "fixture:paper-experiment.v1",
    "cost.model": { feeRate: 0.001 }, packetId: "fixture_packet_1", "policy.max.orders": 3 };
  assert.deepEqual(safePaperExperimentReviewValue(safe), safe);
  for (const text of ["source.ref=fixture:paper-experiment.v1", "execution.model.version=paper_cost_model.v5",
    JSON.stringify(JSON.stringify(safe)), '{"source\\u002eref":"fixture:paper-experiment.v1"}',
    "sha256:" + "a".repeat(64), "2025-01-01T00:00:00.000Z"]) assert.equal(safePaperExperimentReviewValue(text), text);
});

test("unlabeled account-like text is masked without changing numeric facts or canonical identities", async () => {
  const samples: string[] = [];
  for (let length = 10; length <= 20; length++) {
    const digits = "01234567890123456789".slice(0, length);
    for (const separator of ["", "-", ".", " ", "\t", " .-\t"]) {
      const grouped = digits.match(/.{1,3}/g)!.join(separator);
      for (const value of [grouped, `note: ${grouped}.`, JSON.stringify(grouped), JSON.stringify(JSON.stringify(grouped)),
        JSON.stringify(JSON.stringify(JSON.stringify(grouped))),
        grouped.replace(/./g, (letter) => "\\u" + letter.charCodeAt(0).toString(16).padStart(4, "0"))]) {
        const result = safePaperExperimentReviewValue(value);
        assert.notEqual(result, value, value); assert.ok(!result.includes(digits), value);
      }
    }
    samples.push(digits);
  }
  for (const value of ["12345678901234 22345678901234", "1234 5678 901234 2234 5678 901234"]) {
    assert.equal(safePaperExperimentReviewValue(value), "[계좌형 숫자 비공개]");
  }
  for (const value of ["-12345678901234", "12345678901234-", "_12345678901234_", "계좌-12345678901234"]) {
    assert.ok(!safePaperExperimentReviewValue(value).includes("12345678901234"));
  }
  const safe = ["123456789", "123456789012345678901", "fixture:item.12345678901234", "abc.12345678901234.def",
    "exp-12345678-1234-1234-1234-123456789012", "legacy_opaque_01", "2025-01-01 - 2025-01-03",
    "2025-01-01T00:00:00.12345678901234Z", "sha256:" + "1".repeat(64), "a".repeat(20) + "1".repeat(20),
    "a".repeat(20) + "1".repeat(20) + "a".repeat(24)];
  for (const value of safe) assert.equal(safePaperExperimentReviewValue(value), value);
  for (const value of safe) assert.ok(!safePaperExperimentReviewValue("orderId=" + value).includes(value));
  for (const value of ["ord_12345678-1234-1234-1234-123456789012", "exec_12345678-1234-1234-1234-123456789012",
    "a".repeat(40) + "." + "b".repeat(16) + "." + "c".repeat(16),
    ["a", "b", "c"].map((value) => value.repeat(64)).join(".")]) assert.notEqual(safePaperExperimentReviewValue(value), value);
  const facts = { cost: 12345678901234, count: 1234567890, ratio: 0.012345678901234 };
  assert.deepEqual(safePaperExperimentReviewValue(facts), facts);
  const options = await setup(), input = JSON.parse(options.inputJson);
  input.question = samples.slice(0, 5).join(", "); input.source.coverageDescription = samples.slice(5).join("; ");
  input.evaluation.reviewQuestions = ['bare "12345678901234"', "123.456.789.012.34", "123 456 789 012 34"];
  const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) });
  const before = await tree(join(run.artifactRoot, "input")), written = await writePaperExperimentReview(options, run.attemptId);
  for (const path of [written.files.json, written.files.markdown]) {
    const output = await fs.readFile(join(run.artifactRoot, path), "utf8");
    for (const digits of samples) assert.ok(!output.includes(digits));
    assert.ok(!output.includes("12345678901234"));
  }
  assert.deepEqual(await tree(join(run.artifactRoot, "input")), before);
});

test("every known bare token prefix is case-insensitive and precedes canonical or wrapper exemptions", async () => {
  const variants = (value: string): string[] => [...value].reduce<string[]>((values, letter) =>
    /[a-z]/i.test(letter) ? values.flatMap((prefix) => [prefix + letter.toLowerCase(), prefix + letter.toUpperCase()])
      : values.map((prefix) => prefix + letter), [""]);
  const prefixes = ["ord_", "exec_", "sk-", ...["p", "o", "u", "s", "r"].map((type) => `gh${type}_`), "github_pat_"];
  for (const prefix of prefixes) for (const form of variants(prefix)) {
    const minimum = prefix === "ord_" || prefix === "exec_" ? 6 : 8;
    assert.equal(safePaperExperimentReviewValue(form + "A".repeat(minimum - 1)), form + "A".repeat(minimum - 1));
    for (const payload of ["A".repeat(minimum), "A".repeat(minimum - 1) + "-", "A".repeat(minimum - 1) + "_",
      "ABCDEF123456", "12345678-1234-1234-1234-123456789012", "a".repeat(64)]) {
      const token = form + payload;
      for (const text of [token, `note: ${token}`, `_${token}_`, `__${token}__`, `word_${token}`, `\`${token}\``, JSON.stringify(token),
        JSON.stringify(JSON.stringify(token)), `[${token}](safe)`, JSON.stringify(`note\n${token}`),
        JSON.stringify(`note\t${token}`), JSON.stringify(`note\r${token}`), JSON.stringify(`note\u0000${token}`),
        JSON.stringify(JSON.stringify(`note\n${token}`))]) assert.ok(!safePaperExperimentReviewValue(text).includes(payload), text);
      assert.equal(safePaperExperimentReviewValue(token), "[비공개]");
    }
  }
  for (const prefix of prefixes) {
    const jwt = prefix.toUpperCase() + "a".repeat(24) + "." + "PRIVATEPAYLOAD".repeat(2) + "." + "PRIVATESIGNATURE".repeat(2);
    assert.equal(safePaperExperimentReviewValue(jwt), "[비공개]");
    for (let code = 0; code < 128; code++) {
      const character = String.fromCharCode(code), token = prefix.toUpperCase() + "ABCDEF123456";
      const encoded = "note\\u" + code.toString(16).padStart(4, "0") + token;
      if (/[A-Za-z0-9]/.test(character)) assert.equal(safePaperExperimentReviewValue(encoded), encoded);
      else for (const value of ["note" + character + token, encoded, JSON.stringify("note" + character + token)]) {
        assert.ok(!safePaperExperimentReviewValue(value).includes("ABCDEF123456"), value);
      }
    }
  }
  for (const text of ["task-ABCDEFGH", "mask-ABCDEFGH", "executionModelVersion=paper_cost_model.v5", "paperStrategyVersion=v1"]) {
    assert.equal(safePaperExperimentReviewValue(text), text);
  }
  const options = await setup(), input = JSON.parse(options.inputJson);
  const tokens = ["ORD_ABCDEF123456", "EXEC_ABCDEF123456", "OrD_ABCDEF123456", "ExEc_ABCDEF123456", "SK-ABCDEF123456", "GHP_ABCDEF123456", "GITHUB_PAT_ABCDEF123456"];
  input.question = tokens.join("; ");
  const run = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) });
  const before = await tree(join(run.artifactRoot, "input")), written = await writePaperExperimentReview(options, run.attemptId);
  for (const path of Object.values(written.files)) {
    const text = await fs.readFile(join(run.artifactRoot, path), "utf8");
    assert.ok(!text.includes("ABCDEF123456"));
  }
  assert.deepEqual(await tree(join(run.artifactRoot, "input")), before);
});

test("presentation masking never makes different raw identifiers reproducible", async () => {
  for (const questions of [["orderId=PRIVATE_FIRST", "orderId=PRIVATE_SECOND"], ["12345678901234", "22345678901234"]]) {
  const options = await setup(); const input = JSON.parse(options.inputJson);
  input.question = questions[0];
  const first = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) });
  input.question = questions[1];
  const second = await runPaperExperimentWorkflow({ ...options, inputJson: JSON.stringify(input) });
  const a = await createPaperExperimentReview(options, first.attemptId, { location: options, attemptId: second.attemptId });
  const b = await createPaperExperimentReview(options, second.attemptId);
  assert.equal(a.question!.value, b.question!.value);
  assert.notEqual(a.inputEligibility.inputHash, b.inputEligibility.inputHash);
  assert.equal(a.comparison!.status, "incomparable"); assert.ok(a.comparison!.reasons.includes("INPUT_MISMATCH"));
  }
});

test("final report assembly sanitizes valid secret-shaped primary/comparison IDs and completion metadata", async () => {
  for (const attemptId of ["ghp_abcdefgh", "sk-abcdefgh", "ORD_ABCDEF123456", "EXEC_ABCDEF123456", "12345678901234", "legacy_opaque_01"]) {
    const options = await setup(); const run = await runPaperExperimentWorkflow({ ...options, attemptId });
    const before = { input: await tree(join(run.artifactRoot, "input")), replay: await tree(join(run.artifactRoot, "replay")),
      state: await fs.readFile(join(run.artifactRoot, "experiment-run.json"), "utf8") };
    const comparisonId = attemptId === "12345678901234" ? "22345678901234" : "ghp_missingabcdefgh";
    const result = await writePaperExperimentReview(options, attemptId, comparisonId);
    assert.equal(result.review.comparison!.status, "incomparable");
    assert.ok(!JSON.stringify(result).includes(comparisonId));
    if (attemptId === "legacy_opaque_01") assert.equal(result.review.attemptId, attemptId);
    else assert.ok(!JSON.stringify(result).includes(attemptId));
    for (const path of Object.values(result.files)) {
      const text = await fs.readFile(join(run.artifactRoot, path), "utf8");
      assert.ok(!text.includes(comparisonId));
      if (attemptId !== "legacy_opaque_01") assert.ok(!text.includes(attemptId), path);
    }
    const marker = await json(join(run.artifactRoot, result.files.completion));
    assert.equal(marker.jsonDigest, createReplayResearchHash(await json(join(run.artifactRoot, result.files.json))));
    assert.equal(marker.markdownDigest, createReplayResearchHash(await fs.readFile(join(run.artifactRoot, result.files.markdown), "utf8")));
    assert.deepEqual({ input: await tree(join(run.artifactRoot, "input")), replay: await tree(join(run.artifactRoot, "replay")),
      state: await fs.readFile(join(run.artifactRoot, "experiment-run.json"), "utf8") }, before);
  }
});

test("direct Markdown rendering sanitizes the complete input and rejects forged token-shaped references", async () => {
  const options = await setup(); const run = await runPaperExperimentWorkflow(options);
  const review = await createPaperExperimentReview(options, run.attemptId, { location: options, attemptId: "exp-missing" });
  review.attemptId = "ghp_abcdefgh"; review.comparison!.attemptId = "12345678901234";
  review.question!.value = JSON.stringify(JSON.stringify({ "account.number": "head, PRIVATE_RENDERED_DOT; more" }));
  review.policy!.evidence = { artifact: "experiment-input.json", field: "/sk-PRIVATESECRET123",
    href: "../../input/experiment-input.json#/sk-PRIVATESECRET123" };
  const text = renderPaperExperimentReviewMarkdown(review);
  for (const secret of ["ghp_abcdefgh", "12345678901234", "PRIVATESECRET123", "PRIVATE_RENDERED_DOT"]) assert.ok(!text.includes(secret));
  assert.match(text, /근거 주소 없음/);
  assert.ok(!JSON.stringify(safePaperExperimentReviewValue(review.policy!.evidence)).includes("PRIVATESECRET123"));
});
