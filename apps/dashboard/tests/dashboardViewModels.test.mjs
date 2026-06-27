import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

async function loadDashboardViewModelsModule() {
  const source = await readFile(
    new URL("../src/lib/dashboardViewModels.ts", import.meta.url),
    "utf8"
  );
  const moduleSource = stripTypeScriptTypes(source, { mode: "strip" });
  return import(`data:text/javascript,${encodeURIComponent(moduleSource)}`);
}

test("validation lab fallback fills missing candidate comparison", async () => {
  const { withValidationLabCandidateComparisonFallback } =
    await loadDashboardViewModelsModule();
  const payload = {
    mode: "paper_only",
    readOnly: true,
    viewModel: "validation-lab",
    status: "ok",
    aggregateReportStatus: "ok",
    sourceGeneratedAt: null,
    warnings: [],
    executionAssumptions: {
      paperOnly: true,
      liveTradingEnabled: false,
      orderPlacementEnabled: false
    }
  };

  const normalized = withValidationLabCandidateComparisonFallback(payload);

  assert.equal(normalized.viewModel, "validation-lab");
  assert.equal(normalized.candidateComparison.status, "missing");
  assert.equal(normalized.candidateComparison.candidateCount, 0);
  assert.deepEqual(normalized.candidateComparison.rows, []);
  assert.match(
    normalized.candidateComparison.warnings.join("\n"),
    /does not include candidateComparison/
  );
});

test("validation lab fallback preserves existing candidate comparison", async () => {
  const { withValidationLabCandidateComparisonFallback } =
    await loadDashboardViewModelsModule();
  const payload = {
    candidateComparison: {
      status: "available",
      selectionMetric: "total_return_ratio",
      selectedCandidateKey: "candidate-a",
      candidateCount: 1,
      returnSampleCount: 1,
      rows: [],
      warnings: []
    }
  };

  assert.equal(withValidationLabCandidateComparisonFallback(payload), payload);
});
