import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditEvent,
  MarketPacket,
  VirtualDecision,
  VirtualPortfolio,
  VirtualTrade
} from "../domain/schemas.js";
import type { TossInvestCliCollectResult } from "../collectors/tossInvestCliCollector.js";
import { createPaperSchedulerPaths } from "../scheduler/paperRunScheduler.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileMarketPacketStore,
  FileTossInvestSourceStore,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import { createLocalOperationsServer } from "./localOperationsServer.js";
import {
  LOCAL_OPERATIONS_API_ROUTES,
  READ_ONLY_HTTP_METHODS
} from "./localOperationsSurface.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function createTempStorageBaseDir(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "toss-trading-api-test-"));
  const storageBaseDir = join(parent, "paper");
  await mkdir(storageBaseDir, { recursive: true });
  return storageBaseDir;
}

async function startTestServer(
  storageBaseDir: string
): Promise<{ server: Server; baseUrl: string }> {
  const server = createLocalOperationsServer({
    storageBaseDir,
    now: () => now
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopTestServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function fetchJson(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = (await response.json()) as Record<string, unknown>;
  return { response, payload };
}

async function fetchText(
  baseUrl: string,
  path: string
): Promise<{ response: Response; text: string }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { response, text };
}

test("local operations surface manifest is read-only", () => {
  assert.deepEqual([...READ_ONLY_HTTP_METHODS], ["GET", "HEAD"]);
  assert.equal(
    (LOCAL_OPERATIONS_API_ROUTES as readonly string[]).includes("/place_order"),
    false
  );
  assert.equal(
    (LOCAL_OPERATIONS_API_ROUTES as readonly string[]).includes("/run_codex_exec"),
    false
  );
  assert.equal(
    (LOCAL_OPERATIONS_API_ROUTES as readonly string[]).includes("/run_tossctl"),
    false
  );
});

test("local operations API serves health and virtual portfolio JSON", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const health = await fetchJson(baseUrl, "/health");
    const portfolioResponse = await fetchJson(baseUrl, "/virtual/portfolio");

    assert.equal(health.response.status, 200);
    assert.match(
      health.response.headers.get("content-type") ?? "",
      /application\/json/
    );
    assert.equal(health.payload["mode"], "paper_only");
    assert.equal(health.payload["readOnly"], true);
    assert.equal(health.payload["tradingEnabled"], false);
    assert.equal(portfolioResponse.payload["sourceStatus"], "ok");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves read-only dashboard assets", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const html = await fetchText(baseUrl, "/dashboard");
    const script = await fetchText(baseUrl, "/dashboard/app.js");
    const moduleScripts = await Promise.all(
      [
        "/dashboard/apiClient.js",
        "/dashboard/batchRunRenderers.js",
        "/dashboard/decisionRenderers.js",
        "/dashboard/dom.js",
        "/dashboard/formatters.js",
        "/dashboard/metadata.js",
        "/dashboard/portfolioModel.js",
        "/dashboard/portfolioRenderers.js",
        "/dashboard/reportRenderers.js",
        "/dashboard/replayProgressCoordinator.js",
        "/dashboard/replayProgressRenderers.js",
        "/dashboard/reportViewHelpers.js",
        "/dashboard/router.js",
        "/dashboard/sourceRenderers.js",
        "/dashboard/state.js",
        "/dashboard/tableRenderers.js"
      ].map((path) => fetchText(baseUrl, path))
    );
    const rootScript = await fetchText(baseUrl, "/app.js");
    const rootModuleScript = await fetchText(baseUrl, "/apiClient.js");
    const rootBatchRunRenderersScript = await fetchText(
      baseUrl,
      "/batchRunRenderers.js"
    );
    const rootDecisionRenderersScript = await fetchText(
      baseUrl,
      "/decisionRenderers.js"
    );
    const rootPortfolioModelScript = await fetchText(
      baseUrl,
      "/portfolioModel.js"
    );
    const rootPortfolioRenderersScript = await fetchText(
      baseUrl,
      "/portfolioRenderers.js"
    );
    const rootReportRenderersScript = await fetchText(
      baseUrl,
      "/reportRenderers.js"
    );
    const rootReplayProgressRenderersScript = await fetchText(
      baseUrl,
      "/replayProgressRenderers.js"
    );
    const rootReplayProgressCoordinatorScript = await fetchText(
      baseUrl,
      "/replayProgressCoordinator.js"
    );
    const rootReportViewHelpersScript = await fetchText(
      baseUrl,
      "/reportViewHelpers.js"
    );
    const rootSourceRenderersScript = await fetchText(
      baseUrl,
      "/sourceRenderers.js"
    );
    const rootTableRenderersScript = await fetchText(
      baseUrl,
      "/tableRenderers.js"
    );
    const rootStyles = await fetchText(baseUrl, "/styles.css");
    const replayPage = await fetchText(baseUrl, "/dashboard/virtual-replays");
    const summaryPage = await fetchText(baseUrl, "/dashboard/batch-summary");
    const dashboardScriptText = [
      script.text,
      ...moduleScripts.map((moduleScript) => moduleScript.text)
    ].join("\n");

    assert.equal(html.response.status, 200);
    assert.match(html.response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(replayPage.response.status, 200);
    assert.equal(summaryPage.response.status, 200);
    assert.equal(rootScript.response.status, 200);
    assert.equal(rootModuleScript.response.status, 200);
    assert.equal(rootBatchRunRenderersScript.response.status, 200);
    assert.equal(rootDecisionRenderersScript.response.status, 200);
    assert.equal(rootPortfolioModelScript.response.status, 200);
    assert.equal(rootPortfolioRenderersScript.response.status, 200);
    assert.equal(rootReportRenderersScript.response.status, 200);
    assert.equal(rootReplayProgressRenderersScript.response.status, 200);
    assert.equal(rootReplayProgressCoordinatorScript.response.status, 200);
    assert.equal(rootReportViewHelpersScript.response.status, 200);
    assert.equal(rootSourceRenderersScript.response.status, 200);
    assert.equal(rootTableRenderersScript.response.status, 200);
    assert.equal(rootStyles.response.status, 200);
    assert.equal(
      rootStyles.text.includes(
        'html[data-dashboard-page="virtual-replays"] .metric-grid'
      ),
      true
    );
    assert.equal(
      rootStyles.text.includes(
        'html[data-dashboard-page="batch-summary"] .metric-grid'
      ),
      true
    );
    for (const moduleScript of moduleScripts) {
      assert.equal(moduleScript.response.status, 200);
      assert.match(
        moduleScript.response.headers.get("content-type") ?? "",
        /text\/javascript/
      );
    }
    assert.match(html.text, /가상 투자 대시보드/);
    assert.match(html.text, /document\.documentElement\.dataset\.dashboardPage/);
    assert.match(html.text, /href="styles.css"/);
    assert.match(html.text, /src="app.js"/);
    assert.match(html.text, /data-dashboard-route="overview"/);
    assert.match(html.text, /data-dashboard-route="virtual-replays"/);
    assert.match(html.text, /data-dashboard-route="batch-summary"/);
    assert.match(html.text, /id="daily-report-heading"/);
    assert.match(html.text, /id="performance-heading"/);
    assert.match(html.text, /id="net-worth-chart"/);
    assert.match(html.text, /id="allocation-list"/);
    assert.match(html.text, /id="benchmark-heading"/);
    assert.match(html.text, /id="benchmark-alpha"/);
    assert.match(html.text, /id="execution-cost-heading"/);
    assert.match(html.text, /id="execution-cost-fee-drag"/);
    assert.match(html.text, /id="execution-cost-detail"/);
    assert.match(html.text, /id="market-monitor-heading"/);
    assert.match(html.text, /id="market-monitor-gainers"/);
    assert.match(html.text, /id="market-monitor-extremes"/);
    assert.match(html.text, /id="exposure-heading"/);
    assert.match(html.text, /id="exposure-sector-list"/);
    assert.match(html.text, /id="exposure-coverage-detail"/);
    assert.match(html.text, /id="event-heading"/);
    assert.match(html.text, /id="event-signal-list"/);
    assert.match(html.text, /id="event-gap-detail"/);
    assert.match(html.text, /id="income-goal-heading"/);
    assert.match(html.text, /id="goal-target-progress"/);
    assert.match(html.text, /role="progressbar"/);
    assert.match(html.text, /aria-valuenow="0"/);
    assert.match(html.text, /id="income-goal-detail"/);
    assert.match(html.text, /id="report-detail"/);
    assert.match(html.text, /id="replay-heading"/);
    assert.match(html.text, /id="replay-progress-status"/);
    assert.match(html.text, /id="replay-progress-events-body"/);
    assert.match(html.text, /id="replay-timeline-body"/);
    assert.match(html.text, /id="batch-run-heading"/);
    assert.match(html.text, /id="batch-run-tabs"/);
    assert.match(html.text, /id="batch-run-list"/);
    assert.match(html.text, /id="batch-replay-heading"/);
    assert.match(html.text, /id="batch-replay-average-return"/);
    assert.match(html.text, /id="batch-regime-list"/);
    assert.match(html.text, /data-action-filter="BUY"/);
    assert.match(html.text, /id="symbol-filter"/);
    assert.match(html.text, /id="decision-performance-list"/);
    assert.match(html.text, /id="decision-performance-average"/);
    assert.match(html.text, /id="portfolio-risk-status"/);
    assert.match(html.text, /id="portfolio-risk-detail"/);
    assert.equal(script.response.status, 200);
    assert.match(script.text, /from "\.\/apiClient\.js"/);
    assert.match(script.text, /from "\.\/batchRunRenderers\.js"/);
    assert.match(script.text, /from "\.\/decisionRenderers\.js"/);
    assert.match(script.text, /from "\.\/dom\.js"/);
    assert.match(script.text, /from "\.\/formatters\.js"/);
    assert.match(dashboardScriptText, /from "\.\/metadata\.js"/);
    assert.match(dashboardScriptText, /from "\.\/portfolioModel\.js"/);
    assert.match(script.text, /from "\.\/portfolioRenderers\.js"/);
    assert.match(dashboardScriptText, /portfolioPointFromVirtualPortfolio/);
    assert.match(dashboardScriptText, /export function portfolioPointFromVirtualPortfolio/);
    assert.match(script.text, /from "\.\/reportRenderers\.js"/);
    assert.match(script.text, /from "\.\/replayProgressCoordinator\.js"/);
    assert.match(script.text, /from "\.\/replayProgressRenderers\.js"/);
    assert.match(dashboardScriptText, /from "\.\/reportViewHelpers\.js"/);
    assert.match(script.text, /from "\.\/router\.js"/);
    assert.match(script.text, /from "\.\/sourceRenderers\.js"/);
    assert.match(script.text, /from "\.\/state\.js"/);
    assert.match(script.text, /from "\.\/tableRenderers\.js"/);
    assert.match(dashboardScriptText, /\/virtual\/portfolio/);
    assert.match(dashboardScriptText, /\/paper\/report/);
    assert.match(dashboardScriptText, /\/replay\/report/);
    assert.match(dashboardScriptText, /\/replay\/progress/);
    assert.match(dashboardScriptText, /\/batch\/replay\/report/);
    assert.match(dashboardScriptText, /\/batch\/replay\/runs/);
    assert.match(dashboardScriptText, /\/audit\/events/);
    for (const routePath of LOCAL_OPERATIONS_API_ROUTES) {
      assert.equal(dashboardScriptText.includes(routePath), true, routePath);
    }
    assert.match(dashboardScriptText, /fetchEndpointData/);
    assert.match(dashboardScriptText, /endpointFailures/);
    assert.match(dashboardScriptText, /applyDashboardRoute/);
    assert.match(dashboardScriptText, /dataset\.dashboardPage = page/);
    assert.match(dashboardScriptText, /showFileModeNotice/);
    assert.match(script.text, /renderDailyReport/);
    assert.match(script.text, /renderReplayReport/);
    assert.match(script.text, /renderReplayProgress/);
    assert.match(script.text, /renderBatchReplayReport/);
    assert.match(script.text, /renderBatchReplayRuns/);
    assert.match(dashboardScriptText, /renderBatchRunTabs/);
    assert.match(dashboardScriptText, /renderBatchRunPage/);
    assert.match(script.text, /scheduleBatchRunsPolling/);
    assert.match(script.text, /refreshBatchRuns/);
    assert.match(script.text, /renderPortfolioPerformance/);
    assert.match(dashboardScriptText, /portfolioPerformanceTimeline/);
    assert.match(dashboardScriptText, /renderNetWorthChart/);
    assert.match(dashboardScriptText, /renderAllocationList/);
    assert.match(script.text, /renderBenchmarkComparison/);
    assert.match(dashboardScriptText, /equalWeightBenchmarkReturn/);
    assert.match(script.text, /renderExecutionCostDiagnostics/);
    assert.match(dashboardScriptText, /buildExecutionCostSummary/);
    assert.match(script.text, /renderExposureBreakdown/);
    assert.match(script.text, /renderEventCoverage/);
    assert.match(script.text, /renderIncomeGoalPanel/);
    assert.match(dashboardScriptText, /aria-valuenow/);
    assert.match(script.text, /scheduleReplayProgressPolling/);
    assert.match(script.text, /renderLiveReplaySections/);
    assert.match(script.text, /renderReplayProgress/);
    assert.match(dashboardScriptText, /export function scheduleReplayProgressPolling/);
    assert.match(dashboardScriptText, /export function renderLiveReplaySections/);
    assert.match(dashboardScriptText, /export function renderReplayProgress/);
    assert.match(dashboardScriptText, /export function replayProgressStatus/);
    assert.match(dashboardScriptText, /export function replayProgressRiskSummary/);
    assert.match(script.text, /renderSourceSummary/);
    assert.match(script.text, /rememberSymbolMetadata/);
    assert.match(dashboardScriptText, /export function renderSourceSummary/);
    assert.match(dashboardScriptText, /export function rememberSymbolMetadata/);
    assert.match(dashboardScriptText, /renderReplayTimeline/);
    assert.match(dashboardScriptText, /renderDecisionTimeline/);
    assert.match(dashboardScriptText, /renderDecisionPerformance/);
    assert.match(dashboardScriptText, /buildDecisionPerformanceOutcomes/);
    assert.match(script.text, /renderPortfolioRiskMetrics/);
    assert.match(dashboardScriptText, /buildPortfolioRiskMetrics/);
    assert.match(script.text, /renderPositions/);
    assert.match(script.text, /renderTrades/);
    assert.match(script.text, /renderPackets/);
    assert.match(dashboardScriptText, /export function renderPositions/);
    assert.match(dashboardScriptText, /export function renderTrades/);
    assert.match(dashboardScriptText, /export function renderPackets/);
    assert.match(dashboardScriptText, /export function symbolCell/);
    assert.doesNotMatch(script.text, /function portfolioPerformanceTimeline/);
    assert.doesNotMatch(script.text, /function currentPortfolioSummary/);
    assert.doesNotMatch(script.text, /function positionMarketValue/);
    assert.doesNotMatch(script.text, /function renderPortfolioPerformance/);
    assert.doesNotMatch(script.text, /function buildBenchmarkComparison/);
    assert.doesNotMatch(script.text, /function renderNetWorthChart/);
    assert.doesNotMatch(script.text, /function buildPortfolioRiskMetrics/);
    assert.match(dashboardScriptText, /decisionOutcomeRow/);
    assert.match(dashboardScriptText, /decisionRationale/);
    assert.match(dashboardScriptText, /리스크 요인/);
    assert.doesNotMatch(script.text, /function renderBatchReplayRuns/);
    assert.doesNotMatch(script.text, /function renderBatchRunTabs/);
    assert.doesNotMatch(script.text, /function renderBatchRunPage/);
    assert.doesNotMatch(script.text, /function renderDecisionTimeline/);
    assert.doesNotMatch(script.text, /function renderDecisionPerformance/);
    assert.doesNotMatch(script.text, /function renderPositions/);
    assert.doesNotMatch(script.text, /function renderTrades/);
    assert.doesNotMatch(script.text, /function renderPackets/);
    assert.doesNotMatch(script.text, /function symbolCell/);
    assert.doesNotMatch(script.text, /function renderReplayProgress/);
    assert.doesNotMatch(script.text, /function renderReplayPerformance/);
    assert.doesNotMatch(script.text, /function renderReplayProgressEvents/);
    assert.doesNotMatch(script.text, /function replayProgressRiskSummary/);
    assert.doesNotMatch(script.text, /function renderLiveReplaySections/);
    assert.doesNotMatch(script.text, /function scheduleReplayProgressPolling/);
    assert.doesNotMatch(script.text, /function refreshReplayProgress/);
    assert.doesNotMatch(script.text, /function renderSourceSummary/);
    assert.doesNotMatch(script.text, /function rememberSymbolMetadata/);
    assert.doesNotMatch(dashboardScriptText, /\bPOST\b|\bPUT\b|\bDELETE\b/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves stored historical replay report read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.historicalReplayReportPath,
    `${JSON.stringify(historicalReplayReport())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/replay/report");
    const report = result.payload["report"] as Record<string, unknown>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "ok");
    assert.equal(report["title"], "Historical Replay Paper Report");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves stored batch replay aggregate report read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(batchReplayAggregateReport())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/batch/replay/report");
    const report = result.payload["report"] as Record<string, unknown>;
    const summary = report["summary"] as Record<string, unknown>;

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "ok");
    assert.equal(report["title"], "Batch Replay Paper Aggregate Report");
    assert.equal(summary["runCount"], 4);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves individual batch replay runs read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const runsDir = join(storageBaseDir, "batch-replay", "batch-smoke");
  const runsPath = join(runsDir, "batch-replay-runs.jsonl");
  await mkdir(runsDir, { recursive: true });
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(batchReplayAggregateReport(runsPath))}\n`,
    "utf8"
  );
  await writeFile(
    runsPath,
    [
      JSON.stringify(batchReplayRunRecord(0, "completed")),
      JSON.stringify(batchReplayRunRecord(1, "failed")),
      "not-json"
    ].join("\n"),
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/batch/replay/runs?limit=1");
    const runs = result.payload["runs"] as Array<Record<string, unknown>>;
    const statusCounts = result.payload["statusCounts"] as Record<string, unknown>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "degraded");
    assert.equal(result.payload["count"], 1);
    assert.equal(result.payload["totalCount"], 2);
    assert.equal(result.payload["corruptLineCount"], 1);
    assert.equal(statusCounts["completed"], 1);
    assert.equal(statusCounts["failed"], 1);
    assert.equal(runs[0]?.["runId"], "run_1");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves live batch replay runs from the latest manifest", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const batchDir = join(storageBaseDir, "..", "batch-replay", "batch-live");
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  await mkdir(batchDir, { recursive: true });
  await writeFile(
    join(batchDir, "batch-replay-manifest.json"),
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-live",
      status: "running",
      updatedAt: "2026-06-11T09:00:00+09:00",
      runsPath
    })}\n`,
    "utf8"
  );
  await writeFile(
    runsPath,
    `${JSON.stringify(batchReplayRunRecord(0, "completed"))}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/batch/replay/runs?limit=10");
    const runs = result.payload["runs"] as Array<Record<string, unknown>>;

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "running");
    assert.equal(result.payload["aggregateStatus"], "missing");
    assert.equal(result.payload["batchStatus"], "running");
    assert.equal(result.payload["batchId"], "batch-live");
    assert.equal(result.payload["count"], 1);
    assert.equal(runs[0]?.["runId"], "run_0");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves stored historical replay progress read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.historicalReplayProgressPath,
    `${JSON.stringify(historicalReplayProgress())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/replay/progress");
    const progress = result.payload["progress"] as Record<string, unknown>;
    const events = progress["recentEvents"] as Array<Record<string, unknown>>;
    const progressPortfolio = progress["currentPortfolio"] as Record<string, unknown>;
    const positions = progressPortfolio["positions"] as Array<Record<string, unknown>>;
    const portfolioTimeline = progress["portfolioTimeline"] as Array<
      Record<string, unknown>
    >;
    const recentDecisions = progress["recentDecisions"] as Array<Record<string, unknown>>;
    const recentTrades = progress["recentTrades"] as Array<Record<string, unknown>>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "running");
    assert.equal(result.payload["fileStatus"], "ok");
    assert.equal(progress["mode"], "paper_only");
    assert.equal(progress["riskDecisionCount"], 2);
    assert.equal(progress["riskApprovedCount"], 1);
    assert.equal(positions[0]?.["symbol"], "005930");
    assert.equal(portfolioTimeline[0]?.["virtualNetWorthKrw"], 1_000_000);
    assert.equal(recentDecisions[0]?.["packetId"], "packet_api_001");
    assert.equal(recentTrades[0]?.["tradeId"], "trade_api_001");
    assert.equal(events[0]?.["eventType"], "RISK_REJECTED");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves source health and market packets", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileTossInvestSourceStore(paths.tossInvestSourcesPath).append(
    sourceResult()
  );
  await new FileMarketPacketStore(paths.marketPacketsPath).append(marketPacket());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const source = await fetchJson(baseUrl, "/source/health");
    const packets = await fetchJson(baseUrl, "/market/packets?limit=1");
    const byCommandKey = source.payload["byCommandKey"] as Record<string, unknown>;
    const packetRecords = packets.payload["packets"] as Array<Record<string, unknown>>;

    assert.equal(source.response.status, 200);
    assert.equal(source.payload["readOnly"], true);
    assert.equal(source.payload["status"], "ok");
    assert.equal(byCommandKey["market.ranking"], 1);
    assert.equal(packets.response.status, 200);
    assert.equal(packets.payload["count"], 1);
    assert.equal(packetRecords[0]?.["packetId"], "packet_api_001");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves recent masked audit events", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileAuditLog(paths.auditLogPath).append(auditEvent());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/audit/events?limit=1");
    const events = result.payload["events"] as Array<Record<string, unknown>>;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["count"], 1);
    assert.equal(events[0]?.["eventType"], "VIRTUAL_RISK_APPROVED");
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API returns decisions and masks sensitive text", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(decision());
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/virtual/decisions?limit=1");
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["count"], 1);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves paper report and scheduler status", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const schedulerPaths = createPaperSchedulerPaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write(portfolio());
  await new FileVirtualTradeStore(paths.virtualTradesPath).append(trade());
  await writeFile(
    schedulerPaths.statePath,
    `${JSON.stringify({ dayKey: "2026-06-11", runsUsed: 1 })}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const report = await fetchJson(baseUrl, "/paper/report?date=2026-06-11");
    const scheduler = await fetchJson(baseUrl, "/scheduler/status");
    const schedulerState = scheduler.payload["schedulerState"] as Record<
      string,
      unknown
    >;

    assert.equal(report.response.status, 200);
    assert.equal(report.payload["title"], "Paper Trading Daily Report");
    assert.match(String(report.payload["disclaimer"]), /cannot place live orders/);
    assert.equal(scheduler.response.status, 200);
    assert.equal(scheduler.payload["stateStatus"], "ok");
    assert.equal(scheduler.payload["lockStatus"], "missing");
    assert.equal(schedulerState["runsUsed"], 1);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API rejects mutation methods and has no live order endpoint", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    for (const routePath of LOCAL_OPERATIONS_API_ROUTES) {
      const mutation = await fetchJson(baseUrl, routePath, { method: "POST" });
      assert.equal(mutation.response.status, 405, routePath);
      assert.equal(mutation.payload["readOnly"], true, routePath);
    }

    const batchHead = await fetch(`${baseUrl}/batch/replay/report`, {
      method: "HEAD"
    });
    const liveOrder = await fetchJson(baseUrl, "/place_order");

    assert.equal(batchHead.status, 200);
    assert.equal(await batchHead.text(), "");
    assert.equal(liveOrder.response.status, 404);
    assert.equal(liveOrder.payload["error"], "not_found");
  } finally {
    await stopTestServer(server);
  }
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 900_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        quantity: 2,
        averagePriceKrw: 70_000,
        marketValueKrw: 150_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ],
    updatedAt: "2026-06-11T09:00:00+09:00"
  };
}

function decision(): VirtualDecision {
  return {
    packetId: "packet_api_001",
    summary: "Paper-only decision",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.8,
        budgetKrw: 70_000,
        thesis: "Paper thesis references order ord_abcdef123456",
        riskFactors: ["Do not expose account 1234-5678-901234"],
        dataRefs: ["tossinvest_cli:market.ranking:0:0"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}

function trade(): VirtualTrade {
  return {
    tradeId: "trade_api_001",
    packetId: "packet_api_001",
    decisionId: "decision_api_001",
    market: "KR",
    symbol: "005930",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 70_000,
    amountKrw: 70_000,
    status: "VIRTUAL_FILLED",
    executedAt: "2026-06-11T09:01:00+09:00"
  };
}

function sourceResult(): TossInvestCliCollectResult {
  return {
    status: "ok",
    commandKey: "market.ranking",
    data: { items: [{ symbol: "005930" }] },
    metadata: {
      source: "tossinvest_cli",
      sourceKind: "unofficial_read_only",
      official: false,
      commandKey: "market.ranking",
      collectedAt: "2026-06-11T09:00:00+09:00"
    },
    error: null
  };
}

function marketPacket(): MarketPacket {
  return {
    packetId: "packet_api_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: portfolio(),
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Sample Corp",
        lastPriceKrw: 70_000,
        ranking: 1,
        reasonCodes: ["RANKING"],
        sourceRefs: ["tossinvest_cli:market.ranking:0:0"],
        collectedAt: "2026-06-11T09:00:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}

function auditEvent(): AuditEvent {
  return {
    eventId: "audit_api_001",
    eventType: "VIRTUAL_RISK_APPROVED",
    actor: "system",
    summary: "KR:005930 VIRTUAL_BUY ord_abcdef123456",
    maskedRefs: [],
    createdAt: "2026-06-11T09:02:00+09:00"
  };
}

function historicalReplayReport(): Record<string, unknown> {
  return {
    title: "Historical Replay Paper Report",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    simulatedRange: {
      startAt: "2025-01-02T00:00:00.000Z",
      endAt: "2025-01-02T00:02:00.000Z",
      tickCount: 3
    },
    replaySummary: {
      packetCount: 3,
      decisionProviderCallCount: 2,
      decisionSkippedCount: 1,
      decisionRecordCount: 2,
      decisionItemCount: 2,
      tradeCount: 2,
      rejectedCount: 0
    },
    portfolio: {
      finalCashKrw: 830_000,
      finalPositionCount: 2,
      finalVirtualNetWorthKrw: 1_000_000
    },
    tradeSummary: {
      tradeCount: 2,
      virtualBuyAmountKrw: 170_000,
      virtualSellAmountKrw: 0,
      symbols: ["005930", "035420"]
    },
    riskSummary: {
      approvedCount: 2,
      rejectedCount: 0,
      rejectCodes: {}
    },
    samplingSummary: {
      decisionsRequested: 2,
      decisionsSkipped: 1,
      skipReasons: {
        STEP_INTERVAL_SKIPPED: 1
      }
    },
    sourceWarningSummary: {
      lookaheadGuardStatus: "future_snapshots_excluded",
      warningCount: 1,
      futureSnapshotWarningCount: 1,
      staleSnapshotWarningCount: 0,
      recentWarnings: ["account 1234-5678-901234 order ord_abcdef123456"]
    },
    portfolioTimeline: [
      {
        simulatedAt: "2025-01-02T00:00:00.000Z",
        cashKrw: 930_000,
        positionCount: 1,
        positionMarketValueKrw: 70_000,
        virtualNetWorthKrw: 1_000_000
      }
    ],
    disclaimer:
      "Paper-only historical replay simulation. This is not financial advice, not a performance guarantee, and cannot place live orders."
  };
}

function batchReplayAggregateReport(
  sourceRunsPath = "data/batch-replay/batch-smoke/batch-replay-runs.jsonl"
): Record<string, unknown> {
  return {
    title: "Batch Replay Paper Aggregate Report",
    mode: "paper_only",
    generatedAt: "2026-06-11T09:00:00+09:00",
    sourceRunsPath,
    summary: {
      runCount: 4,
      completedCount: 3,
      skippedCount: 1,
      failedCount: 0,
      returnSampleCount: 3,
      regimeCounts: {
        bull: 2,
        bear: 1,
        insufficient_data: 1
      }
    },
    overall: {
      key: "overall",
      runCount: 4,
      completedCount: 3,
      skippedCount: 1,
      failedCount: 0,
      returnSampleCount: 3,
      averageTotalReturnRatio: 0.015,
      medianTotalReturnRatio: 0.01,
      minTotalReturnRatio: -0.01,
      maxTotalReturnRatio: 0.045,
      winRate: 0.666667,
      averageFinalVirtualNetWorthKrw: 1_015_000,
      totalTradeCount: 8,
      averageTradeCount: 2.666667,
      totalRejectedCount: 1,
      runIds: ["run_0", "run_1", "run_2", "run_3"]
    },
    byRegime: {
      bull: {
        key: "bull",
        runCount: 2,
        completedCount: 2,
        skippedCount: 0,
        failedCount: 0,
        returnSampleCount: 2,
        averageTotalReturnRatio: 0.025,
        medianTotalReturnRatio: 0.025,
        minTotalReturnRatio: 0.005,
        maxTotalReturnRatio: 0.045,
        winRate: 1,
        averageFinalVirtualNetWorthKrw: 1_025_000,
        totalTradeCount: 6,
        averageTradeCount: 3,
        totalRejectedCount: 0,
        runIds: ["run_0", "run_1"]
      },
      bear: {
        key: "bear",
        runCount: 1,
        completedCount: 1,
        skippedCount: 0,
        failedCount: 0,
        returnSampleCount: 1,
        averageTotalReturnRatio: -0.01,
        medianTotalReturnRatio: -0.01,
        minTotalReturnRatio: -0.01,
        maxTotalReturnRatio: -0.01,
        winRate: 0,
        averageFinalVirtualNetWorthKrw: 990_000,
        totalTradeCount: 2,
        averageTradeCount: 2,
        totalRejectedCount: 1,
        runIds: ["run_2"]
      },
      insufficient_data: {
        key: "insufficient_data",
        runCount: 1,
        completedCount: 0,
        skippedCount: 1,
        failedCount: 0,
        returnSampleCount: 0,
        averageTotalReturnRatio: null,
        medianTotalReturnRatio: null,
        minTotalReturnRatio: null,
        maxTotalReturnRatio: null,
        winRate: null,
        averageFinalVirtualNetWorthKrw: null,
        totalTradeCount: 0,
        averageTradeCount: null,
        totalRejectedCount: 0,
        runIds: ["run_3"]
      }
    },
    disclaimer:
      "Batch replay aggregate reports are paper-only. They are not investment advice, guaranteed performance, or live trading signals."
  };
}

function batchReplayRunRecord(
  runIndex: number,
  status: "completed" | "failed"
): Record<string, unknown> {
  return {
    mode: "paper_only",
    batchId: "batch-smoke",
    runId: `run_${runIndex}`,
    runIndex,
    runSeed: `seed:${runIndex}`,
    status,
    startedAt: "2026-06-11T09:00:00+09:00",
    completedAt: status === "completed" ? "2026-06-11T09:01:00+09:00" : null,
    skippedAt: null,
    failedAt: status === "failed" ? "2026-06-11T09:01:00+09:00" : null,
    storageBaseDir: `data/batch-replay/batch-smoke/runs/run_${runIndex}`,
    window: {
      startAt: "2025-01-02T00:00:00.000Z",
      endAt: "2025-02-02T00:00:00.000Z",
      seed: `seed:${runIndex}`,
      index: runIndex
    },
    windowSampling: {
      mode: "balanced_regime",
      targetRegime: status === "completed" ? "bull" : "bear",
      targetCandidateCount: 2,
      fallbackReason: null
    },
    marketRegime: {
      label: status === "completed" ? "bull" : "bear",
      score: status === "completed" ? 0.4 : -0.3,
      confidence: 0.8,
      evidence: []
    },
    marketRegimesByMarket: {},
    dataAvailability: {
      status: "available",
      totalSnapshotCount: 4,
      windowSnapshotCount: 4,
      corruptLineCount: 0,
      requiredSymbolCount: 0,
      availableRequiredSymbolCount: 0,
      issues: []
    },
    summary:
      status === "completed"
        ? {
            finalVirtualNetWorthKrw: 1_025_000,
            totalReturnRatio: 0.025,
            tradeCount: 3,
            decisionProviderCallCount: 2,
            aiDecisionFailureCount: 0,
            rejectedCount: 0,
            meaningfulRejectCount: 0,
            dustRejectCount: 0,
            avgExposureRatio: 0.55,
            avgCashRatio: 0.45,
            maxExposureRatio: 0.7,
            minExposureRatio: 0.2,
            timeInMarketRatio: 0.8,
            finalCashRatio: 0.3,
            finalPositionRatio: 0.7,
            targetExposureRatio: 0.75,
            averageTargetExposureGapRatio: 0.08,
            finalTargetExposureGapRatio: 0.05
          }
        : null,
    reportPath:
      status === "completed"
        ? `data/batch-replay/batch-smoke/runs/run_${runIndex}/historical-replay-report.json`
        : null,
    error:
      status === "failed"
        ? "failed with account 1234-5678-901234 order ord_abcdef123456"
        : null,
    skipReason: null
  };
}

function historicalReplayProgress(): Record<string, unknown> {
  return {
    mode: "paper_only",
    status: "running",
    startedAt: "2026-06-11T09:00:00+09:00",
    updatedAt: "2025-01-02T00:01:00.000Z",
    completedAt: null,
    failedAt: null,
    simulatedAt: "2025-01-02T00:01:00.000Z",
    tickIndex: 1,
    completedTickCount: 2,
    tickCount: 3,
    packetCount: 2,
    decisionProviderCallCount: 2,
    decisionSkippedCount: 0,
    decisionRecordCount: 2,
    tradeCount: 1,
    riskDecisionCount: 2,
    riskApprovedCount: 1,
    rejectedCount: 1,
    currentPortfolio: {
      simulatedAt: "2025-01-02T00:01:00.000Z",
      cashKrw: 930_000,
      positionCount: 1,
      positionMarketValueKrw: 70_000,
      virtualNetWorthKrw: 1_000_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          quantity: 1,
          averagePriceKrw: 70_000,
          marketValueKrw: 70_000,
          unrealizedPnlKrw: 0,
          updatedAt: "2025-01-02T00:01:00.000Z"
        }
      ]
    },
    portfolioTimeline: [
      {
        simulatedAt: "2025-01-02T00:00:00.000Z",
        cashKrw: 1_000_000,
        positionCount: 0,
        positionMarketValueKrw: 0,
        virtualNetWorthKrw: 1_000_000,
        positions: []
      },
      {
        simulatedAt: "2025-01-02T00:01:00.000Z",
        cashKrw: 930_000,
        positionCount: 1,
        positionMarketValueKrw: 70_000,
        virtualNetWorthKrw: 1_000_000,
        positions: [
          {
            market: "KR",
            symbol: "005930",
            quantity: 1,
            averagePriceKrw: 70_000,
            marketValueKrw: 70_000,
            unrealizedPnlKrw: 0,
            updatedAt: "2025-01-02T00:01:00.000Z"
          }
        ]
      }
    ],
    recentEvents: [
      {
        eventId: "replay_event_1_2_packet_api_001_005930_risk_rejected",
        eventType: "RISK_REJECTED",
        simulatedAt: "2025-01-02T00:01:00.000Z",
        tickIndex: 1,
        packetId: "packet_api_001",
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        approved: false,
        rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
        summary: "KR:005930 VIRTUAL_BUY rejected account 1234-5678-901234 order ord_abcdef123456"
      }
    ],
    recentPackets: [marketPacket()],
    recentDecisions: [decision()],
    recentRiskDecisions: [
      {
        riskDecisionId: "risk_api_002",
        packetId: "packet_api_001",
        symbol: "005930",
        approved: false,
        rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
        checkedRules: ["cash_available"],
        createdAt: "2025-01-02T00:01:00.000Z"
      },
      {
        riskDecisionId: "risk_api_001",
        packetId: "packet_api_001",
        symbol: "005930",
        approved: true,
        rejectCodes: [],
        checkedRules: ["cash_available"],
        createdAt: "2025-01-02T00:00:00.000Z"
      }
    ],
    recentTrades: [trade()],
    finalReportPath: null,
    error: null,
    disclaimer:
      "Paper-only historical replay progress. This is not financial advice, not a performance guarantee, and cannot place live orders."
  };
}
