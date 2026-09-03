import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortfolioActionRiskDecision,
  parsePortfolioActionRiskDecision
} from "./portfolioActionRiskDecision.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

test("portfolio action risk decision preserves complete approved input", () => {
  const decision = createPortfolioActionRiskDecision(bucketInput());

  assert.deepEqual(parsePortfolioActionRiskDecision(decision), decision);
  assert.match(decision.riskDecisionId, /^portfolio_action_risk_decision_/);
  assert.deepEqual(decision.requiredRuleIds, ["cash", "turnover"]);
  assert.deepEqual(
    decision.ruleResults.map((result) => result.ruleId),
    ["cash", "turnover"]
  );
  assert.deepEqual(decision.riskEvidenceRefs, ["evidence-a", "evidence-b"]);
  assert.equal(Object.isFrozen(decision), true);
});

test("portfolio action risk decision derives rejected result from rule failure", () => {
  const input = bucketInput();
  const decision = createPortfolioActionRiskDecision({
    ...input,
    decision: "rejected",
    ruleResults: [
      { ruleId: "cash", result: "fail", reasonCode: "cash_limit" },
      { ruleId: "turnover", result: "pass", reasonCode: "within_limit" }
    ]
  });

  assert.equal(decision.decision, "rejected");
});

test("portfolio action risk decision supports legacy SELL without bucket turnover", () => {
  const decision = createPortfolioActionRiskDecision({
    ...bucketInput(),
    side: "SELL",
    riskRuleScope: {
      scopeKind: "legacy_reduce_only",
      legacyPolicyHash: HASH_C
    },
    turnoverAssessment: {
      scopeKind: "legacy_reduce_only",
      countedInBucketTurnover: false
    },
    cashAssessment: {
      side: "SELL",
      expectedMinimumNetCashCreditKrw: 95
    }
  });

  assert.equal(decision.riskRuleScope.scopeKind, "legacy_reduce_only");
});

test("portfolio action risk decision rejects rule-set and derived decision drift", () => {
  const input = bucketInput();
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        requiredRuleIds: ["cash"],
        ruleResults: input.ruleResults
      }),
    /required rules do not match/
  );
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        decision: "approved",
        ruleResults: [
          { ruleId: "cash", result: "fail", reasonCode: "cash_limit" },
          input.ruleResults[0]!
        ]
      }),
    /does not match rule results/
  );
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        requiredRuleIds: ["cash", "cash"]
      }),
    /must not contain duplicates/
  );
});

test("portfolio action risk decision rejects scope, side, and turnover drift", () => {
  const input = bucketInput();
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        turnoverAssessment: {
          scopeKind: "legacy_reduce_only",
          countedInBucketTurnover: false
        }
      }),
    /scope does not match/
  );
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        cashAssessment: {
          side: "SELL",
          expectedMinimumNetCashCreditKrw: 90
        }
      }),
    /side does not match/
  );
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        turnoverAssessment: {
          ...input.turnoverAssessment,
          resultingBucketTurnoverRatio: 0.3
        }
      }),
    /turnover ratio mismatch/
  );
});

test("portfolio action risk decision rejects tampered identity", () => {
  const decision = createPortfolioActionRiskDecision(bucketInput());
  assert.throws(
    () =>
      parsePortfolioActionRiskDecision({
        ...decision,
        approvedMaximumFillNotionalKrw: 50
      }),
    /identity mismatch/
  );
  assert.throws(
    () =>
      parsePortfolioActionRiskDecision({
        ...decision,
        riskDecisionHash: HASH_C
      }),
    /identity mismatch/
  );
});

function bucketInput() {
  return {
    riskRuleSetRecordId: "risk-set-1",
    riskRuleSetVersion: "v1",
    riskRuleSetHash: HASH_A,
    planId: "plan-1",
    actionId: "action-1",
    portfolioId: "portfolio-1",
    policyHash: HASH_B,
    expectedPortfolioVersion: "portfolio-v1",
    expectedPortfolioSnapshotHash: HASH_C,
    market: "KR" as const,
    symbol: "KR:005930",
    side: "BUY" as const,
    riskRuleScope: { scopeKind: "bucket" as const, bucket: "swing" as const },
    actionExecutionTargetHash: HASH_A,
    turnoverAssessment: {
      scopeKind: "bucket" as const,
      turnoverStateId: "turnover-state-1",
      turnoverStateHash: HASH_B,
      turnoverWindowOpenPortfolioNetWorthKrw: 1_000,
      priorBucketTurnoverNotionalKrw: 100,
      requestedBucketTurnoverNotionalKrw: 100,
      resultingBucketTurnoverRatio: 0.2
    },
    priorCumulativeFilledNotionalKrw: 0,
    priorCumulativeFilledQuantity: 0,
    requestedNotionalKrw: 100,
    requestedQuantity: 1,
    worstCaseFillNotionalKrw: 105,
    approvedMaximumFillNotionalKrw: 110,
    cashAssessment: {
      side: "BUY" as const,
      worstCaseNetCashDebitKrw: 106,
      approvedMaximumNetCashDebitKrw: 111
    },
    decision: "approved" as const,
    requiredRuleIds: ["turnover", "cash"],
    ruleResults: [
      { ruleId: "turnover", result: "pass" as const, reasonCode: "within_limit" },
      { ruleId: "cash", result: "pass" as const, reasonCode: "within_limit" }
    ],
    riskInputHash: HASH_C,
    riskEvidenceRefs: ["evidence-b", "evidence-a"],
    decidedAt: "2026-09-03T00:00:00.000Z"
  };
}
