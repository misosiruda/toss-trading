import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import {
  summarizeReturnDistributionMetrics,
  type ReturnDistributionMetrics
} from "../analytics/performanceMetrics.js";
import {
  calculateSharpeValidationReport,
  type SharpeValidationReport
} from "../analytics/sharpeValidation.js";
import type { AssetType, Market, StrategyBucket } from "../domain/schemas.js";
import {
  CPCV_PBO_VALIDATION_SCHEMA_VERSION,
  calculateCpcvPboEstimateFromSelectionLog,
  calculateCpcvPboSelectionLog,
  cpcvPboValidationReportSchema,
  type CpcvCandidatePerformanceRow,
  type CpcvCandidateSplitMetric,
  type CpcvPboEstimate,
  type CpcvPboValidationConfig,
  type CpcvPboValidationReport,
  type CpcvPboWarning,
  type CpcvSelectionLogEntry
} from "../replay/cpcvPboValidation.js";
import type {
  SelectionTrialRecord,
  SelectionTrialRunStatus
} from "../replay/selectionTrialLog.js";
import type { HistoricalUniverseCoverageReport } from "../replay/historicalUniverseCoverage.js";
import {
  metaLabelEvaluationReportSchema,
  tripleBarrierLabelArtifactSchema,
  type MetaLabelEvaluationReport,
  type TripleBarrierLabelArtifact
} from "../replay/tripleBarrierLabel.js";
import type { ValidationSplitRole } from "../replay/validationProtocol.js";
import type { BatchReplayRunRecord } from "../workflows/historicalBatchReplayWorkflow.js";

export interface BatchReplayAggregateReportOptions {
  records: BatchReplayRunRecord[];
  selectionTrials?: SelectionTrialRecord[];
  generatedAt: Date;
  sourceRunsPath?: string;
  sourceSelectionTrialsPath?: string;
  sourceUniverseCoveragePath?: string;
  sourceTripleBarrierLabelPath?: string;
  sourceMetaLabelEvaluationPath?: string;
  universeCoverageReport?: HistoricalUniverseCoverageReport | null;
  tripleBarrierLabel?: TripleBarrierLabelArtifact | null;
  metaLabelEvaluation?: MetaLabelEvaluationReport | null;
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
  sourceUniverseCoveragePath?: string | null;
  sourceTripleBarrierLabelPath?: string | null;
  sourceMetaLabelEvaluationPath?: string | null;
  targetReturnThresholds: number[];
  summary: BatchReplayAggregateSummary;
  trialSummary: BatchReplaySelectionTrialSummary | null;
  overfittingDiagnostics: BatchReplayOverfittingDiagnostics | null;
  cpcvPboValidation: CpcvPboValidationReport | null;
  tripleBarrierLabel?: TripleBarrierLabelArtifact | null;
  metaLabelEvaluation?: MetaLabelEvaluationReport | null;
  universeCoverage?: BatchReplayUniverseCoverageSummary | null;
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
  dataAvailabilityIssues: BatchReplayDataAvailabilityIssueSummary[];
}

export interface BatchReplayDataAvailabilityIssueSummary {
  code: string;
  count: number;
  runIds: string[];
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
  advancedPerformance: ReturnDistributionMetrics;
  sharpeValidation: SharpeValidationReport;
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
  costSummary: BatchReplayCostBreakdownSummary;
  totalAiDecisionFailureCount: number;
  totalRejectedCount: number;
  totalMeaningfulRejectCount: number;
  totalDustRejectCount: number;
  runIds: string[];
}

export interface BatchReplayCostBreakdownSummary {
  sampleCount: number;
  tradeCount: number;
  feeKrw: number;
  taxKrw: number;
  slippageKrw: number;
  spreadCostKrw: number;
  impactCostKrw: number;
  totalCostKrw: number;
  averageCostPerRunKrw: number | null;
  averageCostPerTradeKrw: number | null;
  filledCount: number;
  partialFillCount: number;
  notModeledLiquidityCount: number;
  averageRunParticipationRate: number | null;
  maxParticipationRate: number | null;
  costModelVersions: string[];
  byStrategyBucket: BatchReplayStrategyBucketCostBreakdownSummary[];
  runIds: string[];
}

export interface BatchReplayStrategyBucketCostBreakdownSummary {
  strategyBucket: StrategyBucket | "UNKNOWN";
  sampleCount: number;
  tradeCount: number;
  feeKrw: number;
  taxKrw: number;
  slippageKrw: number;
  spreadCostKrw: number;
  impactCostKrw: number;
  totalCostKrw: number;
  averageCostPerRunKrw: number | null;
  averageCostPerTradeKrw: number | null;
  filledCount: number;
  partialFillCount: number;
  notModeledLiquidityCount: number;
  averageRunParticipationRate: number | null;
  maxParticipationRate: number | null;
  costModelVersions: string[];
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

type BatchReplayRunCostSummary = NonNullable<
  NonNullable<BatchReplayRunRecord["summary"]>["costSummary"]
>;

type BatchReplayRunStrategyBucketCostSummary =
  BatchReplayRunCostSummary["byStrategyBucket"][number];

type BatchReplayRunCostRecord = BatchReplayRunRecord & {
  summary: NonNullable<BatchReplayRunRecord["summary"]> & {
    costSummary: BatchReplayRunCostSummary;
  };
};

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

export interface BatchReplayUniverseCoverageSummary {
  sourcePath: string | null;
  universeId: string;
  status: "available" | "insufficient";
  rangeStart: string;
  rangeEnd: string;
  universeSymbolCount: number;
  requiredSymbolCount: number;
  optionalSymbolCount: number;
  availableSymbolCount: number;
  availableRequiredSymbolCount: number;
  availableOptionalSymbolCount: number;
  missingRequiredSymbolCount: number;
  missingOptionalSymbolCount: number;
  insufficientRequiredSymbolCount: number;
  insufficientOptionalSymbolCount: number;
  missingRequiredMarketCount: number;
  missingRequiredAssetTypeCount: number;
  missingRequiredStrategyBucketCount: number;
  insufficientAvailableMarketSymbolCount: number;
  insufficientAvailableAssetTypeSymbolCount: number;
  insufficientAvailableStrategyBucketSymbolCount: number;
  corruptLineCount: number;
  availableMarketSymbolCounts: Partial<Record<Market, number>>;
  availableAssetTypeSymbolCounts: Partial<Record<AssetType, number>>;
  availableStrategyBucketSymbolCounts: Partial<Record<StrategyBucket, number>>;
  issues: string[];
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
  strategyPreset: string | null;
  replayCadence: NonNullable<SelectionTrialRecord["config"]["replayCadence"]> | null;
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
const BATCH_REPLAY_SHARPE_VALIDATION_AUTOCORRELATION_MAX_LAG = 5;

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
  const universeCoverage = summarizeUniverseCoverage(
    options.universeCoverageReport ?? null,
    options.sourceUniverseCoveragePath ?? null
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
  const overfittingDiagnostics =
    selectionTrials === null && expectedSampledCpcvSplitCount === null
      ? null
      : summarizeOverfittingDiagnostics({
          records,
          trials: selectionTrials ?? [],
          expectedSampledCpcvSplitCount
        });
  const cpcvPboValidation =
    overfittingDiagnostics === null
      ? null
      : buildSampledCpcvPboValidationReport(
          overfittingDiagnostics,
          options.generatedAt
        );
  const tripleBarrierLabel =
    options.tripleBarrierLabel === undefined ||
    options.tripleBarrierLabel === null
      ? null
      : tripleBarrierLabelArtifactSchema.parse(options.tripleBarrierLabel);
  const metaLabelEvaluation =
    options.metaLabelEvaluation === undefined ||
    options.metaLabelEvaluation === null
      ? null
      : metaLabelEvaluationReportSchema.parse(options.metaLabelEvaluation);

  return {
    title: options.title ?? "Batch Replay Paper Aggregate Report",
    mode: "paper_only",
    generatedAt: options.generatedAt.toISOString(),
    sourceRunsPath: options.sourceRunsPath ?? null,
    sourceSelectionTrialsPath:
      selectionTrials === null ? null : options.sourceSelectionTrialsPath ?? null,
    sourceUniverseCoveragePath: universeCoverage?.sourcePath ?? null,
    sourceTripleBarrierLabelPath:
      tripleBarrierLabel === null
        ? null
        : options.sourceTripleBarrierLabelPath ?? null,
    sourceMetaLabelEvaluationPath:
      metaLabelEvaluation === null
        ? null
        : options.sourceMetaLabelEvaluationPath ?? null,
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
      validationSplitRoleCounts: countValidationSplitRoles(records),
      dataAvailabilityIssues: summarizeDataAvailabilityIssues(records)
    },
    trialSummary:
      selectionTrials === null ? null : summarizeSelectionTrials(selectionTrials),
    overfittingDiagnostics,
    cpcvPboValidation,
    tripleBarrierLabel,
    metaLabelEvaluation,
    universeCoverage,
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
    `source_universe_coverage_path: ${
      report.sourceUniverseCoveragePath ?? "null"
    }`,
    `source_triple_barrier_label_path: ${
      report.sourceTripleBarrierLabelPath ?? "null"
    }`,
    `source_meta_label_evaluation_path: ${
      report.sourceMetaLabelEvaluationPath ?? "null"
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
    `data_availability_issues: ${JSON.stringify(report.summary.dataAvailabilityIssues)}`,
    "",
    "## Selection Trials",
    renderSelectionTrialSummary(report.trialSummary),
    "",
    "## Overfitting Diagnostics",
    renderOverfittingDiagnostics(report.overfittingDiagnostics),
    "",
    "## CPCV/PBO Validation",
    renderCpcvPboValidation(report.cpcvPboValidation),
    "",
    "## Triple Barrier Label Distribution",
    renderTripleBarrierLabelDistribution(report.tripleBarrierLabel ?? null),
    "",
    "## Meta-Label Evaluation",
    renderMetaLabelEvaluation(report.metaLabelEvaluation ?? null),
    "",
    "## Universe Coverage",
    renderUniverseCoverage(report.universeCoverage ?? null),
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
  const trainSampledCandidateCount =
    countTrainSampledCandidates(splitMetricMatrix);
  const holdoutReturnSampleCount =
    countHoldoutReturnSamples(splitMetricMatrix);
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
    trainSampledCandidateCount,
    holdoutReturnSampleCount,
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
        strategyPreset: firstTrial.config.strategyPreset ?? null,
        replayCadence: firstTrial.config.replayCadence ?? null,
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
    `preset=${trial.config.strategyPreset ?? "null"}`,
    `cadence=${replayCadenceKey(trial.config.replayCadence ?? null)}`,
    `profile=${trial.config.riskProfile ?? "null"}`,
    `metric=${trial.config.selectionMetric}`
  ].join("|");
}

function replayCadenceKey(
  replayCadence: SelectionTrialRecord["config"]["replayCadence"] | null
): string {
  if (replayCadence === null || replayCadence === undefined) {
    return "null";
  }
  return [
    `stepSeconds=${replayCadence.stepSeconds}`,
    `everyNSteps=${replayCadence.everyNSteps ?? "null"}`,
    `candidateChangedOnly=${replayCadence.candidateChangedOnly}`,
    `decisionFrequency=${replayCadence.decisionFrequency}`,
    `maxDecisionCalls=${replayCadence.maxDecisionCalls ?? "null"}`,
    `timezoneOffsetMinutes=${replayCadence.timezoneOffsetMinutes}`
  ].join(",");
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
  const candidates = trainSampledCandidates(matrix);
  if (candidates.length < 2) {
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
  if (countTrainSampledCandidates(matrix) < 2 || scoredHoldouts.length === 0) {
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
  trainSampledCandidateCount: number;
  holdoutReturnSampleCount: number;
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
  if (input.trainSampledCandidateCount === 0) {
    warnings.push(
      "PBO-like diagnostic unavailable: no train return sample exists for candidate selection"
    );
  }
  if (input.trainSampledCandidateCount === 1) {
    warnings.push(
      "PBO-like diagnostic unavailable: at least two train candidates with return samples are required for candidate selection"
    );
  }
  if (input.holdoutReturnSampleCount === 0) {
    warnings.push(
      "PBO-like diagnostic unavailable: no validation/test holdout return samples exist"
    );
  }
  if (
    input.holdoutDegradation.length > 0 &&
    input.holdoutDegradation.some(
      (degradation) => degradation.selectedBelowMedian === null
    )
  ) {
    warnings.push(
      "PBO-like diagnostic partial: at least two holdout candidates with return samples are required per scored split; unscored holdouts were excluded from pboLikeScore"
    );
  }
  if (input.sampledCpcvSplitCountMatchesExpected === false) {
    warnings.push(
      `sampled CPCV split count mismatch: expected ${input.expectedSampledCpcvSplitCount}, actual ${input.sampledCpcvSplitCount}`
    );
  }
  return warnings;
}

interface SampledCpcvHoldoutCombination {
  combinationId: string;
  splitId: string;
  splitRole: Exclude<ValidationSplitRole, "train">;
}

function buildSampledCpcvPboValidationReport(
  diagnostics: BatchReplayOverfittingDiagnostics,
  generatedAt: Date
): CpcvPboValidationReport {
  const combinations = sampledCpcvHoldoutCombinations(diagnostics);
  const performanceMatrix = buildSampledCpcvPerformanceMatrix(
    diagnostics.splitMetricMatrix,
    combinations
  );
  const selectionLog = calculateCpcvPboSelectionLog({
    combinationIds: combinations.map((combination) => combination.combinationId),
    performanceMatrix
  });
  const pbo = calculateCpcvPboEstimateFromSelectionLog({
    performanceMatrix,
    selectionLog
  });
  const warnings = sampledCpcvPboWarnings({
    performanceMatrix,
    selectionLog,
    pbo
  });

  return cpcvPboValidationReportSchema.parse({
    schemaVersion: CPCV_PBO_VALIDATION_SCHEMA_VERSION,
    status: pbo.status === "computed" ? "sampled" : "unavailable",
    generatedAt: generatedAt.toISOString(),
    config: sampledCpcvPboConfigForDiagnostics(
      diagnostics,
      combinations.length
    ),
    splitPlan: null,
    performanceMatrix,
    selectionLog,
    pbo,
    warnings
  });
}

function sampledCpcvPboConfigForDiagnostics(
  diagnostics: BatchReplayOverfittingDiagnostics,
  combinationCount: number
): CpcvPboValidationConfig {
  return {
    validationProtocol: "combinatorial_purged_cv",
    foldCount: Math.max(2, diagnostics.sampledCpcvSplitCount),
    testFoldCount: 1,
    purgeDurationDays: 0,
    embargoDurationDays: 0,
    selectionMetric: "total_return_ratio",
    tieBreaker: "candidate_key_asc",
    maxCombinationCount: Math.max(1, combinationCount),
    combinationMode: "sampled",
    randomSeed: "batch_replay_aggregate_sampled_matrix"
  };
}

function sampledCpcvHoldoutCombinations(
  diagnostics: BatchReplayOverfittingDiagnostics
): SampledCpcvHoldoutCombination[] {
  const combinations = new Map<string, SampledCpcvHoldoutCombination>();

  for (const row of diagnostics.splitMetricMatrix) {
    for (const splitMetric of row.splitMetrics) {
      if (splitMetric.splitRole === "train") {
        continue;
      }
      const key = splitMetricKey(splitMetric.splitId, splitMetric.splitRole);
      combinations.set(key, {
        combinationId: sampledCpcvCombinationId(
          splitMetric.splitId,
          splitMetric.splitRole
        ),
        splitId: splitMetric.splitId,
        splitRole: splitMetric.splitRole
      });
    }
  }

  return Array.from(combinations.values()).sort((left, right) => {
    const splitDelta = left.splitId.localeCompare(right.splitId);
    return splitDelta !== 0
      ? splitDelta
      : validationSplitRoleOrder(left.splitRole) -
          validationSplitRoleOrder(right.splitRole);
  });
}

function sampledCpcvCombinationId(
  splitId: string,
  splitRole: Exclude<ValidationSplitRole, "train">
): string {
  return `${splitId}:${splitRole}`;
}

function buildSampledCpcvPerformanceMatrix(
  matrix: readonly BatchReplaySplitMetricRow[],
  combinations: readonly SampledCpcvHoldoutCombination[]
): CpcvCandidatePerformanceRow[] {
  return matrix.map((row) => ({
    candidateKey: row.candidateKey,
    promptHash: row.promptHash,
    configHash: singleConfigHash(row.configHashes),
    riskPolicyHash: row.riskPolicyHash,
    exitPolicyHash: row.exitPolicyHash,
    splitMetrics: combinations.map((combination) =>
      sampledCpcvCandidateSplitMetric(row, combination)
    )
  }));
}

function sampledCpcvCandidateSplitMetric(
  row: BatchReplaySplitMetricRow,
  combination: SampledCpcvHoldoutCombination
): CpcvCandidateSplitMetric {
  const trainMetric =
    splitMetricForCandidate(row, combination.splitId, "train")?.metric ?? null;
  const testMetric =
    splitMetricForCandidate(
      row,
      combination.splitId,
      combination.splitRole
    )?.metric ?? null;

  return {
    combinationId: combination.combinationId,
    trainMetric: trainMetric?.averageTotalReturnRatio ?? null,
    testMetric: testMetric?.averageTotalReturnRatio ?? null,
    trainReturnSampleCount: trainMetric?.returnSampleCount ?? 0,
    testReturnSampleCount: testMetric?.returnSampleCount ?? 0
  };
}

function singleConfigHash(values: Array<string | null>): string | null {
  return values.length === 1 ? values[0] ?? null : null;
}

function sampledCpcvPboWarnings(input: {
  performanceMatrix: readonly CpcvCandidatePerformanceRow[];
  selectionLog: readonly CpcvSelectionLogEntry[];
  pbo: CpcvPboEstimate;
}): CpcvPboWarning[] {
  const warnings: CpcvPboWarning[] = [
    {
      code: "CPCV_SAMPLED_MODE_USED",
      severity: "info",
      message:
        "Batch aggregate report promoted sampled PBO-like split metrics into cpcv_pbo_validation.v1"
    },
    {
      code: "CPCV_SPLIT_PLAN_UNAVAILABLE",
      severity: "warning",
      message:
        "Batch aggregate sampled diagnostics do not preserve full CPCV fold/sample ids; splitPlan is null"
    }
  ];

  if (countSampledCpcvTrainCandidates(input.performanceMatrix) < 2) {
    warnings.push({
      code: "PBO_CANDIDATE_COUNT_INSUFFICIENT",
      severity: "warning",
      message: "PBO requires at least two candidate rows"
    });
  }
  if (
    input.pbo.status !== "computed" ||
    input.pbo.evaluatedCombinationCount < input.selectionLog.length
  ) {
    warnings.push({
      code: "PBO_HOLDOUT_MATRIX_INSUFFICIENT",
      severity: "warning",
      message:
        "PBO requires every scored sampled combination to include comparable holdout metrics for the same train candidates"
    });
  }
  if (input.selectionLog.some((entry) => entry.tieBreakApplied)) {
    warnings.push({
      code: "PBO_SELECTION_TIE_BREAK_APPLIED",
      severity: "info",
      message:
        "At least one sampled combination used candidate_key_asc tie breaker"
    });
  }
  return warnings;
}

function countSampledCpcvTrainCandidates(
  performanceMatrix: readonly CpcvCandidatePerformanceRow[]
): number {
  return performanceMatrix.filter((row) =>
    row.splitMetrics.some(
      (metric) =>
        metric.trainMetric !== null && metric.trainReturnSampleCount > 0
    )
  ).length;
}

function trainSampledCandidates(
  matrix: BatchReplaySplitMetricRow[]
): BatchReplaySplitMetricRow[] {
  return matrix.filter((row) => hasTrainReturnSample(row));
}

function countTrainSampledCandidates(
  matrix: BatchReplaySplitMetricRow[]
): number {
  return trainSampledCandidates(matrix).length;
}

function hasTrainReturnSample(row: BatchReplaySplitMetricRow): boolean {
  const trainMetric = row.roleMetrics.train ?? null;
  return (
    (trainMetric?.returnSampleCount ?? 0) > 0 &&
    trainMetric?.averageTotalReturnRatio !== null &&
    trainMetric?.averageTotalReturnRatio !== undefined
  );
}

function countHoldoutReturnSamples(
  matrix: BatchReplaySplitMetricRow[]
): number {
  return matrix.reduce((total, row) => {
    return (
      total +
      row.splitMetrics
        .filter((splitMetric) => splitMetric.splitRole !== "train")
        .reduce(
          (rowTotal, splitMetric) =>
            rowTotal + splitMetric.metric.returnSampleCount,
          0
        )
    );
  }, 0);
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
    advancedPerformance: summarizeReturnDistributionMetrics(returns),
    sharpeValidation: calculateSharpeValidationReport({
      returns,
      autocorrelationMaxLag:
        BATCH_REPLAY_SHARPE_VALIDATION_AUTOCORRELATION_MAX_LAG,
      selectionContext: {
        candidateCount: null,
        trialCount: returns.length === 0 ? null : returns.length,
        selectedByMetric: null,
        multipleTestingAdjustment: "unknown"
      }
    }),
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
    costSummary: summarizeCostBreakdown(records),
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

function summarizeCostBreakdown(
  records: BatchReplayRunRecord[]
): BatchReplayCostBreakdownSummary {
  const costRecords = records.filter(
    (record): record is BatchReplayRunCostRecord =>
      isCompletedRunRecord(record) && record.summary?.costSummary !== undefined
  );
  const costSummaries = costRecords.map((record) => record.summary.costSummary);
  const totalCostKrw = sumCostField(costSummaries, "totalCostKrw");
  const tradeCount = costRecords.reduce(
    (sum, record) => sum + record.summary.tradeCount,
    0
  );
  const averageParticipationRates = costSummaries
    .map((summary) => summary.averageParticipationRate)
    .filter((value): value is number => typeof value === "number");
  const maxParticipationRates = costSummaries
    .map((summary) => summary.maxParticipationRate)
    .filter((value): value is number => typeof value === "number");

  return {
    sampleCount: costRecords.length,
    tradeCount,
    feeKrw: sumCostField(costSummaries, "feeKrw"),
    taxKrw: sumCostField(costSummaries, "taxKrw"),
    slippageKrw: sumCostField(costSummaries, "slippageKrw"),
    spreadCostKrw: sumCostField(costSummaries, "spreadCostKrw"),
    impactCostKrw: sumCostField(costSummaries, "impactCostKrw"),
    totalCostKrw,
    averageCostPerRunKrw:
      costRecords.length === 0
        ? null
        : Math.round(totalCostKrw / costRecords.length),
    averageCostPerTradeKrw:
      tradeCount === 0 ? null : Math.round(totalCostKrw / tradeCount),
    filledCount: sumCostField(costSummaries, "filledCount"),
    partialFillCount: sumCostField(costSummaries, "partialFillCount"),
    notModeledLiquidityCount: sumCostField(
      costSummaries,
      "notModeledLiquidityCount"
    ),
    averageRunParticipationRate:
      averageParticipationRates.length === 0
        ? null
        : roundRatio(average(averageParticipationRates)),
    maxParticipationRate:
      maxParticipationRates.length === 0
        ? null
        : Math.max(...maxParticipationRates),
    costModelVersions: Array.from(
      new Set(costSummaries.flatMap((summary) => summary.costModelVersions))
    ).sort(),
    byStrategyBucket: summarizeStrategyBucketCostBreakdowns(costRecords),
    runIds: costRecords.map((record) => record.runId)
  };
}

function summarizeStrategyBucketCostBreakdowns(
  costRecords: BatchReplayRunCostRecord[]
): BatchReplayStrategyBucketCostBreakdownSummary[] {
  const buckets = new Map<
    StrategyBucket | "UNKNOWN",
    Array<{
      runId: string;
      summary: BatchReplayRunStrategyBucketCostSummary;
    }>
  >();

  for (const record of costRecords) {
    for (const summary of record.summary.costSummary.byStrategyBucket ?? []) {
      const current = buckets.get(summary.strategyBucket) ?? [];
      current.push({ runId: record.runId, summary });
      buckets.set(summary.strategyBucket, current);
    }
  }

  return Array.from(buckets.entries())
    .map(([strategyBucket, entries]) => {
      const summaries = entries.map((entry) => entry.summary);
      const totalCostKrw = sumStrategyBucketCostField(
        summaries,
        "totalCostKrw"
      );
      const tradeCount = sumStrategyBucketCostField(summaries, "tradeCount");
      const averageParticipationRates = summaries
        .map((summary) => summary.averageParticipationRate)
        .filter((value): value is number => typeof value === "number");
      const maxParticipationRates = summaries
        .map((summary) => summary.maxParticipationRate)
        .filter((value): value is number => typeof value === "number");
      return {
        strategyBucket,
        sampleCount: entries.length,
        tradeCount,
        feeKrw: sumStrategyBucketCostField(summaries, "feeKrw"),
        taxKrw: sumStrategyBucketCostField(summaries, "taxKrw"),
        slippageKrw: sumStrategyBucketCostField(summaries, "slippageKrw"),
        spreadCostKrw: sumStrategyBucketCostField(summaries, "spreadCostKrw"),
        impactCostKrw: sumStrategyBucketCostField(summaries, "impactCostKrw"),
        totalCostKrw,
        averageCostPerRunKrw:
          entries.length === 0 ? null : Math.round(totalCostKrw / entries.length),
        averageCostPerTradeKrw:
          tradeCount === 0 ? null : Math.round(totalCostKrw / tradeCount),
        filledCount: sumStrategyBucketCostField(summaries, "filledCount"),
        partialFillCount: sumStrategyBucketCostField(
          summaries,
          "partialFillCount"
        ),
        notModeledLiquidityCount: sumStrategyBucketCostField(
          summaries,
          "notModeledLiquidityCount"
        ),
        averageRunParticipationRate:
          averageParticipationRates.length === 0
            ? null
            : roundRatio(average(averageParticipationRates)),
        maxParticipationRate:
          maxParticipationRates.length === 0
            ? null
            : Math.max(...maxParticipationRates),
        costModelVersions: Array.from(
          new Set(summaries.flatMap((summary) => summary.costModelVersions))
        ).sort(),
        runIds: entries.map((entry) => entry.runId)
      };
    })
    .sort(compareStrategyBucketCostBreakdowns);
}

function sumStrategyBucketCostField(
  summaries: BatchReplayRunStrategyBucketCostSummary[],
  field:
    | "tradeCount"
    | "feeKrw"
    | "taxKrw"
    | "slippageKrw"
    | "spreadCostKrw"
    | "impactCostKrw"
    | "totalCostKrw"
    | "filledCount"
    | "partialFillCount"
    | "notModeledLiquidityCount"
): number {
  return summaries.reduce((sum, summary) => sum + summary[field], 0);
}

function compareStrategyBucketCostBreakdowns(
  left: BatchReplayStrategyBucketCostBreakdownSummary,
  right: BatchReplayStrategyBucketCostBreakdownSummary
): number {
  if (left.totalCostKrw !== right.totalCostKrw) {
    return right.totalCostKrw - left.totalCostKrw;
  }
  return bucketSortKey(left.strategyBucket).localeCompare(
    bucketSortKey(right.strategyBucket)
  );
}

function sumCostField(
  summaries: Array<
    NonNullable<NonNullable<BatchReplayRunRecord["summary"]>["costSummary"]>
  >,
  field:
    | "feeKrw"
    | "taxKrw"
    | "slippageKrw"
    | "spreadCostKrw"
    | "impactCostKrw"
    | "totalCostKrw"
    | "filledCount"
    | "partialFillCount"
    | "notModeledLiquidityCount"
): number {
  return summaries.reduce((sum, summary) => sum + summary[field], 0);
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

function summarizeDataAvailabilityIssues(
  records: BatchReplayRunRecord[]
): BatchReplayDataAvailabilityIssueSummary[] {
  const issuesByCode = new Map<string, string[]>();

  for (const record of records) {
    for (const issue of new Set(record.dataAvailability.issues)) {
      const runIds = issuesByCode.get(issue) ?? [];
      runIds.push(record.runId);
      issuesByCode.set(issue, runIds);
    }
  }

  return Array.from(issuesByCode.entries())
    .map(([code, runIds]) => ({
      code,
      count: runIds.length,
      runIds
    }))
    .sort(compareDataAvailabilityIssueSummaries);
}

function compareDataAvailabilityIssueSummaries(
  left: BatchReplayDataAvailabilityIssueSummary,
  right: BatchReplayDataAvailabilityIssueSummary
): number {
  if (left.count !== right.count) {
    return right.count - left.count;
  }
  return left.code.localeCompare(right.code);
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
    `advanced_performance: ${JSON.stringify(group.advancedPerformance)}`,
    `sharpe_validation: ${JSON.stringify(group.sharpeValidation)}`,
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
    `cost_summary: ${JSON.stringify(group.costSummary)}`,
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

function renderCpcvPboValidation(
  report: CpcvPboValidationReport | null
): string {
  if (report === null) {
    return "cpcv_pbo_validation: null";
  }

  return [
    `schema_version: ${report.schemaVersion}`,
    `cpcv_pbo_status: ${report.status}`,
    `config: ${JSON.stringify(report.config)}`,
    `split_plan: ${JSON.stringify(report.splitPlan)}`,
    `pbo_status: ${report.pbo.status}`,
    `cpcv_pbo_probability: ${formatNullable(report.pbo.probability)}`,
    `evaluated_combination_count: ${report.pbo.evaluatedCombinationCount}`,
    `selected_below_median_count: ${report.pbo.selectedBelowMedianCount}`,
    `lambda_logit_values: ${JSON.stringify(report.pbo.lambdaLogitValues)}`,
    `method_notes: ${JSON.stringify(report.pbo.methodNotes)}`,
    `warnings: ${JSON.stringify(report.warnings)}`,
    `selection_log: ${JSON.stringify(report.selectionLog)}`,
    `performance_matrix: ${JSON.stringify(report.performanceMatrix)}`
  ].join("\n");
}

function renderTripleBarrierLabelDistribution(
  report: TripleBarrierLabelArtifact | null
): string {
  if (report === null) {
    return "triple_barrier_label: null";
  }

  return [
    `schema_version: ${report.schemaVersion}`,
    `generated_at: ${report.generatedAt}`,
    `config_hash: ${report.config.configHash}`,
    `total_label_count: ${report.summary.totalLabelCount}`,
    `available_label_count: ${report.summary.availableLabelCount}`,
    `unavailable_label_count: ${report.summary.unavailableLabelCount}`,
    `positive_count: ${report.summary.positiveCount}`,
    `negative_count: ${report.summary.negativeCount}`,
    `neutral_count: ${report.summary.neutralCount}`,
    `profit_taking_count: ${report.summary.profitTakingCount}`,
    `stop_loss_count: ${report.summary.stopLossCount}`,
    `time_barrier_count: ${report.summary.timeBarrierCount}`,
    `warning_count: ${report.summary.warningCount}`,
    `warnings: ${JSON.stringify(report.warnings)}`
  ].join("\n");
}

function renderMetaLabelEvaluation(
  report: MetaLabelEvaluationReport | null
): string {
  if (report === null) {
    return "meta_label_evaluation: null";
  }

  return [
    `schema_version: ${report.schemaVersion}`,
    `generated_at: ${report.generatedAt}`,
    `total_candidate_count: ${report.summary.totalCandidateCount}`,
    `actionable_candidate_count: ${report.summary.actionableCandidateCount}`,
    `correct_side_count: ${report.summary.correctSideCount}`,
    `wrong_side_count: ${report.summary.wrongSideCount}`,
    `not_actionable_count: ${report.summary.notActionableCount}`,
    `accuracy_ratio: ${formatNullable(report.summary.accuracyRatio)}`
  ].join("\n");
}

function renderUniverseCoverage(
  coverage: BatchReplayUniverseCoverageSummary | null
): string {
  if (coverage === null) {
    return "universe_coverage: null";
  }

  return [
    `universe_id: ${coverage.universeId}`,
    `status: ${coverage.status}`,
    `range: ${coverage.rangeStart}..${coverage.rangeEnd}`,
    `available_symbols: ${coverage.availableSymbolCount}/${coverage.universeSymbolCount}`,
    `available_required_symbols: ${coverage.availableRequiredSymbolCount}/${coverage.requiredSymbolCount}`,
    `available_optional_symbols: ${coverage.availableOptionalSymbolCount}/${coverage.optionalSymbolCount}`,
    `missing_required_symbol_count: ${coverage.missingRequiredSymbolCount}`,
    `missing_optional_symbol_count: ${coverage.missingOptionalSymbolCount}`,
    `insufficient_required_symbol_count: ${coverage.insufficientRequiredSymbolCount}`,
    `insufficient_optional_symbol_count: ${coverage.insufficientOptionalSymbolCount}`,
    `available_market_symbol_counts: ${JSON.stringify(coverage.availableMarketSymbolCounts)}`,
    `available_asset_type_symbol_counts: ${JSON.stringify(coverage.availableAssetTypeSymbolCounts)}`,
    `available_strategy_bucket_symbol_counts: ${JSON.stringify(coverage.availableStrategyBucketSymbolCounts)}`,
    `issues: ${JSON.stringify(coverage.issues)}`,
    `warnings: ${JSON.stringify(coverage.warnings)}`
  ].join("\n");
}

function summarizeUniverseCoverage(
  coverage: HistoricalUniverseCoverageReport | null,
  sourcePath: string | null
): BatchReplayUniverseCoverageSummary | null {
  if (coverage === null) {
    return null;
  }

  const summary: Omit<BatchReplayUniverseCoverageSummary, "warnings"> = {
    sourcePath,
    universeId: coverage.universeId,
    status: coverage.status,
    rangeStart: coverage.rangeStart,
    rangeEnd: coverage.rangeEnd,
    universeSymbolCount: coverage.universeSymbolCount,
    requiredSymbolCount: coverage.requiredSymbolCount,
    optionalSymbolCount: coverage.optionalSymbolCount,
    availableSymbolCount: coverage.availableSymbolCount,
    availableRequiredSymbolCount: coverage.availableRequiredSymbolCount,
    availableOptionalSymbolCount: coverage.availableOptionalSymbolCount,
    missingRequiredSymbolCount: coverage.missingRequiredSymbols.length,
    missingOptionalSymbolCount: coverage.missingOptionalSymbols.length,
    insufficientRequiredSymbolCount: coverage.insufficientRequiredSymbols.length,
    insufficientOptionalSymbolCount:
      coverage.insufficientOptionalSymbols.length,
    missingRequiredMarketCount: coverage.missingRequiredMarkets.length,
    missingRequiredAssetTypeCount: coverage.missingRequiredAssetTypes.length,
    missingRequiredStrategyBucketCount:
      coverage.missingRequiredStrategyBuckets.length,
    insufficientAvailableMarketSymbolCount:
      coverage.insufficientAvailableMarketSymbolCounts.length,
    insufficientAvailableAssetTypeSymbolCount:
      coverage.insufficientAvailableAssetTypeSymbolCounts.length,
    insufficientAvailableStrategyBucketSymbolCount:
      coverage.insufficientAvailableStrategyBucketSymbolCounts.length,
    corruptLineCount: coverage.corruptLineCount,
    availableMarketSymbolCounts: coverage.availableMarketSymbolCounts,
    availableAssetTypeSymbolCounts: coverage.availableAssetTypeSymbolCounts,
    availableStrategyBucketSymbolCounts:
      coverage.availableStrategyBucketSymbolCounts,
    issues: [...coverage.issues]
  };

  return {
    ...summary,
    warnings: universeCoverageWarnings(summary)
  };
}

function universeCoverageWarnings(
  summary: Omit<BatchReplayUniverseCoverageSummary, "warnings">
): string[] {
  const warnings: string[] = [];
  if (summary.status === "insufficient") {
    warnings.push(
      [
        "universe selection bias warning:",
        `coverage status is insufficient for ${summary.universeId};`,
        `available_required_symbols=${summary.availableRequiredSymbolCount}/${summary.requiredSymbolCount};`,
        `available_symbols=${summary.availableSymbolCount}/${summary.universeSymbolCount}`
      ].join(" ")
    );
  }
  if (
    summary.missingOptionalSymbolCount > 0 ||
    summary.insufficientOptionalSymbolCount > 0
  ) {
    warnings.push(
      [
        "universe selection bias warning:",
        `optional coverage is incomplete for ${summary.universeId};`,
        `available_optional_symbols=${summary.availableOptionalSymbolCount}/${summary.optionalSymbolCount}`
      ].join(" ")
    );
  }
  if (summary.issues.length > 0) {
    warnings.push(
      `universe coverage issues: ${summary.issues.slice().sort().join(",")}`
    );
  }
  return warnings;
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
