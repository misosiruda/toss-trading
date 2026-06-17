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

const dashboardNavigation = bindDashboardNavigation({
  isFileMode,
  onVirtualReplaysPage: () => void refreshBatchRuns().catch(() => undefined),
  onOtherPage: clearBatchRunsPolling
});

bindDecisionFilterControls();

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

  renderDashboard(data);
  showDashboardEndpointResult(failures);
}

function isFileMode() {
  return window.location.protocol === "file:";
}

function renderDashboard(data) {
  rememberSymbolMetadata(data);

  const portfolio = data.portfolio?.portfolio ?? null;
  const reportPortfolio = data.report?.portfolio ?? null;
  const source = data.source ?? {};
  const report = data.report ?? {};

  renderDashboardMetrics(data);

  renderPositions(
    portfolio?.positions ?? [],
    reportPortfolio?.virtualNetWorthKrw ?? null
  );
  renderSourceSummary(source, data.scheduler);
  state.auditEvents = data.audit?.events ?? [];
  state.trades = data.trades?.trades ?? [];
  state.decisionItems = flattenDecisionRecords(data.decisions?.decisions ?? []);
  updateFilterControls();
  renderDecisionTimeline();
  renderDecisionPerformance(data);
  renderDailyReport(report);
  renderReplayReport(data.replay);
  renderReplayProgress(data.replayProgress);
  renderBatchReplayReport(data.batchReplay);
  renderBatchReplayRuns(data.batchRuns);
  scheduleBatchRunsPolling(data.batchRuns);
  renderPortfolioPerformance(data);
  renderBenchmarkComparison(data);
  renderExecutionCostDiagnostics(data);
  renderMarketMonitor(data);
  renderExposureBreakdown(data);
  renderEventCoverage(data);
  renderIncomeGoalPanel(data);
  scheduleReplayProgressPolling(data.replayProgress, {
    onCompleted: loadDashboard
  });
  renderRiskSummary(report.riskSummary, report.decisionOutcome);
  renderPortfolioRiskMetrics(data);
  renderTrades(state.trades);
  renderPackets(data.packets?.packets ?? []);
  renderLiveReplaySections(data.replayProgress);
}
