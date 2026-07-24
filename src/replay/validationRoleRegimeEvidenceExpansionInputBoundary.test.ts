import assert from "node:assert/strict";
import test from "node:test";

import {
  validateValidationRoleRegimeEvidenceExpansionInputBoundary,
  validationRoleRegimeEvidenceExpansionInputSchema
} from "./validationRoleRegimeEvidenceExpansionInputBoundary.js";

test("input boundary accepts only allowlisted paper research sources", () => {
  const input = allowedInput();
  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.input, input);
  assert.deepEqual(result.forbiddenPaths, []);
  assert.deepEqual(result.blockers, []);
});

test("input boundary rejects nested result and selection keys", () => {
  const input = allowedInput();
  input.expansion.snapshots = [
    {
      market: "KR",
      metrics: {
        sharpe: 2,
        selected_candidate_key: "candidate-1"
      }
    }
  ];
  input.baseline.planArtifact = {
    audit: {
      aiRationale: "result-aware source selection",
      PnL: 10
    }
  };

  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "invalid");
  assert.equal(result.input, null);
  assert.deepEqual(result.forbiddenPaths, [
    "$.baseline.planArtifact.audit.PnL",
    "$.baseline.planArtifact.audit.aiRationale",
    "$.expansion.snapshots[0].metrics.selected_candidate_key",
    "$.expansion.snapshots[0].metrics.sharpe"
  ]);
  assert.deepEqual(result.blockers, [
    {
      code: "RESULT_METRIC_INPUT_FORBIDDEN",
      message:
        "forbidden result input detected: $.baseline.planArtifact.audit.PnL, $.baseline.planArtifact.audit.aiRationale, $.expansion.snapshots[0].metrics.selected_candidate_key, $.expansion.snapshots[0].metrics.sharpe",
      splitRole: null,
      targetRegime: null
    }
  ]);
});

test("input boundary rejects forbidden result artifacts on the command surface", () => {
  const input = {
    ...allowedInput(),
    historicalReplayReport: { status: "completed" }
  };

  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.forbiddenPaths, ["$.historicalReplayReport"]);
  assert.equal(result.blockers[0]?.code, "RESULT_METRIC_INPUT_FORBIDDEN");
});

test("input boundary rejects compound replay performance metric keys", () => {
  const input = allowedInput();
  input.expansion.coverage = {
    totalReturnRatio: 0.1,
    advancedPerformance: {
      costAdjustedTotalReturnRatio: 0.08,
      finalVirtualNetWorthKrw: 1_100_000,
      maxDrawdownRatio: -0.2,
      profitFactor: 1.5,
      realizedPnlKrw: 50_000,
      sharpeRatio: 0.7,
      unrealizedPnlKrw: 20_000
    }
  };

  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.forbiddenPaths, [
    "$.expansion.coverage.advancedPerformance.costAdjustedTotalReturnRatio",
    "$.expansion.coverage.advancedPerformance.finalVirtualNetWorthKrw",
    "$.expansion.coverage.advancedPerformance.maxDrawdownRatio",
    "$.expansion.coverage.advancedPerformance.profitFactor",
    "$.expansion.coverage.advancedPerformance.realizedPnlKrw",
    "$.expansion.coverage.advancedPerformance.sharpeRatio",
    "$.expansion.coverage.advancedPerformance.unrealizedPnlKrw",
    "$.expansion.coverage.totalReturnRatio"
  ]);
  assert.equal(result.blockers[0]?.code, "RESULT_METRIC_INPUT_FORBIDDEN");
});

test("input boundary rejects batch aggregate result metric keys", () => {
  const input = allowedInput();
  const aggregateMetrics = {
    averageTotalReturnRatio: 0.1,
    medianTotalReturnRatio: 0.08,
    minTotalReturnRatio: -0.2,
    maxTotalReturnRatio: 0.3,
    winRate: 0.6,
    averageFinalVirtualNetWorthKrw: 1_100_000,
    selectedTrainAverageTotalReturnRatio: 0.12,
    selectedAverageTotalReturnRatio: 0.05,
    medianCandidateAverageTotalReturnRatio: 0.03,
    bestAverageTotalReturnRatio: 0.09,
    degradationFromTrainRatio: -0.07,
    selectedRank: 2,
    selectedBelowMedian: false,
    pboLikeScore: 0.4,
    pboProbability: 0.4,
    targetReturnHitRates: []
  };
  input.baseline.planArtifact = { aggregateMetrics };

  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "invalid");
  assert.deepEqual(
    result.forbiddenPaths,
    Object.keys(aggregateMetrics)
      .map((key) => `$.baseline.planArtifact.aggregateMetrics.${key}`)
      .sort()
  );
  assert.equal(result.blockers[0]?.code, "RESULT_METRIC_INPUT_FORBIDDEN");
});

test("input boundary rejects CPCV selection result fields", () => {
  const input = allowedInput();
  const selectionResult = {
    selectedTrainMetric: 0.12,
    selectedTestMetric: -0.04,
    testRankPercentile: 0.8,
    tieBreakApplied: true
  };
  input.baseline.readinessArtifact = { selectionResult };

  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "invalid");
  assert.deepEqual(
    result.forbiddenPaths,
    Object.keys(selectionResult)
      .map((key) => `$.baseline.readinessArtifact.selectionResult.${key}`)
      .sort()
  );
  assert.equal(result.blockers[0]?.code, "RESULT_METRIC_INPUT_FORBIDDEN");
});

test("input boundary rejects namespaced Sharpe validation results", () => {
  const input = allowedInput();
  const sharpeResults = {
    sampleSharpe: {},
    sampleSharpeStatus: "computed",
    sampleSharpeValue: 0.8,
    loAdjustedSharpe: {},
    loAdjustedSharpeStatus: "computed",
    probabilisticSharpeRatio: {},
    probabilisticSharpeRatioStatus: "computed",
    probabilisticSharpeRatioProbability: 0.7,
    deflatedSharpeRatio: {},
    deflatedSharpeRatioStatus: "computed",
    deflatedSharpeRatioProbability: 0.6,
    benchmarkSharpeRatio: 0,
    trialSharpeRatioStandardDeviation: 0.1
  };
  input.expansion.coverage = { sharpeResults };

  const result =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);

  assert.equal(result.status, "invalid");
  assert.deepEqual(
    result.forbiddenPaths,
    Object.keys(sharpeResults)
      .map((key) => `$.expansion.coverage.sharpeResults.${key}`)
      .sort()
  );
  assert.equal(result.blockers[0]?.code, "RESULT_METRIC_INPUT_FORBIDDEN");
});

test("input boundary keeps unknown non-result options fail-closed", () => {
  assert.throws(() =>
    validateValidationRoleRegimeEvidenceExpansionInputBoundary({
      ...allowedInput(),
      arbitrarySource: {}
    })
  );
});

test("input schema rejects every missing required source", () => {
  const result = validationRoleRegimeEvidenceExpansionInputSchema.safeParse({
    baseline: { feasibilityArtifact: undefined },
    expansion: { snapshots: undefined },
    calendarValidation: undefined
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path.join(".")).sort(),
    [
      "baseline.feasibilityArtifact",
      "baseline.planArtifact",
      "baseline.readinessArtifact",
      "baseline.validationSplitSource",
      "calendarValidation",
      "dependencyDiagnosticPolicy",
      "expansion.coverage",
      "expansion.snapshots",
      "expansion.universe",
      "expansion.validationSplitSource",
      "marketRegimeClassifier",
      "targetMatrix"
    ]
  );
});

test("input boundary does not classify result words found only in values", () => {
  const input = allowedInput();
  input.expansion.coverage = {
    warning: "Sharpe and return values are not available",
    averageReturnRatio: 0.01
  };

  assert.equal(
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input).status,
    "accepted"
  );
});

function allowedInput(): ReturnType<
  typeof validationRoleRegimeEvidenceExpansionInputSchema.parse
> {
  return {
    baseline: {
      feasibilityArtifact: { schemaVersion: "fixture" },
      planArtifact: { schemaVersion: "fixture" },
      readinessArtifact: { schemaVersion: "fixture" },
      validationSplitSource: { assignments: [] }
    },
    expansion: {
      snapshots: [],
      universe: { snapshotDate: "2026-07-24" },
      coverage: { status: "available" },
      validationSplitSource: { assignments: [] }
    },
    calendarValidation: { rules: [] },
    officialCalendarArtifact: undefined,
    marketRegimeClassifier: { version: "fixture" },
    targetMatrix: { byRole: {} },
    dependencyDiagnosticPolicy: { version: "fixture" }
  };
}
