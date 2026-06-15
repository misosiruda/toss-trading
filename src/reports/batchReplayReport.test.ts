import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketRegimeClassification,
  MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
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
  aiDecisionFailureCount = 0
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
    summary:
      status === "completed"
        ? {
            finalVirtualNetWorthKrw: finalVirtualNetWorthKrw ?? 1_000_000,
            totalReturnRatio,
            tradeCount: 1,
            decisionProviderCallCount: 1,
            aiDecisionFailureCount,
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
