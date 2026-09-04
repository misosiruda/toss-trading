import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, parseVerifiedPaperFillExecutionHistory } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { createRebalancePlanExecutionAppliedEvent } from "./rebalancePlanExecutionAppliedEvent.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
type RiskInput = Parameters<typeof createPortfolioActionRiskDecision>[0];
type Fixture = Awaited<ReturnType<typeof prepare>>;

test("execution binding resolves persisted BUY and SELL fills without mutation", async () => {
  for (const side of ["BUY", "SELL"] as const) {
    await withFixture({ side }, async (fixture) => {
      const result = validateRebalancePlanExecutionFillRiskBinding(fixture);
      assert.equal(result.paperFill.side, side);
      assert.equal(result.event.riskDecisionId, result.riskDecision.riskDecisionId);
      assert.equal(result.paperFill.filledNotionalKrw, 1_000);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.riskDecision.ruleResults));
      assert.equal(fixture.paperFillHistory.records.length, 1);
    });
  }
});

test("execution binding rejects event identity, state, amount and cumulative mismatches", async () => {
  await withFixture({}, async (fixture) => {
    const { planEventId, planEventHash, ...payload } = fixture.event;
    for (const patch of [
      { paperFillRecordId: "missing" }, { paperFillHash: HASH_C },
      { riskDecisionId: "missing" }, { fillId: "other-fill" },
      { planId: "other-plan" }, { actionId: "other-action" },
      { portfolioId: "other-portfolio" }, { policyHash: HASH_C },
      { expectedPrePortfolioVersion: "other-version" },
      { expectedPrePortfolioSnapshotHash: HASH_C },
      { requestedNotionalKrw: 1_001 }, { requestedQuantity: 11 },
      { filledNotionalKrw: 999 }, { filledQuantity: 9 },
      { cumulativeFilledNotionalKrw: 1_001 }, { cumulativeFilledQuantity: 11 }
    ]) {
      const event = createRebalancePlanExecutionAppliedEvent({ ...payload, ...patch });
      assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({ ...fixture, event }));
    }
  });
});

test("execution binding replays a partial fill with nonzero prior cumulative amounts", async () => {
  await withFixture({ volume: 50, risk: {
    priorCumulativeFilledNotionalKrw: 500, priorCumulativeFilledQuantity: 5
  } }, async (fixture) => {
    const { planEventId, planEventHash, ...payload } = fixture.event;
    const event = createRebalancePlanExecutionAppliedEvent({
      ...payload, fillSequence: 1, cumulativeFilledNotionalKrw: 1_000, cumulativeFilledQuantity: 10
    });
    const result = validateRebalancePlanExecutionFillRiskBinding({ ...fixture, event });
    assert.equal(result.paperFill.fillStatus, "partial");
    assert.equal(result.paperFill.filledNotionalKrw, 500);
    assert.equal(result.event.cumulativeFilledQuantity, 10);
  });
});

test("execution binding rejects unrelated and rejected persisted decisions", async () => {
  const variants: Partial<RiskInput>[] = [
    { planId: "different-plan" }, { market: "US" }, { symbol: "US:AAPL" },
    { side: "SELL", cashAssessment: { side: "SELL", expectedMinimumNetCashCreditKrw: 1_000 } },
    { expectedPortfolioVersion: "different-version" }, { requestedQuantity: 9 },
    { priorCumulativeFilledQuantity: 1 },
    { decision: "rejected", ruleResults: [{ ruleId: "cash", result: "fail", reasonCode: "cash_limit" }] }
  ];
  for (const risk of variants) {
    await withFixture({ risk }, async (fixture) => {
      assert.throws(() => validateRebalancePlanExecutionFillRiskBinding(fixture), /binding/);
    });
  }
});

test("execution binding enforces actual gross cap, BUY debit cap and SELL credit floor", async () => {
  const variants: Parameters<typeof prepare>[1][] = [
    { risk: { worstCaseFillNotionalKrw: 900, approvedMaximumFillNotionalKrw: 900,
      turnoverAssessment: { scopeKind: "legacy_reduce_only", countedInBucketTurnover: false },
      riskRuleScope: { scopeKind: "legacy_reduce_only", legacyPolicyHash: HASH_A },
      cashAssessment: { side: "SELL", expectedMinimumNetCashCreditKrw: 800 } }, side: "SELL" },
    { feeBps: 200, risk: { cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: 1_000, approvedMaximumNetCashDebitKrw: 1_001 } } },
    { side: "SELL", feeBps: 200, risk: { cashAssessment: { side: "SELL", expectedMinimumNetCashCreditKrw: 990 } } }
  ];
  for (const [index, options] of variants.entries()) {
    await withFixture(options, async (fixture) => {
      assert.throws(() => validateRebalancePlanExecutionFillRiskBinding(fixture),
        [/gross notional cap/, /net cash debit cap/, /net cash credit floor/][index]!);
    });
  }
});

test("execution binding rejects decision availability after fill and event cutoff before fill", async () => {
  await withFixture({ beforeRisk: true }, async (fixture) => {
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding(fixture), /availability cutoff/);
  });
  await withFixture({}, async (fixture) => {
    const { planEventId, planEventHash, ...payload } = fixture.event;
    const event = createRebalancePlanExecutionAppliedEvent({
      ...payload, asOf: new Date(Date.parse(payload.asOf) - 1).toISOString()
    });
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({ ...fixture, event }), /availability cutoff/);
  });
});

test("execution binding requires verified histories and revalidates source evidence", async () => {
  await withFixture({}, async (fixture) => {
    for (const key of ["riskDecisionHistory", "paperFillHistory", "sourcePriceEvidenceHistory"] as const) {
      assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({
        ...fixture, [key]: { records: fixture[key].records }
      }), /not (repository )?verified/);
    }
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({
      ...fixture, event: { ...fixture.event, planEventHash: HASH_C }
    }), /identity/);
    const parsed = parseVerifiedPaperFillExecutionHistory(
      fixture.paperFillHistory.records.map((record) => JSON.stringify(record)).join("\n") + "\n"
    );
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding({
      ...fixture, paperFillHistory: parsed
    }), /not repository verified/);
  });
  await withFixture({ evidencePriceKrw: 101 }, async (fixture) => {
    assert.throws(() => validateRebalancePlanExecutionFillRiskBinding(fixture), /source price evidence value mismatch/);
  });
});

async function withFixture(options: Parameters<typeof prepare>[1], run: (fixture: Fixture) => Promise<void>) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-fill-risk-binding-"));
  try { await run(await prepare(baseDir, options)); }
  finally { await rm(baseDir, { recursive: true, force: true }); }
}

async function prepare(baseDir: string, options: {
  side?: "BUY" | "SELL"; feeBps?: number; volume?: number; evidencePriceKrw?: number; risk?: Partial<RiskInput>; beforeRisk?: boolean;
}) {
  const side = options.side ?? "BUY";
  const asOf = "2020-01-01T00:00:00.000Z";
  const evidence = createSourcePriceEvidenceRecord({
    sourceContractId: "source-price-v1", market: "KR", symbol: "KR:005930",
    priceField: "last_price", priceKrw: options.evidencePriceKrw ?? 100, observedAt: asOf, sourceRefs: ["fixture"], createdAt: asOf
  });
  const sourceRepository = new SourcePriceEvidenceFileRepository(join(baseDir, "prices"));
  await sourceRepository.append(evidence);
  const sourcePriceEvidenceHistory = await sourceRepository.readVerifiedHistory();
  if (options.beforeRisk) await new Promise((resolve) => setTimeout(resolve, 5));
  const riskDecision = createPortfolioActionRiskDecision({
    riskRuleSetRecordId: "rules-1", riskRuleSetVersion: "v1", riskRuleSetHash: HASH_A,
    planId: "plan-1", actionId: "action-1", portfolioId: "portfolio-1", policyHash: HASH_A,
    expectedPortfolioVersion: "v1", expectedPortfolioSnapshotHash: HASH_A,
    market: "KR", symbol: "KR:005930", side, actionExecutionTargetHash: HASH_A,
    riskRuleScope: { scopeKind: "bucket", bucket: "swing" },
    turnoverAssessment: { scopeKind: "bucket", turnoverStateId: "turnover-1", turnoverStateHash: HASH_A,
      turnoverWindowOpenPortfolioNetWorthKrw: 10_000, priorBucketTurnoverNotionalKrw: 0,
      requestedBucketTurnoverNotionalKrw: 1_000, resultingBucketTurnoverRatio: 0.1 },
    priorCumulativeFilledNotionalKrw: 0, priorCumulativeFilledQuantity: 0,
    requestedNotionalKrw: 1_000, requestedQuantity: 10,
    worstCaseFillNotionalKrw: 1_000, approvedMaximumFillNotionalKrw: 1_000,
    cashAssessment: side === "BUY"
      ? { side, worstCaseNetCashDebitKrw: 1_000, approvedMaximumNetCashDebitKrw: 1_000 }
      : { side, expectedMinimumNetCashCreditKrw: 1_000 },
    decision: "approved", requiredRuleIds: ["cash"],
    ruleResults: [{ ruleId: "cash", result: "pass", reasonCode: "within_limit" }],
    riskEvidenceRefs: [evidence.evidenceRef], decidedAt: asOf,
    ...options.risk
  });
  const riskRepository = new PortfolioActionRiskDecisionFileRepository(join(baseDir, "risk"));
  await riskRepository.append(riskDecision);
  const riskDecisionHistory = await riskRepository.readVerifiedHistory();
  const origin = resolveVerifiedPortfolioActionRiskDecisionOrigin(riskDecisionHistory, riskDecision.riskDecisionId);
  const fillAsOf = new Date(Date.parse(origin.appendedAt) - (options.beforeRisk ? 1 : 0)).toISOString();
  const executionPolicy = {
    modelVersion: PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price" as const,
    slippageBps: 0, feeBps: options.feeBps ?? 0, taxBps: 0, halfSpreadBps: 0, fillRatio: 1,
    allowFractionalShares: true, maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1,
    rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0
  };
  const fill = buildPaperFill({ action: side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL",
    targetNotionalKrw: 1_000, sourcePriceKrw: 100, liquidityStale: false, policy: executionPolicy,
    ...(options.volume === undefined ? {} : { volume: options.volume }) });
  const paperFill = createPaperFillExecutionRecord({
    portfolioId: "portfolio-1", rebalancePlanId: "plan-1", rebalanceActionId: "action-1", fillId: "fill-1",
    market: "KR", symbol: "KR:005930", side, requestedNotionalKrw: 1_000, requestedQuantity: 10,
    quantityOverride: null, sourcePriceKrw: 100, sourcePriceEvidence: {
      sourceContractId: evidence.sourceContractId, evidenceRef: evidence.evidenceRef,
      evidenceHash: evidence.evidenceHash, market: "KR", symbol: "KR:005930", priceField: "last_price", observedAt: asOf
    }, averagePriceKrw: null, fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity,
    filledNotionalKrw: fill.filledNotionalKrw, grossAmountKrw: fill.grossAmountKrw, netAmountKrw: fill.netAmountKrw,
    participationRate: fill.participationRate ?? null, volume: fill.volume ?? null, averageVolume: fill.averageVolume ?? null, liquidityStale: false,
    fillStatus: fill.fillStatus as "filled" | "partial", liquidityStatus: fill.liquidityStatus as "not_modeled" | "sufficient" | "partial", liquidityRejectReason: null,
    fractionalShares: fill.fractionalShares, executionPolicy,
    costBreakdown: { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw,
      spreadCostKrw: fill.spreadCostKrw, impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw },
    evidenceRefs: [evidence.evidenceRef], asOf: fillAsOf, createdAt: fillAsOf
  });
  const fillRepository = new PaperFillExecutionFileRepository(join(baseDir, "fills"));
  await fillRepository.append(paperFill);
  const event = createRebalancePlanExecutionAppliedEvent({
    previousPlanEventId: "approved-event", eventType: "execution_applied",
    planId: "plan-1", planHash: HASH_A, cycleId: "cycle-1", portfolioId: "portfolio-1",
    portfolioVersion: "v1", portfolioSnapshotHash: HASH_A, policyHash: HASH_A, asOf: fillAsOf,
    actionId: "action-1", actionSequence: 0, fillSequence: 0, fillId: "fill-1",
    paperFillRecordId: paperFill.paperFillRecordId, paperFillHash: paperFill.paperFillHash,
    requestedNotionalKrw: 1_000, requestedQuantity: 10, filledNotionalKrw: fill.filledNotionalKrw, filledQuantity: fill.quantity,
    cumulativeFilledNotionalKrw: fill.filledNotionalKrw, cumulativeFilledQuantity: fill.quantity,
    riskDecisionId: riskDecision.riskDecisionId, expectedPrePortfolioVersion: "v1",
    expectedPrePortfolioSnapshotHash: HASH_A, resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: HASH_B
  });
  return { event, riskDecisionHistory, paperFillHistory: await fillRepository.readVerifiedHistory(), sourcePriceEvidenceHistory };
}
