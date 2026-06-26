import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
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
import type { LocalOperationsServerOptions } from "./localOperationsServer.js";
import {
  PAPER_SIMULATION_CREATE_OPERATION,
  PAPER_SIMULATION_MUTATION_HEADER_NAME,
  type PaperSimulationRunner,
  type PaperSimulationRunnerInput,
  type PaperSimulationRunnerResult
} from "./paperSimulationRuns.js";
import {
  PAPER_POLICY_VALIDATION_HEADER_NAME,
  PAPER_POLICY_VALIDATION_OPERATION
} from "./paperPolicyValidation.js";
import {
  STRATEGY_BUCKET_TEST_VALIDATION_HEADER_NAME,
  STRATEGY_BUCKET_TEST_VALIDATION_OPERATION,
  STRATEGY_BUCKET_TEST_VALIDATION_ROUTE
} from "./strategyBucketTestValidation.js";
import {
  STRATEGY_BUCKET_TEST_CREATE_HEADER_NAME,
  STRATEGY_BUCKET_TEST_CREATE_OPERATION,
  STRATEGY_BUCKET_TEST_CREATE_ROUTE
} from "./strategyBucketTestRuns.js";
import {
  LOCAL_OPERATIONS_API_ROUTES,
  PAPER_POLICY_VALIDATION_API_ROUTES,
  PAPER_POLICY_VALIDATION_METHODS,
  PAPER_SIMULATION_MUTATION_API_ROUTES,
  PAPER_SIMULATION_MUTATION_METHODS,
  READ_ONLY_HTTP_METHODS,
  STRATEGY_BUCKET_TEST_VALIDATION_API_ROUTES,
  STRATEGY_BUCKET_TEST_VALIDATION_METHODS,
  STRATEGY_BUCKET_TEST_MUTATION_API_ROUTES,
  STRATEGY_BUCKET_TEST_MUTATION_METHODS
} from "./localOperationsSurface.js";

const now = new Date("2026-06-11T09:00:00+09:00");

async function createTempStorageBaseDir(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "toss-trading-api-test-"));
  const storageBaseDir = join(parent, "paper");
  await mkdir(storageBaseDir, { recursive: true });
  return storageBaseDir;
}

async function startTestServer(
  storageBaseDir: string,
  options: Partial<Omit<LocalOperationsServerOptions, "storageBaseDir">> = {}
): Promise<{ server: Server; baseUrl: string }> {
  const server = createLocalOperationsServer({
    storageBaseDir,
    now: () => now,
    ...options
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

class FakeDashboardElement {
  readonly tagName: string;
  className = "";
  textContent = "";
  hidden = false;
  colSpan = 0;
  style: Record<string, string> = {};
  readonly children: FakeDashboardElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  append(...children: FakeDashboardElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeDashboardElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
}

class FakeDashboardDocument {
  private readonly elements = new Map<string, FakeDashboardElement>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.elements.set(id, new FakeDashboardElement("div"));
    }
  }

  getElementById(id: string): FakeDashboardElement | null {
    return this.elements.get(id) ?? null;
  }

  requiredElement(id: string): FakeDashboardElement {
    const element = this.getElementById(id);
    assert.ok(element, `missing fake dashboard element: ${id}`);
    return element;
  }

  createElement(tagName: string): FakeDashboardElement {
    return new FakeDashboardElement(tagName);
  }
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

async function readJsonlRecords(
  filePath: string
): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

test("local operations surface keeps live mutations disabled", () => {
  assert.deepEqual([...READ_ONLY_HTTP_METHODS], ["GET", "HEAD"]);
  assert.deepEqual([...PAPER_SIMULATION_MUTATION_METHODS], ["POST"]);
  assert.deepEqual([...PAPER_SIMULATION_MUTATION_API_ROUTES], [
    "/paper/simulations"
  ]);
  assert.deepEqual([...PAPER_POLICY_VALIDATION_METHODS], ["POST"]);
  assert.deepEqual([...PAPER_POLICY_VALIDATION_API_ROUTES], [
    "/paper/policies/validate"
  ]);
  assert.deepEqual([...STRATEGY_BUCKET_TEST_VALIDATION_METHODS], ["POST"]);
  assert.deepEqual([...STRATEGY_BUCKET_TEST_VALIDATION_API_ROUTES], [
    STRATEGY_BUCKET_TEST_VALIDATION_ROUTE
  ]);
  assert.deepEqual([...STRATEGY_BUCKET_TEST_MUTATION_METHODS], ["POST"]);
  assert.deepEqual([...STRATEGY_BUCKET_TEST_MUTATION_API_ROUTES], [
    STRATEGY_BUCKET_TEST_CREATE_ROUTE
  ]);
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
  assert.equal(
    (PAPER_SIMULATION_MUTATION_API_ROUTES as readonly string[]).includes(
      "/place_order"
    ),
    false
  );
  assert.equal(
    (PAPER_POLICY_VALIDATION_API_ROUTES as readonly string[]).includes(
      "/place_order"
    ),
    false
  );
  assert.equal(
    (STRATEGY_BUCKET_TEST_VALIDATION_API_ROUTES as readonly string[]).includes(
      "/place_order"
    ),
    false
  );
  assert.equal(
    (STRATEGY_BUCKET_TEST_MUTATION_API_ROUTES as readonly string[]).includes(
      "/place_order"
    ),
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
        "/dashboard/currentSimulationData.js",
        "/dashboard/batchRunRenderers.js",
        "/dashboard/dashboardStatusRenderers.js",
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
        "/dashboard/simulationForm.js",
        "/dashboard/sourceRenderers.js",
        "/dashboard/state.js",
        "/dashboard/tableRenderers.js"
      ].map((path) => fetchText(baseUrl, path))
    );
    const rootScript = await fetchText(baseUrl, "/app.js");
    const rootModuleScript = await fetchText(baseUrl, "/apiClient.js");
    const rootCurrentSimulationDataScript = await fetchText(
      baseUrl,
      "/currentSimulationData.js"
    );
    const rootBatchRunRenderersScript = await fetchText(
      baseUrl,
      "/batchRunRenderers.js"
    );
    const rootDashboardStatusRenderersScript = await fetchText(
      baseUrl,
      "/dashboardStatusRenderers.js"
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
    const rootSimulationFormScript = await fetchText(
      baseUrl,
      "/simulationForm.js"
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
    const virtualPage = await fetchText(baseUrl, "/dashboard/virtual");
    const newSimulationPage = await fetchText(
      baseUrl,
      "/dashboard/virtual/simulations/new"
    );
    const historyPage = await fetchText(baseUrl, "/dashboard/virtual/simulations");
    const activeSimulationPage = await fetchText(
      baseUrl,
      "/dashboard/virtual/simulations/current"
    );
    const validationPage = await fetchText(
      baseUrl,
      "/dashboard/virtual/validation"
    );
    const replayPage = await fetchText(baseUrl, "/dashboard/virtual-replays");
    const summaryPage = await fetchText(baseUrl, "/dashboard/batch-summary");
    const dashboardScriptText = [
      script.text,
      ...moduleScripts.map((moduleScript) => moduleScript.text)
    ].join("\n");

    assert.equal(html.response.status, 200);
    assert.match(html.response.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(virtualPage.response.status, 200);
    assert.equal(newSimulationPage.response.status, 200);
    assert.equal(historyPage.response.status, 200);
    assert.equal(activeSimulationPage.response.status, 200);
    assert.equal(validationPage.response.status, 200);
    assert.equal(replayPage.response.status, 200);
    assert.equal(summaryPage.response.status, 200);
    assert.equal(rootScript.response.status, 200);
    assert.equal(rootModuleScript.response.status, 200);
    assert.equal(rootCurrentSimulationDataScript.response.status, 200);
    assert.equal(rootBatchRunRenderersScript.response.status, 200);
    assert.equal(rootDashboardStatusRenderersScript.response.status, 200);
    assert.equal(rootDecisionRenderersScript.response.status, 200);
    assert.equal(rootPortfolioModelScript.response.status, 200);
    assert.equal(rootPortfolioRenderersScript.response.status, 200);
    assert.equal(rootReportRenderersScript.response.status, 200);
    assert.equal(rootReplayProgressRenderersScript.response.status, 200);
    assert.equal(rootReplayProgressCoordinatorScript.response.status, 200);
    assert.equal(rootReportViewHelpersScript.response.status, 200);
    assert.equal(rootSimulationFormScript.response.status, 200);
    assert.equal(rootSourceRenderersScript.response.status, 200);
    assert.equal(rootTableRenderersScript.response.status, 200);
    assert.equal(rootStyles.response.status, 200);
    assert.equal(
      rootStyles.text.includes(
        'html:not([data-dashboard-page="virtual"]) .metric-grid'
      ),
      true
    );
    assert.equal(
      rootStyles.text.includes(
        'html[data-dashboard-page="validation"]'
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
    assert.match(html.text, /Toss Trading Ops/);
    assert.match(html.text, /document\.documentElement\.dataset\.dashboardPage/);
    assert.match(html.text, /href="\/dashboard\/styles.css"/);
    assert.match(html.text, /src="\/dashboard\/app.js"/);
    assert.match(html.text, /data-dashboard-route="live"/);
    assert.match(html.text, /data-dashboard-route="virtual"/);
    assert.match(html.text, /data-dashboard-route="new-simulation"/);
    assert.match(html.text, /data-dashboard-route="active-simulation"/);
    assert.match(html.text, /data-dashboard-route="history"/);
    assert.match(html.text, /data-dashboard-route="validation"/);
    assert.match(
      html.text,
      /class="panel full batch-run-panel" data-dashboard-page="virtual active-simulation history"/
    );
    assert.match(
      html.text,
      /class="panel full performance-panel" aria-labelledby="performance-heading"/
    );
    assert.match(
      html.text,
      /class="panel full benchmark-panel" data-dashboard-page="virtual validation"/
    );
    assert.match(
      html.text,
      /class="panel full report-panel" aria-labelledby="daily-report-heading"/
    );
    assert.match(html.text, /class="panel" data-dashboard-page="virtual validation"/);
    assert.match(html.text, /id="live-status-heading"/);
    assert.match(html.text, /id="simulation-home-heading"/);
    assert.match(html.text, /id="current-simulation-heading"/);
    assert.match(html.text, /id="new-simulation-heading"/);
    assert.match(html.text, /id="simulation-config-preview"/);
    assert.match(html.text, /id="simulation-history-heading"/);
    assert.match(html.text, /id="validation-center-heading"/);
    assert.match(html.text, /id="research-report-heading"/);
    assert.match(html.text, /id="research-report-status"/);
    assert.match(html.text, /id="research-pbo-score"/);
    assert.match(html.text, /id="research-warning-list"/);
    assert.match(html.text, /id="research-regime-list"/);
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
    assert.match(html.text, /aria-label="종목 필터"/);
    assert.match(html.text, /rel="icon" href="data:,"/);
    assert.match(html.text, /id="decision-performance-list"/);
    assert.match(html.text, /id="decision-performance-average"/);
    assert.match(html.text, /id="portfolio-risk-status"/);
    assert.match(html.text, /id="portfolio-risk-detail"/);
    assert.equal(script.response.status, 200);
    assert.match(script.text, /from "\.\/apiClient\.js"/);
    assert.match(script.text, /from "\.\/currentSimulationData\.js"/);
    assert.match(script.text, /from "\.\/batchRunRenderers\.js"/);
    assert.match(script.text, /from "\.\/dashboardStatusRenderers\.js"/);
    assert.match(script.text, /from "\.\/decisionRenderers\.js"/);
    assert.match(dashboardScriptText, /from "\.\/dom\.js"/);
    assert.match(dashboardScriptText, /from "\.\/formatters\.js"/);
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
    assert.match(script.text, /from "\.\/simulationForm\.js"/);
    assert.match(script.text, /from "\.\/sourceRenderers\.js"/);
    assert.match(script.text, /from "\.\/state\.js"/);
    assert.match(script.text, /from "\.\/tableRenderers\.js"/);
    assert.match(dashboardScriptText, /고려아연/);
    assert.match(dashboardScriptText, /카카오게임즈/);
    assert.match(dashboardScriptText, /United States Natural Gas Fund/);
    assert.match(dashboardScriptText, /\/virtual\/portfolio/);
    assert.match(dashboardScriptText, /\/paper\/report/);
    assert.match(dashboardScriptText, /\/replay\/report/);
    assert.match(dashboardScriptText, /\/replay\/progress/);
    assert.match(dashboardScriptText, /\/research\/replay\/report/);
    assert.match(dashboardScriptText, /\/batch\/replay\/report/);
    assert.match(dashboardScriptText, /\/batch\/replay\/runs/);
    assert.match(dashboardScriptText, /includeLatestRunArtifacts=1/);
    assert.match(dashboardScriptText, /\/audit\/events/);
    for (const routePath of LOCAL_OPERATIONS_API_ROUTES) {
      assert.equal(dashboardScriptText.includes(routePath), true, routePath);
    }
    assert.match(dashboardScriptText, /fetchEndpointData/);
    assert.match(dashboardScriptText, /currentSimulationDashboardData/);
    assert.match(dashboardScriptText, /endpointFailures/);
    assert.match(dashboardScriptText, /applyDashboardRoute/);
    assert.match(dashboardScriptText, /dataset\.dashboardPage = page/);
    assert.match(dashboardScriptText, /showFileModeNotice/);
    assert.match(script.text, /renderDashboardMetrics/);
    assert.match(script.text, /showDashboardLoadingStatus/);
    assert.match(script.text, /showDashboardEndpointResult/);
    assert.match(dashboardScriptText, /export function renderDashboardMetrics/);
    assert.match(dashboardScriptText, /export function showDashboardLoadingStatus/);
    assert.match(dashboardScriptText, /export function showDashboardEndpointResult/);
    assert.match(script.text, /renderDailyReport/);
    assert.match(script.text, /renderReplayReport/);
    assert.match(script.text, /renderReplayResearchReport/);
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
    assert.match(dashboardScriptText, /export function bindSimulationFormControls/);
    assert.match(dashboardScriptText, /simulationConfigFromForm/);
    assert.match(dashboardScriptText, /renderReplayTimeline/);
    assert.match(dashboardScriptText, /export function renderReplayResearchReport/);
    assert.match(dashboardScriptText, /renderResearchWarningList/);
    assert.match(dashboardScriptText, /researchReportWarnings/);
    assert.match(dashboardScriptText, /validationProtocol\?\.warnings/);
    assert.match(dashboardScriptText, /overfittingWarning\?\.warnings/);
    assert.match(dashboardScriptText, /renderResearchRegimeList/);
    assert.match(script.text, /bindDecisionFilterControls/);
    assert.match(dashboardScriptText, /export function bindDecisionFilterControls/);
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
    assert.doesNotMatch(script.text, /function renderDashboardMetrics/);
    assert.doesNotMatch(script.text, /function showDashboardLoadingStatus/);
    assert.doesNotMatch(script.text, /function showDashboardEndpointResult/);
    assert.doesNotMatch(script.text, /data-action-filter/);
    assert.doesNotMatch(script.text, /symbol-filter/);
    assert.match(dashboardScriptText, /\/paper\/simulations/);
    assert.match(dashboardScriptText, /paper-simulation-create/);
    assert.doesNotMatch(dashboardScriptText, /\bPUT\b|\bPATCH\b|\bDELETE\b/);
    assert.doesNotMatch(
      dashboardScriptText,
      /\bplace_order\b|\brun_codex_exec\b|\brun_tossctl\b/
    );
  } finally {
    await stopTestServer(server);
  }
});

test("research report renderer includes nested validation warnings in count and list", async () => {
  const fakeDocument = new FakeDashboardDocument([
    "research-report-status",
    "research-run-count",
    "research-validation-protocol",
    "research-pbo-score",
    "research-provider-failures",
    "research-risk-rejects",
    "research-warning-count",
    "research-report-disclaimer",
    "research-report-detail",
    "research-warning-list-count",
    "research-warning-list",
    "research-regime-count",
    "research-regime-list"
  ]);
  const globals = globalThis as typeof globalThis & {
    document?: Document;
  };
  const previousDocument = globals.document;
  globals.document = fakeDocument as unknown as Document;

  try {
    const moduleUrl = pathToFileURL(
      join(process.cwd(), "dashboard", "reportRenderers.js")
    ).href;
    const { renderReplayResearchReport } = await import(moduleUrl);

    renderReplayResearchReport({
      status: "ok",
      report: {
        warnings: ["top level warning"],
        validationProtocol: {
          validationProtocol: "sampled_cpcv_pbo_like",
          warnings: [
            "validation warning",
            "top level warning",
            "",
            42
          ]
        },
        overfittingWarning: {
          pboLikeScore: 0.5,
          warnings: ["pbo warning", "validation warning"]
        },
        runIdentity: {
          runCount: 2,
          completedCount: 2,
          skippedCount: 0,
          failedCount: 0,
          returnSampleCount: 2
        },
        providerFailureSummary: {
          totalAiDecisionFailureCount: 0
        },
        riskRejectSummary: {
          totalRejectedCount: 1
        },
        regimeBreakdown: []
      }
    });

    assert.equal(
      fakeDocument.requiredElement("research-warning-count").textContent,
      "3개"
    );
    assert.equal(
      fakeDocument.requiredElement("research-warning-list-count").textContent,
      "3개"
    );
    assert.deepEqual(
      fakeDocument
        .requiredElement("research-warning-list")
        .children.map((child) => child.textContent),
      ["top level warning", "validation warning", "pbo warning"]
    );
  } finally {
    if (previousDocument === undefined) {
      delete globals.document;
    } else {
      globals.document = previousDocument;
    }
  }
});

test("paper policy validation checks drafts without starting a runner", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const valid = await fetchJson(baseUrl, "/paper/policies/validate", {
      method: "POST",
      headers: paperPolicyValidationHeaders(baseUrl),
      body: JSON.stringify(policyCandidate())
    });
    const invalidCandidate = policyCandidate();
    invalidCandidate.strategyBuckets[0]!.minWeightRatio = -0.1;
    const invalid = await fetchJson(baseUrl, "/paper/policies/validate", {
      method: "POST",
      headers: paperPolicyValidationHeaders(baseUrl),
      body: JSON.stringify(invalidCandidate)
    });
    const missingHeader = await fetchJson(baseUrl, "/paper/policies/validate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl
      },
      body: JSON.stringify(policyCandidate())
    });
    const badOrigin = await fetchJson(baseUrl, "/paper/policies/validate", {
      method: "POST",
      headers: {
        ...paperPolicyValidationHeaders(baseUrl),
        origin: "http://evil.example"
      },
      body: JSON.stringify(policyCandidate())
    });

    assert.equal(valid.response.status, 200);
    assert.equal(valid.payload["mode"], "paper_only");
    assert.equal(valid.payload["validation"], "paper_policy");
    assert.equal(valid.payload["readOnly"], true);
    assert.equal(valid.payload["storageMutationEnabled"], false);
    assert.equal(valid.payload["liveTradingEnabled"], false);
    assert.equal(valid.payload["orderPlacementEnabled"], false);
    assert.equal(valid.payload["status"], "valid");
    assert.equal(valid.payload["validatedForPaperSimulationConfig"], true);

    assert.equal(invalid.response.status, 200);
    assert.equal(invalid.payload["status"], "invalid");
    assert.equal(invalid.payload["validatedForPaperSimulationConfig"], false);
    assert.match(
      JSON.stringify(invalid.payload["issues"]),
      /BUCKET_MIN_WEIGHT_OUT_OF_RANGE/
    );

    assert.equal(missingHeader.response.status, 403);
    assert.equal(missingHeader.payload["error"], "validation_guard_required");
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.payload["error"], "origin_not_allowed");
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test validation checks configs without starting a runner", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const valid = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(strategyBucketTestCandidate())
      }
    );
    const retryCandidate = strategyBucketTestCandidate();
    retryCandidate.requestId = "strategy-bucket-test-validation-retry-002";
    const sameConfigRetry = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(retryCandidate)
      }
    );
    const reorderedCandidate = strategyBucketTestCandidate();
    reorderedCandidate.policy = reverseObjectKeys(
      reorderedCandidate.policy
    ) as PolicyCandidate;
    reorderedCandidate.testConfig = reverseObjectKeys(
      reorderedCandidate.testConfig
    ) as StrategyBucketTestCandidate["testConfig"];
    const reorderedConfig = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(reorderedCandidate)
      }
    );
    const validTimestampCandidate = strategyBucketTestCandidate();
    validTimestampCandidate.testConfig.window.startAt =
      "2024-01-01T00:00:00+09:00";
    validTimestampCandidate.testConfig.window.endAt =
      "2024-02-01T23:59:59.999+09:00";
    const validTimestampConfig = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(validTimestampCandidate)
      }
    );
    const invalidDateCandidate = strategyBucketTestCandidate();
    invalidDateCandidate.testConfig.window.startAt = "2024-02-31";
    const invalidRolloverDate = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(invalidDateCandidate)
      }
    );
    const invalidTimestampCandidate = strategyBucketTestCandidate();
    invalidTimestampCandidate.testConfig.window.startAt =
      "2024-02-31T00:00:00Z";
    const invalidRolloverTimestamp = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(invalidTimestampCandidate)
      }
    );
    const nonIsoRolloverCandidate = strategyBucketTestCandidate();
    nonIsoRolloverCandidate.testConfig.window.startAt = "2024/02/31";
    nonIsoRolloverCandidate.testConfig.window.endAt = "February 31, 2024";
    const invalidNonIsoRolloverDate = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(nonIsoRolloverCandidate)
      }
    );
    const invalidCandidate = strategyBucketTestCandidate({
      bucket: "short_term"
    });
    const disabledBucketPolicy = invalidCandidate.policy.strategyBuckets.find(
      (bucket) => bucket.bucket === "short_term"
    );
    assert.ok(disabledBucketPolicy);
    disabledBucketPolicy.targetWeightRatio = 0;
    const invalid = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(invalidCandidate)
      }
    );
    const missingHeader = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl
        },
        body: JSON.stringify(strategyBucketTestCandidate())
      }
    );
    const badOrigin = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: {
          ...strategyBucketTestValidationHeaders(baseUrl),
          origin: "http://evil.example"
        },
        body: JSON.stringify(strategyBucketTestCandidate())
      }
    );

    assert.equal(valid.response.status, 200);
    assert.equal(valid.payload["mode"], "paper_only");
    assert.equal(valid.payload["validation"], "strategy_bucket_test");
    assert.equal(valid.payload["readOnly"], true);
    assert.equal(valid.payload["storageMutationEnabled"], false);
    assert.equal(valid.payload["liveTradingEnabled"], false);
    assert.equal(valid.payload["orderPlacementEnabled"], false);
    assert.equal(valid.payload["replayRunnerStarted"], false);
    assert.equal(valid.payload["status"], "valid");
    assert.equal(valid.payload["validatedForStrategyBucketTestConfig"], true);
    assert.equal(valid.payload["bucket"], "long_term");
    assert.match(String(valid.payload["configHash"]), /^sha256:[a-f0-9]{64}$/);
    assert.equal(sameConfigRetry.response.status, 200);
    assert.equal(
      sameConfigRetry.payload["configHash"],
      valid.payload["configHash"]
    );
    assert.equal(reorderedConfig.response.status, 200);
    assert.equal(
      reorderedConfig.payload["configHash"],
      valid.payload["configHash"]
    );
    assert.equal(validTimestampConfig.response.status, 200);
    assert.equal(validTimestampConfig.payload["status"], "valid");

    assert.equal(invalidRolloverDate.response.status, 200);
    assert.equal(invalidRolloverDate.payload["status"], "invalid");
    assert.equal(
      invalidRolloverDate.payload["validatedForStrategyBucketTestConfig"],
      false
    );
    assert.match(
      JSON.stringify(invalidRolloverDate.payload["issues"]),
      /INVALID_WINDOW_DATE/
    );
    assert.equal(invalidRolloverTimestamp.response.status, 200);
    assert.equal(invalidRolloverTimestamp.payload["status"], "invalid");
    assert.match(
      JSON.stringify(invalidRolloverTimestamp.payload["issues"]),
      /INVALID_WINDOW_DATE/
    );
    assert.equal(invalidNonIsoRolloverDate.response.status, 200);
    assert.equal(invalidNonIsoRolloverDate.payload["status"], "invalid");
    assert.match(
      JSON.stringify(invalidNonIsoRolloverDate.payload["issues"]),
      /INVALID_WINDOW_DATE/
    );

    assert.equal(invalid.response.status, 200);
    assert.equal(invalid.payload["status"], "invalid");
    assert.equal(
      invalid.payload["validatedForStrategyBucketTestConfig"],
      false
    );
    assert.equal(invalid.payload["replayRunnerStarted"], false);
    assert.match(JSON.stringify(invalid.payload["issues"]), /BUCKET_DISABLED/);

    assert.equal(missingHeader.response.status, 403);
    assert.equal(missingHeader.payload["error"], "validation_guard_required");
    assert.equal(missingHeader.payload["replayRunnerStarted"], false);
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.payload["error"], "origin_not_allowed");
    assert.equal(badOrigin.payload["replayRunnerStarted"], false);
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test validation keeps Codex provider disabled until env explicitly allows it", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    env: {
      AI_DECISION_MODE: "paper_only",
      AI_DECISION_ENABLED: "false"
    },
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(
          strategyBucketTestCandidate({
            aiProvider: "codex_paper_only",
            maxCodexCallsPerRun: 3
          })
        )
      }
    );

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["status"], "invalid");
    assert.equal(result.payload["validatedForStrategyBucketTestConfig"], false);
    assert.match(
      JSON.stringify(result.payload["issues"]),
      /CODEX_PROVIDER_DISABLED/
    );
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test validation accepts enabled Codex paper-only boundary", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    env: {
      AI_DECISION_MODE: "paper_only",
      AI_DECISION_ENABLED: "true"
    },
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_VALIDATION_ROUTE,
      {
        method: "POST",
        headers: strategyBucketTestValidationHeaders(baseUrl),
        body: JSON.stringify(
          strategyBucketTestCandidate({
            aiProvider: "codex_paper_only",
            maxCodexCallsPerRun: 3
          })
        )
      }
    );

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["status"], "valid");
    assert.equal(result.payload["validatedForStrategyBucketTestConfig"], true);
    assert.equal(result.payload["replayRunnerStarted"], false);
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test create writes a queued record without starting a runner", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(baseUrl, STRATEGY_BUCKET_TEST_CREATE_ROUTE, {
      method: "POST",
      headers: strategyBucketTestCreateHeaders(baseUrl),
      body: JSON.stringify(strategyBucketTestCandidate())
    });
    const records = await readJsonlRecords(paths.strategyBucketTestRecordsPath);
    const auditEvents = await readJsonlRecords(paths.auditLogPath);
    const strategyTestLab = await fetchJson(
      baseUrl,
      "/dashboard/view-model/strategy-test-lab"
    );
    const progressDetail = await fetchJson(
      baseUrl,
      `/dashboard/view-model/strategy-test-lab/tests/${encodeURIComponent(
        String(result.payload["testId"])
      )}/progress`
    );
    const missingProgressDetail = await fetchJson(
      baseUrl,
      "/dashboard/view-model/strategy-test-lab/tests/missing-test/progress"
    );
    const progressDetailMutation = await fetch(
      `${baseUrl}/dashboard/view-model/strategy-test-lab/tests/${encodeURIComponent(
        String(result.payload["testId"])
      )}/progress`,
      { method: "POST" }
    );
    const progressDetailMutationPayload =
      (await progressDetailMutation.json()) as Record<string, unknown>;
    const record = records[0];
    const progress = record?.["progress"] as Record<string, unknown> | undefined;
    const heartbeat = record?.["heartbeat"] as
      | Record<string, unknown>
      | undefined;
    const safety = record?.["safety"] as Record<string, unknown> | undefined;
    const activeTests = strategyTestLab.payload["activeTests"] as Array<
      Record<string, unknown>
    >;
    const activeProgress = activeTests[0]?.["progress"] as
      | Record<string, unknown>
      | undefined;
    const activeHeartbeat = activeTests[0]?.["heartbeat"] as
      | Record<string, unknown>
      | undefined;
    const sourceStatus = strategyTestLab.payload["sourceStatus"] as Record<
      string,
      unknown
    >;
    const progressDetailTest = progressDetail.payload["test"] as
      | Record<string, unknown>
      | null;
    const progressDetailProgress = progressDetailTest?.["progress"] as
      | Record<string, unknown>
      | undefined;
    const progressDetailHeartbeat = progressDetailTest?.["heartbeat"] as
      | Record<string, unknown>
      | undefined;
    const progressDetailSourceStatus = progressDetail.payload[
      "sourceStatus"
    ] as Record<string, unknown>;

    assert.equal(result.response.status, 202);
    assert.equal(result.payload["mode"], "paper_only");
    assert.equal(result.payload["mutation"], "strategy_bucket_test_create");
    assert.equal(result.payload["status"], "queued");
    assert.equal(result.payload["bucket"], "long_term");
    assert.equal(result.payload["storageMutationEnabled"], true);
    assert.equal(result.payload["liveTradingEnabled"], false);
    assert.equal(result.payload["orderPlacementEnabled"], false);
    assert.equal(result.payload["replayRunnerStarted"], false);
    assert.match(String(result.payload["configHash"]), /^sha256:[a-f0-9]{64}$/);
    assert.equal("progressUrl" in result.payload, false);
    assert.equal(records.length, 1);
    assert.equal(record?.["mode"], "paper_only");
    assert.equal(record?.["recordType"], "strategy_bucket_test_record");
    assert.equal(record?.["testId"], result.payload["testId"]);
    assert.equal(record?.["requestId"], "strategy-bucket-test-validation-001");
    assert.equal(record?.["status"], "queued");
    assert.equal(record?.["runId"], null);
    assert.equal(record?.["configHash"], result.payload["configHash"]);
    assert.equal(record?.["policyId"], "local-draft");
    assert.equal(record?.["validationSplitRole"], "validation");
    assert.equal(record?.["decisionProviderMode"], "dry_run_fixture");
    assert.equal(progress?.["phase"], "queued");
    assert.equal(progress?.["completedPacketCount"], 0);
    assert.equal(progress?.["decisionCount"], 0);
    assert.equal(progress?.["simulatedTradeCount"], 0);
    assert.equal(progress?.["latestAuditEventRef"], auditEvents[0]?.["eventId"]);
    assert.equal(heartbeat?.["status"], "fresh");
    assert.equal(safety?.["storageMutationEnabled"], true);
    assert.equal(safety?.["liveTradingEnabled"], false);
    assert.equal(safety?.["orderPlacementEnabled"], false);
    assert.equal(safety?.["replayRunnerStarted"], false);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0]?.["eventType"], "STRATEGY_BUCKET_TEST_QUEUED");
    assert.match(
      String(auditEvents[0]?.["summary"]),
      /replay runner not started/
    );
    assert.equal(strategyTestLab.response.status, 200);
    assert.equal(activeTests.length, 1);
    assert.equal(activeTests[0]?.["testId"], result.payload["testId"]);
    assert.equal(activeTests[0]?.["bucket"], "long_term");
    assert.equal(activeTests[0]?.["status"], "queued");
    assert.equal(activeTests[0]?.["runId"], null);
    assert.equal(activeTests[0]?.["configHash"], result.payload["configHash"]);
    assert.equal(activeProgress?.["phase"], "queued");
    assert.equal(activeProgress?.["decisionCount"], 0);
    assert.equal(activeProgress?.["riskRejectedCount"], 0);
    assert.equal(activeHeartbeat?.["status"], "fresh");
    assert.equal(sourceStatus["strategyBucketTestRecords"], "ok");
    assert.equal(progressDetail.response.status, 200);
    assert.equal(progressDetail.payload["mode"], "paper_only");
    assert.equal(progressDetail.payload["readOnly"], true);
    assert.equal(progressDetail.payload["viewModel"], "strategy-test-progress");
    assert.equal(progressDetail.payload["testId"], result.payload["testId"]);
    assert.equal(progressDetail.payload["status"], "ok");
    assert.equal(progressDetail.payload["storageMutationEnabled"], false);
    assert.equal(progressDetail.payload["liveTradingEnabled"], false);
    assert.equal(progressDetail.payload["orderPlacementEnabled"], false);
    assert.equal(progressDetail.payload["replayRunnerStarted"], false);
    assert.equal(progressDetailTest?.["testId"], result.payload["testId"]);
    assert.equal(progressDetailTest?.["status"], "queued");
    assert.equal(progressDetailProgress?.["phase"], "queued");
    assert.equal(progressDetailProgress?.["decisionCount"], 0);
    assert.equal(progressDetailHeartbeat?.["status"], "fresh");
    assert.equal(progressDetailSourceStatus["strategyBucketTestRecords"], "ok");
    assert.equal(missingProgressDetail.response.status, 200);
    assert.equal(missingProgressDetail.payload["status"], "missing");
    assert.equal(missingProgressDetail.payload["test"], null);
    assert.equal(progressDetailMutation.status, 405);
    assert.equal(progressDetailMutationPayload["readOnly"], true);
    assert.equal(progressDetailMutationPayload["error"], "method_not_allowed");
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test lab ViewModel recomputes stale heartbeat status", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, STRATEGY_BUCKET_TEST_CREATE_ROUTE, {
      method: "POST",
      headers: strategyBucketTestCreateHeaders(baseUrl),
      body: JSON.stringify(strategyBucketTestCandidate())
    });
    const records = await readJsonlRecords(paths.strategyBucketTestRecordsPath);
    const record = records[0];
    assert.ok(record);
    const heartbeat = record["heartbeat"] as Record<string, unknown>;
    heartbeat["status"] = "fresh";
    heartbeat["lastSeenAt"] = new Date(
      now.getTime() - 121_000
    ).toISOString();
    heartbeat["staleAfterSeconds"] = 120;
    await writeFile(
      paths.strategyBucketTestRecordsPath,
      `${JSON.stringify(record)}\n`,
      "utf8"
    );

    const strategyTestLab = await fetchJson(
      baseUrl,
      "/dashboard/view-model/strategy-test-lab"
    );
    const activeTests = strategyTestLab.payload["activeTests"] as Array<
      Record<string, unknown>
    >;
    const activeHeartbeat = activeTests[0]?.["heartbeat"] as
      | Record<string, unknown>
      | undefined;

    assert.equal(result.response.status, 202);
    assert.equal(activeTests.length, 1);
    assert.equal(activeTests[0]?.["testId"], result.payload["testId"]);
    assert.equal(activeHeartbeat?.["status"], "stale");
    assert.equal(activeHeartbeat?.["lastSeenAt"], heartbeat["lastSeenAt"]);
    assert.equal(activeHeartbeat?.["staleAfterSeconds"], 120);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test lab ViewModel removes terminal latest records from active tests", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, STRATEGY_BUCKET_TEST_CREATE_ROUTE, {
      method: "POST",
      headers: strategyBucketTestCreateHeaders(baseUrl),
      body: JSON.stringify(strategyBucketTestCandidate())
    });
    const records = await readJsonlRecords(paths.strategyBucketTestRecordsPath);
    const queuedRecord = records[0];
    assert.ok(queuedRecord);
    const completedAt = new Date(now.getTime() + 60_000).toISOString();
    const queuedProgress = queuedRecord["progress"] as Record<string, unknown>;
    const queuedHeartbeat = queuedRecord["heartbeat"] as Record<string, unknown>;
    const completedRecord = {
      ...queuedRecord,
      status: "completed",
      completedAt,
      progress: {
        ...queuedProgress,
        phase: "completed",
        progressRatio: 1,
        completedPacketCount: 1,
        totalPacketCount: 1,
        latestMessage: "completed",
        updatedAt: completedAt
      },
      heartbeat: {
        ...queuedHeartbeat,
        lastSeenAt: completedAt
      }
    };
    await writeFile(
      paths.strategyBucketTestRecordsPath,
      `${JSON.stringify(queuedRecord)}\n${JSON.stringify(completedRecord)}\n`,
      "utf8"
    );

    const strategyTestLab = await fetchJson(
      baseUrl,
      "/dashboard/view-model/strategy-test-lab"
    );
    const progressDetail = await fetchJson(
      baseUrl,
      `/dashboard/view-model/strategy-test-lab/tests/${encodeURIComponent(
        String(result.payload["testId"])
      )}/progress`
    );
    const activeTests = strategyTestLab.payload["activeTests"] as Array<
      Record<string, unknown>
    >;
    const progressDetailTest = progressDetail.payload["test"] as
      | Record<string, unknown>
      | null;
    const progressDetailProgress = progressDetailTest?.["progress"] as
      | Record<string, unknown>
      | undefined;

    assert.equal(result.response.status, 202);
    assert.equal(queuedRecord["testId"], result.payload["testId"]);
    assert.equal(activeTests.length, 0);
    assert.equal(progressDetail.response.status, 200);
    assert.equal(progressDetail.payload["status"], "ok");
    assert.equal(progressDetailTest?.["status"], "completed");
    assert.equal(progressDetailProgress?.["phase"], "completed");
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test create rejects invalid configs before writing records", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const candidate = strategyBucketTestCandidate({ bucket: "short_term" });
    const disabledBucketPolicy = candidate.policy.strategyBuckets.find(
      (bucket) => bucket.bucket === "short_term"
    );
    assert.ok(disabledBucketPolicy);
    disabledBucketPolicy.targetWeightRatio = 0;

    const result = await fetchJson(baseUrl, STRATEGY_BUCKET_TEST_CREATE_ROUTE, {
      method: "POST",
      headers: strategyBucketTestCreateHeaders(baseUrl),
      body: JSON.stringify(candidate)
    });
    const records = await readJsonlRecords(paths.strategyBucketTestRecordsPath);
    const auditEvents = await readJsonlRecords(paths.auditLogPath);

    assert.equal(result.response.status, 400);
    assert.equal(result.payload["error"], "invalid_strategy_bucket_test_config");
    assert.equal(result.payload["storageMutationEnabled"], false);
    assert.equal(result.payload["liveTradingEnabled"], false);
    assert.equal(result.payload["orderPlacementEnabled"], false);
    assert.equal(result.payload["replayRunnerStarted"], false);
    assert.match(JSON.stringify(result.payload["issues"]), /BUCKET_DISABLED/);
    assert.equal(records.length, 0);
    assert.equal(auditEvents.length, 0);
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("strategy bucket test create rejects missing guards and cross-origin requests", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const missingHeader = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_CREATE_ROUTE,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl
        },
        body: JSON.stringify(strategyBucketTestCandidate())
      }
    );
    const badOrigin = await fetchJson(
      baseUrl,
      STRATEGY_BUCKET_TEST_CREATE_ROUTE,
      {
        method: "POST",
        headers: {
          ...strategyBucketTestCreateHeaders(baseUrl),
          origin: "http://evil.example"
        },
        body: JSON.stringify(strategyBucketTestCandidate())
      }
    );
    const records = await readJsonlRecords(paths.strategyBucketTestRecordsPath);
    const auditEvents = await readJsonlRecords(paths.auditLogPath);

    assert.equal(missingHeader.response.status, 403);
    assert.equal(missingHeader.payload["error"], "mutation_guard_required");
    assert.equal(missingHeader.payload["storageMutationEnabled"], false);
    assert.equal(missingHeader.payload["replayRunnerStarted"], false);
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.payload["error"], "origin_not_allowed");
    assert.equal(badOrigin.payload["storageMutationEnabled"], false);
    assert.equal(badOrigin.payload["replayRunnerStarted"], false);
    assert.equal(records.length, 0);
    assert.equal(auditEvents.length, 0);
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("paper simulation create starts a guarded paper-only runner", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const runnerInput: { value?: PaperSimulationRunnerInput } = {};
  let resolveRunner!: (value: PaperSimulationRunnerResult) => void;
  const runnerPromise = new Promise<PaperSimulationRunnerResult>((resolve) => {
    resolveRunner = resolve;
  });
  const runner: PaperSimulationRunner = async (input) => {
    runnerInput.value = input;
    return runnerPromise;
  };
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: runner
  });

  try {
    const result = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: paperSimulationCreateHeaders(baseUrl),
      body: JSON.stringify(paperSimulationConfig())
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(result.response.status, 202);
    assert.equal(result.payload["mode"], "paper_only");
    assert.equal(result.payload["mutation"], "paper_simulation_create");
    assert.equal(result.payload["readOnlyLiveTrading"], true);
    assert.equal(result.payload["activeUrl"], "/dashboard/virtual");
    const startedRun = runnerInput.value;
    assert.ok(startedRun);
    assert.equal(startedRun.storageBaseDir, storageBaseDir);
    assert.equal(startedRun.config.runType, "batch_replay");
    assert.equal(startedRun.config.runCount, 2);
    assert.equal(startedRun.config.decisionProvider.mode, "dry_run_fixture");
    assert.equal(startedRun.tickDelayMs, 0);

    const conflict = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: paperSimulationCreateHeaders(baseUrl),
      body: JSON.stringify(paperSimulationConfig({ windowSeed: "other-seed" }))
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.payload["error"], "paper_simulation_already_running");

    resolveRunner(paperSimulationRunnerResult(startedRun));
    await runnerPromise;
  } finally {
    await stopTestServer(server);
  }
});

test("paper simulation create supports explicit dashboard tick pacing override", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const runnerInputs: PaperSimulationRunnerInput[] = [];
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    env: {
      PAPER_SIMULATION_TICK_DELAY_MS: "125"
    },
    paperSimulationRunner: async (input) => {
      runnerInputs.push(input);
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: paperSimulationCreateHeaders(baseUrl),
      body: JSON.stringify(paperSimulationConfig())
    });

    assert.equal(result.response.status, 202);
    assert.equal(runnerInputs[0]?.tickDelayMs, 125);
  } finally {
    await stopTestServer(server);
  }
});

test("paper simulation create rejects missing guards and cross-origin requests", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const missingHeader = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: baseUrl
      },
      body: JSON.stringify(paperSimulationConfig())
    });
    const badOrigin = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: {
        ...paperSimulationCreateHeaders(baseUrl),
        origin: "http://evil.example"
      },
      body: JSON.stringify(paperSimulationConfig())
    });

    assert.equal(missingHeader.response.status, 403);
    assert.equal(missingHeader.payload["error"], "mutation_guard_required");
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.payload["error"], "origin_not_allowed");
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("paper simulation create keeps Codex provider disabled until env explicitly allows it", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    env: {
      AI_DECISION_MODE: "paper_only",
      AI_DECISION_ENABLED: "false"
    },
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: paperSimulationCreateHeaders(baseUrl),
      body: JSON.stringify(
        paperSimulationConfig({
          aiProvider: "codex_paper_only",
          maxCodexCallsPerRun: 3
        })
      )
    });

    assert.equal(result.response.status, 400);
    assert.equal(result.payload["error"], "codex_provider_disabled");
    assert.equal(runnerCallCount, 0);
  } finally {
    await stopTestServer(server);
  }
});

test("paper simulation create allows monthly daily Codex call cap", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const runnerInputs: PaperSimulationRunnerInput[] = [];
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    env: {
      AI_DECISION_MODE: "paper_only",
      AI_DECISION_ENABLED: "true"
    },
    paperSimulationRunner: async (input) => {
      runnerInputs.push(input);
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: paperSimulationCreateHeaders(baseUrl),
      body: JSON.stringify(
        paperSimulationConfig({
          aiProvider: "codex_paper_only",
          maxDecisionCalls: 30,
          maxCodexCallsPerRun: 30
        })
      )
    });

    assert.equal(result.response.status, 202);
    assert.equal(
      runnerInputs[0]?.config.samplingPolicy.maxDecisionCalls,
      30
    );
    assert.equal(
      runnerInputs[0]?.config.samplingPolicy.maxCodexCallsPerRun,
      30
    );
  } finally {
    await stopTestServer(server);
  }
});

test("paper simulation create reports field-specific numeric limit errors", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  let runnerCallCount = 0;
  const { server, baseUrl } = await startTestServer(storageBaseDir, {
    paperSimulationRunner: async (input) => {
      runnerCallCount += 1;
      return paperSimulationRunnerResult(input);
    }
  });

  try {
    const result = await fetchJson(baseUrl, "/paper/simulations", {
      method: "POST",
      headers: paperSimulationCreateHeaders(baseUrl),
      body: JSON.stringify(
        paperSimulationConfig({
          maxCodexCallsPerRun: 32
        })
      )
    });

    assert.equal(result.response.status, 400);
    assert.equal(result.payload["error"], "invalid_simulation_config");
    assert.match(
      String(result.payload["message"]),
      /samplingPolicy\.maxCodexCallsPerRun: Max Codex calls must be 31 or lower/
    );
    assert.equal(runnerCallCount, 0);
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

test("local operations API serves derived replay research report read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(
      batchReplayAggregateReport(
        "data/batch-replay/batch-smoke/account-1234-5678-901234-ord_abcdef123456/batch-replay-runs.jsonl"
      )
    )}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/research/replay/report");
    const report = result.payload["report"] as Record<string, unknown>;
    const runIdentity = report["runIdentity"] as Record<string, unknown>;
    const executionAssumptions = report["executionAssumptions"] as Record<
      string,
      unknown
    >;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "ok");
    assert.equal(report["title"], "Replay Research Paper Report");
    assert.equal(report["mode"], "paper_only");
    assert.equal(runIdentity["runCount"], 4);
    assert.equal(executionAssumptions["paperOnly"], true);
    assert.equal(executionAssumptions["liveTradingEnabled"], false);
    assert.equal(executionAssumptions["orderPlacementEnabled"], false);
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves dashboard ViewModel contracts read-only", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
    portfolioId: "virtual_default",
    cashKrw: 800_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        strategyBucket: "long_term",
        quantity: 2,
        averagePriceKrw: 70_000,
        marketValueKrw: 150_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      },
      {
        market: "US",
        symbol: "SH",
        assetClass: "inverse",
        strategyBucket: "hedge",
        quantity: 1,
        averagePriceKrw: 50_000,
        marketValueKrw: 50_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ],
    updatedAt: "2026-06-11T09:00:00+09:00"
  });
  await new FileVirtualDecisionStore(paths.virtualDecisionsPath).append(
    decision()
  );
  await new FileVirtualTradeStore(paths.virtualTradesPath).append({
    ...trade(),
    strategyBucket: "long_term",
    grossAmountKrw: 70_000,
    feeKrw: 70,
    slippageKrw: 70,
    totalCostKrw: 999
  });
  await new FileVirtualTradeStore(paths.virtualTradesPath).append({
    ...trade(),
    tradeId: "trade_api_hedge",
    decisionId: "decision_api_hedge",
    market: "US",
    symbol: "SH",
    priceKrw: 50_000,
    amountKrw: 50_000,
    grossAmountKrw: 50_000,
    feeKrw: 10,
    totalCostKrw: 999,
    strategyBucket: "hedge"
  });
  await new FileVirtualDecisionStore(paths.historicalReplayDecisionLogPath).append(
    replayDecision()
  );
  await new FileVirtualTradeStore(paths.historicalReplayTradeLogPath).append(
    replayTrade()
  );
  await new FileAuditLog(paths.auditLogPath).append({
    eventId: "audit_api_002",
    eventType: "VIRTUAL_RISK_REJECTED",
    actor: "system",
    summary:
      "packet_replay_001 035420 rejected account 1234-5678-901234 order ord_abcdef123456",
    maskedRefs: [],
    createdAt: "2026-06-11T09:02:00+09:00"
  });
  await writeFile(
    paths.historicalReplayRiskDecisionLogPath,
    `${JSON.stringify({
      riskDecisionId: "risk_api_001",
      packetId: "packet_replay_001",
      symbol: "035420",
      approved: false,
      rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
      checkedRules: ["cash_available"],
      createdAt: "2026-06-11T09:00:00+09:00"
    })}\n`,
    "utf8"
  );
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(
      batchReplayAggregateReport(
        "data/batch-replay/batch-smoke/account-1234-5678-901234-ord_abcdef123456/batch-replay-runs.jsonl"
      )
    )}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const portfolioCompliance = await fetchJson(
      baseUrl,
      "/dashboard/view-model/portfolio-compliance"
    );
    const strategyTestLab = await fetchJson(
      baseUrl,
      "/dashboard/view-model/strategy-test-lab"
    );
    const riskGateTrace = await fetchJson(
      baseUrl,
      "/dashboard/view-model/risk-gate-trace?limit=5"
    );
    const validationLab = await fetchJson(
      baseUrl,
      "/dashboard/view-model/validation-lab"
    );
    const validationHead = await fetch(
      `${baseUrl}/dashboard/view-model/validation-lab`,
      { method: "HEAD" }
    );
    const bucketRows = portfolioCompliance.payload["bucketCompliance"] as Array<
      Record<string, unknown>
    >;
    const hedgeCompliance = portfolioCompliance.payload[
      "hedgeCompliance"
    ] as Record<string, unknown>;
    const cashCompliance = portfolioCompliance.payload[
      "cashCompliance"
    ] as Record<string, unknown>;
    const complianceAnalytics = portfolioCompliance.payload[
      "complianceAnalytics"
    ] as Record<string, Record<string, unknown>>;
    const strategyBucketAnalytics = complianceAnalytics["strategyBucket"]!;
    const cashReserveAnalytics = complianceAnalytics["cashReserve"]!;
    const hedgeEffectivenessAnalytics =
      complianceAnalytics["hedgeEffectiveness"]!;
    const costTurnoverAnalytics = complianceAnalytics["costTurnover"]!;
    const bucketCostRows = costTurnoverAnalytics[
      "byStrategyBucket"
    ] as Array<Record<string, unknown>>;
    const supportedBuckets = strategyTestLab.payload[
      "supportedBuckets"
    ] as Array<Record<string, unknown>>;
    const comparison = strategyTestLab.payload[
      "comparison"
    ] as Record<string, unknown>;
    const traces = riskGateTrace.payload["traces"] as Array<
      Record<string, unknown>
    >;
    const validationProtocol = validationLab.payload[
      "validationProtocol"
    ] as Record<string, unknown>;
    const overfittingWarning = validationLab.payload[
      "overfittingWarning"
    ] as Record<string, unknown>;
    const text = JSON.stringify({
      portfolioCompliance: portfolioCompliance.payload,
      strategyTestLab: strategyTestLab.payload,
      riskGateTrace: riskGateTrace.payload,
      validationLab: validationLab.payload
    });

    assert.equal(portfolioCompliance.response.status, 200);
    assert.equal(portfolioCompliance.payload["mode"], "paper_only");
    assert.equal(portfolioCompliance.payload["readOnly"], true);
    assert.equal(
      portfolioCompliance.payload["viewModel"],
      "portfolio-compliance"
    );
    assert.equal(portfolioCompliance.payload["policyStatus"], "missing");
    assert.equal(portfolioCompliance.payload["virtualNetWorthKrw"], 1_000_000);
    assert.equal(
      bucketRows.find((row) => row["bucket"] === "long_term")?.["exposureKrw"],
      150_000
    );
    assert.equal(hedgeCompliance["hedgeExposureKrw"], 50_000);
    assert.equal(cashCompliance["marketRegime"], "bull");
    assert.equal(cashCompliance["targetCashRatio"], 0.1);
    assert.equal(cashCompliance["minimumCashReserveKrw"], 100_000);
    assert.equal(cashCompliance["cashGapKrw"], 0);
    assert.equal(cashCompliance["ruleSource"], "static");
    assert.equal(cashCompliance["status"], "ok");
    assert.equal(strategyBucketAnalytics["occupiedBucketCount"], 2);
    assert.equal(strategyBucketAnalytics["missingPolicyTargetCount"], 5);
    assert.equal(
      (strategyBucketAnalytics["largestBucket"] as Record<string, unknown>)["key"],
      "long_term"
    );
    assert.equal(strategyBucketAnalytics["concentrationRatio"], 0.75);
    assert.equal(cashReserveAnalytics["currentCashKrw"], 800_000);
    assert.equal(cashReserveAnalytics["reserveStatus"], "ok");
    assert.equal(hedgeEffectivenessAnalytics["hedgeCoverageRatio"], 0.25);
    assert.equal(hedgeEffectivenessAnalytics["netDownsideExposureRatio"], 0.75);
    assert.equal(hedgeEffectivenessAnalytics["costDragRatio"], 0.0002);
    assert.equal(hedgeEffectivenessAnalytics["status"], "ok");
    assert.equal(costTurnoverAnalytics["totalTradeAmountKrw"], 120_000);
    assert.equal(costTurnoverAnalytics["totalCostKrw"], 150);
    assert.equal(costTurnoverAnalytics["totalTurnoverRatio"], 0.12);
    assert.equal(costTurnoverAnalytics["totalCostDragRatio"], 0.00125);
    assert.equal(
      bucketCostRows.find((row) => row["bucket"] === "long_term")?.[
        "totalCostKrw"
      ],
      140
    );
    assert.equal(
      bucketCostRows.find((row) => row["bucket"] === "hedge")?.["totalCostKrw"],
      10
    );

    assert.equal(strategyTestLab.response.status, 200);
    assert.equal(strategyTestLab.payload["viewModel"], "strategy-test-lab");
    assert.equal(supportedBuckets.length, 5);
    assert.equal(
      supportedBuckets.every(
        (bucket) => bucket["canRunIsolatedReplay"] === false
      ),
      true
    );
    assert.match(
      String(comparison["selectionWarning"]),
      /isolated strategy bucket/
    );

    assert.equal(riskGateTrace.response.status, 200);
    assert.equal(riskGateTrace.payload["viewModel"], "risk-gate-trace");
    assert.equal(riskGateTrace.payload["sourceFamily"], "historical_replay");
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.["packetId"], "packet_replay_001");
    assert.equal(traces[0]?.["symbol"], "035420");
    assert.equal(traces[0]?.["riskApproved"], false);
    assert.deepEqual(traces[0]?.["rejectCodes"], ["VIRTUAL_CASH_EXCEEDED"]);
    assert.deepEqual(traces[0]?.["auditEventRefs"], ["audit_api_002"]);

    assert.equal(validationLab.response.status, 200);
    assert.equal(validationLab.payload["viewModel"], "validation-lab");
    assert.equal(validationLab.payload["status"], "ok");
    assert.equal(validationProtocol["pboLikeScore"], 0.25);
    assert.equal(overfittingWarning["status"], "available");
    assert.equal(validationHead.status, 200);
    assert.equal(await validationHead.text(), "");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
  } finally {
    await stopTestServer(server);
  }
});

test("dashboard portfolio compliance keeps reject count scoped to current artifacts", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const staleAggregate = batchReplayAggregateReport();
  const staleOverall = staleAggregate["overall"] as Record<string, unknown>;
  staleOverall["totalRejectedCount"] = 99;
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(staleAggregate)}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(
      baseUrl,
      "/dashboard/view-model/portfolio-compliance"
    );
    const riskGateSummary = result.payload["riskGateSummary"] as Record<
      string,
      unknown
    >;
    const cashCompliance = result.payload["cashCompliance"] as Record<
      string,
      unknown
    >;
    const hedgeCompliance = result.payload["hedgeCompliance"] as Record<
      string,
      unknown
    >;

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["status"], "missing");
    assert.equal(riskGateSummary["decisionItemCount"], 0);
    assert.equal(riskGateSummary["rejectedCount"], 0);
    assert.deepEqual(riskGateSummary["rejectCodes"], {});
    assert.equal(cashCompliance["rejectedCount"], 0);
    assert.equal(hedgeCompliance["rejectedCount"], 0);
  } finally {
    await stopTestServer(server);
  }
});

test("dashboard cash compliance aligns insufficient data fallback with risk policy", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
    ...portfolio(),
    cashKrw: 250_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        strategyBucket: "long_term",
        quantity: 10,
        averagePriceKrw: 75_000,
        marketValueKrw: 750_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ]
  });
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(
      baseUrl,
      "/dashboard/view-model/portfolio-compliance"
    );
    const cashCompliance = result.payload["cashCompliance"] as Record<
      string,
      unknown
    >;
    const complianceAnalytics = result.payload[
      "complianceAnalytics"
    ] as Record<string, Record<string, unknown>>;
    const cashReserve = complianceAnalytics["cashReserve"]!;

    assert.equal(result.response.status, 200);
    assert.equal(cashCompliance["marketRegime"], "insufficient_data");
    assert.equal(cashCompliance["targetCashRatio"], 0.35);
    assert.equal(cashCompliance["minimumCashReserveKrw"], 350_000);
    assert.equal(cashCompliance["cashGapKrw"], 100_000);
    assert.equal(cashCompliance["ruleSource"], "fallback");
    assert.equal(cashCompliance["status"], "under_reserved");
    assert.equal(cashReserve["targetCashRatio"], 0.35);
    assert.equal(cashReserve["reserveStatus"], "under_reserved");
    assert.equal(cashReserve["ruleSource"], "fallback");
  } finally {
    await stopTestServer(server);
  }
});

test("dashboard cash compliance preserves static reserve floor in bull regimes", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
    ...portfolio(),
    cashKrw: 50_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        strategyBucket: "long_term",
        quantity: 10,
        averagePriceKrw: 95_000,
        marketValueKrw: 950_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ]
  });
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(batchReplayAggregateReport())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(
      baseUrl,
      "/dashboard/view-model/portfolio-compliance"
    );
    const cashCompliance = result.payload["cashCompliance"] as Record<
      string,
      unknown
    >;
    const complianceAnalytics = result.payload[
      "complianceAnalytics"
    ] as Record<string, Record<string, unknown>>;
    const cashReserve = complianceAnalytics["cashReserve"]!;

    assert.equal(result.response.status, 200);
    assert.equal(cashCompliance["marketRegime"], "bull");
    assert.equal(cashCompliance["targetCashRatio"], 0.1);
    assert.equal(cashCompliance["minimumCashReserveKrw"], 100_000);
    assert.equal(cashCompliance["cashGapKrw"], 50_000);
    assert.equal(cashCompliance["ruleSource"], "static");
    assert.equal(cashCompliance["status"], "under_reserved");
    assert.equal(cashReserve["targetCashRatio"], 0.1);
    assert.equal(cashReserve["reserveStatus"], "under_reserved");
    assert.equal(cashReserve["ruleSource"], "static");
  } finally {
    await stopTestServer(server);
  }
});

test("dashboard hedge compliance requires current hedge exposure for ok status", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await new FileVirtualPortfolioStore(paths.virtualPortfolioPath).write({
    ...portfolio(),
    cashKrw: 850_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        strategyBucket: "long_term",
        quantity: 2,
        averagePriceKrw: 70_000,
        marketValueKrw: 150_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ]
  });
  await new FileVirtualTradeStore(paths.virtualTradesPath).append({
    ...trade(),
    tradeId: "trade_stale_hedge",
    decisionId: "decision_stale_hedge",
    market: "US",
    symbol: "SH",
    priceKrw: 50_000,
    amountKrw: 50_000,
    grossAmountKrw: 50_000,
    feeKrw: 10,
    strategyBucket: "hedge"
  });
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(
      baseUrl,
      "/dashboard/view-model/portfolio-compliance"
    );
    const hedgeCompliance = result.payload["hedgeCompliance"] as Record<
      string,
      unknown
    >;
    const complianceAnalytics = result.payload[
      "complianceAnalytics"
    ] as Record<string, Record<string, unknown>>;
    const hedgeEffectiveness = complianceAnalytics["hedgeEffectiveness"]!;

    assert.equal(result.response.status, 200);
    assert.equal(hedgeCompliance["grossExposureKrw"], 150_000);
    assert.equal(hedgeCompliance["hedgeExposureKrw"], 0);
    assert.equal(hedgeCompliance["hedgeTradeCount"], 1);
    assert.equal(hedgeCompliance["status"], "ineffective");
    assert.equal(hedgeEffectiveness["hedgeCoverageRatio"], 0);
    assert.equal(hedgeEffectiveness["netDownsideExposureRatio"], 1);
    assert.equal(hedgeEffectiveness["costDragRatio"], null);
    assert.equal(hedgeEffectiveness["status"], "ineffective");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API returns null research report for invalid aggregate artifact", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  await writeFile(paths.batchReplayAggregateReportPath, "{}\n", "utf8");
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/research/replay/report");

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["readOnly"], true);
    assert.equal(result.payload["status"], "invalid");
    assert.equal(result.payload["aggregateReportStatus"], "invalid");
    assert.equal(result.payload["report"], null);
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

test("local operations API marks legacy completed runs with AI failures", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const batchDir = join(
    storageBaseDir,
    "..",
    "batch-replay",
    "batch-legacy-ai-failure"
  );
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const legacyRun = batchReplayRunRecord(0, "completed");
  legacyRun["summary"] = {
    ...(legacyRun["summary"] as Record<string, unknown>),
    aiDecisionFailureCount: 2,
    aiDecisionFailureReasons: ["invalid_json_schema"],
    lastAiDecisionFailureSummary: "invalid_json_schema"
  };
  await mkdir(batchDir, { recursive: true });
  await writeFile(
    join(batchDir, "batch-replay-manifest.json"),
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "batch-legacy-ai-failure",
      status: "completed",
      startedAt: "2026-06-18T17:00:00+09:00",
      updatedAt: "2026-06-18T17:01:00+09:00",
      completedAt: "2026-06-18T17:01:00+09:00",
      sourceDataDir: "data/paper",
      runCount: 1,
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      runsPath
    })}\n`,
    "utf8"
  );
  await writeFile(runsPath, `${JSON.stringify(legacyRun)}\n`, "utf8");

  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/batch/replay/runs?limit=10");
    const runs = result.payload["runs"] as Array<Record<string, unknown>>;
    const statusCounts = result.payload["statusCounts"] as Record<
      string,
      unknown
    >;

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["batchStatus"], "completed_with_failures");
    assert.equal(result.payload["aiDecisionFailureRunCount"], 1);
    assert.equal(statusCounts["completed_with_failures"], 1);
    assert.equal(statusCounts["completed"], undefined);
    assert.equal(runs[0]?.["status"], "completed_with_failures");
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
      startedAt: "2026-06-11T08:59:00+09:00",
      updatedAt: "2026-06-11T09:00:00+09:00",
      completedAt: null,
      sourceDataDir: "data/replay",
      runCount: 3,
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      decisionProvider: {
        mode: "codex_cli",
        maxCallsPerRun: 2
      },
      riskProfile: "balanced",
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
    assert.equal(result.payload["batchUpdatedAt"], "2026-06-11T09:00:00+09:00");
    assert.equal(result.payload["requestedRunCount"], 3);
    assert.equal(result.payload["decisionProviderMode"], "codex_cli");
    assert.equal(result.payload["decisionProviderMaxCallsPerRun"], 2);
    assert.equal(result.payload["riskProfile"], "balanced");
    assert.equal(result.payload["sourceDataDir"], "data/replay");
    assert.equal(result.payload["count"], 1);
    assert.deepEqual(result.payload["manifestCounts"], {
      completed: 1,
      skipped: 0,
      failed: 0
    });
    assert.equal(runs[0]?.["runId"], "run_0");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API serves latest completed manifest runs over aggregate source", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const paths = createStoragePaths(storageBaseDir);
  const aggregateDir = join(storageBaseDir, "..", "batch-replay", "batch-old");
  const aggregateRunsPath = join(aggregateDir, "batch-replay-runs.jsonl");
  const latestDir = join(storageBaseDir, "..", "batch-replay", "paper_sim_single");
  const latestRunsPath = join(latestDir, "batch-replay-runs.jsonl");

  await mkdir(aggregateDir, { recursive: true });
  await mkdir(latestDir, { recursive: true });
  await writeFile(
    paths.batchReplayAggregateReportPath,
    `${JSON.stringify(batchReplayAggregateReport(aggregateRunsPath))}\n`,
    "utf8"
  );
  await writeFile(
    aggregateRunsPath,
    `${JSON.stringify(batchReplayRunRecord(0, "completed"))}\n`,
    "utf8"
  );
  await writeFile(
    join(latestDir, "batch-replay-manifest.json"),
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "paper_sim_single",
      status: "completed",
      startedAt: "2026-06-18T13:41:59+09:00",
      updatedAt: "2026-06-18T13:42:00+09:00",
      completedAt: "2026-06-18T13:42:00+09:00",
      sourceDataDir: "data/paper",
      runCount: 1,
      completedCount: 0,
      skippedCount: 1,
      failedCount: 0,
      decisionProvider: {
        mode: "codex_cli",
        maxCallsPerRun: 20
      },
      riskProfile: "aggressive_paper",
      runsPath: latestRunsPath
    })}\n`,
    "utf8"
  );
  await writeFile(
    latestRunsPath,
    `${JSON.stringify({
      ...batchReplayRunRecord(0, "failed"),
      batchId: "paper_sim_single",
      runId: "paper_sim_single_run_000000",
      status: "skipped"
    })}\n`,
    "utf8"
  );

  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(baseUrl, "/batch/replay/runs?limit=10");
    const runs = result.payload["runs"] as Array<Record<string, unknown>>;

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["batchStatus"], "completed");
    assert.equal(result.payload["batchId"], "paper_sim_single");
    assert.equal(result.payload["batchStartedAt"], "2026-06-18T13:41:59+09:00");
    assert.equal(result.payload["batchUpdatedAt"], "2026-06-18T13:42:00+09:00");
    assert.equal(result.payload["batchCompletedAt"], "2026-06-18T13:42:00+09:00");
    assert.equal(result.payload["requestedRunCount"], 1);
    assert.deepEqual(result.payload["manifestCounts"], {
      completed: 0,
      skipped: 1,
      failed: 0
    });
    assert.equal(result.payload["decisionProviderMode"], "codex_cli");
    assert.equal(result.payload["decisionProviderMaxCallsPerRun"], 20);
    assert.equal(result.payload["riskProfile"], "aggressive_paper");
    assert.equal(result.payload["sourceDataDir"], "data/paper");
    assert.equal(result.payload["sourceRunsPath"], latestRunsPath);
    assert.equal(result.payload["count"], 1);
    assert.equal(runs[0]?.["runId"], "paper_sim_single_run_000000");
  } finally {
    await stopTestServer(server);
  }
});

test("local operations API can include latest batch run artifacts", async () => {
  const storageBaseDir = await createTempStorageBaseDir();
  const batchDir = join(storageBaseDir, "..", "batch-replay", "paper_sim_single");
  const runDir = join(batchDir, "runs", "paper_sim_single_run_000000");
  const sourceDataDir = join(storageBaseDir, "source-data");
  const runsPath = join(batchDir, "batch-replay-runs.jsonl");
  const reportPath = join(runDir, "historical-replay-report.json");
  const run = {
    ...batchReplayRunRecord(0, "completed"),
    batchId: "paper_sim_single",
    runId: "paper_sim_single_run_000000",
    storageBaseDir: runDir,
    reportPath
  };

  await mkdir(runDir, { recursive: true });
  await mkdir(sourceDataDir, { recursive: true });
  await writeFile(
    createStoragePaths(sourceDataDir).historicalMarketSnapshotsPath,
    `${JSON.stringify({
      snapshotId: "hist_api_kr_005930_20250611",
      market: "KR",
      symbol: "005930",
      name: "삼성전자",
      observedAt: "2026-06-11T09:00:00+09:00",
      interval: "1d",
      lastPriceKrw: 70_000,
      sourceRefs: ["test:source:005930"],
      createdAt: "2026-06-11T09:00:00+09:00"
    })}\n`,
    "utf8"
  );
  await writeFile(
    join(batchDir, "batch-replay-manifest.json"),
    `${JSON.stringify({
      mode: "paper_only",
      batchId: "paper_sim_single",
      status: "completed",
      startedAt: "2026-06-18T13:41:59+09:00",
      updatedAt: "2026-06-18T13:42:00+09:00",
      completedAt: "2026-06-18T13:42:00+09:00",
      sourceDataDir,
      runCount: 1,
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      runsPath
    })}\n`,
    "utf8"
  );
  await writeFile(runsPath, `${JSON.stringify(run)}\n`, "utf8");
  await writeFile(reportPath, `${JSON.stringify(historicalReplayReport())}\n`, "utf8");
  await writeFile(
    join(runDir, "historical-replay-progress.json"),
    `${JSON.stringify({
      ...historicalReplayProgress(),
      status: "completed",
      completedAt: "2026-06-11T09:01:00+09:00"
    })}\n`,
    "utf8"
  );
  await writeFile(
    join(runDir, "historical-replay-decisions.jsonl"),
    `${JSON.stringify(decision())}\n`,
    "utf8"
  );
  await writeFile(
    join(runDir, "historical-replay-packets.jsonl"),
    `${JSON.stringify(marketPacketWithoutName())}\n`,
    "utf8"
  );
  await writeFile(
    join(runDir, "historical-replay-risk-decisions.jsonl"),
    `${JSON.stringify({
      riskDecisionId: "risk_api_001",
      packetId: "packet_api_001",
      market: "KR",
      symbol: "005930",
      action: "VIRTUAL_BUY",
      approved: false,
      rejectCodes: ["VIRTUAL_CASH_EXCEEDED"],
      checkedRules: ["cash_available"],
      createdAt: "2026-06-11T09:00:00+09:00"
    })}\n`,
    "utf8"
  );
  await writeFile(
    join(runDir, "historical-replay-trades.jsonl"),
    `${JSON.stringify(trade())}\n`,
    "utf8"
  );
  const { server, baseUrl } = await startTestServer(storageBaseDir);

  try {
    const result = await fetchJson(
      baseUrl,
      "/batch/replay/runs?limit=10&includeLatestRunArtifacts=1"
    );
    const artifacts = result.payload["latestRunArtifacts"] as Record<
      string,
      unknown
    >;
    const report = artifacts["report"] as Record<string, unknown>;
    const progress = artifacts["progress"] as Record<string, unknown>;
    const decisions = artifacts["decisions"] as Array<Record<string, unknown>>;
    const packets = artifacts["packets"] as Array<Record<string, unknown>>;
    const riskDecisions = artifacts["riskDecisions"] as Array<
      Record<string, unknown>
    >;
    const trades = artifacts["trades"] as Array<Record<string, unknown>>;
    const candidates = packets[0]?.["candidates"] as Array<
      Record<string, unknown>
    >;
    const text = JSON.stringify(result.payload);

    assert.equal(result.response.status, 200);
    assert.equal(result.payload["batchStatus"], "completed");
    assert.equal(artifacts["status"], "ok");
    assert.equal(artifacts["runId"], "paper_sim_single_run_000000");
    assert.equal(artifacts["reportStatus"], "ok");
    assert.equal(report["title"], "Historical Replay Paper Report");
    assert.equal(artifacts["progressStatus"], "ok");
    assert.equal(progress["status"], "completed");
    assert.equal(artifacts["decisionCount"], 1);
    assert.equal(decisions[0]?.["packetId"], "packet_api_001");
    assert.equal(artifacts["packetCount"], 1);
    assert.equal(packets[0]?.["packetId"], "packet_api_001");
    assert.equal(candidates[0]?.["name"], "삼성전자");
    assert.equal(artifacts["riskDecisionCount"], 1);
    assert.equal(riskDecisions[0]?.["riskDecisionId"], "risk_api_001");
    assert.equal(artifacts["tradeCount"], 1);
    assert.equal(trades[0]?.["tradeId"], "trade_api_001");
    assert.equal(text.includes("1234-5678-901234"), false);
    assert.equal(text.includes("ord_abcdef123456"), false);
    assert.match(text, /\*\*\*\*/);
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

function paperSimulationCreateHeaders(baseUrl: string): HeadersInit {
  return {
    "content-type": "application/json",
    [PAPER_SIMULATION_MUTATION_HEADER_NAME]: PAPER_SIMULATION_CREATE_OPERATION,
    origin: baseUrl
  };
}

function paperPolicyValidationHeaders(baseUrl: string): HeadersInit {
  return {
    "content-type": "application/json",
    [PAPER_POLICY_VALIDATION_HEADER_NAME]: PAPER_POLICY_VALIDATION_OPERATION,
    origin: baseUrl
  };
}

function strategyBucketTestValidationHeaders(baseUrl: string): HeadersInit {
  return {
    "content-type": "application/json",
    [STRATEGY_BUCKET_TEST_VALIDATION_HEADER_NAME]:
      STRATEGY_BUCKET_TEST_VALIDATION_OPERATION,
    origin: baseUrl
  };
}

function strategyBucketTestCreateHeaders(baseUrl: string): HeadersInit {
  return {
    "content-type": "application/json",
    [STRATEGY_BUCKET_TEST_CREATE_HEADER_NAME]:
      STRATEGY_BUCKET_TEST_CREATE_OPERATION,
    origin: baseUrl
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => reverseObjectKeys(entry));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).reverse()) {
      output[key] = reverseObjectKeys(entry);
    }
    return output;
  }

  return value;
}

type StrategyBucketName =
  | "long_term"
  | "swing"
  | "short_term"
  | "intraday"
  | "hedge";

interface StrategyBucketTestCandidate {
  mode: "paper_only";
  requestId: string;
  bucket: StrategyBucketName;
  policy: PolicyCandidate;
  testConfig: {
    sourceDataDir: string;
    universe: {
      preset: string;
      market: "mixed_global" | "kr" | "us";
    };
    validationSplitRole: "train" | "validation" | "test";
    window: {
      seed: string;
      startAt: string;
      endAt: string;
      windowMonths: number;
    };
    samplingPolicy: {
      decisionFrequency: "every_tick" | "once_per_day" | "once_per_week";
      stepSeconds: number;
      maxDecisionCalls: number;
      maxCodexCallsPerRun: number;
    };
    capital: {
      initialCashKrw: number;
    };
    decisionProvider: {
      mode: "dry_run_fixture" | "codex_paper_only";
      modelId: string;
      outputSchema: "schemas/virtual-decision.schema.json";
    };
  };
}

interface PolicyCandidateBucket {
  bucket: string;
  targetWeightRatio: number;
  minWeightRatio: number;
  maxWeightRatio: number;
  maxTurnoverRatio: number;
  maxDrawdownRatio: number;
  holdingPeriodHint: string;
  enabledAssetClasses: string[];
}

interface PolicyCandidate {
  mode: "paper_only";
  policyId: string;
  version: string;
  name: string;
  validationStatus: "valid" | "invalid";
  strategyBuckets: PolicyCandidateBucket[];
  cashPolicy: {
    targetCashRatio: number;
    minimumCashReserveKrw: number;
    ruleSource: string;
  };
  hedgePolicy: {
    hedgeEnabled: boolean;
    hedgeTargetRatio: number;
    maxCostRatio: number;
  };
  exposurePolicy: {
    maxSymbolExposureRatio: number;
    maxCountryExposureRatio: number;
    maxCurrencyExposureRatio: number;
  };
  executionBoundary: {
    liveTradingEnabled: false;
    orderPlacementEnabled: false;
    backendValidationRequired: true;
  };
  warnings: string[];
}

function policyCandidate(): PolicyCandidate {
  return {
    mode: "paper_only",
    policyId: "local-draft",
    version: "draft.v1",
    name: "Balanced paper policy draft",
    validationStatus: "valid",
    strategyBuckets: [
      policyCandidateBucket("long_term", 0.35, 0.2, 0.5, 0.15, 0.18, "multi_month"),
      policyCandidateBucket("swing", 0.2, 0.1, 0.3, 0.35, 0.12, "multi_week"),
      policyCandidateBucket("short_term", 0.15, 0, 0.25, 0.5, 0.08, "multi_day"),
      policyCandidateBucket("intraday", 0.1, 0, 0.15, 1, 0.04, "intraday"),
      policyCandidateBucket("hedge", 0.05, 0, 0.15, 0.4, 0.06, "hedge")
    ],
    cashPolicy: {
      targetCashRatio: 0.15,
      minimumCashReserveKrw: 1_000_000,
      ruleSource: "dynamic_regime"
    },
    hedgePolicy: {
      hedgeEnabled: true,
      hedgeTargetRatio: 0.05,
      maxCostRatio: 0.015
    },
    exposurePolicy: {
      maxSymbolExposureRatio: 0.2,
      maxCountryExposureRatio: 0.7,
      maxCurrencyExposureRatio: 0.7
    },
    executionBoundary: {
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      backendValidationRequired: true
    },
    warnings: []
  };
}

function strategyBucketTestCandidate(
  overrides: {
    aiProvider?: "dry_run_fixture" | "codex_paper_only";
    bucket?: StrategyBucketName;
    maxCodexCallsPerRun?: number;
  } = {}
): StrategyBucketTestCandidate {
  return {
    mode: "paper_only",
    requestId: "strategy-bucket-test-validation-001",
    bucket: overrides.bucket ?? "long_term",
    policy: policyCandidate(),
    testConfig: {
      sourceDataDir: "data/replay-2023-01-2026-05-global-yahoo-daily",
      universe: {
        preset: "global_broad",
        market: "mixed_global"
      },
      validationSplitRole: "validation",
      window: {
        seed: "strategy-bucket-test-seed-001",
        startAt: "2024-01-01",
        endAt: "2024-02-01",
        windowMonths: 1
      },
      samplingPolicy: {
        decisionFrequency: "once_per_week",
        stepSeconds: 604800,
        maxDecisionCalls: 5,
        maxCodexCallsPerRun: overrides.maxCodexCallsPerRun ?? 0
      },
      capital: {
        initialCashKrw: 10_000_000
      },
      decisionProvider: {
        mode: overrides.aiProvider ?? "dry_run_fixture",
        modelId: "dry-run",
        outputSchema: "schemas/virtual-decision.schema.json"
      }
    }
  };
}

function policyCandidateBucket(
  bucket: string,
  targetWeightRatio: number,
  minWeightRatio: number,
  maxWeightRatio: number,
  maxTurnoverRatio: number,
  maxDrawdownRatio: number,
  holdingPeriodHint: string
): PolicyCandidateBucket {
  return {
    bucket,
    targetWeightRatio,
    minWeightRatio,
    maxWeightRatio,
    maxTurnoverRatio,
    maxDrawdownRatio,
    holdingPeriodHint,
    enabledAssetClasses: bucket === "hedge" ? ["inverse_etf"] : ["equity", "etf"]
  };
}

function paperSimulationConfig(
  overrides: {
    aiProvider?: "dry_run_fixture" | "codex_paper_only";
    maxDecisionCalls?: number;
    maxCodexCallsPerRun?: number;
    windowSeed?: string;
  } = {}
): Record<string, unknown> {
  return {
    mode: "paper_only",
    runType: "batch_replay",
    runCount: 2,
    sourceDataDir: "data/replay-2023-01-2026-05-global-yahoo-daily",
    universe: {
      preset: "global_broad",
      market: "mixed_global"
    },
    window: {
      mode: "random_month",
      seed: overrides.windowSeed ?? "paper-sim-seed-001",
      startAt: "2024-01-01",
      endAt: "2024-12-31",
      windowMonths: 1
    },
    samplingPolicy: {
      decisionFrequency: "once_per_week",
      stepSeconds: 604800,
      maxDecisionCalls: overrides.maxDecisionCalls ?? 5,
      maxCodexCallsPerRun: overrides.maxCodexCallsPerRun ?? 0
    },
    capital: {
      initialCashKrw: 10_000_000
    },
    decisionProvider: {
      mode: overrides.aiProvider ?? "dry_run_fixture",
      modelId: "gpt-5.3-codex-spark",
      outputSchema: "schemas/virtual-decision.schema.json"
    },
    riskProfile: "balanced",
    paperExitPolicy: "none",
    costModel: "standard",
    benchmarkPolicy: "cash_equal_weight_initial_hold"
  };
}

function paperSimulationRunnerResult(
  input: PaperSimulationRunnerInput
): PaperSimulationRunnerResult {
  return {
    mode: "paper_only",
    simulationRunId: input.simulationRunId,
    batchId: input.batchId,
    status: "completed",
    outputDir: "data/batch-replay/test",
    manifestPath: "data/batch-replay/test/batch-replay-manifest.json",
    runsPath: "data/batch-replay/test/batch-replay-runs.jsonl"
  };
}

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

function replayDecision(): VirtualDecision {
  return {
    packetId: "packet_replay_001",
    summary: "Historical replay decision",
    decisions: [
      {
        market: "KR",
        symbol: "035420",
        action: "VIRTUAL_BUY",
        confidence: 0.7,
        budgetKrw: 80_000,
        thesis: "Historical replay thesis references order ord_abcdef123456",
        riskFactors: ["Replay risk factor"],
        dataRefs: ["historical_replay:packet:packet_replay_001"],
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

function replayTrade(): VirtualTrade {
  return {
    tradeId: "trade_replay_001",
    packetId: "packet_replay_001",
    decisionId: "decision_replay_001",
    market: "KR",
    symbol: "035420",
    action: "VIRTUAL_BUY",
    quantity: 1,
    priceKrw: 80_000,
    amountKrw: 80_000,
    status: "VIRTUAL_REJECTED",
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

function marketPacketWithoutName(): MarketPacket {
  const packet = marketPacket();
  return {
    ...packet,
    candidates: packet.candidates.map((candidate) => {
      const copy = { ...candidate };
      delete copy.name;
      return copy;
    })
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
    sourceSelectionTrialsPath:
      "data/batch-replay/batch-smoke/batch-replay-selection-trials.jsonl",
    targetReturnThresholds: [0.15, 0.3],
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
      },
      validationSplitRoleCounts: {
        train: 2,
        validation: 1,
        test: 1
      }
    },
    trialSummary: {
      trialCount: 4,
      selectedCount: 1,
      unselectedCount: 3,
      statusCounts: {
        completed: 3,
        skipped: 1
      },
      aiDecisionFailureTrialCount: 0,
      rejectedTrialCount: 1,
      noTradeTrialCount: 1,
      decisionProviderModes: [
        {
          key: "deterministic_fixture",
          count: 4,
          runIds: ["run_0", "run_1", "run_2", "run_3"]
        }
      ],
      promptHashes: [
        {
          key: "sha256:prompt",
          count: 4,
          runIds: ["run_0", "run_1", "run_2", "run_3"]
        }
      ],
      configHashes: [
        {
          key: "sha256:config",
          count: 4,
          runIds: ["run_0", "run_1", "run_2", "run_3"]
        }
      ],
      riskPolicyHashes: [
        {
          key: "sha256:risk",
          count: 4,
          runIds: ["run_0", "run_1", "run_2", "run_3"]
        }
      ],
      exitPolicyHashes: [
        {
          key: "sha256:exit",
          count: 4,
          runIds: ["run_0", "run_1", "run_2", "run_3"]
        }
      ],
      riskProfiles: [
        {
          key: "balanced",
          count: 4,
          runIds: ["run_0", "run_1", "run_2", "run_3"]
        }
      ],
      runIds: ["run_0", "run_1", "run_2", "run_3"]
    },
    overfittingDiagnostics: {
      validationProtocol: "sampled_cpcv_pbo_like",
      selectionMetric: "total_return_ratio",
      expectedSampledCpcvSplitCount: 4,
      sampledCpcvSplitCount: 4,
      sampledCpcvSplitCountMatchesExpected: true,
      joinedTrialCount: 4,
      candidateCount: 2,
      returnSampleCount: 3,
      splitRoleCounts: {
        train: 2,
        validation: 1,
        test: 1
      },
      splitMetricMatrix: [],
      selectedCandidateKey: "deterministic_fixture|sha256:prompt",
      selectedTrainAverageTotalReturnRatio: 0.02,
      pboLikeScore: 0.25,
      holdoutDegradation: [],
      warnings: ["selection bias warning"]
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
      averageExposureRatio: 0.55,
      averageCashRatio: 0.45,
      averageTimeInMarketRatio: 0.8,
      averageFinalCashRatio: 0.35,
      averageFinalPositionRatio: 0.65,
      averageTargetExposureRatio: 0.75,
      averageTargetExposureGapRatio: 0.08,
      averageFinalTargetExposureGapRatio: 0.05,
      totalTradeCount: 8,
      averageTradeCount: 2.666667,
      totalAiDecisionFailureCount: 0,
      totalRejectedCount: 1,
      totalMeaningfulRejectCount: 1,
      totalDustRejectCount: 0,
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
    byValidationSplitRole: {
      train: {
        key: "train",
        runCount: 2,
        completedCount: 2,
        skippedCount: 0,
        failedCount: 0,
        returnSampleCount: 2,
        averageTotalReturnRatio: 0.02,
        medianTotalReturnRatio: 0.02,
        minTotalReturnRatio: 0.005,
        maxTotalReturnRatio: 0.035,
        winRate: 1,
        averageFinalVirtualNetWorthKrw: 1_020_000,
        totalTradeCount: 4,
        averageTradeCount: 2,
        totalRejectedCount: 0,
        runIds: ["run_0", "run_1"]
      },
      validation: {
        key: "validation",
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
      test: {
        key: "test",
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
