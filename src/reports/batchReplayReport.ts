import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import type { BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";

export interface BatchReplayAggregateReportOptions {
  records: BatchReplayRunRecord[];
  generatedAt: Date;
  sourceRunsPath?: string;
  title?: string;
  targetReturnThresholds?: number[];
}

export interface BatchReplayAggregateReport {
  title: string;
  mode: "paper_only";
  generatedAt: string;
  sourceRunsPath: string | null;
  targetReturnThresholds: number[];
  summary: BatchReplayAggregateSummary;
  overall: BatchReplayGroupSummary;
  byRegime: Partial<Record<MarketRegimeLabel, BatchReplayGroupSummary>>;
  disclaimer: string;
}

export interface BatchReplayAggregateSummary {
  runCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  returnSampleCount: number;
  regimeCounts: Partial<Record<MarketRegimeLabel, number>>;
}

export interface BatchReplayGroupSummary {
  key: string;
  runCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  returnSampleCount: number;
  averageTotalReturnRatio: number | null;
  medianTotalReturnRatio: number | null;
  minTotalReturnRatio: number | null;
  maxTotalReturnRatio: number | null;
  winRate: number | null;
  targetReturnHitRates: TargetReturnHitRate[];
  averageFinalVirtualNetWorthKrw: number | null;
  totalTradeCount: number;
  averageTradeCount: number | null;
  totalAiDecisionFailureCount: number;
  totalRejectedCount: number;
  runIds: string[];
}

export interface TargetReturnHitRate {
  threshold: number;
  sampleCount: number;
  hitCount: number;
  hitRate: number | null;
  runIds: string[];
}

const DEFAULT_TARGET_RETURN_THRESHOLDS = [0.15, 0.3];

export function buildBatchReplayAggregateReport(
  options: BatchReplayAggregateReportOptions
): BatchReplayAggregateReport {
  const records = [...options.records].sort(compareRunRecords);
  const targetReturnThresholds = normalizeTargetReturnThresholds(
    options.targetReturnThresholds
  );
  const byRegime: Partial<Record<MarketRegimeLabel, BatchReplayGroupSummary>> = {};

  for (const [label, groupRecords] of groupByRegime(records).entries()) {
    byRegime[label] = summarizeGroup(label, groupRecords, targetReturnThresholds);
  }

  return {
    title: options.title ?? "Batch Replay Paper Aggregate Report",
    mode: "paper_only",
    generatedAt: options.generatedAt.toISOString(),
    sourceRunsPath: options.sourceRunsPath ?? null,
    targetReturnThresholds,
    summary: {
      runCount: records.length,
      completedCount: records.filter((record) => record.status === "completed")
        .length,
      skippedCount: records.filter((record) => record.status === "skipped")
        .length,
      failedCount: records.filter((record) => record.status === "failed").length,
      returnSampleCount: records.filter(hasReturnSample).length,
      regimeCounts: countRegimes(records)
    },
    overall: summarizeGroup("overall", records, targetReturnThresholds),
    byRegime,
    disclaimer: batchAggregateDisclaimer()
  };
}

export function renderBatchReplayAggregateReport(
  report: BatchReplayAggregateReport
): string {
  const lines = [
    `# ${report.title}`,
    "",
    `mode: ${report.mode}`,
    `generated_at: ${report.generatedAt}`,
    `source_runs_path: ${report.sourceRunsPath ?? "null"}`,
    `target_return_thresholds: ${JSON.stringify(report.targetReturnThresholds)}`,
    "",
    "## Summary",
    `run_count: ${report.summary.runCount}`,
    `completed_count: ${report.summary.completedCount}`,
    `skipped_count: ${report.summary.skippedCount}`,
    `failed_count: ${report.summary.failedCount}`,
    `return_sample_count: ${report.summary.returnSampleCount}`,
    `regime_counts: ${JSON.stringify(report.summary.regimeCounts)}`,
    "",
    "## Overall",
    renderGroup(report.overall),
    "",
    "## By Regime",
    ...Object.entries(report.byRegime).flatMap(([label, group]) => [
      `### ${label}`,
      renderGroup(group),
      ""
    ]),
    "## Disclaimer",
    report.disclaimer
  ];

  return lines.join("\n");
}

function summarizeGroup(
  key: string,
  records: BatchReplayRunRecord[],
  targetReturnThresholds: number[]
): BatchReplayGroupSummary {
  const completed = records.filter((record) => record.status === "completed");
  const returnSamples = completed.filter(hasReturnSample);
  const returns = returnSamples.map((record) => record.summary!.totalReturnRatio!);
  const finalNetWorthValues = completed
    .map((record) => record.summary?.finalVirtualNetWorthKrw ?? null)
    .filter((value): value is number => value !== null);
  const tradeCounts = completed.map((record) => record.summary?.tradeCount ?? 0);
  const aiDecisionFailureCounts = completed.map(
    (record) => record.summary?.aiDecisionFailureCount ?? 0
  );
  const rejectedCounts = completed.map(
    (record) => record.summary?.rejectedCount ?? 0
  );

  return {
    key,
    runCount: records.length,
    completedCount: completed.length,
    skippedCount: records.filter((record) => record.status === "skipped").length,
    failedCount: records.filter((record) => record.status === "failed").length,
    returnSampleCount: returns.length,
    averageTotalReturnRatio:
      returns.length === 0 ? null : roundRatio(average(returns)),
    medianTotalReturnRatio:
      returns.length === 0 ? null : roundRatio(median(returns)),
    minTotalReturnRatio: returns.length === 0 ? null : Math.min(...returns),
    maxTotalReturnRatio: returns.length === 0 ? null : Math.max(...returns),
    winRate:
      returns.length === 0
        ? null
        : roundRatio(returns.filter((value) => value > 0).length / returns.length),
    targetReturnHitRates: targetReturnThresholds.map((threshold) =>
      targetReturnHitRate(threshold, returnSamples)
    ),
    averageFinalVirtualNetWorthKrw:
      finalNetWorthValues.length === 0
        ? null
        : Math.round(average(finalNetWorthValues)),
    totalTradeCount: tradeCounts.reduce((sum, value) => sum + value, 0),
    averageTradeCount:
      tradeCounts.length === 0 ? null : roundRatio(average(tradeCounts)),
    totalAiDecisionFailureCount: aiDecisionFailureCounts.reduce(
      (sum, value) => sum + value,
      0
    ),
    totalRejectedCount: rejectedCounts.reduce((sum, value) => sum + value, 0),
    runIds: records.map((record) => record.runId)
  };
}

function targetReturnHitRate(
  threshold: number,
  returnSamples: BatchReplayRunRecord[]
): TargetReturnHitRate {
  const hitRecords = returnSamples.filter(
    (record) => record.summary!.totalReturnRatio! >= threshold
  );
  return {
    threshold,
    sampleCount: returnSamples.length,
    hitCount: hitRecords.length,
    hitRate:
      returnSamples.length === 0
        ? null
        : roundRatio(hitRecords.length / returnSamples.length),
    runIds: hitRecords.map((record) => record.runId)
  };
}

function groupByRegime(
  records: BatchReplayRunRecord[]
): Map<MarketRegimeLabel, BatchReplayRunRecord[]> {
  const groups = new Map<MarketRegimeLabel, BatchReplayRunRecord[]>();
  for (const record of records) {
    const label = record.marketRegime.label;
    const existing = groups.get(label);
    if (existing === undefined) {
      groups.set(label, [record]);
      continue;
    }
    existing.push(record);
  }
  return groups;
}

function countRegimes(
  records: BatchReplayRunRecord[]
): Partial<Record<MarketRegimeLabel, number>> {
  const counts: Partial<Record<MarketRegimeLabel, number>> = {};
  for (const record of records) {
    const label = record.marketRegime.label;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function hasReturnSample(record: BatchReplayRunRecord): boolean {
  return (
    record.status === "completed" &&
    record.summary?.totalReturnRatio !== null &&
    record.summary?.totalReturnRatio !== undefined
  );
}

function compareRunRecords(
  left: BatchReplayRunRecord,
  right: BatchReplayRunRecord
): number {
  if (left.runIndex !== right.runIndex) {
    return left.runIndex - right.runIndex;
  }
  return left.runId.localeCompare(right.runId);
}

function renderGroup(group: BatchReplayGroupSummary): string {
  return [
    `run_count: ${group.runCount}`,
    `completed_count: ${group.completedCount}`,
    `skipped_count: ${group.skippedCount}`,
    `failed_count: ${group.failedCount}`,
    `return_sample_count: ${group.returnSampleCount}`,
    `average_total_return_ratio: ${formatNullable(group.averageTotalReturnRatio)}`,
    `median_total_return_ratio: ${formatNullable(group.medianTotalReturnRatio)}`,
    `win_rate: ${formatNullable(group.winRate)}`,
    `target_return_hit_rates: ${JSON.stringify(group.targetReturnHitRates)}`,
    `average_final_virtual_net_worth_krw: ${formatNullable(group.averageFinalVirtualNetWorthKrw)}`,
    `total_ai_decision_failure_count: ${group.totalAiDecisionFailureCount}`
  ].join("\n");
}

function normalizeTargetReturnThresholds(values: number[] | undefined): number[] {
  const rawValues = values ?? DEFAULT_TARGET_RETURN_THRESHOLDS;
  if (rawValues.length === 0) {
    throw new Error("targetReturnThresholds must not be empty");
  }
  const normalized = rawValues.map((value) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("targetReturnThresholds must be non-negative numbers");
    }
    return roundRatio(value);
  });
  return Array.from(new Set(normalized)).sort((left, right) => left - right);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[midpoint]!;
  }
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatNullable(value: number | null): string {
  return value === null ? "null" : String(value);
}

function batchAggregateDisclaimer(): string {
  return [
    "Batch replay aggregate reports are paper-only.",
    "They are not investment advice, guaranteed performance, or live trading signals."
  ].join(" ");
}
