import { z } from "zod";

import {
  cpcvCombinationModeSchema,
  cpcvSplitCombinationSchema,
  cpcvSplitPlanSchema,
  cpcvValidationProtocolSchema,
  type CpcvSplitPlan
} from "./combinatorialPurgedCv.js";

export const CPCV_PBO_VALIDATION_SCHEMA_VERSION =
  "cpcv_pbo_validation.v1";

export const cpcvPboReportStatusSchema = z.enum([
  "available",
  "sampled",
  "unavailable"
]);

export const cpcvPboEstimateStatusSchema = z.enum([
  "computed",
  "insufficient_matrix",
  "budget_exceeded",
  "not_applicable"
]);

export const cpcvPboWarningCodeSchema = z.enum([
  "CPCV_CONFIG_INVALID",
  "CPCV_COMBINATION_BUDGET_EXCEEDED",
  "CPCV_SAMPLED_MODE_USED",
  "CPCV_PURGE_OR_EMBARGO_REMOVED_ALL_TRAIN",
  "PBO_CANDIDATE_COUNT_INSUFFICIENT",
  "PBO_HOLDOUT_MATRIX_INSUFFICIENT",
  "PBO_SELECTION_TIE_BREAK_APPLIED"
]);

export const cpcvPboWarningSeveritySchema = z.enum(["info", "warning"]);

export const cpcvPboValidationConfigSchema = z
  .object({
    validationProtocol: cpcvValidationProtocolSchema,
    foldCount: z.number().int().min(2),
    testFoldCount: z.number().int().min(1),
    purgeDurationDays: z.number().int().nonnegative(),
    embargoDurationDays: z.number().int().nonnegative(),
    selectionMetric: z.literal("total_return_ratio"),
    tieBreaker: z.literal("candidate_key_asc"),
    maxCombinationCount: z.number().int().min(1),
    combinationMode: cpcvCombinationModeSchema,
    randomSeed: z.string().trim().min(1).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.testFoldCount >= value.foldCount) {
      context.addIssue({
        code: "custom",
        message: "testFoldCount must be less than foldCount"
      });
    }
    if (value.combinationMode === "exhaustive" && value.randomSeed !== null) {
      context.addIssue({
        code: "custom",
        message: "randomSeed must be null for exhaustive mode"
      });
    }
    if (value.combinationMode === "sampled" && value.randomSeed === null) {
      context.addIssue({
        code: "custom",
        message: "randomSeed is required for sampled mode"
      });
    }
  });

export const cpcvSplitPlanSummarySchema = z
  .object({
    foldCount: z.number().int().min(2),
    testFoldCount: z.number().int().min(1),
    requestedCombinationCount: z.number().int().nonnegative(),
    emittedCombinationCount: z.number().int().nonnegative(),
    skippedCombinationCount: z.number().int().nonnegative(),
    combinations: z.array(cpcvSplitCombinationSchema)
  })
  .strict();

export const cpcvCandidateSplitMetricSchema = z
  .object({
    combinationId: z.string().trim().min(1),
    trainMetric: z.number().finite().nullable(),
    testMetric: z.number().finite().nullable(),
    trainReturnSampleCount: z.number().int().nonnegative(),
    testReturnSampleCount: z.number().int().nonnegative()
  })
  .strict();

export const cpcvCandidatePerformanceRowSchema = z
  .object({
    candidateKey: z.string().trim().min(1),
    promptHash: z.string().trim().min(1).nullable(),
    configHash: z.string().trim().min(1).nullable(),
    riskPolicyHash: z.string().trim().min(1).nullable(),
    exitPolicyHash: z.string().trim().min(1).nullable(),
    splitMetrics: z.array(cpcvCandidateSplitMetricSchema)
  })
  .strict()
  .superRefine((value, context) => {
    validateUniqueIds(
      context,
      value.splitMetrics.map((metric) => metric.combinationId),
      "splitMetrics combinationId values must be unique per candidate"
    );
  });

export const cpcvSelectionLogEntrySchema = z
  .object({
    combinationId: z.string().trim().min(1),
    selectedCandidateKey: z.string().trim().min(1).nullable(),
    selectedTrainMetric: z.number().finite().nullable(),
    selectedTestMetric: z.number().finite().nullable(),
    testRankPercentile: z.number().min(0).max(1).nullable(),
    tieBreakApplied: z.boolean()
  })
  .strict();

export const cpcvPboEstimateSchema = z
  .object({
    status: cpcvPboEstimateStatusSchema,
    probability: z.number().min(0).max(1).nullable(),
    evaluatedCombinationCount: z.number().int().nonnegative(),
    selectedBelowMedianCount: z.number().int().nonnegative(),
    lambdaLogitValues: z.array(z.number().finite()),
    methodNotes: z.array(z.string().trim().min(1))
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "computed" && value.probability === null) {
      context.addIssue({
        code: "custom",
        message: "computed PBO must include probability"
      });
    }
    if (value.status !== "computed" && value.probability !== null) {
      context.addIssue({
        code: "custom",
        message: "non-computed PBO probability must be null"
      });
    }
    if (value.selectedBelowMedianCount > value.evaluatedCombinationCount) {
      context.addIssue({
        code: "custom",
        message:
          "selectedBelowMedianCount must not exceed evaluatedCombinationCount"
      });
    }
  });

export const cpcvPboWarningSchema = z
  .object({
    code: cpcvPboWarningCodeSchema,
    severity: cpcvPboWarningSeveritySchema,
    message: z.string().trim().min(1)
  })
  .strict();

export const cpcvPboValidationReportSchema = z
  .object({
    schemaVersion: z.literal(CPCV_PBO_VALIDATION_SCHEMA_VERSION),
    status: cpcvPboReportStatusSchema,
    generatedAt: z.string().datetime(),
    config: cpcvPboValidationConfigSchema,
    splitPlan: cpcvSplitPlanSummarySchema.nullable(),
    performanceMatrix: z.array(cpcvCandidatePerformanceRowSchema),
    selectionLog: z.array(cpcvSelectionLogEntrySchema),
    pbo: cpcvPboEstimateSchema,
    warnings: z.array(cpcvPboWarningSchema)
  })
  .strict()
  .superRefine((value, context) => {
    validateUniqueIds(
      context,
      value.performanceMatrix.map((row) => row.candidateKey),
      "performanceMatrix candidateKey values must be unique"
    );
    if (value.status === "unavailable" && value.pbo.status === "computed") {
      context.addIssue({
        code: "custom",
        message: "unavailable report must not include computed PBO"
      });
    }
  });

export type CpcvPboReportStatus = z.infer<typeof cpcvPboReportStatusSchema>;
export type CpcvPboEstimateStatus = z.infer<
  typeof cpcvPboEstimateStatusSchema
>;
export type CpcvPboWarningCode = z.infer<typeof cpcvPboWarningCodeSchema>;
export type CpcvPboValidationConfig = z.infer<
  typeof cpcvPboValidationConfigSchema
>;
export type CpcvSplitPlanSummary = z.infer<typeof cpcvSplitPlanSummarySchema>;
export type CpcvCandidateSplitMetric = z.infer<
  typeof cpcvCandidateSplitMetricSchema
>;
export type CpcvCandidatePerformanceRow = z.infer<
  typeof cpcvCandidatePerformanceRowSchema
>;
export type CpcvSelectionLogEntry = z.infer<
  typeof cpcvSelectionLogEntrySchema
>;
export type CpcvPboEstimate = z.infer<typeof cpcvPboEstimateSchema>;
export type CpcvPboWarning = z.infer<typeof cpcvPboWarningSchema>;
export type CpcvPboValidationReport = z.infer<
  typeof cpcvPboValidationReportSchema
>;

export interface CalculateCpcvPboValidationReportOptions {
  generatedAt?: Date | string;
  config: CpcvPboValidationConfig;
  splitPlan: CpcvSplitPlan;
  performanceMatrix: readonly CpcvCandidatePerformanceRow[];
}

interface RankedTestCandidate {
  candidateKey: string;
  testMetric: number;
}

export function calculateCpcvPboValidationReport(
  options: CalculateCpcvPboValidationReportOptions
): CpcvPboValidationReport {
  const generatedAt = normalizeGeneratedAt(options.generatedAt);
  const config = cpcvPboValidationConfigSchema.parse(options.config);
  const splitPlan = cpcvSplitPlanSchema.parse(options.splitPlan);
  const performanceMatrix = z
    .array(cpcvCandidatePerformanceRowSchema)
    .parse(options.performanceMatrix);

  assertConfigMatchesSplitPlan(config, splitPlan);
  assertCandidateKeysUnique(performanceMatrix);

  const selectionLog = splitPlan.combinations.map((combination) =>
    selectCombinationCandidate(combination.combinationId, performanceMatrix)
  );
  const pbo = calculatePboEstimate(performanceMatrix, selectionLog);
  const warnings = cpcvPboWarnings({
    splitPlan,
    performanceMatrix,
    selectionLog,
    pbo
  });
  const status = reportStatusFor(splitPlan, pbo);

  return cpcvPboValidationReportSchema.parse({
    schemaVersion: CPCV_PBO_VALIDATION_SCHEMA_VERSION,
    status,
    generatedAt,
    config,
    splitPlan: summarizeSplitPlan(splitPlan),
    performanceMatrix,
    selectionLog,
    pbo,
    warnings
  });
}

function normalizeGeneratedAt(generatedAt: Date | string | undefined): string {
  if (generatedAt === undefined) {
    return new Date().toISOString();
  }
  return generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt;
}

function assertConfigMatchesSplitPlan(
  config: CpcvPboValidationConfig,
  splitPlan: CpcvSplitPlan
): void {
  const mismatches: string[] = [];
  if (config.validationProtocol !== splitPlan.validationProtocol) {
    mismatches.push("validationProtocol");
  }
  if (config.foldCount !== splitPlan.foldCount) {
    mismatches.push("foldCount");
  }
  if (config.testFoldCount !== splitPlan.testFoldCount) {
    mismatches.push("testFoldCount");
  }
  if (config.purgeDurationDays !== splitPlan.purgeDurationDays) {
    mismatches.push("purgeDurationDays");
  }
  if (config.embargoDurationDays !== splitPlan.embargoDurationDays) {
    mismatches.push("embargoDurationDays");
  }
  if (config.maxCombinationCount !== splitPlan.maxCombinationCount) {
    mismatches.push("maxCombinationCount");
  }
  if (config.combinationMode !== splitPlan.combinationMode) {
    mismatches.push("combinationMode");
  }
  if (config.randomSeed !== splitPlan.randomSeed) {
    mismatches.push("randomSeed");
  }

  if (mismatches.length > 0) {
    throw new Error(
      `CPCV/PBO config does not match splitPlan: ${mismatches.join(", ")}`
    );
  }
}

function assertCandidateKeysUnique(
  performanceMatrix: readonly CpcvCandidatePerformanceRow[]
): void {
  const candidateKeys = performanceMatrix.map((row) => row.candidateKey);
  if (new Set(candidateKeys).size !== candidateKeys.length) {
    throw new Error("performanceMatrix candidateKey values must be unique");
  }
}

function summarizeSplitPlan(splitPlan: CpcvSplitPlan): CpcvSplitPlanSummary {
  return {
    foldCount: splitPlan.foldCount,
    testFoldCount: splitPlan.testFoldCount,
    requestedCombinationCount: splitPlan.requestedCombinationCount,
    emittedCombinationCount: splitPlan.emittedCombinationCount,
    skippedCombinationCount: splitPlan.skippedCombinationCount,
    combinations: splitPlan.combinations
  };
}

function selectCombinationCandidate(
  combinationId: string,
  performanceMatrix: readonly CpcvCandidatePerformanceRow[]
): CpcvSelectionLogEntry {
  const trainCandidates = performanceMatrix
    .map((row) => ({
      row,
      metric: splitMetricFor(row, combinationId)
    }))
    .filter(
      (entry): entry is {
        row: CpcvCandidatePerformanceRow;
        metric: CpcvCandidateSplitMetric;
      } => hasTrainMetric(entry.metric)
    )
    .sort(compareTrainCandidates);

  if (trainCandidates.length < 2) {
    return {
      combinationId,
      selectedCandidateKey: null,
      selectedTrainMetric: null,
      selectedTestMetric: null,
      testRankPercentile: null,
      tieBreakApplied: false
    };
  }

  const selected = trainCandidates[0]!;
  const tieBreakApplied =
    trainCandidates.length > 1 &&
    selected.metric.trainMetric === trainCandidates[1]!.metric.trainMetric;
  const testCandidates = rankedTestCandidates(performanceMatrix, combinationId);
  const selectedTestIndex = testCandidates.findIndex(
    (candidate) => candidate.candidateKey === selected.row.candidateKey
  );
  const testRankPercentile = testRankPercentileForCandidate(
    testCandidates,
    selected.row.candidateKey
  );
  const selectedTestMetric =
    selectedTestIndex === -1
      ? null
      : testCandidates[selectedTestIndex]!.testMetric;

  return {
    combinationId,
    selectedCandidateKey: selected.row.candidateKey,
    selectedTrainMetric: selected.metric.trainMetric,
    selectedTestMetric,
    testRankPercentile,
    tieBreakApplied
  };
}

function splitMetricFor(
  row: CpcvCandidatePerformanceRow,
  combinationId: string
): CpcvCandidateSplitMetric | null {
  return (
    row.splitMetrics.find((metric) => metric.combinationId === combinationId) ??
    null
  );
}

function hasTrainMetric(
  metric: CpcvCandidateSplitMetric | null
): metric is CpcvCandidateSplitMetric {
  return (
    metric !== null &&
    metric.trainMetric !== null &&
    metric.trainReturnSampleCount > 0
  );
}

function hasTestMetric(
  metric: CpcvCandidateSplitMetric | null
): metric is CpcvCandidateSplitMetric {
  return (
    metric !== null &&
    metric.testMetric !== null &&
    metric.testReturnSampleCount > 0
  );
}

function compareTrainCandidates(
  left: {
    row: CpcvCandidatePerformanceRow;
    metric: CpcvCandidateSplitMetric;
  },
  right: {
    row: CpcvCandidatePerformanceRow;
    metric: CpcvCandidateSplitMetric;
  }
): number {
  const metricDelta = right.metric.trainMetric! - left.metric.trainMetric!;
  return metricDelta !== 0
    ? metricDelta
    : left.row.candidateKey.localeCompare(right.row.candidateKey);
}

function rankedTestCandidates(
  performanceMatrix: readonly CpcvCandidatePerformanceRow[],
  combinationId: string
): RankedTestCandidate[] {
  return performanceMatrix
    .map((row) => ({
      candidateKey: row.candidateKey,
      metric: splitMetricFor(row, combinationId)
    }))
    .filter(
      (entry): entry is {
        candidateKey: string;
        metric: CpcvCandidateSplitMetric;
      } => hasTestMetric(entry.metric)
    )
    .map((entry) => ({
      candidateKey: entry.candidateKey,
      testMetric: entry.metric.testMetric!
    }))
    .sort((left, right) => {
      const metricDelta = right.testMetric - left.testMetric;
      return metricDelta !== 0
        ? metricDelta
        : left.candidateKey.localeCompare(right.candidateKey);
    });
}

function testRankPercentileForCandidate(
  candidates: readonly RankedTestCandidate[],
  candidateKey: string
): number | null {
  const selectedCandidate = candidates.find(
    (candidate) => candidate.candidateKey === candidateKey
  );
  if (selectedCandidate === undefined || candidates.length < 2) {
    return null;
  }

  const tieStartIndex = candidates.findIndex(
    (candidate) => candidate.testMetric === selectedCandidate.testMetric
  );
  let tieEndIndex = tieStartIndex;
  while (
    tieEndIndex + 1 < candidates.length &&
    candidates[tieEndIndex + 1]!.testMetric === selectedCandidate.testMetric
  ) {
    tieEndIndex += 1;
  }

  const midRankIndex = (tieStartIndex + tieEndIndex) / 2;
  return roundRatio(
    (candidates.length - midRankIndex - 0.5) / candidates.length
  );
}

function calculatePboEstimate(
  performanceMatrix: readonly CpcvCandidatePerformanceRow[],
  selectionLog: readonly CpcvSelectionLogEntry[]
): CpcvPboEstimate {
  const scoredSelections = selectionLog.filter(
    (entry) => entry.testRankPercentile !== null
  );
  const trainSampledCandidateCount = countTrainSampledCandidates(
    performanceMatrix
  );
  if (
    trainSampledCandidateCount < 2 ||
    scoredSelections.length === 0 ||
    scoredSelections.length < selectionLog.length
  ) {
    return {
      status: "insufficient_matrix",
      probability: null,
      evaluatedCombinationCount: scoredSelections.length,
      selectedBelowMedianCount: 0,
      lambdaLogitValues: [],
      methodNotes: methodNotes()
    };
  }

  const selectedBelowMedianCount = scoredSelections.filter(
    (entry) => entry.testRankPercentile! <= 0.5
  ).length;
  return {
    status: "computed",
    probability: roundRatio(
      selectedBelowMedianCount / scoredSelections.length
    ),
    evaluatedCombinationCount: scoredSelections.length,
    selectedBelowMedianCount,
    lambdaLogitValues: scoredSelections.map((entry) =>
      logit(entry.testRankPercentile!)
    ),
    methodNotes: methodNotes()
  };
}

function methodNotes(): string[] {
  return [
    "selection_metric=total_return_ratio",
    "selection_tie_breaker=candidate_key_asc",
    "test_rank_percentile=midrank_descending",
    "probability=selected_test_rank_percentile_lte_0.5_ratio"
  ];
}

function cpcvPboWarnings(input: {
  splitPlan: CpcvSplitPlan;
  performanceMatrix: readonly CpcvCandidatePerformanceRow[];
  selectionLog: readonly CpcvSelectionLogEntry[];
  pbo: CpcvPboEstimate;
}): CpcvPboWarning[] {
  const warnings: CpcvPboWarning[] = [];
  if (input.splitPlan.combinationMode === "sampled") {
    warnings.push({
      code: "CPCV_SAMPLED_MODE_USED",
      severity: "info",
      message: "CPCV/PBO validation used sampled split combinations"
    });
  }
  if (
    input.splitPlan.combinations.some(
      (combination) => combination.trainSampleIds.length === 0
    )
  ) {
    warnings.push({
      code: "CPCV_PURGE_OR_EMBARGO_REMOVED_ALL_TRAIN",
      severity: "warning",
      message:
        "At least one CPCV combination has no train samples after purge or embargo"
    });
  }
  if (countTrainSampledCandidates(input.performanceMatrix) < 2) {
    warnings.push({
      code: "PBO_CANDIDATE_COUNT_INSUFFICIENT",
      severity: "warning",
      message: "PBO requires at least two candidate rows"
    });
  }
  if (input.pbo.evaluatedCombinationCount < input.selectionLog.length) {
    warnings.push({
      code: "PBO_HOLDOUT_MATRIX_INSUFFICIENT",
      severity: "warning",
      message:
        "PBO requires at least one combination with selected train and comparable test metrics"
    });
  }
  if (input.selectionLog.some((entry) => entry.tieBreakApplied)) {
    warnings.push({
      code: "PBO_SELECTION_TIE_BREAK_APPLIED",
      severity: "info",
      message:
        "At least one CPCV combination used candidate_key_asc tie breaker"
    });
  }
  return warnings;
}

function countTrainSampledCandidates(
  performanceMatrix: readonly CpcvCandidatePerformanceRow[]
): number {
  return performanceMatrix.filter((row) =>
    row.splitMetrics.some(hasTrainMetric)
  ).length;
}

function reportStatusFor(
  splitPlan: CpcvSplitPlan,
  pbo: CpcvPboEstimate
): CpcvPboReportStatus {
  if (pbo.status !== "computed") {
    return "unavailable";
  }
  return splitPlan.combinationMode === "sampled" ? "sampled" : "available";
}

function logit(value: number): number {
  return roundRatio(Math.log(value / (1 - value)));
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateUniqueIds(
  context: z.RefinementCtx,
  ids: readonly string[],
  message: string
): void {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      message
    });
  }
}
