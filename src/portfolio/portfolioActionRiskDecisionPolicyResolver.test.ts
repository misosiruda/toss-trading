import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPolicy } from "./portfolioActionRiskDecisionPolicyResolver.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent, createPortfolioPolicyRetiredEvent } from "./runtimePortfolioPolicyActivation.js";

const CREATED_AT = "2026-09-01T00:00:00.000Z";
const DECIDED_AT = "2026-09-03T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
type DecisionInput = Parameters<typeof createPortfolioActionRiskDecision>[0];

test("risk policy resolver selects exact bucket rules and parameter lineage by side", async () => {
  for (const side of ["BUY", "SELL"] as const) {
    const fixture = policyFixture();
    await withDecision(fixture, decisionInput(fixture, side), async (input) => {
      const result = resolvePortfolioActionRiskDecisionPolicy(input);
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
    const result = resolvePortfolioActionRiskDecisionPolicy(input);
    assert.equal(result.bucketPolicy, null);
    assert.equal(result.riskRuleSet.hash, fixture.legacySet.hash);
    assert.deepEqual(result.applicableRules.map(({ rule }) => rule.ruleId), ["legacy"]);
  });
  await withDecision(fixture, { ...candidate, riskRuleScope: { scopeKind: "legacy_reduce_only", legacyPolicyHash: HASH } }, async (input) => {
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy(input), /legacy reduce-only policy mismatch/);
  });
});

test("risk policy resolver rejects a claimed rule set or policy that differs from activation", async () => {
  const fixture = policyFixture();
  for (const overrides of [
    { policyHash: HASH }, { riskRuleSetRecordId: "unrelated" },
    { riskRuleSetVersion: "other" }, { riskRuleSetHash: HASH },
    { market: "US" as const, symbol: "US:AAPL" },
    { riskRuleSetRecordId: fixture.legacySet.riskRuleSetRecordId, riskRuleSetVersion: fixture.legacySet.version, riskRuleSetHash: fixture.legacySet.hash }
  ]) {
    await withDecision(fixture, { ...decisionInput(fixture, "BUY"), ...overrides }, async (input) => {
      assert.throws(() => resolvePortfolioActionRiskDecisionPolicy(input), /mismatch/);
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
      assert.throws(() => resolvePortfolioActionRiskDecisionPolicy(input), /policy-selected side rules/);
    });
  }
});

test("risk policy resolver replays activation at decision time and rejects missing or retired policy", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy({ ...input, activationEvents: [] }), /active runtime portfolio policy is required/);
    const retired = createPortfolioPolicyRetiredEvent({
      portfolioId: fixture.policy.portfolioId, activationSequence: 2,
      retiredActivationId: fixture.activation.activationId, reasonCode: "fixture",
      createdAt: "2026-09-02T00:00:00.000Z"
    });
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy({ ...input, activationEvents: [fixture.activation, retired] }), /active runtime portfolio policy is required/);
    const later = createPortfolioPolicyRetiredEvent({
      portfolioId: fixture.policy.portfolioId, activationSequence: 2,
      retiredActivationId: fixture.activation.activationId, reasonCode: "fixture",
      createdAt: "2026-09-04T00:00:00.000Z"
    });
    assert.equal(resolvePortfolioActionRiskDecisionPolicy({ ...input, activationEvents: [fixture.activation, later] }).activePolicy.activation.activationId, fixture.activation.activationId);
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy({ ...input, activationEvents: [{ ...fixture.activation, activationEventHash: HASH }] }), /hash mismatch/);
  });
});

test("risk policy resolver rejects fabricated histories and incomplete parameter dependencies", async () => {
  const fixture = policyFixture();
  await withDecision(fixture, decisionInput(fixture, "BUY"), async (input) => {
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionHistory: { records: input.riskDecisionHistory.records } }), /not verified/);
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy({ ...input, riskDecisionId: "missing" }), /does not resolve exactly once/);
    const dependencies = new ImmutablePolicyDependencyRepository({ ...fixture.records, riskParameters: [] });
    assert.throws(() => resolvePortfolioActionRiskDecisionPolicy({ ...input, dependencies }), /risk parameter ref does not resolve/);
  });
});

test("risk policy resolver can explain a rejected record without promoting it to approval", async () => {
  const fixture = policyFixture();
  const candidate = decisionInput(fixture, "BUY");
  await withDecision(fixture, { ...candidate, decision: "rejected", ruleResults: candidate.ruleResults.map((rule) => ({ ...rule, result: "fail" })) }, async (input) => {
    assert.equal(resolvePortfolioActionRiskDecisionPolicy(input).decision.decision, "rejected");
  });
});

async function withDecision(
  fixture: ReturnType<typeof policyFixture>, candidate: DecisionInput,
  run: (input: Parameters<typeof resolvePortfolioActionRiskDecisionPolicy>[0]) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-"));
  try {
    const repository = new PortfolioActionRiskDecisionFileRepository(directory);
    const decision = createPortfolioActionRiskDecision(candidate);
    await repository.append(decision);
    await run({ riskDecisionId: decision.riskDecisionId, riskDecisionHistory: await repository.readVerifiedHistory(),
      activationEvents: [fixture.activation], policies: [fixture.policy], dependencies: fixture.dependencies });
  } finally { await rm(directory, { recursive: true, force: true }); }
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

function policyFixture() {
  const buckets = ["long_term", "swing", "short_term", "intraday", "hedge"] as const;
  const parameters = ["cash", "exposure", "sell", "legacy"].map((ruleId) => createPortfolioRiskRuleParameterRecord({
    ruleId, ruleVersion: "v1", version: "v1", parameters: { fixtureLimit: 1 }, createdAt: CREATED_AT
  }));
  const rule = (index: number, appliesTo: Array<"BUY" | "SELL">) => ({
    ruleId: parameters[index]!.ruleId, ruleVersion: "v1", appliesTo, parameterRef: riskRuleParameterRefFor(parameters[index]!)
  });
  const bucketSet = createPortfolioRiskRuleSetRecord({ version: "bucket.v1", rules: [rule(0, ["BUY"]), rule(1, ["BUY", "SELL"]), rule(2, ["SELL"])], createdAt: CREATED_AT });
  // The shared rule-set contract covers both sides; legacy scope only uses SELL.
  const legacySet = createPortfolioRiskRuleSetRecord({ version: "legacy.v1", rules: [rule(0, ["BUY"]), rule(3, ["SELL"])], createdAt: CREATED_AT });
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
  const records: ImmutablePolicyDependencyRecords = { selectionPolicies: selections, riskParameters: parameters, riskRuleSets: [bucketSet, legacySet],
    drawdownSemantics: [drawdown], sessionCalendars: [calendar], scheduleBoundaries: [boundary] };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const targets = [0.35, 0.2, 0.15, 0.1, 0.05];
  const payload = {
    mode: "paper_only", recordType: "runtime_portfolio_policy_record", portfolioId: "paper-main",
    sourcePolicyRecordId: "fixture-source", sourcePolicyRecordHash: HASH, sourcePolicyHash: "b".repeat(64),
    policyId: "fixture", version: "v1", name: "Fixture policy",
    strategyBuckets: buckets.map((bucket, index) => ({
      bucket, targetWeightRatio: targets[index]!, minWeightRatio: 0, maxWeightRatio: 0.5, maxTurnoverRatio: 0.5, maxDrawdownRatio: 0.1,
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
