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

test("portfolio action risk decision preserves rejected zero caps but cannot approve them", () => {
  const input = bucketInput();
  const zeroCaps = {
    ...input,
    approvedMaximumFillNotionalKrw: 0,
    cashAssessment: { ...input.cashAssessment, approvedMaximumNetCashDebitKrw: 0 }
  };
  const rejected = createPortfolioActionRiskDecision({
    ...zeroCaps,
    decision: "rejected",
    ruleResults: input.ruleResults.map((rule) => ({ ...rule, result: "fail" as const }))
  });
  assert.deepEqual(parsePortfolioActionRiskDecision(rejected), rejected);
  assert.throws(() => createPortfolioActionRiskDecision(zeroCaps), /fill notional cap/);
  assert.throws(() => createPortfolioActionRiskDecision({
    ...zeroCaps,
    approvedMaximumFillNotionalKrw: input.approvedMaximumFillNotionalKrw
  }), /net cash debit cap/);
  assert.throws(() => createPortfolioActionRiskDecision({
    ...zeroCaps,
    decision: "rejected",
    approvedMaximumFillNotionalKrw: -1
  }));
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
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        worstCaseFillNotionalKrw: 101
      }),
    /turnover contribution does not match/
  );
});

test("portfolio action risk decision rejects approved cap breaches", () => {
  const input = bucketInput();
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        approvedMaximumFillNotionalKrw: 99
      }),
    /exceeds fill notional cap/
  );
  assert.throws(
    () =>
      createPortfolioActionRiskDecision({
        ...input,
        cashAssessment: {
          side: "BUY",
          worstCaseNetCashDebitKrw: 106,
          approvedMaximumNetCashDebitKrw: 105
        }
      }),
    /exceeds net cash debit cap/
  );
});

test("portfolio action risk decision rejects tampered identity", () => {
  const decision = createPortfolioActionRiskDecision(bucketInput());
  assert.throws(
    () =>
      parsePortfolioActionRiskDecision({
        ...decision,
        riskInputHash: HASH_A
      }),
    /input hash mismatch/
  );
  assert.throws(
    () =>
      parsePortfolioActionRiskDecision({
        ...decision,
        approvedMaximumFillNotionalKrw: 109
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

test("portfolio action risk decision rejects lone surrogates at create and parse", () => {
  const input = bucketInput();
  const decision = createPortfolioActionRiskDecision(input);
  for (const invalid of ["\uD800", "\uD801", "\uDC00", "prefix\uD800suffix"]) {
    for (const patch of [
      { planId: invalid },
      { requiredRuleIds: [invalid, "cash"] },
      { ruleResults: [{ ruleId: invalid, result: "pass" as const, reasonCode: "ok" }] },
      { riskEvidenceRefs: [invalid, "evidence-a"] }
    ]) {
      assert.throws(
        () => createPortfolioActionRiskDecision({ ...input, ...patch }),
        /well-formed Unicode/
      );
      assert.throws(
        () => parsePortfolioActionRiskDecision({ ...decision, ...patch }),
        /well-formed Unicode/
      );
    }
  }
});

test("portfolio action risk decision canonicalizes valid supplementary Unicode", () => {
  const input = {
    ...bucketInput(),
    requiredRuleIds: ["rule-\u{1F600}", "rule-\u{1F601}"],
    ruleResults: [
      { ruleId: "rule-\u{1F600}", result: "pass" as const, reasonCode: "ok" },
      { ruleId: "rule-\u{1F601}", result: "pass" as const, reasonCode: "ok" }
    ],
    riskEvidenceRefs: ["ref-\u{1F600}", "ref-\u{1F601}"]
  };
  const decision = createPortfolioActionRiskDecision(input);
  assert.deepEqual(parsePortfolioActionRiskDecision(decision), decision);
  assert.deepEqual(createPortfolioActionRiskDecision({
    ...input,
    requiredRuleIds: [...input.requiredRuleIds].reverse(),
    ruleResults: [...input.ruleResults].reverse(),
    riskEvidenceRefs: [...input.riskEvidenceRefs].reverse()
  }), decision);
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
      requestedBucketTurnoverNotionalKrw: 105,
      resultingBucketTurnoverRatio: 0.205
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
    riskEvidenceRefs: ["evidence-b", "evidence-a"],
    decidedAt: "2026-09-03T00:00:00.000Z"
  };
}
