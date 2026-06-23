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
  expectedSampledCpcvSplitCount?: number;
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
  overfittingDiagnostics: BatchReplayOverfittingDiagnostics | null;
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

export interface BatchReplayOverfittingDiagnostics {
  validationProtocol: "sampled_cpcv_pbo_like";
  selectionMetric: "total_return_ratio";
  expectedSampledCpcvSplitCount: number | null;
  sampledCpcvSplitCount: number;
  sampledCpcvSplitCountMatchesExpected: boolean | null;
  joinedTrialCount: number;
  candidateCount: number;
  returnSampleCount: number;
  splitRoleCounts: Partial<Record<ValidationSplitRole, number>>;
  splitMetricMatrix: BatchReplaySplitMetricRow[];
  selectedCandidateKey: string | null;
  selectedTrainAverageTotalReturnRatio: number | null;
  pboLikeScore: number | null;
  holdoutDegradation: BatchReplayHoldoutDegradation[];
  warnings: string[];
}

export interface BatchReplaySplitMetricRow {
  candidateKey: string;
  decisionProviderMode: string;
  decisionProviderMetadataHash: string;
  promptHash: string | null;
  configHashes: Array<string | null>;
  riskPolicyHash: string;
  allocationPolicyHash: string;
  marketRegimeAllocationPolicyHash: string;
  exitPolicyHash: string;
  riskProfile: string | null;
  roleMetrics: Partial<Record<ValidationSplitRole, BatchReplayRoleMetric>>;
  splitMetrics: BatchReplaySplitMetric[];
}

export interface BatchReplayRoleMetric {
  runCount: number;
  returnSampleCount: number;
  averageTotalReturnRatio: number | null;
  medianTotalReturnRatio: number | null;
  runIds: string[];
}

export interface BatchReplaySplitMetric {
  splitId: string;
  splitRole: ValidationSplitRole;
  metric: BatchReplayRoleMetric;
}

export interface BatchReplayHoldoutDegradation {
  splitId: string;
  splitRole: Exclude<ValidationSplitRole, "train">;
  selectedCandidateKey: string;
  selectedAverageTotalReturnRatio: number | null;
  selectedRank: number | null;
  candidateCount: number;
  medianCandidateAverageTotalReturnRatio: number | null;
  bestAverageTotalReturnRatio: number | null;
  degradationFromTrainRatio: number | null;
  selectedBelowMedian: boolean | null;
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
  const expectedSampledCpcvSplitCount = normalizeOptionalNonNegativeInteger(
    options.expectedSampledCpcvSplitCount,
    "expectedSampledCpcvSplitCount"
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
    overfittingDiagnostics:
      selectionTrials === null && expectedSampledCpcvSplitCount === null
        ? null
        : summarizeOverfittingDiagnostics({
            records,
            trials: selectionTrials ?? [],
            expectedSampledCpcvSplitCount
          }),
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
    "## Overfitting Diagnostics",
    renderOverfittingDiagnostics(report.overfittingDiagnostics),
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

interface JoinedSelectionTrial {
  trial: SelectionTrialRecord;
  splitId: string;
  splitRole: ValidationSplitRole;
  totalReturnRatio: number | null;
}

function summarizeOverfittingDiagnostics(options: {
  records: BatchReplayRunRecord[];
  trials: SelectionTrialRecord[];
  expectedSampledCpcvSplitCount: number | null;
}): BatchReplayOverfittingDiagnostics {
  const joinedTrials = joinSelectionTrialsToValidationSplits(
    options.records,
    options.trials
  );
  const splitMetricMatrix = buildSplitMetricMatrix(joinedTrials);
  const sampledCpcvSplitCount = countSampledCpcvSplits(joinedTrials);
  const sampledCpcvSplitCountMatchesExpected =
    options.expectedSampledCpcvSplitCount === null
      ? null
      : sampledCpcvSplitCount === options.expectedSampledCpcvSplitCount;
  const selectedCandidate = selectBestTrainCandidate(splitMetricMatrix);
  const selectedTrainMetric = selectedCandidate?.roleMetrics.train ?? null;
  const holdoutDegradation =
    selectedCandidate === null
      ? []
      : buildHoldoutDegradation(splitMetricMatrix, selectedCandidate);
  const warnings = overfittingDiagnosticWarnings({
    joinedTrialCount: joinedTrials.length,
    candidateCount: splitMetricMatrix.length,
    selectedCandidate,
    holdoutDegradation,
    sampledCpcvSplitCount,
    expectedSampledCpcvSplitCount: options.expectedSampledCpcvSplitCount,
    sampledCpcvSplitCountMatchesExpected
  });

  return {
    validationProtocol: "sampled_cpcv_pbo_like",
    selectionMetric: "total_return_ratio",
    expectedSampledCpcvSplitCount: options.expectedSampledCpcvSplitCount,
    sampledCpcvSplitCount,
    sampledCpcvSplitCountMatchesExpected,
    joinedTrialCount: joinedTrials.length,
    candidateCount: splitMetricMatrix.length,
    returnSampleCount: joinedTrials.filter(
      (trial) => trial.totalReturnRatio !== null
    ).length,
    splitRoleCounts: countJoinedTrialSplitRoles(joinedTrials),
    splitMetricMatrix,
    selectedCandidateKey: selectedCandidate?.candidateKey ?? null,
    selectedTrainAverageTotalReturnRatio:
      selectedTrainMetric?.averageTotalReturnRatio ?? null,
    pboLikeScore: pboLikeScore(splitMetricMatrix, holdoutDegradation),
    holdoutDegradation,
    warnings
  };
}

function joinSelectionTrialsToValidationSplits(
  records: BatchReplayRunRecord[],
  trials: SelectionTrialRecord[]
): JoinedSelectionTrial[] {
  const recordsByRunId = new Map(records.map((record) => [record.runId, record]));
  const joined: JoinedSelectionTrial[] = [];

  for (const trial of trials) {
    const record = recordsByRunId.get(trial.runId);
    const validationSplit = record?.validationSplit ?? null;
    if (record === undefined || validationSplit === null) {
      continue;
    }
    joined.push({
      trial,
      splitId: validationSplit.splitId,
      splitRole: validationSplit.splitRole,
      totalReturnRatio:
        trial.outcome.totalReturnRatio ?? record.summary?.totalReturnRatio ?? null
    });
  }

  return joined.sort((left, right) => {
    if (left.trial.runIndex !== right.trial.runIndex) {
      return left.trial.runIndex - right.trial.runIndex;
    }
    return left.trial.runId.localeCompare(right.trial.runId);
  });
}

function buildSplitMetricMatrix(
  joinedTrials: JoinedSelectionTrial[]
): BatchReplaySplitMetricRow[] {
  const candidateBuckets = new Map<string, JoinedSelectionTrial[]>();

  for (const joinedTrial of joinedTrials) {
    const candidateKey = candidateKeyForTrial(joinedTrial.trial);
    const bucket = candidateBuckets.get(candidateKey) ?? [];
    bucket.push(joinedTrial);
    candidateBuckets.set(candidateKey, bucket);
  }

  return Array.from(candidateBuckets.entries())
    .map(([candidateKey, bucket]) => {
      const firstTrial = bucket[0]!.trial;
      return {
        candidateKey,
        decisionProviderMode: firstTrial.decisionProvider.mode,
        decisionProviderMetadataHash: firstTrial.decisionProvider.metadataHash,
        promptHash: firstTrial.decisionProvider.promptHash,
        configHashes: uniqueNullableStrings(
          bucket.map((joinedTrial) => joinedTrial.trial.config.configHash)
        ),
        riskPolicyHash: firstTrial.config.riskPolicyHash,
        allocationPolicyHash: firstTrial.config.allocationPolicyHash,
        marketRegimeAllocationPolicyHash:
          firstTrial.config.marketRegimeAllocationPolicyHash,
        exitPolicyHash: firstTrial.config.exitPolicyHash,
        riskProfile: firstTrial.config.riskProfile,
        roleMetrics: summarizeRoleMetrics(bucket),
        splitMetrics: summarizeSplitMetrics(bucket)
      };
    })
    .sort((left, right) => left.candidateKey.localeCompare(right.candidateKey));
}

function summarizeRoleMetrics(
  joinedTrials: JoinedSelectionTrial[]
): Partial<Record<ValidationSplitRole, BatchReplayRoleMetric>> {
  const roleBuckets = new Map<ValidationSplitRole, JoinedSelectionTrial[]>();

  for (const joinedTrial of joinedTrials) {
    const bucket = roleBuckets.get(joinedTrial.splitRole) ?? [];
    bucket.push(joinedTrial);
    roleBuckets.set(joinedTrial.splitRole, bucket);
  }

  const metrics: Partial<Record<ValidationSplitRole, BatchReplayRoleMetric>> = {};
  for (const [role, bucket] of roleBuckets.entries()) {
    metrics[role] = summarizeRoleMetric(bucket);
  }
  return metrics;
}

function summarizeSplitMetrics(
  joinedTrials: JoinedSelectionTrial[]
): BatchReplaySplitMetric[] {
  const splitBuckets = new Map<string, JoinedSelectionTrial[]>();

  for (const joinedTrial of joinedTrials) {
    const key = splitMetricKey(joinedTrial.splitId, joinedTrial.splitRole);
    const bucket = splitBuckets.get(key) ?? [];
    bucket.push(joinedTrial);
    splitBuckets.set(key, bucket);
  }

  return Array.from(splitBuckets.values())
    .map((bucket) => ({
      splitId: bucket[0]!.splitId,
      splitRole: bucket[0]!.splitRole,
      metric: summarizeRoleMetric(bucket)
    }))
    .sort(compareSplitMetrics);
}

function summarizeRoleMetric(
  joinedTrials: JoinedSelectionTrial[]
): BatchReplayRoleMetric {
  const returns = joinedTrials
    .map((joinedTrial) => joinedTrial.totalReturnRatio)
    .filter((value): value is number => value !== null);

  return {
    runCount: joinedTrials.length,
    returnSampleCount: returns.length,
    averageTotalReturnRatio:
      returns.length === 0 ? null : roundRatio(average(returns)),
    medianTotalReturnRatio:
      returns.length === 0 ? null : roundRatio(median(returns)),
    runIds: joinedTrials.map((joinedTrial) => joinedTrial.trial.runId)
  };
}

function candidateKeyForTrial(trial: SelectionTrialRecord): string {
  return [
    `provider=${trial.decisionProvider.mode}`,
    `providerMetadata=${trial.decisionProvider.metadataHash}`,
    `prompt=${trial.decisionProvider.promptHash ?? "null"}`,
    `risk=${trial.config.riskPolicyHash}`,
    `allocation=${trial.config.allocationPolicyHash}`,
    `regimeAllocation=${trial.config.marketRegimeAllocationPolicyHash}`,
    `exit=${trial.config.exitPolicyHash}`,
    `profile=${trial.config.riskProfile ?? "null"}`,
    `metric=${trial.config.selectionMetric}`
  ].join("|");
}

function uniqueNullableStrings(values: Array<string | null>): Array<string | null> {
  const uniqueStrings = Array.from(
    new Set(values.filter((value): value is string => value !== null))
  ).sort((left, right) => left.localeCompare(right));
  return values.some((value) => value === null)
    ? [null, ...uniqueStrings]
    : uniqueStrings;
}

function countSampledCpcvSplits(joinedTrials: JoinedSelectionTrial[]): number {
  return new Set(
    joinedTrials.map((joinedTrial) =>
      `${joinedTrial.splitId}:${joinedTrial.splitRole}`
    )
  ).size;
}

function countJoinedTrialSplitRoles(
  joinedTrials: JoinedSelectionTrial[]
): Partial<Record<ValidationSplitRole, number>> {
  const counts: Partial<Record<ValidationSplitRole, number>> = {};
  for (const joinedTrial of joinedTrials) {
    counts[joinedTrial.splitRole] = (counts[joinedTrial.splitRole] ?? 0) + 1;
  }
  return counts;
}

function selectBestTrainCandidate(
  matrix: BatchReplaySplitMetricRow[]
): BatchReplaySplitMetricRow | null {
  const candidates = matrix.filter(
    (row) =>
      row.roleMetrics.train?.averageTotalReturnRatio !== null &&
      row.roleMetrics.train?.averageTotalReturnRatio !== undefined
  );
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => {
    const returnDelta =
      right.roleMetrics.train!.averageTotalReturnRatio! -
      left.roleMetrics.train!.averageTotalReturnRatio!;
    return returnDelta !== 0
      ? returnDelta
      : left.candidateKey.localeCompare(right.candidateKey);
  })[0]!;
}

function buildHoldoutDegradation(
  matrix: BatchReplaySplitMetricRow[],
  selectedCandidate: BatchReplaySplitMetricRow
): BatchReplayHoldoutDegradation[] {
  return splitHoldoutKeys(matrix)
    .map(({ splitId, splitRole }) =>
      holdoutDegradationForSplit(matrix, selectedCandidate, splitId, splitRole)
    )
    .filter(
      (value): value is BatchReplayHoldoutDegradation => value !== null
    );
}

function holdoutDegradationForSplit(
  matrix: BatchReplaySplitMetricRow[],
  selectedCandidate: BatchReplaySplitMetricRow,
  splitId: string,
  splitRole: Exclude<ValidationSplitRole, "train">
): BatchReplayHoldoutDegradation | null {
  const roleCandidates = matrix
    .map((row) => ({
      row,
      metric: splitMetricForCandidate(row, splitId, splitRole)?.metric ?? null
    }))
    .filter(
      (entry): entry is { row: BatchReplaySplitMetricRow; metric: BatchReplayRoleMetric } =>
        entry.metric?.averageTotalReturnRatio !== null &&
        entry.metric?.averageTotalReturnRatio !== undefined
    )
    .sort((left, right) => {
      const returnDelta =
        right.metric.averageTotalReturnRatio! -
        left.metric.averageTotalReturnRatio!;
      return returnDelta !== 0
        ? returnDelta
        : left.row.candidateKey.localeCompare(right.row.candidateKey);
    });

  if (roleCandidates.length === 0) {
    return null;
  }

  const selectedIndex = roleCandidates.findIndex((entry) => {
    return entry.row.candidateKey === selectedCandidate.candidateKey;
  });
  const selectedMetric =
    selectedIndex === -1 ? null : roleCandidates[selectedIndex]!.metric;
  const holdoutReturns = roleCandidates.map(
    (entry) => entry.metric.averageTotalReturnRatio!
  );
  const medianCandidateAverage = roundRatio(median(holdoutReturns));
  const selectedAverage = selectedMetric?.averageTotalReturnRatio ?? null;
  const selectedRank = selectedIndex === -1 ? null : selectedIndex + 1;
  const selectedBelowMedian =
    selectedAverage === null || roleCandidates.length < 2
      ? null
      : selectedAverage < medianCandidateAverage;
  const splitTrainAverage =
    splitMetricForCandidate(selectedCandidate, splitId, "train")?.metric
      .averageTotalReturnRatio ?? null;
  const trainAverage =
    splitTrainAverage ??
    selectedCandidate.roleMetrics.train?.averageTotalReturnRatio ??
    null;

  return {
    splitId,
    splitRole,
    selectedCandidateKey: selectedCandidate.candidateKey,
    selectedAverageTotalReturnRatio: selectedAverage,
    selectedRank,
    candidateCount: roleCandidates.length,
    medianCandidateAverageTotalReturnRatio: medianCandidateAverage,
    bestAverageTotalReturnRatio: roleCandidates[0]!.metric
      .averageTotalReturnRatio,
    degradationFromTrainRatio:
      trainAverage === null || selectedAverage === null
        ? null
        : roundRatio(selectedAverage - trainAverage),
    selectedBelowMedian,
    runIds: selectedMetric?.runIds ?? []
  };
}

function splitHoldoutKeys(
  matrix: BatchReplaySplitMetricRow[]
): Array<{ splitId: string; splitRole: Exclude<ValidationSplitRole, "train"> }> {
  const keys = new Map<
    string,
    { splitId: string; splitRole: Exclude<ValidationSplitRole, "train"> }
  >();

  for (const row of matrix) {
    for (const splitMetric of row.splitMetrics) {
      if (
        splitMetric.splitRole === "train" ||
        splitMetric.metric.averageTotalReturnRatio === null
      ) {
        continue;
      }
      keys.set(splitMetricKey(splitMetric.splitId, splitMetric.splitRole), {
        splitId: splitMetric.splitId,
        splitRole: splitMetric.splitRole
      });
    }
  }

  return Array.from(keys.values()).sort((left, right) => {
    const splitDelta = left.splitId.localeCompare(right.splitId);
    return splitDelta !== 0
      ? splitDelta
      : validationSplitRoleOrder(left.splitRole) -
          validationSplitRoleOrder(right.splitRole);
  });
}

function splitMetricForCandidate(
  row: BatchReplaySplitMetricRow,
  splitId: string,
  splitRole: ValidationSplitRole
): BatchReplaySplitMetric | null {
  return (
    row.splitMetrics.find(
      (metric) =>
        metric.splitId === splitId && metric.splitRole === splitRole
    ) ?? null
  );
}

function compareSplitMetrics(
  left: BatchReplaySplitMetric,
  right: BatchReplaySplitMetric
): number {
  const splitDelta = left.splitId.localeCompare(right.splitId);
  return splitDelta !== 0
    ? splitDelta
    : validationSplitRoleOrder(left.splitRole) -
        validationSplitRoleOrder(right.splitRole);
}

function validationSplitRoleOrder(role: ValidationSplitRole): number {
  switch (role) {
    case "train":
      return 0;
    case "validation":
      return 1;
    case "test":
      return 2;
  }
}

function splitMetricKey(splitId: string, splitRole: ValidationSplitRole): string {
  return `${splitId}\u0000${splitRole}`;
}

function pboLikeScore(
  matrix: BatchReplaySplitMetricRow[],
  holdoutDegradation: BatchReplayHoldoutDegradation[]
): number | null {
  const scoredHoldouts = holdoutDegradation.filter(
    (degradation) => degradation.selectedBelowMedian !== null
  );
  if (matrix.length < 2 || scoredHoldouts.length === 0) {
    return null;
  }
  const belowMedianCount = scoredHoldouts.filter(
    (degradation) => degradation.selectedBelowMedian === true
  ).length;
  return roundRatio(belowMedianCount / scoredHoldouts.length);
}

function overfittingDiagnosticWarnings(input: {
  joinedTrialCount: number;
  candidateCount: number;
  selectedCandidate: BatchReplaySplitMetricRow | null;
  holdoutDegradation: BatchReplayHoldoutDegradation[];
  sampledCpcvSplitCount: number;
  expectedSampledCpcvSplitCount: number | null;
  sampledCpcvSplitCountMatchesExpected: boolean | null;
}): string[] {
  const warnings: string[] = [];
  if (input.joinedTrialCount === 0) {
    warnings.push(
      "PBO-like diagnostic unavailable: no selection trials with validation split metadata"
    );
  }
  if (input.candidateCount < 2) {
    warnings.push(
      "PBO-like diagnostic unavailable: at least two strategy candidates are required"
    );
  }
  if (input.selectedCandidate === null) {
    warnings.push(
      "PBO-like diagnostic unavailable: no train return sample exists for candidate selection"
    );
  }
  if (input.holdoutDegradation.length === 0) {
    warnings.push(
      "PBO-like diagnostic unavailable: no validation/test holdout return samples exist"
    );
  }
  if (
    input.holdoutDegradation.length > 0 &&
    input.holdoutDegradation.every(
      (degradation) => degradation.selectedBelowMedian === null
    )
  ) {
    warnings.push(
      "PBO-like diagnostic unavailable: at least two holdout candidates with return samples are required per scored role"
    );
  }
  if (input.sampledCpcvSplitCountMatchesExpected === false) {
    warnings.push(
      `sampled CPCV split count mismatch: expected ${input.expectedSampledCpcvSplitCount}, actual ${input.sampledCpcvSplitCount}`
    );
  }
  return warnings;
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

function renderOverfittingDiagnostics(
  diagnostics: BatchReplayOverfittingDiagnostics | null
): string {
  if (diagnostics === null) {
    return "overfitting_diagnostics: null";
  }

  return [
    `validation_protocol: ${diagnostics.validationProtocol}`,
    `selection_metric: ${diagnostics.selectionMetric}`,
    `expected_sampled_cpcv_split_count: ${formatNullable(diagnostics.expectedSampledCpcvSplitCount)}`,
    `sampled_cpcv_split_count: ${diagnostics.sampledCpcvSplitCount}`,
    `sampled_cpcv_split_count_matches_expected: ${
      diagnostics.sampledCpcvSplitCountMatchesExpected === null
        ? "null"
        : String(diagnostics.sampledCpcvSplitCountMatchesExpected)
    }`,
    `joined_trial_count: ${diagnostics.joinedTrialCount}`,
    `candidate_count: ${diagnostics.candidateCount}`,
    `return_sample_count: ${diagnostics.returnSampleCount}`,
    `split_role_counts: ${JSON.stringify(diagnostics.splitRoleCounts)}`,
    `selected_candidate_key: ${diagnostics.selectedCandidateKey ?? "null"}`,
    `selected_train_average_total_return_ratio: ${formatNullable(diagnostics.selectedTrainAverageTotalReturnRatio)}`,
    `pbo_like_score: ${formatNullable(diagnostics.pboLikeScore)}`,
    `holdout_degradation: ${JSON.stringify(diagnostics.holdoutDegradation)}`,
    `warnings: ${JSON.stringify(diagnostics.warnings)}`,
    `split_metric_matrix: ${JSON.stringify(diagnostics.splitMetricMatrix)}`
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

function normalizeOptionalNonNegativeInteger(
  value: number | undefined,
  label: string
): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
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
