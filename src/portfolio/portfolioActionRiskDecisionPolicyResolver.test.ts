import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type StrategyBucket } from "../domain/schemas.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { createRebalancePlanExecutionAppliedEvent } from "./rebalancePlanExecutionAppliedEvent.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { resolveBucketTurnoverFillOrigin } from "./bucketTurnoverFillOrigin.js";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { createBucketTurnoverEvent, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BucketTurnoverEventFileRepository, createBucketTurnoverEventPaths, resolveVerifiedBucketTurnoverEventOrigin } from "./bucketTurnoverEventFiles.js";
import { BUCKET_TURNOVER_STATE_FILE_NAME, BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation, getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import { validateRiskDecisionTurnoverCapacity } from "./portfolioActionRiskDecisionTurnoverCapacity.js";
import { resolveCurrentPortfolioActionRiskDecisionTurnover } from "./portfolioActionRiskDecisionTurnoverResolver.js";

import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPolicy } from "./portfolioActionRiskDecisionPolicyResolver.js";
import { resolvePortfolioActionRiskDecisionPlan } from "./portfolioActionRiskDecisionPlanResolver.js";
import { resolvePortfolioActionRiskDecisionMandate } from "./portfolioActionRiskDecisionMandateResolver.js";
import { resolvePortfolioActionRiskDecisionSnapshot } from "./portfolioActionRiskDecisionSnapshotResolver.js";
import { resolvePortfolioActionRiskDecisionPrice } from "./portfolioActionRiskDecisionPriceResolver.js";
import { resolvePortfolioActionRiskDecisionExecution } from "./portfolioActionRiskDecisionExecutionResolver.js";
import { parseRiskDecisionExecutionOrigin, assertRiskExecutionFillBinding } from "./portfolioActionRiskDecisionExecutionContext.js";
import { validateRiskDecisionPriceState } from "./portfolioActionRiskDecisionPriceContext.js";
import { createPortfolioPolicyExecutionPreview, portfolioExecutionRuleParametersSchema } from "./portfolioPolicyExecutionPreview.js";
import { createPortfolioActionExecutionPreview, parsePortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { createPortfolioPacketExecutionPreview } from "./portfolioPacketExecutionPreview.js";
import { createPortfolioPlanExecutionPreview } from "./portfolioPlanExecutionPreview.js";
import { WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION } from "../paper/versionedExecutionModel.js";
import { MarketPacketBuilder } from "../market/packetBuilder.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths, FileMarketPacketStore } from "../storage/repositories.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths } from "./sourcePriceEvidenceFiles.js";
import { validateRiskDecisionCashCapacity } from "./portfolioActionRiskDecisionCashCapacity.js";
import { pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { createInvestmentMandateEvent, createInvestmentMandateRecord, type InvestmentMandateRecord } from "./investmentMandate.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { readStoredRiskDecisionPlanContext } from "./portfolioActionRiskDecisionPlanContext.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths, RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { RuntimePortfolioPolicyFileRepository } from "./runtimePortfolioPolicyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent } from "./runtimePortfolioPolicyActivation.js";

const CREATED_AT = "2026-09-01T00:00:00.000Z";
const DECIDED_AT = "2026-09-03T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
type DecisionInput = Parameters<typeof createPortfolioActionRiskDecision>[0];

test("risk policy resolver selects exact bucket rules and parameter lineage by side", async () => {
  for (const side of ["BUY", "SELL"] as const) {
    const fixture = policyFixture();
    await withDecision(fixture, decisionInput(fixture, side), async (input) => {
      const result = await resolvePortfolioActionRiskDecisionPolicy(input);
      assert.equal(result.activePolicy.policy.policyHash, fixture.policy.policyHash);
      assert.equal(result.bucketPolicy?.bucket, "swing");
      assert.deepEqual(result.applicableRules.map(({ rule }) => rule.ruleId), side === "BUY" ? ["cash", "exposure"] : ["exposure", "sell"]);
      for (const { rule, parameter } of result.applicableRules) {
        assert.equal(parameter.hash, rule.parameterRef.hash);
        assert.equal(parameter.lineageHash, rule.parameterRef.lineageHash);
      }
      assert.ok(Object.isFrozen(result.applicableRules));
      assert.ok(Object.isFrozen(result.decision));
    });
  }
});

test("risk policy resolver uses only the root legacy SELL rule set and full legacy policy hash", async () => {
  const fixture = policyFixture();
  const candidate = decisionInput(fixture, "SELL", true);
  await withDecision(fixture, candidate, async (input) => {
    const result = await resolvePortfolioActionRiskDecisionPolicy(input);
    assert.equal(result.bucketPolicy, null);
    assert.equal(result.riskRuleSet.hash, fixture.legacySet.hash);
    assert.deepEqual(result.applicableRules.map(({ rule }) => rule.ruleId), ["legacy"]);
  });
  await withDecision(fixture, { ...candidate, riskRuleScope: { scopeKind: "legacy_reduce_only", legacyPolicyHash: HASH } }, async (input) => {
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /legacy reduce-only policy mismatch/);
  });
});

test("risk policy resolver rejects a claimed rule set or policy that differs from activation", async () => {
  const fixture = policyFixture();
  for (const patch of [{ policyHash: HASH }, { market: "US" as const, symbol: "US:AAPL" }]) {
    await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
      const repository = new PortfolioActionRiskDecisionFileRepository(input.baseDir);
      const candidate = { ...decisionInput(fixture, "BUY"), ...patch };
      const { decidedAt: _time, ...creationInput } = candidate;
      const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
      const original = await readFile(path, "utf8");
      await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /scope does not match|bucket or market mismatch/);
      assert.equal(await readFile(path, "utf8"), original);
      // Historical read still independently rejects a self-consistently rehashed invalid claim.
      const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
      const record = createPortfolioActionRiskDecision({ ...candidate, decidedAt: entry.record.decidedAt });
      await writeFile(path, rehashTurnoverFillPair({ ...entry, record }, marker));
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: record.riskDecisionId }), /mismatch/);
    });
  }
  for (const overrides of [
    { riskRuleSetRecordId: "unrelated" },
    { riskRuleSetVersion: "other" }, { riskRuleSetHash: HASH },
    { riskRuleSetRecordId: fixture.legacySet.riskRuleSetRecordId, riskRuleSetVersion: fixture.legacySet.version, riskRuleSetHash: fixture.legacySet.hash }
  ]) {
    await withDecision(fixture, { ...decisionInput(fixture, "BUY"), ...overrides }, async (input) => {
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /mismatch/);
    });
  }
});

test("risk policy resolver independently derives required side rules rather than trusting self-consistent claims", async () => {
  const fixture = policyFixture();
  for (const requiredRuleIds of [["cash"], ["cash", "exposure", "extra"], ["exposure", "sell"]]) {
    await withDecision(fixture, {
      ...decisionInput(fixture, "BUY"), requiredRuleIds,
      ruleResults: requiredRuleIds.map((ruleId) => ({ ruleId, result: "pass", reasonCode: "fixture" }))
    }, async (input) => {
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /policy-selected side rules/);
    });
  }
});

test("risk policy resolver reloads complete stored activation history and rejects retired policy", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const repository = new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy], fixture.dependencies);
    assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).activePolicy.activation.activationId, fixture.activation.activationId);
    await repository.appendRetired({
      portfolioId: fixture.policy.portfolioId,
      retiredActivationId: fixture.activation.activationId, reasonCode: "fixture",
      createdAt: "2026-09-02T00:00:00.000Z"
    });
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /active runtime portfolio policy is required/);
    // Even a valid contiguous prefix cannot be substituted for the disk history.
    const truncated = { ...input, activationEvents: [fixture.activation], policies: [fixture.policy], dependencies: fixture.dependencies };
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(truncated), /unrecognized_keys/);
  });
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const stored = await new PortfolioActionRiskDecisionFileRepository(input.baseDir).resolveById(input.riskDecisionId);
    await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy], fixture.dependencies).appendRetired({
      portfolioId: fixture.policy.portfolioId,
      retiredActivationId: fixture.activation.activationId, reasonCode: "fixture",
      createdAt: new Date(Date.parse(stored.decidedAt) + 60_000).toISOString()
    });
    assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).activePolicy.activation.activationId, fixture.activation.activationId);
    const path = createRuntimePortfolioPolicyActivationPaths(input.baseDir).eventsPath;
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const event = JSON.parse(lines[0]!);
    await writeFile(path, `${JSON.stringify({ ...event, activationEventHash: HASH })}\n`, "utf8");
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /corrupt line/);
    await writeFile(path, "", "utf8");
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /active runtime portfolio policy is required/);
  });
});

test("risk policy resolver reloads a replacement activation before decision time", async () => {
  const fixture = policyFixture();
  const replacement = policyFixture("v2").policy;
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    await new RuntimePortfolioPolicyFileRepository(input.baseDir, fixture.dependencies).append(replacement);
    await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy, replacement], fixture.dependencies)
      .appendActivated({ policy: replacement, supersedesActivationId: fixture.activation.activationId, createdAt: "2026-09-02T00:00:00.000Z" });
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /policy origin does not match active policy/);
  });
});

test("risk policy resolver rejects fabricated histories and incomplete parameter dependencies", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const fabricated = { ...input, riskDecisionHistory: { records: [] } };
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(fabricated), /unrecognized_keys/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: "missing" }), /does not resolve exactly once/);
    await writeFile(createImmutablePolicyDependencyPaths(input.baseDir).riskParameters, "", "utf8");
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /corrupt line/);
  });
});

test("turnover policy capacity uses exact decimal limits and safe integer cumulative amounts", () => {
  const fixture = policyFixture("v1", undefined, 0.29);
  const atLimit = createPortfolioActionRiskDecision(turnoverCapacityCandidate(fixture, "BUY", 190));
  assert.equal(validateRiskDecisionTurnoverCapacity({ decision: atLimit, policy: fixture.policy })!.maximumCumulativeTurnoverNotionalKrw, 290);
  assert.equal(validateRiskDecisionTurnoverCapacity({ decision: atLimit, policy: fixture.policy })!.remainingTurnoverNotionalKrw, 0);
  for (const side of ["BUY", "SELL"] as const) {
    const belowLimit = createPortfolioActionRiskDecision(turnoverCapacityCandidate(fixture, side, 189));
    assert.equal(validateRiskDecisionTurnoverCapacity({ decision: belowLimit, policy: fixture.policy })!.remainingTurnoverNotionalKrw, 1);
  }
  assert.throws(() => validateRiskDecisionTurnoverCapacity({
    decision: createPortfolioActionRiskDecision(turnoverCapacityCandidate(fixture, "BUY", 191)), policy: fixture.policy }), /exceeds policy turnover/);
  for (const max of [0, Number.MIN_VALUE, 0.3333333333333333]) {
    const limited = policyFixture("v1", undefined, max);
    // The canonical decimal 0.3333333333333333 is strictly below 1/3, despite equal rounded division.
    assert.throws(() => validateRiskDecisionTurnoverCapacity({ policy: limited.policy,
      decision: createPortfolioActionRiskDecision(turnoverCapacityCandidate(limited, "SELL", 0, 3, 1)) }), /exceeds policy turnover/);
  }
  const all = policyFixture("v1", undefined, 1);
  assert.equal(validateRiskDecisionTurnoverCapacity({ policy: all.policy,
    decision: createPortfolioActionRiskDecision(turnoverCapacityCandidate(all, "SELL", 0, 100, 100)) })!.withinTurnoverLimit, true);
  for (const candidate of [turnoverCapacityCandidate(all, "BUY", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1),
    turnoverCapacityCandidate(all, "BUY", 0, 1000.5, 100), turnoverCapacityCandidate(all, "BUY", 0.5)]) {
    assert.throws(() => validateRiskDecisionTurnoverCapacity({ policy: all.policy,
      decision: createPortfolioActionRiskDecision(candidate) }), /safe integer/);
  }
  assert.throws(() => validateRiskDecisionTurnoverCapacity({ decision: atLimit, policy: all.policy }), /scope does not match/);
  const legacy = createPortfolioActionRiskDecision(decisionInput(fixture, "SELL", true));
  assert.equal(validateRiskDecisionTurnoverCapacity({ decision: legacy, policy: fixture.policy }), null);
});

test("policy and plan Risk creation reject approvals above the bucket turnover cap before persistence", async () => {
  for (const side of ["BUY", "SELL"] as const) {
    const fixture = policyFixture();
    await withDecision(fixture, turnoverCapacityCandidate(fixture, side, 400), async (input) => {
      const resolved = await resolvePortfolioActionRiskDecisionPolicy(input);
      assert.equal(resolved.turnoverCapacity!.resultingCumulativeTurnoverNotionalKrw, 500);
      assert.equal(resolved.turnoverCapacity!.remainingTurnoverNotionalKrw, 0);
      assert.equal(resolved.turnoverCapacity!.withinTurnoverLimit, true);
      const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
      const bytes = await readFile(path, "utf8");
      const { decidedAt: _time, ...creation } = turnoverCapacityCandidate(fixture, side, 401);
      await assert.rejects(new PortfolioActionRiskDecisionFileRepository(input.baseDir).createAndAppendWithPolicyOrigin(creation), /exceeds policy turnover/);
      assert.equal(await readFile(path, "utf8"), bytes);
    });
    await withPlanFixture(side, false, async ({ repository, candidate }) => {
      if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
      await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...candidate, turnoverAssessment: {
        ...candidate.turnoverAssessment, priorBucketTurnoverNotionalKrw: 401, resultingBucketTurnoverRatio: 0.501 } }), /exceeds policy turnover/);
      assert.deepEqual(await repository.readAll(), []);
    });
  }
  await withRiskExecutionFixture(async ({ repository, candidate, selection }) => {
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
    const prior = candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw / 2;
    await assert.rejects(repository.createAndAppendWithExecutionOrigin({ ...candidate, turnoverAssessment: {
      ...candidate.turnoverAssessment, priorBucketTurnoverNotionalKrw: prior,
      resultingBucketTurnoverRatio: (prior + candidate.worstCaseFillNotionalKrw) / candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw } }, selection), /exceeds policy turnover/);
    assert.deepEqual(await repository.readAll(), []);
  });
});

test("turnover cap explains rejected decisions but rejects rehashed historical approvals over the limit", async () => {
  const fixture = policyFixture();
  const over = turnoverCapacityCandidate(fixture, "BUY", 401);
  await withDecision(fixture, { ...over, decision: "rejected", ruleResults: over.ruleResults.map((rule) => ({ ...rule, result: "fail" })) }, async (input) => {
    const capacity = (await resolvePortfolioActionRiskDecisionPolicy(input)).turnoverCapacity!;
    assert.equal(capacity.withinTurnoverLimit, false);
    assert.equal(capacity.remainingTurnoverNotionalKrw, 0);
    const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const record = createPortfolioActionRiskDecision({ ...over, decidedAt: entry.record.decidedAt });
    const bytes = rehashTurnoverFillPair({ ...entry, record }, marker);
    await writeFile(path, bytes);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: record.riskDecisionId }), /exceeds policy turnover/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});

test("replacement policy applies its lower turnover cap without resetting the supplied prior cumulative", async (context) => {
  const fixture = policyFixture();
  await withDecision(fixture, turnoverCapacityCandidate(fixture, "BUY", 300), async (input) => {
    const original = await resolvePortfolioActionRiskDecisionPolicy(input);
    const replacement = policyFixture("v2", undefined, 0.2);
    await new RuntimePortfolioPolicyFileRepository(input.baseDir, fixture.dependencies).append(replacement.policy);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(original.decision.decidedAt) + 2000 });
    try {
      await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy, replacement.policy], fixture.dependencies)
        .appendActivated({ policy: replacement.policy, supersedesActivationId: fixture.activation.activationId, createdAt: new Date().toISOString() });
      const { decidedAt: _time, ...candidate } = turnoverCapacityCandidate(replacement, "BUY", 300);
      await assert.rejects(new PortfolioActionRiskDecisionFileRepository(input.baseDir).createAndAppendWithPolicyOrigin(candidate), /exceeds policy turnover/);
      assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).turnoverCapacity!.maxTurnoverRatio, 0.5);
    } finally { context.mock.timers.reset(); }
  });
});

function turnoverCapacityCandidate(fixture: ReturnType<typeof policyFixture>, side: "BUY" | "SELL", prior: number,
  denominator = 1000, requested = 100): DecisionInput {
  const base = decisionInput(fixture, side);
  if (base.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
  return { ...base, requestedNotionalKrw: requested, worstCaseFillNotionalKrw: requested, approvedMaximumFillNotionalKrw: requested,
    cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: requested, approvedMaximumNetCashDebitKrw: requested }
      : { side, expectedMinimumNetCashCreditKrw: requested },
    turnoverAssessment: { ...base.turnoverAssessment, turnoverWindowOpenPortfolioNetWorthKrw: denominator,
      priorBucketTurnoverNotionalKrw: prior, requestedBucketTurnoverNotionalKrw: requested, resultingBucketTurnoverRatio: (prior + requested) / denominator } };
}

test("risk policy resolver can explain a rejected record without promoting it to approval", async () => {
  const fixture = policyFixture();
  const candidate = decisionInput(fixture, "BUY");
  await withDecision(fixture, { ...candidate, decision: "rejected", ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) }, async (input) => {
    assert.equal((await resolvePortfolioActionRiskDecisionPolicy(input)).decision.decision, "rejected");
  });
});

test("risk policy binding cannot backfill an already-created or stored decision", async () => {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-backfill-"));
  try {
    const repository = new PortfolioActionRiskDecisionFileRepository(directory);
    const candidate = decisionInput(fixture, "BUY");
    const precreated = createPortfolioActionRiskDecision(candidate);
    const { decidedAt: _decidedAt, ...creationInput } = candidate;
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /active runtime portfolio policy is required/);
    assert.deepEqual(await repository.readAll(), []);
    await repository.append(precreated);
    // All activation timestamps predate the decision, but the bytes are appended later.
    await storePolicyFixture(directory, fixture);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy({ baseDir: directory, riskDecisionId: precreated.riskDecisionId }), /policy-before-creation provenance/);
    const before = await readFile(createPortfolioActionRiskDecisionPaths(directory).recordsPath, "utf8");
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(precreated), /cannot accept a record or timestamp/);
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(candidate), /cannot accept a record or timestamp/);
    await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /cannot be added or replaced/);
    assert.equal(await readFile(createPortfolioActionRiskDecisionPaths(directory).recordsPath, "utf8"), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("policy-bound risk origin survives restart and idempotent retries without timestamp rebinding", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const repository = new PortfolioActionRiskDecisionFileRepository(input.baseDir);
    const record = await repository.resolveById(input.riskDecisionId);
    const history = await repository.readVerifiedHistory();
    const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, input.riskDecisionId);
    assert.ok(origin.policyOrigin);
    assert.equal(origin.policyOrigin.activationId, fixture.activation.activationId);
    assert.ok(Date.parse(origin.policyOrigin.observedAt) <= Date.parse(record.decidedAt));
    assert.ok(Object.isFrozen(origin.policyOrigin));
    const { decidedAt: _decidedAt, ...creationInput } = decisionInput(fixture, "BUY");
    const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
    const before = await readFile(path, "utf8");
    const results = await Promise.all([repository.createAndAppendWithPolicyOrigin(creationInput), repository.createAndAppendWithPolicyOrigin(creationInput)]);
    assert.deepEqual(results, [record, record]);
    assert.deepEqual(await repository.append(record), record);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), input.riskDecisionId), origin);
    assert.equal(JSON.parse(before.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v3");
  });
});

test("risk policy origin rejects tampered receipts and rehashed future observations", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    const path = createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    await writeFile(path, `${JSON.stringify({ ...entry, policyOrigin: { ...entry.policyOrigin, activationId: "other" } })}\n${JSON.stringify(marker)}\n`);
    await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), /corrupt line/);
    for (const [policyOrigin, error] of [
      [{ ...entry.policyOrigin, observedAt: new Date(Date.parse(entry.record.decidedAt) + 1).toISOString() }, /corrupt line/],
      [{ ...entry.policyOrigin, activationId: "other" }, /policy origin does not match/]
    ] as const) {
      const { entryHash: _entryHash, ...payload } = { ...entry, policyOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionPolicy(input), error);
    }
  });
});

test("policy-bound risk creation waits for activation fsync and fails without a decision on sync error", async (context) => {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-sync-"));
  try {
    await storePolicyFixture(directory, fixture);
    const eventPath = createRuntimePortfolioPolicyActivationPaths(directory).eventsPath;
    const eventStat = await stat(eventPath, { bigint: true });
    const probe = await open(eventPath, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let syncedAt: number | null = null;
    let successfulSourceSyncs = 0;
    let failSync = true;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const metadata = await this.stat({ bigint: true });
      if (metadata.isFile() && metadata.ino === eventStat.ino &&
        (process.platform === "win32" || metadata.dev === eventStat.dev)) {
        if (failSync) throw new Error("injected activation fsync failure");
        await originalSync.call(this);
        context.mock.timers.setTime(Date.now() + 20);
        syncedAt = Date.now();
        successfulSourceSyncs++;
        return;
      }
      return originalSync.call(this);
    });
    try {
      const repository = new PortfolioActionRiskDecisionFileRepository(directory);
      const { decidedAt: _decidedAt, ...creationInput } = decisionInput(fixture, "BUY");
      await assert.rejects(repository.createAndAppendWithPolicyOrigin(creationInput), /injected activation fsync failure/);
      assert.deepEqual(await repository.readAll(), []);
      failSync = false;
      const record = await repository.createAndAppendWithPolicyOrigin(creationInput);
      assert.equal(successfulSourceSyncs, 1);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), record.riskDecisionId);
      assert.ok(syncedAt !== null);
      assert.ok(Date.parse(origin.policyOrigin!.observedAt) >= syncedAt);
      assert.ok(Date.parse(record.decidedAt) >= syncedAt);
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("plan-bound risk decision preserves causal sources through restart and exact retries", async () => {
  for (const side of ["BUY", "SELL"] as const) await withPlanFixture(side, false, async ({ directory, repository, candidate, plan, events }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    const restarted = new PortfolioActionRiskDecisionFileRepository(directory);
    const results = await Promise.all([restarted.createAndAppendWithPlanOrigin(candidate), restarted.createAndAppendWithPlanOrigin(candidate)]);
    assert.deepEqual(results, [record, record]);
    assert.deepEqual(await restarted.append(record), record);
    assert.equal(await readFile(path, "utf8"), before);
    const resolved = await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId });
    assert.equal(resolved.plan.planId, plan.planId);
    assert.equal(resolved.priorState.status, "approved");
    assert.ok(Object.isFrozen(resolved.planOrigin));
    assert.ok(Date.parse(record.decidedAt) >= Date.parse(resolved.planOrigin.observedAt));
    assert.equal(JSON.parse(before.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v4");
    const prior = (await events.readAll()).at(-1)!;
    await events.append(planEvent(plan, "rejected", prior));
    // Historical explanation remains bound to the pre-decision prefix.
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).priorState.status, "approved");
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /approved unfinished/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId, predecessorEventId: prior.planEventId } as Parameters<typeof resolvePortfolioActionRiskDecisionPlan>[0]), /unrecognized_keys/);
  });
});

test("plan-bound risk rejects mismatched action, prior state, lineage and approved target caps before persistence", async () => {
  await withPlanFixture("BUY", false, async ({ repository, candidate }) => {
    for (const patch of [
      { actionId: "other" }, { expectedPortfolioVersion: "other" }, { expectedPortfolioSnapshotHash: hashCanonicalPayload({ other: true }) },
      { priorCumulativeFilledNotionalKrw: 1 }, { priorCumulativeFilledQuantity: 0.1 },
      { actionExecutionTargetHash: HASH }, { symbol: "KR:other" },
      { approvedMaximumFillNotionalKrw: 101 }, { requestedNotionalKrw: 101 },
      { riskRuleScope: { scopeKind: "legacy_reduce_only", legacyPolicyHash: HASH }, turnoverAssessment: { scopeKind: "legacy_reduce_only", countedInBucketTurnover: false } }
    ]) await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...candidate, ...patch } as typeof candidate));
    assert.deepEqual(await repository.readAll(), []);
  });
  await withPlanFixture("SELL", true, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).action.lineageKind, "unassigned_legacy_reduce_only");
  });
});

test("plan-bound quantity approvals reject requested notional above cap even when approved maxima fit", async () => {
  for (const { side, wholeShares } of [
    { side: "SELL", wholeShares: false }, { side: "SELL", wholeShares: true }, { side: "BUY", wholeShares: true }
  ] as const) await withPlanFixture(side, false, async ({ directory, repository, candidate }) => {
    const request = { ...candidate, requestedQuantity: wholeShares ? 1 : 0.3 };
    for (const requestedNotionalKrw of [101, 1000]) {
      await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...request, requestedNotionalKrw }), /remaining action notional cap/);
      assert.deepEqual(await repository.readAll(), []);
    }
    const record = await repository.createAndAppendWithPlanOrigin(request);
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).decision.requestedNotionalKrw, 100);
  }, wholeShares);
});

test("plan-bound risk derives fractional remaining quantities from stored partial fills", async () => {
  await withPlanFixture("SELL", false, async ({ directory, repository, candidate, plan, events }) => {
    const approval = (await events.readAll()).at(-1)!;
    await events.append(createRebalancePlanEvent({
      ...planScope(plan), asOf: new Date().toISOString(), eventType: "execution_applied", previousPlanEventId: approval.planEventId,
      actionId: "action-1", actionSequence: 0, fillSequence: 0, fillId: "fill-1", paperFillRecordId: "paper-1", paperFillHash: HASH,
      riskDecisionId: "prior-risk", requestedNotionalKrw: 10, requestedQuantity: 0.1, filledNotionalKrw: 10, filledQuantity: 0.1,
      cumulativeFilledNotionalKrw: 10, cumulativeFilledQuantity: 0.1, expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: HASH,
      resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 })
    }));
    const remaining = { ...candidate, expectedPortfolioVersion: "v2", expectedPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 }),
      priorCumulativeFilledNotionalKrw: 10, priorCumulativeFilledQuantity: 0.1, requestedQuantity: 0.2,
      requestedNotionalKrw: 20, worstCaseFillNotionalKrw: 20, approvedMaximumFillNotionalKrw: 20,
      cashAssessment: { side: "SELL" as const, expectedMinimumNetCashCreditKrw: 19 },
      turnoverAssessment: { scopeKind: "bucket" as const, turnoverStateId: "turnover-2", turnoverStateHash: HASH,
        turnoverWindowOpenPortfolioNetWorthKrw: 1000, priorBucketTurnoverNotionalKrw: 10, requestedBucketTurnoverNotionalKrw: 20, resultingBucketTurnoverRatio: 0.03 }
    };
    await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...remaining, requestedNotionalKrw: 91 }), /remaining action notional cap/);
    assert.deepEqual(await repository.readAll(), []);
    const record = await repository.createAndAppendWithPlanOrigin(remaining);
    const resolved = await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId });
    assert.equal(resolved.progress.cumulativeFilledQuantity, 0.1);
    await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...remaining, requestedQuantity: 0.20000000000000004 }), /remaining quantity/);
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /pre-state/);
  });
});

test("plan-bound risk cannot add a plan receipt to preexisting policy-only or raw decisions", async () => {
  for (const policyOnly of [true, false]) await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = policyOnly ? await repository.createAndAppendWithPolicyOrigin(candidate)
      : await repository.append(createPortfolioActionRiskDecision({ ...candidate, decidedAt: new Date().toISOString() }));
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /cannot be added or replaced|original activation history boundary/);
    await assert.rejects(repository.createAndAppendWithPlanOrigin(record), /cannot accept a record or timestamp/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId }), /before-creation provenance/);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(await repository.readAll(), [record]);
  });
});

test("plan-bound risk resolver rejects rehashed receipts and missing stored plan or events", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const patch of [{ planCommitHash: HASH }, { predecessorCommitHash: HASH }, { predecessorEventId: "missing" },
      { planHash: HASH }, { observedAt: new Date(Date.parse(record.decidedAt) + 1000).toISOString() }]) {
      const { entryHash: _oldHash, ...payload } = { ...entry, planOrigin: { ...entry.planOrigin, ...patch } };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input), /origin does not match|does not belong|corrupt line/);
    }
    await writeFile(path, raw);
    for (const source of [createRebalancePlanPaths(directory).recordsPath, createRebalancePlanEventPaths(directory).eventsPath]) {
      const content = await readFile(source, "utf8");
      await writeFile(source, "");
      await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input));
      await writeFile(source, content);
    }
  });
});

test("plan-bound risk waits for plan and event sync and preserves failures without a decision", async (context) => {
  for (const sourceKind of ["plan", "events"] as const) await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const path = sourceKind === "plan" ? createRebalancePlanPaths(directory).recordsPath : createRebalancePlanEventPaths(directory).eventsPath;
    const sourceStat = await stat(path, { bigint: true });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let failSync = true;
    let syncedAt = 0;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      if (own.isFile() && own.ino === sourceStat.ino && (process.platform === "win32" || own.dev === sourceStat.dev)) {
        if (failSync) throw new Error("injected plan source fsync failure");
        await new Promise((resolve) => setTimeout(resolve, 10));
        await originalSync.call(this); syncedAt = Date.now(); return;
      }
      return originalSync.call(this);
    });
    try {
      await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /injected plan source fsync failure/);
      assert.deepEqual(await repository.readAll(), []);
      failSync = false;
      const record = await repository.createAndAppendWithPlanOrigin(candidate);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), record.riskDecisionId);
      assert.ok(syncedAt > 0);
      assert.ok(Date.parse(origin.planOrigin!.observedAt) >= syncedAt);
      assert.ok(Date.parse(record.decidedAt) >= syncedAt);
    } finally { mock.mock.restore(); }
  });
});

test("plan-bound rejected decisions preserve an over-cap request for explanation", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin({ ...candidate, requestedNotionalKrw: 1000, decision: "rejected",
      ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
    assert.equal((await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: record.riskDecisionId })).decision.decision, "rejected");
  });
});

test("plan-bound whole-share approvals reject fractional requests and completed actions", async () => {
  await withPlanFixture("BUY", false, async ({ repository, candidate, plan, events }) => {
    await assert.rejects(repository.createAndAppendWithPlanOrigin({ ...candidate, requestedQuantity: 0.5 }), /whole-share quantity/);
    await repository.createAndAppendWithPlanOrigin(candidate);
    const approval = (await events.readAll()).at(-1)!;
    await events.append(createRebalancePlanEvent({ ...planScope(plan), asOf: new Date().toISOString(), eventType: "execution_applied", previousPlanEventId: approval.planEventId,
      actionId: "action-1", actionSequence: 0, fillSequence: 0, fillId: "fill-1", paperFillRecordId: "paper-1", paperFillHash: HASH, riskDecisionId: "prior-risk",
      requestedNotionalKrw: 100, requestedQuantity: 1, filledNotionalKrw: 100, filledQuantity: 1, cumulativeFilledNotionalKrw: 100, cumulativeFilledQuantity: 1,
      expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: HASH, resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 }) }));
    await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /next unfinished action/);
  }, true);
});

test("plan-bound creation observes retirement committed during the plan read before deciding", async (context) => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
    const mock = context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (this: RebalancePlanEventFileRepository) {
      const history = await original.call(this);
      await new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies).appendRetired({
        portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId, reasonCode: "retired_during_plan_read", createdAt: new Date().toISOString()
      });
      return history;
    });
    try {
      await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /active runtime portfolio policy is required/);
      assert.deepEqual(await repository.readAll(), []);
    } finally { mock.mock.restore(); }
  });
});

test("plan-bound historical resolution preserves its durable generation after a backdated retirement", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const before = await resolvePortfolioActionRiskDecisionPlan(input);
    const fixture = policyFixture();
    const store = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies);
    await store.appendRetired({ portfolioId: record.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "timestamp_captured_before_lock", createdAt: record.decidedAt });
    // Current policy sees the retirement, but it was not in the decision's durable generation.
    await assert.rejects(store.resolveActiveAsOf(record.portfolioId, record.decidedAt), /active runtime portfolio policy is required/);
    assert.deepEqual(await resolvePortfolioActionRiskDecisionPlan(input), before);
    await assert.rejects(new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithPlanOrigin(candidate), /active runtime portfolio policy is required/);
  });
});

test("plan-bound retries preserve the original generation and new decisions include future-effective events", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const before = await resolvePortfolioActionRiskDecisionPlan(input);
    const fixture = policyFixture();
    const store = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies);
    await store.appendRetired({ portfolioId: record.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "future_retirement", createdAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.deepEqual(await repository.createAndAppendWithPlanOrigin(candidate), record);
    assert.deepEqual(await resolvePortfolioActionRiskDecisionPlan(input), before);
    const next = await repository.createAndAppendWithPlanOrigin({ ...candidate, requestedNotionalKrw: 99 });
    const resolved = await resolvePortfolioActionRiskDecisionPlan({ baseDir: directory, riskDecisionId: next.riskDecisionId });
    assert.deepEqual(resolved.origin.policyOrigin!.activationHistory, { eventCount: 2, eventsHash: hashCanonicalPayload(await store.readAll()) });
    assert.equal(before.origin.policyOrigin!.activationHistory!.eventCount, 1);
  });
});

test("plan-bound retry rejects truncated or replaced activation generations despite the same active policy", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const store = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies);
    const path = createRuntimePortfolioPolicyActivationPaths(directory).eventsPath;
    const prefix = await readFile(path, "utf8");
    const retirement = { portfolioId: candidate.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "future_retirement", createdAt: new Date(Date.now() + 3_600_000).toISOString() };
    await store.appendRetired(retirement);
    const original = await readFile(path, "utf8");
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    const restarted = new PortfolioActionRiskDecisionFileRepository(directory);
    for (const replaced of [false, true]) {
      await writeFile(path, prefix);
      if (replaced) await store.appendRetired({ ...retirement, reasonCode: "replacement_retirement" });
      assert.equal((await store.resolveActiveAsOf(candidate.portfolioId, new Date().toISOString())).policy.policyHash, candidate.policyHash);
      await assert.rejects(restarted.createAndAppendWithPlanOrigin(candidate), /activation history boundary/);
      assert.equal(await readFile(riskPath, "utf8"), riskBytes);
    }
    await writeFile(path, original);
    assert.deepEqual(await restarted.createAndAppendWithPlanOrigin(candidate), record);
    assert.equal(await readFile(riskPath, "utf8"), riskBytes);
  });
});

test("plan-bound policy generation boundaries reject missing, altered and truncated evidence", async () => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const record = await repository.createAndAppendWithPlanOrigin(candidate);
    const input = { baseDir: directory, riskDecisionId: record.riskDecisionId };
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const activationHistory of [undefined, { ...entry.policyOrigin.activationHistory, eventCount: 0 },
      { ...entry.policyOrigin.activationHistory, eventCount: 2 }, { ...entry.policyOrigin.activationHistory, eventsHash: HASH }]) {
      const { entryHash: _oldHash, ...payload } = { ...entry, policyOrigin: { ...entry.policyOrigin, activationHistory } };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input), /history boundary|corrupt line/);
    }
    await writeFile(path, raw);
    const source = createRuntimePortfolioPolicyActivationPaths(directory).eventsPath;
    await writeFile(source, "");
    await assert.rejects(resolvePortfolioActionRiskDecisionPlan(input), /history boundary/);
  });
});

test("plan-bound creation rechecks retirement after the initial activation snapshot unlocks", async (context) => {
  await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const original = RuntimePortfolioPolicyActivationFileRepository.prototype.readDurableGeneration;
    let retired = false;
    const mock = context.mock.method(RuntimePortfolioPolicyActivationFileRepository.prototype, "readDurableGeneration", async function (this: RuntimePortfolioPolicyActivationFileRepository) {
      const generation = await original.call(this);
      if (!retired) {
        retired = true;
        await this.appendRetired({ portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId,
          reasonCode: "retired_after_snapshot_unlock", createdAt: new Date().toISOString() });
      }
      return generation;
    });
    try {
      await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /active runtime portfolio policy is required/);
      assert.ok(retired);
      assert.deepEqual(await repository.readAll(), []);
    } finally { mock.mock.restore(); }
  });
});

test("plan-bound persistence holds the activation lock through Risk fsync and releases it on failure", async (context) => {
  for (const failSync of [false, true]) await withPlanFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const fixture = policyFixture();
    const activationStore = new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies,
      { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const retire = () => activationStore.appendRetired({ portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId,
      reasonCode: "concurrent_retirement", createdAt: new Date().toISOString() });
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const probe = await open(join(directory, "sync-probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let checked = false;
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const source = await stat(path, { bigint: true }).catch(() => undefined);
      if (!checked && source !== undefined && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) {
        checked = true;
        await assert.rejects(retire(), /lock is unavailable/);
        if (failSync) throw new Error("injected Risk commit failure");
      }
      return originalSync.call(this);
    });
    try {
      if (failSync) await assert.rejects(repository.createAndAppendWithPlanOrigin(candidate), /injected Risk commit failure/);
      else await repository.createAndAppendWithPlanOrigin(candidate);
      assert.ok(checked);
    } finally { mock.mock.restore(); }
    assert.equal((await retire()).eventType, "retired");
  });
});

test("risk plan observation retains the locked read time when a new event arrives before return", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withPlanFixture("BUY", false, async ({ directory, plan, events }) => {
      const ordinary = await events.readVerifiedHistory();
      assert.throws(() => resolveDurableRebalancePlanEventObservation(ordinary, plan.planId), /no durable observation/);
      const original = RebalancePlanEventFileRepository.prototype.readDurableVerifiedHistory;
      const mock = context.mock.method(RebalancePlanEventFileRepository.prototype, "readDurableVerifiedHistory", async function (this: RebalancePlanEventFileRepository) {
        const history = await original.call(this);
        context.mock.timers.setTime(now + 10);
        await events.append(planEvent(plan, "rejected", history.events.at(-1)!));
        return history;
      });
      try {
        const result = await readStoredRiskDecisionPlanContext({ baseDir: directory, planId: plan.planId });
        assert.equal(result.state.status, "approved");
        assert.equal(result.origin.observedAt, new Date(now).toISOString());
        assert.equal((await events.readPlanState(plan.planId)).status, "rejected");
      } finally { mock.mock.restore(); }
    });
  } finally { context.mock.timers.reset(); }
});

test("mandate-bound risk factory persists exact source and restart resolver verifies both sides", async () => {
  for (const side of ["BUY", "SELL"] as const) await withMandateFixture(side, async ({ directory, repository, candidate, mandate }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const resolved = await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.equal(resolved.mandate.record.mandateId, mandate.mandateId);
    assert.equal(resolved.mandateOrigin.mandateHash, mandate.mandateHash);
    assert.equal(resolved.mandateOrigin.observation.recordCount, 1);
    assert.equal(resolved.mandateOrigin.observation.eventCount, 1);
    assert.ok(Date.parse(decision.decidedAt) >= Date.parse(resolved.mandateOrigin.observation.observedAt));
    assert.ok(Object.isFrozen(resolved.mandateOrigin.observation));
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    assert.equal(JSON.parse(before.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v5");
    assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithMandateOrigin(candidate), decision);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("mandate-bound risk rejects missing source, legacy actions and receipt upgrades", async () => {
  for (const legacy of [false, true]) await withPlanFixture(legacy ? "SELL" : "BUY", legacy, async ({ repository, candidate }) => {
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate|requires a mandate action/);
    assert.equal((await repository.readAll()).length, 0);
  });
  await withMandateFixture("BUY", async ({ directory, repository, candidate }) => {
    const old = await repository.createAndAppendWithPlanOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(path, "utf8");
    await assert.rejects(() => resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: old.riskDecisionId }), /lacks mandate-before-creation/);
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /cannot be added or replaced/);
    assert.equal(await readFile(path, "utf8"), before);
  });
});

test("mandate-bound risk rejects scope and validity mismatches without persisting", async () => {
  for (const overrides of [
    { bucket: "long_term" as const }, { portfolioId: "other-portfolio" }, { market: "US" as const, symbol: "US:TEST" },
    { symbol: "KR:000660" }, { policyHash: HASH }, { validFrom: "2099-01-01T00:00:00.000Z", reviewAfter: "2099-02-01T00:00:00.000Z" },
    { expiresAt: DECIDED_AT, reviewAfter: "2026-09-02T00:00:00.000Z" }
  ]) await withMandateFixture("BUY", async ({ repository, candidate }) => {
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate|mandate bucket/);
    assert.equal((await repository.readAll()).length, 0);
  }, { overrides });
});

test("mandate risk approval obeys lifecycle and manual reduce-only authority", async () => {
  for (const state of ["proposed", "retired", "review_required"] as const) {
    await withMandateFixture("BUY", async ({ repository, candidate }) => {
      await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate|active open-or-increase/);
      assert.equal((await repository.readAll()).length, 0);
    }, { state });
  }
  await withMandateFixture("BUY", async ({ repository, candidate }) => {
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active open-or-increase/);
    assert.equal((await repository.readAll()).length, 0);
  }, { reduceOnly: true });
  await withMandateFixture("SELL", async ({ directory, repository, candidate }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    assert.equal((await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).mandate.status, "review_required");
  }, { state: "review_required", reduceOnly: true });
});

test("mandate historical receipt survives later backdated retirement but new creation fails", async () => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate, mandate, mandates }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const activation = (await mandates.readSnapshot()).events[0]!;
    await mandates.appendEvent(mandateTransition(mandate, "retired", activation.mandateEventId));
    const result = await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.equal(result.mandate.status, "active");
    assert.equal(result.mandateOrigin.observation.eventCount, 1);
    await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate/);
    assert.equal((await repository.readAll()).length, 1);
  });
});

test("mandate retry preserves original generation and rejects lost or replaced observed suffix", async () => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate, mandate, mandates }) => {
    const activation = (await mandates.readSnapshot()).events[0]!;
    const { mandateEventId: _id, mandateEventHash: _hash, ...retiredPayload } = mandateTransition(mandate, "retired", activation.mandateEventId);
    const futurePayload = { ...retiredPayload, asOf: "2099-01-01T00:00:00.000Z", createdAt: "2099-01-01T00:00:00.000Z" };
    const canonicalFuture = createInvestmentMandateEvent(futurePayload);
    await mandates.appendEvent(canonicalFuture);
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const before = await readFile(riskPath, "utf8");
    const extra = createInvestmentMandateRecord({ ...mandatePayload(candidate), symbol: "KR:000660" });
    await mandates.appendRecord(extra);
    assert.deepEqual(await repository.createAndAppendWithMandateOrigin(candidate), decision);
    assert.equal(await readFile(riskPath, "utf8"), before);
    const eventsPath = createInvestmentMandatePaths(directory).eventsPath;
    const original = await readFile(eventsPath, "utf8");
    for (const replacement of ["", `${JSON.stringify(createInvestmentMandateEvent({ ...futurePayload, reasonCodes: ["changed"] }))}\n`]) {
      await writeFile(eventsPath, `${JSON.stringify(activation)}\n${replacement}`, "utf8");
      await assert.rejects(() => repository.createAndAppendWithMandateOrigin(candidate), /source prefixes/);
      await assert.rejects(() => resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /source prefixes/);
      assert.equal(await readFile(riskPath, "utf8"), before);
    }
    await writeFile(eventsPath, original, "utf8");
  });
});

test("mandate-bound creation waits for both source syncs and holds source lock through Risk commit", async (context) => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate, mandate, mandates }) => {
    const paths = createInvestmentMandatePaths(directory);
    const metadata = await Promise.all([stat(paths.recordsPath, { bigint: true }), stat(paths.eventsPath, { bigint: true })]);
    const probe = await open(paths.recordsPath, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    const activation = (await mandates.readSnapshot()).events[0]!;
    const retirement = mandateTransition(mandate, "retired", activation.mandateEventId);
    let failingIndex = 0;
    const synced = new Map<number, number>();
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const sourceIndex = metadata.findIndex((source) => own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev));
      if (sourceIndex >= 0) {
        if (failingIndex === sourceIndex) throw new Error("injected mandate fsync failure");
        await originalSync.call(this);
        synced.set(sourceIndex, Date.now());
        return;
      }
      return originalSync.call(this);
    });
    const writeMock = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].includes('"schemaVersion":"portfolio_action_risk_decision_commit.v1"')) {
        await assert.rejects(new InvestmentMandateFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).appendEvent(retirement), /lock is unavailable/);
        commitProbed = true;
      }
      return originalWrite.apply(this, args);
    });
    try {
      for (failingIndex of [0, 1]) {
        await assert.rejects(repository.createAndAppendWithMandateOrigin(candidate), /injected mandate fsync failure/);
        assert.equal((await repository.readAll()).length, 0);
      }
      failingIndex = -1;
      const decision = await repository.createAndAppendWithMandateOrigin(candidate);
      assert.equal(commitProbed, true);
      assert.equal(synced.size, 2);
      for (const at of synced.values()) assert.ok(Date.parse(decision.decidedAt) >= at);
      await mandates.appendEvent(retirement);
    } finally { writeMock.mock.restore(); syncMock.mock.restore(); }
  });
});

test("mandate receipts reject rehashed identity, prefix, future time and unknown field mutations", async () => {
  await withMandateFixture("BUY", async ({ directory, repository, candidate }) => {
    const decision = await repository.createAndAppendWithMandateOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    const [entry, marker] = raw.trimEnd().split("\n").map((line) => JSON.parse(line));
    const receipt = entry.mandateOrigin;
    for (const [mandateOrigin, error] of [
      [{ ...receipt, mandateId: "other" }, /mandate origin does not match/],
      [{ ...receipt, mandateEventHash: HASH }, /mandate origin does not match/],
      [{ ...receipt, observation: { ...receipt.observation, eventsHash: HASH } }, /source prefixes/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: "2099-01-01T00:00:00.000Z" } }, /corrupt line/],
      [{ ...receipt, unexpected: true }, /corrupt line/]
    ] as const) {
      const { entryHash: _hash, ...payload } = { ...entry, mandateOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), error);
    }
  });
});

test("mandate validity expiry is exclusive and rejected BUY can explain review-required state", async (context) => {
  const expiresAt = "2026-09-10T00:00:00.000Z";
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse(expiresAt) });
  try {
    await withMandateFixture("SELL", async ({ repository, candidate }) => {
      await assert.rejects(repository.createAndAppendWithMandateOrigin(candidate), /active investment mandate/);
      assert.equal((await repository.readAll()).length, 0);
    }, { overrides: { expiresAt } });
    await withMandateFixture("BUY", async ({ directory, repository, candidate }) => {
      const decision = await repository.createAndAppendWithMandateOrigin({ ...candidate, decision: "rejected",
        ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
      assert.equal((await resolvePortfolioActionRiskDecisionMandate({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).mandate.status, "review_required");
    }, { state: "review_required" });
  } finally { context.mock.timers.reset(); }
});

test("snapshot-bound Risk replays actual valuation inputs for mandate BUY/SELL and legacy SELL", async () => {
  for (const [side, legacy] of [["BUY", false], ["SELL", false], ["SELL", true]] as const) {
    await withSnapshotFixture(side, legacy, async ({ directory, repository, candidate, snapshot }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
      assert.deepEqual(result.sizing.snapshot, snapshot);
      assert.equal(result.sizing.verifiedExposure.exposureSnapshot.cashKrw, 1_000);
      assert.equal(result.sizing.snapshot.virtualPortfolio.positions[0]!.quantity, 2);
      assert.equal(result.sizing.verifiedExposure.exposureSnapshot.marketExposureKrw.KR, 200);
      assert.equal(result.mandate === null, legacy);
      assert.ok(Date.parse(result.snapshotOrigin.observation.observedAt) <= Date.parse(decision.decidedAt));
      const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
      const raw = await readFile(path, "utf8");
      assert.equal(JSON.parse(raw.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v6");
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithSnapshotOrigin(candidate), decision);
      assert.equal(await readFile(path, "utf8"), raw);
    });
  }
});

test("snapshot-bound Risk rejects unavailable, wrong-scope and future pre-states without writes", async () => {
  for (const patch of [{ portfolioId: "other" }, { portfolioVersion: "v2" }, { policyHash: HASH }, { asOf: "2099-01-01T00:00:00.000Z" }]) {
    await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot scope or as-of mismatch/);
      assert.equal((await repository.readAll()).length, 0);
    }, patch);
  }
  await withSnapshotFixture("SELL", true, async ({ directory, repository, candidate }) => {
    await writeFile(createPortfolioSizingSnapshotPaths(directory).recordsPath, "");
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot source does not resolve/);
    assert.equal((await repository.readAll()).length, 0);
  });
});

test("snapshot-bound Risk blocks approved BUY with any unassigned holdings but preserves rejected explanations", async () => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate }) => {
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /without unassigned exposure/);
    assert.equal((await repository.readAll()).length, 0);
    const rejected = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, decision: "rejected",
      ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
    const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: rejected.riskDecisionId });
    assert.equal(result.decision.decision, "rejected");
    assert.equal(result.sizing.verifiedExposure.exposureSnapshot.unassignedExposureKrw, 200);
  }, { unassigned: true });
});

test("snapshot-bound creation freezes caller input before source acquisition and rejects injected record fields", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin({ ...candidate, [key]: undefined } as typeof candidate), /cannot accept a record or timestamp/);
    }
    const mutable = { ...candidate };
    const pending = repository.createAndAppendWithSnapshotOrigin(mutable);
    mutable.expectedPortfolioVersion = "mutated";
    mutable.planId = "mutated";
    const decision = await pending;
    assert.equal(decision.expectedPortfolioVersion, candidate.expectedPortfolioVersion);
    assert.equal(decision.planId, candidate.planId);
  });
});

test("snapshot-bound Risk preserves original prefixes after append and rejects source loss on replay or retry", async () => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate, snapshot }) => {
    const snapshots = new PortfolioSizingSnapshotFileRepository(directory);
    const extra = snapshotFixture(candidate, false, { portfolioVersion: "v2" });
    await snapshots.append(extra);
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    await snapshots.append(snapshotFixture(candidate, false, { portfolioVersion: "v3" }));
    assert.deepEqual(await repository.createAndAppendWithSnapshotOrigin(candidate), decision);
    assert.deepEqual((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).sizing.snapshot, snapshot);
    const path = createPortfolioSizingSnapshotPaths(directory).recordsPath;
    for (const records of [[snapshot], [snapshot, snapshotFixture(candidate, false, { portfolioVersion: "v2", asOf: "2026-09-02T00:00:00.000Z" })]]) {
      await writeFile(path, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /source prefix/);
      await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /source prefix/);
      assert.equal(await readFile(riskPath, "utf8"), riskBytes);
    }
    await writeFile(path, `${JSON.stringify(snapshot)}\n{corrupt}\n`);
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /corrupt line/);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /corrupt line/);
  });
});

test("snapshot-bound Risk resolves the resulting pre-state after a partial SELL instead of the preview snapshot", async () => {
  await withSnapshotFixture("SELL", false, async ({ directory, repository, candidate, plan, events, snapshot }) => {
    const resulting = snapshotFixture(candidate, false, { portfolioVersion: "v2", quantity: 0.2, cashKrw: 1_010 });
    await new PortfolioSizingSnapshotFileRepository(directory).append(resulting);
    const approval = (await events.readAll()).at(-1)!;
    await events.append(createRebalancePlanEvent({ ...planScope(plan), asOf: new Date().toISOString(), eventType: "execution_applied",
      previousPlanEventId: approval.planEventId, actionId: "action-1", actionSequence: 0, fillSequence: 0,
      fillId: "fill-1", paperFillRecordId: "paper-1", paperFillHash: HASH, riskDecisionId: "prior-risk",
      requestedNotionalKrw: 10, requestedQuantity: 0.1, filledNotionalKrw: 10, filledQuantity: 0.1,
      cumulativeFilledNotionalKrw: 10, cumulativeFilledQuantity: 0.1,
      expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: snapshot.portfolioSnapshotHash,
      resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: resulting.portfolioSnapshotHash }));
    const remaining = { ...candidate, expectedPortfolioVersion: "v2", expectedPortfolioSnapshotHash: resulting.portfolioSnapshotHash,
      priorCumulativeFilledNotionalKrw: 10, priorCumulativeFilledQuantity: 0.1, requestedQuantity: 0.2,
      requestedNotionalKrw: 20, worstCaseFillNotionalKrw: 20, approvedMaximumFillNotionalKrw: 20,
      cashAssessment: { side: "SELL" as const, expectedMinimumNetCashCreditKrw: 19 },
      turnoverAssessment: { scopeKind: "bucket" as const, turnoverStateId: "turnover-2", turnoverStateHash: HASH,
        turnoverWindowOpenPortfolioNetWorthKrw: 1_000, priorBucketTurnoverNotionalKrw: 10,
        requestedBucketTurnoverNotionalKrw: 20, resultingBucketTurnoverRatio: 0.03 } };
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /pre-state/);
    const decision = await repository.createAndAppendWithSnapshotOrigin(remaining);
    const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.deepEqual(result.sizing.snapshot, resulting);
    assert.equal(result.sizing.verifiedExposure.exposureSnapshot.cashKrw, 1_010);
    assert.equal(result.sizing.snapshot.virtualPortfolio.positions[0]!.quantity, 0.2);
  }, { quantity: 0.3 });
});

test("snapshot provenance cannot be synthesized on older Risk records or accepted with rehashed receipt mutations", async () => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const old = await repository.createAndAppendWithMandateOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot origin cannot be added/);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: old.riskDecisionId }), /lacks snapshot-before-creation/);
    assert.equal(await readFile(path, "utf8"), raw);
  });
  await withSnapshotFixture("SELL", true, async ({ directory, repository, candidate }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const receipt = entry.snapshotOrigin;
    for (const [snapshotOrigin, error] of [
      [{ ...receipt, portfolioSnapshotId: "other" }, /snapshot origin does not match/],
      [{ ...receipt, exposureSnapshotHash: HASH }, /snapshot origin does not match/],
      [{ ...receipt, portfolioSnapshotHash: HASH }, /corrupt line/],
      [{ ...receipt, observation: { ...receipt.observation, recordsHash: HASH } }, /source prefix/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: "2099-01-01T00:00:00.000Z" } }, /corrupt line/],
      [{ ...receipt, unexpected: true }, /corrupt line/]
    ] as const) {
      const { entryHash: _hash, ...payload } = { ...entry, snapshotOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      await writeFile(path, `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`);
      await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), error);
    }
  });
});

test("snapshot-bound Risk fails closed on source fsync and holds the Snapshot lease through commit", async (context) => {
  await withSnapshotFixture("BUY", false, async ({ directory, repository, candidate }) => {
    const snapshots = new PortfolioSizingSnapshotFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const extra = snapshotFixture(candidate, false, { portfolioVersion: "v2" });
    const path = createPortfolioSizingSnapshotPaths(directory).recordsPath;
    const source = await stat(path, { bigint: true });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    let failSync = true;
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      if (failSync && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) throw new Error("injected snapshot fsync failure");
      return originalSync.call(this);
    });
    const writeMock = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].includes('"schemaVersion":"portfolio_action_risk_decision_commit.v1"')) {
        await assert.rejects(snapshots.append(extra), /lock is unavailable/);
        commitProbed = true;
      }
      return originalWrite.apply(this, args);
    });
    try {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /snapshot fsync failure/);
      assert.equal((await repository.readAll()).length, 0);
      failSync = false;
      await repository.createAndAppendWithSnapshotOrigin(candidate);
      assert.equal(commitProbed, true);
    } finally { writeMock.mock.restore(); syncMock.mock.restore(); }
    await snapshots.append(extra);
  });
});

test("snapshot cash capacity applies the larger absolute or target-ratio reserve before BUY approval", async () => {
  for (const [cashKrw, quantity, reserve, capacity, approved] of [
    [0, 2, 100, 0, false], [99, 2, 100, 0, false], [100, 2, 100, 0, false],
    [209, 2, 100, 109, false], [210, 2, 100, 110, true],
    [1_000, 50, 900, 100, false], [1_012, 50, 902, 110, true]
  ] as const) {
    await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
      if (!approved) {
        await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
        assert.deepEqual(await repository.readAll(), []);
        return;
      }
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      const resolved = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
      assert.deepEqual(resolved.cashCapacity, { cashKrw, requiredCashReserveKrw: reserve, pendingBuyExposureKrw: 0, maximumNetCashDebitKrw: capacity });
      assert.ok(Object.isFrozen(resolved.cashCapacity));
      const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
      const raw = await readFile(path, "utf8");
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithSnapshotOrigin(candidate), decision);
      assert.equal(await readFile(path, "utf8"), raw);
    }, { cashKrw, quantity });
  }
});

test("snapshot cash capacity bounds net debit including costs and the full approved cap", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    // Gross 100 fits, but the requested net approval cap 110 exceeds cash capacity 105.
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin({ ...candidate,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 106, approvedMaximumNetCashDebitKrw: 106 }
    }), /exceeds snapshot cash capacity/);
    const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 105, approvedMaximumNetCashDebitKrw: 105 }
    });
    assert.equal(decision.decision, "approved");
  }, { cashKrw: 205 });
});

test("snapshot cash capacity subtracts pending BUY and never credits pending SELL proceeds", async () => {
  for (const [side, pending, approved] of [["BUY", 20, true], ["BUY", 21, false], ["SELL", 200, true]] as const) {
    await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
      if (!approved) {
        await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
        assert.deepEqual(await repository.readAll(), []);
        return;
      }
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
      assert.equal(result.cashCapacity?.maximumNetCashDebitKrw, side === "BUY" ? 110 : 130);
    }, { cashKrw: 230, pendingActionInputs: [pendingCashFixture(side, pending)] });
  }
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds snapshot cash capacity/);
  }, { cashKrw: 209, pendingActionInputs: [pendingCashFixture("SELL", 200)] });
});

test("snapshot cash capacity preserves rejected BUY explanations and reduce-only SELL at zero cash", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, decision: "rejected",
      ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
    const result = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
    assert.equal(result.cashCapacity?.maximumNetCashDebitKrw, 0);
    assert.equal(result.decision.decision, "rejected");
  }, { cashKrw: 0 });
  for (const legacy of [false, true]) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      assert.equal((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).cashCapacity, null);
    }, { cashKrw: 0 });
  }
});

test("snapshot cash capacity rejects fractional or unsafe approved net amounts", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate }) => {
    for (const amount of [100.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin({ ...candidate,
        cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: amount, approvedMaximumNetCashDebitKrw: amount }
      }), /requires safe integer net cash amounts/);
      assert.deepEqual(await repository.readAll(), []);
    }
  });
});

test("snapshot cash capacity historical replay rejects fully rehashed over-cash approval without rewriting bytes", async () => {
  await withSnapshotFixture("BUY", false, async ({ repository, candidate, directory }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _inputHash, ...payload } = decision;
    const altered = createPortfolioActionRiskDecision({ ...payload,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 100, approvedMaximumNetCashDebitKrw: 111 } });
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _entryHash, ...entryPayload } = entry;
    const entryHash = hashCanonicalPayload({ ...entryPayload, record: altered });
    const { commitHash: _commitHash, ...markerPayload } = marker;
    const updatedMarker = { ...markerPayload, entryHash };
    const raw = `${JSON.stringify({ ...entryPayload, record: altered, entryHash })}\n${JSON.stringify({ ...updatedMarker, commitHash: hashCanonicalPayload(updatedMarker) })}\n`;
    await writeFile(path, raw);
    assert.deepEqual(await repository.readAll(), [altered]);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: altered.riskDecisionId }), /exceeds snapshot cash capacity/);
    assert.equal(await readFile(path, "utf8"), raw);
  }, { cashKrw: 210 });
});

test("cash capacity independently replays source hashes and safely saturates large pending commitments", () => {
  const { policy } = policyFixture();
  const candidate = decisionInput(policyFixture(), "BUY");
  const snapshot = snapshotFixture(candidate, false, { cashKrw: 100, pendingActionInputs: [pendingCashFixture("BUY", Number.MAX_SAFE_INTEGER)] });
  const decision = createPortfolioActionRiskDecision({ ...candidate, expectedPortfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    decision: "rejected", ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
  assert.equal(validateRiskDecisionCashCapacity({ decision, snapshot, policy })?.maximumNetCashDebitKrw, 0);
  assert.throws(() => validateRiskDecisionCashCapacity({ decision, snapshot: { ...snapshot, portfolioSnapshotHash: HASH }, policy }), /identity|hash/);
  assert.throws(() => validateRiskDecisionCashCapacity({ decision, snapshot, policy: policyFixture("v2").policy }), /scope/);
});

function pendingCashFixture(side: "BUY" | "SELL", remainingNotionalKrw: number): PendingPortfolioActionInput {
  const common = { planId: "pending-plan", planHash: HASH, planEventId: "pending-event", planEventHash: HASH,
    actionId: "action-1", actionExecutionTargetHash: HASH, market: "KR" as const, symbol: "KR:005930", remainingNotionalKrw, asOf: CREATED_AT };
  return side === "BUY" ? { ...common, side, openingCapacityReservationId: "pending-reservation", openingCapacityReservationHash: HASH }
    : { ...common, side, remainingQuantity: 2, priceEvidenceRef: "snapshot-price" };
}

test("snapshot SELL approval requires the exact owned quantity without an epsilon", async () => {
  for (const legacy of [false, true]) {
    for (const quantity of [0.2, 0.29999999999999993, 0.3]) {
      await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
        if (quantity < 0.3) {
          await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds owned snapshot quantity/);
          assert.deepEqual(await repository.readAll(), []);
          return;
        }
        const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
        const resolved = await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
        assert.equal(resolved.sizing.snapshot.virtualPortfolio.positions[0]!.quantity, 0.3);
        const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
        const bytes = await readFile(path, "utf8");
        assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithSnapshotOrigin(candidate), decision);
        assert.equal(await readFile(path, "utf8"), bytes);
      }, { quantity });
    }
  }
});

test("snapshot SELL cannot borrow another bucket or legacy lot even when total symbol holdings cover the request", async () => {
  for (const [legacy, holdingLots] of [
    [false, [{ bucket: "swing", quantity: 0.2 }, { bucket: "long_term", quantity: 5 }, { quantity: 5 }]],
    [true, [{ bucket: "swing", quantity: 5 }, { quantity: 0.2 }]],
    [false, [{ bucket: "long_term", quantity: 5 }]],
    [false, [{ quantity: 5 }]],
    [true, [{ bucket: "swing", quantity: 5 }]],
    [false, []], [true, []]
  ] as Array<[boolean, Array<{ bucket?: StrategyBucket; quantity: number }> ]>) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate }) => {
      await assert.rejects(repository.createAndAppendWithSnapshotOrigin(candidate), /exceeds owned snapshot quantity/);
      assert.deepEqual(await repository.readAll(), []);
    }, { holdingLots });
  }
  for (const legacy of [false, true]) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
      assert.equal((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).decision.decision, "approved");
    }, { holdingLots: [{ bucket: "long_term", quantity: 5 }, { bucket: "swing", quantity: 0.3 }, { quantity: 0.3 }] });
  }
});

test("snapshot SELL rejection remains inspectable when its owned lot is missing", async () => {
  for (const legacy of [false, true]) {
    await withSnapshotFixture("SELL", legacy, async ({ repository, candidate, directory }) => {
      const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, decision: "rejected",
        ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) });
      assert.equal((await resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: decision.riskDecisionId })).decision.decision, "rejected");
    }, { holdingLots: [] });
  }
});

test("snapshot SELL historical replay rejects a rehashed over-owned request", async () => {
  await withSnapshotFixture("SELL", false, async ({ repository, candidate, directory }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin({ ...candidate, requestedQuantity: 0.2 });
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _inputHash, ...payload } = decision;
    const altered = createPortfolioActionRiskDecision({ ...payload, requestedQuantity: 0.3 });
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _entryHash, ...entryPayload } = entry;
    const entryHash = hashCanonicalPayload({ ...entryPayload, record: altered });
    const { commitHash: _commitHash, ...markerPayload } = marker;
    const updatedMarker = { ...markerPayload, entryHash };
    const bytes = `${JSON.stringify({ ...entryPayload, record: altered, entryHash })}\n${JSON.stringify({ ...updatedMarker, commitHash: hashCanonicalPayload(updatedMarker) })}\n`;
    await writeFile(path, bytes);
    assert.deepEqual(await repository.readAll(), [altered]);
    await assert.rejects(resolvePortfolioActionRiskDecisionSnapshot({ baseDir: directory, riskDecisionId: altered.riskDecisionId }), /exceeds owned snapshot quantity/);
    assert.equal(await readFile(path, "utf8"), bytes);
  }, { quantity: 0.2 });
});

function snapshotFixture(candidate: Omit<DecisionInput, "decidedAt">, legacy: boolean,
  overrides: Partial<{ portfolioId: string; portfolioVersion: string; policyHash: string; asOf: string; unassigned: boolean; quantity: number; cashKrw: number; pendingActionInputs: PendingPortfolioActionInput[]; holdingLots: Array<{ bucket?: StrategyBucket; quantity: number }> }> = {}) {
  const portfolioId = overrides.portfolioId ?? candidate.portfolioId;
  const { unassigned = legacy, quantity = 2, cashKrw = 1_000, pendingActionInputs = [], holdingLots, ...scopeOverrides } = overrides;
  const lots = holdingLots ?? [{ quantity, ...(unassigned ? {} : { bucket: "swing" as const }) }];
  const bucketExposureKrw = { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 };
  let positionValue = 0;
  let unassignedExposureKrw = 0;
  for (const lot of lots) {
    const value = Math.round(lot.quantity * 100);
    positionValue += value;
    if (lot.bucket === undefined) unassignedExposureKrw += value;
    else bucketExposureKrw[lot.bucket] += value;
  }
  return createPortfolioSizingSnapshot({
    portfolioId, portfolioVersion: "v1", policyHash: candidate.policyHash, asOf: CREATED_AT, ...scopeOverrides,
    virtualPortfolio: { portfolioId, cashKrw, updatedAt: CREATED_AT,
      positions: lots.map((lot) => ({ market: candidate.market, symbol: candidate.symbol, quantity: lot.quantity, averagePriceKrw: 100,
        ...(lot.bucket === undefined ? {} : { strategyBucket: lot.bucket }), sector: "Electronics", region: "KR", updatedAt: CREATED_AT })) },
    valuationInputs: lots.length === 0 ? [] : [{ kind: "mark_price", market: candidate.market, symbol: candidate.symbol, priceKrw: 100,
      evidenceRef: "snapshot-price", evidenceAsOf: CREATED_AT }], pendingActionInputs,
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw + positionValue, cashKrw,
      bucketExposureKrw,
      symbolExposureKrw: lots.length === 0 ? [] : [{ market: candidate.market, symbol: candidate.symbol, exposureKrw: positionValue }],
      ...(unassignedExposureKrw === 0 ? {} : { unassignedExposureKrw }),
      marketExposureKrw: { KR: positionValue, US: 0 }, sectorExposureKrw: positionValue === 0 ? {} : { Electronics: positionValue },
      countryExposureKrw: positionValue === 0 ? {} : { KR: positionValue }, currencyExposureKrw: positionValue === 0 ? {} : { KRW: positionValue },
      ...pendingActionExposureTotals(pendingActionInputs) })
  });
}

test("price-bound Risk replays the durable typed quote for assigned BUY/SELL and legacy SELL", async () => {
  for (const [side, legacy] of [["BUY", false], ["SELL", false], ["SELL", true]] as const) {
    await withPriceFixture(side, legacy, async ({ directory, repository, candidate, price, prices }) => {
      const decision = await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
      const input = { baseDir: directory, riskDecisionId: decision.riskDecisionId };
      const result = await resolvePortfolioActionRiskDecisionPrice(input);
      assert.deepEqual(result.sourcePrice.record, price);
      assert.equal(result.sourcePrice.record.priceKrw, 100);
      assert.equal(result.mandate === null, legacy);
      assert.ok(Object.isFrozen(result.priceOrigin.observation));
      assert.ok(Date.parse(result.sourcePrice.appendedAt) <= Date.parse(decision.decidedAt));
      assert.ok(Date.parse(result.priceOrigin.observation.observedAt) <= Date.parse(decision.decidedAt));
      const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
      const raw = await readFile(path, "utf8");
      assert.equal(JSON.parse(raw.split("\n")[0]!).schemaVersion, "portfolio_action_risk_decision_entry.v7");
      await prices.append(createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "fixture-price-next", priceKrw: 101 }));
      assert.deepEqual(await new PortfolioActionRiskDecisionFileRepository(directory).createAndAppendWithPriceOrigin(candidate, price.evidenceRef), decision);
      assert.deepEqual((await resolvePortfolioActionRiskDecisionPrice(input)).priceOrigin, result.priceOrigin);
      assert.equal(await readFile(path, "utf8"), raw);
    });
  }
});

test("price-bound Risk rejects missing, generic, unlisted or wrong-scope price inputs before persistence", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices }) => {
    for (const ref of ["missing", "price-1"]) {
      await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, ref), /does not resolve exactly once/);
    }
    await assert.rejects(repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: ["other"] }, price.evidenceRef), /price source scope/);
    for (const scope of [{ symbol: "KR:000660" }, { market: "US" as const }]) {
      const wrong = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), ...scope });
      await prices.append(wrong);
      await assert.rejects(repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, wrong.evidenceRef] }, wrong.evidenceRef), /price source scope/);
    }
    // Even an old observedAt does not make a source durably available at an earlier decision time.
    const history = await prices.readVerifiedHistory();
    assert.throws(() => validateRiskDecisionPriceState(createPortfolioActionRiskDecision({ ...candidate, decidedAt: DECIDED_AT }), history, price.evidenceRef), /availability mismatch/);
    await writeFile(createSourcePriceEvidencePaths(directory).recordsPath, "");
    await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /does not resolve exactly once/);
    assert.equal((await repository.readAll()).length, 0);
  });
});

test("price-bound Risk retry cannot replace its selected price when both refs are in the same decision input", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices }) => {
    const other = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "fixture-price-other", priceKrw: 101 });
    await prices.append(other);
    const input = { ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, other.evidenceRef] };
    const decision = await repository.createAndAppendWithPriceOrigin(input, price.evidenceRef);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    await assert.rejects(repository.createAndAppendWithPriceOrigin(input, other.evidenceRef), /price origin cannot be added or replaced/);
    assert.equal(await readFile(path, "utf8"), raw);
    assert.deepEqual(await repository.createAndAppendWithPriceOrigin(input, price.evidenceRef), decision);
  });
});

test("price-bound Risk freezes input before awaiting sources and refuses caller-generated fields", async () => {
  await withPriceFixture("BUY", false, async ({ repository, candidate, price }) => {
    for (const key of ["decidedAt", "riskDecisionId", "riskDecisionHash", "riskInputHash"]) {
      await assert.rejects(repository.createAndAppendWithPriceOrigin({ ...candidate, [key]: undefined }, price.evidenceRef), /cannot accept a record or timestamp/);
    }
    const mutable = structuredClone(candidate);
    const pending = repository.createAndAppendWithPriceOrigin(mutable, price.evidenceRef);
    mutable.riskEvidenceRefs.splice(0);
    mutable.symbol = "other";
    const decision = await pending;
    assert.equal(decision.symbol, candidate.symbol);
    assert.ok(decision.riskEvidenceRefs.includes(price.evidenceRef));
  });
});

test("price provenance cannot upgrade prior Risk records or legacy price availability", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price }) => {
    const decision = await repository.createAndAppendWithSnapshotOrigin(candidate);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const raw = await readFile(path, "utf8");
    assert.equal(resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId).priceOrigin, null);
    await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /price origin cannot be added/);
    await assert.rejects(resolvePortfolioActionRiskDecisionPrice({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), /lacks price-before-creation/);
    assert.equal(await readFile(path, "utf8"), raw);
  });
  await withPriceFixture("SELL", true, async ({ directory, repository, candidate, price }) => {
    const legacy = { record: price, appendedAt: CREATED_AT, previousEntryHash: null };
    await writeFile(createSourcePriceEvidencePaths(directory).recordsPath, `${JSON.stringify({ ...legacy, entryHash: hashCanonicalPayload(legacy) })}\n`);
    await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /durable origin is unavailable/);
    assert.equal((await repository.readAll()).length, 0);
  });
});

test("price-bound Risk rejects lost or metadata-replaced source prefixes on retry and historical replay", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price }) => {
    const decision = await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
    const input = { baseDir: directory, riskDecisionId: decision.riskDecisionId };
    const path = createSourcePriceEvidencePaths(directory).recordsPath;
    const source = await readFile(path, "utf8");
    const riskPath = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const riskBytes = await readFile(riskPath, "utf8");
    const [entry, marker] = source.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { entryHash: _hash, ...payload } = { ...entry, appendStartedAt: new Date(Date.parse(entry.appendStartedAt) - 1).toISOString() };
    const entryHash = hashCanonicalPayload(payload);
    const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
    const changed = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
    for (const bytes of ["", changed, `${source}{broken\n`]) {
      await writeFile(path, bytes);
      await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef));
      await assert.rejects(resolvePortfolioActionRiskDecisionPrice(input));
      assert.equal(await readFile(riskPath, "utf8"), riskBytes);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, source);
    assert.deepEqual(await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), decision);
  });
});

test("price receipts reject independently rehashed identity, prefix, time and schema mutations", async () => {
  await withPriceFixture("SELL", true, async ({ directory, repository, candidate, price }) => {
    const decision = await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
    const path = createPortfolioActionRiskDecisionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const receipt = entry.priceOrigin;
    for (const [priceOrigin, error] of [
      [{ ...receipt, evidenceRef: "other" }, /corrupt line/],
      [{ ...receipt, evidenceHash: HASH }, /price origin does not match/],
      [{ ...receipt, observation: { ...receipt.observation, entriesHash: HASH } }, /source prefix/],
      [{ ...receipt, observation: { ...receipt.observation, recordCount: 0 } }, /source prefix/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: "2099-01-01T00:00:00.000Z" } }, /corrupt line/],
      [{ ...receipt, observation: { ...receipt.observation, observedAt: CREATED_AT } }, /observation/],
      [{ ...receipt, unexpected: true }, /corrupt line/],
      [null, /corrupt line/]
    ] as const) {
      const { entryHash: _hash, ...payload } = { ...entry, priceOrigin };
      const entryHash = hashCanonicalPayload(payload);
      const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
      const bytes = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
      await writeFile(path, bytes);
      await assert.rejects(resolvePortfolioActionRiskDecisionPrice({ baseDir: directory, riskDecisionId: decision.riskDecisionId }), error);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
  });
});

test("price-bound Risk fails closed on price fsync and retains the source lock through Risk commit", async (context) => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price }) => {
    const prices = new SourcePriceEvidenceFileRepository(directory, { lockTimeoutMs: 30, lockRetryDelayMs: 5 });
    const extra = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "fixture-price-next", priceKrw: 101 });
    const path = createSourcePriceEvidencePaths(directory).recordsPath;
    const source = await stat(path, { bigint: true });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    const originalWrite = prototype.writeFile;
    await probe.close();
    let failSync = true;
    let commitProbed = false;
    const syncMock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      if (failSync && own.isFile() && own.ino === source.ino && (process.platform === "win32" || own.dev === source.dev)) throw new Error("injected price fsync failure");
      return originalSync.call(this);
    });
    const writeMock = context.mock.method(prototype, "writeFile", async function (this: FileHandle, ...args: Parameters<FileHandle["writeFile"]>) {
      if (typeof args[0] === "string" && args[0].includes('"schemaVersion":"portfolio_action_risk_decision_commit.v1"')) {
        await assert.rejects(prices.append(extra), /lock is unavailable/);
        commitProbed = true;
      }
      return originalWrite.apply(this, args);
    });
    try {
      await assert.rejects(repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef), /price fsync failure/);
      assert.equal((await repository.readAll()).length, 0);
      failSync = false;
      await repository.createAndAppendWithPriceOrigin(candidate, price.evidenceRef);
      assert.equal(commitProbed, true);
    } finally { writeMock.mock.restore(); syncMock.mock.restore(); }
    await prices.append(extra);
  });
});

test("v7 Risk selected price is preserved through BUY/SELL/legacy fill creation, retry and event binding", async () => {
  for (const [side, legacy] of [["BUY", false], ["SELL", false], ["SELL", true]] as const) {
    await withPriceFixture(side, legacy, async ({ directory, repository, candidate, price, prices, plan }) => {
      const requested = side === "BUY" ? 100 : 30;
      const creation = { ...candidate, requestedNotionalKrw: requested, worstCaseFillNotionalKrw: requested,
        approvedMaximumFillNotionalKrw: requested,
        cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: requested, approvedMaximumNetCashDebitKrw: requested }
          : { side, expectedMinimumNetCashCreditKrw: requested },
        turnoverAssessment: candidate.turnoverAssessment.scopeKind === "legacy_reduce_only" ? candidate.turnoverAssessment
          : { ...candidate.turnoverAssessment, requestedBucketTurnoverNotionalKrw: requested,
            resultingBucketTurnoverRatio: (candidate.turnoverAssessment.priorBucketTurnoverNotionalKrw + requested) / candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw }
      };
      const decision = await repository.createAndAppendWithPriceOrigin(creation, price.evidenceRef);
      const riskDecisionHistory = await repository.readVerifiedHistory();
      const fills = new PaperFillExecutionFileRepository(directory);
      const input = priceBoundFillInput(creation, price);
      await new Promise((resolve) => setTimeout(resolve, 2));
      const fill = await fills.createAndAppendWithRiskOrigin(input, riskDecisionHistory, decision.riskDecisionId);
      const path = createPaperFillExecutionPaths(directory).recordsPath;
      const bytes = await readFile(path, "utf8");
      assert.deepEqual(await new PaperFillExecutionFileRepository(directory).createAndAppendWithRiskOrigin(input, riskDecisionHistory, decision.riskDecisionId), fill);
      assert.equal(await readFile(path, "utf8"), bytes);
      const paperFillHistory = await fills.readVerifiedHistory();
      const event = priceBoundFillEvent(plan, decision, fill, resolvePersistedPaperFillExecutionOrigin(paperFillHistory, fill.paperFillRecordId).appendedAt);
      const bound = validateRebalancePlanExecutionFillRiskBinding({ event, riskDecisionHistory, paperFillHistory,
        sourcePriceEvidenceHistory: await prices.readVerifiedHistory() });
      assert.deepEqual(bound.sourcePriceEvidence, price);
      assert.equal(await readFile(path, "utf8"), bytes);
    });
  }
});

test("v7 Risk fill creation rejects another listed price or altered selected hash without writes", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices }) => {
    const other = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "other-listed-price" });
    await prices.append(other);
    const decision = await repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, other.evidenceRef] }, price.evidenceRef);
    const history = await repository.readVerifiedHistory();
    const fills = new PaperFillExecutionFileRepository(directory);
    const input = priceBoundFillInput(candidate, price);
    for (const bad of [priceBoundFillInput(candidate, other), { ...input, sourcePriceEvidence: { ...input.sourcePriceEvidence, evidenceHash: HASH } }]) {
      await assert.rejects(fills.createAndAppendWithRiskOrigin(bad, history, decision.riskDecisionId), /selected price origin/);
      assert.equal((await fills.readAll()).length, 0);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
    await fills.createAndAppendWithRiskOrigin(input, history, decision.riskDecisionId);
    const path = createPaperFillExecutionPaths(directory).recordsPath;
    const bytes = await readFile(path, "utf8");
    await assert.rejects(fills.createAndAppendWithRiskOrigin(priceBoundFillInput(candidate, other), history, decision.riskDecisionId), /selected price origin/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});

test("v7 event binding rejects a fully rehashed fill that substitutes another listed stored quote", async () => {
  await withPriceFixture("BUY", false, async ({ directory, repository, candidate, price, prices, plan }) => {
    const other = createSourcePriceEvidenceRecord({ ...pricePayload(candidate), sourceContractId: "other-listed-price" });
    await prices.append(other);
    const decision = await repository.createAndAppendWithPriceOrigin({ ...candidate, riskEvidenceRefs: [...candidate.riskEvidenceRefs, other.evidenceRef] }, price.evidenceRef);
    const riskDecisionHistory = await repository.readVerifiedHistory();
    const fills = new PaperFillExecutionFileRepository(directory);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const original = await fills.createAndAppendWithRiskOrigin(priceBoundFillInput(candidate, price), riskDecisionHistory, decision.riskDecisionId);
    const path = createPaperFillExecutionPaths(directory).recordsPath;
    const [entry, marker] = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    const record = createPaperFillExecutionRecord({ ...priceBoundFillInput(candidate, other), asOf: original.asOf, createdAt: original.createdAt });
    const { entryHash: _hash, ...payload } = { ...entry, record };
    const entryHash = hashCanonicalPayload(payload);
    const markerPayload = { schemaVersion: marker.schemaVersion, entryHash, committedAt: marker.committedAt };
    const bytes = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash: hashCanonicalPayload(markerPayload) })}\n`;
    await writeFile(path, bytes);
    const paperFillHistory = await new PaperFillExecutionFileRepository(directory).readVerifiedHistory();
    const event = priceBoundFillEvent(plan, decision, record, marker.committedAt);
    const sourcePriceEvidenceHistory = await prices.readVerifiedHistory();
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({ event, riskDecisionHistory, paperFillHistory,
      sourcePriceEvidenceHistory }), /selected price origin/);
    assert.equal(await readFile(path, "utf8"), bytes);
  });
});

function priceBoundFillInput(candidate: Omit<DecisionInput, "decidedAt">, price: ReturnType<typeof createSourcePriceEvidenceRecord>) {
  const executionPolicy: Parameters<typeof createPaperFillExecutionRecord>[0]["executionPolicy"] = {
    modelVersion: PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price",
    slippageBps: 0, feeBps: 0, taxBps: 0, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: true,
    maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 };
  const fill = buildPaperFill({ action: candidate.side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL",
    sourcePriceKrw: price.priceKrw, targetNotionalKrw: candidate.requestedNotionalKrw, policy: executionPolicy });
  return { portfolioId: candidate.portfolioId, rebalancePlanId: candidate.planId, rebalanceActionId: candidate.actionId, fillId: "selected-price-fill",
    market: candidate.market, symbol: candidate.symbol, side: candidate.side, requestedNotionalKrw: candidate.requestedNotionalKrw,
    requestedQuantity: candidate.requestedQuantity, quantityOverride: null, sourcePriceKrw: price.priceKrw,
    sourcePriceEvidence: { sourceContractId: price.sourceContractId, evidenceRef: price.evidenceRef, evidenceHash: price.evidenceHash,
      market: price.market, symbol: price.symbol, priceField: price.priceField, observedAt: price.observedAt }, averagePriceKrw: null,
    fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity, filledNotionalKrw: fill.filledNotionalKrw, grossAmountKrw: fill.grossAmountKrw,
    netAmountKrw: fill.netAmountKrw, participationRate: null, volume: null, averageVolume: null, liquidityStale: false,
    fillStatus: "filled" as const, liquidityStatus: "not_modeled" as const, liquidityRejectReason: null, fractionalShares: true, executionPolicy,
    costBreakdown: { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw, spreadCostKrw: fill.spreadCostKrw,
      impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw }, evidenceRefs: [price.evidenceRef] };
}

function priceBoundFillEvent(plan: RebalancePlanRecord, decision: ReturnType<typeof createPortfolioActionRiskDecision>,
  fill: ReturnType<typeof createPaperFillExecutionRecord>, committedAt: string) {
  return createRebalancePlanExecutionAppliedEvent({ ...planScope(plan), previousPlanEventId: "approved-event", eventType: "execution_applied",
    asOf: new Date(Date.parse(committedAt) + 1).toISOString(), actionId: decision.actionId, actionSequence: 0, fillSequence: 0,
    fillId: fill.fillId, paperFillRecordId: fill.paperFillRecordId, paperFillHash: fill.paperFillHash, requestedNotionalKrw: fill.requestedNotionalKrw,
    requestedQuantity: fill.requestedQuantity, filledNotionalKrw: fill.filledNotionalKrw, filledQuantity: fill.quantity,
    cumulativeFilledNotionalKrw: fill.filledNotionalKrw, cumulativeFilledQuantity: fill.quantity, riskDecisionId: decision.riskDecisionId,
    expectedPrePortfolioVersion: decision.expectedPortfolioVersion, expectedPrePortfolioSnapshotHash: decision.expectedPortfolioSnapshotHash,
    resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: HASH });
}

function pricePayload(candidate: Omit<DecisionInput, "decidedAt">) {
  return { sourceContractId: "fixture-price", market: candidate.market, symbol: candidate.symbol, priceField: "last_price" as const,
    priceKrw: 100, observedAt: CREATED_AT, createdAt: CREATED_AT, sourceRefs: ["fixture-price-source"] };
}

async function withPriceFixture(side: "BUY" | "SELL", legacy: boolean,
  run: (input: Parameters<Parameters<typeof withSnapshotFixture>[2]>[0] & {
    price: ReturnType<typeof createSourcePriceEvidenceRecord>; prices: SourcePriceEvidenceFileRepository
  }) => Promise<void>) {
  await withSnapshotFixture(side, legacy, async (input) => {
    const price = createSourcePriceEvidenceRecord(pricePayload(input.candidate));
    const prices = new SourcePriceEvidenceFileRepository(input.directory);
    await prices.append(price);
    await run({ ...input, candidate: { ...input.candidate, riskEvidenceRefs: [...input.candidate.riskEvidenceRefs, price.evidenceRef] }, price, prices });
  });
}

async function withSnapshotFixture(side: "BUY" | "SELL", legacy: boolean,
  run: (input: Parameters<Parameters<typeof withPlanFixture>[2]>[0] & { snapshot: ReturnType<typeof snapshotFixture> }) => Promise<void>,
  overrides: Parameters<typeof snapshotFixture>[2] = {}) {
  let snapshot: ReturnType<typeof snapshotFixture>;
  await withPlanFixture(side, legacy, async (input) => run({ ...input, snapshot }), false,
    legacy ? undefined : async (directory, candidate) => {
      const mandate = createInvestmentMandateRecord(mandatePayload(candidate));
      const store = new InvestmentMandateFileRepository(directory);
      await store.appendRecord(mandate);
      const { eventType: _type, previousMandateEventId: _previous, mandateEventId: _id, mandateEventHash: _hash, ...scope } = mandateTransition(mandate, "retired", "placeholder");
      await store.appendEvent(createInvestmentMandateEvent({ ...scope, eventType: "activated" }));
      return mandate.mandateId;
    }, async (directory, candidate) => {
      snapshot = snapshotFixture(candidate, legacy, overrides);
      await new PortfolioSizingSnapshotFileRepository(directory).append(snapshot);
      return snapshot.portfolioSnapshotHash;
    });
}

function mandatePayload(candidate: Omit<DecisionInput, "decidedAt">) {
  return { portfolioId: candidate.portfolioId, policyHash: candidate.policyHash, market: candidate.market, symbol: candidate.symbol,
    bucket: "swing" as const, asOf: CREATED_AT, createdAt: CREATED_AT, targetWeightRatio: 0.1, minWeightRatio: 0.05, maxWeightRatio: 0.2,
    maximumOpeningNotionalKrw: 100, reasonCodes: ["fixture"], evidenceRefs: ["fixture"], evidenceAsOf: CREATED_AT,
    reviewCadence: { mode: "scheduled" as const, boundaryRefs: [scheduleBoundaryRefFor(policyFixture().records.scheduleBoundaries[0]!)] },
    validFrom: CREATED_AT, reviewAfter: "2099-01-01T00:00:00.000Z",
    assignmentSource: "manual_policy" as const, manualAuthorizationScope: "open_or_increase" as const, manualAssignmentEventId: "manual-1",
    capacityReservation: { manualCapacityReservationId: "reservation-1", manualCapacityReservationHash: HASH, reservedMaximumNotionalKrw: 100, reservationKind: "new_position" as const, reservedSlotOrdinal: 0 }
  };
}

function mandateTransition(mandate: InvestmentMandateRecord, eventType: "review_required" | "retired", previousMandateEventId: string) {
  return createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
    portfolioId: mandate.portfolioId, policyHash: mandate.policyHash, market: mandate.market, symbol: mandate.symbol, bucket: mandate.bucket,
    eventType, previousMandateEventId, asOf: CREATED_AT, createdAt: CREATED_AT, reasonCodes: ["fixture"] });
}

async function withMandateFixture(side: "BUY" | "SELL", run: (input: Parameters<Parameters<typeof withPlanFixture>[2]>[0] & {
  mandate: InvestmentMandateRecord; mandates: InvestmentMandateFileRepository
}) => Promise<void>, options: { reduceOnly?: boolean; state?: "proposed" | "retired" | "review_required";
  overrides?: Partial<Pick<InvestmentMandateRecord, "bucket" | "portfolioId" | "market" | "symbol" | "policyHash" | "validFrom" | "reviewAfter" | "expiresAt">> } = {}) {
  let mandate: InvestmentMandateRecord;
  let mandates: InvestmentMandateFileRepository;
  await withPlanFixture(side, false, async (input) => run({ ...input, mandate, mandates }), false, async (directory, candidate) => {
    const { capacityReservation, ...payload } = mandatePayload(candidate);
    mandate = createInvestmentMandateRecord({ ...payload, ...options.overrides, ...(options.reduceOnly
      ? { manualAuthorizationScope: "classify_existing_reduce_only" as const, maximumOpeningNotionalKrw: 0 }
      : { capacityReservation }) });
    mandates = new InvestmentMandateFileRepository(directory);
    await mandates.appendRecord(mandate);
    if (options.state !== "proposed") {
      const { eventType: _type, previousMandateEventId: _previous, ...activationPayload } = mandateTransition(mandate, "retired", "placeholder");
      const { mandateEventId: _id, mandateEventHash: _hash, ...scope } = activationPayload;
      const activation = createInvestmentMandateEvent({ ...scope, eventType: "activated", asOf: mandate.validFrom, createdAt: mandate.validFrom });
      await mandates.appendEvent(activation);
      if (options.state !== undefined) await mandates.appendEvent(mandateTransition(mandate, options.state, activation.mandateEventId));
    }
    return mandate.mandateId;
  });
}

function planScope(plan: RebalancePlanRecord) {
  return { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash };
}
function planEvent(plan: RebalancePlanRecord, kind: "previewed" | "approved" | "rejected", previous?: RebalancePlanEvent) {
  const common = { ...planScope(plan), asOf: new Date().toISOString() };
  return kind === "previewed" ? createRebalancePlanEvent({ ...common, eventType: kind })
    : createRebalancePlanEvent({ ...common, eventType: kind, previousPlanEventId: previous!.planEventId, reasonCodes: ["fixture"] });
}
async function withPlanFixture(side: "BUY" | "SELL", legacy: boolean, run: (input: {
  directory: string; repository: PortfolioActionRiskDecisionFileRepository; plan: RebalancePlanRecord;
  events: RebalancePlanEventFileRepository; candidate: Omit<DecisionInput, "decidedAt">;
}) => Promise<void>, wholeShares = false, setupMandate?: (directory: string, candidate: Omit<DecisionInput, "decidedAt">) => Promise<string>,
setupSnapshot?: (directory: string, candidate: Omit<DecisionInput, "decidedAt">) => Promise<string>) {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-plan-"));
  try {
    await storePolicyFixture(directory, fixture);
    const { decidedAt: _time, ...original } = decisionInput(fixture, side, legacy);
    if (setupSnapshot !== undefined) original.expectedPortfolioSnapshotHash = await setupSnapshot(directory, original);
    const mandateId = await setupMandate?.(directory, original) ?? "mandate-1";
    const target = wholeShares ? { targetKind: "whole_share_quantity" as const, targetQuantity: 1, referencePriceKrw: 100, plannedNotionalKrw: 100, residualNotionalKrw: 0, priceEvidenceRef: "price-1" }
      : side === "BUY" ? { targetKind: "fractional_buy_notional" as const, targetNotionalKrw: 100 }
      : { targetKind: "fractional_sell_quantity" as const, targetQuantity: 0.3, referencePriceKrw: 100, markedTargetNotionalKrw: 30, priceEvidenceRef: "price-1" };
    const plan = createRebalancePlanRecord({ cycleId: "cycle-1", portfolioId: original.portfolioId, portfolioVersion: "v1", portfolioSnapshotHash: original.expectedPortfolioSnapshotHash,
      policyHash: fixture.policy.policyHash, evidenceCutoffAt: CREATED_AT, createdAt: CREATED_AT, triggerRef: "trigger-1", phase: side === "BUY" ? "buy" : "sell",
      actions: [{ actionId: "action-1", actionSequence: 0, market: "KR", symbol: original.symbol, maximumNotionalKrw: 100, reasonCodes: ["fixture"], executionTarget: target,
        ...(legacy ? { lineageKind: "unassigned_legacy_reduce_only" as const, side: "SELL" as const, observedPositionRef: "legacy-1", legacyStateDetectedAt: CREATED_AT }
          : { lineageKind: "mandate" as const, side, mandateId }) }] });
    const plans = new RebalancePlanFileRepository(directory);
    await plans.append(plan);
    const events = new RebalancePlanEventFileRepository(directory, plans);
    const preview = await events.append(planEvent(plan, "previewed"));
    await events.append(planEvent(plan, "approved", preview));
    const candidate = { ...original, planId: plan.planId, actionExecutionTargetHash: hashRebalanceExecutionTarget(target),
      requestedQuantity: side === "BUY" ? 1 : 0.3, approvedMaximumFillNotionalKrw: 100 };
    await run({ directory, repository: new PortfolioActionRiskDecisionFileRepository(directory), plan, events, candidate });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function withDecision(
  fixture: ReturnType<typeof policyFixture>, candidate: DecisionInput,
  run: (input: Parameters<typeof resolvePortfolioActionRiskDecisionPolicy>[0]) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-"));
  try {
    await storePolicyFixture(directory, fixture);
    const repository = new PortfolioActionRiskDecisionFileRepository(directory);
    const { decidedAt: _decidedAt, ...creationInput } = candidate;
    const decision = await repository.createAndAppendWithPolicyOrigin(creationInput);
    await run({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function storePolicyFixture(directory: string, fixture: ReturnType<typeof policyFixture>) {
  const paths = createImmutablePolicyDependencyPaths(directory);
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    await writeFile(paths[key], `${fixture.records[key].map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  await new RuntimePortfolioPolicyFileRepository(directory, fixture.dependencies).append(fixture.policy);
  await new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies)
    .appendActivated({ policy: fixture.policy, createdAt: CREATED_AT });
}

function decisionInput(fixture: ReturnType<typeof policyFixture>, side: "BUY" | "SELL", legacy = false): DecisionInput {
  const set = legacy ? fixture.legacySet : fixture.bucketSet;
  const requiredRuleIds = set.rules.filter((rule) => rule.appliesTo.includes(side)).map((rule) => rule.ruleId);
  return {
    riskRuleSetRecordId: set.riskRuleSetRecordId, riskRuleSetVersion: set.version, riskRuleSetHash: set.hash,
    planId: "plan-1", actionId: "action-1", portfolioId: fixture.policy.portfolioId, policyHash: fixture.policy.policyHash,
    expectedPortfolioVersion: "v1", expectedPortfolioSnapshotHash: HASH,
    market: "KR", symbol: "KR:005930", side,
    riskRuleScope: legacy ? { scopeKind: "legacy_reduce_only", legacyPolicyHash: hashCanonicalPayload(fixture.policy.legacyReduceOnlyPolicy) } : { scopeKind: "bucket", bucket: "swing" },
    actionExecutionTargetHash: HASH,
    turnoverAssessment: legacy ? { scopeKind: "legacy_reduce_only", countedInBucketTurnover: false } : {
      scopeKind: "bucket", turnoverStateId: "turnover-1", turnoverStateHash: HASH,
      turnoverWindowOpenPortfolioNetWorthKrw: 1_000, priorBucketTurnoverNotionalKrw: 0,
      requestedBucketTurnoverNotionalKrw: 100, resultingBucketTurnoverRatio: 0.1
    },
    priorCumulativeFilledNotionalKrw: 0, priorCumulativeFilledQuantity: 0,
    requestedNotionalKrw: 100, requestedQuantity: 1, worstCaseFillNotionalKrw: 100, approvedMaximumFillNotionalKrw: 110,
    cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: 100, approvedMaximumNetCashDebitKrw: 110 } : { side, expectedMinimumNetCashCreditKrw: 90 },
    decision: "approved", requiredRuleIds,
    ruleResults: requiredRuleIds.map((ruleId) => ({ ruleId, result: "pass", reasonCode: "fixture" })),
    riskEvidenceRefs: ["fixture-evidence"], decidedAt: DECIDED_AT
  };
}

test("stored policy execution preview selects bucket and root legacy cost parameters before Risk persistence", async () => {
  await withPolicyExecutionFixture(async ({ input, fixture }) => {
    for (const side of ["BUY", "SELL"] as const) {
      const result = await createPortfolioPolicyExecutionPreview({ ...input, side });
      assert.equal(result.preview.input.executionPolicy.feeBps, 10);
      assert.equal(result.preview.execution.costBreakdown.feeKrw, 100);
      assert.equal(result.preview.execution.netAmountKrw, side === "BUY" ? 100_100 : 99_700);
      assert.equal(result.policyContext.riskRuleSetRef.hash, fixture.bucketSet.hash);
      assert.equal(result.policyContext.policyHash, input.expectedPolicyHash);
      assert.equal(result.policyContext.priceOrigin.evidenceRef, input.priceEvidenceRef);
      assert.deepEqual(parsePortfolioActionExecutionPreview(JSON.parse(JSON.stringify(result.preview))), result.preview);
      assert.equal(result.observationHash, hashCanonicalPayload({ preview: result.preview, policyContext: result.policyContext }));
      assert.ok(Object.isFrozen(result.policyContext.executionParameterRef));
      const restarted = await createPortfolioPolicyExecutionPreview({ ...input, side });
      assert.deepEqual(restarted.preview.execution, result.preview.execution);
      assert.deepEqual(restarted.policyContext.executionParameterRef, result.policyContext.executionParameterRef);
    }
    const legacy = await createPortfolioPolicyExecutionPreview({ ...input, side: "SELL", scope: { scopeKind: "legacy_reduce_only" } });
    assert.equal(legacy.preview.input.executionPolicy.feeBps, 20);
    assert.equal(legacy.preview.execution.netAmountKrw, 99_600);
    assert.equal(legacy.policyContext.riskRuleSetRef.hash, fixture.legacySet.hash);
    await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
    await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
  });
});

test("stored policy execution preview rejects caller policy, price, timestamp and scope substitution", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    for (const extra of [{ executionPolicy: {} }, { sourcePriceEvidence: {} }, { asOf: CREATED_AT }, { policies: [] }, { activationEvents: [] }]) {
      await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, ...extra }), /unrecognized_keys/);
    }
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, expectedPolicyHash: HASH }), /policy drift/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, portfolioId: "other" }), /active runtime portfolio policy/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, market: "US" }), /market is not enabled/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, symbol: "KR:000660" }), /price scope/);
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, priceEvidenceRef: "missing" }));
    await assert.rejects(createPortfolioPolicyExecutionPreview({ ...input, scope: { scopeKind: "legacy_reduce_only" } }), /SELL only/);
    const mutated = structuredClone(input);
    const pending = createPortfolioPolicyExecutionPreview(mutated);
    mutated.symbol = "KR:000660";
    mutated.volume = 0;
    const result = await pending;
    assert.equal(result.policyContext.symbol, input.symbol);
    assert.equal(result.preview.input.volume, 100);
  });
});

test("stored policy execution preview fails closed for missing, unsupported or wrong-side execution rules", async () => {
  const options = { bucket: executionFixtureParameters(10), legacy: executionFixtureParameters(20) };
  for (const fixture of [policyFixture(), policyFixture("v1", { ...options, ruleVersion: "v2" }),
    policyFixture("v1", { ...options, appliesTo: ["SELL"] })]) {
    await withPolicyExecutionFixture(async ({ input }) => {
      await assert.rejects(createPortfolioPolicyExecutionPreview(input), /paper_execution v1/);
    }, fixture);
  }
});

test("execution parameter schema rejects incomplete market policy and noncanonical source allowlists", () => {
  const valid = executionFixtureParameters(10);
  const market = valid.markets.KR!;
  for (const value of [
    { ...valid, unknown: true }, { ...valid, schemaVersion: "other" }, { ...valid, markets: {} },
    { ...valid, markets: { KR: { ...market, maximumPriceAgeSeconds: 0 } } },
    { ...valid, markets: { KR: { ...market, allowedPriceSourceContractIds: ["z", "a"] } } },
    { ...valid, markets: { KR: { ...market, allowedPriceSourceContractIds: ["a", "a"] } } },
    { ...valid, markets: { KR: { ...market, executionPolicy: { feeBps: 0 } } } }
  ]) assert.throws(() => portfolioExecutionRuleParametersSchema.parse(value));
});

test("stored policy execution preview enforces selected source contract, freshness and market settings", async () => {
  const standard = executionFixtureParameters(10);
  const market = standard.markets.KR!;
  for (const [parameters, pattern] of [
    [{ ...standard, markets: { KR: { ...market, allowedPriceSourceContractIds: ["different-source"] } } }, /price scope/],
    [{ ...standard, markets: { KR: { ...market, maximumPriceAgeSeconds: 1 } } }, /source price is stale/],
    [{ ...standard, markets: { US: market } }, /market parameters are missing/],
    [{ fixtureLimit: 1 }, /invalid|expected/i]
  ] as const) {
    await withPolicyExecutionFixture(async ({ input }) => {
      await assert.rejects(createPortfolioPolicyExecutionPreview(input), pattern);
    }, policyFixture("v1", { bucket: parameters, legacy: executionFixtureParameters(20) }));
  }
});

test("stored policy execution preview uses an inclusive age boundary and rejects a backwards observation clock", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  const parameters = executionFixtureParameters(10);
  parameters.markets.KR!.maximumPriceAgeSeconds = 60;
  try {
    await withPolicyExecutionFixture(async ({ input }) => {
      assert.equal((await createPortfolioPolicyExecutionPreview(input)).preview.input.asOf, new Date(now).toISOString());
      context.mock.timers.setTime(now + 1);
      await assert.rejects(createPortfolioPolicyExecutionPreview(input), /source price is stale/);
      context.mock.timers.setTime(now - 1);
      await assert.rejects(createPortfolioPolicyExecutionPreview(input));
      context.mock.timers.setTime(now);
      await createPortfolioPolicyExecutionPreview(input);
    }, policyFixture("v1", { bucket: parameters, legacy: executionFixtureParameters(20) }));
  } finally { context.mock.timers.reset(); }
});

test("stored policy execution preview selects US settings without borrowing KR costs for legacy SELL", async () => {
  const legacy = executionFixtureParameters(20);
  legacy.markets.US = executionFixtureParameters(30).markets.KR!;
  await withPolicyExecutionFixture(async ({ input }) => {
    const price = createSourcePriceEvidenceRecord({ sourceContractId: "fixture-execution", market: "US", symbol: "US:AAPL",
      priceField: "last_price", priceKrw: 10_000, observedAt: new Date(Date.now() - 1000).toISOString(),
      sourceRefs: ["synthetic-us-fixture"], createdAt: new Date().toISOString() });
    await new SourcePriceEvidenceFileRepository(input.baseDir).append(price);
    const result = await createPortfolioPolicyExecutionPreview({ ...input, side: "SELL", scope: { scopeKind: "legacy_reduce_only" },
      market: "US", symbol: price.symbol, priceEvidenceRef: price.evidenceRef });
    assert.equal(result.preview.input.executionPolicy.feeBps, 30);
    assert.equal(result.preview.execution.netAmountKrw, 99_500);
    assert.equal(result.policyContext.market, "US");
  }, policyFixture("v1", { bucket: executionFixtureParameters(10), legacy }));
});

test("stored policy execution preview reloads retirement and rejects corrupt dependency or price history", async () => {
  await withPolicyExecutionFixture(async ({ input, fixture }) => {
    await createPortfolioPolicyExecutionPreview(input);
    await new RuntimePortfolioPolicyActivationFileRepository(input.baseDir, [fixture.policy], fixture.dependencies)
      .appendRetired({ portfolioId: fixture.policy.portfolioId, retiredActivationId: fixture.activation.activationId,
        reasonCode: "fixture", createdAt: CREATED_AT });
    await assert.rejects(createPortfolioPolicyExecutionPreview(input), /active runtime portfolio policy/);
  });
  for (const kind of ["parameter", "price"] as const) {
    await withPolicyExecutionFixture(async ({ input }) => {
      await createPortfolioPolicyExecutionPreview(input);
      const path = kind === "parameter" ? createImmutablePolicyDependencyPaths(input.baseDir).riskParameters
        : createSourcePriceEvidencePaths(input.baseDir).recordsPath;
      await writeFile(path, "{broken\n", "utf8");
      await assert.rejects(createPortfolioPolicyExecutionPreview(input));
    });
  }
});

test("packet execution preview derives partial BUY/SELL and legacy costs from the exact stored volume", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    const path = createStoragePaths(input.baseDir).marketPacketsPath;
    await new FileMarketPacketStore(path).append(packet);
    const request = packetExecutionInput(input, packet);
    for (const side of ["BUY", "SELL"] as const) {
      const result = await createPortfolioPacketExecutionPreview({ ...request, side });
      assert.equal(result.policyPreview.preview.input.volume, 50);
      assert.equal(result.policyPreview.preview.input.averageVolume, 100);
      assert.equal(result.policyPreview.preview.execution.quantity, 5);
      assert.equal(result.policyPreview.preview.execution.fillStatus, "partial");
      assert.equal(result.policyPreview.preview.execution.netAmountKrw, side === "BUY" ? 50_050 : 49_850);
      assert.equal(result.liquidityContext.packetHash, createMarketPacketHash(packet));
      assert.deepEqual(result.liquidityContext.sourceRefs, ["synthetic-liquidity"]);
      assert.equal(result.observationHash, hashCanonicalPayload({ policyPreview: result.policyPreview, liquidityContext: result.liquidityContext }));
      assert.ok(Object.isFrozen(result.liquidityContext.sourceRefs));
      const restarted = await createPortfolioPacketExecutionPreview({ ...request, side });
      assert.deepEqual(restarted.policyPreview.preview.execution, result.policyPreview.preview.execution);
    }
    const legacy = await createPortfolioPacketExecutionPreview({ ...request, side: "SELL", scope: { scopeKind: "legacy_reduce_only" } });
    assert.equal(legacy.policyPreview.preview.execution.netAmountKrw, 49_800);
    await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
    await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
  });
});

test("packet execution preview rejects liquidity override, missing hashes and scope substitution", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    await new FileMarketPacketStore(createStoragePaths(input.baseDir).marketPacketsPath).append(packet);
    const request = packetExecutionInput(input, packet);
    for (const extra of [{ volume: 1000 }, { averageVolume: 1000 }, { liquidityStale: false }, { marketPacketHistory: [] }, { asOf: CREATED_AT }]) {
      await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, ...extra }), /unrecognized_keys/);
    }
    await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, liquidityPacketHash: HASH }), /resolve exactly once/);
    await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, portfolioId: "other" }), /portfolio mismatch/);
    await assert.rejects(createPortfolioPacketExecutionPreview({ ...request, symbol: "KR:000660" }), /candidate must resolve exactly once/);
    const pending = createPortfolioPacketExecutionPreview(request);
    request.symbol = "mutated";
    assert.equal((await pending).liquidityContext.symbol, input.symbol);
  });
});

test("packet execution preview rejects corrupt, duplicate, reused-ID and ambiguous candidate history", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    const request = packetExecutionInput(input, packet);
    const path = createStoragePaths(input.baseDir).marketPacketsPath;
    await assert.rejects(createPortfolioPacketExecutionPreview(request), /resolve exactly once/);
    for (const raw of [
      JSON.stringify(packet), `${JSON.stringify(packet)}\n{broken\n`, `${JSON.stringify(packet)}\n\n`,
      `${JSON.stringify(packet)}\n${JSON.stringify(packet)}\n`,
      `${JSON.stringify(packet)}\n${JSON.stringify({ ...packet, expiresAt: new Date(Date.now() + 60_000).toISOString() })}\n`
    ]) {
      await writeFile(path, raw, "utf8");
      await assert.rejects(createPortfolioPacketExecutionPreview(request), /corrupt|resolve exactly once|ID was reused/);
    }
    const ambiguous = { ...packet, candidates: [packet.candidates[0]!, packet.candidates[0]!] };
    await writeFile(path, `${JSON.stringify(ambiguous)}\n`, "utf8");
    await assert.rejects(createPortfolioPacketExecutionPreview(packetExecutionInput(input, ambiguous)), /candidate must resolve exactly once/);
  });
});

test("packet execution preview distinguishes missing, zero and average-only liquidity", async () => {
  await withPolicyExecutionFixture(async ({ input }) => {
    const packet = executionLiquidityPacket(input);
    const path = createStoragePaths(input.baseDir).marketPacketsPath;
    const { volume: _volume, averageVolume: _average, ...candidate } = packet.candidates[0]!;
    for (const [candidateInput, expected] of [[candidate, "missing"], [{ ...candidate, volume: 0 }, "rejected"],
      [{ ...candidate, averageVolume: 50 }, "partial"], [{ ...candidate, volume: Number.MAX_SAFE_INTEGER + 1 }, "unsafe"]] as const) {
      const source = { ...packet, candidates: [candidateInput] };
      await writeFile(path, `${JSON.stringify(source)}\n`, "utf8");
      const pending = createPortfolioPacketExecutionPreview(packetExecutionInput(input, source));
      if (expected === "missing") await assert.rejects(pending, /no volume evidence/);
      else if (expected === "unsafe") await assert.rejects(pending, /supported range/);
      else assert.equal((await pending).policyPreview.preview.execution.fillStatus, expected);
    }
  });
});

test("packet execution preview rejects expired or future packet and candidate timestamps at the exact boundary", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withPolicyExecutionFixture(async ({ input }) => {
      const packet = executionLiquidityPacket(input);
      const candidate = packet.candidates[0]!;
      const at = new Date(now).toISOString();
      const future = new Date(now + 1).toISOString();
      for (const source of [
        { ...packet, expiresAt: at }, { ...packet, generatedAt: future },
        { ...packet, candidates: [{ ...candidate, staleAfter: at }] },
        { ...packet, candidates: [{ ...candidate, collectedAt: future }] },
        { ...packet, candidates: [{ ...candidate, collectedAt: "2026-09-07T00:00:00" }] }
      ]) {
        await writeFile(createStoragePaths(input.baseDir).marketPacketsPath, `${JSON.stringify(source)}\n`, "utf8");
        await assert.rejects(createPortfolioPacketExecutionPreview(packetExecutionInput(input, source)));
      }
    });
  } finally { context.mock.timers.reset(); }
});

test("packet execution preview rechecks liquidity expiry after policy and price I/O", async (context) => {
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    await withPolicyExecutionFixture(async ({ input }) => {
      const packet = executionLiquidityPacket(input);
      packet.expiresAt = new Date(now + 1000).toISOString();
      await new FileMarketPacketStore(createStoragePaths(input.baseDir).marketPacketsPath).append(packet);
      const original = RuntimePortfolioPolicyActivationFileRepository.prototype.withDurableActivePolicy;
      const mock = context.mock.method(RuntimePortfolioPolicyActivationFileRepository.prototype, "withDurableActivePolicy",
        function (this: RuntimePortfolioPolicyActivationFileRepository, ...args: Parameters<typeof original>) {
          context.mock.timers.setTime(now + 1000);
          return original.apply(this, args);
        });
      try {
        await assert.rejects(createPortfolioPacketExecutionPreview(packetExecutionInput(input, packet)), /stale or temporally inconsistent/);
      } finally { mock.mock.restore(); }
    });
  } finally { context.mock.timers.reset(); }
});

test("plan execution preview derives BUY, SELL and legacy scope from stored action and mandate", async () => {
  for (const side of ["BUY", "SELL"] as const) for (const legacy of side === "SELL" ? [false, true] : [false]) {
    await withPlanExecutionFixture(async ({ request, input, plan, approval }) => {
      const before = await readFile(createRebalancePlanEventPaths(input.baseDir).eventsPath, "utf8");
      const result = await createPortfolioPlanExecutionPreview(request);
      const preview = result.packetPreview.policyPreview.preview;
      assert.equal(preview.input.side, side);
      assert.equal(preview.input.requestedNotionalKrw, side === "BUY" ? 100_000 : 3000);
      assert.equal(preview.input.quantityOverride, side === "BUY" ? null : 0.3);
      assert.equal(result.planContext.actionId, plan.actions[0]!.actionId);
      assert.equal(result.planContext.origin.predecessorEventHash, approval.planEventHash);
      assert.equal(result.planContext.mandate === null, legacy);
      assert.equal(result.packetPreview.policyPreview.policyContext.scope.scopeKind, legacy ? "legacy_reduce_only" : "bucket");
      assert.equal(result.observationHash, hashCanonicalPayload({ packetPreview: result.packetPreview, planContext: result.planContext }));
      assert.ok(Object.isFrozen(result.planContext));
      assert.deepEqual((await createPortfolioPlanExecutionPreview(request)).packetPreview.policyPreview.preview.execution, preview.execution);
      assert.equal(await readFile(createRebalancePlanEventPaths(input.baseDir).eventsPath, "utf8"), before);
      await assert.rejects(readFile(createPortfolioActionRiskDecisionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
      await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
    }, { side, legacy });
  }
});

test("plan execution preview computes exact remaining fractional SELL quantity after stored partial fill", async () => {
  await withPlanExecutionFixture(async ({ request, input, plan, events, approval }) => {
    const partial = await events.append(createRebalancePlanEvent({ ...planScope(plan), asOf: new Date().toISOString(),
      eventType: "execution_applied", previousPlanEventId: approval.planEventId, actionId: "action-1", actionSequence: 0,
      fillSequence: 0, fillId: "synthetic-fill", paperFillRecordId: "synthetic-paper", paperFillHash: HASH, riskDecisionId: "synthetic-risk",
      requestedNotionalKrw: 1000, requestedQuantity: 0.1, filledNotionalKrw: 1000, filledQuantity: 0.1,
      cumulativeFilledNotionalKrw: 1000, cumulativeFilledQuantity: 0.1,
      expectedPrePortfolioVersion: "v1", expectedPrePortfolioSnapshotHash: HASH,
      resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: hashCanonicalPayload({ version: 2 }) }));
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /predecessor drift/);
    const result = await createPortfolioPlanExecutionPreview({ ...request, expectedPlanEventHash: partial.planEventHash });
    assert.equal(result.packetPreview.policyPreview.preview.input.quantityOverride, 0.2);
    assert.equal(result.packetPreview.policyPreview.preview.input.requestedNotionalKrw, 2000);
    assert.equal(result.planContext.portfolioVersion, "v2");
    assert.equal(result.planContext.priorCumulativeFilledQuantity, 0.1);
    assert.equal(result.planContext.remainingNotionalCapKrw, 99_000);
    await assert.rejects(readFile(createPaperFillExecutionPaths(input.baseDir).recordsPath), { code: "ENOENT" });
  }, { side: "SELL" });
});

test("plan execution preview keeps whole-share targets and rejects caller scope or amount overrides", async () => {
  await withPlanExecutionFixture(async ({ request }) => {
    const preview = (await createPortfolioPlanExecutionPreview(request)).packetPreview.policyPreview.preview;
    assert.equal(preview.input.quantityOverride, 10);
    assert.equal(preview.execution.quantity, 5);
    assert.equal(preview.input.executionPolicy.modelVersion, WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION);
    for (const extra of [{ requestedNotionalKrw: 1 }, { quantityOverride: 1 }, { side: "SELL" }, { scope: { scopeKind: "legacy_reduce_only" } },
      { market: "US" }, { actionId: "other" }, { asOf: CREATED_AT }, { portfolioVersion: "other" }, { executionPolicy: {} }]) {
      await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, ...extra }));
    }
  }, { whole: true });
});

test("plan execution preview rejects terminal history, invalid source and share-mode mismatch", async () => {
  await withPlanExecutionFixture(async ({ request, events, plan, approval }) => {
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, priceEvidenceRef: "missing" }), /does not resolve/);
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, liquidityPacketHash: HASH }), /exactly once/);
    const rejected = await events.append(planEvent(plan, "rejected", approval));
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, expectedPlanEventHash: rejected.planEventHash }), /approved unfinished/);
  });
  await withPlanExecutionFixture(async ({ request }) => {
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /share mode differ/);
  }, { whole: true, fractionalPolicy: true });
});

test("plan execution preview rejects reduce-only or retired BUY mandates and source-price cap excess", async () => {
  await withPlanExecutionFixture(async ({ request, mandates, mandate, activation }) => {
    await mandates.appendEvent(mandateTransition(mandate!, "retired", activation!.mandateEventId));
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /active investment mandate/);
  });
  await withPlanExecutionFixture(async ({ request }) => {
    await assert.rejects(createPortfolioPlanExecutionPreview(request), /open-or-increase/);
  }, { reduceOnly: true });
  await withPlanExecutionFixture(async ({ request, input }) => {
    const price = createSourcePriceEvidenceRecord({ sourceContractId: "fixture-execution", market: input.market, symbol: input.symbol,
      priceField: "last_price", priceKrw: 1_000_000, observedAt: new Date().toISOString(), createdAt: new Date().toISOString(), sourceRefs: ["synthetic"] });
    await new SourcePriceEvidenceFileRepository(input.baseDir).append(price);
    await assert.rejects(createPortfolioPlanExecutionPreview({ ...request, priceEvidenceRef: price.evidenceRef }), /remaining request exceeds/);
  }, { side: "SELL" });
});

test("plan execution preview detects plan or mandate changes during policy calculation", async (t) => {
  for (const change of ["plan", "mandate"] as const) {
    await withPlanExecutionFixture(async ({ request, plan, events, approval, mandate, mandates, activation }) => {
      const original = RuntimePortfolioPolicyActivationFileRepository.prototype.withDurableActivePolicy;
      t.mock.method(RuntimePortfolioPolicyActivationFileRepository.prototype, "withDurableActivePolicy", async function (
        this: RuntimePortfolioPolicyActivationFileRepository, ...args: Parameters<typeof original>
      ) {
        const result = await original.apply(this, args);
        if (change === "plan") await events.append(planEvent(plan, "rejected", approval));
        else await mandates.appendEvent(mandateTransition(mandate!, "retired", activation!.mandateEventId));
        return result;
      });
      try { await assert.rejects(createPortfolioPlanExecutionPreview(request), /changed during calculation/); }
      finally { t.mock.restoreAll(); }
    });
  }
});

async function withPlanExecutionFixture(run: (value: {
  request: Parameters<typeof createPortfolioPlanExecutionPreview>[0]; input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0];
  plan: RebalancePlanRecord; events: RebalancePlanEventFileRepository; approval: RebalancePlanEvent;
  mandates: InvestmentMandateFileRepository; mandate: InvestmentMandateRecord | null; activation: ReturnType<typeof createInvestmentMandateEvent> | null;
  candidate: Omit<DecisionInput, "decidedAt">;
}) => Promise<void>, options: { side?: "BUY" | "SELL"; legacy?: boolean; whole?: boolean; fractionalPolicy?: boolean; reduceOnly?: boolean; riskSnapshot?: boolean } = {}) {
  const side = options.side ?? "BUY";
  const parameters = executionFixtureParameters(10);
  if (options.whole && !options.fractionalPolicy) {
    parameters.markets.KR!.executionPolicy.modelVersion = WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION;
    parameters.markets.KR!.executionPolicy.allowFractionalShares = false;
  }
  await withPolicyExecutionFixture(async ({ input, fixture }) => {
    const { decidedAt: _decidedAt, ...candidate } = decisionInput(fixture, side, options.legacy);
    if (options.riskSnapshot) {
      const snapshot = snapshotFixture(candidate, options.legacy ?? false, { cashKrw: 1_000_000, quantity: 10 });
      await new PortfolioSizingSnapshotFileRepository(input.baseDir).append(snapshot);
      candidate.expectedPortfolioSnapshotHash = snapshot.portfolioSnapshotHash;
    }
    const { capacityReservation, ...payload } = mandatePayload(candidate);
    const mandate = options.legacy ? null : createInvestmentMandateRecord({ ...payload, ...(options.reduceOnly
      ? { manualAuthorizationScope: "classify_existing_reduce_only", maximumOpeningNotionalKrw: 0 } : { capacityReservation }) });
    const mandates = new InvestmentMandateFileRepository(input.baseDir);
    let activation: ReturnType<typeof createInvestmentMandateEvent> | null = null;
    if (mandate !== null) {
      await mandates.appendRecord(mandate);
      activation = createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
        portfolioId: mandate.portfolioId, policyHash: mandate.policyHash, market: mandate.market, symbol: mandate.symbol,
        bucket: mandate.bucket, eventType: "activated", asOf: CREATED_AT, createdAt: CREATED_AT, reasonCodes: ["fixture"] });
      await mandates.appendEvent(activation);
    }
    const target = options.whole ? { targetKind: "whole_share_quantity" as const, targetQuantity: 10, referencePriceKrw: 10_000,
      plannedNotionalKrw: 100_000, residualNotionalKrw: 0, priceEvidenceRef: input.priceEvidenceRef }
      : side === "BUY" ? { targetKind: "fractional_buy_notional" as const, targetNotionalKrw: 100_000 }
      : { targetKind: "fractional_sell_quantity" as const, targetQuantity: 0.3, referencePriceKrw: 10_000,
        markedTargetNotionalKrw: 3000, priceEvidenceRef: input.priceEvidenceRef };
    const plan = createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: input.portfolioId, portfolioVersion: "v1",
      portfolioSnapshotHash: candidate.expectedPortfolioSnapshotHash, policyHash: input.expectedPolicyHash, evidenceCutoffAt: CREATED_AT, createdAt: CREATED_AT,
      triggerRef: "synthetic-trigger", phase: side === "BUY" ? "buy" : "sell", actions: [{ actionId: "action-1", actionSequence: 0,
        market: input.market, symbol: input.symbol, executionTarget: target, maximumNotionalKrw: 100_000, reasonCodes: ["fixture"],
        ...(options.legacy ? { lineageKind: "unassigned_legacy_reduce_only" as const, side: "SELL" as const,
          observedPositionRef: "synthetic-legacy", legacyStateDetectedAt: CREATED_AT }
          : { lineageKind: "mandate" as const, side, mandateId: mandate!.mandateId }) }] });
    const plans = new RebalancePlanFileRepository(input.baseDir);
    await plans.append(plan);
    const events = new RebalancePlanEventFileRepository(input.baseDir, plans);
    const preview = await events.append(planEvent(plan, "previewed"));
    const approval = await events.append(planEvent(plan, "approved", preview));
    const packet = executionLiquidityPacket(input);
    await new FileMarketPacketStore(createStoragePaths(input.baseDir).marketPacketsPath).append(packet);
    await run({ input, plan, events, approval, mandate, mandates, activation, candidate, request: { baseDir: input.baseDir, planId: plan.planId,
      expectedPlanEventHash: approval.planEventHash, priceEvidenceRef: input.priceEvidenceRef, liquidityPacketHash: createMarketPacketHash(packet) } });
  }, policyFixture("v1", { bucket: parameters, legacy: executionFixtureParameters(20) }));
}

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

test("turnover fill origin resolves actual partial BUY, SELL and whole-share gross amounts without writes", async () => {
  for (const options of [{}, { side: "SELL" as const }, { whole: true }]) {
    await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
      const input = { baseDir, paperFillRecordId: fill.paperFillRecordId };
      const path = createPaperFillExecutionPaths(baseDir).recordsPath;
      const before = await readFile(path, "utf8");
      const result = await resolveBucketTurnoverFillOrigin(input);
      assert.equal(result.absoluteFilledNotionalKrw, fill.filledNotionalKrw);
      assert.notEqual(result.absoluteFilledNotionalKrw, fill.netAmountKrw);
      assert.equal(result.asOf, fill.asOf);
      assert.equal(result.bucket, "swing");
      assert.deepEqual(result.windowOrigin, root);
      assert.equal(result.rebalancePlanId, fill.rebalancePlanId);
      assert.equal(result.rebalanceActionId, fill.rebalanceActionId);
      assert.ok(Object.isFrozen(result.windowOrigin.snapshotOrigin.initialState));
      assert.deepEqual(await resolveBucketTurnoverFillOrigin(input), result);
      assert.equal(await readFile(path, "utf8"), before);
      if (fill.side === "BUY") assert.ok(result.absoluteFilledNotionalKrw < fill.requestedNotionalKrw);
    }, options);
  }
});

test("turnover fill origin rejects caller projections and independently rehashed plan/action substitutions", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const input = { baseDir, paperFillRecordId: fill.paperFillRecordId };
    for (const patch of [{ bucket: "hedge" }, { absoluteFilledNotionalKrw: 1 }, { asOf: fill.asOf }, { riskOrigin: {} }]) {
      await assert.rejects(resolveBucketTurnoverFillOrigin({ ...input, ...patch }));
    }
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker, completion] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { paperFillRecordId: _id, paperFillHash: _hash, ...payload } = fill;
    for (const patch of [{ rebalancePlanId: "other-plan" }, { rebalanceActionId: "other-action" }]) {
      const record = createPaperFillExecutionRecord({ ...payload, ...patch });
      await writeFile(path, rehashTurnoverFillPair({ ...entry, record }, marker, completion));
      await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: record.paperFillRecordId }), /scope mismatch/);
    }
    await writeFile(path, rehashTurnoverFillPair({ ...entry, riskOrigin: { ...entry.riskOrigin, commitHash: HASH } }, marker, completion));
    await assert.rejects(resolveBucketTurnoverFillOrigin(input), /persisted Risk origin/);
    await writeFile(path, original);
    assert.equal((await resolveBucketTurnoverFillOrigin(input)).fillId, fill.fillId);
  });
});

test("turnover fill origin rejects missing, corrupt and pending actual source histories", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const input = { baseDir, paperFillRecordId: fill.paperFillRecordId };
    for (const path of [createRebalancePlanPaths(baseDir).recordsPath, createInvestmentMandatePaths(baseDir).recordsPath,
      createSourcePriceEvidencePaths(baseDir).recordsPath, createStoragePaths(baseDir).marketPacketsPath,
      createBucketTurnoverWindowPaths(baseDir).recordsPath]) {
      const original = await readFile(path, "utf8");
      for (const content of ["", `${original}{corrupt}\n`]) {
        await writeFile(path, content);
        await assert.rejects(resolveBucketTurnoverFillOrigin(input));
        assert.equal(await readFile(path, "utf8"), content);
      }
      await writeFile(path, original);
    }
    const pending = createBucketTurnoverWindowPaths(baseDir).pendingPath;
    await writeFile(pending, "unfinished");
    await assert.rejects(resolveBucketTurnoverFillOrigin(input), /pending/);
  });
});

test("turnover fill origin rejects mismatched Risk window identity and denominator", async () => {
  for (const patch of [{ turnoverStateId: "other-window" }, { turnoverWindowOpenPortfolioNetWorthKrw: 2_000_000 }]) {
    await withTurnoverFillFixture(async ({ baseDir, fill }) => {
      await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /window identity or fixed denominator/);
    }, { assessment: patch });
  }
});

test("turnover fill origin rejects late durable fill commits and source clock rollback", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker, completion] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    await writeFile(path, rehashTurnoverFillPair(entry, marker, { ...completion, completedAt: root.snapshotOrigin.initialState.windowEndsAt }));
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /chronology or window boundary/);
    await writeFile(path, original);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(root.appendedAt) - 1 });
    try { await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId })); }
    finally { context.mock.timers.reset(); }
  });
});

test("turnover fill origin rejects unbound fills and never assigns legacy reduce-only fills to buckets", async () => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const decision = await repository.createAndAppendWithExecutionOrigin(candidate, selection);
    const history = await repository.readVerifiedHistory();
    const preview = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!.preview;
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const fill = await fills.createAndAppendWithRiskOrigin(executionBoundFillInput(candidate, preview), history, decision.riskDecisionId);
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /legacy reduce-only/);
    const unboundDir = join(baseDir, "unbound");
    await new PaperFillExecutionFileRepository(unboundDir).append(fill);
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir: unboundDir, paperFillRecordId: fill.paperFillRecordId }), /requires a persisted Risk origin/);
  }, { side: "SELL", legacy: true });
});

test("turnover fill completion proof survives retries and cannot be retrofitted to old pairs", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const history = await fills.readVerifiedHistory();
    const origin = resolvePersistedPaperFillExecutionOrigin(history, fill.paperFillRecordId);
    assert.ok(origin.completion);
    assert.ok(Date.parse(origin.completion.completedAt) >= Date.parse(origin.appendedAt));
    const risks = await new PortfolioActionRiskDecisionFileRepository(baseDir).readVerifiedHistory();
    const riskId = origin.riskOrigin!.riskDecisionId;
    const input = turnoverRetryInput(fill);
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    assert.equal(original.trimEnd().split("\n").length, 3);
    assert.deepEqual(await fills.createAndAppendWithRiskCompletion(input, risks, riskId), fill);
    assert.equal(await readFile(path, "utf8"), original);
    const unbound = createPaperFillExecutionRecord({ ...input, fillId: "mixed-v1-fill", asOf: fill.asOf, createdAt: fill.createdAt });
    await fills.append(unbound);
    const mixed = (await readFile(path, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.equal(mixed[3].previousEntryHash, origin.completion.completionHash);
    assert.deepEqual(await fills.readAll(), [fill, unbound]);
    const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const oldPair = rehashTurnoverFillPair({ ...entry, schemaVersion: "paper_fill_execution_entry.v2" }, marker);
    await writeFile(path, oldPair);
    assert.deepEqual(await fills.createAndAppendWithRiskOrigin(input, risks, riskId), fill);
    await assert.rejects(fills.createAndAppendWithRiskCompletion(input, risks, riskId), /cannot be added after persistence/);
    await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }), /post-fsync completion proof/);
    assert.equal(await readFile(path, "utf8"), oldPair);
  });
});

test("turnover fill completion rejects missing, torn, altered and backward completion records", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill }) => {
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker, completion] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    for (const bytes of [rehashTurnoverFillPair(entry, marker), original.trimEnd(),
      rehashTurnoverFillPair(entry, marker, { ...completion, completedAt: new Date(Date.parse(marker.committedAt) - 1).toISOString() }),
      `${original.split("\n").slice(0, 2).join("\n")}\n${JSON.stringify({ ...completion, commitHash: HASH })}\n`]) {
      await writeFile(path, bytes);
      await assert.rejects(new PaperFillExecutionFileRepository(baseDir).readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId }));
      assert.equal(await readFile(path, "utf8"), bytes);
    }
  });
});

test("turnover rejects a marker fsync that crosses the window even when committedAt is inside", async (context) => {
  for (const failMarker of [false, true]) await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const fills = new PaperFillExecutionFileRepository(baseDir);
    const fillOrigin = resolvePersistedPaperFillExecutionOrigin(await fills.readVerifiedHistory(), fill.paperFillRecordId);
    const risks = await new PortfolioActionRiskDecisionFileRepository(baseDir).readVerifiedHistory();
    const path = createPaperFillExecutionPaths(baseDir).recordsPath;
    const probe = await open(path, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const end = Date.parse(root.snapshotOrigin.initialState.windowEndsAt);
    let crossed = false;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const target = await stat(path, { bigint: true });
      await originalSync.call(this);
      if (own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev) &&
        (await readFile(path, "utf8")).trimEnd().split("\n").length === 5) {
        crossed = true;
        context.mock.timers.setTime(end);
        if (failMarker) throw new Error("injected marker fsync failure");
      }
    });
    let late: ReturnType<typeof createPaperFillExecutionRecord> | undefined;
    try {
      const operation = fills.createAndAppendWithRiskCompletion({ ...turnoverRetryInput(fill), fillId: "late-fill" }, risks, fillOrigin.riskOrigin!.riskDecisionId);
      if (failMarker) await assert.rejects(operation, /injected marker fsync failure/);
      else late = await operation;
    } finally { sync.mock.restore(); }
    try {
      assert.equal(crossed, true);
      if (failMarker) await assert.rejects(fills.readVerifiedHistory(), /corrupt/);
      else {
        assert.ok(late);
        const lateOrigin = resolvePersistedPaperFillExecutionOrigin(await fills.readVerifiedHistory(), late.paperFillRecordId);
        assert.ok(Date.parse(lateOrigin.appendedAt) < end);
        assert.equal(Date.parse(lateOrigin.completion!.completedAt), end);
        await assert.rejects(resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: late.paperFillRecordId }), /chronology or window boundary/);
      }
    } finally { context.mock.timers.reset(); }
  });
});

test("turnover event storage derives fills, preserves retry origins and replays the complete cumulative state", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root, createNextFill }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const initial = root.snapshotOrigin.initialState;
    assert.deepEqual(await repository.readWindowState(initial.turnoverStateId), initial);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: initial.turnoverStateHash };
    for (const extra of [{ absoluteFilledNotionalKrw: 1 }, { asOf: fill.asOf }, { previousTurnoverEventId: "caller" }]) {
      await assert.rejects(repository.appendFill({ ...input, ...extra }));
    }
    const first = await repository.appendFill(input);
    const path = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const firstBytes = await readFile(path, "utf8");
    assert.equal(firstBytes.trimEnd().split("\n").length, 2);
    assert.equal(first.absoluteFilledNotionalKrw, fill.filledNotionalKrw);
    assert.equal(first.asOf, fill.asOf);
    assert.deepEqual(await repository.appendFill(input), first);
    assert.equal(await readFile(path, "utf8"), firstBytes);
    const prior = replayBucketTurnoverEvents({ initialState: initial, events: [first] });
    assert.deepEqual(await repository.readWindowState(initial.turnoverStateId), prior);
    const nextFill = await createNextFill(prior, "second-turnover-fill");
    await assert.rejects(repository.appendFill({ ...input, paperFillRecordId: nextFill.paperFillRecordId }), /CAS mismatch/);
    const second = await repository.appendFill({ paperFillRecordId: nextFill.paperFillRecordId, expectedTurnoverStateHash: prior.turnoverStateHash });
    assert.equal(second.previousTurnoverEventId, first.turnoverEventId);
    assert.equal(second.resultingCumulativeAbsoluteFilledNotionalKrw, fill.filledNotionalKrw + nextFill.filledNotionalKrw);
    const reopened = new BucketTurnoverEventFileRepository(baseDir);
    const history = await reopened.readVerifiedHistory();
    assert.deepEqual(history.events, [first, second]);
    assert.deepEqual(await reopened.readWindowState(initial.turnoverStateId), replayBucketTurnoverEvents({ initialState: initial, events: [first, second] }));
    const origin = resolveVerifiedBucketTurnoverEventOrigin(history, first.turnoverEventId);
    assert.equal(origin.source.paperFillOrigin.paperFillRecordId, fill.paperFillRecordId);
    assert.ok(Object.isFrozen(origin.source.turnoverAssessment));
    assert.throws(() => resolveVerifiedBucketTurnoverEventOrigin({ ...history }, first.turnoverEventId), /not repository-verified/);
    assert.deepEqual(await reopened.appendFill(input), first);
    await assert.rejects(reopened.appendFill({ ...input, expectedTurnoverStateHash: prior.turnoverStateHash }), /original state mismatch/);
  });
});

test("turnover event accepts the durable fill completion millisecond and rejects earlier creation", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const source = await resolveBucketTurnoverFillOrigin({ baseDir, paperFillRecordId: fill.paperFillRecordId });
    const completedAt = source.paperFillOrigin.completion!.completedAt;
    const before = new Date(Date.parse(completedAt) - 1).toISOString();
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    const paths = createBucketTurnoverEventPaths(baseDir);
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(before) });
    try {
      await assert.rejects(repository.appendFill(input), /chronology|availability/);
      await assert.rejects(stat(paths.eventsPath), { code: "ENOENT" });
      await assert.rejects(stat(paths.pendingPath), { code: "ENOENT" });
      context.mock.timers.setTime(Date.parse(completedAt));
      const event = await repository.appendFill(input);
      assert.equal(event.createdAt, completedAt);
      const original = await readFile(paths.eventsPath, "utf8");
      const reopened = new BucketTurnoverEventFileRepository(baseDir);
      assert.deepEqual((await reopened.readVerifiedHistory()).events, [event]);
      assert.deepEqual(await reopened.appendFill(input), event);
      assert.equal(await readFile(paths.eventsPath, "utf8"), original);
      const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
      const earlier = { ...entry, appendStartedAt: before, event: { ...entry.event, createdAt: before } };
      const damaged = rehashTurnoverFillPair(earlier, marker);
      await writeFile(paths.eventsPath, damaged);
      await assert.rejects(reopened.readVerifiedHistory(), /corrupt/);
      assert.equal(await readFile(paths.eventsPath, "utf8"), damaged);
    } finally { context.mock.timers.reset(); }
  });
});

test("turnover event concurrent first append across processes converges to one event", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const request = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    const script = `import { BucketTurnoverEventFileRepository } from './dist/portfolio/bucketTurnoverEventFiles.js';
      const event = await new BucketTurnoverEventFileRepository(process.argv[1], { lockTimeoutMs: 30000 }).appendFill(JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify(event));`;
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => new Promise<unknown>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir, JSON.stringify(request)],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) { reject(new Error(stderr || `child exited ${code}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    })));
    const history = await new BucketTurnoverEventFileRepository(baseDir).readVerifiedHistory();
    assert.equal(history.events.length, 1);
    for (const result of results) { assert.equal(result.status, "fulfilled"); assert.deepEqual(result.value, history.events[0]); }
  });
});

test("turnover event rejects rehashed source, cumulative, predecessor and chronology drift without repairing bytes", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const input = { paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash };
    const event = await repository.appendFill(input);
    const path = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const original = await readFile(path, "utf8");
    const [entry, marker] = original.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { turnoverEventId: _id, turnoverEventHash: _hash, ...eventInput } = event;
    const alternatives = [
      { ...entry, priorStateHash: HASH }, { ...entry, previousEntryHash: HASH },
      { ...entry, source: { ...entry.source, absoluteFilledNotionalKrw: 1 } },
      { ...entry, event: createBucketTurnoverEvent({ ...eventInput, resultingCumulativeAbsoluteFilledNotionalKrw: event.absoluteFilledNotionalKrw + 1 }) },
      { ...entry, event: createBucketTurnoverEvent({ ...eventInput, previousTurnoverEventId: "unrelated" }) }
    ];
    const damaged = [original.trimEnd(), `${original}{corrupt}\n`, `${original}\n`, original.split("\n")[0] + "\n",
      ...alternatives.map((value) => rehashTurnoverFillPair(value, marker)),
      rehashTurnoverFillPair(entry, { ...marker, committedAt: root.snapshotOrigin.initialState.windowEndsAt })];
    // Even a correctly chained duplicate cannot count the same portfolio fill twice.
    damaged.push(original + rehashTurnoverFillPair({ ...entry, previousEntryHash: marker.commitHash, appendStartedAt: marker.committedAt }, marker));
    for (const bytes of damaged) {
      await writeFile(path, bytes);
      await assert.rejects(repository.readVerifiedHistory(), /corrupt|torn/);
      await assert.rejects(repository.appendFill(input), /corrupt|torn/);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, original);
    assert.deepEqual((await repository.readVerifiedHistory()).events, [event]);
  });
});

test("turnover event revalidates stored fill sources and refuses stale Risk prior state", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root, createNextFill }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const initial = root.snapshotOrigin.initialState;
    const event = await repository.appendFill({ paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: initial.turnoverStateHash });
    const current = await repository.readWindowState(initial.turnoverStateId);
    const stale = await createNextFill(initial, "stale-risk-fill");
    await assert.rejects(repository.appendFill({ paperFillRecordId: stale.paperFillRecordId, expectedTurnoverStateHash: current.turnoverStateHash }), /complete prior replay/);
    const fillPath = createPaperFillExecutionPaths(baseDir).recordsPath;
    const original = await readFile(fillPath, "utf8");
    await writeFile(fillPath, original.split("\n").slice(0, 2).join("\n") + "\n");
    await assert.rejects(repository.readVerifiedHistory(), /corrupt/);
    await writeFile(fillPath, original);
    assert.deepEqual((await repository.readVerifiedHistory()).events, [event]);
    const paths = createBucketTurnoverEventPaths(baseDir);
    await writeFile(paths.lockPath, "abandoned");
    await assert.rejects(new BucketTurnoverEventFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readVerifiedHistory(), /lock is unavailable/);
    await rm(paths.lockPath);
    await writeFile(paths.pendingPath, "unfinished");
    await assert.rejects(repository.readVerifiedHistory(), /pending/);
  });
});

test("turnover event append failures and boundary-crossing fsync retain a pending barrier", async (context) => {
  for (const failure of ["entry", "marker", "boundary"] as const) await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverEventFileRepository(baseDir);
    const paths = createBucketTurnoverEventPaths(baseDir);
    const probe = await open(join(baseDir, "turnover-probe"), "a");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let logSyncs = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 1 });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const own = await this.stat({ bigint: true });
      const target = await stat(paths.eventsPath, { bigint: true }).catch(() => undefined);
      await originalSync.call(this);
      if (target !== undefined && own.isFile() && own.ino === target.ino && (process.platform === "win32" || own.dev === target.dev)) {
        logSyncs++;
        if ((failure === "entry" && logSyncs === 1) || (failure === "marker" && logSyncs === 2)) throw new Error("injected turnover fsync failure");
        if (failure === "boundary" && logSyncs === 2) context.mock.timers.setTime(Date.parse(root.snapshotOrigin.initialState.windowEndsAt));
      }
    });
    try {
      await assert.rejects(repository.appendFill({ paperFillRecordId: fill.paperFillRecordId,
        expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash }), /injected turnover|commit clock or boundary/);
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
    const bytes = await readFile(paths.eventsPath, "utf8");
    assert.ok((await stat(paths.pendingPath)).isFile());
    await assert.rejects(new BucketTurnoverEventFileRepository(baseDir).readVerifiedHistory(), /pending/);
    assert.equal(await readFile(paths.eventsPath, "utf8"), bytes);
  });
});

test("turnover projection persists initial and filled states and requires explicit CAS refresh after source growth", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root, createNextFill }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const events = new BucketTurnoverEventFileRepository(baseDir);
    const initial = root.snapshotOrigin.initialState;
    await assert.rejects(repository.readVerifiedSnapshot(), /missing/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: null, states: [] } as Parameters<typeof repository.refresh>[0]));
    const empty = await repository.refresh({ expectedProjectionHash: null });
    assert.deepEqual(empty.states, [initial]);
    assert.equal(empty.sourceEventCount, 0);
    const emptyBytes = await readFile(path, "utf8");
    assert.deepEqual(await repository.refresh({ expectedProjectionHash: null }), empty);
    assert.equal(await readFile(path, "utf8"), emptyBytes);
    await writeFile(path, emptyBytes.replace('"sourceEventCount":0', '"sourceEventCount":-0'));
    await assert.rejects(repository.readVerifiedSnapshot(), /corrupt/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: empty.projectionHash }), /corrupt/);
    await writeFile(path, emptyBytes);
    assert.throws(() => getDurableBucketTurnoverStateObservation(empty), /no active durable/);
    const first = await events.appendFill({ paperFillRecordId: fill.paperFillRecordId, expectedTurnoverStateHash: initial.turnoverStateHash });
    await assert.rejects(repository.readVerifiedSnapshot(), /stale/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: HASH }), /CAS mismatch/);
    assert.equal(await readFile(path, "utf8"), emptyBytes);
    const firstProjection = await repository.refresh({ expectedProjectionHash: empty.projectionHash });
    assert.deepEqual(firstProjection.states, [replayBucketTurnoverEvents({ initialState: initial, events: [first] })]);
    const nextFill = await createNextFill(firstProjection.states[0]!, "projection-second-fill");
    const second = await events.appendFill({ paperFillRecordId: nextFill.paperFillRecordId,
      expectedTurnoverStateHash: firstProjection.states[0]!.turnoverStateHash });
    await assert.rejects(repository.readVerifiedSnapshot(), /stale/);
    const current = await repository.refresh({ expectedProjectionHash: firstProjection.projectionHash });
    assert.equal(current.sourceEventCount, 2);
    assert.deepEqual(current.states, [replayBucketTurnoverEvents({ initialState: initial, events: [first, second] })]);
    assert.deepEqual(await new BucketTurnoverStateFileRepository(baseDir).readVerifiedSnapshot(), current);
    assert.ok(Object.isFrozen(current.states));
    let leased: typeof current | undefined;
    await repository.withDurableSnapshot(async (snapshot) => {
      leased = snapshot;
      assert.ok(getDurableBucketTurnoverStateObservation(snapshot).observedAt);
      const source = getDurableBucketTurnoverStateSource(snapshot, initial.turnoverStateId);
      assert.deepEqual(source.state, current.states[0]);
      assert.equal(source.windowCommitHash, root.commitHash);
      assert.equal(source.lastEventCommitHash, current.sourceEventGenerationHash);
      assert.throws(() => getDurableBucketTurnoverStateSource({ ...snapshot }, initial.turnoverStateId), /no active durable/);
      assert.throws(() => getDurableBucketTurnoverStateSource(snapshot, "missing"), /no matching window/);
      assert.throws(() => getDurableBucketTurnoverStateObservation({ ...snapshot }), /no active durable/);
      await assert.rejects(new BucketTurnoverEventFileRepository(baseDir, { lockTimeoutMs: 30, lockRetryDelayMs: 5 }).readVerifiedHistory(), /lock is unavailable/);
      assert.ok((await stat(createBucketTurnoverWindowPaths(baseDir).lockPath)).isFile());
    });
    assert.throws(() => getDurableBucketTurnoverStateObservation(leased!), /no active durable/);
    assert.throws(() => getDurableBucketTurnoverStateSource(leased!, initial.turnoverStateId), /no active durable/);
    await assert.rejects(repository.withDurableSnapshot(async (snapshot) => { leased = snapshot; throw new Error("callback failure"); }), /callback failure/);
    assert.throws(() => getDurableBucketTurnoverStateObservation(leased!), /no active durable/);
    assert.deepEqual(await repository.readVerifiedSnapshot(), current);
  });
});

test("turnover projection rejects rehashed state and source tampering without overwriting it", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    await new BucketTurnoverEventFileRepository(baseDir).appendFill({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const valid = await repository.refresh({ expectedProjectionHash: null });
    const original = await readFile(path, "utf8");
    const alternatives = [{ ...valid, states: [] }, { ...valid, sourceEventGenerationHash: HASH },
      { ...valid, sourceWindowGenerationHash: HASH }, { ...valid, sourceEventCount: 99 },
      { ...valid, sourceWindowCount: 0 }, { ...valid, states: [root.snapshotOrigin.initialState] },
      { ...valid, states: [valid.states[0], valid.states[0]] }, { ...valid, extra: true }];
    const damaged = ["{broken", ...alternatives.map(({ projectionHash: _hash, ...payload }) =>
      JSON.stringify({ ...payload, projectionHash: hashCanonicalPayload(payload) }))];
    for (const bytes of damaged) {
      await writeFile(path, bytes);
      await assert.rejects(repository.readVerifiedSnapshot(), /corrupt/);
      await assert.rejects(repository.refresh({ expectedProjectionHash: valid.projectionHash }), /corrupt/);
      assert.equal(await readFile(path, "utf8"), bytes);
    }
    await writeFile(path, original);
    const eventPath = createBucketTurnoverEventPaths(baseDir).eventsPath;
    const eventBytes = await readFile(eventPath, "utf8");
    await writeFile(eventPath, "");
    await assert.rejects(repository.readVerifiedSnapshot(), /corrupt/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: valid.projectionHash }), /corrupt/);
    await writeFile(eventPath, eventBytes);
    await writeFile(createBucketTurnoverEventPaths(baseDir).pendingPath, "unfinished");
    await assert.rejects(repository.readVerifiedSnapshot(), /pending/);
    await assert.rejects(repository.refresh({ expectedProjectionHash: valid.projectionHash }), /pending/);
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("turnover projection retains historical windows and advances only to the newly verified root generation", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, root }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const first = await repository.refresh({ expectedProjectionHash: null });
    const initial = root.snapshotOrigin.initialState;
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(initial.windowEndsAt) + 1 });
    try {
      const next = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolve({ portfolioId: initial.portfolioId,
        bucket: initial.bucket, expectedPolicyHash: initial.lastAppliedPolicyHash });
      await assert.rejects(repository.readVerifiedSnapshot(), /stale/);
      const current = await repository.refresh({ expectedProjectionHash: first.projectionHash });
      assert.equal(current.sourceWindowCount, 2);
      assert.equal(current.sourceEventCount, 0);
      assert.equal(current.sourceWindowGenerationHash, next.commitHash);
      assert.deepEqual(new Set(current.states.map((state) => state.turnoverStateId)),
        new Set([initial.turnoverStateId, next.snapshotOrigin.initialState.turnoverStateId]));
      assert.deepEqual(await repository.readVerifiedSnapshot(), current);
    } finally { context.mock.timers.reset(); }
  });
});

test("turnover projection concurrent initial refresh across processes converges to one snapshot", async () => {
  await withTurnoverFillFixture(async ({ baseDir, root }) => {
    const script = `import { BucketTurnoverStateFileRepository } from './dist/portfolio/bucketTurnoverStateFiles.js';
      const snapshot = await new BucketTurnoverStateFileRepository(process.argv[1], { lockTimeoutMs: 30000 }).refresh({ expectedProjectionHash: null });
      process.stdout.write(JSON.stringify(snapshot));`;
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => new Promise<unknown>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, baseDir],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code !== 0) { reject(new Error(stderr || `child exited ${code}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    })));
    const snapshot = await new BucketTurnoverStateFileRepository(baseDir).readVerifiedSnapshot();
    assert.deepEqual(snapshot.states, [root.snapshotOrigin.initialState]);
    for (const result of results) { assert.equal(result.status, "fulfilled"); assert.deepEqual(result.value, snapshot); }
  });
});

test("turnover projection failed temporary fsync preserves its old state and durable observation waits for snapshot sync", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    const repository = new BucketTurnoverStateFileRepository(baseDir);
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const initial = await repository.refresh({ expectedProjectionHash: null });
    const original = await readFile(path, "utf8");
    await new BucketTurnoverEventFileRepository(baseDir).appendFill({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const probe = await open(path, "r+");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    let fail = true;
    let syncedAt: number | null = null;
    let callbackCalled = false;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    const mock = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const metadata = await this.stat({ bigint: true });
      const paths = [path, ...(await readdir(baseDir)).filter((name) => name.startsWith(`${BUCKET_TURNOVER_STATE_FILE_NAME}.tmp-`))
        .map((name) => join(baseDir, name))];
      const targets = await Promise.all(paths.map((target) => stat(target, { bigint: true }).catch(() => undefined)));
      const isProjection = metadata.isFile() && targets.some((target) => target !== undefined && target.ino === metadata.ino &&
        (process.platform === "win32" || target.dev === metadata.dev));
      if (isProjection && fail) throw new Error("injected projection fsync failure");
      await originalSync.call(this);
      if (isProjection) { context.mock.timers.setTime(Date.now() + 1); syncedAt = Date.now(); }
    });
    try {
      await assert.rejects(repository.refresh({ expectedProjectionHash: initial.projectionHash }), /injected projection fsync failure/);
      assert.equal(await readFile(path, "utf8"), original);
      fail = false;
      const current = await repository.refresh({ expectedProjectionHash: initial.projectionHash });
      fail = true;
      await assert.rejects(repository.withDurableSnapshot(async () => { callbackCalled = true; }), /injected projection fsync failure/);
      assert.equal(callbackCalled, false);
      fail = false;
      await repository.withDurableSnapshot(async (snapshot) => {
        assert.equal(snapshot.projectionHash, current.projectionHash);
        assert.ok(syncedAt !== null);
        assert.ok(Date.parse(getDurableBucketTurnoverStateObservation(snapshot).observedAt) >= syncedAt);
      });
    } finally { mock.mock.restore(); context.mock.timers.reset(); }
  });
});

function turnoverRetryInput(fill: ReturnType<typeof createPaperFillExecutionRecord>) {
  const { paperFillRecordId: _id, paperFillHash: _hash, asOf: _asOf, createdAt: _createdAt, ...input } = fill;
  return input;
}

function rehashTurnoverFillPair(entry: Record<string, unknown>, marker: Record<string, unknown>, completion?: Record<string, unknown>) {
  const { entryHash: _entryHash, ...payload } = entry;
  const entryHash = hashCanonicalPayload(payload);
  const { commitHash: _commitHash, ...commit } = marker;
  const markerPayload = { ...commit, entryHash };
  const commitHash = hashCanonicalPayload(markerPayload);
  const pair = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash })}\n`;
  if (completion === undefined) return pair;
  const { completionHash: _completionHash, ...previousCompletion } = completion;
  const proof = { ...previousCompletion, commitHash };
  return `${pair}${JSON.stringify({ ...proof, completionHash: hashCanonicalPayload(proof) })}\n`;
}

test("current turnover Risk resolver binds BUY and SELL to actual current state without writing or refreshing", async () => {
  for (const side of ["BUY", "SELL"] as const) await withTurnoverFillFixture(async ({ baseDir, root }) => {
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    const input = { baseDir, riskDecisionId: decision.riskDecisionId };
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /projection is missing/);
    const projection = await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const bytes = await readFile(path, "utf8");
    const result = await resolveCurrentPortfolioActionRiskDecisionTurnover(input);
    assert.deepEqual(result.turnoverObservation.state, root.snapshotOrigin.initialState);
    assert.equal(result.turnoverObservation.availableAt, root.appendedAt);
    assert.equal(result.turnoverObservation.windowCommitHash, root.commitHash);
    assert.equal(result.turnoverObservation.lastEventCommitHash, null);
    assert.equal(result.turnoverObservation.projectionHash, projection.projectionHash);
    assert.equal(result.turnoverCapacity!.withinTurnoverLimit, true);
    assert.ok(Object.isFrozen(result.turnoverObservation));
    assert.ok(Date.parse(result.turnoverObservation.observedAt) >= Date.parse(decision.decidedAt));
    assert.equal(await readFile(path, "utf8"), bytes);
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover({ ...input, state: result.turnoverObservation.state } as typeof input));
  }, { side });
});

test("current turnover Risk resolver rejects stale projections and superseded Risk assessments after a fill", async () => {
  await withTurnoverFillFixture(async ({ baseDir, root, fill, createNextFill }) => {
    const risks = new PortfolioActionRiskDecisionFileRepository(baseDir);
    const original = (await risks.readAll())[0]!;
    const input = { baseDir, riskDecisionId: original.riskDecisionId };
    const states = new BucketTurnoverStateFileRepository(baseDir);
    const empty = await states.refresh({ expectedProjectionHash: null });
    await new BucketTurnoverEventFileRepository(baseDir).appendFill({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /projection is stale/);
    const latest = await states.refresh({ expectedProjectionHash: empty.projectionHash });
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /differs from actual state/);
    await createNextFill(latest.states[0]!, "current-turnover-next-fill");
    const next = (await risks.readAll()).at(-1)!;
    const result = await resolveCurrentPortfolioActionRiskDecisionTurnover({ baseDir, riskDecisionId: next.riskDecisionId });
    assert.equal(result.turnoverObservation.state.cumulativeAbsoluteFilledNotionalKrw, fill.filledNotionalKrw);
    assert.equal(result.turnoverObservation.lastEventCommitHash, latest.sourceEventGenerationHash);
    assert.ok(Date.parse(result.turnoverObservation.availableAt) <= Date.parse(next.decidedAt));
    // Historical replay still explains the old decision; the current check is deliberately stricter.
    assert.equal((await resolvePortfolioActionRiskDecisionExecution(input)).decision.riskDecisionId, original.riskDecisionId);
  });
});

test("current turnover Risk resolver rejects self-consistent rehashed hash, prior and denominator claims", async () => {
  await withTurnoverFillFixture(async ({ baseDir }) => {
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _input, ...candidate } = entry.record as ReturnType<typeof createPortfolioActionRiskDecision>;
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    for (const patch of [{ turnoverStateHash: HASH }, { priorBucketTurnoverNotionalKrw: 1 },
      { turnoverWindowOpenPortfolioNetWorthKrw: candidate.turnoverAssessment.turnoverWindowOpenPortfolioNetWorthKrw * 2 }]) {
      const assessment = { ...candidate.turnoverAssessment, ...patch };
      assessment.resultingBucketTurnoverRatio = (assessment.priorBucketTurnoverNotionalKrw + assessment.requestedBucketTurnoverNotionalKrw) /
        assessment.turnoverWindowOpenPortfolioNetWorthKrw;
      const record = createPortfolioActionRiskDecision({ ...candidate, turnoverAssessment: assessment });
      const tampered = rehashTurnoverFillPair({ ...entry, record }, marker);
      await writeFile(path, tampered);
      const input = { baseDir, riskDecisionId: record.riskDecisionId };
      await resolvePortfolioActionRiskDecisionExecution(input);
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /differs from actual state/);
      assert.equal(await readFile(path, "utf8"), tampered);
    }
    await writeFile(path, bytes);
  });
});

test("current turnover Risk resolver rejects a state that became durable after the decision", async () => {
  await withTurnoverFillFixture(async ({ baseDir, fill, root }) => {
    await new BucketTurnoverEventFileRepository(baseDir).appendFill({ paperFillRecordId: fill.paperFillRecordId,
      expectedTurnoverStateHash: root.snapshotOrigin.initialState.turnoverStateHash });
    const latest = await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const state = latest.states[0]!;
    const path = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    const bytes = await readFile(path, "utf8");
    const [entry, marker] = bytes.trimEnd().split("\n").map((line) => JSON.parse(line));
    const { riskDecisionId: _id, riskDecisionHash: _hash, riskInputHash: _input, ...candidate } = entry.record as ReturnType<typeof createPortfolioActionRiskDecision>;
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    const record = createPortfolioActionRiskDecision({ ...candidate, turnoverAssessment: { ...candidate.turnoverAssessment,
      turnoverStateHash: state.turnoverStateHash, priorBucketTurnoverNotionalKrw: state.cumulativeAbsoluteFilledNotionalKrw,
      resultingBucketTurnoverRatio: (state.cumulativeAbsoluteFilledNotionalKrw + candidate.worstCaseFillNotionalKrw) / state.windowOpenPortfolioNetWorthKrw } });
    const now = new Date().toISOString();
    await writeFile(path, bytes + rehashTurnoverFillPair({ ...entry, record, appendStartedAt: now, previousEntryHash: marker.commitHash },
      { ...marker, committedAt: now }));
    const input = { baseDir, riskDecisionId: record.riskDecisionId };
    await resolvePortfolioActionRiskDecisionExecution(input);
    await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /source availability/);
  });
});

test("current turnover Risk resolver rejects expired windows and retirement or same-policy reactivation", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir, root }) => {
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    const input = { baseDir, riskDecisionId: decision.riskDecisionId };
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(root.snapshotOrigin.initialState.windowEndsAt) });
    try { await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /window expired or mismatched/); }
    finally { context.mock.timers.reset(); }
    const original = await resolvePortfolioActionRiskDecisionExecution(input);
    const policies = await readStoredRuntimePortfolioPolicyActivationSnapshot(baseDir);
    const store = new RuntimePortfolioPolicyActivationFileRepository(baseDir, policies.policies, policies.dependencies.repository);
    const now = Date.now() + 100;
    context.mock.timers.enable({ apis: ["Date"], now });
    try {
      await store.appendRetired({ portfolioId: decision.portfolioId, retiredActivationId: original.activePolicy.activation.activationId,
        reasonCode: "current-turnover-test", createdAt: new Date().toISOString() });
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /active runtime portfolio policy is required/);
      context.mock.timers.tick(1);
      await store.appendActivated({ policy: original.activePolicy.policy, createdAt: new Date().toISOString() });
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /activation drift/);
      await resolvePortfolioActionRiskDecisionExecution(input);
    } finally { context.mock.timers.reset(); }
  });
});

test("current turnover observation cannot predate the durable Risk commit after clock rollback", async (context) => {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const root = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolve({ portfolioId: candidate.portfolioId,
      bucket: "swing", expectedPolicyHash: candidate.policyHash });
    const initial = root.snapshotOrigin.initialState;
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket required");
    const bound = { ...candidate, turnoverAssessment: { ...candidate.turnoverAssessment,
      turnoverStateId: initial.turnoverStateId, turnoverStateHash: initial.turnoverStateHash,
      turnoverWindowOpenPortfolioNetWorthKrw: initial.windowOpenPortfolioNetWorthKrw,
      resultingBucketTurnoverRatio: candidate.worstCaseFillNotionalKrw / initial.windowOpenPortfolioNetWorthKrw } };
    const probe = await open(createPortfolioSizingSnapshotPaths(baseDir).recordsPath, "r");
    const prototype = Object.getPrototypeOf(probe) as FileHandle;
    const originalSync = prototype.sync;
    await probe.close();
    const riskPath = createPortfolioActionRiskDecisionPaths(baseDir).recordsPath;
    let riskSyncs = 0;
    context.mock.timers.enable({ apis: ["Date"], now: Date.now() + 100 });
    const sync = context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      const target = await stat(riskPath, { bigint: true }).catch(() => undefined);
      await originalSync.call(this);
      if (actual.isFile() && target !== undefined && actual.ino === target.ino &&
        (process.platform === "win32" || actual.dev === target.dev)) {
        riskSyncs += 1; context.mock.timers.tick(20);
      }
    });
    try {
      const decision = await repository.createAndAppendWithExecutionOrigin(bound, selection);
      sync.mock.restore();
      assert.ok(riskSyncs >= 2);
      const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(await repository.readVerifiedHistory(), decision.riskDecisionId);
      const rollbackAt = Date.parse(origin.appendedAt) - 1;
      assert.ok(rollbackAt > Date.parse(decision.decidedAt));
      await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
      const input = { baseDir, riskDecisionId: decision.riskDecisionId };
      context.mock.timers.setTime(rollbackAt);
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /observation chronology/);
      context.mock.timers.setTime(Date.parse(origin.appendedAt));
      const result = await resolveCurrentPortfolioActionRiskDecisionTurnover(input);
      assert.equal(result.turnoverObservation.observedAt, origin.appendedAt);
    } finally { sync.mock.restore(); context.mock.timers.reset(); }
  });
});

test("current turnover Risk resolver fails on projection fsync without returning a current observation", async (context) => {
  await withTurnoverFillFixture(async ({ baseDir }) => {
    const decision = (await new PortfolioActionRiskDecisionFileRepository(baseDir).readAll())[0]!;
    const input = { baseDir, riskDecisionId: decision.riskDecisionId };
    await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const path = join(baseDir, BUCKET_TURNOVER_STATE_FILE_NAME);
    const bytes = await readFile(path, "utf8");
    const identity = await stat(path, { bigint: true });
    const handle = await open(path, "r+");
    const prototype = Object.getPrototypeOf(handle) as FileHandle;
    const original = prototype.sync;
    await handle.close();
    let matched = 0;
    context.mock.method(prototype, "sync", async function (this: FileHandle) {
      const actual = await this.stat({ bigint: true });
      if (actual.isFile() && actual.ino === identity.ino && (process.platform === "win32" || actual.dev === identity.dev)) {
        matched += 1; throw new Error("injected current turnover sync failure");
      }
      await original.call(this);
    });
    try {
      await assert.rejects(resolveCurrentPortfolioActionRiskDecisionTurnover(input), /injected current turnover sync failure/);
      assert.equal(matched, 1);
      assert.equal(await readFile(path, "utf8"), bytes);
    } finally { context.mock.restoreAll(); }
    await resolveCurrentPortfolioActionRiskDecisionTurnover(input);
  });
});

async function withTurnoverFillFixture(run: (input: { baseDir: string; fill: ReturnType<typeof createPaperFillExecutionRecord>;
  root: Awaited<ReturnType<BucketTurnoverWindowFileRepository["createOrResolve"]>>;
  createNextFill: (prior: BucketTurnoverState, fillId: string) => Promise<ReturnType<typeof createPaperFillExecutionRecord>> }) => Promise<void>,
options: { side?: "BUY" | "SELL"; whole?: boolean; assessment?: { turnoverStateId?: string; turnoverWindowOpenPortfolioNetWorthKrw?: number } } = {}) {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const root = await new BucketTurnoverWindowFileRepository(baseDir).createOrResolve({ portfolioId: candidate.portfolioId,
      bucket: "swing", expectedPolicyHash: candidate.policyHash });
    assert.equal(candidate.turnoverAssessment.scopeKind, "bucket");
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
    const initial = root.snapshotOrigin.initialState;
    const denominator = options.assessment?.turnoverWindowOpenPortfolioNetWorthKrw ?? initial.windowOpenPortfolioNetWorthKrw;
    const bound = { ...candidate, turnoverAssessment: { ...candidate.turnoverAssessment,
      turnoverStateId: options.assessment?.turnoverStateId ?? initial.turnoverStateId, turnoverStateHash: initial.turnoverStateHash,
      turnoverWindowOpenPortfolioNetWorthKrw: denominator,
      resultingBucketTurnoverRatio: candidate.turnoverAssessment.requestedBucketTurnoverNotionalKrw / denominator } };
    const decision = await repository.createAndAppendWithExecutionOrigin(bound, selection);
    const history = await repository.readVerifiedHistory();
    const preview = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!.preview;
    const fill = await new PaperFillExecutionFileRepository(baseDir).createAndAppendWithRiskCompletion(executionBoundFillInput(bound, preview), history, decision.riskDecisionId);
    await run({ baseDir, fill, root, createNextFill: async (prior, fillId) => {
      const next = { ...bound, turnoverAssessment: { ...bound.turnoverAssessment, turnoverStateHash: prior.turnoverStateHash,
        priorBucketTurnoverNotionalKrw: prior.cumulativeAbsoluteFilledNotionalKrw,
        resultingBucketTurnoverRatio: (prior.cumulativeAbsoluteFilledNotionalKrw + bound.turnoverAssessment.requestedBucketTurnoverNotionalKrw) / denominator } };
      const nextDecision = await repository.createAndAppendWithExecutionOrigin(next, selection);
      const nextHistory = await repository.readVerifiedHistory();
      const nextPreview = resolveVerifiedPortfolioActionRiskDecisionOrigin(nextHistory, nextDecision.riskDecisionId).executionOrigin!.preview;
      return new PaperFillExecutionFileRepository(baseDir).createAndAppendWithRiskCompletion({ ...executionBoundFillInput(next, nextPreview), fillId }, nextHistory, nextDecision.riskDecisionId);
    } });
  }, options);
}

async function withRiskExecutionFixture(run: (value: { baseDir: string; repository: PortfolioActionRiskDecisionFileRepository;
  candidate: Omit<DecisionInput, "decidedAt">; selection: Parameters<PortfolioActionRiskDecisionFileRepository["createAndAppendWithExecutionOrigin"]>[1];
}) => Promise<void>, options: { side?: "BUY" | "SELL"; legacy?: boolean; whole?: boolean } = {}) {
  await withPlanExecutionFixture(async ({ request, candidate, plan }) => {
    const preview = (await createPortfolioPlanExecutionPreview(request)).packetPreview.policyPreview.preview;
    const gross = preview.execution.grossAmountKrw;
    const net = preview.execution.netAmountKrw;
    const derived = { ...candidate, planId: plan.planId, actionId: plan.actions[0]!.actionId,
      actionExecutionTargetHash: hashRebalanceExecutionTarget(plan.actions[0]!.executionTarget),
      requestedQuantity: preview.requestedQuantity, requestedNotionalKrw: preview.input.requestedNotionalKrw,
      worstCaseFillNotionalKrw: gross, approvedMaximumFillNotionalKrw: 100_000,
      cashAssessment: preview.input.side === "BUY" ? { side: "BUY" as const, worstCaseNetCashDebitKrw: net, approvedMaximumNetCashDebitKrw: net }
        : { side: "SELL" as const, expectedMinimumNetCashCreditKrw: net },
      turnoverAssessment: candidate.turnoverAssessment.scopeKind === "bucket" ? { ...candidate.turnoverAssessment,
        turnoverWindowOpenPortfolioNetWorthKrw: 1_000_000,
        requestedBucketTurnoverNotionalKrw: gross, resultingBucketTurnoverRatio: gross / 1_000_000 }
        : candidate.turnoverAssessment,
      riskEvidenceRefs: [...candidate.riskEvidenceRefs, request.priceEvidenceRef] };
    const { baseDir, planId: _planId, ...selection } = request;
    await run({ baseDir, repository: new PortfolioActionRiskDecisionFileRepository(baseDir), candidate: derived, selection });
  }, { ...options, riskSnapshot: true });
}

function executionBoundFillInput(candidate: Omit<DecisionInput, "decidedAt">, preview: ReturnType<typeof parsePortfolioActionExecutionPreview>) {
  const { input, execution } = preview;
  return { ...priceBoundFillInput(candidate, input.sourcePriceEvidence), quantityOverride: input.quantityOverride,
    executionPolicy: input.executionPolicy, volume: input.volume, averageVolume: input.averageVolume, liquidityStale: input.liquidityStale,
    fractionalShares: input.executionPolicy.allowFractionalShares, fillStatus: execution.fillStatus as "filled" | "partial",
    liquidityStatus: execution.liquidityStatus as "sufficient" | "partial", participationRate: execution.participationRate,
    fillPriceKrw: execution.fillPriceKrw, quantity: execution.quantity, filledNotionalKrw: execution.filledNotionalKrw,
    grossAmountKrw: execution.grossAmountKrw, netAmountKrw: execution.netAmountKrw, costBreakdown: execution.costBreakdown };
}

function executionLiquidityPacket(input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0]) {
  const now = new Date();
  return new MarketPacketBuilder({ packetId: "synthetic-execution-liquidity", generatedAt: now, expiresInSeconds: 300,
    maxCandidates: 1, constraints: { maxNewPositions: 1, maxBudgetPerSymbolKrw: 100_000, allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL"] } })
    .build({ portfolio: { portfolioId: input.portfolioId, cashKrw: 1_000_000, positions: [], updatedAt: now.toISOString() },
      candidates: [{ market: input.market, symbol: input.symbol, lastPriceKrw: 10_000, volume: 50, averageVolume: 100,
        sourceRefs: ["synthetic-liquidity"] }] }).packet;
}

function packetExecutionInput(input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0], packet: ReturnType<typeof executionLiquidityPacket>) {
  const { volume: _volume, averageVolume: _average, liquidityStale: _stale, ...request } = input;
  return { ...request, liquidityPacketHash: createMarketPacketHash(packet) };
}

function executionFixtureParameters(feeBps: number) {
  return portfolioExecutionRuleParametersSchema.parse({ schemaVersion: "portfolio_execution_rule.v1", markets: { KR: {
    maximumPriceAgeSeconds: 3600, allowedPriceSourceContractIds: ["fixture-execution"],
    executionPolicy: { modelVersion: PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price",
      slippageBps: 0, feeBps, taxBps: 20, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 }
  } } });
}

async function withPolicyExecutionFixture(
  run: (value: { input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0]; fixture: ReturnType<typeof policyFixture> }) => Promise<void>,
  fixture = policyFixture("v1", { bucket: executionFixtureParameters(10), legacy: executionFixtureParameters(20) })
) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-policy-execution-preview-"));
  try {
    await storePolicyFixture(baseDir, fixture);
    const price = createSourcePriceEvidenceRecord({ sourceContractId: "fixture-execution", market: "KR", symbol: "KR:005930",
      priceField: "last_price", priceKrw: 10_000, observedAt: new Date(Date.now() - 60_000).toISOString(),
      sourceRefs: ["synthetic-fixture"], createdAt: new Date().toISOString() });
    await new SourcePriceEvidenceFileRepository(baseDir).append(price);
    await run({ fixture, input: { baseDir, portfolioId: fixture.policy.portfolioId, expectedPolicyHash: fixture.policy.policyHash,
      scope: { scopeKind: "bucket", bucket: "swing" }, market: "KR", symbol: price.symbol, priceEvidenceRef: price.evidenceRef,
      side: "BUY", requestedNotionalKrw: 100_000, quantityOverride: 10, volume: 100, averageVolume: 200, liquidityStale: false } });
  } finally { await rm(baseDir, { recursive: true, force: true }); }
}

type ExecutionFixtureOptions = {
  bucket: Parameters<typeof createPortfolioRiskRuleParameterRecord>[0]["parameters"];
  legacy: Parameters<typeof createPortfolioRiskRuleParameterRecord>[0]["parameters"];
  ruleVersion?: string;
  appliesTo?: Array<"BUY" | "SELL">;
};

function policyFixture(version = "v1", execution?: ExecutionFixtureOptions, maxTurnoverRatio = 0.5) {
  const buckets = ["long_term", "swing", "short_term", "intraday", "hedge"] as const;
  const parameters = ["cash", "exposure", "sell", "legacy"].map((ruleId) => createPortfolioRiskRuleParameterRecord({
    ruleId, ruleVersion: "v1", version: "v1", parameters: { fixtureLimit: 1 }, createdAt: CREATED_AT
  }));
  const rule = (index: number, appliesTo: Array<"BUY" | "SELL">) => ({
    ruleId: parameters[index]!.ruleId, ruleVersion: "v1", appliesTo, parameterRef: riskRuleParameterRefFor(parameters[index]!)
  });
  const executionParameters = execution === undefined ? [] : [execution.bucket, execution.legacy].map((parameters) =>
    createPortfolioRiskRuleParameterRecord({ ruleId: "paper_execution", ruleVersion: execution.ruleVersion ?? "v1",
      version: "v1", parameters, createdAt: CREATED_AT }));
  const executionRules = (index: number) => execution === undefined ? [] : [{ ruleId: "paper_execution",
    ruleVersion: execution.ruleVersion ?? "v1", appliesTo: execution.appliesTo ?? ["BUY", "SELL"] as Array<"BUY" | "SELL">,
    parameterRef: riskRuleParameterRefFor(executionParameters[index]!) }];
  const bucketSet = createPortfolioRiskRuleSetRecord({ version: "bucket.v1", rules: [rule(0, ["BUY"]), rule(1, ["BUY", "SELL"]), rule(2, ["SELL"]), ...executionRules(0)], createdAt: CREATED_AT });
  // The shared rule-set contract covers both sides; legacy scope only uses SELL.
  const legacySet = createPortfolioRiskRuleSetRecord({ version: "legacy.v1", rules: [rule(0, ["BUY"]), rule(3, ["SELL"]), ...executionRules(1)], createdAt: CREATED_AT });
  const selections = buckets.map((bucket) => createBucketSelectionPolicyRecord({
    bucket, version: "v1", requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "fixture", maximumAgeSeconds: 60 }],
    everyTickSourceRequirement: { sourceContractId: "fixture", eventType: "verified_market_packet", maximumAgeSeconds: 60, dedupeKey: "packet_hash" },
    hardGateRuleIds: ["fixture"], scoringModelVersion: "v1", featureDefinitionRefs: ["fixture"], createdAt: CREATED_AT
  }));
  const drawdown = createBucketDrawdownSemanticsRecord({
    version: "v1", equityBasis: "bucket_assets_plus_cash", unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only", highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark", emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches", createdAt: CREATED_AT
  });
  const calendar = createSessionCalendarRecord({
    market: "KR", version: "v1", timeZone: "Asia/Seoul", validFromExchangeDate: "2026-09-01", validThroughExchangeDate: "2026-09-01",
    sessions: [{ exchangeDate: "2026-09-01", sessionKind: "regular", opensAt: "2026-09-01T09:00:00+09:00", closesAt: "2026-09-01T15:30:00+09:00", sourceEvidenceRefs: ["fixture"] }],
    createdAt: CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR", version: "v1", timeZone: "Asia/Seoul", sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version, sessionCalendarHash: calendar.hash, sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily", anchorLocalTime: "15:30:00", nonSessionDayRule: "previous_session", createdAt: CREATED_AT
  });
  const uniqueExecutionParameters = [...new Map(executionParameters.map((parameter) => [parameter.riskRuleParameterRecordId, parameter])).values()];
  const records: ImmutablePolicyDependencyRecords = { selectionPolicies: selections, riskParameters: [...parameters, ...uniqueExecutionParameters], riskRuleSets: [bucketSet, legacySet],
    drawdownSemantics: [drawdown], sessionCalendars: [calendar], scheduleBoundaries: [boundary] };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const targets = [0.35, 0.2, 0.15, 0.1, 0.05];
  const payload = {
    mode: "paper_only", recordType: "runtime_portfolio_policy_record", portfolioId: "paper-main",
    sourcePolicyRecordId: "fixture-source", sourcePolicyRecordHash: HASH, sourcePolicyHash: "b".repeat(64),
    policyId: "fixture", version, name: "Fixture policy",
    strategyBuckets: buckets.map((bucket, index) => ({
      bucket, targetWeightRatio: targets[index]!, minWeightRatio: 0, maxWeightRatio: 0.5, maxTurnoverRatio, maxDrawdownRatio: 0.1,
      turnoverWindow: { mode: "fixed_utc", durationSeconds: 86_400, anchor: "unix_epoch", denominator: "window_open_portfolio_net_worth_krw" },
      drawdownSemanticsRef: drawdownSemanticsRefFor(drawdown),
      reviewCadence: bucket === "intraday" ? { mode: "every_tick" } : { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(boundary)] }, eventTriggers: [],
      selectionTrigger: { mode: "entry_floor_on_due_cycle", entryWeightRatio: 0.02 },
      exitPolicy: { takeProfit: { mode: "disabled" }, timeExpiryAction: "review_required" },
      enabledMarkets: ["KR"], enabledAssetClasses: ["equity"], selectionPolicyRef: selectionPolicyRefFor(selections[index]!), riskRuleSetRef: riskRuleSetRefFor(bucketSet)
    })),
    cashPolicy: { targetCashRatio: 0.15, minimumCashReserveKrw: 100, ruleSource: "static" },
    hedgePolicy: { hedgeEnabled: true, hedgeTargetRatio: 0.05, maxCostRatio: 0.02 },
    exposurePolicy: { maxSymbolExposureRatio: 0.2, maxCountryExposureRatio: 0.8, maxCurrencyExposureRatio: 0.8 },
    legacyReduceOnlyPolicy: { allowBuyOrIncrease: false, maximumParticipationRatio: 0.1, riskRuleSetRef: riskRuleSetRefFor(legacySet) }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt: CREATED_AT,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt: CREATED_AT }) });
  const activation = createPortfolioPolicyActivatedEvent({ policy, activationSequence: 1, createdAt: CREATED_AT });
  return { policy, activation, dependencies, records, bucketSet, legacySet };
}
