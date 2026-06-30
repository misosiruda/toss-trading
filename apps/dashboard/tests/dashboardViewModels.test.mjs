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

test("live readiness page data reads safe ViewModel contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalDashboardBaseUrl = process.env.DASHBOARD_OPS_API_BASE_URL;
  const originalOpsBaseUrl = process.env.OPS_API_BASE_URL;
  process.env.DASHBOARD_OPS_API_BASE_URL = "http://ops.test/";
  delete process.env.OPS_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      "http://ops.test/dashboard/view-model/live-readiness"
    );
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    return new Response(
      JSON.stringify({
        mode: "paper_only",
        readOnly: true,
        viewModel: "live-readiness",
        generatedAt: "2026-06-30T00:00:00.000Z",
        environment: {
          tradingEnabled: false,
          brokerProvider: "mock",
          aiDecisionMode: "paper_only",
          aiDecisionEnabled: true
        },
        officialApi: {
          authEnabled: false,
          authStatus: "disabled",
          baseUrl: "https://openapi.tossinvest.com",
          clientIdConfigured: false,
          clientCredentialConfigured: false,
          issueCodes: [],
          snapshotStatus: "disabled"
        },
        orderGateway: {
          liveOrderGatewayStatus: "disabled",
          orderRouterConnectionStatus: "not_connected",
          mcpMutationToolExposureStatus: "not_exposed",
          orderPlacementEnabled: false,
          rawTossctlExecutionEnabled: false,
          rawCodexExecEnabled: false
        },
        checks: [
          {
            key: "trading_enabled",
            label: "TRADING_ENABLED",
            value: "false",
            tone: "ok",
            detail: "Live trading is disabled for this operations surface."
          }
        ],
        warnings: [],
        status: "ok"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const { readLiveReadinessPageData } = await loadDashboardViewModelsModule();
    const pageData = await readLiveReadinessPageData();

    assert.equal(pageData.apiBaseLabel, "configured operations endpoint");
    assert.equal(pageData.liveReadiness.status, "ok");
    assert.equal(pageData.liveReadiness.data.viewModel, "live-readiness");
    assert.equal(
      pageData.liveReadiness.data.orderGateway.orderPlacementEnabled,
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDashboardBaseUrl === undefined) {
      delete process.env.DASHBOARD_OPS_API_BASE_URL;
    } else {
      process.env.DASHBOARD_OPS_API_BASE_URL = originalDashboardBaseUrl;
    }
    if (originalOpsBaseUrl === undefined) {
      delete process.env.OPS_API_BASE_URL;
    } else {
      process.env.OPS_API_BASE_URL = originalOpsBaseUrl;
    }
  }
});
