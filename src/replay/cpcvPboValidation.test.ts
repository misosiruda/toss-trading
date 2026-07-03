import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCombinatorialPurgedCvPlan,
  type CpcvSplitPlan
} from "./combinatorialPurgedCv.js";
import {
  calculateCpcvPboValidationReport,
  cpcvPboValidationReportSchema,
  type CpcvCandidatePerformanceRow,
  type CpcvPboValidationConfig
} from "./cpcvPboValidation.js";
import type { PurgedKFoldSample } from "./purgedSplit.js";

test("CPCV PBO calculator computes selection log and below-median probability", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo",
    foldCount: 3,
    testFoldCount: 1,
    maxCombinationCount: 3,
    samples: sequentialSamples(6)
  });
  const [c1, c2, c3] = plan.combinations.map(
    (combination) => combination.combinationId
  );
  const report = calculateCpcvPboValidationReport({
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: configFromPlan(plan),
    splitPlan: plan,
    performanceMatrix: [
      row("candidate-a", [
        metric(c1!, 0.2, 0.01),
        metric(c2!, 0.1, 0.3),
        metric(c3!, 0.2, 0.09)
      ]),
      row("candidate-b", [
        metric(c1!, 0.2, 0.2),
        metric(c2!, 0.3, 0.1),
        metric(c3!, 0.1, 0.06)
      ]),
      row("candidate-c", [
        metric(c1!, 0.1, 0.1),
        metric(c2!, 0.2, 0.2),
        metric(c3!, 0, 0.04)
      ])
    ]
  });

  assert.equal(cpcvPboValidationReportSchema.safeParse(report).success, true);
  assert.equal(report.schemaVersion, "cpcv_pbo_validation.v1");
  assert.equal(report.status, "available");
  assert.equal(report.splitPlan?.emittedCombinationCount, 3);
  assert.deepEqual(
    report.selectionLog.map((entry) => [
      entry.combinationId,
      entry.selectedCandidateKey,
      entry.testRankPercentile,
      entry.tieBreakApplied
    ]),
    [
      [c1, "candidate-a", 0.166667, true],
      [c2, "candidate-b", 0.166667, false],
      [c3, "candidate-a", 0.833333, false]
    ]
  );
  assert.equal(report.pbo.status, "computed");
  assert.equal(report.pbo.probability, 0.666667);
  assert.equal(report.pbo.evaluatedCombinationCount, 3);
  assert.equal(report.pbo.selectedBelowMedianCount, 2);
  assert.deepEqual(report.pbo.lambdaLogitValues, [
    -1.609436,
    -1.609436,
    1.609436
  ]);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["PBO_SELECTION_TIE_BREAK_APPLIED"]
  );
});

test("CPCV PBO calculator records sampled split plans as sampled reports", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo_sampled",
    foldCount: 5,
    testFoldCount: 2,
    maxCombinationCount: 2,
    combinationMode: "sampled",
    randomSeed: "pbo-sampled",
    samples: sequentialSamples(10)
  });
  const report = calculateCpcvPboValidationReport({
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: configFromPlan(plan),
    splitPlan: plan,
    performanceMatrix: [
      row(
        "candidate-a",
        plan.combinations.map((combination, index) =>
          metric(combination.combinationId, 0.2 - index * 0.01, 0.01)
        )
      ),
      row(
        "candidate-b",
        plan.combinations.map((combination, index) =>
          metric(combination.combinationId, 0.1 + index * 0.01, 0.02)
        )
      )
    ]
  });

  assert.equal(report.status, "sampled");
  assert.equal(report.splitPlan?.requestedCombinationCount, 10);
  assert.equal(report.splitPlan?.emittedCombinationCount, 2);
  assert.equal(report.splitPlan?.skippedCombinationCount, 8);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["CPCV_SAMPLED_MODE_USED"]
  );
});

test("CPCV PBO calculator uses mid-ranks for tied test metrics", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo_tied_test",
    foldCount: 2,
    testFoldCount: 1,
    maxCombinationCount: 2,
    samples: sequentialSamples(4)
  });
  const [c1, c2] = plan.combinations.map(
    (combination) => combination.combinationId
  );
  const report = calculateCpcvPboValidationReport({
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: configFromPlan(plan),
    splitPlan: plan,
    performanceMatrix: [
      row("candidate-a", [
        metric(c1!, 0.2, 0.1),
        metric(c2!, 0.1, 0.1)
      ]),
      row("candidate-b", [
        metric(c1!, 0.1, 0.1),
        metric(c2!, 0.2, 0.1)
      ])
    ]
  });

  assert.deepEqual(
    report.selectionLog.map((entry) => [
      entry.selectedCandidateKey,
      entry.selectedTestMetric,
      entry.testRankPercentile
    ]),
    [
      ["candidate-a", 0.1, 0.5],
      ["candidate-b", 0.1, 0.5]
    ]
  );
  assert.equal(report.pbo.status, "computed");
  assert.equal(report.pbo.probability, 1);
  assert.deepEqual(report.pbo.lambdaLogitValues, [0, 0]);
});

test("CPCV PBO calculator fails closed for partially scored holdout matrix", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo_partial_holdout",
    foldCount: 3,
    testFoldCount: 1,
    maxCombinationCount: 3,
    samples: sequentialSamples(6)
  });
  const [c1, c2, c3] = plan.combinations.map(
    (combination) => combination.combinationId
  );
  const report = calculateCpcvPboValidationReport({
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: configFromPlan(plan),
    splitPlan: plan,
    performanceMatrix: [
      row("candidate-a", [
        metric(c1!, 0.3, 0.1),
        metric(c2!, 0.3, 0.2),
        metric(c3!, 0.3, null)
      ]),
      row("candidate-b", [
        metric(c1!, 0.2, 0.2),
        metric(c2!, 0.2, 0.1),
        metric(c3!, 0.2, 0.1)
      ])
    ]
  });

  assert.equal(cpcvPboValidationReportSchema.safeParse(report).success, true);
  assert.equal(report.status, "unavailable");
  assert.equal(report.pbo.status, "insufficient_matrix");
  assert.equal(report.pbo.probability, null);
  assert.equal(report.pbo.evaluatedCombinationCount, 2);
  assert.deepEqual(
    report.selectionLog.map((entry) => [
      entry.selectedCandidateKey,
      entry.selectedTestMetric,
      entry.testRankPercentile
    ]),
    [
      ["candidate-a", 0.1, 0.25],
      ["candidate-a", 0.2, 0.75],
      ["candidate-a", null, null]
    ]
  );
  assert.deepEqual(report.pbo.lambdaLogitValues, []);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["PBO_HOLDOUT_MATRIX_INSUFFICIENT"]
  );
});

test("CPCV PBO calculator requires holdout metrics for train competitors", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo_train_competitor_holdout",
    foldCount: 2,
    testFoldCount: 1,
    maxCombinationCount: 2,
    samples: sequentialSamples(4)
  });
  const [c1, c2] = plan.combinations.map(
    (combination) => combination.combinationId
  );
  const report = calculateCpcvPboValidationReport({
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: configFromPlan(plan),
    splitPlan: plan,
    performanceMatrix: [
      row("candidate-a", [
        metric(c1!, 0.3, 0.1),
        metric(c2!, 0.3, 0.1)
      ]),
      row("candidate-b", [
        metric(c1!, 0.2, null),
        metric(c2!, 0.2, 0.2)
      ]),
      row("candidate-c", [
        metric(c1!, null, 0.3),
        metric(c2!, null, 0.3)
      ])
    ]
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.pbo.status, "insufficient_matrix");
  assert.equal(report.pbo.probability, null);
  assert.equal(report.pbo.evaluatedCombinationCount, 1);
  assert.deepEqual(
    report.selectionLog.map((entry) => [
      entry.selectedCandidateKey,
      entry.selectedTestMetric,
      entry.testRankPercentile
    ]),
    [
      ["candidate-a", 0.1, null],
      ["candidate-a", 0.1, 0.25]
    ]
  );
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["PBO_HOLDOUT_MATRIX_INSUFFICIENT"]
  );
});

test("CPCV PBO calculator fails closed without train-side competition", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo_insufficient",
    foldCount: 3,
    testFoldCount: 1,
    maxCombinationCount: 3,
    samples: sequentialSamples(6)
  });
  const report = calculateCpcvPboValidationReport({
    generatedAt: "2026-07-03T00:00:00.000Z",
    config: configFromPlan(plan),
    splitPlan: plan,
    performanceMatrix: [
      row(
        "candidate-a",
        plan.combinations.map((combination) =>
          metric(combination.combinationId, 0.2, 0.1)
        )
      ),
      row(
        "candidate-b",
        plan.combinations.map((combination) =>
          metric(combination.combinationId, null, 0.2)
        )
      )
    ]
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.pbo.status, "insufficient_matrix");
  assert.equal(report.pbo.probability, null);
  assert.equal(report.pbo.evaluatedCombinationCount, 0);
  assert.equal(
    report.selectionLog.every((entry) => entry.selectedCandidateKey === null),
    true
  );
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    [
      "PBO_CANDIDATE_COUNT_INSUFFICIENT",
      "PBO_HOLDOUT_MATRIX_INSUFFICIENT"
    ]
  );
});

test("CPCV PBO calculator rejects config and split plan mismatches", () => {
  const plan = buildCombinatorialPurgedCvPlan({
    planId: "pbo_mismatch",
    foldCount: 3,
    testFoldCount: 1,
    maxCombinationCount: 3,
    samples: sequentialSamples(6)
  });

  assert.throws(
    () =>
      calculateCpcvPboValidationReport({
        generatedAt: "2026-07-03T00:00:00.000Z",
        config: {
          ...configFromPlan(plan),
          foldCount: 4
        },
        splitPlan: plan,
        performanceMatrix: []
      }),
    /does not match splitPlan: foldCount/
  );
});

function configFromPlan(plan: CpcvSplitPlan): CpcvPboValidationConfig {
  return {
    validationProtocol: plan.validationProtocol,
    foldCount: plan.foldCount,
    testFoldCount: plan.testFoldCount,
    purgeDurationDays: plan.purgeDurationDays,
    embargoDurationDays: plan.embargoDurationDays,
    selectionMetric: "total_return_ratio",
    tieBreaker: "candidate_key_asc",
    maxCombinationCount: plan.maxCombinationCount,
    combinationMode: plan.combinationMode,
    randomSeed: plan.randomSeed
  };
}

function row(
  candidateKey: string,
  splitMetrics: CpcvCandidatePerformanceRow["splitMetrics"]
): CpcvCandidatePerformanceRow {
  return {
    candidateKey,
    promptHash: null,
    configHash: null,
    riskPolicyHash: null,
    exitPolicyHash: null,
    splitMetrics
  };
}

function metric(
  combinationId: string,
  trainMetric: number | null,
  testMetric: number | null
): CpcvCandidatePerformanceRow["splitMetrics"][number] {
  return {
    combinationId,
    trainMetric,
    testMetric,
    trainReturnSampleCount: trainMetric === null ? 0 : 1,
    testReturnSampleCount: testMetric === null ? 0 : 1
  };
}

function sequentialSamples(count: number): PurgedKFoldSample[] {
  return Array.from({ length: count }, (_, index) => {
    const labelStart = new Date(
      Date.UTC(2025, 0, index + 1, 0, 0, 0, 0)
    ).toISOString();
    const labelEnd = new Date(
      Date.UTC(2025, 0, index + 1, 23, 59, 59, 999)
    ).toISOString();

    return {
      sampleId: `s${index + 1}`,
      labelStart,
      labelEnd
    };
  });
}
