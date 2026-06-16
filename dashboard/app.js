import {
  endpointErrorMessage,
  endpointFailures,
  endpoints,
  fetchEndpointData,
  fetchJson
} from "./apiClient.js";
import {
  appendDefinition,
  appendEmptyRow,
  cell,
  clear,
  hideError,
  setProgressBar,
  setStatus,
  setText,
  showError
} from "./dom.js";
import {
  formatDateTime,
  formatDurationMs,
  formatKrw,
  performanceBottleneckLabel
} from "./formatters.js";
import { registerSymbolMetadata } from "./metadata.js";
import {
  displayActionLabel,
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
  benchmarkPackets,
  currentPortfolioSummary
} from "./portfolioModel.js";
import { summarizeRecord } from "./reportViewHelpers.js";
import { bindDashboardNavigation } from "./router.js";
import {
  fileModeDashboardUrl,
  replayProgressPollMs,
  state
} from "./state.js";
import {
  renderPackets,
  renderPositions,
  renderTrades,
  symbolCell
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

function rememberSymbolMetadata(data) {
  for (const packet of benchmarkPackets(data)) {
    for (const candidate of packet?.candidates ?? []) {
      registerSymbolMetadata(candidate);
    }
  }
  for (const position of data?.portfolio?.portfolio?.positions ?? []) {
    registerSymbolMetadata(position);
  }
  for (const position of data?.replayProgress?.progress?.currentPortfolio?.positions ?? []) {
    registerSymbolMetadata(position);
  }
  for (const trade of data?.trades?.trades ?? data?.replayProgress?.progress?.recentTrades ?? []) {
    registerSymbolMetadata(trade);
  }
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
  scheduleReplayProgressPolling(data.replayProgress);
  renderRiskSummary(report.riskSummary, report.decisionOutcome);
  renderPortfolioRiskMetrics(data);
  renderTrades(state.trades);
  renderPackets(data.packets?.packets ?? []);
  renderLiveReplaySections(data.replayProgress);
}

function renderReplayProgress(progressPayload) {
  const progress = progressPayload?.progress ?? null;
  const replayPortfolio = currentPortfolioSummary({ replayProgress: progressPayload }, []);
  const status = replayProgressStatus(progressPayload);
  const tickCount = Number(progress?.tickCount ?? 0);
  const completedTickCount = Number(progress?.completedTickCount ?? 0);
  const percent =
    tickCount > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((completedTickCount / tickCount) * 100))
        )
      : 0;

  setStatus("replay-progress-status", status, status);
  setText(
    "replay-progress-ticks",
    tickCount > 0 ? `${completedTickCount}/${tickCount} (${percent}%)` : "-"
  );
  setText("replay-progress-sim-time", formatDateTime(progress?.simulatedAt));
  setText(
    "replay-progress-decisions",
    `${progress?.decisionProviderCallCount ?? 0} 호출 / ${progress?.decisionSkippedCount ?? 0} skip`
  );
  setText("replay-progress-trades", `${progress?.tradeCount ?? 0}건`);
  setText("replay-progress-rejected", `${progress?.rejectedCount ?? 0}건`);
  renderReplayPerformance(progress?.performance ?? null);
  if (replayPortfolio) {
    setText("metric-net-worth", formatKrw(replayPortfolio.virtualNetWorthKrw));
    setText("metric-cash", formatKrw(replayPortfolio.cashKrw));
    setText("metric-positions", String(replayPortfolio.positionCount ?? 0));
  }
  setProgressBar("replay-progress-bar", percent);
  renderReplayProgressEvents(progress?.recentEvents ?? []);
}

function renderReplayPerformance(performance) {
  setText(
    "replay-performance-last-tick",
    formatDurationMs(performance?.lastTickElapsedMs)
  );
  setText(
    "replay-performance-packet-build",
    formatDurationMs(performance?.lastPacketBuildMs)
  );
  setText(
    "replay-performance-decision",
    formatDurationMs(performance?.lastDecisionProviderMs)
  );
  setText(
    "replay-performance-average",
    formatDurationMs(performance?.averageTickElapsedMs)
  );
  setText(
    "replay-performance-eta",
    formatDurationMs(performance?.estimatedRemainingMs)
  );
  setText(
    "replay-performance-bottleneck",
    performanceBottleneckLabel(performance?.bottleneck)
  );
}

function renderLiveReplaySections(progressPayload) {
  if (!isReplayProgressActive(progressPayload)) {
    return;
  }

  const progress = progressPayload?.progress ?? null;
  if (!progress) {
    return;
  }

  rememberSymbolMetadata({ replayProgress: progressPayload });

  const replayPortfolio = currentPortfolioSummary({ replayProgress: progressPayload }, []);
  const positions = replayPortfolio?.positions;
  if (Array.isArray(positions)) {
    renderPositions(positions, replayPortfolio?.virtualNetWorthKrw ?? null);
    setText(
      "portfolio-updated",
      replayPortfolio?.simulatedAt
        ? `sim ${formatDateTime(replayPortfolio.simulatedAt)}`
        : "live replay"
    );
  }

  state.trades = Array.isArray(progress.recentTrades)
    ? progress.recentTrades
    : [];
  state.riskDecisions = Array.isArray(progress.recentRiskDecisions)
    ? progress.recentRiskDecisions
    : [];
  state.decisionItems = flattenDecisionRecords(
    Array.isArray(progress.recentDecisions) ? progress.recentDecisions : []
  );

  updateFilterControls();
  renderDecisionTimeline();
  renderDecisionPerformance({ replayProgress: progressPayload });
  renderRiskSummary(
    replayProgressRiskSummary(progress),
    replayProgressDecisionOutcome(progress)
  );
  renderPortfolioRiskMetrics({ replayProgress: progressPayload });
  renderTrades(state.trades);
  renderPackets(Array.isArray(progress.recentPackets) ? progress.recentPackets : []);
  renderPortfolioPerformance({ replayProgress: progressPayload });
  renderBenchmarkComparison({ replayProgress: progressPayload });
  renderMarketMonitor({ replayProgress: progressPayload });
  renderExposureBreakdown({ replayProgress: progressPayload });
  renderEventCoverage({ replayProgress: progressPayload });
  renderIncomeGoalPanel({ replayProgress: progressPayload });
}

function renderReplayProgressEvents(events) {
  const body = document.getElementById("replay-progress-events-body");
  clear(body);

  if (!events.length) {
    appendEmptyRow(body, 4, "진행 이벤트 없음");
    return;
  }

  for (const event of events.slice(0, 12)) {
    const row = document.createElement("tr");
    row.append(
      cell(formatDateTime(event.simulatedAt)),
      symbolCell(event.market, event.symbol, event),
      cell(replayEventLabel(event)),
      cell(replayEventSummary(event))
    );
    body.append(row);
  }
}

function scheduleReplayProgressPolling(progressPayload) {
  if (state.replayProgressTimer !== null) {
    window.clearTimeout(state.replayProgressTimer);
    state.replayProgressTimer = null;
  }

  const nextStatus = replayProgressStatus(progressPayload);
  state.replayProgressStatus = nextStatus;
  if (!shouldPollReplayProgress(nextStatus)) {
    return;
  }

  state.replayProgressTimer = window.setTimeout(() => {
    state.replayProgressTimer = null;
    void refreshReplayProgress().catch((error) => {
      showError(endpointErrorMessage(endpoints.replayProgress, error));
    });
  }, replayProgressPollMs);
}

async function refreshReplayProgress() {
  if (state.replayProgressInFlight) {
    return;
  }

  state.replayProgressInFlight = true;
  const previousStatus = state.replayProgressStatus;

  try {
    const payload = await fetchJson(endpoints.replayProgress);
    renderReplayProgress(payload);
    renderLiveReplaySections(payload);
    const nextStatus = replayProgressStatus(payload);
    state.replayProgressStatus = nextStatus;

    if (previousStatus === "running" && nextStatus === "completed") {
      await loadDashboard();
      return;
    }

    scheduleReplayProgressPolling(payload);
  } finally {
    state.replayProgressInFlight = false;
  }
}

function renderSourceSummary(source, scheduler) {
  const list = document.getElementById("source-summary");
  clear(list);
  appendDefinition(list, "수집 건수", String(source.totalCount ?? 0));
  appendDefinition(list, "최근 수집", formatDateTime(source.lastCollectedAt));
  appendDefinition(list, "오류 라인", String(source.corruptLineCount ?? 0));
  appendDefinition(list, "명령", summarizeRecord(source.byCommandKey));
  appendDefinition(list, "스케줄러", scheduler?.stateStatus ?? "unknown");
}

function replayProgressStatus(progressPayload) {
  return progressPayload?.progress?.status ?? progressPayload?.status ?? "missing";
}

function replayProgressPortfolio(progressPayload) {
  return progressPayload?.progress?.currentPortfolio ?? null;
}

function isReplayProgressActive(progressPayload) {
  return replayProgressStatus(progressPayload) === "running";
}

function shouldPollReplayProgress(status) {
  return status === "running" || status === "missing" || status === "idle";
}

function replayProgressRiskSummary(progress) {
  const recentRejectedSummaries = (progress?.recentRiskDecisions ?? [])
    .filter((decision) => decision && !decision.approved)
    .map((decision) =>
      [
        decision.packetId,
        decision.symbol ?? "-",
        (decision.rejectCodes ?? []).join(",") || "reject"
      ].join(" ")
    )
    .slice(0, 5);

  return {
    approvedCount: progress?.riskApprovedCount ?? 0,
    rejectedCount: progress?.rejectedCount ?? 0,
    recentRejectedSummaries
  };
}

function replayProgressDecisionOutcome(progress) {
  const items = flattenDecisionRecords(progress?.recentDecisions ?? []);
  const byAction = {};
  for (const item of items) {
    byAction[item.action] = (byAction[item.action] ?? 0) + 1;
  }

  return {
    decisionItemCount: items.length,
    byAction
  };
}

function replayEventLabel(event) {
  if (event.eventType === "RISK_REJECTED") {
    return "반려";
  }
  return displayActionLabel(event.eventType);
}

function replayEventSummary(event) {
  if (event.eventType === "RISK_REJECTED") {
    return `${displayActionLabel(event.action)} · ${(event.rejectCodes ?? []).join(", ") || "reject"}`;
  }
  return `${displayActionLabel(event.action)} · ${formatKrw(event.amountKrw)}`;
}
