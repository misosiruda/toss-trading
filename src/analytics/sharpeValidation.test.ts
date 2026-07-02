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
    autocorrelationMaxLag: 2,
    selectionContext: {
      candidateCount: 3,
      trialCount: 30,
      selectedByMetric: "total_return_ratio",
      multipleTestingAdjustment: "candidate_count"
    }
  });

  assert.deepEqual(report, calculateSharpeValidationReport({
    returns,
    autocorrelationMaxLag: 2,
    selectionContext: {
      candidateCount: 3,
      trialCount: 30,
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
  assert.equal(report.metrics.sampleSharpe.value, 0.374562);
  assert.equal(report.metrics.sampleSharpe.confidenceInterval95, null);
  assert.equal(report.distribution.autocorrelation.lagCount, 2);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    [
      "SERIAL_CORRELATION_NOT_ADJUSTED",
      "NON_IID_RETURN_SAMPLE",
      "SHARPE_VALIDATION_NOT_IMPLEMENTED"
    ]
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
  assert.equal(report.metrics.loAdjustedSharpe.status, "not_implemented");
  assert.equal(report.metrics.probabilisticSharpeRatio.probability, null);
  assert.equal(report.metrics.deflatedSharpeRatio.status, "not_implemented");
  assert.equal(report.selectionContext.multipleTestingAdjustment, "unknown");
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["INSUFFICIENT_RETURN_SAMPLES", "SHARPE_VALIDATION_NOT_IMPLEMENTED"]
  );
  assert.equal(JSON.stringify(report).includes("NaN"), false);
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
      "MULTIPLE_TESTING_CONTEXT_MISSING",
      "SHARPE_VALIDATION_NOT_IMPLEMENTED"
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
