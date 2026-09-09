// Each file runs in its own Node test worker; keep top-level tests serial for global mocks.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionExecution } from "./portfolioActionRiskDecisionExecutionResolver.js";
import { parseRiskDecisionExecutionOrigin, assertRiskExecutionFillBinding } from "./portfolioActionRiskDecisionExecutionContext.js";
import { createPortfolioActionExecutionPreview, parsePortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths, FileMarketPacketStore } from "../storage/repositories.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { HASH, priceBoundFillEvent, withRiskExecutionFixture, executionBoundFillInput } from "./portfolioActionRiskDecisionTestFixtures.js";


test("execution-bound Risk persists frozen model inputs for BUY, SELL, legacy and whole-share requests", async () => {
  for (const options of [{}, { side: "SELL" as const }, { side: "SELL" as const, legacy: true }, { whole: true }]) {
    await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
      const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId);
      assert.ok(origin.executionOrigin);
      assert.equal(origin.executionOrigin.preview.input.asOf, decision.decidedAt);
      assert.equal(origin.executionOrigin.preview.requestedQuantity, decision.requestedQuantity);
      const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
      const bytes = await readFile(path, "utf8");
      assert.equal(JSON.parse(bytes.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v8");
      assert.deepEqual((await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId })).executionOrigin, origin.executionOrigin);
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(baseDir).createAndAppendWithExecutionOrigin(candidate, selection), decision);
      assert.equal(await readFile(path, "utf8"), bytes);
    }, options);
  }
});


test("execution-bound Risk rejects understated costs, request drift, and incomplete policy-selected rules", async () => {
  await withRiskExecutionFixture(async ({ repository, candidate, selection }) => {
    const inputs = [
      { ...candidate, requestedQuantity: candidate.requestedQuantity / 2 },
      { ...candidate, requestedNotionalKrw: candidate.requestedNotionalKrw / 2 },
      { ...candidate, cashAssessment: { side: "BUY" as const, worstCaseNetCashDebitKrw: candidate.worstCaseFillNotionalKrw,
        approvedMaximumNetCashDebitKrw: candidate.worstCaseFillNotionalKrw } },
      { ...candidate, requiredRuleIds: ["paper_execution"], ruleResults: candidate.ruleResults.filter((rule) => rule.ruleId === "paper_execution") }
    ];
    for (const input of inputs) await assert.rejects(repository.createAndAppendWithExecutionOrigin(input, selection));
    assert.deepEqual(await repository.readAll(), []);
    for (const extra of [{ volume: 1 }, { executionPolicy: {} }, { baseDir: "other" }, { planId: "other" }]) {
      await assert.rejects(repository.createAndAppendWithExecutionOrigin(candidate, { ...selection, ...extra }));
    }
  });
});


test("execution-bound Risk cannot upgrade a previously stored price-only decision", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithPriceOrigin(candidate, selection.priceEvidenceRef);
    assert.equal(resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId).executionOrigin, null);
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithExecutionOrigin(candidate, selection), /cannot be added or replaced/);
    await assert.rejects(resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId }), /lacks frozen/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});


test("execution-bound Risk delayed retries return the original decision without renewing expired inputs", async (context) => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const history = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!;
    const riskPath = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(riskPath, "utf8");
    const cutoff = Math.max(Date.parse(origin.liquidity.expiresAt), Date.parse(origin.liquidity.staleAfter),
      Date.parse(origin.preview.input.sourcePriceEvidence.observedAt) + origin.maximumPriceAgeSeconds * 1000) + 1;
    context.mock.timers.enable({ apis: ["Date"], now: cutoff });
    try {
      const restarted = new PortfolioActionRiskDecisionFileRepository(baseDir);
      assert.deepEqual(await restarted.createAndAppendWithExecutionOrigin(candidate, selection), decision);
      assert.equal(await readFile(riskPath, "utf8"), bytes);
      await assert.rejects(restarted.createAndAppendWithExecutionOrigin(candidate, { ...selection, expectedPlanEventHash: HASH }), /cannot be added or replaced/);
      await assert.rejects(restarted.createAndAppendWithExecutionOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, "new-input"] }, selection), /stale/);
      await assert.rejects(new PaperFillExecutionFileRepository(baseDir).createAndAppendWithRiskOrigin(executionBoundFillInput(candidate, origin.preview),
        history, decision.riskDecisionId), /stale/);
      const packetPath = createStoragePaths(baseDir).marketPacketsPath;
      const packet = JSON.parse((await readFile(packetPath, "utf8")).trim());
      packet.candidates[0].volume = 49;
      await writeFile(packetPath, `${JSON.stringify(packet)}\n`);
      await assert.rejects(restarted.createAndAppendWithExecutionOrigin(candidate, selection), /liquidity prefix/);
      assert.equal(await readFile(riskPath, "utf8"), bytes);
    } finally { context.mock.timers.reset(); }
  });
});


test("execution-bound Risk verifies original packet prefix and rejects model output drift", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId).executionOrigin!;
    assert.throws(() => parseRiskDecisionExecutionOrigin({ ...origin, preview: { ...origin.preview,
      execution: { ...origin.preview.execution, netAmountKrw: origin.preview.execution.netAmountKrw - 1 } } }), /deterministic replay/);
    const packetPath = createStoragePaths(baseDir).marketPacketsPath;
    const raw = await readFile(packetPath, "utf8");
    const packet = JSON.parse(raw.trim());
    await new FileMarketPacketStore(packetPath).append({ ...packet, packetId: "synthetic-later-packet" });
    assert.deepEqual((await resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId })).executionOrigin, origin);
    assert.deepEqual(await repository.createAndAppendWithExecutionOrigin(candidate, selection), decision);
    const riskPath = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    await assert.rejects(repository.createAndAppendWithExecutionOrigin(candidate, { ...selection,
      liquidityPacketHash: createMarketPacketHash({ ...packet, packetId: "synthetic-later-packet" }) }), /cannot be added or replaced/);
    assert.equal(await readFile(riskPath, "utf8"), riskBytes);
    packet.candidates[0].volume = 49;
    await writeFile(packetPath, `${JSON.stringify(packet)}\n`);
    await assert.rejects(resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: decision.riskDecisionId }), /liquidity prefix/);
  });
});


test("risk-bound fill persistence requires the frozen model input even when altered costs fit the cash cap", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const history = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!;
    const input = executionBoundFillInput(candidate, origin.preview);
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const fill = await fills.createAndAppendWithRiskOrigin(input, history, decision.riskDecisionId);
    assert.equal(fill.netAmountKrw, origin.preview.execution.netAmountKrw);
    const cheaper = createPortfolioActionExecutionPreview({ ...origin.preview.input,
      executionPolicy: { ...origin.preview.input.executionPolicy, feeBps: 0 } });
    await assert.rejects(fills.createAndAppendWithRiskOrigin({ ...executionBoundFillInput(candidate, cheaper), fillId: "cheaper-fill" }, history, decision.riskDecisionId), /frozen execution input/);
    await assert.rejects(fills.createAndAppendWithRiskOrigin({ ...input, rebalanceActionId: "other" }, history, decision.riskDecisionId), /plan or action mismatch/);
    const { paperFillRecordId: _id, paperFillHash: _hash, ...payload } = fill;
    const expired = createPaperFillExecutionRecord({ ...payload, asOf: origin.liquidity.expiresAt, createdAt: origin.liquidity.expiresAt });
    assert.throws(() => assertRiskExecutionFillBinding(expired, origin), /stale/);
  });
});


test("execution origin independently rejects fully rehashed cost, policy and freshness substitutions", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const riskPath = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const [entry, marker] = (await readFile(riskPath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const origin = parseRiskDecisionExecutionOrigin(entry.executionOrigin);
    const understated = createPortfolioActionRiskDecision({ ...candidate, decidedAt: decision.decidedAt,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: candidate.worstCaseFillNotionalKrw,
        approvedMaximumNetCashDebitKrw: candidate.worstCaseFillNotionalKrw } });
    const cheaper = createPortfolioActionExecutionPreview({ ...origin.preview.input,
      executionPolicy: { ...origin.preview.input.executionPolicy, feeBps: 0 } });
    const changes = [
      { record: understated },
      { executionOrigin: { ...origin, preview: cheaper } },
      { executionOrigin: { ...origin, executionParameterRef: { ...origin.executionParameterRef, hash: HASH } } },
      { executionOrigin: { ...origin, maximumPriceAgeSeconds: 1 } },
      { executionOrigin: { ...origin, liquidity: { ...origin.liquidity,
        readAt: new Date(Date.parse(origin.liquidity.generatedAt) - 1).toISOString() } } },
      { executionOrigin: { ...origin, liquidity: { ...origin.liquidity, expiresAt: decision.decidedAt } } }
    ];
    for (const change of changes) {
      const { entryHash: _hash, ...payload } = { ...entry, ...change };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      const bytes = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
      await writeFile(riskPath, bytes);
      await assert.rejects(resolvePortfolioActionRiskDecisionExecution({ baseDir, riskDecisionId: (change.record ?? decision).riskDecisionId }),
        /corrupt line|model or price|parameter origin/);
      assert.equal(await readFile(riskPath, "utf8"), bytes);
    }
  });
});


test("risk-bound fills reject source price drift hidden by identical rounded execution amounts", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const history = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!;
    const input = executionBoundFillInput(candidate, origin.preview);
    const asOf = new Date().toISOString();
    const altered = createPaperFillExecutionRecord({ ...input, sourcePriceKrw: input.sourcePriceKrw - 0.001, asOf, createdAt: asOf });
    assert.equal(altered.netAmountKrw, origin.preview.execution.netAmountKrw);
    assert.equal(altered.fillPriceKrw, origin.preview.execution.fillPriceKrw);
    assert.throws(() => assertRiskExecutionFillBinding(altered, origin), /frozen execution input/);
    const fills = new PaperFillExecutionFileRepository(baseDir);
    await assert.rejects(fills.createAndAppendWithRiskOrigin({ ...input, sourcePriceKrw: altered.sourcePriceKrw }, history, decision.riskDecisionId), /frozen execution input/);
    for (const change of [{ sourceContractId: "other-source" }, { observedAt: new Date(Date.parse(input.sourcePriceEvidence.observedAt) + 1).toISOString() }]) {
      await assert.rejects(fills.createAndAppendWithRiskOrigin({ ...input, sourcePriceEvidence: { ...input.sourcePriceEvidence, ...change } }, history, decision.riskDecisionId), /frozen execution input/);
    }
    assert.deepEqual(await fills.readAll(), []);
  }, { side: "SELL" });
});


test("execution-bound Risk snapshots caller inputs before asynchronous reads", async () => {
  await withRiskExecutionFixture(async ({ repository, candidate, selection }) => {
    const mutable = structuredClone(candidate);
    const pending = repository.createAndAppendWithExecutionOrigin(mutable, selection);
    mutable.requestedQuantity = 1;
    const decision = await pending;
    assert.equal(decision.requestedQuantity, candidate.requestedQuantity);
  });
});


test("v8 fill delayed retries preserve the stored fill and reject new or changed expired requests", async (context) => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const history = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!;
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const input = executionBoundFillInput(candidate, origin.preview);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const original = await fills.createAndAppendWithRiskOrigin(input, history, decision.riskDecisionId);
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const cutoff = Math.max(Date.parse(origin.liquidity.expiresAt), Date.parse(origin.liquidity.staleAfter),
      Date.parse(origin.preview.input.sourcePriceEvidence.observedAt) + origin.maximumPriceAgeSeconds * 1000) + 1;
    context.mock.timers.enable({ apis: ["Date"], now: cutoff });
    try {
      const restarted = new PaperFillExecutionFileRepository(baseDir);
      const results = await Promise.all([restarted, fills].map((store) => store.createAndAppendWithRiskOrigin(input, history, decision.riskDecisionId)));
      assert.deepEqual(results, [original, original]);
      await assert.rejects(restarted.createAndAppendWithRiskOrigin({ ...input, fillId: "new-expired-fill" }, history, decision.riskDecisionId), /stale/);
      const cheaper = createPortfolioActionExecutionPreview({ ...origin.preview.input, executionPolicy: { ...origin.preview.input.executionPolicy, feeBps: 0 } });
      await assert.rejects(restarted.createAndAppendWithRiskOrigin(executionBoundFillInput(candidate, cheaper), history, decision.riskDecisionId), /ID collision/);
      assert.equal(await readFile(path, "utf8"), bytes);
    } finally { context.mock.timers.reset(); }
  });
});


test("v8 event binding rejects a fully rehashed fill with a cheaper execution policy", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const riskDecisionHistory = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(riskDecisionHistory, decision.riskDecisionId).executionOrigin!;
    const fills = new PaperFillExecutionFileRepository(baseDir);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const original = await fills.createAndAppendWithRiskOrigin(executionBoundFillInput(candidate, origin.preview), riskDecisionHistory, decision.riskDecisionId);
    const plan = await new RebalancePlanFileRepository(baseDir).resolveById(candidate.planId);
    const sourcePriceEvidenceHistory = await new SourcePriceEvidenceFileRepository(baseDir).readVerifiedHistory();
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const valid = validateRebalancePlanExecutionFillRiskBinding({ event: priceBoundFillEvent(plan, decision, original, marker.committedAt),
      riskDecisionHistory, paperFillHistory: await fills.readVerifiedHistory(), sourcePriceEvidenceHistory });
    assert.deepEqual(valid.paperFill, original);
    const cheaper = createPortfolioActionExecutionPreview({ ...origin.preview.input, executionPolicy: { ...origin.preview.input.executionPolicy, feeBps: 0 } });
    const record = createPaperFillExecutionRecord({ ...executionBoundFillInput(candidate, cheaper), asOf: original.asOf, createdAt: original.createdAt });
    const { entryHash: _hash, ...payload } = { ...entry, record };
    const entryHash = hashCanonicalPayload(payload);
    const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
    const bytes = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
    await writeFile(path, bytes);
    const paperFillHistory = await new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory();
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({ event: priceBoundFillEvent(plan, decision, record, marker.committedAt),
      riskDecisionHistory, paperFillHistory, sourcePriceEvidenceHistory }), /frozen execution input/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});
