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
      sharpeRatio: 0.7
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
    "$.expansion.coverage.advancedPerformance.sharpeRatio",
    "$.expansion.coverage.totalReturnRatio"
  ]);
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
