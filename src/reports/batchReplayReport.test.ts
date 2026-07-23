import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketRegimeClassification,
  MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
import type { HistoricalMarketSnapshot } from "../domain/schemas.js";
import type { ValidationSplitRole } from "../replay/validationProtocol.js";
import type { SelectionTrialRecord } from "../replay/selectionTrialLog.js";
import type { HistoricalUniverseCoverageReport } from "../replay/historicalUniverseCoverage.js";
import {
  buildTripleBarrierLabelArtifact,
  type MetaLabelEvaluationReport,
  type TripleBarrierLabelArtifact
} from "../replay/tripleBarrierLabel.js";
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
  assert.deepEqual(report.summary.dataAvailabilityIssues, [
    {
      code: "WINDOW_SNAPSHOT_MISSING",
      count: 1,
      runIds: ["run_3"]
    }
  ]);
  assert.equal(report.overall.averageTotalReturnRatio, 0.02);
  assert.equal(report.overall.medianTotalReturnRatio, 0.02);
  assert.equal(report.overall.winRate, 0.666667);
  assert.equal(report.overall.advancedPerformance.formulaVersion, "performance_metrics.v1");
  assert.equal(report.overall.advancedPerformance.sampleCount, 3);
  assert.equal(report.overall.advancedPerformance.hitRatio, 0.666667);
  assert.equal(report.overall.advancedPerformance.profitFactor, 7);
  assert.notEqual(report.overall.advancedPerformance.sharpeRatio, null);
  assert.equal(report.overall.sharpeValidation.schemaVersion, "sharpe_validation.v1");
  assert.equal(report.overall.sharpeValidation.sample.returnSampleCount, 3);
  assert.equal(report.overall.sharpeValidation.status, "unavailable");
  assert.equal(
    report.overall.sharpeValidation.metrics.sampleSharpe.status,
    "insufficient_sample"
  );
  assert.match(
    report.overall.advancedPerformance.warnings.join("\n"),
    /at least 20 return samples/
  );
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
  assert.equal(report.overall.costSummary.sampleCount, 3);
  assert.equal(report.overall.costSummary.totalCostKrw, 0);
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
  assert.match(
    renderBatchReplayAggregateReport(report),
    /advanced_performance/
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /sharpe_validation/
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /data_availability_issues/
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /cost_summary/
  );
});

test("batch replay aggregate report connects Sharpe validation diagnostics", () => {
  const returns = [
    0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01,
    0.01, 0.01, 0.01, 0.01, 0.01, -0.01, -0.01, -0.01, -0.01, -0.01,
    -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01
  ];
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-07-02T00:00:00.000Z"),
    records: returns.map((returnRatio, index) =>
      record(
        `run_sharpe_${index}`,
        index,
        "completed",
        "bull",
        returnRatio,
        Math.round(1_000_000 * (1 + returnRatio))
      )
    )
  });

  assert.equal(report.overall.sharpeValidation.status, "available");
  assert.equal(report.overall.sharpeValidation.sample.returnSampleCount, 30);
  assert.equal(report.overall.sharpeValidation.selectionContext.candidateCount, null);
  assert.equal(report.overall.sharpeValidation.selectionContext.trialCount, 30);
  assert.equal(
    report.overall.sharpeValidation.selectionContext
      .trialSharpeRatioStandardDeviation,
    null
  );
  assert.equal(
    report.overall.sharpeValidation.metrics.deflatedSharpeRatio.status,
    "missing_selection_context"
  );
  assert.equal(
    report.overall.sharpeValidation.distribution.autocorrelation.maxLag,
    5
  );
  assert.equal(
    report.overall.sharpeValidation.distribution.autocorrelation.lagCount,
    5
  );
  assert.match(
    report.overall.sharpeValidation.warnings
      .map((warning) => warning.code)
      .join("\n"),
    /NON_IID_RETURN_SAMPLE/
  );
  assert.match(renderBatchReplayAggregateReport(report), /sharpe_validation/);
});

test("batch replay aggregate report summarizes execution cost components", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-07-02T00:00:00.000Z"),
    records: [
      withCostSummary(
        record("run_cost_0", 0, "completed", "bull", 0.01, 1_010_000),
        {
          feeKrw: 10,
          taxKrw: 2,
          slippageKrw: 3,
          spreadCostKrw: 4,
          impactCostKrw: 5,
          totalCostKrw: 24,
          filledCount: 1,
          partialFillCount: 0,
          notModeledLiquidityCount: 0,
          averageParticipationRate: 0.1,
          maxParticipationRate: 0.1,
          costModelVersions: ["paper_cost_model.v4"],
          byStrategyBucket: [
            {
              strategyBucket: "short_term",
              tradeCount: 1,
              feeKrw: 10,
              taxKrw: 2,
              slippageKrw: 3,
              spreadCostKrw: 4,
              impactCostKrw: 5,
              totalCostKrw: 24,
              averageCostPerTradeKrw: 24,
              filledCount: 1,
              partialFillCount: 0,
              notModeledLiquidityCount: 0,
              averageParticipationRate: 0.1,
              maxParticipationRate: 0.1,
              costModelVersions: ["paper_cost_model.v4"]
            }
          ]
        }
      ),
      withCostSummary(
        record("run_cost_1", 1, "completed", "bull", 0.02, 1_020_000),
        {
          feeKrw: 1,
          taxKrw: 0,
          slippageKrw: 1,
          spreadCostKrw: 2,
          impactCostKrw: 2,
          totalCostKrw: 6,
          filledCount: 1,
          partialFillCount: 1,
          notModeledLiquidityCount: 0,
          averageParticipationRate: 0.2,
          maxParticipationRate: 0.25,
          costModelVersions: ["paper_cost_model.v4"],
          byStrategyBucket: [
            {
              strategyBucket: "intraday",
              tradeCount: 1,
              feeKrw: 1,
              taxKrw: 0,
              slippageKrw: 1,
              spreadCostKrw: 2,
              impactCostKrw: 2,
              totalCostKrw: 6,
              averageCostPerTradeKrw: 6,
              filledCount: 1,
              partialFillCount: 1,
              notModeledLiquidityCount: 0,
              averageParticipationRate: 0.2,
              maxParticipationRate: 0.25,
              costModelVersions: ["paper_cost_model.v4"]
            }
          ]
        }
      ),
      withLegacyBucketlessCostSummary(
        record(
          "run_cost_legacy_bucketless",
          2,
          "completed",
          "bull",
          0.015,
          1_015_000
        ),
        {
          feeKrw: 2,
          taxKrw: 1,
          slippageKrw: 1,
          spreadCostKrw: 1,
          impactCostKrw: 3,
          totalCostKrw: 8,
          filledCount: 1,
          partialFillCount: 0,
          notModeledLiquidityCount: 1,
          averageParticipationRate: 0.3,
          maxParticipationRate: 0.3,
          costModelVersions: ["paper_cost_model.v3"]
        }
      ),
      withoutCostSummary(
        record("run_legacy", 3, "completed", "bear", 0.01, 1_010_000)
      ),
      nonCompletedRecordWithSummary(
        record("run_skipped_with_summary", 4, "completed", "bear", 0.03, 1_030_000),
        "skipped",
        {
          feeKrw: 100,
          taxKrw: 100,
          slippageKrw: 100,
          spreadCostKrw: 100,
          impactCostKrw: 100,
          totalCostKrw: 500,
          filledCount: 5,
          partialFillCount: 5,
          notModeledLiquidityCount: 5,
          averageParticipationRate: 0.9,
          maxParticipationRate: 0.9
        }
      )
    ]
  });

  assert.equal(report.overall.costSummary.sampleCount, 3);
  assert.equal(report.overall.costSummary.tradeCount, 3);
  assert.equal(report.overall.costSummary.feeKrw, 13);
  assert.equal(report.overall.costSummary.taxKrw, 3);
  assert.equal(report.overall.costSummary.slippageKrw, 5);
  assert.equal(report.overall.costSummary.spreadCostKrw, 7);
  assert.equal(report.overall.costSummary.impactCostKrw, 10);
  assert.equal(report.overall.costSummary.totalCostKrw, 38);
  assert.equal(report.overall.costSummary.averageCostPerRunKrw, 13);
  assert.equal(report.overall.costSummary.averageCostPerTradeKrw, 13);
  assert.equal(report.overall.costSummary.filledCount, 3);
  assert.equal(report.overall.costSummary.partialFillCount, 1);
  assert.equal(report.overall.costSummary.notModeledLiquidityCount, 1);
  assert.equal(report.overall.costSummary.averageRunParticipationRate, 0.2);
  assert.equal(report.overall.costSummary.maxParticipationRate, 0.3);
  assert.deepEqual(report.overall.costSummary.costModelVersions, [
    "paper_cost_model.v3",
    "paper_cost_model.v4"
  ]);
  assert.deepEqual(report.overall.costSummary.runIds, [
    "run_cost_0",
    "run_cost_1",
    "run_cost_legacy_bucketless"
  ]);
  assert.deepEqual(report.overall.costSummary.byStrategyBucket, [
    {
      strategyBucket: "short_term",
      sampleCount: 1,
      tradeCount: 1,
      feeKrw: 10,
      taxKrw: 2,
      slippageKrw: 3,
      spreadCostKrw: 4,
      impactCostKrw: 5,
      totalCostKrw: 24,
      averageCostPerRunKrw: 24,
      averageCostPerTradeKrw: 24,
      filledCount: 1,
      partialFillCount: 0,
      notModeledLiquidityCount: 0,
      averageRunParticipationRate: 0.1,
      maxParticipationRate: 0.1,
      costModelVersions: ["paper_cost_model.v4"],
      runIds: ["run_cost_0"]
    },
    {
      strategyBucket: "intraday",
      sampleCount: 1,
      tradeCount: 1,
      feeKrw: 1,
      taxKrw: 0,
      slippageKrw: 1,
      spreadCostKrw: 2,
      impactCostKrw: 2,
      totalCostKrw: 6,
      averageCostPerRunKrw: 6,
      averageCostPerTradeKrw: 6,
      filledCount: 1,
      partialFillCount: 1,
      notModeledLiquidityCount: 0,
      averageRunParticipationRate: 0.2,
      maxParticipationRate: 0.25,
      costModelVersions: ["paper_cost_model.v4"],
      runIds: ["run_cost_1"]
    }
  ]);
  assert.equal(report.overall.costSummary.missingStrategyBucketBreakdownCount, 1);
  assert.deepEqual(
    report.overall.costSummary.missingStrategyBucketBreakdownRunIds,
    ["run_cost_legacy_bucketless"]
  );
  assert.equal(report.overall.totalTradeCount, 4);
  assert.equal(report.byRegime.bull?.costSummary.totalCostKrw, 38);
  assert.equal(
    report.byRegime.bull?.costSummary.missingStrategyBucketBreakdownCount,
    1
  );
  assert.equal(report.byRegime.bear?.costSummary.sampleCount, 0);
});

test("batch replay aggregate report summarizes calendar and FX availability issues", () => {
  const calendarRejected = withDataAvailabilityIssues(
    record("run_calendar", 0, "skipped", "insufficient_data", null, null),
    ["CALENDAR_HOLIDAY_SAMPLE", "VIRTUAL_FX_STALE"]
  );
  const fxRejected = withDataAvailabilityIssues(
    record("run_fx", 1, "skipped", "insufficient_data", null, null),
    ["VIRTUAL_FX_STALE"]
  );

  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-07-01T00:00:00.000Z"),
    records: [calendarRejected, fxRejected]
  });

  assert.deepEqual(report.summary.dataAvailabilityIssues, [
    {
      code: "VIRTUAL_FX_STALE",
      count: 2,
      runIds: ["run_calendar", "run_fx"]
    },
    {
      code: "CALENDAR_HOLIDAY_SAMPLE",
      count: 1,
      runIds: ["run_calendar"]
    }
  ]);
  assert.match(
    renderBatchReplayAggregateReport(report),
    /VIRTUAL_FX_STALE/
  );
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

test("batch replay aggregate report deduplicates planned evidence in global statistics", () => {
  const sharedTrain = plannedRecord(
    record("run_train", 0, "completed", "bull", 0.03, 1_030_000, 0, "train"),
    0,
    "b",
    ["train", "validation"]
  );
  const sharedValidation = plannedRecord(
    record(
      "run_validation",
      1,
      "completed",
      "bull",
      0.03,
      1_030_000,
      0,
      "validation"
    ),
    1,
    "b",
    ["train", "validation"]
  );
  const independentTest = plannedRecord(
    record("run_test", 2, "completed", "bear", -0.01, 990_000, 0, "test"),
    2,
    "c",
    ["test"]
  );

  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-07-23T00:00:00.000Z"),
    records: [sharedValidation, independentTest, sharedTrain]
  });

  assert.equal(report.summary.runCount, 3);
  assert.equal(report.summary.returnSampleCount, 2);
  assert.equal(report.overall.runCount, 2);
  assert.equal(report.overall.returnSampleCount, 2);
  assert.equal(report.overall.averageTotalReturnRatio, 0.01);
  assert.deepEqual(report.summary.regimeCounts, { bull: 1, bear: 1 });
  assert.deepEqual(report.summary.regimeCountsByMarket, {
    KR: { bull: 1, bear: 1 }
  });
  assert.equal(report.byRegime.bull?.runCount, 1);
  assert.equal(report.byValidationSplitRole.train?.runCount, 1);
  assert.equal(report.byValidationSplitRole.validation?.runCount, 1);
  assert.deepEqual(report.validationRoleRegimeEvidence, {
    planHash: hash("a"),
    plannedRunCount: 3,
    globalUniqueEvidenceGroupCount: 2,
    independentReturnSampleCount: 2,
    crossRoleSharedEvidenceGroupCount: 1,
    crossRoleSharedEvidenceWarnings: [
      {
        code: "CROSS_ROLE_EVIDENCE_SHARED",
        evidenceGroupHash: hash("b"),
        candidateHash: hash("b"),
        sharedRoles: ["train", "validation"],
        runIds: ["run_train", "run_validation"]
      }
    ],
    roleRegimeStatusCounts: {
      train: {
        bull: { runCount: 1, completedCount: 1, skippedCount: 0, failedCount: 0 }
      },
      validation: {
        bull: { runCount: 1, completedCount: 1, skippedCount: 0, failedCount: 0 }
      },
      test: {
        bear: { runCount: 1, completedCount: 1, skippedCount: 0, failedCount: 0 }
      }
    }
  });
  assert.equal(
    report.validationRoleRegimeStatisticalReadiness?.schemaVersion,
    "validation_role_regime_statistical_readiness.v1"
  );
  assert.equal(
    report.validationRoleRegimeStatisticalReadiness?.status,
    "inconclusive"
  );
  assert.equal(
    report.validationRoleRegimeStatisticalReadiness?.provenance.status,
    "verified"
  );
  assert.deepEqual(
    report.validationRoleRegimeStatisticalReadiness?.evidence.global,
    {
      plannedRunCount: 3,
      globalUniqueEvidenceGroupCount: 2,
      crossRoleSharedEvidenceGroupCount: 1
    }
  );
  assert.deepEqual(
    report.validationRoleRegimeStatisticalReadiness?.evidence.byRole.train,
    {
      plannedRunCount: 1,
      roleLocalUniqueEvidenceGroupCount: 1,
      roleExclusiveEvidenceGroupCount: 0,
      crossRoleSharedEvidenceGroupCount: 1
    }
  );
  assert.equal(
    report.validationRoleRegimeStatisticalReadiness?.blockers.some(
      (blocker) =>
        blocker.code === "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM" &&
        blocker.splitRole === "test"
    ),
    true
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /global_unique_evidence_group_count: 2/
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /schema_version: validation_role_regime_statistical_readiness\.v1/
  );
});

test("batch replay aggregate report omits readiness for legacy records", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-07-23T00:00:00.000Z"),
    records: [
      record("run_legacy", 0, "completed", "bull", 0.01, 1_010_000)
    ]
  });

  assert.equal(report.validationRoleRegimeEvidence, null);
  assert.equal(report.validationRoleRegimeStatisticalReadiness, null);
  assert.match(
    renderBatchReplayAggregateReport(report),
    /## Validation Role-Regime Statistical Readiness\nnot_available/
  );
});

test("batch replay aggregate report rejects mixed planned and legacy records", () => {
  const planned = plannedRecord(
    record("run_planned", 0, "completed", "bull", 0.01, 1_010_000, 0, "train"),
    0,
    "b",
    ["train"]
  );

  assert.throws(
    () =>
      buildBatchReplayAggregateReport({
        generatedAt: new Date("2026-07-23T00:00:00.000Z"),
        records: [planned, record("run_legacy", 1, "completed", "bull", 0.01, 1_010_000)]
      }),
    /cannot mix planned and legacy run records/
  );
});

test("batch replay aggregate report rejects observed plan window or assignment mismatches", () => {
  const planned = plannedRecord(
    record("run_planned", 0, "completed", "bull", 0.01, 1_010_000, 0, "train"),
    0,
    "b",
    ["train"],
    {
      plannedRunCount: 1,
      globalUniqueEvidenceGroupCount: 1,
      crossRoleSharedEvidenceGroupCount: 0
    }
  );

  assert.throws(
    () =>
      buildBatchReplayAggregateReport({
        generatedAt: new Date("2026-07-23T00:00:00.000Z"),
        records: [
          {
            ...planned,
            window: {
              ...planned.window,
              startAt: "2025-01-01T00:00:00.000Z"
            }
          }
        ]
      }),
    /replay window mismatch/
  );
  assert.throws(
    () =>
      buildBatchReplayAggregateReport({
        generatedAt: new Date("2026-07-23T00:00:00.000Z"),
        records: [
          {
            ...planned,
            validationSplit: {
              ...planned.validationSplit!,
              splitId: "foreign_window"
            }
          }
        ]
      }),
    /executionAssignment mismatch/
  );
});

test("batch replay aggregate report rejects conflicting duplicate evidence results", () => {
  const train = plannedRecord(
    record("run_train", 0, "completed", "bull", 0.03, 1_030_000, 0, "train"),
    0,
    "b",
    ["train", "validation"],
    {
      plannedRunCount: 2,
      globalUniqueEvidenceGroupCount: 1,
      crossRoleSharedEvidenceGroupCount: 1
    }
  );
  const validation = plannedRecord(
    record(
      "run_validation",
      1,
      "completed",
      "bull",
      0.02,
      1_020_000,
      0,
      "validation"
    ),
    1,
    "b",
    ["train", "validation"],
    {
      plannedRunCount: 2,
      globalUniqueEvidenceGroupCount: 1,
      crossRoleSharedEvidenceGroupCount: 1
    }
  );

  assert.throws(
    () =>
      buildBatchReplayAggregateReport({
        generatedAt: new Date("2026-07-23T00:00:00.000Z"),
        records: [train, validation]
      }),
    /evidence group has conflicting results/
  );
});

test("batch replay aggregate report rejects incomplete shared evidence groups", () => {
  const incomplete = plannedRecord(
    record("run_train", 0, "completed", "bull", 0.03, 1_030_000, 0, "train"),
    0,
    "b",
    ["train", "validation"],
    {
      plannedRunCount: 2,
      globalUniqueEvidenceGroupCount: 1,
      crossRoleSharedEvidenceGroupCount: 1
    }
  );

  assert.throws(
    () =>
      buildBatchReplayAggregateReport({
        generatedAt: new Date("2026-07-23T00:00:00.000Z"),
        records: [incomplete]
      }),
    /run count does not match plannedRunCount/
  );
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

  const cpcvPboValidation = report.cpcvPboValidation!;
  assert.equal(
    cpcvPboValidation.schemaVersion,
    "cpcv_pbo_validation.v1"
  );
  assert.equal(cpcvPboValidation.status, "sampled");
  assert.equal(cpcvPboValidation.splitPlan, null);
  assert.equal(cpcvPboValidation.config.combinationMode, "sampled");
  assert.equal(cpcvPboValidation.config.selectionMetric, "total_return_ratio");
  assert.equal(cpcvPboValidation.performanceMatrix.length, 2);
  assert.deepEqual(
    cpcvPboValidation.selectionLog.map((entry) => [
      entry.combinationId,
      entry.selectedCandidateKey,
      entry.testRankPercentile
    ]),
    [
      ["wf_report:validation", selectedRow.candidateKey, 0.25],
      ["wf_report:test", selectedRow.candidateKey, 0.25]
    ]
  );
  assert.equal(cpcvPboValidation.pbo.status, "computed");
  assert.equal(cpcvPboValidation.pbo.probability, 1);
  assert.equal(cpcvPboValidation.pbo.evaluatedCombinationCount, 2);
  assert.deepEqual(
    cpcvPboValidation.warnings.map((warning) => warning.code),
    ["CPCV_SAMPLED_MODE_USED", "CPCV_SPLIT_PLAN_UNAVAILABLE"]
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /cpcv_pbo_status: sampled/
  );
  assert.match(
    renderBatchReplayAggregateReport(report),
    /cpcv_pbo_probability: 1/
  );
});

test("batch replay aggregate report separates provider metadata candidates", () => {
  const promptHash = hash("same_prompt");
  const providerAMetadataHash = hash("provider_a_metadata");
  const providerBMetadataHash = hash("provider_b_metadata");
  const sharedAllocationPolicyHash = hash("shared_allocation_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 2,
    records: [
      record("provider_a_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train"),
      record("provider_b_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train"),
      record(
        "provider_a_validation",
        2,
        "completed",
        "bull",
        -0.05,
        950_000,
        0,
        "validation"
      ),
      record(
        "provider_b_validation",
        3,
        "completed",
        "bull",
        0.04,
        1_040_000,
        0,
        "validation"
      )
    ],
    selectionTrials: [
      trial(
        "provider_a_train",
        0,
        "completed",
        promptHash,
        hash("provider_a_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: sharedAllocationPolicyHash },
        { metadataHash: providerAMetadataHash }
      ),
      trial(
        "provider_b_train",
        1,
        "completed",
        promptHash,
        hash("provider_b_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: sharedAllocationPolicyHash },
        { metadataHash: providerBMetadataHash }
      ),
      trial(
        "provider_a_validation",
        2,
        "completed",
        promptHash,
        hash("provider_a_validation_config"),
        1,
        0,
        0,
        -0.05,
        { allocationPolicyHash: sharedAllocationPolicyHash },
        { metadataHash: providerAMetadataHash }
      ),
      trial(
        "provider_b_validation",
        3,
        "completed",
        promptHash,
        hash("provider_b_validation_config"),
        1,
        0,
        0,
        0.04,
        { allocationPolicyHash: sharedAllocationPolicyHash },
        { metadataHash: providerBMetadataHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;
  const metadataHashes = new Set(
    diagnostics.splitMetricMatrix.map(
      (row) => row.decisionProviderMetadataHash
    )
  );

  assert.equal(diagnostics.candidateCount, 2);
  assert.deepEqual(metadataHashes, new Set([
    providerAMetadataHash,
    providerBMetadataHash
  ]));
  assert.match(
    diagnostics.selectedCandidateKey ?? "",
    new RegExp(`providerMetadata=${providerAMetadataHash}`)
  );
});

test("batch replay aggregate report separates strategy preset cadence candidates", () => {
  const promptHash = hash("a");
  const sharedPolicyHashes = {
    riskPolicyHash: hash("1"),
    allocationPolicyHash: hash("2"),
    marketRegimeAllocationPolicyHash: hash("3"),
    exitPolicyHash: hash("4")
  };
  const dailyCadence = {
    stepSeconds: 86_400,
    everyNSteps: null,
    candidateChangedOnly: false,
    decisionFrequency: "once_per_day" as const,
    maxDecisionCalls: 12,
    timezoneOffsetMinutes: 540
  };
  const dailyOverrideCadence = {
    ...dailyCadence,
    maxDecisionCalls: 3
  };
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [
      record("long_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train"),
      record("short_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train"),
      record(
        "short_override_train",
        2,
        "completed",
        "bull",
        0.15,
        1_150_000,
        0,
        "train"
      ),
      record(
        "long_validation",
        3,
        "completed",
        "bull",
        0.01,
        1_010_000,
        0,
        "validation"
      ),
      record(
        "short_validation",
        4,
        "completed",
        "bull",
        0.02,
        1_020_000,
        0,
        "validation"
      ),
      record(
        "short_override_validation",
        5,
        "completed",
        "bull",
        0.03,
        1_030_000,
        0,
        "validation"
      )
    ],
    selectionTrials: [
      trial(
        "long_train",
        0,
        "completed",
        promptHash,
        hash("5"),
        1,
        0,
        0,
        0.2,
        {
          ...sharedPolicyHashes,
          strategyPreset: "long_term",
          replayCadence: dailyCadence
        }
      ),
      trial(
        "short_train",
        1,
        "completed",
        promptHash,
        hash("6"),
        1,
        0,
        0,
        0.1,
        {
          ...sharedPolicyHashes,
          strategyPreset: "short_term",
          replayCadence: dailyCadence
        }
      ),
      trial(
        "short_override_train",
        2,
        "completed",
        promptHash,
        hash("7"),
        1,
        0,
        0,
        0.15,
        {
          ...sharedPolicyHashes,
          strategyPreset: "short_term",
          replayCadence: dailyOverrideCadence
        }
      ),
      trial(
        "long_validation",
        3,
        "completed",
        promptHash,
        hash("8"),
        1,
        0,
        0,
        0.01,
        {
          ...sharedPolicyHashes,
          strategyPreset: "long_term",
          replayCadence: dailyCadence
        }
      ),
      trial(
        "short_validation",
        4,
        "completed",
        promptHash,
        hash("9"),
        1,
        0,
        0,
        0.02,
        {
          ...sharedPolicyHashes,
          strategyPreset: "short_term",
          replayCadence: dailyCadence
        }
      ),
      trial(
        "short_override_validation",
        5,
        "completed",
        promptHash,
        hash("a"),
        1,
        0,
        0,
        0.03,
        {
          ...sharedPolicyHashes,
          strategyPreset: "short_term",
          replayCadence: dailyOverrideCadence
        }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;
  const candidateKeys = diagnostics.splitMetricMatrix.map(
    (row) => row.candidateKey
  );

  assert.equal(diagnostics.candidateCount, 3);
  assert.deepEqual(
    new Set(
      diagnostics.splitMetricMatrix.map(
        (row) => `${row.strategyPreset}:${row.replayCadence?.maxDecisionCalls}`
      )
    ),
    new Set(["long_term:12", "short_term:12", "short_term:3"])
  );
  assert.ok(
    candidateKeys.some(
      (key) =>
        key.includes("preset=long_term") &&
        key.includes("maxDecisionCalls=12")
    )
  );
  assert.ok(
    candidateKeys.some(
      (key) =>
        key.includes("preset=short_term") &&
        key.includes("maxDecisionCalls=12")
    )
  );
  assert.ok(
    candidateKeys.some(
      (key) =>
        key.includes("preset=short_term") &&
        key.includes("maxDecisionCalls=3")
    )
  );
  assert.match(diagnostics.selectedCandidateKey ?? "", /preset=long_term/);
});

test("batch replay aggregate report separates candidate strategy bucket scopes", () => {
  const promptHash = hash("b");
  const sharedConfig = {
    strategyPreset: "short_term" as const
  };
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    records: [
      record(
        "scope_short_train",
        0,
        "completed",
        "bull",
        0.1,
        1_100_000,
        0,
        "train"
      ),
      record(
        "scope_swing_train",
        1,
        "completed",
        "bull",
        0.08,
        1_080_000,
        0,
        "train"
      ),
      record(
        "scope_short_validation",
        2,
        "completed",
        "bull",
        0.02,
        1_020_000,
        0,
        "validation"
      ),
      record(
        "scope_swing_validation",
        3,
        "completed",
        "bull",
        0.01,
        1_010_000,
        0,
        "validation"
      )
    ],
    selectionTrials: [
      trial(
        "scope_short_train",
        0,
        "completed",
        promptHash,
        hash("c"),
        1,
        0,
        0,
        0.1,
        { ...sharedConfig, candidateStrategyBucket: "short_term" }
      ),
      trial(
        "scope_swing_train",
        1,
        "completed",
        promptHash,
        hash("d"),
        1,
        0,
        0,
        0.08,
        { ...sharedConfig, candidateStrategyBucket: "swing" }
      ),
      trial(
        "scope_short_validation",
        2,
        "completed",
        promptHash,
        hash("e"),
        1,
        0,
        0,
        0.02,
        { ...sharedConfig, candidateStrategyBucket: "short_term" }
      ),
      trial(
        "scope_swing_validation",
        3,
        "completed",
        promptHash,
        hash("0"),
        1,
        0,
        0,
        0.01,
        { ...sharedConfig, candidateStrategyBucket: "swing" }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;
  assert.equal(diagnostics.candidateCount, 2);
  assert.deepEqual(
    new Set(
      diagnostics.splitMetricMatrix.map((row) => row.candidateStrategyBucket)
    ),
    new Set(["short_term", "swing"])
  );
  assert.ok(
    diagnostics.splitMetricMatrix.some((row) =>
      row.candidateKey.includes("candidateScope=short_term")
    )
  );
  assert.ok(
    diagnostics.splitMetricMatrix.some((row) =>
      row.candidateKey.includes("candidateScope=swing")
    )
  );
});

test("batch replay aggregate report includes stored meta-label evaluation artifact", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    sourceMetaLabelEvaluationPath:
      "data/batch-replay/batch-meta/meta-label-evaluation-report.json",
    records: [
      record("meta_eval_run", 0, "completed", "bull", 0.05, 1_050_000)
    ],
    metaLabelEvaluation: metaLabelEvaluationReport()
  });
  const rendered = renderBatchReplayAggregateReport(report);

  assert.equal(
    report.sourceMetaLabelEvaluationPath,
    "data/batch-replay/batch-meta/meta-label-evaluation-report.json"
  );
  assert.equal(report.metaLabelEvaluation?.schemaVersion, "meta_label_evaluation.v1");
  assert.equal(report.metaLabelEvaluation?.summary.totalCandidateCount, 3);
  assert.equal(report.metaLabelEvaluation?.summary.accuracyRatio, 0.5);
  assert.match(
    rendered,
    /source_meta_label_evaluation_path: data\/batch-replay\/batch-meta\/meta-label-evaluation-report\.json/
  );
  assert.match(rendered, /## Meta-Label Evaluation/);
  assert.match(rendered, /schema_version: meta_label_evaluation\.v1/);
  assert.match(rendered, /accuracy_ratio: 0\.5/);
});

test("batch replay aggregate report includes stored triple-barrier label distribution", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    sourceTripleBarrierLabelPath:
      "data/batch-replay/batch-label/triple-barrier-label-report.json",
    records: [
      record("triple_label_run", 0, "completed", "bull", 0.05, 1_050_000)
    ],
    tripleBarrierLabel: tripleBarrierLabelArtifact()
  });
  const rendered = renderBatchReplayAggregateReport(report);

  assert.equal(
    report.sourceTripleBarrierLabelPath,
    "data/batch-replay/batch-label/triple-barrier-label-report.json"
  );
  assert.equal(
    report.tripleBarrierLabel?.schemaVersion,
    "triple_barrier_label.v1"
  );
  assert.equal(report.tripleBarrierLabel?.summary.totalLabelCount, 3);
  assert.equal(report.tripleBarrierLabel?.summary.unavailableLabelCount, 1);
  assert.match(
    rendered,
    /source_triple_barrier_label_path: data\/batch-replay\/batch-label\/triple-barrier-label-report\.json/
  );
  assert.match(rendered, /## Triple Barrier Label Distribution/);
  assert.match(rendered, /schema_version: triple_barrier_label\.v1/);
  assert.match(rendered, /config_hash: sha256:[a-f0-9]{64}/);
  assert.match(rendered, /positive_count: 1/);
  assert.match(rendered, /warning_count: 1/);
});

test("batch replay aggregate report warns when expected split count lacks trials", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 3,
    records: [
      record("run_without_trials", 0, "completed", "bull", 0.01, 1_010_000)
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;

  assert.equal(report.trialSummary, null);
  assert.equal(diagnostics.expectedSampledCpcvSplitCount, 3);
  assert.equal(diagnostics.sampledCpcvSplitCount, 0);
  assert.equal(diagnostics.sampledCpcvSplitCountMatchesExpected, false);
  assert.equal(diagnostics.joinedTrialCount, 0);
  assert.match(
    diagnostics.warnings.join("\n"),
    /no selection trials with validation split metadata/
  );
  assert.match(diagnostics.warnings.join("\n"), /split count mismatch/);
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
  assert.equal(report.cpcvPboValidation?.status, "unavailable");
  assert.equal(report.cpcvPboValidation?.pbo.status, "insufficient_matrix");
  assert.deepEqual(
    report.cpcvPboValidation?.warnings.map((warning) => warning.code),
    [
      "CPCV_SAMPLED_MODE_USED",
      "CPCV_SPLIT_PLAN_UNAVAILABLE",
      "PBO_CANDIDATE_COUNT_INSUFFICIENT",
      "PBO_HOLDOUT_MATRIX_INSUFFICIENT"
    ]
  );
  assert.match(
    diagnostics.warnings.join("\n"),
    /at least two strategy candidates/
  );
  assert.match(diagnostics.warnings.join("\n"), /no validation\/test holdout/);
  assert.match(diagnostics.warnings.join("\n"), /split count mismatch/);
});

test("batch replay aggregate report requires two train-sampled candidates for PBO-like scoring", () => {
  const promptHash = hash("train");
  const candidateAAllocationPolicyHash = hash("train_candidate_a_policy");
  const candidateBAllocationPolicyHash = hash("train_candidate_b_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 2,
    records: [
      record(
        "candidate_a_train_only_sample",
        0,
        "completed",
        "bull",
        0.2,
        1_200_000,
        0,
        "train"
      ),
      record(
        "candidate_b_train_missing_sample",
        1,
        "skipped",
        "bull",
        null,
        null,
        0,
        "train"
      ),
      record(
        "candidate_a_validation_sample",
        2,
        "completed",
        "bull",
        -0.1,
        900_000,
        0,
        "validation"
      ),
      record(
        "candidate_b_validation_sample",
        3,
        "completed",
        "bull",
        0.05,
        1_050_000,
        0,
        "validation"
      )
    ],
    selectionTrials: [
      trial(
        "candidate_a_train_only_sample",
        0,
        "completed",
        promptHash,
        hash("candidate_a_train_only_sample_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_train_missing_sample",
        1,
        "skipped",
        promptHash,
        hash("candidate_b_train_missing_sample_config"),
        0,
        0,
        0,
        null,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_validation_sample",
        2,
        "completed",
        promptHash,
        hash("candidate_a_validation_sample_config"),
        1,
        0,
        0,
        -0.1,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_validation_sample",
        3,
        "completed",
        promptHash,
        hash("candidate_b_validation_sample_config"),
        1,
        0,
        0,
        0.05,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;

  assert.equal(diagnostics.candidateCount, 2);
  assert.deepEqual(diagnostics.splitRoleCounts, {
    train: 2,
    validation: 2
  });
  assert.equal(diagnostics.selectedCandidateKey, null);
  assert.equal(diagnostics.selectedTrainAverageTotalReturnRatio, null);
  assert.deepEqual(diagnostics.holdoutDegradation, []);
  assert.equal(diagnostics.pboLikeScore, null);
  assert.match(
    diagnostics.warnings.join("\n"),
    /at least two train candidates with return samples/
  );
  assert.doesNotMatch(
    diagnostics.warnings.join("\n"),
    /no validation\/test holdout return samples/
  );
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

test("batch replay aggregate report warns when any holdout split is unscored", () => {
  const promptHash = hash("u");
  const candidateAAllocationPolicyHash = hash("candidate_a_partial_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_partial_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 4,
    records: [
      record("candidate_a_partial_split_1_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_1"),
      record("candidate_b_partial_split_1_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_1"),
      record("candidate_a_partial_split_2_train", 2, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_2"),
      record("candidate_b_partial_split_2_train", 3, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_2"),
      record(
        "candidate_a_partial_split_1_validation",
        4,
        "completed",
        "bull",
        -0.1,
        900_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_b_partial_split_1_validation",
        5,
        "completed",
        "bull",
        0.05,
        1_050_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_a_partial_split_2_validation",
        6,
        "completed",
        "bull",
        0.02,
        1_020_000,
        0,
        "validation",
        "split_2"
      ),
      record(
        "candidate_b_partial_split_2_validation",
        7,
        "skipped",
        "bull",
        null,
        null,
        0,
        "validation",
        "split_2"
      )
    ],
    selectionTrials: [
      trial(
        "candidate_a_partial_split_1_train",
        0,
        "completed",
        promptHash,
        hash("candidate_a_partial_split_1_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_partial_split_1_train",
        1,
        "completed",
        promptHash,
        hash("candidate_b_partial_split_1_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_partial_split_2_train",
        2,
        "completed",
        promptHash,
        hash("candidate_a_partial_split_2_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_partial_split_2_train",
        3,
        "completed",
        promptHash,
        hash("candidate_b_partial_split_2_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_partial_split_1_validation",
        4,
        "completed",
        promptHash,
        hash("candidate_a_partial_split_1_validation_config"),
        1,
        0,
        0,
        -0.1,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_partial_split_1_validation",
        5,
        "completed",
        promptHash,
        hash("candidate_b_partial_split_1_validation_config"),
        1,
        0,
        0,
        0.05,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_partial_split_2_validation",
        6,
        "completed",
        promptHash,
        hash("candidate_a_partial_split_2_validation_config"),
        1,
        0,
        0,
        0.02,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_partial_split_2_validation",
        7,
        "skipped",
        promptHash,
        hash("candidate_b_partial_split_2_validation_config"),
        0,
        0,
        0,
        null,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;

  assert.equal(diagnostics.pboLikeScore, 1);
  assert.deepEqual(
    diagnostics.holdoutDegradation.map((entry) => [
      entry.splitId,
      entry.selectedBelowMedian
    ]),
    [
      ["split_1", true],
      ["split_2", null]
    ]
  );
  assert.match(
    diagnostics.warnings.join("\n"),
    /unscored holdouts were excluded/
  );
});

test("batch replay aggregate CPCV PBO artifact preserves all-null holdout splits", () => {
  const promptHash = hash("z");
  const candidateAAllocationPolicyHash = hash("candidate_a_all_null_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_all_null_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 4,
    records: [
      record("candidate_a_all_null_split_1_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_1"),
      record("candidate_b_all_null_split_1_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_1"),
      record("candidate_a_all_null_split_2_train", 2, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_2"),
      record("candidate_b_all_null_split_2_train", 3, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_2"),
      record(
        "candidate_a_all_null_split_1_validation",
        4,
        "completed",
        "bull",
        -0.1,
        900_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_b_all_null_split_1_validation",
        5,
        "completed",
        "bull",
        0.05,
        1_050_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_a_all_null_split_2_validation",
        6,
        "skipped",
        "bull",
        null,
        null,
        0,
        "validation",
        "split_2"
      ),
      record(
        "candidate_b_all_null_split_2_validation",
        7,
        "skipped",
        "bull",
        null,
        null,
        0,
        "validation",
        "split_2"
      )
    ],
    selectionTrials: [
      trial(
        "candidate_a_all_null_split_1_train",
        0,
        "completed",
        promptHash,
        hash("candidate_a_all_null_split_1_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_all_null_split_1_train",
        1,
        "completed",
        promptHash,
        hash("candidate_b_all_null_split_1_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_all_null_split_2_train",
        2,
        "completed",
        promptHash,
        hash("candidate_a_all_null_split_2_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_all_null_split_2_train",
        3,
        "completed",
        promptHash,
        hash("candidate_b_all_null_split_2_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_all_null_split_1_validation",
        4,
        "completed",
        promptHash,
        hash("candidate_a_all_null_split_1_validation_config"),
        1,
        0,
        0,
        -0.1,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_all_null_split_1_validation",
        5,
        "completed",
        promptHash,
        hash("candidate_b_all_null_split_1_validation_config"),
        1,
        0,
        0,
        0.05,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_all_null_split_2_validation",
        6,
        "skipped",
        promptHash,
        hash("candidate_a_all_null_split_2_validation_config"),
        0,
        0,
        0,
        null,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_all_null_split_2_validation",
        7,
        "skipped",
        promptHash,
        hash("candidate_b_all_null_split_2_validation_config"),
        0,
        0,
        0,
        null,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const artifact = report.cpcvPboValidation!;

  assert.equal(report.overfittingDiagnostics?.pboLikeScore, 1);
  assert.deepEqual(
    artifact.selectionLog.map((entry) => [
      entry.combinationId,
      entry.testRankPercentile
    ]),
    [
      ["split_1:validation", 0.25],
      ["split_2:validation", null]
    ]
  );
  assert.equal(artifact.status, "unavailable");
  assert.equal(artifact.pbo.status, "insufficient_matrix");
  assert.equal(artifact.pbo.evaluatedCombinationCount, 1);
  assert.match(
    artifact.warnings.map((warning) => warning.code).join("\n"),
    /PBO_HOLDOUT_MATRIX_INSUFFICIENT/
  );
});

test("batch replay aggregate CPCV PBO artifact requires split-matched train metrics", () => {
  const promptHash = hash("m");
  const candidateAAllocationPolicyHash = hash("candidate_a_missing_train_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_missing_train_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 3,
    records: [
      record("candidate_a_missing_train_split_1_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_1"),
      record("candidate_b_missing_train_split_1_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_1"),
      record(
        "candidate_a_missing_train_split_1_validation",
        2,
        "completed",
        "bull",
        -0.1,
        900_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_b_missing_train_split_1_validation",
        3,
        "completed",
        "bull",
        0.05,
        1_050_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_a_missing_train_split_2_validation",
        4,
        "completed",
        "bull",
        0.03,
        1_030_000,
        0,
        "validation",
        "split_2"
      ),
      record(
        "candidate_b_missing_train_split_2_validation",
        5,
        "completed",
        "bull",
        0.04,
        1_040_000,
        0,
        "validation",
        "split_2"
      )
    ],
    selectionTrials: [
      trial(
        "candidate_a_missing_train_split_1_train",
        0,
        "completed",
        promptHash,
        hash("candidate_a_missing_train_split_1_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_missing_train_split_1_train",
        1,
        "completed",
        promptHash,
        hash("candidate_b_missing_train_split_1_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_missing_train_split_1_validation",
        2,
        "completed",
        promptHash,
        hash("candidate_a_missing_train_split_1_validation_config"),
        1,
        0,
        0,
        -0.1,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_missing_train_split_1_validation",
        3,
        "completed",
        promptHash,
        hash("candidate_b_missing_train_split_1_validation_config"),
        1,
        0,
        0,
        0.05,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_missing_train_split_2_validation",
        4,
        "completed",
        promptHash,
        hash("candidate_a_missing_train_split_2_validation_config"),
        1,
        0,
        0,
        0.03,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_missing_train_split_2_validation",
        5,
        "completed",
        promptHash,
        hash("candidate_b_missing_train_split_2_validation_config"),
        1,
        0,
        0,
        0.04,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const artifact = report.cpcvPboValidation!;

  assert.deepEqual(
    artifact.selectionLog.map((entry) => [
      entry.combinationId,
      entry.selectedCandidateKey,
      entry.testRankPercentile
    ]),
    [
      [
        "split_1:validation",
        report.overfittingDiagnostics?.selectedCandidateKey,
        0.25
      ],
      ["split_2:validation", null, null]
    ]
  );
  assert.equal(artifact.status, "unavailable");
  assert.equal(artifact.pbo.status, "insufficient_matrix");
  assert.equal(artifact.pbo.evaluatedCombinationCount, 1);
  assert.match(
    artifact.warnings.map((warning) => warning.code).join("\n"),
    /PBO_HOLDOUT_MATRIX_INSUFFICIENT/
  );
});

test("batch replay aggregate report scores PBO-like degradation per holdout split", () => {
  const promptHash = hash("a");
  const candidateAAllocationPolicyHash = hash("candidate_a_allocation_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_allocation_policy");
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 4,
    records: [
      record("candidate_a_split_1_train", 0, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_1"),
      record("candidate_b_split_1_train", 1, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_1"),
      record("candidate_a_split_2_train", 2, "completed", "bull", 0.2, 1_200_000, 0, "train", "split_2"),
      record("candidate_b_split_2_train", 3, "completed", "bull", 0.1, 1_100_000, 0, "train", "split_2"),
      record(
        "candidate_a_split_1_validation",
        4,
        "completed",
        "bull",
        -0.1,
        900_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_b_split_1_validation",
        5,
        "completed",
        "bull",
        0.05,
        1_050_000,
        0,
        "validation",
        "split_1"
      ),
      record(
        "candidate_a_split_2_validation",
        6,
        "completed",
        "bull",
        0.2,
        1_200_000,
        0,
        "validation",
        "split_2"
      ),
      record(
        "candidate_b_split_2_validation",
        7,
        "completed",
        "bull",
        0,
        1_000_000,
        0,
        "validation",
        "split_2"
      )
    ],
    selectionTrials: [
      trial(
        "candidate_a_split_1_train",
        0,
        "completed",
        promptHash,
        hash("candidate_a_split_1_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_split_1_train",
        1,
        "completed",
        promptHash,
        hash("candidate_b_split_1_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_split_2_train",
        2,
        "completed",
        promptHash,
        hash("candidate_a_split_2_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_split_2_train",
        3,
        "completed",
        promptHash,
        hash("candidate_b_split_2_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_split_1_validation",
        4,
        "completed",
        promptHash,
        hash("candidate_a_split_1_validation_config"),
        1,
        0,
        0,
        -0.1,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_split_1_validation",
        5,
        "completed",
        promptHash,
        hash("candidate_b_split_1_validation_config"),
        1,
        0,
        0,
        0.05,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      ),
      trial(
        "candidate_a_split_2_validation",
        6,
        "completed",
        promptHash,
        hash("candidate_a_split_2_validation_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: candidateAAllocationPolicyHash }
      ),
      trial(
        "candidate_b_split_2_validation",
        7,
        "completed",
        promptHash,
        hash("candidate_b_split_2_validation_config"),
        1,
        0,
        0,
        0,
        { allocationPolicyHash: candidateBAllocationPolicyHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;

  assert.equal(diagnostics.sampledCpcvSplitCount, 4);
  assert.equal(diagnostics.pboLikeScore, 0.5);
  assert.deepEqual(
    diagnostics.holdoutDegradation.map((entry) => [
      entry.splitId,
      entry.splitRole,
      entry.selectedBelowMedian
    ]),
    [
      ["split_1", "validation", true],
      ["split_2", "validation", false]
    ]
  );
});

test("batch replay aggregate report uses matching split train metric for degradation", () => {
  const promptHash = hash("d");
  const candidateAAllocationPolicyHash = hash("candidate_a_degradation_policy");
  const candidateBAllocationPolicyHash = hash("candidate_b_degradation_policy");
  const entries: Array<{
    runId: string;
    runIndex: number;
    splitId: string;
    splitRole: ValidationSplitRole;
    totalReturnRatio: number;
    allocationPolicyHash: SelectionTrialRecord["config"]["allocationPolicyHash"];
  }> = [
    {
      runId: "candidate_a_split_1_train_degradation",
      runIndex: 0,
      splitId: "split_1",
      splitRole: "train",
      totalReturnRatio: 0.3,
      allocationPolicyHash: candidateAAllocationPolicyHash
    },
    {
      runId: "candidate_b_split_1_train_degradation",
      runIndex: 1,
      splitId: "split_1",
      splitRole: "train",
      totalReturnRatio: 0.1,
      allocationPolicyHash: candidateBAllocationPolicyHash
    },
    {
      runId: "candidate_a_split_2_train_degradation",
      runIndex: 2,
      splitId: "split_2",
      splitRole: "train",
      totalReturnRatio: 0.1,
      allocationPolicyHash: candidateAAllocationPolicyHash
    },
    {
      runId: "candidate_b_split_2_train_degradation",
      runIndex: 3,
      splitId: "split_2",
      splitRole: "train",
      totalReturnRatio: 0.1,
      allocationPolicyHash: candidateBAllocationPolicyHash
    },
    {
      runId: "candidate_a_split_1_validation_degradation",
      runIndex: 4,
      splitId: "split_1",
      splitRole: "validation",
      totalReturnRatio: 0.05,
      allocationPolicyHash: candidateAAllocationPolicyHash
    },
    {
      runId: "candidate_b_split_1_validation_degradation",
      runIndex: 5,
      splitId: "split_1",
      splitRole: "validation",
      totalReturnRatio: 0,
      allocationPolicyHash: candidateBAllocationPolicyHash
    },
    {
      runId: "candidate_a_split_2_validation_degradation",
      runIndex: 6,
      splitId: "split_2",
      splitRole: "validation",
      totalReturnRatio: -0.02,
      allocationPolicyHash: candidateAAllocationPolicyHash
    },
    {
      runId: "candidate_b_split_2_validation_degradation",
      runIndex: 7,
      splitId: "split_2",
      splitRole: "validation",
      totalReturnRatio: -0.03,
      allocationPolicyHash: candidateBAllocationPolicyHash
    }
  ];

  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 4,
    records: entries.map((entry) =>
      record(
        entry.runId,
        entry.runIndex,
        "completed",
        "bull",
        entry.totalReturnRatio,
        Math.round(1_000_000 * (1 + entry.totalReturnRatio)),
        0,
        entry.splitRole,
        entry.splitId
      )
    ),
    selectionTrials: entries.map((entry) =>
      trial(
        entry.runId,
        entry.runIndex,
        "completed",
        promptHash,
        hash(String(entry.runIndex)),
        1,
        0,
        0,
        entry.totalReturnRatio,
        { allocationPolicyHash: entry.allocationPolicyHash }
      )
    )
  });

  const diagnostics = report.overfittingDiagnostics!;
  const degradationBySplit = new Map(
    diagnostics.holdoutDegradation.map((entry) => [
      entry.splitId,
      entry.degradationFromTrainRatio
    ])
  );

  assert.equal(diagnostics.selectedTrainAverageTotalReturnRatio, 0.2);
  assert.equal(degradationBySplit.get("split_1"), -0.25);
  assert.equal(degradationBySplit.get("split_2"), -0.12);
});

test("batch replay aggregate report does not mark tied holdouts below median", () => {
  const promptHash = hash("t");
  const selectedAllocationPolicyHash = hash("f");
  const peerAllocationPolicyHash = hash("0");

  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    expectedSampledCpcvSplitCount: 2,
    records: [
      record(
        "selected_tie_train",
        0,
        "completed",
        "bull",
        0.2,
        1_200_000,
        0,
        "train",
        "tie_split"
      ),
      record(
        "peer_tie_train",
        1,
        "completed",
        "bull",
        0.1,
        1_100_000,
        0,
        "train",
        "tie_split"
      ),
      record(
        "selected_tie_validation",
        2,
        "completed",
        "bull",
        0,
        1_000_000,
        0,
        "validation",
        "tie_split"
      ),
      record(
        "peer_tie_validation",
        3,
        "completed",
        "bull",
        0,
        1_000_000,
        0,
        "validation",
        "tie_split"
      )
    ],
    selectionTrials: [
      trial(
        "selected_tie_train",
        0,
        "completed",
        promptHash,
        hash("selected_tie_train_config"),
        1,
        0,
        0,
        0.2,
        { allocationPolicyHash: selectedAllocationPolicyHash }
      ),
      trial(
        "peer_tie_train",
        1,
        "completed",
        promptHash,
        hash("peer_tie_train_config"),
        1,
        0,
        0,
        0.1,
        { allocationPolicyHash: peerAllocationPolicyHash }
      ),
      trial(
        "selected_tie_validation",
        2,
        "completed",
        promptHash,
        hash("selected_tie_validation_config"),
        1,
        0,
        0,
        0,
        { allocationPolicyHash: selectedAllocationPolicyHash }
      ),
      trial(
        "peer_tie_validation",
        3,
        "completed",
        promptHash,
        hash("peer_tie_validation_config"),
        1,
        0,
        0,
        0,
        { allocationPolicyHash: peerAllocationPolicyHash }
      )
    ]
  });

  const diagnostics = report.overfittingDiagnostics!;
  const validationDegradation = diagnostics.holdoutDegradation.find(
    (entry) =>
      entry.splitId === "tie_split" && entry.splitRole === "validation"
  );

  assert.equal(diagnostics.pboLikeScore, 0);
  assert.ok(validationDegradation);
  assert.equal(validationDegradation.candidateCount, 2);
  assert.equal(validationDegradation.selectedAverageTotalReturnRatio, 0);
  assert.equal(validationDegradation.medianCandidateAverageTotalReturnRatio, 0);
  assert.equal(validationDegradation.bestAverageTotalReturnRatio, 0);
  assert.equal(validationDegradation.selectedRank, 2);
  assert.equal(validationDegradation.selectedBelowMedian, false);
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

test("batch replay aggregate report surfaces universe coverage warnings", () => {
  const report = buildBatchReplayAggregateReport({
    generatedAt: new Date("2026-06-12T10:00:00+09:00"),
    sourceUniverseCoveragePath: "data/source/historical-universe-coverage.json",
    universeCoverageReport: universeCoverageReport(),
    records: [record("run_0", 0, "completed", "bull", 0.01, 1_010_000)]
  });
  const rendered = renderBatchReplayAggregateReport(report);

  assert.equal(
    report.sourceUniverseCoveragePath,
    "data/source/historical-universe-coverage.json"
  );
  assert.equal(report.universeCoverage?.status, "insufficient");
  assert.equal(report.universeCoverage?.availableRequiredSymbolCount, 1);
  assert.equal(report.universeCoverage?.missingRequiredSymbolCount, 1);
  assert.equal(report.universeCoverage?.missingRequiredStrategyBucketCount, 0);
  assert.deepEqual(report.universeCoverage?.availableStrategyBucketSymbolCounts, {
    long_term: 1
  });
  assert.match(
    report.universeCoverage?.warnings.join("\n") ?? "",
    /universe selection bias warning/
  );
  assert.match(
    report.universeCoverage?.warnings.join("\n") ?? "",
    /REQUIRED_UNIVERSE_SYMBOL_MISSING/
  );
  assert.match(rendered, /## Universe Coverage/);
  assert.match(rendered, /source_universe_coverage_path/);
  assert.match(rendered, /available_strategy_bucket_symbol_counts/);
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
  validationSplitRole: ValidationSplitRole | null = null,
  validationSplitId = "wf_report"
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
            splitId: validationSplitId,
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
    validationRoleRegimePlan: null,
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
            },
            costSummary: costSummary()
          }
        : null,
    reportPath:
      status === "completed" ? `data/batch/${runId}/historical-replay-report.json` : null,
    error: status === "failed" ? "fixture failure" : null,
    skipReason: status === "skipped" ? "DATA_INSUFFICIENT" : null
  };
}

function plannedRecord(
  value: BatchReplayRunRecord,
  planIndex: number,
  evidenceHashCharacter: string,
  sharedRoles: ValidationSplitRole[],
  planSummary = {
    plannedRunCount: 3,
    globalUniqueEvidenceGroupCount: 2,
    crossRoleSharedEvidenceGroupCount: 1
  }
): BatchReplayRunRecord {
  if (value.validationSplit === null) {
    throw new Error("planned record fixture requires a validation split");
  }
  const validationSplit = plannedValidationSplit(value);
  const candidateHash = hash(evidenceHashCharacter);
  return {
    ...value,
    validationSplit,
    windowSampling: {
      mode: "validation_role_regime_plan",
      targetRegime: value.marketRegime.label,
      targetCandidateCount: 1,
      fallbackReason: null
    },
    validationRoleRegimePlan: {
      samplingMode: "validation_role_regime_plan",
      planHash: hash("a"),
      ...planSummary,
      planIndex,
      runKey: `plan_${planIndex}`,
      splitRole: validationSplit.splitRole,
      targetRegime: value.marketRegime.label as "bull" | "bear" | "sideways" | "mixed",
      candidateOrdinalWithinRoleRegime: 0,
      candidateHash,
      evidenceGroupHash: candidateHash,
      startAt: value.window.startAt,
      endAt: value.window.endAt,
      sourceAssignments: [validationSplit],
      executionAssignment: validationSplit,
      sharedAcrossRoles: sharedRoles.length > 1,
      sharedRoles
    }
  };
}

function plannedValidationSplit(
  value: BatchReplayRunRecord
): NonNullable<BatchReplayRunRecord["validationSplit"]> {
  const split = value.validationSplit!;
  if (split.splitRole === "train") {
    return {
      ...split,
      trainStart: value.window.startAt,
      trainEnd: value.window.endAt,
      validationStart: "2025-02-01T00:00:00.000Z",
      validationEnd: "2025-02-28T23:59:59.999Z"
    };
  }
  if (split.splitRole === "validation") {
    return {
      ...split,
      trainStart: "2024-11-01T00:00:00.000Z",
      trainEnd: "2024-11-30T23:59:59.999Z",
      validationStart: value.window.startAt,
      validationEnd: value.window.endAt
    };
  }
  return {
    ...split,
    trainStart: "2024-10-01T00:00:00.000Z",
    trainEnd: "2024-10-31T23:59:59.999Z",
    validationStart: "2024-11-01T00:00:00.000Z",
    validationEnd: "2024-11-30T23:59:59.999Z",
    testStart: value.window.startAt,
    testEnd: value.window.endAt
  };
}

function costSummary(
  overrides: Partial<
    NonNullable<BatchReplayRunRecord["summary"]>["costSummary"]
  > = {}
): NonNullable<BatchReplayRunRecord["summary"]>["costSummary"] {
  return {
    feeKrw: 0,
    taxKrw: 0,
    slippageKrw: 0,
    spreadCostKrw: 0,
    impactCostKrw: 0,
    totalCostKrw: 0,
    costModelVersions: ["paper_cost_model.v4"],
    filledCount: 1,
    partialFillCount: 0,
    notModeledLiquidityCount: 0,
    averageParticipationRate: null,
    maxParticipationRate: null,
    byStrategyBucket: [],
    ...overrides
  };
}

function withCostSummary(
  value: BatchReplayRunRecord,
  overrides: Partial<
    NonNullable<BatchReplayRunRecord["summary"]>["costSummary"]
  >
): BatchReplayRunRecord {
  if (value.summary === null) {
    return value;
  }
  return {
    ...value,
    summary: {
      ...value.summary,
      costSummary: costSummary(overrides)
    }
  };
}

function withLegacyBucketlessCostSummary(
  value: BatchReplayRunRecord,
  overrides: Partial<
    NonNullable<BatchReplayRunRecord["summary"]>["costSummary"]
  >
): BatchReplayRunRecord {
  const next = withCostSummary(value, overrides);
  if (next.summary === null) {
    return next;
  }
  const cost = {
    ...next.summary.costSummary
  } as Record<string, unknown>;
  delete cost["byStrategyBucket"];
  return {
    ...next,
    summary: {
      ...next.summary,
      costSummary: cost as unknown as NonNullable<
        BatchReplayRunRecord["summary"]
      >["costSummary"]
    }
  };
}

function withoutCostSummary(value: BatchReplayRunRecord): BatchReplayRunRecord {
  if (value.summary === null) {
    return value;
  }
  const summary = { ...value.summary };
  delete summary.costSummary;
  return {
    ...value,
    summary
  };
}

function nonCompletedRecordWithSummary(
  value: BatchReplayRunRecord,
  status: "skipped" | "failed",
  costOverrides: Partial<
    NonNullable<BatchReplayRunRecord["summary"]>["costSummary"]
  >
): BatchReplayRunRecord {
  if (value.summary === null) {
    return value;
  }
  return {
    ...value,
    status,
    completedAt: null,
    skippedAt: status === "skipped" ? "2026-06-12T01:00:01.000Z" : null,
    failedAt: status === "failed" ? "2026-06-12T01:00:01.000Z" : null,
    reportPath: null,
    error: status === "failed" ? "fixture failure" : null,
    skipReason: status === "skipped" ? "DATA_INSUFFICIENT" : null,
    summary: {
      ...value.summary,
      costSummary: costSummary(costOverrides)
    }
  };
}

function withDataAvailabilityIssues(
  value: BatchReplayRunRecord,
  issues: string[]
): BatchReplayRunRecord {
  return {
    ...value,
    dataAvailability: {
      ...value.dataAvailability,
      status: issues.length === 0 ? "available" : "insufficient",
      issues
    }
  };
}

function universeCoverageReport(
  overrides: Partial<HistoricalUniverseCoverageReport> = {}
): HistoricalUniverseCoverageReport {
  return {
    mode: "paper_only",
    universeId: "test-universe",
    status: "insufficient",
    rangeStart: "2025-01-01T00:00:00.000Z",
    rangeEnd: "2025-01-31T14:59:59.999Z",
    timezoneOffsetMinutes: 540,
    expectedMonths: ["2025-01"],
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 2,
    minAvailableMarketSymbolCounts: { KR: 2 },
    minAvailableAssetTypeSymbolCounts: { STOCK: 2 },
    minAvailableStrategyBucketSymbolCounts: { long_term: 1 },
    requireOptionalSymbols: false,
    requiredMarkets: ["KR"],
    requiredAssetTypes: ["STOCK"],
    requiredStrategyBuckets: ["long_term"],
    availableMarkets: ["KR"],
    availableAssetTypes: ["STOCK"],
    availableStrategyBuckets: ["long_term"],
    availableSymbolCount: 1,
    availableMarketSymbolCounts: { KR: 1 },
    availableAssetTypeSymbolCounts: { STOCK: 1 },
    availableStrategyBucketSymbolCounts: { long_term: 1 },
    missingRequiredMarkets: [],
    missingRequiredAssetTypes: [],
    missingRequiredStrategyBuckets: [],
    insufficientAvailableMarketSymbolCounts: [
      { market: "KR", minimum: 2, available: 1 }
    ],
    insufficientAvailableAssetTypeSymbolCounts: [
      { assetType: "STOCK", minimum: 2, available: 1 }
    ],
    insufficientAvailableStrategyBucketSymbolCounts: [],
    corruptLineCount: 0,
    universeSymbolCount: 3,
    requiredSymbolCount: 2,
    optionalSymbolCount: 1,
    availableRequiredSymbolCount: 1,
    availableOptionalSymbolCount: 0,
    missingRequiredSymbols: [{ market: "KR", symbol: "MISSING_REQUIRED" }],
    missingOptionalSymbols: [{ market: "KR", symbol: "MISSING_OPTIONAL" }],
    insufficientRequiredSymbols: [],
    insufficientOptionalSymbols: [],
    symbolSummaries: [],
    issues: [
      "REQUIRED_UNIVERSE_SYMBOL_MISSING",
      "AVAILABLE_MARKET_SYMBOL_COUNT_BELOW_MINIMUM"
    ],
    disclaimer:
      "Paper-only historical universe coverage. This is not investment advice, not a performance guarantee, and not a live trading signal.",
    ...overrides
  };
}

function metaLabelEvaluationReport(): MetaLabelEvaluationReport {
  return {
    schemaVersion: "meta_label_evaluation.v1",
    generatedAt: "2026-06-12T01:00:00.000Z",
    candidates: [
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_meta_positive",
        sideDecision: "long",
        outcome: "correct_side",
        sizingDirective: null
      },
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_meta_negative",
        sideDecision: "long",
        outcome: "wrong_side",
        sizingDirective: null
      },
      {
        schemaVersion: "meta_label_candidate.v1",
        sourceLabelId: "triple_barrier_meta_unavailable",
        sideDecision: "unknown",
        outcome: "not_actionable",
        sizingDirective: null
      }
    ],
    summary: {
      totalCandidateCount: 3,
      actionableCandidateCount: 2,
      correctSideCount: 1,
      wrongSideCount: 1,
      notActionableCount: 1,
      accuracyRatio: 0.5
    }
  };
}

function tripleBarrierLabelArtifact(): TripleBarrierLabelArtifact {
  return buildTripleBarrierLabelArtifact({
    generatedAt: "2026-06-12T01:00:00.000Z",
    config: {
      referencePriceField: "last",
      profitTakingReturnRatio: 0.05,
      stopLossReturnRatio: 0.03,
      timeBarrierDurationDays: 5
    },
    events: [
      tripleBarrierLabelEvent("label_profit", "TBP"),
      tripleBarrierLabelEvent("label_stop", "TBS"),
      tripleBarrierLabelEvent("label_unavailable", "TBU")
    ],
    priceSnapshots: [
      tripleBarrierSnapshot("TBP", "2026-06-12T00:00:00.000Z", 100),
      tripleBarrierSnapshot("TBP", "2026-06-13T00:00:00.000Z", 106),
      tripleBarrierSnapshot("TBS", "2026-06-12T00:00:00.000Z", 100),
      tripleBarrierSnapshot("TBS", "2026-06-13T00:00:00.000Z", 96)
    ]
  });
}

function tripleBarrierLabelEvent(sampleId: string, symbol: string) {
  return {
    sampleId,
    symbol,
    market: "KR" as const,
    observationAt: "2026-06-12T00:00:00.000Z",
    labelStart: "2026-06-12T00:00:00.000Z"
  };
}

function tripleBarrierSnapshot(
  symbol: string,
  observedAt: string,
  lastPriceKrw: number
): HistoricalMarketSnapshot {
  return {
    snapshotId: `snapshot_${symbol}_${observedAt}`,
    market: "KR",
    symbol,
    observedAt,
    interval: "1d",
    lastPriceKrw,
    volume: 1_000,
    sourceRefs: [`fixture:${symbol}:${observedAt}`],
    createdAt: observedAt
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
  configOverrides: Partial<SelectionTrialRecord["config"]> = {},
  decisionProviderOverrides: Partial<SelectionTrialRecord["decisionProvider"]> = {}
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
      metadataHash: decisionProviderOverrides.metadataHash ?? hash("f")
    },
    config: {
      configHash,
      riskPolicyHash: configOverrides.riskPolicyHash ?? hash("1"),
      allocationPolicyHash: configOverrides.allocationPolicyHash ?? hash("2"),
      marketRegimeAllocationPolicyHash:
        configOverrides.marketRegimeAllocationPolicyHash ?? hash("3"),
      exitPolicyHash: configOverrides.exitPolicyHash ?? hash("4"),
      strategyPreset: configOverrides.strategyPreset ?? null,
      candidateStrategyBucket:
        configOverrides.candidateStrategyBucket ?? null,
      replayCadence: configOverrides.replayCadence ?? null,
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
