import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSharpeValidationReport,
  createUnavailableSharpeValidationReport,
  DEFAULT_SHARPE_VALIDATION_MIN_SAMPLE_COUNT,
  SHARPE_VALIDATION_SCHEMA_VERSION
} from "./sharpeValidation.js";

test("Sharpe validation calculator computes sample metrics deterministically", () => {
  const returns = [
    -0.018, -0.01, -0.004, 0.002, 0.009, 0.015, -0.012, 0.006, 0.011, -0.007,
    0.014, 0.018, -0.016, 0.004, 0.012, 0.021, -0.009, 0.003, 0.017, 0.024,
    -0.014, 0.005, 0.01, 0.019, -0.006, 0.007, 0.013, 0.022, -0.011, 0.016
  ];

  const report = calculateSharpeValidationReport({
    returns,
    benchmarkSharpeRatio: 0,
    autocorrelationMaxLag: 2,
    selectionContext: {
      candidateCount: 3,
      trialCount: 30,
      trialSharpeRatioStandardDeviation: 0.08,
      selectedByMetric: "total_return_ratio",
      multipleTestingAdjustment: "candidate_count"
    }
  });

  assert.deepEqual(report, calculateSharpeValidationReport({
    returns,
    benchmarkSharpeRatio: 0,
    autocorrelationMaxLag: 2,
    selectionContext: {
      candidateCount: 3,
      trialCount: 30,
      trialSharpeRatioStandardDeviation: 0.08,
      selectedByMetric: "total_return_ratio",
      multipleTestingAdjustment: "candidate_count"
    }
  }));
  assert.equal(report.schemaVersion, SHARPE_VALIDATION_SCHEMA_VERSION);
  assert.equal(report.status, "available");
  assert.equal(
    report.sample.minimumSampleCount,
    DEFAULT_SHARPE_VALIDATION_MIN_SAMPLE_COUNT
  );
  assert.equal(report.sample.annualizationStatus, "not_annualized");
  assert.equal(report.distribution.meanReturnRatio, 0.0047);
  assert.equal(report.distribution.volatilityRatio, 0.012548);
  assert.equal(report.metrics.sampleSharpe.status, "computed");
  assert.equal(report.metrics.sampleSharpe.value, 0.374554);
  assert.equal(report.metrics.sampleSharpe.standardError, 0.197184);
  assert.deepEqual(report.metrics.sampleSharpe.confidenceInterval95, {
    lower: -0.011926,
    upper: 0.761035
  });
  assert.equal(report.metrics.loAdjustedSharpe.status, "computed");
  assert.equal(report.metrics.loAdjustedSharpe.value, 0.461839);
  assert.equal(report.metrics.loAdjustedSharpe.confidenceInterval95, null);
  assert.equal(report.metrics.probabilisticSharpeRatio.status, "computed");
  assert.equal(report.metrics.probabilisticSharpeRatio.probability, 0.971252);
  assert.equal(
    report.metrics.probabilisticSharpeRatio.benchmarkSharpeRatio,
    0
  );
  assert.equal(report.metrics.deflatedSharpeRatio.status, "computed");
  assert.equal(report.metrics.deflatedSharpeRatio.value, 0.939851);
  assert.equal(
    report.metrics.deflatedSharpeRatio.benchmarkSharpeRatio,
    0.068224
  );
  assert.equal(
    report.selectionContext.trialSharpeRatioStandardDeviation,
    0.08
  );
  assert.equal(
    report.distribution.autocorrelation.adjustmentStatus,
    "computed"
  );
  assert.equal(report.distribution.autocorrelation.lagCount, 2);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    [
      "NON_IID_RETURN_SAMPLE"
    ]
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});

test("Sharpe validation calculator computes Lo-style autocorrelation adjustment", () => {
  const returns = [
    0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02,
    0.02, 0.02, 0.02, 0.02, 0.02, 0.005, 0.005, 0.005, 0.005, 0.005,
    0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005
  ];

  const report = calculateSharpeValidationReport({
    returns,
    autocorrelationMaxLag: 5,
    selectionContext: {
      candidateCount: 2,
      trialCount: 30
    }
  });

  assert.equal(report.status, "available");
  assert.equal(report.metrics.sampleSharpe.status, "computed");
  assert.equal(report.metrics.sampleSharpe.value, 1.638653);
  assert.equal(report.metrics.loAdjustedSharpe.status, "computed");
  assert.equal(report.metrics.loAdjustedSharpe.value, 0.745356);
  assert.equal(
    report.distribution.autocorrelation.adjustmentStatus,
    "computed"
  );
  assert.equal(report.distribution.autocorrelation.maxLag, 5);
  assert.equal(report.distribution.autocorrelation.lagCount, 5);
  assert.match(
    report.warnings.map((warning) => warning.code).join("\n"),
    /NON_IID_RETURN_SAMPLE/
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});

test("Sharpe validation calculator keeps Lo adjustment unavailable without autocorrelation", () => {
  const report = calculateSharpeValidationReport({
    returns: Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0 ? 0.01 : 0.02
    ),
    selectionContext: {
      candidateCount: 2,
      trialCount: 10
    }
  });

  assert.equal(report.status, "available");
  assert.equal(report.metrics.sampleSharpe.status, "computed");
  assert.equal(report.metrics.loAdjustedSharpe.status, "not_applicable");
  assert.equal(report.metrics.loAdjustedSharpe.value, null);
  assert.equal(
    report.metrics.probabilisticSharpeRatio.status,
    "not_applicable"
  );
  assert.equal(report.metrics.probabilisticSharpeRatio.probability, null);
  assert.equal(
    report.distribution.autocorrelation.adjustmentStatus,
    "not_required"
  );
  assert.match(
    report.warnings.map((warning) => warning.code).join("\n"),
    /SERIAL_CORRELATION_NOT_ADJUSTED/
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});

test("Sharpe validation calculator keeps full precision before report rounding", () => {
  const returns = Array.from(
    { length: 30 },
    (_, index) => 0.01 + (index % 2 === 0 ? 0.0000001 : -0.0000001)
  );

  const report = calculateSharpeValidationReport({
    returns,
    selectionContext: {
      candidateCount: 2,
      trialCount: 10
    }
  });

  assert.equal(report.status, "available");
  assert.ok(report.distribution.volatilityRatio !== null);
  assert.ok(report.distribution.volatilityRatio > 0);
  assert.ok(report.distribution.volatilityRatio < 0.000001);
  assert.equal(report.metrics.sampleSharpe.status, "computed");
  assert.equal(report.metrics.loAdjustedSharpe.status, "not_applicable");
  assert.equal(
    report.warnings.some((warning) => warning.code === "ZERO_RETURN_VOLATILITY"),
    false
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});

test("Sharpe validation calculator annualizes only with explicit frequency", () => {
  const returns = [
    -0.018, -0.01, -0.004, 0.002, 0.009, 0.015, -0.012, 0.006, 0.011, -0.007,
    0.014, 0.018, -0.016, 0.004, 0.012, 0.021, -0.009, 0.003, 0.017, 0.024,
    -0.014, 0.005, 0.01, 0.019, -0.006, 0.007, 0.013, 0.022, -0.011, 0.016
  ];

  const withoutFrequency = calculateSharpeValidationReport({
    returns,
    annualizationFactor: 252,
    selectionContext: {
      candidateCount: 2,
      trialCount: 10
    }
  });
  const withDailyFrequency = calculateSharpeValidationReport({
    returns,
    returnFrequency: "daily",
    annualizationFactor: 252,
    selectionContext: {
      candidateCount: 2,
      trialCount: 10
    }
  });

  assert.equal(withoutFrequency.sample.returnFrequency, "per_sample");
  assert.equal(withoutFrequency.sample.annualizationStatus, "not_annualized");
  assert.equal(withoutFrequency.sample.annualizationFactor, null);
  assert.equal(withoutFrequency.metrics.sampleSharpe.value, 0.374554);
  assert.equal(withDailyFrequency.sample.returnFrequency, "daily");
  assert.equal(withDailyFrequency.sample.annualizationStatus, "annualized");
  assert.equal(withDailyFrequency.sample.annualizationFactor, 252);
  assert.ok(withDailyFrequency.metrics.sampleSharpe.value !== null);
  assert.equal(withDailyFrequency.metrics.sampleSharpe.standardError, 3.130198);
  assert.deepEqual(withDailyFrequency.metrics.sampleSharpe.confidenceInterval95, {
    lower: -0.189325,
    upper: 12.081051
  });
  assert.ok(
    withDailyFrequency.metrics.sampleSharpe.value >
      withoutFrequency.metrics.sampleSharpe.value!
  );
});

test("Sharpe validation calculator keeps PSR inputs in sample frequency", () => {
  const returns = [
    -0.018, -0.01, -0.004, 0.002, 0.009, 0.015, -0.012, 0.006, 0.011, -0.007,
    0.014, 0.018, -0.016, 0.004, 0.012, 0.021, -0.009, 0.003, 0.017, 0.024,
    -0.014, 0.005, 0.01, 0.019, -0.006, 0.007, 0.013, 0.022, -0.011, 0.016
  ];

  const report = calculateSharpeValidationReport({
    returns,
    returnFrequency: "daily",
    annualizationFactor: 252,
    benchmarkSharpeRatio: 0.5,
    selectionContext: {
      candidateCount: 2,
      trialCount: 10,
      trialSharpeRatioStandardDeviation: 1.2,
      multipleTestingAdjustment: "trial_log"
    }
  });

  assert.equal(report.metrics.sampleSharpe.status, "computed");
  assert.equal(report.metrics.sampleSharpe.value, 5.945863);
  assert.equal(report.metrics.probabilisticSharpeRatio.status, "computed");
  assert.equal(report.metrics.probabilisticSharpeRatio.probability, 0.959051);
  assert.ok(report.metrics.probabilisticSharpeRatio.probability < 0.99);
  assert.match(
    report.metrics.probabilisticSharpeRatio.methodNotes.join("\n"),
    /converts annualized Sharpe inputs back to sample frequency/
  );
  assert.equal(report.metrics.deflatedSharpeRatio.status, "computed");
  assert.equal(report.metrics.deflatedSharpeRatio.value, 0.872051);
  assert.equal(
    report.metrics.deflatedSharpeRatio.benchmarkSharpeRatio,
    2.389518
  );
  assert.match(
    report.metrics.deflatedSharpeRatio.methodNotes.join("\n"),
    /converts Sharpe inputs back to sample frequency/
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});

test("unavailable Sharpe validation report exposes deterministic schema defaults", () => {
  const report = createUnavailableSharpeValidationReport({
    returnSampleCount: 2,
    minimumSampleCount: 30,
    reasonCode: "INSUFFICIENT_RETURN_SAMPLES",
    reason: "Sharpe validation unavailable: at least 30 return samples are required"
  });

  assert.equal(report.schemaVersion, SHARPE_VALIDATION_SCHEMA_VERSION);
  assert.equal(report.status, "unavailable");
  assert.equal(report.sample.returnSampleCount, 2);
  assert.equal(report.sample.minimumSampleCount, 30);
  assert.equal(report.sample.annualizationStatus, "unavailable");
  assert.equal(report.metrics.sampleSharpe.status, "insufficient_sample");
  assert.equal(report.metrics.sampleSharpe.value, null);
  assert.equal(report.metrics.sampleSharpe.confidenceInterval95, null);
  assert.equal(report.metrics.loAdjustedSharpe.status, "insufficient_sample");
  assert.equal(report.metrics.loAdjustedSharpe.value, null);
  assert.equal(
    report.metrics.probabilisticSharpeRatio.status,
    "insufficient_sample"
  );
  assert.equal(report.metrics.probabilisticSharpeRatio.probability, null);
  assert.equal(report.metrics.deflatedSharpeRatio.status, "insufficient_sample");
  assert.equal(report.selectionContext.multipleTestingAdjustment, "unknown");
  assert.equal(report.selectionContext.trialSharpeRatioStandardDeviation, null);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["INSUFFICIENT_RETURN_SAMPLES"]
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});

test("Sharpe validation calculator treats null selection counts as missing context", () => {
  const report = calculateSharpeValidationReport({
    returns: Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0 ? 0.01 : 0.02
    ),
    selectionContext: {
      candidateCount: null,
      trialCount: null
    }
  });

  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "MULTIPLE_TESTING_CONTEXT_MISSING"
    ),
    true
  );
  assert.equal(
    report.metrics.deflatedSharpeRatio.status,
    "missing_selection_context"
  );
});

test("Sharpe validation calculator honors explicit DSR adjustment modes", () => {
  const returns = [
    -0.018, -0.01, -0.004, 0.002, 0.009, 0.015, -0.012, 0.006, 0.011, -0.007,
    0.014, 0.018, -0.016, 0.004, 0.012, 0.021, -0.009, 0.003, 0.017, 0.024,
    -0.014, 0.005, 0.01, 0.019, -0.006, 0.007, 0.013, 0.022, -0.011, 0.016
  ];
  const cases = [
    {
      name: "none",
      selectionContext: {
        candidateCount: 12,
        trialCount: 12,
        trialSharpeRatioStandardDeviation: 0.1,
        multipleTestingAdjustment: "none" as const
      }
    },
    {
      name: "trial_log_without_trial_count",
      selectionContext: {
        candidateCount: 12,
        trialCount: null,
        trialSharpeRatioStandardDeviation: 0.1,
        multipleTestingAdjustment: "trial_log" as const
      }
    },
    {
      name: "candidate_count_without_candidate_count",
      selectionContext: {
        candidateCount: null,
        trialCount: 12,
        trialSharpeRatioStandardDeviation: 0.1,
        multipleTestingAdjustment: "candidate_count" as const
      }
    }
  ];

  for (const testCase of cases) {
    const report = calculateSharpeValidationReport({
      returns,
      selectionContext: testCase.selectionContext
    });

    assert.equal(
      report.metrics.deflatedSharpeRatio.status,
      "missing_selection_context",
      testCase.name
    );
    assert.equal(
      report.warnings.some(
        (warning) => warning.code === "MULTIPLE_TESTING_CONTEXT_MISSING"
      ),
      true,
      testCase.name
    );
  }
});

test("Sharpe validation calculator fails closed for unknown DSR adjustment mode", () => {
  const returns = [
    -0.018, -0.01, -0.004, 0.002, 0.009, 0.015, -0.012, 0.006, 0.011, -0.007,
    0.014, 0.018, -0.016, 0.004, 0.012, 0.021, -0.009, 0.003, 0.017, 0.024,
    -0.014, 0.005, 0.01, 0.019, -0.006, 0.007, 0.013, 0.022, -0.011, 0.016
  ];

  const report = calculateSharpeValidationReport({
    returns,
    selectionContext: {
      candidateCount: 3,
      trialCount: 30,
      trialSharpeRatioStandardDeviation: 0.08
    }
  });

  assert.equal(report.selectionContext.multipleTestingAdjustment, "unknown");
  assert.equal(
    report.metrics.deflatedSharpeRatio.status,
    "missing_selection_context"
  );
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "MULTIPLE_TESTING_CONTEXT_MISSING"
    ),
    true
  );
});

test("Sharpe validation calculator fails closed for zero DSR trial dispersion", () => {
  const returns = [
    -0.018, -0.01, -0.004, 0.002, 0.009, 0.015, -0.012, 0.006, 0.011, -0.007,
    0.014, 0.018, -0.016, 0.004, 0.012, 0.021, -0.009, 0.003, 0.017, 0.024,
    -0.014, 0.005, 0.01, 0.019, -0.006, 0.007, 0.013, 0.022, -0.011, 0.016
  ];

  const report = calculateSharpeValidationReport({
    returns,
    selectionContext: {
      candidateCount: 3,
      trialCount: 30,
      trialSharpeRatioStandardDeviation: 0,
      multipleTestingAdjustment: "candidate_count"
    }
  });

  assert.equal(report.selectionContext.trialSharpeRatioStandardDeviation, 0);
  assert.equal(
    report.metrics.deflatedSharpeRatio.status,
    "missing_selection_context"
  );
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "MULTIPLE_TESTING_CONTEXT_MISSING"
    ),
    true
  );
});

test("Sharpe validation calculator fails closed for insufficient samples", () => {
  const report = calculateSharpeValidationReport({
    returns: [0.01, 0.02, Number.NaN, Number.POSITIVE_INFINITY],
    minimumSampleCount: 3
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.sample.returnSampleCount, 2);
  assert.equal(report.metrics.sampleSharpe.status, "insufficient_sample");
  assert.equal(report.metrics.sampleSharpe.value, null);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    [
      "INSUFFICIENT_RETURN_SAMPLES",
      "SKEW_OR_KURTOSIS_UNAVAILABLE",
      "MULTIPLE_TESTING_CONTEXT_MISSING"
    ]
  );
});

test("Sharpe validation calculator fails closed for zero volatility", () => {
  const report = calculateSharpeValidationReport({
    returns: Array.from({ length: 30 }, () => 0.01),
    autocorrelationMaxLag: 1
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.distribution.volatilityRatio, 0);
  assert.equal(report.metrics.sampleSharpe.status, "not_applicable");
  assert.equal(report.metrics.sampleSharpe.value, null);
  assert.match(
    report.warnings.map((warning) => warning.code).join("\n"),
    /ZERO_RETURN_VOLATILITY/
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
});
