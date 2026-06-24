import assert from "node:assert/strict";
import test from "node:test";

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
    aggregateReport: aggregateReport(),
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
  assert.equal(report.promptTrialDistribution.trialCount, 3);
  assert.equal(report.riskAllocationPolicy.riskProfiles[0]?.key, "balanced");
  assert.equal(report.executionAssumptions.paperOnly, true);
  assert.equal(report.executionAssumptions.liveTradingEnabled, false);
  assert.equal(report.executionAssumptions.orderPlacementEnabled, false);
  assert.equal(report.costBreakdown.status, "unavailable");
  assert.equal(report.exposureBreakdown.averageExposureRatio, 0.42);
  assert.equal(report.regimeBreakdown.length, 2);
  assert.equal(report.bucketBreakdown.validationSplitRoles.length, 2);
  assert.equal(report.providerFailureSummary.totalAiDecisionFailureCount, 2);
  assert.equal(report.riskRejectSummary.totalRejectedCount, 3);
  assert.equal(report.overfittingWarning.holdoutDegradationCount, 1);
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

function aggregateReport(
  overrides: {
    trialSummary?: BatchReplayAggregateReport["trialSummary"];
    overfittingDiagnostics?: BatchReplayAggregateReport["overfittingDiagnostics"];
    validationSplitRoleCounts?: BatchReplayAggregateReport["summary"]["validationSplitRoleCounts"];
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
      }
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
    totalAiDecisionFailureCount: 0,
    totalRejectedCount: 0,
    totalMeaningfulRejectCount: 0,
    totalDustRejectCount: 0,
    runIds: ["run_0", "run_1"],
    ...overrides
  };
}
