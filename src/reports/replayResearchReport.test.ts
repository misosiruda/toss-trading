import assert from "node:assert/strict";
import test from "node:test";

import { calculateSharpeValidationReport } from "../analytics/sharpeValidation.js";
import type {
  BatchReplayAggregateReport,
  BatchReplayGroupSummary
} from "./batchReplayReport.js";
import {
  buildReplayResearchReport,
  REPLAY_RESEARCH_REPORT_VERSION
} from "./replayResearchReport.js";

test("replay research report summarizes stored batch aggregate sections", () => {
  const report = buildReplayResearchReport({
    aggregateReport: aggregateReport({
      cpcvPboValidation: cpcvPboValidation()
    }),
    generatedAt: new Date("2026-06-24T09:00:00+09:00")
  });

  assert.equal(report.mode, "paper_only");
  assert.equal(report.reportVersion, REPLAY_RESEARCH_REPORT_VERSION);
  assert.equal(report.runIdentity.runCount, 3);
  assert.equal(report.runIdentity.completedCount, 2);
  assert.equal(report.reproducibilityHashes.promptHashes[0]?.key, "sha256:prompt");
  assert.equal(report.validationProtocol.overfittingDiagnosticStatus, "available");
  assert.equal(report.validationProtocol.pboLikeScore, 1);
  assert.deepEqual(report.validationProtocol.validationSplitRoleCounts, {
    train: 1,
    validation: 1
  });
  assert.equal(report.dataUniverseCoverage.coverageReportStatus, "insufficient");
  assert.equal(report.dataUniverseCoverage.availableRequiredSymbolCount, 1);
  assert.deepEqual(
    report.dataUniverseCoverage.availableStrategyBucketSymbolCounts,
    { long_term: 1 }
  );
  assert.equal(
    report.dataUniverseCoverage.missingRequiredStrategyBucketCount,
    0
  );
  assert.equal(
    report.dataUniverseCoverage.insufficientAvailableStrategyBucketSymbolCount,
    0
  );
  assert.match(
    report.warnings.join("\n"),
    /universe selection bias warning/
  );
  assert.equal(report.promptTrialDistribution.trialCount, 3);
  assert.equal(report.riskAllocationPolicy.riskProfiles[0]?.key, "balanced");
  assert.equal(report.executionAssumptions.paperOnly, true);
  assert.equal(report.executionAssumptions.liveTradingEnabled, false);
  assert.equal(report.executionAssumptions.orderPlacementEnabled, false);
  assert.equal(report.costBreakdown.status, "available");
  assert.equal(report.costBreakdown.totalCostKrw, 30);
  assert.equal(report.costBreakdown.impactCostKrw, 7);
  assert.deepEqual(report.costBreakdown.costModelVersions, [
    "paper_cost_model.v3"
  ]);
  assert.equal(report.exposureBreakdown.averageExposureRatio, 0.42);
  assert.equal(report.regimeBreakdown.length, 2);
  assert.equal(report.bucketBreakdown.validationSplitRoles.length, 2);
  assert.equal(report.providerFailureSummary.totalAiDecisionFailureCount, 2);
  assert.equal(report.riskRejectSummary.totalRejectedCount, 3);
  assert.equal(report.overfittingWarning.holdoutDegradationCount, 1);
  assert.equal(report.sharpeValidation.status, "unavailable");
  assert.equal(report.sharpeValidation.schemaVersion, "sharpe_validation.v1");
  assert.equal(report.sharpeValidation.returnSampleCount, 2);
  assert.equal(report.sharpeValidation.minimumSampleCount, 30);
  assert.equal(
    report.sharpeValidation.deflatedSharpeRatioStatus,
    "insufficient_sample"
  );
  assert.equal(report.sharpeValidation.selectionContext.trialCount, 2);
  assert.match(
    report.sharpeValidation.warnings.join("\n"),
    /INSUFFICIENT_RETURN_SAMPLES/
  );
  assert.match(
    report.sharpeValidation.readOnlyNotice,
    /not a strategy recommendation or performance guarantee/
  );
  assert.equal(report.cpcvPboWarning.status, "sampled");
  assert.equal(report.cpcvPboWarning.pboStatus, "computed");
  assert.equal(report.cpcvPboWarning.pboProbability, 1);
  assert.equal(report.cpcvPboWarning.evaluatedCombinationCount, 2);
  assert.equal(report.cpcvPboWarning.splitPlanAvailable, false);
  assert.match(
    report.cpcvPboWarning.warnings.join("\n"),
    /CPCV_SPLIT_PLAN_UNAVAILABLE/
  );
  assert.match(
    report.cpcvPboWarning.readOnlyNotice,
    /not a strategy recommendation or performance guarantee/
  );
  assert.match(report.disclaimer, /Paper-only/);
  assert.match(report.disclaimer, /not investment advice/);
  assert.match(report.disclaimer, /cannot place live orders/);
});

test("replay research report records unavailable sections when trials are absent", () => {
  const aggregate = aggregateReport({
    trialSummary: null,
    overfittingDiagnostics: null,
    validationSplitRoleCounts: {}
  });
  const report = buildReplayResearchReport({
    aggregateReport: aggregate,
    generatedAt: new Date("2026-06-24T09:00:00+09:00")
  });

  assert.equal(report.promptTrialDistribution.trialCount, null);
  assert.equal(report.validationProtocol.overfittingDiagnosticStatus, "unavailable");
  assert.equal(report.overfittingWarning.status, "unavailable");
  assert.equal(report.cpcvPboWarning.status, "missing");
  assert.match(
    report.cpcvPboWarning.warnings.join("\n"),
    /cpcv_pbo_validation\.v1 artifact is missing/
  );
  assert.match(
    report.warnings.join("\n"),
    /trial distribution unavailable/
  );
  assert.match(
    report.warnings.join("\n"),
    /overfitting diagnostics unavailable/
  );
  assert.match(
    report.warnings.join("\n"),
    /validation split role counts unavailable/
  );
});

test("replay research report treats missing Sharpe validation as unavailable legacy evidence", () => {
  const aggregate = aggregateReport();
  delete (
    aggregate.overall as unknown as {
      sharpeValidation?: BatchReplayGroupSummary["sharpeValidation"];
    }
  ).sharpeValidation;

  const report = buildReplayResearchReport({
    aggregateReport: aggregate,
    generatedAt: new Date("2026-06-24T09:00:00+09:00")
  });

  assert.equal(report.sharpeValidation.status, "missing");
  assert.equal(report.sharpeValidation.schemaVersion, null);
  assert.equal(report.sharpeValidation.returnSampleCount, 0);
  assert.equal(report.sharpeValidation.sampleSharpeStatus, null);
  assert.equal(report.sharpeValidation.deflatedSharpeRatioStatus, null);
  assert.match(
    report.sharpeValidation.warnings.join("\n"),
    /sharpe_validation\.v1 artifact is missing/
  );
});

test("replay research report keeps legacy aggregate cost breakdown unavailable", () => {
  const aggregate = aggregateReport();
  aggregate.overall = {
    ...aggregate.overall,
    costSummary: emptyCostSummary()
  };
  const report = buildReplayResearchReport({
    aggregateReport: aggregate,
    generatedAt: new Date("2026-06-24T09:00:00+09:00")
  });

  assert.equal(report.costBreakdown.status, "unavailable");
  assert.match(
    report.costBreakdown.reason ?? "",
    /per-run execution cost components/
  );
  assert.match(
    report.warnings.join("\n"),
    /cost breakdown unavailable/
  );
});

function aggregateReport(
  overrides: {
    trialSummary?: BatchReplayAggregateReport["trialSummary"];
    overfittingDiagnostics?: BatchReplayAggregateReport["overfittingDiagnostics"];
    cpcvPboValidation?: BatchReplayAggregateReport["cpcvPboValidation"];
    validationSplitRoleCounts?: BatchReplayAggregateReport["summary"]["validationSplitRoleCounts"];
    universeCoverage?: BatchReplayAggregateReport["universeCoverage"];
  } = {}
): BatchReplayAggregateReport {
  const bullGroup = groupSummary("bull", {
    totalAiDecisionFailureCount: 2,
    totalRejectedCount: 2,
    totalMeaningfulRejectCount: 1,
    totalDustRejectCount: 1
  });
  const bearGroup = groupSummary("bear", {
    averageTotalReturnRatio: -0.01,
    winRate: 0,
    totalRejectedCount: 1,
    totalMeaningfulRejectCount: 1
  });

  return {
    title: "Batch Replay Paper Aggregate Report",
    mode: "paper_only",
    generatedAt: "2026-06-24T00:00:00.000Z",
    sourceRunsPath: "data/batch-replay/research/batch-replay-runs.jsonl",
    sourceSelectionTrialsPath:
      "data/batch-replay/research/batch-replay-selection-trials.jsonl",
    sourceUniverseCoveragePath:
      "data/replay-source/historical-universe-coverage.json",
    targetReturnThresholds: [0.15, 0.3],
    summary: {
      runCount: 3,
      completedCount: 2,
      skippedCount: 1,
      failedCount: 0,
      returnSampleCount: 2,
      regimeCounts: { bull: 2, bear: 1 },
      regimeCountsByMarket: { KR: { bull: 1 }, US: { bear: 1 } },
      validationSplitRoleCounts: overrides.validationSplitRoleCounts ?? {
        train: 1,
        validation: 1
      },
      dataAvailabilityIssues: []
    },
    trialSummary:
      overrides.trialSummary === undefined
        ? {
            trialCount: 3,
            selectedCount: 1,
            unselectedCount: 2,
            statusCounts: { completed: 2, skipped: 1 },
            aiDecisionFailureTrialCount: 1,
            rejectedTrialCount: 1,
            noTradeTrialCount: 1,
            decisionProviderModes: [
              { key: "dry_run_fixture", count: 3, runIds: ["run_0", "run_1"] }
            ],
            promptHashes: [
              { key: "sha256:prompt", count: 2, runIds: ["run_0", "run_1"] }
            ],
            configHashes: [
              { key: "sha256:config", count: 2, runIds: ["run_0", "run_1"] }
            ],
            riskPolicyHashes: [
              { key: "sha256:risk", count: 2, runIds: ["run_0", "run_1"] }
            ],
            exitPolicyHashes: [
              { key: "sha256:exit", count: 2, runIds: ["run_0", "run_1"] }
            ],
            riskProfiles: [
              { key: "balanced", count: 3, runIds: ["run_0", "run_1"] }
            ],
            runIds: ["run_0", "run_1", "run_2"]
          }
        : overrides.trialSummary,
    overfittingDiagnostics:
      overrides.overfittingDiagnostics === undefined
        ? {
            validationProtocol: "sampled_cpcv_pbo_like",
            selectionMetric: "total_return_ratio",
            expectedSampledCpcvSplitCount: 2,
            sampledCpcvSplitCount: 2,
            sampledCpcvSplitCountMatchesExpected: true,
            joinedTrialCount: 3,
            candidateCount: 2,
            returnSampleCount: 2,
            splitRoleCounts: { train: 1, validation: 1 },
            splitMetricMatrix: [],
            selectedCandidateKey: "candidate:dry_run_fixture",
            selectedTrainAverageTotalReturnRatio: 0.03,
            pboLikeScore: 1,
            holdoutDegradation: [
              {
                splitId: "split_1",
                splitRole: "validation",
                selectedCandidateKey: "candidate:dry_run_fixture",
                selectedAverageTotalReturnRatio: -0.01,
                selectedRank: 2,
                candidateCount: 2,
                medianCandidateAverageTotalReturnRatio: 0,
                bestAverageTotalReturnRatio: 0.02,
                degradationFromTrainRatio: -0.04,
                selectedBelowMedian: true,
                runIds: ["run_1"]
              }
            ],
            warnings: ["selected candidate degraded in validation holdout"]
          }
        : overrides.overfittingDiagnostics,
    cpcvPboValidation: overrides.cpcvPboValidation ?? null,
    universeCoverage:
      overrides.universeCoverage === undefined
        ? {
            sourcePath: "data/replay-source/historical-universe-coverage.json",
            universeId: "test-universe",
            status: "insufficient",
            rangeStart: "2025-01-01T00:00:00.000Z",
            rangeEnd: "2025-01-31T14:59:59.999Z",
            universeSymbolCount: 3,
            requiredSymbolCount: 2,
            optionalSymbolCount: 1,
            availableSymbolCount: 1,
            availableRequiredSymbolCount: 1,
            availableOptionalSymbolCount: 0,
            missingRequiredSymbolCount: 1,
            missingOptionalSymbolCount: 1,
            insufficientRequiredSymbolCount: 0,
            insufficientOptionalSymbolCount: 0,
            missingRequiredMarketCount: 0,
            missingRequiredAssetTypeCount: 0,
            missingRequiredStrategyBucketCount: 0,
            insufficientAvailableMarketSymbolCount: 1,
            insufficientAvailableAssetTypeSymbolCount: 1,
            insufficientAvailableStrategyBucketSymbolCount: 0,
            corruptLineCount: 0,
            availableMarketSymbolCounts: { KR: 1 },
            availableAssetTypeSymbolCounts: { STOCK: 1 },
            availableStrategyBucketSymbolCounts: { long_term: 1 },
            issues: ["REQUIRED_UNIVERSE_SYMBOL_MISSING"],
            warnings: [
              "universe selection bias warning: coverage status is insufficient for test-universe; available_required_symbols=1/2; available_symbols=1/3"
            ]
          }
        : overrides.universeCoverage,
    overall: groupSummary("overall", {
      runCount: 3,
      completedCount: 2,
      skippedCount: 1,
      returnSampleCount: 2,
      averageExposureRatio: 0.42,
      averageCashRatio: 0.58,
      averageTimeInMarketRatio: 0.7,
      averageTargetExposureRatio: 0.75,
      averageTargetExposureGapRatio: 0.33,
      averageFinalTargetExposureGapRatio: 0.2,
      averageFinalExposureByMarketKrw: { KR: 420_000 },
      averageFinalExposureByAssetTypeKrw: { STOCK: 420_000 },
      totalAiDecisionFailureCount: 2,
      totalRejectedCount: 3,
      totalMeaningfulRejectCount: 2,
      totalDustRejectCount: 1
    }),
    byRegime: { bull: bullGroup, bear: bearGroup },
    byValidationSplitRole: {
      train: groupSummary("train"),
      validation: groupSummary("validation", { averageTotalReturnRatio: -0.01 })
    },
    disclaimer:
      "Batch replay aggregate reports are paper-only. They are not investment advice, guaranteed performance, or live trading signals."
  };
}

function cpcvPboValidation(): NonNullable<
  BatchReplayAggregateReport["cpcvPboValidation"]
> {
  return {
    schemaVersion: "cpcv_pbo_validation.v1",
    status: "sampled",
    generatedAt: "2026-06-24T00:00:00.000Z",
    config: {
      validationProtocol: "combinatorial_purged_cv",
      foldCount: 2,
      testFoldCount: 1,
      purgeDurationDays: 0,
      embargoDurationDays: 0,
      selectionMetric: "total_return_ratio",
      tieBreaker: "candidate_key_asc",
      maxCombinationCount: 2,
      combinationMode: "sampled",
      randomSeed: "replay_research_test_sampled_matrix"
    },
    splitPlan: null,
    performanceMatrix: [],
    selectionLog: [],
    pbo: {
      status: "computed",
      probability: 1,
      evaluatedCombinationCount: 2,
      selectedBelowMedianCount: 2,
      lambdaLogitValues: [-1.0986122886681098],
      methodNotes: ["sampled CPCV/PBO report is shown as warning evidence"]
    },
    warnings: [
      {
        code: "CPCV_SAMPLED_MODE_USED",
        severity: "warning",
        message: "sampled CPCV/PBO validation is not a full CPCV split plan"
      },
      {
        code: "CPCV_SPLIT_PLAN_UNAVAILABLE",
        severity: "warning",
        message: "stored aggregate does not include standalone CPCV split plan"
      }
    ]
  };
}

function groupSummary(
  key: string,
  overrides: Partial<BatchReplayGroupSummary> = {}
): BatchReplayGroupSummary {
  return {
    key,
    runCount: 2,
    completedCount: 2,
    skippedCount: 0,
    failedCount: 0,
    returnSampleCount: 2,
    averageTotalReturnRatio: 0.02,
    medianTotalReturnRatio: 0.02,
    minTotalReturnRatio: -0.01,
    maxTotalReturnRatio: 0.05,
    winRate: 0.5,
    advancedPerformance: {
      formulaVersion: "performance_metrics.v1",
      sampleCount: 2,
      hitRatio: 0.5,
      profitFactor: null,
      averageWinRatio: 0.05,
      averageLossRatio: -0.01,
      tailLossRatio: null,
      sharpeRatio: null,
      sharpeAnnualizationStatus: "not_annualized",
      warnings: []
    },
    sharpeValidation: calculateSharpeValidationReport({
      returns: [0.05, -0.01],
      selectionContext: {
        candidateCount: null,
        trialCount: 2,
        selectedByMetric: null,
        multipleTestingAdjustment: "unknown"
      }
    }),
    targetReturnHitRates: [],
    averageFinalVirtualNetWorthKrw: 1_020_000,
    averageExposureRatio: 0.42,
    averageCashRatio: 0.58,
    averageTimeInMarketRatio: 0.7,
    averageFinalCashRatio: 0.5,
    averageFinalPositionRatio: 0.5,
    averageTargetExposureRatio: 0.75,
    averageTargetExposureGapRatio: 0.33,
    averageFinalTargetExposureGapRatio: 0.2,
    averageFinalExposureByMarketKrw: { KR: 420_000 },
    averageFinalExposureByAssetTypeKrw: { STOCK: 420_000 },
    totalTradeCount: 3,
    averageTradeCount: 1.5,
    costSummary: costSummary(),
    totalAiDecisionFailureCount: 0,
    totalRejectedCount: 0,
    totalMeaningfulRejectCount: 0,
    totalDustRejectCount: 0,
    runIds: ["run_0", "run_1"],
    ...overrides
  };
}

function costSummary(): BatchReplayGroupSummary["costSummary"] {
  return {
    sampleCount: 2,
    tradeCount: 3,
    feeKrw: 11,
    taxKrw: 2,
    slippageKrw: 4,
    spreadCostKrw: 6,
    impactCostKrw: 7,
    totalCostKrw: 30,
    averageCostPerRunKrw: 15,
    averageCostPerTradeKrw: 10,
    filledCount: 2,
    partialFillCount: 1,
    notModeledLiquidityCount: 0,
    averageRunParticipationRate: 0.15,
    maxParticipationRate: 0.25,
    costModelVersions: ["paper_cost_model.v3"],
    runIds: ["run_0", "run_1"]
  };
}

function emptyCostSummary(): BatchReplayGroupSummary["costSummary"] {
  return {
    sampleCount: 0,
    tradeCount: 0,
    feeKrw: 0,
    taxKrw: 0,
    slippageKrw: 0,
    spreadCostKrw: 0,
    impactCostKrw: 0,
    totalCostKrw: 0,
    averageCostPerRunKrw: null,
    averageCostPerTradeKrw: null,
    filledCount: 0,
    partialFillCount: 0,
    notModeledLiquidityCount: 0,
    averageRunParticipationRate: null,
    maxParticipationRate: null,
    costModelVersions: [],
    runIds: []
  };
}
