import type {
  BatchReplayAggregateReport,
  BatchReplayGroupSummary,
  BatchReplaySelectionTrialBucket
} from "./batchReplayReport.js";

export const REPLAY_RESEARCH_REPORT_VERSION = "replay_research_report.v1";

export interface ReplayResearchReportOptions {
  aggregateReport: BatchReplayAggregateReport;
  generatedAt: Date;
  title?: string;
}

export interface ReplayResearchReport {
  title: string;
  mode: "paper_only";
  reportVersion: typeof REPLAY_RESEARCH_REPORT_VERSION;
  generatedAt: string;
  sourceGeneratedAt: string;
  sourceRunsPath: string | null;
  sourceSelectionTrialsPath: string | null;
  runIdentity: ReplayResearchRunIdentity;
  reproducibilityHashes: ReplayResearchReproducibilityHashes;
  validationProtocol: ReplayResearchValidationProtocol;
  dataUniverseCoverage: ReplayResearchDataUniverseCoverage;
  promptTrialDistribution: ReplayResearchPromptTrialDistribution;
  riskAllocationPolicy: ReplayResearchRiskAllocationPolicy;
  executionAssumptions: ReplayResearchExecutionAssumptions;
  costBreakdown: ReplayResearchAvailabilitySection;
  exposureBreakdown: ReplayResearchExposureBreakdown;
  regimeBreakdown: ReplayResearchGroupBreakdown[];
  bucketBreakdown: ReplayResearchBucketBreakdown;
  benchmarkComparison: ReplayResearchAvailabilitySection;
  overfittingWarning: ReplayResearchOverfittingWarning;
  providerFailureSummary: ReplayResearchProviderFailureSummary;
  riskRejectSummary: ReplayResearchRiskRejectSummary;
  warnings: string[];
  disclaimer: string;
}

export interface ReplayResearchRunIdentity {
  runCount: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  returnSampleCount: number;
  targetReturnThresholds: number[];
}

export interface ReplayResearchReproducibilityHashes {
  promptHashes: ReplayResearchBucket[];
  configHashes: ReplayResearchBucket[];
  riskPolicyHashes: ReplayResearchBucket[];
  exitPolicyHashes: ReplayResearchBucket[];
}

export interface ReplayResearchValidationProtocol {
  validationSplitRoleCounts: Record<string, number>;
  overfittingDiagnosticStatus: "available" | "unavailable";
  validationProtocol: string | null;
  selectionMetric: string | null;
  expectedSampledCpcvSplitCount: number | null;
  sampledCpcvSplitCount: number | null;
  sampledCpcvSplitCountMatchesExpected: boolean | null;
  pboLikeScore: number | null;
  warnings: string[];
}

export interface ReplayResearchDataUniverseCoverage {
  regimeCounts: Record<string, number>;
  regimeCountsByMarket: Record<string, Record<string, number>>;
}

export interface ReplayResearchPromptTrialDistribution {
  trialCount: number | null;
  selectedCount: number | null;
  unselectedCount: number | null;
  statusCounts: Record<string, number>;
  decisionProviderModes: ReplayResearchBucket[];
  aiDecisionFailureTrialCount: number | null;
  rejectedTrialCount: number | null;
  noTradeTrialCount: number | null;
}

export interface ReplayResearchRiskAllocationPolicy {
  riskProfiles: ReplayResearchBucket[];
  averageTargetExposureRatio: number | null;
  averageTargetExposureGapRatio: number | null;
  averageFinalTargetExposureGapRatio: number | null;
}

export interface ReplayResearchExecutionAssumptions {
  paperOnly: true;
  liveTradingEnabled: false;
  generatedFromStoredArtifacts: true;
  replayExecutedByThisReport: false;
  orderPlacementEnabled: false;
}

export interface ReplayResearchAvailabilitySection {
  status: "available" | "unavailable";
  reason: string | null;
}

export interface ReplayResearchExposureBreakdown {
  averageExposureRatio: number | null;
  averageCashRatio: number | null;
  averageTimeInMarketRatio: number | null;
  averageFinalCashRatio: number | null;
  averageFinalPositionRatio: number | null;
  averageFinalExposureByMarketKrw: Record<string, number>;
  averageFinalExposureByAssetTypeKrw: Record<string, number>;
}

export interface ReplayResearchGroupBreakdown {
  key: string;
  runCount: number;
  completedCount: number;
  returnSampleCount: number;
  averageTotalReturnRatio: number | null;
  winRate: number | null;
  totalAiDecisionFailureCount: number;
  totalRejectedCount: number;
  totalMeaningfulRejectCount: number;
  totalDustRejectCount: number;
}

export interface ReplayResearchBucketBreakdown {
  validationSplitRoles: ReplayResearchGroupBreakdown[];
  promptHashes: ReplayResearchBucket[];
  configHashes: ReplayResearchBucket[];
  riskProfiles: ReplayResearchBucket[];
}

export interface ReplayResearchOverfittingWarning {
  status: "available" | "unavailable";
  pboLikeScore: number | null;
  selectedCandidateKey: string | null;
  selectedTrainAverageTotalReturnRatio: number | null;
  holdoutDegradationCount: number;
  warnings: string[];
}

export interface ReplayResearchProviderFailureSummary {
  totalAiDecisionFailureCount: number;
  aiDecisionFailureTrialCount: number | null;
  byRegime: Array<{ key: string; totalAiDecisionFailureCount: number }>;
}

export interface ReplayResearchRiskRejectSummary {
  totalRejectedCount: number;
  totalMeaningfulRejectCount: number;
  totalDustRejectCount: number;
  rejectedTrialCount: number | null;
  byRegime: Array<{
    key: string;
    totalRejectedCount: number;
    totalMeaningfulRejectCount: number;
    totalDustRejectCount: number;
  }>;
}

export interface ReplayResearchBucket {
  key: string | null;
  count: number;
  runIds: string[];
}

export function buildReplayResearchReport(
  options: ReplayResearchReportOptions
): ReplayResearchReport {
  const aggregate = options.aggregateReport;
  const overall = aggregate.overall;
  const trialSummary = aggregate.trialSummary ?? null;
  const diagnostics = aggregate.overfittingDiagnostics ?? null;
  const regimeBreakdown = groupBreakdown(aggregate.byRegime);
  const validationRoleBreakdown = groupBreakdown(
    aggregate.byValidationSplitRole
  );
  const warnings = researchWarnings(aggregate);

  return {
    title: options.title ?? "Replay Research Paper Report",
    mode: "paper_only",
    reportVersion: REPLAY_RESEARCH_REPORT_VERSION,
    generatedAt: options.generatedAt.toISOString(),
    sourceGeneratedAt: aggregate.generatedAt,
    sourceRunsPath: aggregate.sourceRunsPath,
    sourceSelectionTrialsPath: aggregate.sourceSelectionTrialsPath,
    runIdentity: {
      runCount: aggregate.summary.runCount,
      completedCount: aggregate.summary.completedCount,
      skippedCount: aggregate.summary.skippedCount,
      failedCount: aggregate.summary.failedCount,
      returnSampleCount: aggregate.summary.returnSampleCount,
      targetReturnThresholds: aggregate.targetReturnThresholds ?? []
    },
    reproducibilityHashes: {
      promptHashes: buckets(trialSummary?.promptHashes),
      configHashes: buckets(trialSummary?.configHashes),
      riskPolicyHashes: buckets(trialSummary?.riskPolicyHashes),
      exitPolicyHashes: buckets(trialSummary?.exitPolicyHashes)
    },
    validationProtocol: {
      validationSplitRoleCounts: numberMap(
        aggregate.summary.validationSplitRoleCounts
      ),
      overfittingDiagnosticStatus:
        diagnostics === null ? "unavailable" : "available",
      validationProtocol: diagnostics?.validationProtocol ?? null,
      selectionMetric: diagnostics?.selectionMetric ?? null,
      expectedSampledCpcvSplitCount:
        diagnostics?.expectedSampledCpcvSplitCount ?? null,
      sampledCpcvSplitCount: diagnostics?.sampledCpcvSplitCount ?? null,
      sampledCpcvSplitCountMatchesExpected:
        diagnostics?.sampledCpcvSplitCountMatchesExpected ?? null,
      pboLikeScore: diagnostics?.pboLikeScore ?? null,
      warnings: diagnostics?.warnings ?? []
    },
    dataUniverseCoverage: {
      regimeCounts: numberMap(aggregate.summary.regimeCounts),
      regimeCountsByMarket: nestedNumberMap(
        aggregate.summary.regimeCountsByMarket
      )
    },
    promptTrialDistribution: {
      trialCount: trialSummary?.trialCount ?? null,
      selectedCount: trialSummary?.selectedCount ?? null,
      unselectedCount: trialSummary?.unselectedCount ?? null,
      statusCounts: numberMap(trialSummary?.statusCounts),
      decisionProviderModes: buckets(trialSummary?.decisionProviderModes),
      aiDecisionFailureTrialCount:
        trialSummary?.aiDecisionFailureTrialCount ?? null,
      rejectedTrialCount: trialSummary?.rejectedTrialCount ?? null,
      noTradeTrialCount: trialSummary?.noTradeTrialCount ?? null
    },
    riskAllocationPolicy: {
      riskProfiles: buckets(trialSummary?.riskProfiles),
      averageTargetExposureRatio: readNumber(
        overall.averageTargetExposureRatio
      ),
      averageTargetExposureGapRatio: readNumber(
        overall.averageTargetExposureGapRatio
      ),
      averageFinalTargetExposureGapRatio: readNumber(
        overall.averageFinalTargetExposureGapRatio
      )
    },
    executionAssumptions: {
      paperOnly: true,
      liveTradingEnabled: false,
      generatedFromStoredArtifacts: true,
      replayExecutedByThisReport: false,
      orderPlacementEnabled: false
    },
    costBreakdown: {
      status: "unavailable",
      reason:
        "aggregate report does not contain per-run execution cost components"
    },
    exposureBreakdown: {
      averageExposureRatio: readNumber(overall.averageExposureRatio),
      averageCashRatio: readNumber(overall.averageCashRatio),
      averageTimeInMarketRatio: readNumber(overall.averageTimeInMarketRatio),
      averageFinalCashRatio: readNumber(overall.averageFinalCashRatio),
      averageFinalPositionRatio: readNumber(overall.averageFinalPositionRatio),
      averageFinalExposureByMarketKrw: numberMap(
        overall.averageFinalExposureByMarketKrw
      ),
      averageFinalExposureByAssetTypeKrw: numberMap(
        overall.averageFinalExposureByAssetTypeKrw
      )
    },
    regimeBreakdown,
    bucketBreakdown: {
      validationSplitRoles: validationRoleBreakdown,
      promptHashes: buckets(trialSummary?.promptHashes),
      configHashes: buckets(trialSummary?.configHashes),
      riskProfiles: buckets(trialSummary?.riskProfiles)
    },
    benchmarkComparison: {
      status: "unavailable",
      reason:
        "aggregate report does not contain per-run benchmark comparison samples"
    },
    overfittingWarning: {
      status: diagnostics === null ? "unavailable" : "available",
      pboLikeScore: diagnostics?.pboLikeScore ?? null,
      selectedCandidateKey: diagnostics?.selectedCandidateKey ?? null,
      selectedTrainAverageTotalReturnRatio:
        diagnostics?.selectedTrainAverageTotalReturnRatio ?? null,
      holdoutDegradationCount: diagnostics?.holdoutDegradation.length ?? 0,
      warnings: diagnostics?.warnings ?? []
    },
    providerFailureSummary: {
      totalAiDecisionFailureCount: readInteger(
        overall.totalAiDecisionFailureCount
      ),
      aiDecisionFailureTrialCount:
        trialSummary?.aiDecisionFailureTrialCount ?? null,
      byRegime: regimeBreakdown.map((group) => ({
        key: group.key,
        totalAiDecisionFailureCount: group.totalAiDecisionFailureCount
      }))
    },
    riskRejectSummary: {
      totalRejectedCount: readInteger(overall.totalRejectedCount),
      totalMeaningfulRejectCount: readInteger(
        overall.totalMeaningfulRejectCount
      ),
      totalDustRejectCount: readInteger(overall.totalDustRejectCount),
      rejectedTrialCount: trialSummary?.rejectedTrialCount ?? null,
      byRegime: regimeBreakdown.map((group) => ({
        key: group.key,
        totalRejectedCount: group.totalRejectedCount,
        totalMeaningfulRejectCount: group.totalMeaningfulRejectCount,
        totalDustRejectCount: group.totalDustRejectCount
      }))
    },
    warnings,
    disclaimer: replayResearchDisclaimer()
  };
}

function groupBreakdown(
  groups: Partial<Record<string, BatchReplayGroupSummary>> | undefined
): ReplayResearchGroupBreakdown[] {
  return Object.entries(groups ?? {})
    .filter((entry): entry is [string, BatchReplayGroupSummary] => !!entry[1])
    .map(([key, group]) => ({
      key,
      runCount: group.runCount,
      completedCount: group.completedCount,
      returnSampleCount: group.returnSampleCount,
      averageTotalReturnRatio: readNumber(group.averageTotalReturnRatio),
      winRate: readNumber(group.winRate),
      totalAiDecisionFailureCount: readInteger(
        group.totalAiDecisionFailureCount
      ),
      totalRejectedCount: readInteger(group.totalRejectedCount),
      totalMeaningfulRejectCount: readInteger(group.totalMeaningfulRejectCount),
      totalDustRejectCount: readInteger(group.totalDustRejectCount)
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function buckets(
  values: BatchReplaySelectionTrialBucket[] | undefined
): ReplayResearchBucket[] {
  return (values ?? []).map((bucket) => ({
    key: bucket.key,
    count: bucket.count,
    runIds: bucket.runIds
  }));
}

function researchWarnings(report: BatchReplayAggregateReport): string[] {
  const warnings: string[] = [];
  if (report.trialSummary === null || report.trialSummary === undefined) {
    warnings.push(
      "trial distribution unavailable: aggregate report has no selection trial summary"
    );
  }
  if (
    report.overfittingDiagnostics === null ||
    report.overfittingDiagnostics === undefined
  ) {
    warnings.push(
      "overfitting diagnostics unavailable: aggregate report has no validation trial diagnostics"
    );
  }
  if (
    Object.keys(numberMap(report.summary.validationSplitRoleCounts)).length === 0
  ) {
    warnings.push(
      "validation split role counts unavailable: batch records do not include validation split metadata"
    );
  }
  warnings.push(
    "cost breakdown unavailable: aggregate report does not contain per-run execution cost components"
  );
  warnings.push(
    "benchmark comparison unavailable: aggregate report does not contain per-run benchmark comparison samples"
  );
  return warnings;
}

function numberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, readNumber(entry)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== null)
  );
}

function nestedNumberMap(value: unknown): Record<string, Record<string, number>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, numberMap(entry)])
  );
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

function replayResearchDisclaimer(): string {
  return [
    "Paper-only replay research report generated from stored artifacts.",
    "This is not investment advice, not a performance guarantee, and cannot place live orders."
  ].join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
