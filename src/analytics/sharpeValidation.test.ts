import assert from "node:assert/strict";
import test from "node:test";

import {
  createUnavailableSharpeValidationReport,
  SHARPE_VALIDATION_SCHEMA_VERSION
} from "./sharpeValidation.js";

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
