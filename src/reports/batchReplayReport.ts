import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import type { AssetType, Market } from "../domain/schemas.js";
import type {
  SelectionTrialRecord,
  SelectionTrialRunStatus
} from "../replay/selectionTrialLog.js";
import type { ValidationSplitRole } from "../replay/validationProtocol.js";
import type { BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";

export interface BatchReplayAggregateReportOptions {
  records: BatchReplayRunRecord[];
  selectionTrials?: SelectionTrialRecord[];
  generatedAt: Date;
  sourceRunsPath?: string;
  sourceSelectionTrialsPath?: string;
  title?: string;
  targetReturnThresholds?: number[];
}

export interface BatchReplayAggregateReport {
  title: string;
  mode: "paper_only";
  generatedAt: string;
  sourceRunsPath: string | null;
  sourceSelectionTrialsPath: string | null;
  targetReturnThresholds: number[];
  summary: BatchReplayAggregateSummary;
  trialSummary: BatchReplaySelectionTrialSummary | null;
  overall: BatchReplayGroupSummary;
  byRegime: Partial<Record<MarketRegimeLabel, BatchReplayGroupSummary>>;
  byValidationSplitRole: Partial<
    Record<ValidationSplitRole, BatchReplayGroupSummary>
  >;
  disclaimer: string;
}

export interface BatchReplayAggregateSummary {
  runCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  returnSampleCount: number;
  regimeCounts: Partial<Record<MarketRegimeLabel, number>>;
  regimeCountsByMarket: Partial<
    Record<Market, Partial<Record<MarketRegimeLabel, number>>>
  >;
  validationSplitRoleCounts: Partial<Record<ValidationSplitRole, number>>;
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
  averageExposureRatio: number | null;
  averageCashRatio: number | null;
  averageTimeInMarketRatio: number | null;
  averageFinalCashRatio: number | null;
  averageFinalPositionRatio: number | null;
  averageTargetExposureRatio: number | null;
  averageTargetExposureGapRatio: number | null;
  averageFinalTargetExposureGapRatio: number | null;
  averageFinalExposureByMarketKrw: Partial<Record<Market, number>>;
  averageFinalExposureByAssetTypeKrw: Partial<Record<AssetType | "UNKNOWN", number>>;
  totalTradeCount: number;
  averageTradeCount: number | null;
  totalAiDecisionFailureCount: number;
  totalRejectedCount: number;
  totalMeaningfulRejectCount: number;
  totalDustRejectCount: number;
  runIds: string[];
}

export interface BatchReplaySelectionTrialSummary {
  trialCount: number;
  selectedCount: number;
  unselectedCount: number;
  statusCounts: Partial<Record<SelectionTrialRunStatus, number>>;
  aiDecisionFailureTrialCount: number;
  rejectedTrialCount: number;
  noTradeTrialCount: number;
  decisionProviderModes: BatchReplaySelectionTrialBucket[];
  promptHashes: BatchReplaySelectionTrialBucket[];
  configHashes: BatchReplaySelectionTrialBucket[];
  riskPolicyHashes: BatchReplaySelectionTrialBucket[];
  exitPolicyHashes: BatchReplaySelectionTrialBucket[];
  riskProfiles: BatchReplaySelectionTrialBucket[];
  runIds: string[];
}

export interface BatchReplaySelectionTrialBucket {
  key: string | null;
  count: number;
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
  const selectionTrials =
    options.selectionTrials === undefined
      ? null
      : [...options.selectionTrials].sort(compareSelectionTrials);
  const targetReturnThresholds = normalizeTargetReturnThresholds(
    options.targetReturnThresholds
  );
  const byRegime: Partial<Record<MarketRegimeLabel, BatchReplayGroupSummary>> = {};
  const byValidationSplitRole: Partial<
    Record<ValidationSplitRole, BatchReplayGroupSummary>
  > = {};

  for (const [label, groupRecords] of groupByRegime(records).entries()) {
    byRegime[label] = summarizeGroup(label, groupRecords, targetReturnThresholds);
  }
  for (const [role, groupRecords] of groupByValidationSplitRole(records)) {
    byValidationSplitRole[role] = summarizeGroup(
      role,
      groupRecords,
      targetReturnThresholds
    );
  }

  return {
    title: options.title ?? "Batch Replay Paper Aggregate Report",
    mode: "paper_only",
    generatedAt: options.generatedAt.toISOString(),
    sourceRunsPath: options.sourceRunsPath ?? null,
    sourceSelectionTrialsPath:
      selectionTrials === null ? null : options.sourceSelectionTrialsPath ?? null,
    targetReturnThresholds,
    summary: {
      runCount: records.length,
      completedCount: records.filter(isCompletedRunRecord).length,
      skippedCount: records.filter((record) => record.status === "skipped")
        .length,
      failedCount: records.filter((record) => record.status === "failed").length,
      returnSampleCount: records.filter(hasReturnSample).length,
      regimeCounts: countRegimes(records),
      regimeCountsByMarket: countRegimesByMarket(records),
      validationSplitRoleCounts: countValidationSplitRoles(records)
    },
    trialSummary:
      selectionTrials === null ? null : summarizeSelectionTrials(selectionTrials),
    overall: summarizeGroup("overall", records, targetReturnThresholds),
    byRegime,
    byValidationSplitRole,
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
    `source_selection_trials_path: ${
      report.sourceSelectionTrialsPath ?? "null"
    }`,
    `target_return_thresholds: ${JSON.stringify(report.targetReturnThresholds)}`,
    "",
    "## Summary",
    `run_count: ${report.summary.runCount}`,
    `completed_count: ${report.summary.completedCount}`,
    `skipped_count: ${report.summary.skippedCount}`,
    `failed_count: ${report.summary.failedCount}`,
    `return_sample_count: ${report.summary.returnSampleCount}`,
    `regime_counts: ${JSON.stringify(report.summary.regimeCounts)}`,
    `regime_counts_by_market: ${JSON.stringify(report.summary.regimeCountsByMarket)}`,
    `validation_split_role_counts: ${JSON.stringify(report.summary.validationSplitRoleCounts)}`,
    "",
    "## Selection Trials",
    renderSelectionTrialSummary(report.trialSummary),
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
    "## By Validation Split Role",
    ...Object.entries(report.byValidationSplitRole).flatMap(([role, group]) => [
      `### ${role}`,
      renderGroup(group),
      ""
    ]),
    "## Disclaimer",
    report.disclaimer
  ];

  return lines.join("\n");
}

function summarizeSelectionTrials(
  trials: SelectionTrialRecord[]
): BatchReplaySelectionTrialSummary {
  const selectedCount = trials.filter(isSelectedTrial).length;

  return {
    trialCount: trials.length,
    selectedCount,
    unselectedCount: trials.length - selectedCount,
    statusCounts: countTrialStatuses(trials),
    aiDecisionFailureTrialCount: trials.filter(
      (trial) => trial.outcome.aiDecisionFailureCount > 0
    ).length,
    rejectedTrialCount: trials.filter((trial) => trial.outcome.rejectedCount > 0)
      .length,
    noTradeTrialCount: trials.filter((trial) => trial.outcome.tradeCount === 0)
      .length,
    decisionProviderModes: bucketSelectionTrials(
      trials,
      (trial) => trial.decisionProvider.mode
    ),
    promptHashes: bucketSelectionTrials(
      trials,
      (trial) => trial.decisionProvider.promptHash
    ),
    configHashes: bucketSelectionTrials(
      trials,
      (trial) => trial.config.configHash
    ),
    riskPolicyHashes: bucketSelectionTrials(
      trials,
      (trial) => trial.config.riskPolicyHash
    ),
    exitPolicyHashes: bucketSelectionTrials(
      trials,
      (trial) => trial.config.exitPolicyHash
    ),
    riskProfiles: bucketSelectionTrials(
      trials,
      (trial) => trial.config.riskProfile
    ),
    runIds: trials.map((trial) => trial.runId)
  };
}

function countTrialStatuses(
  trials: SelectionTrialRecord[]
): Partial<Record<SelectionTrialRunStatus, number>> {
  const counts: Partial<Record<SelectionTrialRunStatus, number>> = {};
  for (const trial of trials) {
    counts[trial.status] = (counts[trial.status] ?? 0) + 1;
  }
  return counts;
}

function bucketSelectionTrials(
  trials: SelectionTrialRecord[],
  keyFor: (trial: SelectionTrialRecord) => string | null
): BatchReplaySelectionTrialBucket[] {
  const buckets = new Map<
    string,
    { key: string | null; runIds: string[] }
  >();

  for (const trial of trials) {
    const key = keyFor(trial);
    const bucketKey = key === null ? "null:" : `value:${key}`;
    const current = buckets.get(bucketKey) ?? { key, runIds: [] };
    current.runIds.push(trial.runId);
    buckets.set(bucketKey, current);
  }

  return Array.from(buckets.values())
    .map((bucket) => ({
      key: bucket.key,
      count: bucket.runIds.length,
      runIds: bucket.runIds
    }))
    .sort(compareSelectionTrialBuckets);
}

function isSelectedTrial(trial: SelectionTrialRecord): boolean {
  return (trial.selection as { selected?: boolean }).selected === true;
}

function summarizeGroup(
  key: string,
  records: BatchReplayRunRecord[],
  targetReturnThresholds: number[]
): BatchReplayGroupSummary {
  const completed = records.filter(isCompletedRunRecord);
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
  const meaningfulRejectedCounts = completed.map(
    (record) =>
      record.summary?.meaningfulRejectCount ?? record.summary?.rejectedCount ?? 0
  );
  const dustRejectedCounts = completed.map(
    (record) => record.summary?.dustRejectCount ?? 0
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
    averageExposureRatio: averageSummaryRatio(completed, "avgExposureRatio"),
    averageCashRatio: averageSummaryRatio(completed, "avgCashRatio"),
    averageTimeInMarketRatio: averageSummaryRatio(completed, "timeInMarketRatio"),
    averageFinalCashRatio: averageSummaryRatio(completed, "finalCashRatio"),
    averageFinalPositionRatio: averageSummaryRatio(
      completed,
      "finalPositionRatio"
    ),
    averageTargetExposureRatio: averageSummaryRatio(
      completed,
      "targetExposureRatio"
    ),
    averageTargetExposureGapRatio: averageSummaryRatio(
      completed,
      "averageTargetExposureGapRatio"
    ),
    averageFinalTargetExposureGapRatio: averageSummaryRatio(
      completed,
      "finalTargetExposureGapRatio"
    ),
    averageFinalExposureByMarketKrw: averageSummaryMap(
      completed,
      "finalExposureByMarketKrw"
    ),
    averageFinalExposureByAssetTypeKrw: averageSummaryMap(
      completed,
      "finalExposureByAssetTypeKrw"
    ),
    totalTradeCount: tradeCounts.reduce((sum, value) => sum + value, 0),
    averageTradeCount:
      tradeCounts.length === 0 ? null : roundRatio(average(tradeCounts)),
    totalAiDecisionFailureCount: aiDecisionFailureCounts.reduce(
      (sum, value) => sum + value,
      0
    ),
    totalRejectedCount: rejectedCounts.reduce((sum, value) => sum + value, 0),
    totalMeaningfulRejectCount: meaningfulRejectedCounts.reduce(
      (sum, value) => sum + value,
      0
    ),
    totalDustRejectCount: dustRejectedCounts.reduce(
      (sum, value) => sum + value,
      0
    ),
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

function countRegimesByMarket(
  records: BatchReplayRunRecord[]
): Partial<Record<Market, Partial<Record<MarketRegimeLabel, number>>>> {
  const counts: Partial<Record<Market, Partial<Record<MarketRegimeLabel, number>>>> =
    {};
  for (const record of records) {
    for (const [market, regime] of Object.entries(
      record.marketRegimesByMarket ?? {}
    )) {
      const marketKey = market as Market;
      const marketCounts = counts[marketKey] ?? {};
      marketCounts[regime.label] = (marketCounts[regime.label] ?? 0) + 1;
      counts[marketKey] = marketCounts;
    }
  }
  return counts;
}

function groupByValidationSplitRole(
  records: BatchReplayRunRecord[]
): Map<ValidationSplitRole, BatchReplayRunRecord[]> {
  const groups = new Map<ValidationSplitRole, BatchReplayRunRecord[]>();
  for (const record of records) {
    const role = validationSplitRoleForRecord(record);
    if (role === null) {
      continue;
    }
    const existing = groups.get(role);
    if (existing === undefined) {
      groups.set(role, [record]);
      continue;
    }
    existing.push(record);
  }
  return groups;
}

function countValidationSplitRoles(
  records: BatchReplayRunRecord[]
): Partial<Record<ValidationSplitRole, number>> {
  const counts: Partial<Record<ValidationSplitRole, number>> = {};
  for (const record of records) {
    const role = validationSplitRoleForRecord(record);
    if (role === null) {
      continue;
    }
    counts[role] = (counts[role] ?? 0) + 1;
  }
  return counts;
}

function validationSplitRoleForRecord(
  record: BatchReplayRunRecord
): ValidationSplitRole | null {
  return record.validationSplit?.splitRole ?? null;
}

function hasReturnSample(record: BatchReplayRunRecord): boolean {
  return (
    isCompletedRunRecord(record) &&
    record.summary?.totalReturnRatio !== null &&
    record.summary?.totalReturnRatio !== undefined
  );
}

function isCompletedRunRecord(record: BatchReplayRunRecord): boolean {
  return (
    record.status === "completed" ||
    record.status === "completed_with_failures"
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

function compareSelectionTrials(
  left: SelectionTrialRecord,
  right: SelectionTrialRecord
): number {
  if (left.runIndex !== right.runIndex) {
    return left.runIndex - right.runIndex;
  }
  return left.runId.localeCompare(right.runId);
}

function compareSelectionTrialBuckets(
  left: BatchReplaySelectionTrialBucket,
  right: BatchReplaySelectionTrialBucket
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  return bucketSortKey(left.key).localeCompare(bucketSortKey(right.key));
}

function bucketSortKey(value: string | null): string {
  return value ?? "\uffff";
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
    `average_exposure_ratio: ${formatNullable(group.averageExposureRatio)}`,
    `average_cash_ratio: ${formatNullable(group.averageCashRatio)}`,
    `average_time_in_market_ratio: ${formatNullable(group.averageTimeInMarketRatio)}`,
    `average_final_cash_ratio: ${formatNullable(group.averageFinalCashRatio)}`,
    `average_final_position_ratio: ${formatNullable(group.averageFinalPositionRatio)}`,
    `average_target_exposure_ratio: ${formatNullable(group.averageTargetExposureRatio)}`,
    `average_target_exposure_gap_ratio: ${formatNullable(group.averageTargetExposureGapRatio)}`,
    `average_final_target_exposure_gap_ratio: ${formatNullable(group.averageFinalTargetExposureGapRatio)}`,
    `average_final_exposure_by_market_krw: ${JSON.stringify(group.averageFinalExposureByMarketKrw)}`,
    `average_final_exposure_by_asset_type_krw: ${JSON.stringify(group.averageFinalExposureByAssetTypeKrw)}`,
    `total_ai_decision_failure_count: ${group.totalAiDecisionFailureCount}`,
    `total_rejected_count: ${group.totalRejectedCount}`,
    `total_meaningful_reject_count: ${group.totalMeaningfulRejectCount}`,
    `total_dust_reject_count: ${group.totalDustRejectCount}`
  ].join("\n");
}

function renderSelectionTrialSummary(
  summary: BatchReplaySelectionTrialSummary | null
): string {
  if (summary === null) {
    return "trial_summary: null";
  }

  return [
    `trial_count: ${summary.trialCount}`,
    `selected_count: ${summary.selectedCount}`,
    `unselected_count: ${summary.unselectedCount}`,
    `status_counts: ${JSON.stringify(summary.statusCounts)}`,
    `ai_decision_failure_trial_count: ${summary.aiDecisionFailureTrialCount}`,
    `rejected_trial_count: ${summary.rejectedTrialCount}`,
    `no_trade_trial_count: ${summary.noTradeTrialCount}`,
    `decision_provider_modes: ${JSON.stringify(summary.decisionProviderModes)}`,
    `prompt_hashes: ${JSON.stringify(summary.promptHashes)}`,
    `config_hashes: ${JSON.stringify(summary.configHashes)}`,
    `risk_policy_hashes: ${JSON.stringify(summary.riskPolicyHashes)}`,
    `exit_policy_hashes: ${JSON.stringify(summary.exitPolicyHashes)}`,
    `risk_profiles: ${JSON.stringify(summary.riskProfiles)}`
  ].join("\n");
}

function averageSummaryRatio(
  records: BatchReplayRunRecord[],
  key:
    | "avgExposureRatio"
    | "avgCashRatio"
    | "timeInMarketRatio"
    | "finalCashRatio"
    | "finalPositionRatio"
    | "targetExposureRatio"
    | "averageTargetExposureGapRatio"
    | "finalTargetExposureGapRatio"
): number | null {
  const values = records
    .map((record) => record.summary?.[key] ?? null)
    .filter((value): value is number => value !== null);
  return values.length === 0 ? null : roundRatio(average(values));
}

function averageSummaryMap(
  records: BatchReplayRunRecord[],
  key: "finalExposureByMarketKrw" | "finalExposureByAssetTypeKrw"
): Partial<Record<string, number>> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const record of records) {
    const values = record.summary?.[key];
    if (values === undefined) {
      continue;
    }
    for (const [entryKey, value] of Object.entries(values)) {
      if (!Number.isFinite(value) || value === 0) {
        continue;
      }
      const current = sums.get(entryKey) ?? { total: 0, count: 0 };
      current.total += value;
      current.count += 1;
      sums.set(entryKey, current);
    }
  }

  return Object.fromEntries(
    Array.from(sums.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([entryKey, value]) => [
        entryKey,
        Math.round(value.total / value.count)
      ])
  );
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
