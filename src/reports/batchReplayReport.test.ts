import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketRegimeClassification,
  MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
import type { ValidationSplitRole } from "../replay/validationProtocol.js";
import type { SelectionTrialRecord } from "../replay/selectionTrialLog.js";
import type { BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";
import {
  buildBatchReplayAggregateReport,
  renderBatchReplayAggregateReport
} from "./batchReplayReport.js";

test("batch replay aggregate report summarizes overall and regime returns", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    sourceRunsPath: "data/batch/batch-replay-runs.jsonl",
    records: [
      record("run_0", 0, "completed", "bull", 0.05, 1_050_000),
      record("run_1", 1, "completed", "bull", -0.01, 990_000),
      record("run_2", 2, "completed", "bear", 0.02, 1_020_000),
      record("run_3", 3, "skipped", "insufficient_data", null, null),
      record("run_4", 4, "failed", "mixed", null, null)
    ]
  });

  assert.equal(report.mode, "paper_only");
  assert.equal(report.sourceRunsPath, "data/batch/batch-replay-runs.jsonl");
  assert.equal(report.summary.runCount, 5);
  assert.equal(report.summary.completedCount, 3);
  assert.equal(report.summary.skippedCount, 1);
  assert.equal(report.summary.failedCount, 1);
  assert.equal(report.summary.returnSampleCount, 3);
  assert.deepEqual(report.targetReturnThresholds, [0.15, 0.3]);
  assert.deepEqual(report.summary.regimeCounts, {
    bull: 2,
    bear: 1,
    insufficient_data: 1,
    mixed: 1
  });
  assert.deepEqual(report.summary.regimeCountsByMarket, {
    KR: {
      bull: 2,
      bear: 1,
      insufficient_data: 1,
      mixed: 1
    }
  });
  assert.deepEqual(report.summary.validationSplitRoleCounts, {});
  assert.equal(report.overall.averageTotalReturnRatio, 0.02);
  assert.equal(report.overall.medianTotalReturnRatio, 0.02);
  assert.equal(report.overall.winRate, 0.666667);
  assert.equal(report.overall.averageExposureRatio, 0.2);
  assert.equal(report.overall.averageCashRatio, 0.8);
  assert.equal(report.overall.averageTimeInMarketRatio, 1);
  assert.equal(report.overall.averageTargetExposureRatio, 0.85);
  assert.equal(report.overall.averageTargetExposureGapRatio, 0.65);
  assert.equal(report.overall.averageFinalTargetExposureGapRatio, 0.65);
  assert.deepEqual(report.overall.averageFinalExposureByMarketKrw, {
    KR: 100_000,
    US: 100_000
  });
  assert.deepEqual(report.overall.averageFinalExposureByAssetTypeKrw, {
    ETF: 100_000,
    STOCK: 100_000
  });
  assert.equal(report.overall.totalAiDecisionFailureCount, 0);
  assert.equal(report.overall.totalMeaningfulRejectCount, 0);
  assert.equal(report.overall.totalDustRejectCount, 0);
  assert.deepEqual(report.overall.targetReturnHitRates, [
    {
      threshold: 0.15,
      sampleCount: 3,
      hitCount: 0,
      hitRate: 0,
      runIds: []
    },
    {
      threshold: 0.3,
      sampleCount: 3,
      hitCount: 0,
      hitRate: 0,
      runIds: []
    }
  ]);
  assert.equal(report.byRegime.bull?.completedCount, 2);
  assert.equal(report.byRegime.bull?.averageTotalReturnRatio, 0.02);
  assert.equal(report.byRegime.bear?.averageTotalReturnRatio, 0.02);
  assert.equal(report.byRegime.insufficient_data?.returnSampleCount, 0);
});

test("batch replay aggregate report groups results by validation split role", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [
      record(
        "run_train",
        0,
        "completed",
        "bull",
        0.03,
        1_030_000,
        0,
        "train"
      ),
      record(
        "run_validation",
        1,
        "completed",
        "bear",
        -0.02,
        980_000,
        0,
        "validation"
      ),
      record("run_legacy", 2, "completed", "mixed", 0.01, 1_010_000)
    ]
  });

  assert.deepEqual(report.summary.validationSplitRoleCounts, {
    train: 1,
    validation: 1
  });
  assert.equal(report.byValidationSplitRole.train?.runCount, 1);
  assert.equal(
    report.byValidationSplitRole.train?.averageTotalReturnRatio,
    0.03
  );
  assert.equal(report.byValidationSplitRole.validation?.runIds[0], "run_validation");
  assert.equal(report.byValidationSplitRole.test, undefined);
  assert.match(
    renderBatchReplayAggregateReport(report),
    /validation_split_role_counts/
  );
  assert.match(renderBatchReplayAggregateReport(report), /By Validation Split Role/);
});

test("batch replay aggregate report calculates target return hit rates", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    targetReturnThresholds: [0.05, 0.02],
    records: [
      record("run_0", 0, "completed", "bull", 0.05, 1_050_000),
      record("run_1", 1, "completed", "bear", 0.02, 1_020_000),
      record("run_2", 2, "completed", "sideways", -0.01, 990_000),
      record("run_3", 3, "skipped", "insufficient_data", null, null)
    ]
  });

  assert.deepEqual(report.targetReturnThresholds, [0.02, 0.05]);
  assert.deepEqual(report.overall.targetReturnHitRates, [
    {
      threshold: 0.02,
      sampleCount: 3,
      hitCount: 2,
      hitRate: 0.666667,
      runIds: ["run_0", "run_1"]
    },
    {
      threshold: 0.05,
      sampleCount: 3,
      hitCount: 1,
      hitRate: 0.333333,
      runIds: ["run_0"]
    }
  ]);
  assert.deepEqual(report.byRegime.bull?.targetReturnHitRates[0], {
    threshold: 0.02,
    sampleCount: 1,
    hitCount: 1,
    hitRate: 1,
    runIds: ["run_0"]
  });
});

test("batch replay aggregate report counts AI decision failures separately from failed runs", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [
      record("run_0", 0, "completed", "bull", 0.05, 1_050_000, 2),
      record("run_1", 1, "completed", "bull", 0.02, 1_020_000, 1),
      record("run_2", 2, "failed", "bull", null, null, 0)
    ]
  });

  assert.equal(report.summary.failedCount, 1);
  assert.equal(report.overall.completedCount, 2);
  assert.equal(report.overall.failedCount, 1);
  assert.equal(report.overall.totalAiDecisionFailureCount, 3);
  assert.equal(report.byRegime.bull?.totalAiDecisionFailureCount, 3);
});

test("batch replay aggregate report summarizes selection trial distribution", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    sourceSelectionTrialsPath:
      "data/batch/batch-replay-selection-trials.jsonl",
    records: [
      record("run_0", 0, "completed", "bull", 0.05, 1_050_000),
      record("run_1", 1, "completed_with_failures", "bull", 0.01, 1_010_000, 1),
      record("run_2", 2, "skipped", "insufficient_data", null, null),
      record("run_3", 3, "failed", "mixed", null, null)
    ],
    selectionTrials: [
      trial("run_0", 0, "completed", hash("a"), hash("b"), 1, 0, 0),
      trial(
        "run_1",
        1,
        "completed_with_failures",
        hash("a"),
        hash("c"),
        0,
        1,
        2
      ),
      trial("run_2", 2, "skipped", null, null, 0, 0, 0),
      trial("run_3", 3, "failed", hash("d"), hash("e"), 0, 0, 0)
    ]
  });

  assert.equal(
    report.sourceSelectionTrialsPath,
    "data/batch/batch-replay-selection-trials.jsonl"
  );
  assert.equal(report.trialSummary?.trialCount, 4);
  assert.equal(report.trialSummary?.selectedCount, 0);
  assert.equal(report.trialSummary?.unselectedCount, 4);
  assert.deepEqual(report.trialSummary?.statusCounts, {
    completed: 1,
    completed_with_failures: 1,
    skipped: 1,
    failed: 1
  });
  assert.equal(report.trialSummary?.aiDecisionFailureTrialCount, 1);
  assert.equal(report.trialSummary?.rejectedTrialCount, 1);
  assert.equal(report.trialSummary?.noTradeTrialCount, 3);
  assert.deepEqual(report.trialSummary?.promptHashes[0], {
    key: hash("a"),
    count: 2,
    runIds: ["run_0", "run_1"]
  });
  assert.deepEqual(report.trialSummary?.configHashes.at(-1), {
    key: null,
    count: 1,
    runIds: ["run_2"]
  });
  assert.deepEqual(report.trialSummary?.runIds, [
    "run_0",
    "run_1",
    "run_2",
    "run_3"
  ]);
  assert.match(
    renderBatchReplayAggregateReport(report),
    /source_selection_trials_path/
  );
  assert.match(renderBatchReplayAggregateReport(report), /prompt_hashes/);
});

test("batch replay aggregate report records sampled CPCV PBO-like diagnostics", () => {
  const promptHash = hash("a");
  const candidateAAllocationPolicyHash = hash("candidate_a_allocation_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_allocation_policy");
  const candidateAConfigHashes = {
    train: hash("candidate_a_train_config"),
    validation: hash("candidate_a_validation_config"),
    test: hash("candidate_a_test_config")
  };
  const candidateBConfigHashes = {
    train: hash("candidate_b_train_config"),
    validation: hash("candidate_b_validation_config"),
    test: hash("candidate_b_test_config")
  };
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 3,
    records: [
      record("candidate_a_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train"),
      record("candidate_b_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train"),
      record(
        "candidate_a_validation",
        2,
        "completed",
        "bull",
        -0.05,
        950_000,
        0,
        "validation"
      ),
      record(
        "candidate_b_validation",
        3,
        "completed",
        "bull",
        0.04,
        1_040_000,
        0,
        "validation"
      ),
      record("candidate_a_test", 4, "completed", "bull", -0.02, 980_000, 0, "test"),
      record("candidate_b_test", 5, "completed", "bull", 0.03, 1_030_000, 0, "test")
    ],
    selectionTrials: [
      trial(
        "candidate_a_train",
        0,
        "completed",
        promptHash,
        candidateAConfigHashes.train,
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_train",
        1,
        "completed",
        promptHash,
        candidateBConfigHashes.train,
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_validation",
        2,
        "completed",
        promptHash,
        candidateAConfigHashes.validation,
        1,
        0,
        0,
        -0.05,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_validation",
        3,
        "completed",
        promptHash,
        candidateBConfigHashes.validation,
        1,
        0,
        0,
        0.04,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_test",
        4,
        "completed",
        promptHash,
        candidateAConfigHashes.test,
        1,
        0,
        0,
        -0.02,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_test",
        5,
        "completed",
        promptHash,
        candidateBConfigHashes.test,
        1,
        0,
        0,
        0.03,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;
  const selectedRow = diagnostics.splitMetricMatrix.find(
    (row) => row.allocationPolicyHash === candidateAAllocationPolicyHash
  )!;

  assert.equal(diagnostics.validationProtocol, "sampled_cpcv_pbo_like");
  assert.equal(diagnostics.expectedSampledCpcvSplitCount, 3);
  assert.equal(diagnostics.sampledCpcvSplitCount, 3);
  assert.equal(diagnostics.sampledCpcvSplitCountMatchesExpected, true);
  assert.equal(diagnostics.candidateCount, 2);
  assert.deepEqual(diagnostics.splitRoleCounts, {
    train: 2,
    validation: 2,
    test: 2
  });
  assert.equal(diagnostics.selectedCandidateKey, selectedRow.candidateKey);
  assert.deepEqual(new Set(selectedRow.configHashes), new Set([
    candidateAConfigHashes.train,
    candidateAConfigHashes.validation,
    candidateAConfigHashes.test
  ]));
  assert.equal(diagnostics.selectedTrainAverageTotalReturnRatio, 0.2);
  assert.equal(selectedRow.roleMetrics.train?.averageTotalReturnRatio, 0.2);
  assert.equal(selectedRow.roleMetrics.validation?.averageTotalReturnRatio, -0.05);
  assert.equal(diagnostics.pboLikeScore, 1);
  assert.deepEqual(
    diagnostics.holdoutDegradation.map((entry) => [
      entry.splitRole,
      entry.selectedBelowMedian,
      entry.degradationFromTrainRatio
    ]),
    [
      ["validation", true, -0.25],
      ["test", true, -0.22]
    ]
  );
  assert.deepEqual(diagnostics.warnings, []);
  assert.match(renderBatchReplayAggregateReport(report), /pbo_like_score: 1/);
  assert.match(renderBatchReplayAggregateReport(report), /split_metric_matrix/);
});

test("batch replay aggregate report warns when PBO-like samples are insufficient", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 2,
    records: [
      record("candidate_a_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train")
    ],
    selectionTrials: [
      trial(
        "candidate_a_train",
        0,
        "completed",
        hash("a"),
        hash("b"),
        1,
        0,
        0,
        0.2
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;

  assert.equal(diagnostics.candidateCount, 1);
  assert.equal(diagnostics.sampledCpcvSplitCount, 1);
  assert.equal(diagnostics.sampledCpcvSplitCountMatchesExpected, false);
  assert.equal(diagnostics.pboLikeScore, null);
  assert.match(
    diagnostics.warnings.join("\n"),
    /at least two strategy candidates/
  );
  assert.match(diagnostics.warnings.join("\n"), /no validation\/test holdout/);
  assert.match(diagnostics.warnings.join("\n"), /split count mismatch/);
});

test("batch replay aggregate report leaves single-candidate holdouts unscored", () => {
  const promptHash = hash("a");
  const candidateAAllocationPolicyHash = hash("candidate_a_allocation_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_allocation_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 2,
    records: [
      record("candidate_a_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train"),
      record("candidate_b_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train"),
      record(
        "candidate_a_validation",
        2,
        "completed",
        "bull",
        0.03,
        1_030_000,
        0,
        "validation"
      ),
      record(
        "candidate_b_validation",
        3,
        "skipped",
        "bull",
        0,
        null,
        0,
        "validation"
      )
    ],
    selectionTrials: [
      trial(
        "candidate_a_train",
        0,
        "completed",
        promptHash,
        hash("candidate_a_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_train",
        1,
        "completed",
        promptHash,
        hash("candidate_b_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_validation",
        2,
        "completed",
        promptHash,
        hash("candidate_a_validation_config"),
        1,
        0,
        0,
        0.03,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_validation",
        3,
        "skipped",
        promptHash,
        hash("candidate_b_validation_config"),
        0,
        0,
        0,
        null,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;
  const validationDegradation = diagnostics.holdoutDegradation.find(
    (entry) => entry.splitRole === "validation"
  )!;

  assert.equal(validationDegradation.candidateCount, 1);
  assert.equal(validationDegradation.selectedBelowMedian, null);
  assert.equal(diagnostics.pboLikeScore, null);
  assert.match(
    diagnostics.warnings.join("\n"),
    /at least two holdout candidates with return samples/
  );
});

test("batch replay aggregate report handles legacy records without market counts", () => {
  const legacyRecord = record(
    "legacy_run_0",
    0,
    "completed",
    "bull",
    0.01,
    1_010_000
  ) as Partial<BatchReplayRunRecord>;
  delete legacyRecord.marketRegimesByMarket;

  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [legacyRecord as BatchReplayRunRecord]
  });

  assert.deepEqual(report.summary.regimeCounts, { bull: 1 });
  assert.deepEqual(report.summary.regimeCountsByMarket, {});
});

test("batch replay aggregate report renders paper-only disclaimer", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [record("run_0", 0, "completed", "sideways", 0, 1_000_000)]
  });
  const rendered = renderBatchReplayAggregateReport(report);

  assert.match(rendered, /Batch Replay Paper Aggregate Report/);
  assert.match(rendered, /paper-only/);
  assert.match(rendered, /target_return_hit_rates/);
  assert.match(rendered, /regime_counts_by_market/);
  assert.match(rendered, /total_ai_decision_failure_count/);
  assert.doesNotMatch(rendered, /live order/i);
});

test("batch replay aggregate report excludes unavailable returns from performance samples", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [
      record("run_0", 0, "completed", "bull", null, 1_000_000),
      record("run_1", 1, "completed", "bull", 0.03, 1_030_000),
      record("run_2", 2, "skipped", "bear", null, null),
      record("run_3", 3, "failed", "mixed", null, null)
    ]
  });

  assert.equal(report.summary.runCount, 4);
  assert.equal(report.summary.completedCount, 2);
  assert.equal(report.summary.returnSampleCount, 1);
  assert.equal(report.overall.returnSampleCount, 1);
  assert.equal(report.overall.averageTotalReturnRatio, 0.03);
  assert.equal(report.overall.winRate, 1);
  assert.equal(report.overall.averageFinalVirtualNetWorthKrw, 1_015_000);
  assert.equal(report.byRegime.bull?.completedCount, 2);
  assert.equal(report.byRegime.bull?.returnSampleCount, 1);
  assert.equal(report.byRegime.bear?.returnSampleCount, 0);
  assert.equal(report.byRegime.bear?.averageTotalReturnRatio, null);
  assert.equal(report.byRegime.mixed?.failedCount, 1);
});

function record(
  runId: string,
  runIndex: number,
  status: BatchReplayRunRecord["status"],
  regime: MarketRegimeLabel,
  totalReturnRatio: number | null,
  finalVirtualNetWorthKrw: number | null,
  aiDecisionFailureCount = 0,
  validationSplitRole: ValidationSplitRole | null = null
): BatchReplayRunRecord {
  return {
    mode: "paper_only",
    batchId: "batch-test",
    runId,
    runIndex,
    runSeed: `seed:${runIndex}`,
    status,
    startedAt: "2026-06-12T01:00:00.000Z",
    completedAt: status === "completed" ? "2026-06-12T01:00:01.000Z" : null,
    skippedAt: status === "skipped" ? "2026-06-12T01:00:01.000Z" : null,
    failedAt: status === "failed" ? "2026-06-12T01:00:01.000Z" : null,
    storageBaseDir: `data/batch/${runId}`,
    window: {
      seed: `seed:${runIndex}`,
      rangeStart: "2025-01-01T00:00:00.000Z",
      rangeEnd: "2025-12-31T23:59:59.999Z",
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      candidateCount: 12,
      selectedCandidateIndex: runIndex,
      selectedMonth: "2025-01",
      localStartDate: "2025-01-01",
      localEndDate: "2025-01-31",
      startAt: "2024-12-31T15:00:00.000Z",
      endAt: "2025-01-31T14:59:59.999Z"
    },
    windowSampling: {
      mode: "random",
      targetRegime: null,
      targetCandidateCount: null,
      fallbackReason: null
    },
    validationSplit:
      validationSplitRole === null
        ? null
        : {
            validationProtocol: "walk_forward",
            splitId: "wf_report",
            splitIndex: 0,
            trainStart: "2025-01-01T00:00:00.000Z",
            trainEnd: "2025-01-31T23:59:59.999Z",
            validationStart: "2025-02-01T00:00:00.000Z",
            validationEnd: "2025-02-28T23:59:59.999Z",
            testStart:
              validationSplitRole === "test"
                ? "2025-03-01T00:00:00.000Z"
                : null,
            testEnd:
              validationSplitRole === "test"
                ? "2025-03-31T23:59:59.999Z"
                : null,
            purgeDurationDays: 0,
            embargoDurationDays: 0,
            splitRole: validationSplitRole
          },
    marketRegime: marketRegime(regime),
    marketRegimesByMarket: {
      KR: marketRegime(regime)
    },
    dataAvailability: {
      status: status === "skipped" ? "insufficient" : "available",
      totalSnapshotCount: 10,
      windowSnapshotCount: status === "skipped" ? 0 : 10,
      corruptLineCount: 0,
      requiredSymbolCount: 0,
      availableRequiredSymbolCount: 0,
      issues: status === "skipped" ? ["WINDOW_SNAPSHOT_MISSING"] : []
    },
    researchManifest: {
      status: "partial",
      manifestPath: null,
      manifestVersion: null,
      configHash: null,
      dataSnapshotHash: null,
      universeHash: null,
      coverageHash: null,
      promptHash: null,
      schemaHash: null,
      riskPolicyHash: null,
      costModelHash: null,
      executionModelVersion: null,
      warnings: ["fixture legacy run"]
    },
    summary:
      status === "completed"
        ? {
            finalVirtualNetWorthKrw: finalVirtualNetWorthKrw ?? 1_000_000,
            totalReturnRatio,
            tradeCount: 1,
            decisionProviderCallCount: 1,
            aiDecisionFailureCount,
            aiDecisionFailureReasons:
              aiDecisionFailureCount > 0 ? ["fixture provider failure"] : [],
            lastAiDecisionFailureSummary:
              aiDecisionFailureCount > 0 ? "fixture provider failure" : null,
            rejectedCount: 0,
            meaningfulRejectCount: 0,
            dustRejectCount: 0,
            avgExposureRatio: 0.2,
            avgCashRatio: 0.8,
            maxExposureRatio: 0.3,
            minExposureRatio: 0.1,
            timeInMarketRatio: 1,
            finalCashRatio: 0.8,
            finalPositionRatio: 0.2,
            targetExposureRatio: 0.85,
            averageTargetExposureGapRatio: 0.65,
            finalTargetExposureGapRatio: 0.65,
            finalExposureByMarketKrw: {
              KR: 100_000,
              US: 100_000
            },
            finalExposureByAssetTypeKrw: {
              STOCK: 100_000,
              ETF: 100_000,
              UNKNOWN: 0
            }
          }
        : null,
    reportPath:
      status === "completed" ? `data/batch/${runId}/historical-replay-report.json` : null,
    error: status === "failed" ? "fixture failure" : null,
    skipReason: status === "skipped" ? "DATA_INSUFFICIENT" : null
  };
}

function trial(
  runId: string,
  runIndex: number,
  status: SelectionTrialRecord["status"],
  promptHash: SelectionTrialRecord["decisionProvider"]["promptHash"],
  configHash: SelectionTrialRecord["config"]["configHash"],
  tradeCount: number,
  aiDecisionFailureCount: number,
  rejectedCount: number,
  totalReturnRatio =
    status === "completed" || status === "completed_with_failures"
      ? 0.01
      : null,
  configOverrides: Partial<SelectionTrialRecord["config"]> = {}
): SelectionTrialRecord {
  return {
    mode: "paper_only",
    trialSchemaVersion: "selection_trial.v1",
    trialId: `batch-test:trial:${String(runIndex).padStart(6, "0")}:${runId}`,
    batchId: "batch-test",
    runId,
    runIndex,
    runSeed: `seed:${runIndex}`,
    status,
    startedAt: "2026-06-12T01:00:00.000Z",
    completedAt:
      status === "completed" || status === "completed_with_failures"
        ? "2026-06-12T01:00:01.000Z"
        : null,
    skippedAt: status === "skipped" ? "2026-06-12T01:00:01.000Z" : null,
    failedAt: status === "failed" ? "2026-06-12T01:00:01.000Z" : null,
    window: {
      seed: `seed:${runIndex}`,
      rangeStart: "2025-01-01T00:00:00.000Z",
      rangeEnd: "2025-12-31T23:59:59.999Z",
      windowMonths: 1,
      timezoneOffsetMinutes: 540,
      candidateCount: 12,
      selectedCandidateIndex: runIndex,
      selectedMonth: "2025-01",
      localStartDate: "2025-01-01",
      localEndDate: "2025-01-31",
      startAt: "2024-12-31T15:00:00.000Z",
      endAt: "2025-01-31T14:59:59.999Z"
    },
    marketRegime: marketRegime("bull"),
    decisionProvider: {
      mode: "deterministic_fixture",
      promptPolicy: null,
      promptVersion: null,
      promptHash,
      metadataHash: hash("f")
    },
    config: {
      configHash,
      riskPolicyHash: configOverrides.riskPolicyHash ?? hash("1"),
      allocationPolicyHash: configOverrides.allocationPolicyHash ?? hash("2"),
      marketRegimeAllocationPolicyHash:
        configOverrides.marketRegimeAllocationPolicyHash ?? hash("3"),
      exitPolicyHash: configOverrides.exitPolicyHash ?? hash("4"),
      riskProfile: configOverrides.riskProfile ?? "balanced",
      selectionMetric: "total_return_ratio"
    },
    outcome: {
      totalReturnRatio,
      finalVirtualNetWorthKrw:
        status === "completed" || status === "completed_with_failures"
          ? 1_010_000
          : null,
      tradeCount,
      aiDecisionFailureCount,
      rejectedCount,
      skipReason: status === "skipped" ? "DATA_INSUFFICIENT" : null,
      error: status === "failed" ? "fixture failure" : null,
      reportPath:
        status === "completed" || status === "completed_with_failures"
          ? `data/batch/${runId}/historical-replay-report.json`
          : null
    },
    selection: {
      selected: false,
      selectedBy: null,
      selectedAt: null,
      selectionReason: null
    },
    researchManifest: {
      status: promptHash === null ? "partial" : "available",
      manifestPath:
        promptHash === null
          ? null
          : `data/batch/${runId}/historical-replay-research-manifest.json`,
      manifestVersion:
        promptHash === null ? null : "replay_research_manifest.v1",
      configHash,
      dataSnapshotHash: null,
      universeHash: null,
      coverageHash: null,
      promptHash,
      schemaHash: null,
      riskPolicyHash: null,
      costModelHash: null,
      executionModelVersion: null,
      warnings: promptHash === null ? ["fixture legacy run"] : []
    }
  };
}

function hash(char: string): `sha256:${string}` {
  return `sha256:${char.repeat(64)}`;
}

function marketRegime(label: MarketRegimeLabel): MarketRegimeClassification {
  return {
    label,
    windowStart: "2024-12-31T15:00:00.000Z",
    windowEnd: "2025-01-31T14:59:59.999Z",
    symbolCount: label === "insufficient_data" ? 0 : 1,
    classifiedSymbolCount: label === "insufficient_data" ? 0 : 1,
    averageReturnRatio: label === "insufficient_data" ? null : 0,
    medianReturnRatio: label === "insufficient_data" ? null : 0,
    advancingSymbolRatio: label === "bull" ? 1 : 0,
    decliningSymbolRatio: label === "bear" ? 1 : 0,
    flatSymbolRatio: label === "sideways" ? 1 : 0,
    minSymbols: 1,
    minSnapshotsPerSymbol: 2,
    thresholds: {
      bullReturnThreshold: 0.03,
      bearReturnThreshold: -0.03,
      sidewaysAbsReturnThreshold: 0.01,
      breadthThreshold: 0.6
    },
    reasons: ["fixture"],
    symbolReturns: []
  };
}
