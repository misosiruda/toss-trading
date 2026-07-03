export const SHARPE_VALIDATION_SCHEMA_VERSION = "sharpe_validation.v1";
export const DEFAULT_SHARPE_VALIDATION_MIN_SAMPLE_COUNT = 30;
const SHARPE_CONFIDENCE_INTERVAL_95_Z_SCORE = 1.96;
const EULER_MASCHERONI_CONSTANT = 0.5772156649015329;

export type SharpeValidationStatus = "available" | "unavailable";

export type SharpeValidationMetricStatus =
  | "computed"
  | "not_applicable"
  | "insufficient_sample"
  | "missing_selection_context"
  | "not_implemented";

export type SharpeValidationWarningSeverity = "info" | "warning";

export type SharpeValidationWarningCode =
  | "INSUFFICIENT_RETURN_SAMPLES"
  | "ZERO_RETURN_VOLATILITY"
  | "SERIAL_CORRELATION_NOT_ADJUSTED"
  | "NON_IID_RETURN_SAMPLE"
  | "SKEW_OR_KURTOSIS_UNAVAILABLE"
  | "SELECTION_CONTEXT_MISSING"
  | "MULTIPLE_TESTING_CONTEXT_MISSING"
  | "SHARPE_VALIDATION_NOT_IMPLEMENTED";

export type SharpeValidationMetricName =
  | "sample_sharpe"
  | "lo_adjusted_sharpe"
  | "probabilistic_sharpe_ratio"
  | "deflated_sharpe_ratio";

export type SharpeValidationEstimateMetricName = Exclude<
  SharpeValidationMetricName,
  "probabilistic_sharpe_ratio"
>;

export interface SharpeValidationReport {
  schemaVersion: typeof SHARPE_VALIDATION_SCHEMA_VERSION;
  status: SharpeValidationStatus;
  sample: SharpeValidationSampleSummary;
  distribution: SharpeValidationDistributionSummary;
  metrics: SharpeValidationMetrics;
  selectionContext: SharpeValidationSelectionContext;
  warnings: SharpeValidationWarning[];
}

export interface SharpeValidationSampleSummary {
  returnSampleCount: number;
  minimumSampleCount: number;
  returnFrequency: "per_sample" | "daily" | "weekly" | "monthly" | "unknown";
  annualizationStatus: "not_annualized" | "annualized" | "unavailable";
  annualizationFactor: number | null;
  riskFreeRateRatio: number | null;
}

export interface SharpeValidationDistributionSummary {
  meanReturnRatio: number | null;
  volatilityRatio: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  autocorrelation: SharpeAutocorrelationSummary;
}

export interface SharpeAutocorrelationSummary {
  maxLag: number;
  lagCount: number;
  coefficients: SharpeAutocorrelationCoefficient[];
  adjustmentStatus:
    | "not_required"
    | "candidate_not_computed"
    | "computed"
    | "unavailable";
}

export interface SharpeAutocorrelationCoefficient {
  lag: number;
  coefficient: number | null;
}

export interface SharpeValidationMetrics {
  sampleSharpe: SharpeValidationEstimate;
  loAdjustedSharpe: SharpeValidationEstimate;
  probabilisticSharpeRatio: SharpeValidationProbability;
  deflatedSharpeRatio: SharpeValidationEstimate;
}

export interface SharpeValidationEstimate {
  metric: SharpeValidationEstimateMetricName;
  status: SharpeValidationMetricStatus;
  value: number | null;
  standardError: number | null;
  confidenceInterval95: SharpeConfidenceInterval | null;
  benchmarkSharpeRatio: number | null;
  methodNotes: string[];
}

export interface SharpeValidationProbability {
  metric: "probabilistic_sharpe_ratio";
  status: SharpeValidationMetricStatus;
  probability: number | null;
  benchmarkSharpeRatio: number | null;
  methodNotes: string[];
}

export interface SharpeConfidenceInterval {
  lower: number;
  upper: number;
}

export interface SharpeValidationSelectionContext {
  candidateCount: number | null;
  trialCount: number | null;
  trialSharpeRatioStandardDeviation: number | null;
  selectedByMetric: string | null;
  multipleTestingAdjustment: "none" | "candidate_count" | "trial_log" | "unknown";
}

export interface SharpeValidationWarning {
  code: SharpeValidationWarningCode;
  severity: SharpeValidationWarningSeverity;
  message: string;
}

export interface CalculateSharpeValidationReportInput {
  returns: number[];
  minimumSampleCount?: number;
  returnFrequency?: SharpeValidationSampleSummary["returnFrequency"];
  annualizationFactor?: number | null;
  riskFreeRateRatio?: number | null;
  benchmarkSharpeRatio?: number | null;
  autocorrelationMaxLag?: number;
  selectionContext?: Partial<SharpeValidationSelectionContext>;
}

export function calculateSharpeValidationReport(
  input: CalculateSharpeValidationReportInput
): SharpeValidationReport {
  const returns = finiteValues(input.returns);
  const minimumSampleCount = normalizeMinimumSampleCount(
    input.minimumSampleCount
  );
  const returnFrequency = input.returnFrequency ?? "per_sample";
  const requestedAnnualizationFactor = normalizeOptionalPositiveNumber(
    input.annualizationFactor,
    "annualizationFactor"
  );
  const annualizationFactor = isAnnualizableReturnFrequency(returnFrequency)
    ? requestedAnnualizationFactor
    : null;
  const riskFreeRateRatio = normalizeOptionalFiniteNumber(
    input.riskFreeRateRatio,
    "riskFreeRateRatio"
  );
  const benchmarkSharpeRatio = normalizeOptionalFiniteNumber(
    input.benchmarkSharpeRatio,
    "benchmarkSharpeRatio"
  );
  const autocorrelationMaxLag = normalizeNonNegativeInteger(
    input.autocorrelationMaxLag ?? 0,
    "autocorrelationMaxLag"
  );
  const excessReturns = returns.map(
    (value) => value - (riskFreeRateRatio ?? 0)
  );
  const meanReturnRatioRaw =
    excessReturns.length === 0 ? null : average(excessReturns);
  const volatilityRatioRaw =
    excessReturns.length < 2
      ? null
      : sampleStandardDeviation(excessReturns);
  const meanReturnRatio =
    meanReturnRatioRaw === null ? null : roundRatio(meanReturnRatioRaw);
  const volatilityRatio =
    volatilityRatioRaw === null ? null : roundVolatilityRatio(volatilityRatioRaw);
  const autocorrelation = summarizeAutocorrelation(
    excessReturns,
    autocorrelationMaxLag
  );
  const skewness = calculateSkewness(excessReturns);
  const excessKurtosis = calculateExcessKurtosis(excessReturns);
  const sampleSharpe = calculateSampleSharpe({
    sampleCount: excessReturns.length,
    minimumSampleCount,
    meanReturnRatio: meanReturnRatioRaw,
    volatilityRatio: volatilityRatioRaw,
    skewness,
    excessKurtosis,
    annualizationFactor,
    benchmarkSharpeRatio,
    riskFreeRateRatio
  });
  const loAdjustedSharpe = calculateLoAdjustedSharpe({
    sampleSharpe,
    sampleCount: excessReturns.length,
    minimumSampleCount,
    annualizationFactor,
    benchmarkSharpeRatio,
    riskFreeRateRatio,
    autocorrelation
  });
  const probabilisticSharpeRatio = calculateProbabilisticSharpeRatio({
    sampleSharpe,
    sampleCount: excessReturns.length,
    minimumSampleCount,
    meanReturnRatio: meanReturnRatioRaw,
    volatilityRatio: volatilityRatioRaw,
    skewness,
    excessKurtosis,
    benchmarkSharpeRatio,
    riskFreeRateRatio,
    annualizationFactor
  });
  const selectionContext = normalizeSelectionContext(input.selectionContext);
  const deflatedSharpeRatio = calculateDeflatedSharpeRatio({
    sampleSharpe,
    sampleCount: excessReturns.length,
    minimumSampleCount,
    meanReturnRatio: meanReturnRatioRaw,
    volatilityRatio: volatilityRatioRaw,
    skewness,
    excessKurtosis,
    annualizationFactor,
    benchmarkSharpeRatio,
    selectionContext
  });
  const adjustedAutocorrelation = autocorrelationWithAdjustmentStatus(
    autocorrelation,
    loAdjustedSharpe.status === "computed"
  );
  const warnings = sharpeValidationWarnings({
    sampleCount: excessReturns.length,
    minimumSampleCount,
    volatilityRatio: volatilityRatioRaw,
    autocorrelation: adjustedAutocorrelation,
    loAdjustedSharpeStatus: loAdjustedSharpe.status,
    skewness,
    excessKurtosis,
    selectionContext
  });

  return {
    schemaVersion: SHARPE_VALIDATION_SCHEMA_VERSION,
    status: sampleSharpe.status === "computed" ? "available" : "unavailable",
    sample: {
      returnSampleCount: excessReturns.length,
      minimumSampleCount,
      returnFrequency,
      annualizationStatus:
        annualizationFactor === null ? "not_annualized" : "annualized",
      annualizationFactor,
      riskFreeRateRatio
    },
    distribution: {
      meanReturnRatio,
      volatilityRatio,
      skewness,
      excessKurtosis,
      autocorrelation: adjustedAutocorrelation
    },
    metrics: {
      sampleSharpe,
      loAdjustedSharpe,
      probabilisticSharpeRatio,
      deflatedSharpeRatio
    },
    selectionContext,
    warnings
  };
}

export function createUnavailableSharpeValidationReport(input: {
  returnSampleCount: number;
  minimumSampleCount: number;
  reasonCode: SharpeValidationWarningCode;
  reason: string;
}): SharpeValidationReport {
  return {
    schemaVersion: SHARPE_VALIDATION_SCHEMA_VERSION,
    status: "unavailable",
    sample: {
      returnSampleCount: input.returnSampleCount,
      minimumSampleCount: input.minimumSampleCount,
      returnFrequency: "unknown",
      annualizationStatus: "unavailable",
      annualizationFactor: null,
      riskFreeRateRatio: null
    },
    distribution: {
      meanReturnRatio: null,
      volatilityRatio: null,
      skewness: null,
      excessKurtosis: null,
      autocorrelation: {
        maxLag: 0,
        lagCount: 0,
        coefficients: [],
        adjustmentStatus: "unavailable"
      }
    },
    metrics: {
      sampleSharpe: unavailableEstimate(
        "sample_sharpe",
        input.reason,
        unavailableMetricStatusForReason(input.reasonCode)
      ),
      loAdjustedSharpe: unavailableEstimate(
        "lo_adjusted_sharpe",
        input.reason,
        unavailableMetricStatusForReason(input.reasonCode)
      ),
      probabilisticSharpeRatio: {
        metric: "probabilistic_sharpe_ratio",
        status: unavailableMetricStatusForReason(input.reasonCode),
        probability: null,
        benchmarkSharpeRatio: null,
        methodNotes: [input.reason]
      },
      deflatedSharpeRatio: unavailableEstimate(
        "deflated_sharpe_ratio",
        input.reason,
        unavailableMetricStatusForReason(input.reasonCode)
      )
    },
    selectionContext: {
      candidateCount: null,
      trialCount: null,
      trialSharpeRatioStandardDeviation: null,
      selectedByMetric: null,
      multipleTestingAdjustment: "unknown"
    },
    warnings: [
      {
        code: input.reasonCode,
        severity: "warning",
        message: input.reason
      }
    ]
  };
}

function calculateSampleSharpe(input: {
  sampleCount: number;
  minimumSampleCount: number;
  meanReturnRatio: number | null;
  volatilityRatio: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  annualizationFactor: number | null;
  benchmarkSharpeRatio: number | null;
  riskFreeRateRatio: number | null;
}): SharpeValidationEstimate {
  const methodNotes = [
    input.riskFreeRateRatio === null
      ? "sample_sharpe uses raw return samples because riskFreeRateRatio is not provided"
      : "sample_sharpe uses excess return samples after subtracting riskFreeRateRatio",
    input.annualizationFactor === null
      ? "sample_sharpe is not annualized"
      : "sample_sharpe is annualized with sqrt(annualizationFactor)"
  ];
  if (input.sampleCount < input.minimumSampleCount) {
    return estimateShell({
      metric: "sample_sharpe",
      status: "insufficient_sample",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  if (
    input.meanReturnRatio === null ||
    input.volatilityRatio === null ||
    input.volatilityRatio === 0
  ) {
    return estimateShell({
      metric: "sample_sharpe",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  const rawSharpe = input.meanReturnRatio / input.volatilityRatio;
  const sharpe =
    input.annualizationFactor === null
      ? rawSharpe
      : rawSharpe * Math.sqrt(input.annualizationFactor);
  const sampleFrequencyStandardError = calculateSharpeStandardError({
    sampleCount: input.sampleCount,
    sampleFrequencySharpe: rawSharpe,
    skewness: input.skewness,
    excessKurtosis: input.excessKurtosis
  });
  const standardError =
    sampleFrequencyStandardError === null
      ? null
      : roundRatio(
          scaleSharpeByAnnualization(
            sampleFrequencyStandardError,
            input.annualizationFactor
          )
        );
  return estimateShell({
    metric: "sample_sharpe",
    status: "computed",
    value: roundRatio(sharpe),
    standardError,
    confidenceInterval95:
      standardError === null
        ? null
        : confidenceInterval95ForEstimate(sharpe, standardError),
    benchmarkSharpeRatio: input.benchmarkSharpeRatio,
    methodNotes
  });
}

function calculateLoAdjustedSharpe(input: {
  sampleSharpe: SharpeValidationEstimate;
  sampleCount: number;
  minimumSampleCount: number;
  annualizationFactor: number | null;
  benchmarkSharpeRatio: number | null;
  riskFreeRateRatio: number | null;
  autocorrelation: SharpeAutocorrelationSummary;
}): SharpeValidationEstimate {
  const methodNotes = [
    input.riskFreeRateRatio === null
      ? "lo_adjusted_sharpe uses raw return samples because riskFreeRateRatio is not provided"
      : "lo_adjusted_sharpe uses excess return samples after subtracting riskFreeRateRatio",
    input.annualizationFactor === null
      ? "lo_adjusted_sharpe keeps the sample Sharpe periodicity because annualizationFactor is not provided"
      : "lo_adjusted_sharpe adjusts the annualized sample Sharpe with Lo-style autocorrelation variance inflation",
    "lo_adjusted_sharpe uses available autocorrelation lags as a bounded deterministic correction"
  ];
  if (input.sampleCount < input.minimumSampleCount) {
    return estimateShell({
      metric: "lo_adjusted_sharpe",
      status: "insufficient_sample",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  if (input.sampleSharpe.status !== "computed" || input.sampleSharpe.value === null) {
    return estimateShell({
      metric: "lo_adjusted_sharpe",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  if (input.autocorrelation.coefficients.length === 0) {
    return estimateShell({
      metric: "lo_adjusted_sharpe",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  const varianceInflation = loVarianceInflationFactor({
    coefficients: input.autocorrelation.coefficients,
    annualizationFactor: input.annualizationFactor
  });
  if (varianceInflation === null || varianceInflation <= 0) {
    return estimateShell({
      metric: "lo_adjusted_sharpe",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  return estimateShell({
    metric: "lo_adjusted_sharpe",
    status: "computed",
    value: roundRatio(input.sampleSharpe.value / Math.sqrt(varianceInflation)),
    benchmarkSharpeRatio: input.benchmarkSharpeRatio,
    methodNotes
  });
}

function calculateProbabilisticSharpeRatio(input: {
  sampleSharpe: SharpeValidationEstimate;
  sampleCount: number;
  minimumSampleCount: number;
  meanReturnRatio: number | null;
  volatilityRatio: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  benchmarkSharpeRatio: number | null;
  riskFreeRateRatio: number | null;
  annualizationFactor: number | null;
}): SharpeValidationProbability {
  const methodNotes = [
    input.riskFreeRateRatio === null
      ? "probabilistic_sharpe_ratio uses raw return samples because riskFreeRateRatio is not provided"
      : "probabilistic_sharpe_ratio uses excess return samples after subtracting riskFreeRateRatio",
    input.annualizationFactor === null
      ? "probabilistic_sharpe_ratio keeps the sample Sharpe periodicity"
      : "probabilistic_sharpe_ratio converts annualized Sharpe inputs back to sample frequency before the z-score",
    "probabilistic_sharpe_ratio uses a normal CDF approximation with sample skewness and total kurtosis derived from excess kurtosis"
  ];
  if (input.sampleCount < input.minimumSampleCount) {
    return probabilityShell({
      status: "insufficient_sample",
      probability: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  if (
    input.sampleSharpe.status !== "computed" ||
    input.sampleSharpe.value === null
  ) {
    return probabilityShell({
      status: "not_applicable",
      probability: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  if (input.benchmarkSharpeRatio === null) {
    return probabilityShell({
      status: "not_applicable",
      probability: null,
      benchmarkSharpeRatio: null,
      methodNotes: [
        ...methodNotes,
        "probabilistic_sharpe_ratio requires an explicit benchmarkSharpeRatio"
      ]
    });
  }
  if (input.skewness === null || input.excessKurtosis === null) {
    return probabilityShell({
      status: "not_applicable",
      probability: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes: [
        ...methodNotes,
        "probabilistic_sharpe_ratio requires skewness and excess kurtosis"
      ]
    });
  }
  if (
    input.meanReturnRatio === null ||
    input.volatilityRatio === null ||
    input.volatilityRatio === 0
  ) {
    return probabilityShell({
      status: "not_applicable",
      probability: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  const sampleFrequencySharpe =
    input.meanReturnRatio / input.volatilityRatio;
  const sampleFrequencyBenchmarkSharpe =
    input.annualizationFactor === null
      ? input.benchmarkSharpeRatio
      : input.benchmarkSharpeRatio / Math.sqrt(input.annualizationFactor);
  const denominatorTerm = sharpeAsymptoticDenominatorTerm({
    sampleFrequencySharpe,
    skewness: input.skewness,
    excessKurtosis: input.excessKurtosis
  });
  if (!Number.isFinite(denominatorTerm) || denominatorTerm <= 0) {
    return probabilityShell({
      status: "not_applicable",
      probability: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes: [
        ...methodNotes,
        "probabilistic_sharpe_ratio denominator is not positive"
      ]
    });
  }
  const zScore =
    ((sampleFrequencySharpe - sampleFrequencyBenchmarkSharpe) *
      Math.sqrt(input.sampleCount - 1)) /
    Math.sqrt(denominatorTerm);
  const probability = normalCdf(zScore);
  if (!Number.isFinite(probability)) {
    return probabilityShell({
      status: "not_applicable",
      probability: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  return probabilityShell({
    status: "computed",
    probability: roundRatio(probability),
    benchmarkSharpeRatio: input.benchmarkSharpeRatio,
    methodNotes
  });
}

function calculateDeflatedSharpeRatio(input: {
  sampleSharpe: SharpeValidationEstimate;
  sampleCount: number;
  minimumSampleCount: number;
  meanReturnRatio: number | null;
  volatilityRatio: number | null;
  skewness: number | null;
  excessKurtosis: number | null;
  annualizationFactor: number | null;
  benchmarkSharpeRatio: number | null;
  selectionContext: SharpeValidationSelectionContext;
}): SharpeValidationEstimate {
  const methodNotes = [
    "deflated_sharpe_ratio applies the Bailey-Lopez de Prado expected max Sharpe threshold before the PSR-style z-score",
    input.annualizationFactor === null
      ? "deflated_sharpe_ratio keeps Sharpe inputs in sample frequency"
      : "deflated_sharpe_ratio converts Sharpe inputs back to sample frequency before the z-score",
    "deflated_sharpe_ratio value is a probability; benchmarkSharpeRatio stores the deflated threshold in the reported Sharpe scale"
  ];
  if (input.sampleCount < input.minimumSampleCount) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "insufficient_sample",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  if (
    input.sampleSharpe.status !== "computed" ||
    input.sampleSharpe.value === null
  ) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  const independentTrialCount = resolveIndependentTrialCount(
    input.selectionContext
  );
  if (
    independentTrialCount === null ||
    input.selectionContext.trialSharpeRatioStandardDeviation === null
  ) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "missing_selection_context",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes: [
        ...methodNotes,
        "deflated_sharpe_ratio requires an independent trial count greater than one and trialSharpeRatioStandardDeviation"
      ]
    });
  }
  if (input.skewness === null || input.excessKurtosis === null) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes: [
        ...methodNotes,
        "deflated_sharpe_ratio requires skewness and excess kurtosis"
      ]
    });
  }
  if (
    input.meanReturnRatio === null ||
    input.volatilityRatio === null ||
    input.volatilityRatio === 0
  ) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }

  const sampleFrequencySharpe =
    input.meanReturnRatio / input.volatilityRatio;
  const sampleFrequencyBenchmarkSharpe =
    input.benchmarkSharpeRatio === null
      ? 0
      : unscaleSharpeByAnnualization(
          input.benchmarkSharpeRatio,
          input.annualizationFactor
        );
  const sampleFrequencyTrialSharpeStandardDeviation =
    unscaleSharpeByAnnualization(
      input.selectionContext.trialSharpeRatioStandardDeviation,
      input.annualizationFactor
    );
  const sampleFrequencyDeflatedBenchmarkSharpe =
    expectedMaximumSharpeThreshold({
      benchmarkSharpeRatio: sampleFrequencyBenchmarkSharpe,
      trialSharpeRatioStandardDeviation:
        sampleFrequencyTrialSharpeStandardDeviation,
      independentTrialCount
    });
  if (!Number.isFinite(sampleFrequencyDeflatedBenchmarkSharpe)) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: input.benchmarkSharpeRatio,
      methodNotes
    });
  }
  const deflatedBenchmarkSharpe = roundRatio(
    scaleSharpeByAnnualization(
      sampleFrequencyDeflatedBenchmarkSharpe,
      input.annualizationFactor
    )
  );

  const denominatorTerm = sharpeAsymptoticDenominatorTerm({
    sampleFrequencySharpe,
    skewness: input.skewness,
    excessKurtosis: input.excessKurtosis
  });
  if (!Number.isFinite(denominatorTerm) || denominatorTerm <= 0) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: deflatedBenchmarkSharpe,
      methodNotes: [
        ...methodNotes,
        "deflated_sharpe_ratio denominator is not positive"
      ]
    });
  }

  const zScore =
    ((sampleFrequencySharpe - sampleFrequencyDeflatedBenchmarkSharpe) *
      Math.sqrt(input.sampleCount - 1)) /
    Math.sqrt(denominatorTerm);
  const probability = normalCdf(zScore);
  if (!Number.isFinite(probability)) {
    return estimateShell({
      metric: "deflated_sharpe_ratio",
      status: "not_applicable",
      value: null,
      benchmarkSharpeRatio: deflatedBenchmarkSharpe,
      methodNotes
    });
  }
  return estimateShell({
    metric: "deflated_sharpe_ratio",
    status: "computed",
    value: roundRatio(probability),
    benchmarkSharpeRatio: deflatedBenchmarkSharpe,
    methodNotes
  });
}

function probabilityShell(input: {
  status: SharpeValidationMetricStatus;
  probability: number | null;
  benchmarkSharpeRatio: number | null;
  methodNotes: string[];
}): SharpeValidationProbability {
  return {
    metric: "probabilistic_sharpe_ratio",
    status: input.status,
    probability: input.probability,
    benchmarkSharpeRatio: input.benchmarkSharpeRatio,
    methodNotes: input.methodNotes
  };
}

function calculateSharpeStandardError(input: {
  sampleCount: number;
  sampleFrequencySharpe: number;
  skewness: number | null;
  excessKurtosis: number | null;
}): number | null {
  if (input.sampleCount < 2) {
    return null;
  }
  if (input.skewness === null || input.excessKurtosis === null) {
    return null;
  }
  const denominatorTerm = sharpeAsymptoticDenominatorTerm({
    sampleFrequencySharpe: input.sampleFrequencySharpe,
    skewness: input.skewness,
    excessKurtosis: input.excessKurtosis
  });
  if (!Number.isFinite(denominatorTerm) || denominatorTerm <= 0) {
    return null;
  }
  return Math.sqrt(denominatorTerm / (input.sampleCount - 1));
}

function sharpeAsymptoticDenominatorTerm(input: {
  sampleFrequencySharpe: number;
  skewness: number;
  excessKurtosis: number;
}): number {
  return (
    1 -
    input.skewness * input.sampleFrequencySharpe +
    ((input.excessKurtosis + 2) / 4) * input.sampleFrequencySharpe ** 2
  );
}

function confidenceInterval95ForEstimate(
  value: number,
  standardError: number
): SharpeConfidenceInterval {
  return {
    lower: roundRatio(
      value - SHARPE_CONFIDENCE_INTERVAL_95_Z_SCORE * standardError
    ),
    upper: roundRatio(
      value + SHARPE_CONFIDENCE_INTERVAL_95_Z_SCORE * standardError
    )
  };
}

function scaleSharpeByAnnualization(
  value: number,
  annualizationFactor: number | null
): number {
  return annualizationFactor === null ? value : value * Math.sqrt(annualizationFactor);
}

function unscaleSharpeByAnnualization(
  value: number,
  annualizationFactor: number | null
): number {
  return annualizationFactor === null ? value : value / Math.sqrt(annualizationFactor);
}

function estimateShell(input: {
  metric: SharpeValidationEstimateMetricName;
  status: SharpeValidationMetricStatus;
  value: number | null;
  standardError?: number | null;
  confidenceInterval95?: SharpeConfidenceInterval | null;
  benchmarkSharpeRatio: number | null;
  methodNotes: string[];
}): SharpeValidationEstimate {
  return {
    metric: input.metric,
    status: input.status,
    value: input.value,
    standardError: input.standardError ?? null,
    confidenceInterval95: input.confidenceInterval95 ?? null,
    benchmarkSharpeRatio: input.benchmarkSharpeRatio,
    methodNotes: input.methodNotes
  };
}

function unavailableEstimate(
  metric: SharpeValidationEstimateMetricName,
  note: string,
  status: SharpeValidationMetricStatus = "not_implemented"
): SharpeValidationEstimate {
  return {
    metric,
    status,
    value: null,
    standardError: null,
    confidenceInterval95: null,
    benchmarkSharpeRatio: null,
    methodNotes: [note]
  };
}

function unavailableMetricStatusForReason(
  reasonCode: SharpeValidationWarningCode
): SharpeValidationMetricStatus {
  if (reasonCode === "INSUFFICIENT_RETURN_SAMPLES") {
    return "insufficient_sample";
  }
  if (reasonCode === "SELECTION_CONTEXT_MISSING") {
    return "missing_selection_context";
  }
  if (reasonCode === "SHARPE_VALIDATION_NOT_IMPLEMENTED") {
    return "not_implemented";
  }
  return "not_applicable";
}

function sharpeValidationWarnings(input: {
  sampleCount: number;
  minimumSampleCount: number;
  volatilityRatio: number | null;
  autocorrelation: SharpeAutocorrelationSummary;
  loAdjustedSharpeStatus: SharpeValidationMetricStatus;
  skewness: number | null;
  excessKurtosis: number | null;
  selectionContext: Partial<SharpeValidationSelectionContext> | undefined;
}): SharpeValidationWarning[] {
  const warnings: SharpeValidationWarning[] = [];
  if (input.sampleCount < input.minimumSampleCount) {
    warnings.push({
      code: "INSUFFICIENT_RETURN_SAMPLES",
      severity: "warning",
      message: `Sharpe validation unavailable: at least ${input.minimumSampleCount} return samples are required`
    });
  }
  if (input.sampleCount >= input.minimumSampleCount && input.volatilityRatio === 0) {
    warnings.push({
      code: "ZERO_RETURN_VOLATILITY",
      severity: "warning",
      message: "Sharpe validation unavailable: return volatility is zero"
    });
  }
  if (
    input.sampleCount >= input.minimumSampleCount &&
    input.volatilityRatio !== null &&
    input.volatilityRatio > 0 &&
    input.loAdjustedSharpeStatus !== "computed"
  ) {
    warnings.push({
      code: "SERIAL_CORRELATION_NOT_ADJUSTED",
      severity: "warning",
      message:
        "sample_sharpe is computed without Lo-style serial correlation adjustment"
    });
  }
  if (
    input.autocorrelation.coefficients.some(
      (coefficient) =>
        coefficient.coefficient !== null &&
        Math.abs(coefficient.coefficient) >= 0.2
    )
  ) {
    warnings.push({
      code: "NON_IID_RETURN_SAMPLE",
      severity: "warning",
      message:
        "autocorrelation diagnostic suggests the return sample may not be IID"
    });
  }
  if (input.skewness === null || input.excessKurtosis === null) {
    warnings.push({
      code: "SKEW_OR_KURTOSIS_UNAVAILABLE",
      severity: "warning",
      message:
        "skewness or excess kurtosis is unavailable for PSR/DSR candidates"
    });
  }
  if (
    resolveIndependentTrialCount(input.selectionContext) === null ||
    !isValidTrialSharpeRatioStandardDeviation(
      input.selectionContext?.trialSharpeRatioStandardDeviation
    )
  ) {
    warnings.push({
      code: "MULTIPLE_TESTING_CONTEXT_MISSING",
      severity: "warning",
      message:
        "independent trial count and trial Sharpe dispersion are required before Deflated Sharpe Ratio can be evaluated"
    });
  }
  return warnings;
}

function autocorrelationWithAdjustmentStatus(
  autocorrelation: SharpeAutocorrelationSummary,
  adjusted: boolean
): SharpeAutocorrelationSummary {
  if (!adjusted || autocorrelation.coefficients.length === 0) {
    return autocorrelation;
  }
  return {
    ...autocorrelation,
    adjustmentStatus: "computed"
  };
}

function loVarianceInflationFactor(input: {
  coefficients: SharpeAutocorrelationCoefficient[];
  annualizationFactor: number | null;
}): number | null {
  const finiteCoefficients = input.coefficients.filter(
    (
      coefficient
    ): coefficient is SharpeAutocorrelationCoefficient & { coefficient: number } =>
      coefficient.coefficient !== null
  );
  if (finiteCoefficients.length === 0) {
    return null;
  }
  const q = input.annualizationFactor ?? finiteCoefficients.length + 1;
  const weightedAutocorrelationSum = finiteCoefficients.reduce(
    (sum, coefficient) =>
      sum + (1 - Math.min(coefficient.lag, q) / q) * coefficient.coefficient,
    0
  );
  return 1 + 2 * weightedAutocorrelationSum;
}

function summarizeAutocorrelation(
  returns: number[],
  maxLag: number
): SharpeAutocorrelationSummary {
  if (maxLag === 0) {
    return {
      maxLag: 0,
      lagCount: 0,
      coefficients: [],
      adjustmentStatus: "not_required"
    };
  }
  const boundedMaxLag = Math.min(maxLag, Math.max(0, returns.length - 1));
  const coefficients: SharpeAutocorrelationCoefficient[] = [];
  for (let lag = 1; lag <= boundedMaxLag; lag += 1) {
    coefficients.push({
      lag,
      coefficient: autocorrelationAtLag(returns, lag)
    });
  }
  return {
    maxLag,
    lagCount: coefficients.length,
    coefficients,
    adjustmentStatus:
      coefficients.length === 0 ? "unavailable" : "candidate_not_computed"
  };
}

function autocorrelationAtLag(returns: number[], lag: number): number | null {
  if (returns.length <= lag) {
    return null;
  }
  const mean = average(returns);
  const denominator = returns.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0
  );
  if (denominator === 0) {
    return null;
  }
  let numerator = 0;
  for (let index = lag; index < returns.length; index += 1) {
    numerator += (returns[index]! - mean) * (returns[index - lag]! - mean);
  }
  return roundRatio(numerator / denominator);
}

function calculateSkewness(values: number[]): number | null {
  if (values.length < 3) {
    return null;
  }
  const mean = average(values);
  const standardDeviation = sampleStandardDeviation(values);
  if (standardDeviation === 0) {
    return null;
  }
  const moment =
    values.reduce((sum, value) => sum + ((value - mean) / standardDeviation) ** 3, 0) /
    values.length;
  return roundRatio(moment);
}

function calculateExcessKurtosis(values: number[]): number | null {
  if (values.length < 4) {
    return null;
  }
  const mean = average(values);
  const standardDeviation = sampleStandardDeviation(values);
  if (standardDeviation === 0) {
    return null;
  }
  const moment =
    values.reduce((sum, value) => sum + ((value - mean) / standardDeviation) ** 4, 0) /
    values.length;
  return roundRatio(moment - 3);
}

function normalizeSelectionContext(
  value: Partial<SharpeValidationSelectionContext> | undefined
): SharpeValidationSelectionContext {
  return {
    candidateCount: value?.candidateCount ?? null,
    trialCount: value?.trialCount ?? null,
    trialSharpeRatioStandardDeviation: normalizeOptionalPositiveNumber(
      value?.trialSharpeRatioStandardDeviation,
      "selectionContext.trialSharpeRatioStandardDeviation"
    ),
    selectedByMetric: value?.selectedByMetric ?? null,
    multipleTestingAdjustment: value?.multipleTestingAdjustment ?? "unknown"
  };
}

function isAnnualizableReturnFrequency(
  value: SharpeValidationSampleSummary["returnFrequency"]
): boolean {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function isValidSelectionCount(
  value: number | null | undefined
): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidTrialSharpeRatioStandardDeviation(
  value: number | null | undefined
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function resolveIndependentTrialCount(
  selectionContext: Partial<SharpeValidationSelectionContext> | undefined
): number | null {
  const candidateCount = selectionContext?.candidateCount;
  const trialCount = selectionContext?.trialCount;
  switch (selectionContext?.multipleTestingAdjustment ?? "unknown") {
    case "candidate_count":
      return isValidSelectionCount(candidateCount) && candidateCount > 1
        ? candidateCount
        : null;
    case "trial_log":
      return isValidSelectionCount(trialCount) && trialCount > 1
        ? trialCount
        : null;
    case "none":
      return null;
    case "unknown":
      if (isValidSelectionCount(trialCount) && trialCount > 1) {
        return trialCount;
      }
      if (isValidSelectionCount(candidateCount) && candidateCount > 1) {
        return candidateCount;
      }
      return null;
  }
}

function expectedMaximumSharpeThreshold(input: {
  benchmarkSharpeRatio: number;
  trialSharpeRatioStandardDeviation: number;
  independentTrialCount: number;
}): number {
  const expectedMaxMultiplier =
    (1 - EULER_MASCHERONI_CONSTANT) *
      inverseNormalCdf(1 - 1 / input.independentTrialCount) +
    EULER_MASCHERONI_CONSTANT *
      inverseNormalCdf(1 - 1 / (input.independentTrialCount * Math.E));
  return (
    input.benchmarkSharpeRatio +
    input.trialSharpeRatioStandardDeviation * expectedMaxMultiplier
  );
}

function normalizeMinimumSampleCount(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SHARPE_VALIDATION_MIN_SAMPLE_COUNT;
  }
  if (!Number.isInteger(value) || value < 2) {
    throw new Error("minimumSampleCount must be an integer greater than or equal to 2");
  }
  return value;
}

function normalizeOptionalFiniteNumber(
  value: number | null | undefined,
  label: string
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function normalizeOptionalPositiveNumber(
  value: number | null | undefined,
  label: string
): number | null {
  const normalized = normalizeOptionalFiniteNumber(value, label);
  if (normalized !== null && normalized <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function finiteValues(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function sampleStandardDeviation(values: number[]): number {
  if (values.every((value) => value === values[0])) {
    return 0;
  }
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalCdf(value: number): number {
  return Math.min(1, Math.max(0, 0.5 * (1 + erf(value / Math.SQRT2))));
}

function inverseNormalCdf(probability: number): number {
  if (probability <= 0 || probability >= 1 || !Number.isFinite(probability)) {
    throw new Error("probability must be finite and between 0 and 1");
  }

  const coefficientA = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239
  ];
  const coefficientB = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1
  ];
  const coefficientC = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ];
  const coefficientD = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416
  ];
  const lowerBreakPoint = 0.02425;
  const upperBreakPoint = 1 - lowerBreakPoint;

  if (probability < lowerBreakPoint) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      evaluatePolynomial(coefficientC, q) /
      evaluatePolynomial([...coefficientD, 1], q)
    );
  }

  if (probability > upperBreakPoint) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      evaluatePolynomial(coefficientC, q) /
      evaluatePolynomial([...coefficientD, 1], q)
    );
  }

  const q = probability - 0.5;
  const r = q * q;
  return (
    (evaluatePolynomial(coefficientA, r) * q) /
    evaluatePolynomial([...coefficientB, 1], r)
  );
}

function evaluatePolynomial(
  coefficients: readonly number[],
  value: number
): number {
  return coefficients.reduce(
    (result, coefficient) => result * value + coefficient
  );
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return sign * approximation;
}

function roundRatio(value: number): number {
  return Number(value.toFixed(6));
}

function roundVolatilityRatio(value: number): number {
  const rounded = roundRatio(value);
  if (rounded === 0 && value !== 0) {
    return Number(value.toPrecision(6));
  }
  return rounded;
}
