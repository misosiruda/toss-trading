import {
  endpointFailures,
  fetchEndpointData
} from "./apiClient.js";
import {
  hideError,
  setStatus,
  setText,
  showError
} from "./dom.js";
import {
  formatDateTime,
  formatKrw
} from "./formatters.js";
import {
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
  renderReplayProgress,
  replayProgressPortfolio
} from "./replayProgressRenderers.js";
import {
  renderLiveReplaySections,
  scheduleReplayProgressPolling
} from "./replayProgressCoordinator.js";
import { bindDashboardNavigation } from "./router.js";
import {
  fileModeDashboardUrl,
  state
} from "./state.js";
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

document.querySelectorAll("[data-action-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.filters.action = button.getAttribute("data-action-filter") ?? "ALL";
    updateFilterControls();
    renderDecisionTimeline();
  });
});

document.getElementById("symbol-filter")?.addEventListener("input", (event) => {
  const target = event.target;
  state.filters.symbol = target instanceof HTMLInputElement ? target.value : "";
  renderDecisionTimeline();
});

dashboardNavigation.applyDashboardRoute();
if (isFileMode()) {
  showFileModeNotice();
} else {
  void loadDashboard().catch(() => undefined);
}

async function loadDashboard() {
  state.refreshStartedAt = new Date();
  hideError();
  setStatus("api-status", "loading", "새로고침 중");

  const data = await fetchEndpointData();
  const failures = endpointFailures(data);

  renderDashboard(data);
  if (failures.length) {
    setStatus("api-status", "degraded", "부분 연결");
    showError(`부분 조회 실패: ${failures.join(", ")}`);
  } else {
    setStatus("api-status", "ok", "연결됨");
  }
}

function isFileMode() {
  return window.location.protocol === "file:";
}

function showFileModeNotice() {
  setStatus("api-status", "degraded", "서버 URL 필요");
  showError(
    `대시보드는 로컬 운영 API가 필요합니다. ${fileModeDashboardUrl} 로 열어주세요.`
  );
}

function renderDashboard(data) {
  rememberSymbolMetadata(data);

  const portfolio = data.portfolio?.portfolio ?? null;
  const reportPortfolio = data.report?.portfolio ?? null;
  const replayPortfolio = replayProgressPortfolio(data.replayProgress);
  const source = data.source ?? {};
  const report = data.report ?? {};

  setText(
    "metric-net-worth",
    formatKrw(
      replayPortfolio?.virtualNetWorthKrw ?? reportPortfolio?.virtualNetWorthKrw
    )
  );
  setText(
    "metric-cash",
    formatKrw(
      replayPortfolio?.cashKrw ?? portfolio?.cashKrw ?? reportPortfolio?.cashKrw
    )
  );
  setText(
    "metric-positions",
    String(
      replayPortfolio?.positionCount ?? portfolio?.positions?.length ?? 0
    )
  );
  setText("metric-source", source.status ?? "unknown");
  setStatus("source-status", source.status ?? "unknown", source.status ?? "unknown");
  setText(
    "portfolio-updated",
    portfolio?.updatedAt ? `updated ${formatDateTime(portfolio.updatedAt)}` : "no portfolio"
  );

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
