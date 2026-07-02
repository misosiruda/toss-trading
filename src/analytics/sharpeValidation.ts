export const SHARPE_VALIDATION_SCHEMA_VERSION = "sharpe_validation.v1";

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
  selectedByMetric: string | null;
  multipleTestingAdjustment: "none" | "candidate_count" | "trial_log" | "unknown";
}

export interface SharpeValidationWarning {
  code: SharpeValidationWarningCode;
  severity: SharpeValidationWarningSeverity;
  message: string;
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
        "Lo-style serial correlation adjustment is not computed in this contract PR"
      ),
      probabilisticSharpeRatio: {
        metric: "probabilistic_sharpe_ratio",
        status: "not_implemented",
        probability: null,
        benchmarkSharpeRatio: null,
        methodNotes: [
          "Probabilistic Sharpe Ratio calculation is reserved for the metric calculator PR"
        ]
      },
      deflatedSharpeRatio: unavailableEstimate(
        "deflated_sharpe_ratio",
        "Deflated Sharpe Ratio requires candidate selection context and is reserved for a follow-up PR"
      )
    },
    selectionContext: {
      candidateCount: null,
      trialCount: null,
      selectedByMetric: null,
      multipleTestingAdjustment: "unknown"
    },
    warnings: [
      {
        code: input.reasonCode,
        severity: "warning",
        message: input.reason
      },
      {
        code: "SHARPE_VALIDATION_NOT_IMPLEMENTED",
        severity: "info",
        message:
          "RH5 first PR defines the sharpe_validation.v1 schema without wiring a calculator into reports"
      }
    ]
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
