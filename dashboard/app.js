import {
  endpointFailures,
  fetchEndpointData
} from "./apiClient.js";
import {
  renderDashboardMetrics,
  showDashboardEndpointResult,
  showDashboardLoadingStatus,
  showFileModeNotice
} from "./dashboardStatusRenderers.js";
import { currentSimulationDashboardData } from "./currentSimulationData.js";
import {
  bindDecisionFilterControls,
  flattenDecisionRecords,
  renderDecisionPerformance,
  renderDecisionTimeline,
  renderRiskSummary,
  updateFilterControls
} from "./decisionRenderers.js";
import {
  clearBatchRunsPolling,
  refreshBatchRuns,
  renderBatchReplayRuns,
  scheduleBatchRunsPolling
} from "./batchRunRenderers.js";
import {
  renderBatchReplayReport,
  renderDailyReport,
  renderReplayResearchReport,
  renderReplayReport
} from "./reportRenderers.js";
import {
  renderBenchmarkComparison,
  renderEventCoverage,
  renderExecutionCostDiagnostics,
  renderExposureBreakdown,
  renderIncomeGoalPanel,
  renderMarketMonitor,
  renderPortfolioPerformance,
  renderPortfolioRiskMetrics
} from "./portfolioRenderers.js";
import {
  renderReplayProgress
} from "./replayProgressRenderers.js";
import {
  renderLiveReplaySections,
  scheduleReplayProgressPolling
} from "./replayProgressCoordinator.js";
import { bindDashboardNavigation } from "./router.js";
import { bindSimulationFormControls } from "./simulationForm.js";
import { state } from "./state.js";
import {
  rememberSymbolMetadata,
  renderSourceSummary
} from "./sourceRenderers.js";
import {
  renderPackets,
  renderPositions,
  renderTrades
} from "./tableRenderers.js";

document.getElementById("refresh-button")?.addEventListener("click", () => {
  if (isFileMode()) {
    showFileModeNotice();
    return;
  }
  void loadDashboard().catch(() => undefined);
});

window.addEventListener("batch-runs-refreshed", (event) => {
  const payload = event.detail;
  if (!payload || !state.lastEndpointData) {
    return;
  }
  event.preventDefault();
  state.lastEndpointData = {
    ...state.lastEndpointData,
    batchRuns: payload
  };
  renderDashboard(state.lastEndpointData);
});

const dashboardNavigation = bindDashboardNavigation({
  isFileMode,
  onBatchRunsPage: () => void refreshBatchRuns().catch(() => undefined),
  onOtherPage: clearBatchRunsPolling
});

bindDecisionFilterControls();
bindSimulationFormControls();

dashboardNavigation.applyDashboardRoute();
if (isFileMode()) {
  showFileModeNotice();
} else {
  void loadDashboard().catch(() => undefined);
}

async function loadDashboard() {
  state.refreshStartedAt = new Date();
  showDashboardLoadingStatus();

  const data = await fetchEndpointData();
  const failures = endpointFailures(data);

  state.lastEndpointData = data;
  renderDashboard(data);
  showDashboardEndpointResult(failures);
}

function isFileMode() {
  return window.location.protocol === "file:";
}

function renderDashboard(data) {
  const dashboardData = currentSimulationDashboardData(data);
  rememberSymbolMetadata(dashboardData);

  const portfolio = dashboardData.portfolio?.portfolio ?? null;
  const reportPortfolio = dashboardData.report?.portfolio ?? null;
  const source = dashboardData.source ?? {};
  const report = dashboardData.report ?? {};

  renderDashboardMetrics(dashboardData);

  renderPositions(
    portfolio?.positions ?? [],
    reportPortfolio?.virtualNetWorthKrw ?? null
  );
  renderSourceSummary(source, dashboardData.scheduler);
  state.auditEvents = dashboardData.audit?.events ?? [];
  state.trades = dashboardData.trades?.trades ?? [];
  state.riskDecisions =
    dashboardData.currentRunArtifacts?.riskDecisions ??
    dashboardData.replayProgress?.progress?.recentRiskDecisions ??
    [];
  state.decisionItems = flattenDecisionRecords(
    dashboardData.decisions?.decisions ?? []
  );
  updateFilterControls();
  renderDecisionTimeline();
  renderDecisionPerformance(dashboardData);
  renderDailyReport(report);
  renderReplayReport(dashboardData.replay);
  renderReplayProgress(dashboardData.replayProgress);
  renderReplayResearchReport(dashboardData.researchReplay);
  renderBatchReplayReport(dashboardData.batchReplay);
  renderBatchReplayRuns(dashboardData.batchRuns);
  scheduleBatchRunsPolling(dashboardData.batchRuns);
  renderPortfolioPerformance(dashboardData);
  renderBenchmarkComparison(dashboardData);
  renderExecutionCostDiagnostics(dashboardData);
  renderMarketMonitor(dashboardData);
  renderExposureBreakdown(dashboardData);
  renderEventCoverage(dashboardData);
  renderIncomeGoalPanel(dashboardData);
  scheduleReplayProgressPolling(dashboardData.replayProgress, {
    onCompleted: loadDashboard
  });
  renderRiskSummary(report.riskSummary, report.decisionOutcome);
  renderPortfolioRiskMetrics(dashboardData);
  renderTrades(state.trades);
  renderPackets(dashboardData.packets?.packets ?? []);
  renderLiveReplaySections(dashboardData.replayProgress);
}
