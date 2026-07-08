import type {
  BatchReplayAggregateReport,
  BatchReplayCostBreakdownSummary,
  BatchReplayStrategyBucketCostBreakdownSummary,
  BatchReplayGroupSummary,
  BatchReplaySelectionTrialBucket,
  BatchReplayUniverseCoverageSummary
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
  costBreakdown: ReplayResearchCostBreakdown;
  exposureBreakdown: ReplayResearchExposureBreakdown;
  regimeBreakdown: ReplayResearchGroupBreakdown[];
  bucketBreakdown: ReplayResearchBucketBreakdown;
  benchmarkComparison: ReplayResearchAvailabilitySection;
  overfittingWarning: ReplayResearchOverfittingWarning;
  sharpeValidation: ReplayResearchSharpeValidationSummary;
  cpcvPboWarning: ReplayResearchCpcvPboWarning;
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
  coverageReportStatus: "available" | "insufficient" | "missing";
  sourcePath: string | null;
  universeId: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  universeSymbolCount: number | null;
  requiredSymbolCount: number | null;
  optionalSymbolCount: number | null;
  availableSymbolCount: number | null;
  availableRequiredSymbolCount: number | null;
  availableOptionalSymbolCount: number | null;
  missingRequiredSymbolCount: number | null;
  missingOptionalSymbolCount: number | null;
  insufficientRequiredSymbolCount: number | null;
  insufficientOptionalSymbolCount: number | null;
  missingRequiredStrategyBucketCount: number | null;
  insufficientAvailableStrategyBucketSymbolCount: number | null;
  availableMarketSymbolCounts: Record<string, number>;
  availableAssetTypeSymbolCounts: Record<string, number>;
  availableStrategyBucketSymbolCounts: Record<string, number>;
  issues: string[];
  warnings: string[];
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

export interface ReplayResearchCostBreakdown
  extends ReplayResearchAvailabilitySection {
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
  byStrategyBucket: ReplayResearchStrategyBucketCostBreakdown[];
  runIds: string[];
}

export interface ReplayResearchStrategyBucketCostBreakdown {
  strategyBucket: BatchReplayStrategyBucketCostBreakdownSummary["strategyBucket"];
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

export interface ReplayResearchCpcvPboWarning {
  status: "missing" | "available" | "sampled" | "unavailable";
  schemaVersion: string | null;
  pboStatus: string | null;
  pboProbability: number | null;
  evaluatedCombinationCount: number;
  selectedBelowMedianCount: number;
  combinationMode: string | null;
  splitPlanAvailable: boolean;
  warnings: string[];
  readOnlyNotice: string;
}

export interface ReplayResearchSharpeValidationSummary {
  status: "missing" | "available" | "unavailable";
  schemaVersion: string | null;
  returnSampleCount: number;
  minimumSampleCount: number | null;
  sampleSharpeStatus: string | null;
  sampleSharpeValue: number | null;
  loAdjustedSharpeStatus: string | null;
  probabilisticSharpeRatioStatus: string | null;
  probabilisticSharpeRatioProbability: number | null;
  deflatedSharpeRatioStatus: string | null;
  deflatedSharpeRatioProbability: number | null;
  selectionContext: {
    candidateCount: number | null;
    trialCount: number | null;
    trialSharpeRatioStandardDeviation: number | null;
    selectedByMetric: string | null;
    multipleTestingAdjustment: string | null;
  };
  warnings: string[];
  readOnlyNotice: string;
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
  const universeCoverage = aggregate.universeCoverage ?? null;
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
      ),
      ...researchUniverseCoverage(universeCoverage)
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
    costBreakdown: researchCostBreakdown(overall.costSummary),
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
    sharpeValidation: researchSharpeValidation(overall.sharpeValidation),
    cpcvPboWarning: researchCpcvPboWarning(aggregate.cpcvPboValidation),
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

function researchSharpeValidation(
  report: BatchReplayGroupSummary["sharpeValidation"] | null | undefined
): ReplayResearchSharpeValidationSummary {
  if (report === null || report === undefined) {
    return {
      status: "missing",
      schemaVersion: null,
      returnSampleCount: 0,
      minimumSampleCount: null,
      sampleSharpeStatus: null,
      sampleSharpeValue: null,
      loAdjustedSharpeStatus: null,
      probabilisticSharpeRatioStatus: null,
      probabilisticSharpeRatioProbability: null,
      deflatedSharpeRatioStatus: null,
      deflatedSharpeRatioProbability: null,
      selectionContext: {
        candidateCount: null,
        trialCount: null,
        trialSharpeRatioStandardDeviation: null,
        selectedByMetric: null,
        multipleTestingAdjustment: null
      },
      warnings: ["sharpe_validation.v1 artifact is missing"],
      readOnlyNotice: sharpeValidationReadOnlyNotice()
    };
  }

  return {
    status: report.status,
    schemaVersion: report.schemaVersion,
    returnSampleCount: report.sample.returnSampleCount,
    minimumSampleCount: report.sample.minimumSampleCount,
    sampleSharpeStatus: report.metrics.sampleSharpe.status,
    sampleSharpeValue: report.metrics.sampleSharpe.value,
    loAdjustedSharpeStatus: report.metrics.loAdjustedSharpe.status,
    probabilisticSharpeRatioStatus:
      report.metrics.probabilisticSharpeRatio.status,
    probabilisticSharpeRatioProbability:
      report.metrics.probabilisticSharpeRatio.probability,
    deflatedSharpeRatioStatus: report.metrics.deflatedSharpeRatio.status,
    deflatedSharpeRatioProbability: report.metrics.deflatedSharpeRatio.value,
    selectionContext: {
      candidateCount: report.selectionContext.candidateCount,
      trialCount: report.selectionContext.trialCount,
      trialSharpeRatioStandardDeviation:
        report.selectionContext.trialSharpeRatioStandardDeviation,
      selectedByMetric: report.selectionContext.selectedByMetric,
      multipleTestingAdjustment:
        report.selectionContext.multipleTestingAdjustment
    },
    warnings: report.warnings.map((warning) =>
      `${warning.code} (${warning.severity}): ${warning.message}`
    ),
    readOnlyNotice: sharpeValidationReadOnlyNotice()
  };
}

function sharpeValidationReadOnlyNotice(): string {
  return [
    "Sharpe validation is paper-only research evidence.",
    "It is not a strategy recommendation or performance guarantee."
  ].join(" ");
}

function researchCpcvPboWarning(
  report: BatchReplayAggregateReport["cpcvPboValidation"]
): ReplayResearchCpcvPboWarning {
  if (report === null || report === undefined) {
    return {
      status: "missing",
      schemaVersion: null,
      pboStatus: null,
      pboProbability: null,
      evaluatedCombinationCount: 0,
      selectedBelowMedianCount: 0,
      combinationMode: null,
      splitPlanAvailable: false,
      warnings: ["cpcv_pbo_validation.v1 artifact is missing"],
      readOnlyNotice: cpcvPboReadOnlyNotice()
    };
  }

  return {
    status: report.status,
    schemaVersion: report.schemaVersion,
    pboStatus: report.pbo.status,
    pboProbability: report.pbo.probability,
    evaluatedCombinationCount: report.pbo.evaluatedCombinationCount,
    selectedBelowMedianCount: report.pbo.selectedBelowMedianCount,
    combinationMode: report.config.combinationMode,
    splitPlanAvailable: report.splitPlan !== null,
    warnings: report.warnings.map((warning) =>
      `${warning.code} (${warning.severity}): ${warning.message}`
    ),
    readOnlyNotice: cpcvPboReadOnlyNotice()
  };
}

function cpcvPboReadOnlyNotice(): string {
  return [
    "CPCV/PBO validation is paper-only research evidence.",
    "It is not a strategy recommendation or performance guarantee."
  ].join(" ");
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

function researchUniverseCoverage(
  coverage: BatchReplayUniverseCoverageSummary | null
): Omit<
  ReplayResearchDataUniverseCoverage,
  "regimeCounts" | "regimeCountsByMarket"
> {
  if (coverage === null) {
    return {
      coverageReportStatus: "missing",
      sourcePath: null,
      universeId: null,
      rangeStart: null,
      rangeEnd: null,
      universeSymbolCount: null,
      requiredSymbolCount: null,
      optionalSymbolCount: null,
      availableSymbolCount: null,
      availableRequiredSymbolCount: null,
      availableOptionalSymbolCount: null,
      missingRequiredSymbolCount: null,
      missingOptionalSymbolCount: null,
      insufficientRequiredSymbolCount: null,
      insufficientOptionalSymbolCount: null,
      missingRequiredStrategyBucketCount: null,
      insufficientAvailableStrategyBucketSymbolCount: null,
      availableMarketSymbolCounts: {},
      availableAssetTypeSymbolCounts: {},
      availableStrategyBucketSymbolCounts: {},
      issues: [],
      warnings: []
    };
  }

  return {
    coverageReportStatus: coverage.status,
    sourcePath: coverage.sourcePath,
    universeId: coverage.universeId,
    rangeStart: coverage.rangeStart,
    rangeEnd: coverage.rangeEnd,
    universeSymbolCount: coverage.universeSymbolCount,
    requiredSymbolCount: coverage.requiredSymbolCount,
    optionalSymbolCount: coverage.optionalSymbolCount,
    availableSymbolCount: coverage.availableSymbolCount,
    availableRequiredSymbolCount: coverage.availableRequiredSymbolCount,
    availableOptionalSymbolCount: coverage.availableOptionalSymbolCount,
    missingRequiredSymbolCount: coverage.missingRequiredSymbolCount,
    missingOptionalSymbolCount: coverage.missingOptionalSymbolCount,
    insufficientRequiredSymbolCount: coverage.insufficientRequiredSymbolCount,
    insufficientOptionalSymbolCount: coverage.insufficientOptionalSymbolCount,
    missingRequiredStrategyBucketCount: readNumber(
      coverage.missingRequiredStrategyBucketCount
    ),
    insufficientAvailableStrategyBucketSymbolCount: readNumber(
      coverage.insufficientAvailableStrategyBucketSymbolCount
    ),
    availableMarketSymbolCounts: numberMap(coverage.availableMarketSymbolCounts),
    availableAssetTypeSymbolCounts: numberMap(
      coverage.availableAssetTypeSymbolCounts
    ),
    availableStrategyBucketSymbolCounts: numberMap(
      coverage.availableStrategyBucketSymbolCounts
    ),
    issues: [...coverage.issues],
    warnings: [...coverage.warnings]
  };
}

function researchCostBreakdown(
  costSummary: BatchReplayCostBreakdownSummary | null | undefined
): ReplayResearchCostBreakdown {
  const summary = costSummary ?? emptyCostBreakdownSummary();
  const status = summary.sampleCount === 0 ? "unavailable" : "available";
  return {
    status,
    reason:
      status === "unavailable"
        ? "aggregate report does not contain per-run execution cost components"
        : null,
    sampleCount: summary.sampleCount,
    tradeCount: summary.tradeCount,
    feeKrw: summary.feeKrw,
    taxKrw: summary.taxKrw,
    slippageKrw: summary.slippageKrw,
    spreadCostKrw: summary.spreadCostKrw,
    impactCostKrw: summary.impactCostKrw,
    totalCostKrw: summary.totalCostKrw,
    averageCostPerRunKrw: summary.averageCostPerRunKrw,
    averageCostPerTradeKrw: summary.averageCostPerTradeKrw,
    filledCount: summary.filledCount,
    partialFillCount: summary.partialFillCount,
    notModeledLiquidityCount: summary.notModeledLiquidityCount,
    averageRunParticipationRate: summary.averageRunParticipationRate,
    maxParticipationRate: summary.maxParticipationRate,
    costModelVersions: [...summary.costModelVersions],
    byStrategyBucket: (summary.byStrategyBucket ?? []).map((bucket) => ({
      strategyBucket: bucket.strategyBucket,
      sampleCount: bucket.sampleCount,
      tradeCount: bucket.tradeCount,
      feeKrw: bucket.feeKrw,
      taxKrw: bucket.taxKrw,
      slippageKrw: bucket.slippageKrw,
      spreadCostKrw: bucket.spreadCostKrw,
      impactCostKrw: bucket.impactCostKrw,
      totalCostKrw: bucket.totalCostKrw,
      averageCostPerRunKrw: bucket.averageCostPerRunKrw,
      averageCostPerTradeKrw: bucket.averageCostPerTradeKrw,
      filledCount: bucket.filledCount,
      partialFillCount: bucket.partialFillCount,
      notModeledLiquidityCount: bucket.notModeledLiquidityCount,
      averageRunParticipationRate: bucket.averageRunParticipationRate,
      maxParticipationRate: bucket.maxParticipationRate,
      costModelVersions: [...bucket.costModelVersions],
      runIds: [...bucket.runIds]
    })),
    runIds: [...summary.runIds]
  };
}

function emptyCostBreakdownSummary(): BatchReplayCostBreakdownSummary {
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
    byStrategyBucket: [],
    runIds: []
  };
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
  if (report.universeCoverage === null || report.universeCoverage === undefined) {
    warnings.push(
      "universe coverage unavailable: aggregate report has no historical universe coverage summary"
    );
  } else {
    warnings.push(...report.universeCoverage.warnings);
  }
  if ((report.overall.costSummary?.sampleCount ?? 0) === 0) {
    warnings.push(
      "cost breakdown unavailable: aggregate report does not contain per-run execution cost components"
    );
  }
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
