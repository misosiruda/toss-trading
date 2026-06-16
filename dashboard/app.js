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
  emptyState,
  hideError,
  paragraph,
  setProgressBar,
  setStatus,
  setText,
  setValueTone,
  showError,
  svgNode
} from "./dom.js";
import {
  compactKrw,
  formatDateTime,
  formatDurationMs,
  formatKrw,
  formatQuantity,
  formatRatio,
  formatSignedKrw,
  formatSignedRatio,
  performanceBottleneckLabel,
  valueToneClass
} from "./formatters.js";
import {
  enrichCandidateForDisplay,
  metadataForSymbol,
  registerSymbolMetadata,
  symbolCodeText,
  symbolDisplayName,
  symbolDisplayText
} from "./metadata.js";
import {
  displayActionLabel,
  flattenDecisionRecords,
  renderDecisionPerformance,
  renderDecisionTimeline,
  renderRiskSummary,
  tagList,
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
  benchmarkPackets,
  currentPortfolioSummary,
  currentTradeList,
  equalWeightBenchmarkReturn,
  initialNetWorthKrw,
  maxDrawdownRatio,
  portfolioPerformanceTimeline,
  portfolioPointFromVirtualPortfolio,
  positionCostBasis,
  positionMarketValue,
  realizedPnlFromTrades,
  rememberPerformancePoint,
  timelineRangeText,
  timelineVolatilityRatio
} from "./portfolioModel.js";
import {
  replayRangeText,
  summarizeRecord
} from "./reportViewHelpers.js";
import { bindDashboardNavigation } from "./router.js";
import {
  fileModeDashboardUrl,
  replayProgressPollMs,
  state
} from "./state.js";

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

function renderPortfolioPerformance(data) {
  const progress = data?.replayProgress?.progress ?? null;
  if (progress?.currentPortfolio) {
    rememberPerformancePoint(
      portfolioPointFromVirtualPortfolio(
        progress.currentPortfolio,
        progress.currentPortfolio.simulatedAt,
        progress.recentPackets?.[0]
      )
    );
  }

  const timeline = portfolioPerformanceTimeline(data);
  const currentPortfolio = currentPortfolioSummary(data, timeline);
  const initialNetWorth = initialNetWorthKrw(data, timeline);
  const latestNetWorth =
    currentPortfolio?.virtualNetWorthKrw ??
    timeline.at(-1)?.virtualNetWorthKrw ??
    null;
  const totalPnl =
    initialNetWorth !== null && latestNetWorth !== null
      ? latestNetWorth - initialNetWorth
      : null;
  const totalReturn =
    initialNetWorth !== null && initialNetWorth > 0 && totalPnl !== null
      ? totalPnl / initialNetWorth
      : null;
  const cashRatio =
    currentPortfolio && currentPortfolio.virtualNetWorthKrw > 0
      ? currentPortfolio.cashKrw / currentPortfolio.virtualNetWorthKrw
      : null;

  setText("performance-asof", currentPortfolio?.simulatedAt ? `sim ${formatDateTime(currentPortfolio.simulatedAt)}` : "-");
  setText("performance-initial-net-worth", formatKrw(initialNetWorth));
  setText("performance-total-pnl", formatSignedKrw(totalPnl));
  setText("performance-total-return", formatSignedRatio(totalReturn));
  setText("performance-cash-ratio", formatRatio(cashRatio));
  setText("performance-max-drawdown", formatRatio(maxDrawdownRatio(timeline)));
  setValueTone("performance-total-pnl", totalPnl);
  setValueTone("performance-total-return", totalReturn);
  setText("performance-chart-range", timelineRangeText(timeline));

  renderNetWorthChart(timeline);
  renderAllocationList(currentPortfolio);
}

function renderBenchmarkComparison(data) {
  const benchmark = buildBenchmarkComparison(data);
  setText("benchmark-range", benchmark.rangeText);
  setText("benchmark-portfolio-return", formatSignedRatio(benchmark.portfolioReturnRatio));
  setText("benchmark-equal-weight-return", formatSignedRatio(benchmark.equalWeightReturnRatio));
  setText("benchmark-alpha", formatSignedRatio(benchmark.alphaRatio));
  setText("benchmark-verdict", benchmark.verdict);
  setValueTone("benchmark-portfolio-return", benchmark.portfolioReturnRatio);
  setValueTone("benchmark-equal-weight-return", benchmark.equalWeightReturnRatio);
  setValueTone("benchmark-alpha", benchmark.alphaRatio);
  setText("benchmark-portfolio-bar-label", formatSignedRatio(benchmark.portfolioReturnRatio));
  setText("benchmark-equal-weight-bar-label", formatSignedRatio(benchmark.equalWeightReturnRatio));
  setBenchmarkBar("benchmark-portfolio-bar", benchmark.portfolioReturnRatio, benchmark.maxAbsReturnRatio);
  setBenchmarkBar("benchmark-equal-weight-bar", benchmark.equalWeightReturnRatio, benchmark.maxAbsReturnRatio);
  renderBenchmarkMovers(benchmark.movers);
}

function buildBenchmarkComparison(data) {
  const reportBenchmark = data?.replay?.report?.benchmarks ?? null;
  const timeline = portfolioPerformanceTimeline(data);
  const current = currentPortfolioSummary(data, timeline);
  const initial = initialNetWorthKrw(data, timeline);
  const latestNetWorth = current?.virtualNetWorthKrw ?? timeline.at(-1)?.virtualNetWorthKrw ?? null;
  const portfolioReturnRatio =
    reportBenchmark?.strategy?.totalReturnRatio ??
    (initial !== null && initial > 0 && latestNetWorth !== null
      ? (latestNetWorth - initial) / initial
      : null);
  const packets = benchmarkPackets(data);
  const equalWeight = equalWeightBenchmarkReturn(packets);
  const equalWeightReturnRatio =
    reportBenchmark?.equalWeightBuyAndHold?.totalReturnRatio ??
    equalWeight.returnRatio;
  const reportRangeText = data?.replay?.report?.simulatedRange
    ? replayRangeText(data.replay.report.simulatedRange)
    : null;
  const alphaRatio =
    portfolioReturnRatio !== null && equalWeightReturnRatio !== null
      ? portfolioReturnRatio - equalWeightReturnRatio
      : null;
  const maxAbsReturnRatio = Math.max(
    Math.abs(portfolioReturnRatio ?? 0),
    Math.abs(equalWeightReturnRatio ?? 0),
    0.01
  );

  return {
    portfolioReturnRatio,
    equalWeightReturnRatio,
    alphaRatio,
    maxAbsReturnRatio,
    movers: equalWeight.movers,
    rangeText: reportRangeText ?? equalWeight.rangeText ?? timelineRangeText(timeline),
    verdict:
      alphaRatio === null
        ? "-"
        : alphaRatio > 0
          ? "AI 우위"
          : alphaRatio < 0
            ? "벤치마크 우위"
            : "동률"
  };
}

function renderExecutionCostDiagnostics(data) {
  const summary = buildExecutionCostSummary(data);
  setText("execution-cost-source", summary.sourceText);
  setText("execution-cost-fee-drag", formatKrw(summary.feeDragKrw));
  setText("execution-cost-turnover", formatRatio(summary.turnoverRatio));
  setText("execution-cost-average-ratio", formatRatio(summary.averageCostRatio));
  setText("execution-cost-realized-pnl", formatSignedKrw(summary.realizedPnlKrw));
  setValueTone("execution-cost-realized-pnl", summary.realizedPnlKrw);

  const detail = document.getElementById("execution-cost-detail");
  clear(detail);
  appendDefinition(detail, "가상 체결 금액", formatKrw(summary.grossAmountKrw));
  appendDefinition(detail, "수수료", formatKrw(summary.feeKrw));
  appendDefinition(detail, "세금", formatKrw(summary.taxKrw));
  appendDefinition(detail, "슬리피지", formatKrw(summary.slippageKrw));
  appendDefinition(detail, "체결 수", `${summary.tradeCount}건`);
}

function buildExecutionCostSummary(data) {
  const reportBenchmark = data?.replay?.report?.benchmarks?.strategy ?? null;
  const trades = currentTradeList(data);
  const grossAmountKrw = trades.reduce(
    (sum, trade) => sum + Number(trade.grossAmountKrw ?? trade.amountKrw ?? 0),
    0
  );
  const feeKrw = trades.reduce((sum, trade) => sum + Number(trade.feeKrw ?? 0), 0);
  const taxKrw = trades.reduce((sum, trade) => sum + Number(trade.taxKrw ?? 0), 0);
  const slippageKrw = trades.reduce(
    (sum, trade) => sum + Number(trade.slippageKrw ?? 0),
    0
  );
  const observedFeeDragKrw = feeKrw + taxKrw + slippageKrw;
  const feeDragKrw = Number.isFinite(Number(reportBenchmark?.feeDragKrw))
    ? Number(reportBenchmark.feeDragKrw)
    : observedFeeDragKrw;
  const turnoverRatio = Number.isFinite(Number(reportBenchmark?.turnoverRatio))
    ? Number(reportBenchmark.turnoverRatio)
    : executionTurnoverRatio(data, grossAmountKrw);
  const averageCostRatio =
    grossAmountKrw > 0 ? observedFeeDragKrw / grossAmountKrw : null;
  const realizedPnlKrw =
    data?.replay?.report?.analytics?.virtualPnl?.realizedPnlKrw ??
    data?.report?.analytics?.virtualPnl?.realizedPnlKrw ??
    realizedPnlFromTrades(trades);

  return {
    sourceText: reportBenchmark ? "replay benchmark" : "recent virtual trades",
    grossAmountKrw,
    feeKrw,
    taxKrw,
    slippageKrw,
    feeDragKrw,
    turnoverRatio,
    averageCostRatio,
    realizedPnlKrw,
    tradeCount: trades.length
  };
}

function executionTurnoverRatio(data, grossAmountKrw) {
  const timeline = portfolioPerformanceTimeline(data);
  const baseline = initialNetWorthKrw(data, timeline);
  return baseline !== null && baseline > 0 ? grossAmountKrw / baseline : null;
}

function setBenchmarkBar(id, value, maxAbsValue) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  const ratio =
    value === null || value === undefined || !Number.isFinite(Number(value))
      ? 0
      : Math.abs(Number(value)) / Math.max(maxAbsValue, 0.01);
  node.className = valueToneClass(value);
  node.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
}

function renderBenchmarkMovers(movers) {
  const list = document.getElementById("benchmark-movers");
  clear(list);
  if (!list) {
    return;
  }
  if (!movers.length) {
    list.append(emptyState("벤치마크 종목 데이터 없음"));
    return;
  }

  for (const mover of movers.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "benchmark-mover";
    const symbol = document.createElement("strong");
    symbol.textContent = symbolDisplayText(mover.market, mover.symbol, mover);
    const value = document.createElement("span");
    value.className = valueToneClass(mover.returnRatio);
    value.textContent = `${formatSignedRatio(mover.returnRatio)} · ${formatKrw(mover.startPriceKrw)} → ${formatKrw(mover.latestPriceKrw)}`;
    row.append(symbol, value);
    list.append(row);
  }
}

function renderMarketMonitor(data) {
  const monitor = buildMarketMonitor(data);
  setText("market-monitor-range", monitor.rangeText);
  setText(
    "market-monitor-gainers-count",
    monitor.gainers.length ? `${monitor.gainers.length}종목` : "-"
  );
  setText(
    "market-monitor-losers-count",
    monitor.losers.length ? `${monitor.losers.length}종목` : "-"
  );
  setText(
    "market-monitor-turnover-count",
    monitor.turnoverLeaders.length ? `${monitor.turnoverLeaders.length}종목` : "-"
  );
  setText(
    "market-monitor-extreme-count",
    monitor.extremes.length ? `${monitor.extremes.length}종목` : "-"
  );
  renderMarketMonitorList(
    "market-monitor-gainers",
    monitor.gainers,
    "상승 종목 데이터 없음",
    (item) => marketMonitorReturnMeta(item)
  );
  renderMarketMonitorList(
    "market-monitor-losers",
    monitor.losers,
    "하락 종목 데이터 없음",
    (item) => marketMonitorReturnMeta(item)
  );
  renderMarketMonitorList(
    "market-monitor-turnover",
    monitor.turnoverLeaders,
    "거래/가격 데이터 없음",
    (item) =>
      item.turnoverKrw !== null
        ? `${compactKrw(item.turnoverKrw)} · 거래량 ${formatQuantity(item.volume)}`
        : `관측가 ${formatKrw(item.latestPriceKrw)} · 거래량 없음`
  );
  renderMarketMonitorList(
    "market-monitor-extremes",
    monitor.extremes,
    "구간 고점/저점 데이터 없음",
    (item) => marketMonitorExtremeMeta(item)
  );
}

function buildMarketMonitor(data) {
  const packets = benchmarkPackets(data)
    .filter((packet) => packet?.generatedAt && Array.isArray(packet.candidates))
    .sort((left, right) => new Date(left.generatedAt) - new Date(right.generatedAt));

  if (!packets.length) {
    return {
      rangeText: "-",
      gainers: [],
      losers: [],
      turnoverLeaders: [],
      extremes: []
    };
  }

  const bySymbol = new Map();
  for (const packet of packets) {
    for (const candidate of packet.candidates ?? []) {
      const price = Number(candidate.lastPriceKrw);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }

      const key = `${candidate.market}:${candidate.symbol}`;
      const current =
        bySymbol.get(key) ??
        {
          market: candidate.market,
          symbol: candidate.symbol,
          name: symbolDisplayName(candidate.market, candidate.symbol, candidate),
          sector: metadataForSymbol(candidate.market, candidate.symbol, candidate).sector,
          industry: metadataForSymbol(candidate.market, candidate.symbol, candidate).industry,
          firstPriceKrw: price,
          latestPriceKrw: price,
          highPriceKrw: price,
          lowPriceKrw: price,
          volume: null,
          turnoverKrw: null,
          observations: 0
        };
      const highPrice = Number(candidate.highPriceKrw ?? price);
      const lowPrice = Number(candidate.lowPriceKrw ?? price);
      const volume = Number(candidate.volume);

      current.name =
        symbolDisplayName(candidate.market, candidate.symbol, candidate) ??
        current.name;
      current.latestPriceKrw = price;
      current.highPriceKrw = Math.max(
        current.highPriceKrw,
        Number.isFinite(highPrice) ? highPrice : price,
        price
      );
      current.lowPriceKrw = Math.min(
        current.lowPriceKrw,
        Number.isFinite(lowPrice) ? lowPrice : price,
        price
      );
      current.volume = Number.isFinite(volume) ? volume : current.volume;
      current.turnoverKrw =
        current.volume !== null ? Math.round(price * current.volume) : current.turnoverKrw;
      current.observations += 1;
      bySymbol.set(key, current);
    }
  }

  const items = Array.from(bySymbol.values()).map((item) => {
    const returnRatio =
      item.firstPriceKrw > 0
        ? (item.latestPriceKrw - item.firstPriceKrw) / item.firstPriceKrw
        : null;
    const highGapRatio =
      item.highPriceKrw > 0
        ? (item.highPriceKrw - item.latestPriceKrw) / item.highPriceKrw
        : null;
    const lowLiftRatio =
      item.lowPriceKrw > 0
        ? (item.latestPriceKrw - item.lowPriceKrw) / item.lowPriceKrw
        : null;
    const nearHigh =
      highGapRatio !== null &&
      lowLiftRatio !== null &&
      Math.abs(highGapRatio) <= Math.abs(lowLiftRatio);
    return {
      ...item,
      returnRatio,
      highGapRatio,
      lowLiftRatio,
      extremeType: nearHigh ? "high" : "low",
      extremeDistanceRatio: nearHigh ? highGapRatio : lowLiftRatio
    };
  });

  const first = packets[0];
  const last = packets.at(-1);
  const turnoverLeaders = items
    .filter((item) => item.turnoverKrw !== null)
    .sort((left, right) => right.turnoverKrw - left.turnoverKrw);

  return {
    rangeText: `${formatDateTime(first.generatedAt)} - ${formatDateTime(last.generatedAt)} · ${items.length}종목`,
    gainers: items
      .filter((item) => (item.returnRatio ?? 0) > 0)
      .sort((left, right) => right.returnRatio - left.returnRatio),
    losers: items
      .filter((item) => (item.returnRatio ?? 0) < 0)
      .sort((left, right) => left.returnRatio - right.returnRatio),
    turnoverLeaders: turnoverLeaders.length
      ? turnoverLeaders
      : items
          .slice()
          .sort((left, right) => right.latestPriceKrw - left.latestPriceKrw),
    extremes: items
      .filter((item) => item.extremeDistanceRatio !== null)
      .sort(
        (left, right) =>
          Math.abs(left.extremeDistanceRatio) -
          Math.abs(right.extremeDistanceRatio)
      )
  };
}

function renderMarketMonitorList(id, items, emptyMessage, metaFactory) {
  const list = document.getElementById(id);
  clear(list);
  if (!list) {
    return;
  }

  if (!items.length) {
    list.append(emptyState(emptyMessage));
    return;
  }

  for (const item of items.slice(0, 5)) {
    const row = document.createElement("div");
    row.className = "market-monitor-item";
    const label = document.createElement("strong");
    label.textContent = symbolDisplayName(item.market, item.symbol, item);
    const name = document.createElement("span");
    name.textContent = symbolCodeText(item.market, item.symbol);
    const meta = document.createElement("span");
    meta.className = valueToneClass(item.returnRatio);
    meta.textContent = metaFactory(item);
    row.append(label, name, meta);
    list.append(row);
  }
}

function marketMonitorReturnMeta(item) {
  return `${formatSignedRatio(item.returnRatio)} · ${formatKrw(item.firstPriceKrw)} → ${formatKrw(item.latestPriceKrw)}`;
}

function marketMonitorExtremeMeta(item) {
  if (item.extremeType === "high") {
    return `고점까지 ${formatRatio(item.highGapRatio)} · 고점 ${formatKrw(item.highPriceKrw)}`;
  }
  return `저점 대비 ${formatRatio(item.lowLiftRatio)} · 저점 ${formatKrw(item.lowPriceKrw)}`;
}

function renderExposureBreakdown(data) {
  const exposure = buildExposureBreakdown(data);
  setText("exposure-coverage", exposure.coverageText);
  setText(
    "exposure-sector-count",
    exposure.sectors.length ? `${exposure.sectors.length}개` : "-"
  );
  setText(
    "exposure-industry-count",
    exposure.industries.length ? `${exposure.industries.length}개` : "-"
  );
  setText(
    "exposure-position-count",
    exposure.positionCount ? `${exposure.positionCount}포지션` : "-"
  );
  renderExposureList(
    "exposure-sector-list",
    exposure.sectors,
    "섹터 노출 데이터 없음"
  );
  renderExposureList(
    "exposure-industry-list",
    exposure.industries,
    "산업 노출 데이터 없음"
  );

  const detail = document.getElementById("exposure-coverage-detail");
  clear(detail);
  appendDefinition(detail, "섹터 메타데이터", `${exposure.sectorCoveredCount} / ${exposure.positionCount}`);
  appendDefinition(detail, "산업 메타데이터", `${exposure.industryCoveredCount} / ${exposure.positionCount}`);
  appendDefinition(detail, "미분류 평가금액", formatKrw(exposure.unclassifiedValueKrw));
  appendDefinition(detail, "데이터 소스", exposure.sourceText);
}

function buildExposureBreakdown(data) {
  const timeline = portfolioPerformanceTimeline(data);
  const portfolio = currentPortfolioSummary(data, timeline);
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const netWorth = Number(portfolio?.virtualNetWorthKrw ?? 0);
  const candidateMeta = latestCandidateMetadata(data);
  const sectorGroups = new Map();
  const industryGroups = new Map();
  let sectorCoveredCount = 0;
  let industryCoveredCount = 0;
  let unclassifiedValueKrw = 0;

  for (const position of positions) {
    const key = `${position.market}:${position.symbol}`;
    const meta = candidateMeta.get(key) ?? metadataForSymbol(position.market, position.symbol, position);
    const valueKrw = positionMarketValue(position);
    const sector = cleanExposureLabel(meta?.sector ?? meta?.category);
    const industry = cleanExposureLabel(meta?.industry ?? meta?.theme);
    const sectorLabel = sector ?? "미분류";
    const industryLabel = industry ?? "미분류";

    if (sector) {
      sectorCoveredCount += 1;
    }
    if (industry) {
      industryCoveredCount += 1;
    }
    if (!sector || !industry) {
      unclassifiedValueKrw += valueKrw;
    }

    addExposureGroup(sectorGroups, sectorLabel, valueKrw, position, netWorth);
    addExposureGroup(industryGroups, industryLabel, valueKrw, position, netWorth);
  }

  return {
    positionCount: positions.length,
    sectorCoveredCount,
    industryCoveredCount,
    unclassifiedValueKrw,
    sectors: sortedExposureGroups(sectorGroups),
    industries: sortedExposureGroups(industryGroups),
    coverageText: positions.length
      ? `섹터 ${sectorCoveredCount}/${positions.length} · 산업 ${industryCoveredCount}/${positions.length}`
      : "-",
    sourceText: candidateMeta.size ? "market packet metadata + display fallback" : "display fallback"
  };
}

function latestCandidateMetadata(data) {
  const packets = benchmarkPackets(data)
    .filter((packet) => packet?.generatedAt && Array.isArray(packet.candidates))
    .sort((left, right) => new Date(left.generatedAt) - new Date(right.generatedAt));
  const meta = new Map();
  for (const packet of packets) {
    for (const candidate of packet.candidates ?? []) {
      meta.set(`${candidate.market}:${candidate.symbol}`, enrichCandidateForDisplay(candidate));
    }
  }
  return meta;
}

function cleanExposureLabel(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function addExposureGroup(groups, label, valueKrw, position, netWorth) {
  const current =
    groups.get(label) ?? {
      label,
      valueKrw: 0,
      symbols: new Set(),
      weightRatio: null
    };
  current.valueKrw += valueKrw;
  current.symbols.add(symbolDisplayText(position.market, position.symbol, position));
  current.weightRatio = netWorth > 0 ? current.valueKrw / netWorth : null;
  groups.set(label, current);
}

function sortedExposureGroups(groups) {
  return Array.from(groups.values())
    .map((group) => ({
      label: group.label,
      valueKrw: group.valueKrw,
      weightRatio: group.weightRatio,
      symbols: Array.from(group.symbols).sort()
    }))
    .sort((left, right) => right.valueKrw - left.valueKrw);
}

function renderExposureList(id, groups, emptyMessage) {
  const list = document.getElementById(id);
  clear(list);
  if (!list) {
    return;
  }

  if (!groups.length) {
    list.append(emptyState(emptyMessage));
    return;
  }

  const maxWeight = Math.max(
    ...groups.map((group) => Number(group.weightRatio ?? 0)),
    0.01
  );
  for (const group of groups.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "exposure-item";
    const header = document.createElement("div");
    header.className = "exposure-item-header";
    const label = document.createElement("strong");
    label.textContent = group.label;
    const value = document.createElement("span");
    value.textContent = `${formatKrw(group.valueKrw)} · ${formatRatio(group.weightRatio)}`;
    header.append(label, value);

    const bar = document.createElement("div");
    bar.className = "exposure-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.max(
      2,
      Math.min(100, (Number(group.weightRatio ?? 0) / maxWeight) * 100)
    )}%`;
    bar.append(fill);

    const symbols = document.createElement("p");
    symbols.className = "exposure-symbols";
    symbols.textContent = group.symbols.join(", ");
    item.append(header, bar, symbols);
    list.append(item);
  }
}

function renderEventCoverage(data) {
  const coverage = buildEventCoverage(data);
  setText("event-coverage", coverage.coverageText);
  setText(
    "event-explicit-count",
    coverage.explicitEvents.length ? `${coverage.explicitEvents.length}종목` : "-"
  );
  setText(
    "event-signal-count",
    coverage.signalEvents.length ? `${coverage.signalEvents.length}종목` : "-"
  );
  setStatus("event-gap-status", coverage.status, coverage.statusLabel);
  renderEventList(
    "event-explicit-list",
    coverage.explicitEvents,
    "명시 뉴스/이벤트 데이터 없음"
  );
  renderEventList(
    "event-signal-list",
    coverage.signalEvents,
    "신호 기반 이벤트 없음"
  );

  const detail = document.getElementById("event-gap-detail");
  clear(detail);
  appendDefinition(detail, "후보 종목", String(coverage.candidateCount));
  appendDefinition(detail, "뉴스 참조", `${coverage.newsCoveredCount} / ${coverage.candidateCount}`);
  appendDefinition(detail, "이벤트 태그", `${coverage.eventTagCoveredCount} / ${coverage.candidateCount}`);
  appendDefinition(detail, "신호 단서", `${coverage.signalCoveredCount} / ${coverage.candidateCount}`);
  appendDefinition(detail, "최근 packet", coverage.latestPacketText);
}

function buildEventCoverage(data) {
  const packets = benchmarkPackets(data)
    .filter((packet) => packet?.generatedAt && Array.isArray(packet.candidates))
    .sort((left, right) => new Date(left.generatedAt) - new Date(right.generatedAt));
  const latest = packets.at(-1);
  const candidates = latest?.candidates ?? [];
  const explicitEvents = [];
  const signalEvents = [];
  let newsCoveredCount = 0;
  let eventTagCoveredCount = 0;
  let signalCoveredCount = 0;

  for (const candidate of candidates) {
    const eventTags = Array.isArray(candidate.eventTags) ? candidate.eventTags : [];
    const newsRefs = Array.isArray(candidate.newsRefs) ? candidate.newsRefs : [];
    const signalCodes = eventSignalReasonCodes(candidate.reasonCodes ?? []);

    if (newsRefs.length) {
      newsCoveredCount += 1;
    }
    if (eventTags.length) {
      eventTagCoveredCount += 1;
    }
    if (signalCodes.length) {
      signalCoveredCount += 1;
    }
    if (eventTags.length || newsRefs.length) {
      explicitEvents.push({
        market: candidate.market,
        symbol: candidate.symbol,
        name: symbolDisplayName(candidate.market, candidate.symbol, candidate),
        tags: eventTags,
        refs: newsRefs,
        meta: [
          eventTags.length ? eventTags.join(", ") : null,
          newsRefs.length ? `뉴스 ${newsRefs.length}` : null
        ].filter(Boolean).join(" · ")
      });
    }
    if (signalCodes.length) {
      signalEvents.push({
        market: candidate.market,
        symbol: candidate.symbol,
        name: symbolDisplayName(candidate.market, candidate.symbol, candidate),
        tags: signalCodes,
        refs: candidate.sourceRefs ?? [],
        meta: signalCodes.slice(0, 4).join(", ")
      });
    }
  }

  const candidateCount = candidates.length;
  const status =
    candidateCount === 0
      ? "missing"
      : newsCoveredCount || eventTagCoveredCount
        ? "ok"
        : signalCoveredCount
          ? "degraded"
          : "missing";

  return {
    candidateCount,
    newsCoveredCount,
    eventTagCoveredCount,
    signalCoveredCount,
    explicitEvents,
    signalEvents,
    latestPacketText: latest
      ? `${latest.packetId} · ${formatDateTime(latest.generatedAt)}`
      : "-",
    coverageText: candidateCount
      ? `뉴스 ${newsCoveredCount}/${candidateCount} · 이벤트 ${eventTagCoveredCount}/${candidateCount} · 신호 ${signalCoveredCount}/${candidateCount}`
      : "-",
    status,
    statusLabel:
      status === "ok"
        ? "수집됨"
        : status === "degraded"
          ? "신호만"
          : "없음"
  };
}

function eventSignalReasonCodes(reasonCodes) {
  return reasonCodes.filter((code) => {
    const normalized = String(code).toUpperCase();
    return (
      normalized.includes("EARNINGS") ||
      normalized.includes("NEWS") ||
      normalized.includes("SIGNAL") ||
      normalized.includes("MOMENTUM") ||
      normalized.includes("VOLUME") ||
      normalized.includes("TREND")
    );
  });
}

function renderEventList(id, items, emptyMessage) {
  const list = document.getElementById(id);
  clear(list);
  if (!list) {
    return;
  }

  if (!items.length) {
    list.append(emptyState(emptyMessage));
    return;
  }

  for (const item of items.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "event-item";
    const label = document.createElement("strong");
    label.textContent = symbolDisplayName(item.market, item.symbol, item);
    const name = document.createElement("span");
    name.textContent = symbolCodeText(item.market, item.symbol);
    const meta = document.createElement("span");
    meta.textContent = item.meta || "-";
    row.append(label, name, meta);
    list.append(row);
  }
}

function renderIncomeGoalPanel(data) {
  const summary = buildIncomeGoalSummary(data);
  setStatus("income-goal-status", summary.status, summary.statusLabel);
  setText("goal-baseline-net-worth", formatKrw(summary.baselineNetWorthKrw));
  setText("goal-current-net-worth", formatKrw(summary.currentNetWorthKrw));
  setText("goal-target-progress", formatRatio(summary.goalProgressRatio));
  setText("income-realized-pnl", formatSignedKrw(summary.realizedPnlKrw));
  setText("income-turnover-ratio", formatRatio(summary.turnoverRatio));
  setText("income-dividend-status", summary.dividendStatus);
  setValueTone("income-realized-pnl", summary.realizedPnlKrw);
  setGoalProgressBar("goal-progress-bar", summary.goalProgressRatio);

  const detail = document.getElementById("income-goal-detail");
  clear(detail);
  appendDefinition(detail, "목표 자산", formatKrw(summary.targetNetWorthKrw));
  appendDefinition(detail, "목표 기준", summary.baselineSource);
  appendDefinition(detail, "총 수익률", formatSignedRatio(summary.totalReturnRatio));
  appendDefinition(detail, "가상 매수", formatKrw(summary.virtualBuyAmountKrw));
  appendDefinition(detail, "가상 매도", formatKrw(summary.virtualSellAmountKrw));
  appendDefinition(detail, "배당 커버리지", summary.dividendCoverageText);
  appendDefinition(detail, "평균 배당률", summary.averageDividendYieldText);
  appendDefinition(detail, "배당락일", summary.exDividendText);
  appendDefinition(detail, "세금 상태", summary.taxStatus);
  appendDefinition(detail, "체결 표본", `${summary.tradeCount}건`);
}

function buildIncomeGoalSummary(data) {
  const timeline = portfolioPerformanceTimeline(data);
  const portfolio = currentPortfolioSummary(data, timeline);
  const trades = currentTradeList(data);
  const baseline = goalBaselineNetWorthKrw(data, timeline, trades);
  const baselineNetWorthKrw = baseline.valueKrw;
  const currentNetWorthKrw =
    portfolio?.virtualNetWorthKrw ?? timeline.at(-1)?.virtualNetWorthKrw ?? null;
  const targetNetWorthKrw =
    baselineNetWorthKrw !== null ? Math.round(baselineNetWorthKrw * 1.05) : null;
  const totalReturnRatio =
    baselineNetWorthKrw !== null &&
    baselineNetWorthKrw > 0 &&
    currentNetWorthKrw !== null
      ? (currentNetWorthKrw - baselineNetWorthKrw) / baselineNetWorthKrw
      : null;
  const goalProgressRatio =
    baselineNetWorthKrw !== null &&
    targetNetWorthKrw !== null &&
    targetNetWorthKrw > baselineNetWorthKrw &&
    currentNetWorthKrw !== null
      ? (currentNetWorthKrw - baselineNetWorthKrw) /
        (targetNetWorthKrw - baselineNetWorthKrw)
      : null;
  const virtualBuyAmountKrw = trades
    .filter((trade) => trade.action === "VIRTUAL_BUY")
    .reduce((sum, trade) => sum + Number(trade.amountKrw ?? 0), 0);
  const virtualSellAmountKrw = trades
    .filter((trade) => trade.action === "VIRTUAL_SELL")
    .reduce((sum, trade) => sum + Number(trade.amountKrw ?? 0), 0);
  const realizedPnlKrw = realizedPnlFromTrades(trades);
  const turnoverRatio =
    baselineNetWorthKrw !== null && baselineNetWorthKrw > 0
      ? (virtualBuyAmountKrw + virtualSellAmountKrw) / baselineNetWorthKrw
      : null;
  const dividendCoverage = buildDividendCoverage(data, portfolio);
  const taxStatus =
    realizedPnlKrw === null
      ? "체결 데이터 부족"
      : realizedPnlKrw > 0
        ? "세액 미산출"
        : "과세 추정 없음";
  const status =
    currentNetWorthKrw === null
      ? "missing"
      : goalProgressRatio !== null && goalProgressRatio >= 1
        ? "ok"
        : "degraded";

  return {
    status,
    statusLabel:
      status === "ok" ? "목표 달성" : status === "degraded" ? "추적 중" : "없음",
    baselineNetWorthKrw,
    currentNetWorthKrw,
    targetNetWorthKrw,
    totalReturnRatio,
    goalProgressRatio,
    realizedPnlKrw,
    virtualBuyAmountKrw,
    virtualSellAmountKrw,
    turnoverRatio,
    dividendStatus: dividendCoverage.statusText,
    dividendCoverageText: dividendCoverage.coverageText,
    averageDividendYieldText: dividendCoverage.averageYieldText,
    exDividendText: dividendCoverage.exDividendText,
    taxStatus,
    baselineSource: baseline.source,
    tradeCount: trades.length
  };
}

function buildDividendCoverage(data, portfolio) {
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const candidateMeta = latestCandidateMetadata(data);
  let coveredCount = 0;
  let weightedYieldSum = 0;
  let coveredValueKrw = 0;
  const exDividendDates = [];

  for (const position of positions) {
    const valueKrw = positionMarketValue(position);
    const meta = candidateMeta.get(`${position.market}:${position.symbol}`);
    const dividendYieldPct = Number(meta?.dividendYieldPct);
    if (Number.isFinite(dividendYieldPct)) {
      coveredCount += 1;
      coveredValueKrw += valueKrw;
      weightedYieldSum += dividendYieldPct * valueKrw;
    }
    if (meta?.exDividendDate) {
      exDividendDates.push(`${symbolDisplayText(position.market, position.symbol, meta)} ${meta.exDividendDate}`);
    }
  }

  const averageYieldPct = coveredValueKrw > 0 ? weightedYieldSum / coveredValueKrw : null;
  return {
    statusText: coveredCount ? `${coveredCount}종목` : "데이터 없음",
    coverageText: `${coveredCount} / ${positions.length}`,
    averageYieldText:
      averageYieldPct === null ? "-" : `${averageYieldPct.toFixed(2)}%`,
    exDividendText: exDividendDates.slice(0, 3).join(" · ") || "-"
  };
}

function goalBaselineNetWorthKrw(data, timeline, trades) {
  const progress = data?.replayProgress?.progress;
  const progressTradeCount = Number(progress?.tradeCount);
  if (
    progress?.currentPortfolio &&
    Number.isFinite(progressTradeCount) &&
    Array.isArray(trades) &&
    progressTradeCount <= trades.length
  ) {
    const cashKrw = Number(progress.currentPortfolio.cashKrw ?? 0);
    const buys = trades
      .filter((trade) => trade.action === "VIRTUAL_BUY")
      .reduce((sum, trade) => sum + Number(trade.amountKrw ?? 0), 0);
    const sells = trades
      .filter((trade) => trade.action === "VIRTUAL_SELL")
      .reduce((sum, trade) => sum + Number(trade.amountKrw ?? 0), 0);
    const derivedInitialCashKrw = Math.round(cashKrw + buys - sells);
    if (Number.isFinite(derivedInitialCashKrw) && derivedInitialCashKrw > 0) {
      return {
        valueKrw: derivedInitialCashKrw,
        source: "체결/현금 역산"
      };
    }
  }

  const valueKrw = initialNetWorthKrw(data, timeline);
  return {
    valueKrw,
    source: data?.replay?.report?.portfolio?.initialCashKrw
      ? "리플레이 리포트"
      : "관측 타임라인"
  };
}

function setGoalProgressBar(id, value) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  const progress =
    value === null || value === undefined || !Number.isFinite(Number(value))
      ? 0
      : Math.max(0, Math.min(1, Number(value)));
  const progressValue = Math.round(progress * 100);
  node.style.width = `${Math.max(2, progress * 100)}%`;
  node.className = Number(value ?? 0) >= 1 ? "positive" : "";
  if (node.parentElement?.classList.contains("goal-progress-track")) {
    node.parentElement.setAttribute("aria-valuenow", String(progressValue));
  }
}

function renderNetWorthChart(timeline) {
  const svg = document.getElementById("net-worth-chart");
  if (!svg) {
    return;
  }
  clear(svg);

  if (timeline.length < 2) {
    const text = svgNode("text", {
      x: "320",
      y: "112",
      "text-anchor": "middle",
      class: "chart-empty"
    });
    text.textContent = "순자산 곡선을 그릴 데이터가 아직 부족합니다";
    svg.append(text);
    return;
  }

  const width = 640;
  const height = 220;
  const padding = { top: 18, right: 18, bottom: 34, left: 56 };
  const values = timeline.map((item) => Number(item.virtualNetWorthKrw));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue === minValue ? Math.max(maxValue * 0.01, 1) : maxValue - minValue;
  const x = (index) =>
    padding.left +
    (index / Math.max(timeline.length - 1, 1)) *
      (width - padding.left - padding.right);
  const y = (value) =>
    padding.top +
    ((maxValue + range * 0.08 - value) / (range * 1.16)) *
      (height - padding.top - padding.bottom);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);

  for (const ratio of [0, 0.5, 1]) {
    const lineY = padding.top + ratio * (height - padding.top - padding.bottom);
    svg.append(svgNode("line", {
      x1: String(padding.left),
      x2: String(width - padding.right),
      y1: String(lineY),
      y2: String(lineY),
      class: "chart-grid"
    }));
  }

  const areaPath = [
    `M ${points[0]}`,
    ...points.slice(1).map((point) => `L ${point}`),
    `L ${x(timeline.length - 1).toFixed(1)},${height - padding.bottom}`,
    `L ${padding.left},${height - padding.bottom}`,
    "Z"
  ].join(" ");
  svg.append(svgNode("path", { d: areaPath, class: "chart-area" }));
  svg.append(svgNode("path", {
    d: `M ${points.join(" L ")}`,
    class: values.at(-1) >= values[0] ? "chart-line positive" : "chart-line negative"
  }));

  const minLabel = svgNode("text", { x: "8", y: String(height - padding.bottom), class: "chart-label" });
  minLabel.textContent = compactKrw(minValue);
  const maxLabel = svgNode("text", { x: "8", y: String(padding.top + 4), class: "chart-label" });
  maxLabel.textContent = compactKrw(maxValue);
  const startLabel = svgNode("text", { x: String(padding.left), y: String(height - 8), class: "chart-label" });
  startLabel.textContent = formatDateTime(timeline[0].simulatedAt);
  const endLabel = svgNode("text", {
    x: String(width - padding.right),
    y: String(height - 8),
    "text-anchor": "end",
    class: "chart-label"
  });
  endLabel.textContent = formatDateTime(timeline.at(-1).simulatedAt);
  svg.append(minLabel, maxLabel, startLabel, endLabel);
}

function renderAllocationList(portfolio) {
  const list = document.getElementById("allocation-list");
  clear(list);
  if (!list) {
    return;
  }

  const netWorth = Number(portfolio?.virtualNetWorthKrw ?? 0);
  setText("allocation-total", formatKrw(netWorth || null));
  if (!portfolio || netWorth <= 0) {
    list.append(emptyState("자산 배분 데이터 없음"));
    return;
  }

  const positions = Array.isArray(portfolio.positions) ? portfolio.positions : [];
  const items = [
    {
      label: "현금",
      subLabel: "KRW",
      amountKrw: Number(portfolio.cashKrw ?? 0),
      className: "cash"
    },
    ...positions
      .map((position) => ({
        label: position.symbol,
        subLabel: position.market,
        amountKrw: positionMarketValue(position),
        className: "position"
      }))
      .sort((left, right) => right.amountKrw - left.amountKrw)
  ].filter((item) => item.amountKrw > 0);

  for (const item of items.slice(0, 8)) {
    const ratio = item.amountKrw / netWorth;
    const row = document.createElement("div");
    row.className = "allocation-item";
    const meta = document.createElement("div");
    meta.className = "allocation-meta";
    const label = document.createElement("strong");
    label.textContent = item.label;
    const value = document.createElement("span");
    value.textContent = `${formatKrw(item.amountKrw)} · ${formatRatio(ratio)}`;
    meta.append(label, value);
    const bar = document.createElement("span");
    bar.className = `allocation-bar ${item.className}`;
    bar.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
    row.append(meta, bar);
    list.append(row);
  }
}

function renderPositions(positions, netWorthKrw = null) {
  const body = document.getElementById("positions-body");
  clear(body);

  if (!positions.length) {
    appendEmptyRow(body, 8, "보유 포지션 없음");
    return;
  }

  for (const position of positions) {
    const marketValueKrw = positionMarketValue(position);
    const currentPriceKrw =
      Number(position.quantity) > 0
        ? Math.round(marketValueKrw / Number(position.quantity))
        : null;
    const costBasisKrw = positionCostBasis(position);
    const unrealizedPnlKrw = marketValueKrw - costBasisKrw;
    const unrealizedPnlRatio =
      costBasisKrw > 0 ? unrealizedPnlKrw / costBasisKrw : null;
    const weightRatio =
      netWorthKrw && netWorthKrw > 0 ? marketValueKrw / netWorthKrw : null;
    const row = document.createElement("tr");
    row.append(
      symbolCell(position.market, position.symbol, position),
      cell(formatQuantity(position.quantity), "numeric"),
      cell(formatKrw(position.averagePriceKrw), "numeric"),
      cell(formatKrw(currentPriceKrw), "numeric"),
      cell(formatKrw(marketValueKrw), "numeric"),
      cell(formatSignedKrw(unrealizedPnlKrw), valueToneClass(unrealizedPnlKrw, "numeric")),
      cell(formatSignedRatio(unrealizedPnlRatio), valueToneClass(unrealizedPnlRatio, "numeric")),
      cell(formatRatio(weightRatio), "numeric")
    );
    body.append(row);
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

function renderPortfolioRiskMetrics(data) {
  const timeline = portfolioPerformanceTimeline(data);
  const portfolio = currentPortfolioSummary(data, timeline);
  const metrics = buildPortfolioRiskMetrics(portfolio, timeline);

  setStatus("portfolio-risk-status", metrics.status, metrics.statusLabel);
  setText("portfolio-risk-exposure", formatRatio(metrics.exposureRatio));
  setText("portfolio-risk-cash-depletion", formatRatio(metrics.cashDepletionRatio));
  setText("portfolio-risk-top-weight", formatRatio(metrics.topPositionWeightRatio));
  setText("portfolio-risk-hhi", formatRatio(metrics.concentrationHhi));
  setText("portfolio-risk-volatility", formatRatio(metrics.volatilityRatio));
  setText("portfolio-risk-drawdown", formatRatio(metrics.maxDrawdownRatio));

  const detail = document.getElementById("portfolio-risk-detail");
  clear(detail);
  appendDefinition(detail, "최대 비중 종목", metrics.topPositionLabel);
  appendDefinition(detail, "포지션 수", String(metrics.positionCount ?? 0));
  appendDefinition(detail, "관측 포인트", `${metrics.timelineCount ?? 0} points`);
  appendDefinition(detail, "주요 경고", metrics.warnings.join(" | ") || "none");
}

function buildPortfolioRiskMetrics(portfolio, timeline) {
  const netWorth = Number(portfolio?.virtualNetWorthKrw ?? 0);
  const cashKrw = Number(portfolio?.cashKrw ?? 0);
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : [];
  const positionValues = positions.map((position) => ({
    market: position.market,
    symbol: position.symbol,
    name: position.name,
    valueKrw: positionMarketValue(position)
  }));
  const positionMarketValueKrw = positionValues.reduce(
    (sum, position) => sum + position.valueKrw,
    0
  );
  const exposureRatio = netWorth > 0 ? positionMarketValueKrw / netWorth : null;
  const cashRatio = netWorth > 0 ? cashKrw / netWorth : null;
  const cashDepletionRatio = cashRatio === null ? null : 1 - cashRatio;
  const weights = positionValues.map((position) =>
    netWorth > 0 ? position.valueKrw / netWorth : 0
  );
  const concentrationHhi = weights.reduce((sum, weight) => sum + weight * weight, 0);
  const topPosition = positionValues
    .slice()
    .sort((left, right) => right.valueKrw - left.valueKrw)[0];
  const topPositionWeightRatio =
    topPosition && netWorth > 0 ? topPosition.valueKrw / netWorth : null;
  const maxDrawdown = maxDrawdownRatio(timeline);
  const volatility = timelineVolatilityRatio(timeline);
  const warnings = [];

  if (topPositionWeightRatio !== null && topPositionWeightRatio >= 0.35) {
    warnings.push("최대 종목 비중 35% 이상");
  }
  if (cashRatio !== null && cashRatio <= 0.05) {
    warnings.push("현금 비중 5% 이하");
  }
  if (maxDrawdown !== null && maxDrawdown >= 0.05) {
    warnings.push("최대 낙폭 5% 이상");
  }
  if (volatility !== null && volatility >= 0.03) {
    warnings.push("단기 변동성 3% 이상");
  }

  const status =
    warnings.length >= 2 || (maxDrawdown ?? 0) >= 0.1
      ? "error"
      : warnings.length === 1
        ? "degraded"
        : "ok";

  return {
    status,
    statusLabel:
      status === "ok" ? "정상" : status === "degraded" ? "주의" : "위험",
    exposureRatio,
    cashDepletionRatio,
    topPositionWeightRatio,
    concentrationHhi,
    volatilityRatio: volatility,
    maxDrawdownRatio: maxDrawdown,
    topPositionLabel: topPosition
      ? `${symbolDisplayText(topPosition.market, topPosition.symbol, topPosition)} · ${formatKrw(topPosition.valueKrw)}`
      : "none",
    positionCount: positions.length,
    timelineCount: timeline.length,
    warnings
  };
}

function renderTrades(trades) {
  const body = document.getElementById("trades-body");
  clear(body);
  setText("trade-count", `${trades.length} items`);

  if (!trades.length) {
    appendEmptyRow(body, 5, "가상 체결 없음");
    return;
  }

  for (const trade of trades) {
    const row = document.createElement("tr");
    row.append(
      cell(formatDateTime(trade.executedAt)),
      symbolCell(trade.market, trade.symbol, trade),
      cell(displayActionLabel(trade.action)),
      cell(formatKrw(trade.priceKrw), "numeric"),
      cell(formatKrw(trade.amountKrw), "numeric")
    );
    body.append(row);
  }
}

function renderPackets(packets) {
  const list = document.getElementById("packet-list");
  clear(list);

  if (!packets.length) {
    list.append(emptyState("Market packet 없음"));
    return;
  }

  for (const packet of packets) {
    const item = document.createElement("article");
    item.className = "packet-item";
    const title = document.createElement("strong");
    title.textContent = packet.packetId;
    item.append(title);
    item.append(paragraph(`${packet.candidates?.length ?? 0}개 후보 · 만료 ${formatDateTime(packet.expiresAt)}`));
    item.append(tagList((packet.candidates ?? []).slice(0, 6).map((candidate) => symbolDisplayText(candidate.market, candidate.symbol, candidate)), "후보"));
    list.append(item);
  }
}

function symbolCell(market, symbol, item = {}) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "symbol-cell";
  const name = document.createElement("strong");
  name.textContent = symbolDisplayName(market, symbol, item);
  const marketText = document.createElement("span");
  marketText.className = "market";
  marketText.textContent = symbolCodeText(market, symbol);
  wrap.append(name, marketText);
  td.append(wrap);
  return td;
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
