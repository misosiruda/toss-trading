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

test("portfolio compliance page data reads read-only ViewModel contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalDashboardBaseUrl = process.env.DASHBOARD_OPS_API_BASE_URL;
  const originalOpsBaseUrl = process.env.OPS_API_BASE_URL;
  process.env.DASHBOARD_OPS_API_BASE_URL = "http://ops.test/";
  delete process.env.OPS_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      "http://ops.test/dashboard/view-model/portfolio-compliance"
    );
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    return new Response(
      JSON.stringify({
        mode: "paper_only",
        readOnly: true,
        viewModel: "portfolio-compliance",
        asOf: "2026-06-30T00:00:00.000Z",
        portfolioId: "paper-portfolio-unit",
        virtualNetWorthKrw: 1000000,
        policyStatus: "missing",
        bucketCompliance: [
          {
            bucket: "long_term",
            targetWeightRatio: 0,
            currentWeightRatio: 0.4,
            gapRatio: 0.4,
            exposureKrw: 400000,
            turnoverRatio: 0.12,
            status: "missing",
            primaryReason: "policy target unavailable"
          }
        ],
        cashCompliance: {
          marketRegime: "unknown",
          targetCashRatio: 0.15,
          currentCashRatio: 0.35,
          currentCashKrw: 350000,
          minimumCashReserveKrw: 150000,
          cashGapKrw: 200000,
          ruleSource: "static_floor",
          status: "ok",
          rejectedCount: 1,
          rejectCodes: {
            VIRTUAL_CASH_EXCEEDED: 1
          }
        },
        hedgeCompliance: {
          hedgeEnabled: true,
          hedgeExposureKrw: 50000,
          hedgeExposureRatio: 0.05,
          grossExposureKrw: 650000,
          netDownsideExposureKrw: 600000,
          estimatedDownsideReductionKrw: 50000,
          hedgeCostKrw: 500,
          hedgeTradeCount: 1,
          rejectedCount: 1,
          rejectCodes: {
            VIRTUAL_CASH_EXCEEDED: 1
          },
          status: "ok"
        },
        exposureCompliance: {
          grossExposureKrw: 650000,
          grossExposureRatio: 0.65,
          byMarket: [
            {
              key: "KR",
              exposureKrw: 650000,
              exposureRatio: 0.65
            }
          ],
          byStrategyBucket: [
            {
              key: "long_term",
              exposureKrw: 400000,
              exposureRatio: 0.4
            }
          ],
          maxSymbolExposure: {
            key: "KR:005930",
            exposureKrw: 400000,
            exposureRatio: 0.4
          },
          status: "ok"
        },
        riskGateSummary: {
          decisionRecordCount: 1,
          decisionItemCount: 1,
          actionableDecisionCount: 1,
          simulatedTradeCount: 1,
          rejectedCount: 1,
          rejectCodes: {
            VIRTUAL_CASH_EXCEEDED: 1
          }
        },
        complianceAnalytics: {
          strategyBucket: {
            occupiedBucketCount: 1,
            missingPolicyTargetCount: 1,
            largestBucket: {
              key: "long_term",
              exposureKrw: 400000,
              exposureRatio: 0.4
            },
            concentrationRatio: 0.615,
            status: "watch"
          },
          cashReserve: {
            currentCashKrw: 350000,
            currentCashRatio: 0.35,
            targetCashRatio: 0.15,
            minimumCashReserveKrw: 150000,
            cashGapKrw: 200000,
            reserveStatus: "ok",
            marketRegime: "unknown",
            ruleSource: "static_floor"
          },
          hedgeEffectiveness: {
            hedgeCoverageRatio: 0.08,
            netDownsideExposureRatio: 0.92,
            costDragRatio: 0.01,
            status: "ok"
          },
          costTurnover: {
            totalTradeAmountKrw: 100000,
            totalCostKrw: 500,
            totalTurnoverRatio: 0.1,
            totalCostDragRatio: 0.005,
            byStrategyBucket: [
              {
                bucket: "long_term",
                tradeCount: 1,
                grossTradeAmountKrw: 100000,
                totalCostKrw: 500,
                turnoverRatio: 0.1,
                costDragRatio: 0.005
              }
            ]
          }
        },
        sourceStatus: {
          portfolio: "ok",
          decisions: "ok",
          trades: "ok",
          auditEvents: "ok",
          batchAggregate: "ok"
        },
        warnings: [],
        status: "watch"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const { readPortfolioCompliancePageData } =
      await loadDashboardViewModelsModule();
    const pageData = await readPortfolioCompliancePageData();

    assert.equal(pageData.apiBaseLabel, "configured operations endpoint");
    assert.equal(pageData.portfolio.status, "ok");
    assert.equal(pageData.portfolio.data.viewModel, "portfolio-compliance");
    assert.equal(pageData.portfolio.data.readOnly, true);
    assert.equal(pageData.portfolio.data.mode, "paper_only");
    assert.equal(
      pageData.portfolio.data.riskGateSummary.rejectCodes
        .VIRTUAL_CASH_EXCEEDED,
      1
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

test("run detail page data reads latest batch replay artifacts", async () => {
  const originalFetch = globalThis.fetch;
  const originalDashboardBaseUrl = process.env.DASHBOARD_OPS_API_BASE_URL;
  const originalOpsBaseUrl = process.env.OPS_API_BASE_URL;
  process.env.DASHBOARD_OPS_API_BASE_URL = "http://ops.test/";
  delete process.env.OPS_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      "http://ops.test/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=paper_sim_single"
    );
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    return new Response(
      JSON.stringify({
        mode: "paper_only",
        readOnly: true,
        status: "ok",
        aggregateStatus: "missing",
        batchStatus: "completed",
        batchId: "paper_sim_single",
        sourceRunsPath:
          "apps/dashboard/.e2e-data/batch-replay/paper_sim_single/batch-replay-runs.jsonl",
        runs: [
          {
            mode: "paper_only",
            batchId: "paper_sim_single",
            runId: "paper_sim_single_run_000000",
            runIndex: 0,
            status: "completed",
            startedAt: "2026-06-27T00:01:00.000Z",
            completedAt: "2026-06-27T00:05:00.000Z",
            skippedAt: null,
            failedAt: null,
            storageBaseDir:
              "apps/dashboard/.e2e-data/batch-replay/paper_sim_single/runs/paper_sim_single_run_000000",
            reportPath:
              "apps/dashboard/.e2e-data/batch-replay/paper_sim_single/runs/paper_sim_single_run_000000/historical-replay-report.json",
            marketRegime: {
              label: "bull"
            },
            summary: {
              finalVirtualNetWorthKrw: 1025000,
              totalReturnRatio: 0.025,
              tradeCount: 1,
              rejectedCount: 1,
              aiDecisionFailureCount: 0
            },
            error: null,
            skipReason: null
          }
        ],
        latestRunArtifacts: {
          status: "ok",
          runId: "paper_sim_single_run_000000",
          runStatus: "completed",
          reportStatus: "ok",
          report: {
            title: "Historical Replay Paper Report"
          },
          progressStatus: "ok",
          progress: {
            status: "completed",
            simulatedAt: "2026-06-27T00:05:00.000Z",
            completedTickCount: 2,
            tickCount: 3,
            rejectedCount: 1,
            currentPortfolio: {
              virtualNetWorthKrw: 1000000,
              cashKrw: 930000,
              positionCount: 1
            }
          },
          decisionsStatus: "ok",
          decisionCount: 1,
          totalDecisionCount: 1,
          riskDecisionsStatus: "ok",
          riskDecisionCount: 1,
          totalRiskDecisionCount: 1,
          tradesStatus: "ok",
          tradeCount: 1,
          totalTradeCount: 1
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const { readRunDetailPageData } = await loadDashboardViewModelsModule();
    const pageData = await readRunDetailPageData("paper_sim_single");

    assert.equal(pageData.apiBaseLabel, "configured operations endpoint");
    assert.equal(pageData.runDetail.status, "ok");
    assert.equal(pageData.runDetail.data.mode, "paper_only");
    assert.equal(pageData.runDetail.data.readOnly, true);
    assert.equal(pageData.runDetail.data.status, "ok");
    assert.equal(
      pageData.runDetail.data.runId,
      "paper_sim_single_run_000000"
    );
    assert.equal(
      pageData.runDetail.data.run.runId,
      "paper_sim_single_run_000000"
    );
    assert.equal(
      pageData.runDetail.data.artifacts.reportTitle,
      "Historical Replay Paper Report"
    );
    assert.equal(
      pageData.runDetail.data.artifacts.currentVirtualNetWorthKrw,
      1000000
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

test("run detail page data resolves active batch before terminal records", async () => {
  const originalFetch = globalThis.fetch;
  const originalDashboardBaseUrl = process.env.DASHBOARD_OPS_API_BASE_URL;
  const originalOpsBaseUrl = process.env.OPS_API_BASE_URL;
  process.env.DASHBOARD_OPS_API_BASE_URL = "http://ops.test/";
  delete process.env.OPS_API_BASE_URL;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      "http://ops.test/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=paper_sim_active"
    );
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    return new Response(
      JSON.stringify({
        mode: "paper_only",
        readOnly: true,
        status: "running",
        aggregateStatus: "missing",
        batchStatus: "running",
        batchId: "paper_sim_active",
        sourceRunsPath:
          "apps/dashboard/.e2e-data/batch-replay/paper_sim_active/batch-replay-runs.jsonl",
        activeRun: {
          runId: "paper_sim_active_run_000000_20240101",
          runIndex: 0,
          runSeed: "policy-active-seed:0",
          startedAt: "2026-06-27T00:01:00.000Z",
          storageBaseDir:
            "apps/dashboard/.e2e-data/batch-replay/paper_sim_active/runs/paper_sim_active_run_000000_20240101",
          marketRegime: {
            label: "mixed"
          }
        },
        runs: [],
        latestRunArtifacts: {
          status: "ok",
          runId: "paper_sim_active_run_000000_20240101",
          runStatus: null,
          reportStatus: "missing",
          progressStatus: "ok",
          progress: {
            status: "running",
            simulatedAt: "2026-06-27T00:02:00.000Z",
            completedTickCount: 1,
            tickCount: 3,
            rejectedCount: 0,
            currentPortfolio: {
              virtualNetWorthKrw: 1000000,
              cashKrw: 1000000,
              positionCount: 0
            }
          },
          decisionsStatus: "missing",
          decisionCount: 0,
          totalDecisionCount: 0,
          riskDecisionsStatus: "missing",
          riskDecisionCount: 0,
          totalRiskDecisionCount: 0,
          tradesStatus: "missing",
          tradeCount: 0,
          totalTradeCount: 0
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const { readRunDetailPageData } = await loadDashboardViewModelsModule();
    const pageData = await readRunDetailPageData("paper_sim_active");

    assert.equal(pageData.runDetail.status, "ok");
    assert.equal(pageData.runDetail.data.status, "ok");
    assert.equal(
      pageData.runDetail.data.runId,
      "paper_sim_active_run_000000_20240101"
    );
    assert.equal(pageData.runDetail.data.run.status, "running");
    assert.equal(pageData.runDetail.data.run.batchId, "paper_sim_active");
    assert.equal(pageData.runDetail.data.artifacts.progressStatus, "ok");
    assert.equal(
      pageData.runDetail.data.artifacts.progressStatusLabel,
      "running"
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

test("hedge missing status is not treated as a compliance breach", async () => {
  const { isHedgeComplianceBreachStatus } =
    await loadDashboardViewModelsModule();

  assert.equal(isHedgeComplianceBreachStatus("ok"), false);
  assert.equal(isHedgeComplianceBreachStatus("missing"), false);
  assert.equal(isHedgeComplianceBreachStatus("ineffective"), true);
  assert.equal(isHedgeComplianceBreachStatus("over_hedged"), true);
});
