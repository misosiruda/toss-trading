const state = {
  decisionItems: [],
  filters: {
    action: "ALL",
    symbol: ""
  },
  auditEvents: [],
  riskDecisions: [],
  trades: [],
  performancePoints: [],
  symbolMetadata: new Map(),
  refreshStartedAt: null,
  replayProgressTimer: null,
  replayProgressInFlight: false,
  replayProgressStatus: null
};

const replayProgressPollMs = 3000;

const endpoints = {
  health: "/health",
  portfolio: "/virtual/portfolio",
  decisions: "/virtual/decisions?limit=20",
  trades: "/virtual/trades?limit=20",
  report: "/paper/report",
  replay: "/replay/report",
  replayProgress: "/replay/progress",
  batchReplay: "/batch/replay/report",
  scheduler: "/scheduler/status",
  source: "/source/health",
  packets: "/market/packets?limit=5",
  audit: "/audit/events?limit=100"
};

const fallbackSymbolMetadata = new Map([
  ["KR:000660", { name: "SK하이닉스", sector: "정보기술", industry: "반도체" }],
  ["KR:005930", { name: "삼성전자", sector: "정보기술", industry: "반도체" }],
  ["KR:028300", { name: "HLB", sector: "헬스케어", industry: "바이오/제약" }],
  ["KR:035420", { name: "NAVER", sector: "커뮤니케이션서비스", industry: "인터넷/플랫폼" }],
  ["KR:035900", { name: "JYP Ent.", sector: "커뮤니케이션서비스", industry: "엔터테인먼트" }],
  ["KR:042660", { name: "한화오션", sector: "산업재", industry: "조선" }]
]);

document.getElementById("refresh-button")?.addEventListener("click", () => {
  void loadDashboard().catch(() => undefined);
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

void loadDashboard().catch(() => undefined);

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

async function fetchEndpointData() {
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, path]) => {
      try {
        return [key, await fetchJson(path)];
      } catch (error) {
        return [key, { error: endpointErrorMessage(path, error) }];
      }
    })
  );
  return Object.fromEntries(entries);
}

function endpointFailures(data) {
  return Object.entries(data)
    .filter(([, value]) => value?.error)
    .map(([key]) => key);
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return await response.json();
}

function endpointErrorMessage(path, error) {
  const message = error instanceof Error ? error.message : String(error);
  return `${path}: ${message}`;
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

function registerSymbolMetadata(item) {
  if (!item?.market || !item?.symbol) {
    return;
  }
  const key = symbolKey(item.market, item.symbol);
  const current = state.symbolMetadata.get(key) ?? {};
  const fallback = fallbackSymbolMetadata.get(key) ?? {};
  state.symbolMetadata.set(key, {
    name: cleanMetadataValue(item.name) ?? current.name ?? fallback.name ?? null,
    sector:
      cleanMetadataValue(item.sector ?? item.category) ??
      current.sector ??
      fallback.sector ??
      null,
    industry:
      cleanMetadataValue(item.industry ?? item.theme) ??
      current.industry ??
      fallback.industry ??
      null
  });
}

function symbolKey(market, symbol) {
  return `${market ?? ""}:${symbol ?? ""}`;
}

function cleanMetadataValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function metadataForSymbol(market, symbol, item = {}) {
  const key = symbolKey(market, symbol);
  const remembered = state.symbolMetadata.get(key) ?? {};
  const fallback = fallbackSymbolMetadata.get(key) ?? {};
  return {
    name: cleanMetadataValue(item.name) ?? remembered.name ?? fallback.name ?? null,
    sector:
      cleanMetadataValue(item.sector ?? item.category) ??
      remembered.sector ??
      fallback.sector ??
      null,
    industry:
      cleanMetadataValue(item.industry ?? item.theme) ??
      remembered.industry ??
      fallback.industry ??
      null
  };
}

function symbolCodeText(market, symbol) {
  if (market && symbol) {
    return `${market}:${symbol}`;
  }
  return symbol ?? market ?? "-";
}

function symbolDisplayName(market, symbol, item = {}) {
  return metadataForSymbol(market, symbol, item).name ?? symbol ?? "-";
}

function symbolDisplayText(market, symbol, item = {}) {
  const name = symbolDisplayName(market, symbol, item);
  const code = symbolCodeText(market, symbol);
  return name && name !== symbol && name !== code ? `${name} (${code})` : code;
}

function enrichPositionForDisplay(position, candidate = {}) {
  const metadata = metadataForSymbol(position?.market, position?.symbol, {
    ...candidate,
    ...position
  });
  return {
    ...position,
    name: metadata.name ?? position?.name,
    sector: metadata.sector ?? position?.sector,
    industry: metadata.industry ?? position?.industry
  };
}

function enrichCandidateForDisplay(candidate) {
  const metadata = metadataForSymbol(candidate?.market, candidate?.symbol, candidate);
  return {
    ...candidate,
    name: metadata.name ?? candidate?.name,
    sector: metadata.sector ?? candidate?.sector,
    industry: metadata.industry ?? candidate?.industry
  };
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

function renderDailyReport(report) {
  setText(
    "report-date",
    report?.date
      ? `${report.date} · generated ${formatDateTime(report.generatedAt)}`
      : "-"
  );
  setText(
    "report-decision-items",
    String(report?.decisionOutcome?.decisionItemCount ?? 0)
  );
  setText(
    "report-average-confidence",
    formatPercent(report?.decisionOutcome?.averageConfidence)
  );
  setText(
    "report-trade-total",
    `${report?.tradeSummary?.tradeCount ?? 0}건`
  );
  setText(
    "report-risk-result",
    `${report?.riskSummary?.approvedCount ?? 0} 승인 / ${report?.riskSummary?.rejectedCount ?? 0} 거절`
  );
  setText(
    "report-source-result",
    `${report?.sourceStatus?.status ?? "unknown"} · warnings ${report?.sourceStatus?.warningCount ?? 0}`
  );
  setText("report-disclaimer", report?.disclaimer ?? "-");

  const detail = document.getElementById("report-detail");
  clear(detail);
  appendDefinition(
    detail,
    "가상 매수",
    formatKrw(report?.tradeSummary?.virtualBuyAmountKrw)
  );
  appendDefinition(
    detail,
    "가상 매도",
    formatKrw(report?.tradeSummary?.virtualSellAmountKrw)
  );
  appendDefinition(
    detail,
    "대상 종목",
    (report?.tradeSummary?.symbols ?? []).join(", ") || "none"
  );
  appendDefinition(
    detail,
    "최근 Risk Reject",
    (report?.riskSummary?.recentRejectedSummaries ?? []).join(" | ") || "none"
  );
  appendDefinition(
    detail,
    "Source Warning",
    (report?.sourceStatus?.warnings ?? []).join(" | ") || "none"
  );
}

function renderReplayReport(replayPayload) {
  const report = replayPayload?.report ?? null;
  const status = replayPayload?.status ?? "missing";
  setStatus("replay-status", status, status);

  setText("replay-range", replayRangeText(report?.simulatedRange));
  setText("replay-packets", `${report?.replaySummary?.packetCount ?? 0}개`);
  setText(
    "replay-decisions",
    `${report?.replaySummary?.decisionProviderCallCount ?? 0} 호출 / ${report?.replaySummary?.decisionSkippedCount ?? 0} skip`
  );
  setText("replay-trades", `${report?.tradeSummary?.tradeCount ?? 0}건`);
  setText(
    "replay-risk",
    `${report?.riskSummary?.approvedCount ?? 0} 승인 / ${report?.riskSummary?.rejectedCount ?? 0} 거절`
  );
  setText("replay-disclaimer", report?.disclaimer ?? "저장된 과거 리플레이 리포트 없음");

  const detail = document.getElementById("replay-detail");
  clear(detail);
  appendDefinition(
    detail,
    "최종 가상 순자산",
    formatKrw(report?.portfolio?.finalVirtualNetWorthKrw)
  );
  appendDefinition(
    detail,
    "Sampling",
    summarizeRecord(report?.samplingSummary?.skipReasons)
  );
  appendDefinition(
    detail,
    "Lookahead",
    `${report?.sourceWarningSummary?.lookaheadGuardStatus ?? "unknown"} · future warnings ${report?.sourceWarningSummary?.futureSnapshotWarningCount ?? 0}`
  );
  appendDefinition(
    detail,
    "최근 경고",
    (report?.sourceWarningSummary?.recentWarnings ?? []).join(" | ") || "none"
  );

  renderReplayTimeline(report?.portfolioTimeline ?? []);
}

function renderBatchReplayReport(batchPayload) {
  const report = batchPayload?.report ?? null;
  const status = batchPayload?.status ?? "missing";
  const summary = report?.summary ?? {};
  const overall = report?.overall ?? {};

  setStatus("batch-replay-status", status, status);
  setText("batch-replay-runs", `${summary.runCount ?? 0}회`);
  setText("batch-replay-completed", `${summary.completedCount ?? 0}회`);
  setText("batch-replay-return-samples", `${summary.returnSampleCount ?? 0}개`);
  setText(
    "batch-replay-average-return",
    formatSignedRatio(overall.averageTotalReturnRatio)
  );
  setText("batch-replay-win-rate", formatRatio(overall.winRate));
  setText(
    "batch-replay-source",
    report?.sourceRunsPath ? "aggregate report" : "-"
  );
  setText(
    "batch-replay-disclaimer",
    report?.disclaimer ?? "저장된 반복 리플레이 집계 없음"
  );
  setValueTone("batch-replay-average-return", overall.averageTotalReturnRatio);

  const detail = document.getElementById("batch-replay-detail");
  clear(detail);
  appendDefinition(detail, "생성 시각", formatDateTime(report?.generatedAt));
  appendDefinition(detail, "입력 로그", report?.sourceRunsPath ?? "-");
  appendDefinition(
    detail,
    "상태",
    `${summary.completedCount ?? 0} completed / ${summary.skippedCount ?? 0} skipped / ${summary.failedCount ?? 0} failed`
  );
  appendDefinition(detail, "중앙값 수익률", formatSignedRatio(overall.medianTotalReturnRatio));
  appendDefinition(detail, "최저/최고", `${formatSignedRatio(overall.minTotalReturnRatio)} / ${formatSignedRatio(overall.maxTotalReturnRatio)}`);
  appendDefinition(detail, "평균 최종자산", formatKrw(overall.averageFinalVirtualNetWorthKrw));
  appendDefinition(detail, "가상 체결", `${overall.totalTradeCount ?? 0}건`);
  appendDefinition(detail, "Risk Reject", `${overall.totalRejectedCount ?? 0}건`);

  renderBatchRegimeList(report?.byRegime ?? {});
}

function renderBatchRegimeList(byRegime) {
  const list = document.getElementById("batch-regime-list");
  clear(list);
  const entries = Object.entries(byRegime ?? {}).sort(([left], [right]) =>
    regimeSortKey(left) - regimeSortKey(right)
  );
  setText("batch-regime-count", entries.length ? `${entries.length}개 그룹` : "-");

  if (!entries.length) {
    list?.append(emptyState("장세별 집계 없음"));
    return;
  }

  for (const [label, group] of entries) {
    const item = document.createElement("article");
    item.className = "batch-regime-item";
    const header = document.createElement("div");
    header.className = "batch-regime-header";
    const title = document.createElement("strong");
    title.textContent = regimeLabel(label);
    const count = document.createElement("span");
    count.textContent = `${group.runCount ?? 0}회 · sample ${group.returnSampleCount ?? 0}`;
    header.append(title, count);

    const metrics = document.createElement("div");
    metrics.className = "batch-regime-metrics";
    metrics.append(
      batchRegimeMetric("평균", formatSignedRatio(group.averageTotalReturnRatio), group.averageTotalReturnRatio),
      batchRegimeMetric("승률", formatRatio(group.winRate), group.winRate),
      batchRegimeMetric("체결", `${group.totalTradeCount ?? 0}건`, null)
    );

    item.append(header, metrics);
    list?.append(item);
  }
}

function batchRegimeMetric(label, value, toneValue) {
  const item = document.createElement("div");
  const term = document.createElement("span");
  term.textContent = label;
  const metric = document.createElement("strong");
  metric.className = valueToneClass(toneValue);
  metric.textContent = value;
  item.append(term, metric);
  return item;
}

function regimeSortKey(label) {
  return {
    bull: 0,
    bear: 1,
    sideways: 2,
    mixed: 3,
    insufficient_data: 4
  }[label] ?? 99;
}

function regimeLabel(label) {
  return {
    bull: "상승장",
    bear: "하락장",
    sideways: "횡보장",
    mixed: "혼합장",
    insufficient_data: "데이터 부족"
  }[label] ?? String(label ?? "-");
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

function benchmarkPackets(data) {
  const progressPackets = data?.replayProgress?.progress?.recentPackets;
  if (Array.isArray(progressPackets) && progressPackets.length) {
    return progressPackets;
  }
  const packets = data?.packets?.packets;
  return Array.isArray(packets) ? packets : [];
}

function equalWeightBenchmarkReturn(packets) {
  const sorted = [...packets]
    .filter((packet) => packet?.generatedAt && Array.isArray(packet.candidates))
    .sort((left, right) => new Date(left.generatedAt) - new Date(right.generatedAt));
  if (sorted.length < 2) {
    return { returnRatio: null, movers: [], rangeText: "-" };
  }

  const first = sorted[0];
  const last = sorted.at(-1);
  const latest = new Map(
    (last.candidates ?? []).map((candidate) => [
      `${candidate.market}:${candidate.symbol}`,
      candidate
    ])
  );
  const movers = [];
  for (const candidate of first.candidates ?? []) {
    const latestCandidate = latest.get(`${candidate.market}:${candidate.symbol}`);
    if (!latestCandidate || !candidate.lastPriceKrw) {
      continue;
    }
    const returnRatio =
      (latestCandidate.lastPriceKrw - candidate.lastPriceKrw) /
      candidate.lastPriceKrw;
    movers.push({
      market: candidate.market,
      symbol: candidate.symbol,
      name: metadataForSymbol(candidate.market, candidate.symbol, latestCandidate).name,
      startPriceKrw: candidate.lastPriceKrw,
      latestPriceKrw: latestCandidate.lastPriceKrw,
      returnRatio
    });
  }

  return {
    returnRatio: average(movers.map((item) => item.returnRatio)),
    movers: movers.sort((left, right) => Math.abs(right.returnRatio) - Math.abs(left.returnRatio)),
    rangeText: `${formatDateTime(first.generatedAt)} - ${formatDateTime(last.generatedAt)} · ${movers.length}종목`
  };
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

function currentTradeList(data) {
  const progressTrades = data?.replayProgress?.progress?.recentTrades;
  if (Array.isArray(progressTrades) && progressTrades.length) {
    return progressTrades;
  }
  const trades = data?.trades?.trades;
  if (Array.isArray(trades) && trades.length) {
    return trades;
  }
  return Array.isArray(state.trades) ? state.trades : [];
}

function realizedPnlFromTrades(trades) {
  if (!Array.isArray(trades) || !trades.length) {
    return null;
  }
  const explicitValues = trades
    .map((trade) => Number(trade.realizedPnlKrw))
    .filter((value) => Number.isFinite(value));
  if (explicitValues.length) {
    return explicitValues.reduce((sum, value) => sum + value, 0);
  }

  const lotsBySymbol = new Map();
  let realizedPnlKrw = 0;
  let hasSell = false;
  const sorted = trades
    .slice()
    .sort((left, right) => tradeTimeValue(left) - tradeTimeValue(right));

  for (const trade of sorted) {
    const key = `${trade.market}:${trade.symbol}`;
    const quantity = Number(trade.quantity ?? 0);
    const amountKrw = Number(trade.amountKrw ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amountKrw)) {
      continue;
    }

    if (trade.action === "VIRTUAL_BUY") {
      const lots = lotsBySymbol.get(key) ?? [];
      lots.push({
        quantity,
        costKrw: amountKrw
      });
      lotsBySymbol.set(key, lots);
      continue;
    }

    if (trade.action !== "VIRTUAL_SELL") {
      continue;
    }

    hasSell = true;
    let remaining = quantity;
    let costBasisKrw = 0;
    const lots = lotsBySymbol.get(key) ?? [];
    while (remaining > 0 && lots.length) {
      const lot = lots[0];
      const usedQuantity = Math.min(remaining, lot.quantity);
      const usedCost = lot.costKrw * (usedQuantity / lot.quantity);
      costBasisKrw += usedCost;
      lot.quantity -= usedQuantity;
      lot.costKrw -= usedCost;
      remaining -= usedQuantity;
      if (lot.quantity <= 1e-9) {
        lots.shift();
      }
    }
    lotsBySymbol.set(key, lots);

    if (remaining > 1e-9) {
      const fallbackPrice = Number(trade.priceKrw ?? 0);
      costBasisKrw += Number.isFinite(fallbackPrice)
        ? remaining * fallbackPrice
        : 0;
    }
    realizedPnlKrw += Math.round(amountKrw - costBasisKrw);
  }

  return hasSell ? realizedPnlKrw : 0;
}

function tradeTimeValue(trade) {
  const time = Date.parse(trade?.executedAt ?? "");
  return Number.isFinite(time) ? time : 0;
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
  node.style.width = `${Math.max(2, progress * 100)}%`;
  node.className = Number(value ?? 0) >= 1 ? "positive" : "";
}

function portfolioPerformanceTimeline(data) {
  const progressTimeline = normalizePortfolioTimeline(
    data?.replayProgress?.progress?.portfolioTimeline
  );
  if (progressTimeline.length) {
    return progressTimeline;
  }

  const packetTimeline = normalizePortfolioTimeline(
    (data?.replayProgress?.progress?.recentPackets ?? [])
      .map((packet) => portfolioPointFromPacket(packet))
      .filter(Boolean)
  );
  if (packetTimeline.length) {
    const current = currentPortfolioSummary(data, packetTimeline);
    return mergePortfolioTimeline(packetTimeline, current ? [current] : []);
  }

  const reportTimeline = normalizePortfolioTimeline(
    data?.replay?.report?.portfolioTimeline
  );
  if (reportTimeline.length) {
    return reportTimeline;
  }

  if (state.performancePoints.length) {
    return [...state.performancePoints];
  }

  const current = currentPortfolioSummary(data, []);
  return current ? [current] : [];
}

function normalizePortfolioTimeline(timeline) {
  if (!Array.isArray(timeline)) {
    return [];
  }
  return timeline
    .map((item) => normalizePortfolioPoint(item))
    .filter(Boolean)
    .sort((left, right) => new Date(left.simulatedAt) - new Date(right.simulatedAt));
}

function normalizePortfolioPoint(item) {
  if (!item?.simulatedAt) {
    return null;
  }
  const cashKrw = Number(item.cashKrw ?? 0);
  const positionMarketValueKrw = Number(item.positionMarketValueKrw ?? 0);
  const virtualNetWorthKrw = Number(
    item.virtualNetWorthKrw ?? cashKrw + positionMarketValueKrw
  );
  if (!Number.isFinite(virtualNetWorthKrw)) {
    return null;
  }

  return {
    simulatedAt: item.simulatedAt,
    cashKrw,
    positionCount: Number(item.positionCount ?? item.positions?.length ?? 0),
    positionMarketValueKrw,
    virtualNetWorthKrw,
    positions: Array.isArray(item.positions)
      ? item.positions.map((position) => enrichPositionForDisplay(position))
      : []
  };
}

function rememberPerformancePoint(portfolio) {
  const point = normalizePortfolioPoint(portfolio);
  if (!point) {
    return;
  }
  const existingIndex = state.performancePoints.findIndex(
    (item) => item.simulatedAt === point.simulatedAt
  );
  if (existingIndex >= 0) {
    state.performancePoints[existingIndex] = point;
  } else {
    state.performancePoints.push(point);
  }
  state.performancePoints = state.performancePoints
    .sort((left, right) => new Date(left.simulatedAt) - new Date(right.simulatedAt))
    .slice(-1_500);
}

function currentPortfolioSummary(data, timeline) {
  const progress = data?.replayProgress?.progress ?? null;
  if (progress?.currentPortfolio) {
    return normalizePortfolioPoint(
      portfolioPointFromVirtualPortfolio(
        progress.currentPortfolio,
        progress.currentPortfolio.simulatedAt,
        progress.recentPackets?.[0]
      )
    );
  }

  const portfolio = data?.portfolio?.portfolio;
  if (portfolio) {
    const positions = Array.isArray(portfolio.positions)
      ? portfolio.positions.map((position) => enrichPositionForDisplay(position))
      : [];
    const positionMarketValueKrw = positions.reduce(
      (sum, position) => sum + positionMarketValue(position),
      0
    );
    return {
      simulatedAt: portfolio.updatedAt ?? new Date().toISOString(),
      cashKrw: Number(portfolio.cashKrw ?? 0),
      positionCount: positions.length,
      positionMarketValueKrw,
      virtualNetWorthKrw: Number(portfolio.cashKrw ?? 0) + positionMarketValueKrw,
      positions
    };
  }

  return timeline.at(-1) ?? null;
}

function portfolioPointFromPacket(packet) {
  if (!packet?.virtualPortfolio) {
    return null;
  }
  return portfolioPointFromVirtualPortfolio(
    packet.virtualPortfolio,
    packet.generatedAt,
    packet
  );
}

function portfolioPointFromVirtualPortfolio(portfolio, simulatedAt, latestPacket) {
  if (!portfolio || !simulatedAt) {
    return null;
  }
  const latestCandidates = new Map(
    (latestPacket?.candidates ?? []).map((candidate) => [
      `${candidate.market}:${candidate.symbol}`,
      candidate
    ])
  );
  const positions = (portfolio.positions ?? []).map((position) => {
    const latestCandidate = latestCandidates.get(`${position.market}:${position.symbol}`);
    const latestPrice = latestCandidate?.lastPriceKrw;
    const marketValueKrw =
      latestPrice === undefined
        ? positionMarketValue(position)
        : Math.round(Number(position.quantity ?? 0) * Number(latestPrice));
    const costBasisKrw = positionCostBasis(position);
    return {
      ...enrichPositionForDisplay(position, latestCandidate),
      marketValueKrw,
      unrealizedPnlKrw: marketValueKrw - costBasisKrw
    };
  });
  const positionMarketValueKrw = positions.reduce(
    (sum, position) => sum + positionMarketValue(position),
    0
  );
  return {
    simulatedAt,
    cashKrw: Number(portfolio.cashKrw ?? 0),
    positionCount: positions.length,
    positionMarketValueKrw,
    virtualNetWorthKrw: Number(portfolio.cashKrw ?? 0) + positionMarketValueKrw,
    positions
  };
}

function mergePortfolioTimeline(...groups) {
  const byTime = new Map();
  for (const group of groups) {
    for (const item of group) {
      if (item?.simulatedAt) {
        byTime.set(item.simulatedAt, item);
      }
    }
  }
  return normalizePortfolioTimeline(Array.from(byTime.values()));
}

function initialNetWorthKrw(data, timeline) {
  const reportInitial = data?.replay?.report?.portfolio?.initialCashKrw;
  if (Number.isFinite(Number(reportInitial))) {
    return Number(reportInitial);
  }
  return timeline[0]?.virtualNetWorthKrw ?? null;
}

function maxDrawdownRatio(timeline) {
  let peak = null;
  let maxDrawdown = 0;
  for (const item of timeline) {
    const value = Number(item.virtualNetWorthKrw);
    if (!Number.isFinite(value)) {
      continue;
    }
    peak = peak === null ? value : Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
    }
  }
  return timeline.length > 1 ? maxDrawdown : null;
}

function timelineRangeText(timeline) {
  if (!timeline.length) {
    return "-";
  }
  const first = timeline[0];
  const last = timeline.at(-1);
  return `${formatDateTime(first.simulatedAt)} - ${formatDateTime(last.simulatedAt)} · ${timeline.length} points`;
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

function renderReplayTimeline(timeline) {
  const body = document.getElementById("replay-timeline-body");
  clear(body);

  if (!timeline.length) {
    appendEmptyRow(body, 4, "저장된 리플레이 타임라인 없음");
    return;
  }

  for (const item of timeline.slice(-10)) {
    const row = document.createElement("tr");
    row.append(
      cell(formatDateTime(item.simulatedAt)),
      cell(formatKrw(item.cashKrw), "numeric"),
      cell(String(item.positionCount ?? 0), "numeric"),
      cell(formatKrw(item.virtualNetWorthKrw), "numeric")
    );
    body.append(row);
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

function flattenDecisionRecords(records) {
  return records.flatMap((record, recordIndex) =>
    (record.decisions ?? []).map((decision, decisionIndex) => ({
      ...decision,
      packetId: record.packetId,
      summary: record.summary,
      recordIndex,
      decisionIndex
    }))
  );
}

function renderDecisionTimeline() {
  const list = document.getElementById("decision-list");
  clear(list);

  const filteredItems = filterDecisionItems(state.decisionItems);
  setText(
    "decision-count",
    `${filteredItems.length}/${state.decisionItems.length} items`
  );
  renderDecisionGroups(filteredItems);

  if (!filteredItems.length) {
    list.append(emptyState("AI 판단 기록 없음"));
    return;
  }

  for (const item of filteredItems.slice(0, 10)) {
    const article = document.createElement("article");
    article.className = "decision-item";

    const top = document.createElement("div");
    top.className = "decision-topline";

    const symbol = document.createElement("div");
    symbol.className = "decision-symbol";
    symbol.append(actionPill(item.action), document.createTextNode(symbolDisplayText(item.market, item.symbol, item)));

    const meta = document.createElement("div");
    meta.className = "decision-meta";
    meta.textContent = `확신도 ${formatPercent(item.confidence)} · 예산 ${formatKrw(item.budgetKrw)} · ${decisionFreshness(item.expiresAt)}`;
    if (isExpired(item.expiresAt)) {
      meta.classList.add("expired");
    }

    top.append(symbol, meta);
    article.append(top);
    article.append(decisionOutcomeRow(item));
    article.append(decisionRationale(item));
    list.append(article);
  }
}

function renderDecisionPerformance(data) {
  const list = document.getElementById("decision-performance-list");
  clear(list);

  const outcomes = buildDecisionPerformanceOutcomes(data);
  const evaluated = outcomes.filter((item) => item.isEvaluated);
  setText(
    "decision-performance-count",
    `${evaluated.length}/${outcomes.length} 평가`
  );

  const buyOutcomes = evaluated.filter((item) => item.action === "VIRTUAL_BUY");
  const sellOutcomes = evaluated.filter((item) => item.action === "VIRTUAL_SELL");
  const holdOutcomes = evaluated.filter((item) => item.action === "VIRTUAL_HOLD");
  const averageDecisionReturn = average(
    evaluated.map((item) => item.decisionReturnRatio)
  );
  const holdOpportunity = average(
    holdOutcomes.map((item) => item.holdOpportunityRatio)
  );

  setText("decision-performance-average", formatSignedRatio(averageDecisionReturn));
  setText(
    "decision-performance-buy-hit-rate",
    hitRateText(buyOutcomes)
  );
  setText(
    "decision-performance-sell-hit-rate",
    hitRateText(sellOutcomes)
  );
  setText(
    "decision-performance-hold-opportunity",
    formatRatio(holdOpportunity)
  );
  setValueTone("decision-performance-average", averageDecisionReturn);

  if (!outcomes.length) {
    list.append(emptyState("AI 판단 성과 데이터 없음"));
    return;
  }

  for (const item of outcomes.slice(0, 8)) {
    const article = document.createElement("article");
    article.className = "decision-performance-item";
    const top = document.createElement("div");
    top.className = "decision-performance-topline";
    const symbol = document.createElement("div");
    symbol.className = "decision-performance-symbol";
    symbol.append(actionPill(item.action), document.createTextNode(symbolDisplayText(item.market, item.symbol, item)));
    const result = document.createElement("strong");
    result.className = valueToneClass(item.decisionReturnRatio);
    result.textContent = item.isEvaluated
      ? formatSignedRatio(item.decisionReturnRatio)
      : "평가 대기";
    top.append(symbol, result);

    const detail = document.createElement("p");
    detail.className = "decision-performance-detail";
    detail.textContent = item.isEvaluated
      ? [
          `판단가 ${formatKrw(item.decisionPriceKrw)}`,
          `최신가 ${formatKrw(item.latestPriceKrw)}`,
          `가격변화 ${formatSignedRatio(item.priceMoveRatio)}`,
          item.action === "VIRTUAL_HOLD"
            ? `기회비용 ${formatRatio(item.holdOpportunityRatio)}`
            : item.isHit
              ? "적중"
              : "미적중",
          item.packetId
        ].join(" · ")
      : [
          "판단 시점 또는 최신 가격 데이터 부족",
          item.packetId
        ].join(" · ");

    article.append(top, detail);
    list.append(article);
  }
}

function buildDecisionPerformanceOutcomes(data) {
  const progress = data?.replayProgress?.progress ?? null;
  const records = progress?.recentDecisions ?? data?.decisions?.decisions ?? [];
  const packets = progress?.recentPackets ?? data?.packets?.packets ?? [];
  const packetById = new Map(
    packets.map((packet) => [packet.packetId, packet])
  );
  const latestPrices = latestPricesBySymbol(packets);

  return flattenDecisionRecords(records).map((item) => {
    const packet = packetById.get(item.packetId);
    const candidate = packet?.candidates?.find(
      (entry) => entry.market === item.market && entry.symbol === item.symbol
    );
    const latest = latestPrices.get(`${item.market}:${item.symbol}`);
    const decisionPriceKrw = Number(candidate?.lastPriceKrw);
    const latestPriceKrw = Number(latest?.priceKrw);
    const isEvaluated =
      Number.isFinite(decisionPriceKrw) &&
      decisionPriceKrw > 0 &&
      Number.isFinite(latestPriceKrw);
    const priceMoveRatio = isEvaluated
      ? (latestPriceKrw - decisionPriceKrw) / decisionPriceKrw
      : null;
    const decisionReturnRatio = decisionPerformanceReturn(
      item.action,
      priceMoveRatio
    );
    const holdOpportunityRatio =
      item.action === "VIRTUAL_HOLD" && priceMoveRatio !== null
        ? Math.max(priceMoveRatio, 0)
        : null;

    return {
      market: item.market,
      symbol: item.symbol,
      name: metadataForSymbol(item.market, item.symbol, candidate ?? item).name,
      action: item.action,
      packetId: item.packetId,
      isEvaluated,
      decisionPriceKrw: isEvaluated ? decisionPriceKrw : null,
      latestPriceKrw: isEvaluated ? latestPriceKrw : null,
      priceMoveRatio,
      decisionReturnRatio,
      holdOpportunityRatio,
      isHit: decisionReturnRatio !== null ? decisionReturnRatio > 0 : false
    };
  });
}

function latestPricesBySymbol(packets) {
  const latest = new Map();
  const sorted = [...packets].sort(
    (left, right) => new Date(right.generatedAt) - new Date(left.generatedAt)
  );
  for (const packet of sorted) {
    for (const candidate of packet.candidates ?? []) {
      const key = `${candidate.market}:${candidate.symbol}`;
      if (!latest.has(key)) {
        latest.set(key, {
          priceKrw: candidate.lastPriceKrw,
          generatedAt: packet.generatedAt
        });
      }
    }
  }
  return latest;
}

function decisionPerformanceReturn(action, priceMoveRatio) {
  if (priceMoveRatio === null || Number.isNaN(Number(priceMoveRatio))) {
    return null;
  }
  if (action === "VIRTUAL_BUY") {
    return priceMoveRatio;
  }
  if (action === "VIRTUAL_SELL" || action === "VIRTUAL_HOLD") {
    return -priceMoveRatio;
  }
  return null;
}

function hitRateText(outcomes) {
  if (!outcomes.length) {
    return "-";
  }
  const hits = outcomes.filter((item) => item.isHit).length;
  return `${formatRatio(hits / outcomes.length)} (${hits}/${outcomes.length})`;
}

function decisionOutcomeRow(item) {
  const row = document.createElement("div");
  row.className = "decision-outcome";
  const riskEvent = findRiskEvent(item);
  const trade = findTrade(item);

  row.append(
    outcomeBadge(
      riskOutcomeLabel(riskEvent),
      riskEvent?.eventType
    ),
    outcomeBadge(
      tradeOutcomeLabel(trade),
      trade?.status
    )
  );
  return row;
}

function outcomeBadge(label, status) {
  const badge = document.createElement("span");
  badge.className = `outcome-badge ${outcomeClass(status)}`;
  badge.textContent = label;
  return badge;
}

function outcomeClass(status) {
  if (status === "VIRTUAL_RISK_APPROVED" || status === "VIRTUAL_FILLED") {
    return "ok";
  }
  if (status === "VIRTUAL_RISK_REJECTED" || status === "VIRTUAL_REJECTED") {
    return "error";
  }
  return "neutral";
}

function findRiskEvent(item) {
  const riskDecision = state.riskDecisions.find((decision) => {
    return (
      decision.packetId === item.packetId &&
      (!decision.symbol || decision.symbol === item.symbol)
    );
  });
  if (riskDecision) {
    return {
      eventType: riskDecision.approved
        ? "VIRTUAL_RISK_APPROVED"
        : "VIRTUAL_RISK_REJECTED",
      summary: `${item.market}:${item.symbol} ${item.action}`
    };
  }

  const summary = `${item.market}:${item.symbol} ${item.action}`;
  return state.auditEvents.find((event) => {
    return (
      (event.eventType === "VIRTUAL_RISK_APPROVED" ||
        event.eventType === "VIRTUAL_RISK_REJECTED") &&
      String(event.summary ?? "").startsWith(summary)
    );
  });
}

function findTrade(item) {
  return state.trades.find((trade) => {
    return (
      trade.packetId === item.packetId &&
      trade.market === item.market &&
      trade.symbol === item.symbol &&
      trade.action === item.action
    );
  });
}

function decisionRationale(item) {
  const wrap = document.createElement("div");
  wrap.className = "decision-rationale";
  wrap.append(
    evidenceBlock(`${displayActionLabel(item.action)} 판단 근거`, paragraph(item.thesis)),
    evidenceBlock(
      "리스크 요인",
      item.riskFactors?.length
        ? bulletList(item.riskFactors)
        : paragraph("none")
    ),
    evidenceBlock(
      "데이터 근거",
      item.dataRefs?.length ? tagList(item.dataRefs, "data") : paragraph("none")
    ),
    evidenceBlock(
      "판단 컨텍스트",
      detailLine([
        `확신도 ${formatPercent(item.confidence)}`,
        `예산 ${formatKrw(item.budgetKrw)}`,
        decisionFreshness(item.expiresAt),
        item.packetId
      ])
    )
  );
  return wrap;
}

function evidenceBlock(title, content) {
  const block = document.createElement("section");
  block.className = "evidence-block";
  const heading = document.createElement("h3");
  heading.textContent = title;
  block.append(heading, content);
  return block;
}

function bulletList(values) {
  const list = document.createElement("ul");
  list.className = "evidence-list";
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  }
  return list;
}

function detailLine(values) {
  const node = document.createElement("p");
  node.className = "decision-meta detail-line";
  node.textContent = values.filter(Boolean).join(" · ");
  return node;
}

function filterDecisionItems(items) {
  const action = state.filters.action;
  const symbol = state.filters.symbol.trim().toUpperCase();
  return items.filter((item) => {
    if (action !== "ALL" && item.action !== `VIRTUAL_${action}`) {
      return false;
    }
    const fullSymbol = `${item.market}:${item.symbol}`.toUpperCase();
    const shortSymbol = String(item.symbol).toUpperCase();
    const displayName = symbolDisplayName(item.market, item.symbol, item).toUpperCase();
    if (
      symbol &&
      !fullSymbol.includes(symbol) &&
      !shortSymbol.includes(symbol) &&
      !displayName.includes(symbol)
    ) {
      return false;
    }
    return true;
  });
}

function renderDecisionGroups(items) {
  const groups = document.getElementById("decision-groups");
  clear(groups);

  const bySymbol = new Map();
  for (const item of items) {
    const key = `${item.market}:${item.symbol}`;
    const current = bySymbol.get(key) ?? { total: 0, buy: 0, sell: 0, hold: 0 };
    current.total += 1;
    if (item.action === "VIRTUAL_BUY") {
      current.buy += 1;
    } else if (item.action === "VIRTUAL_SELL") {
      current.sell += 1;
    } else if (item.action === "VIRTUAL_HOLD") {
      current.hold += 1;
    }
    bySymbol.set(key, current);
  }

  for (const [symbol, summary] of Array.from(bySymbol.entries()).slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "decision-group";
    const title = document.createElement("strong");
    const [market, code] = symbol.split(":");
    title.textContent = symbolDisplayText(market, code);
    const meta = document.createElement("span");
    meta.textContent = `${summary.total}개 · 매수 ${summary.buy} · 매도 ${summary.sell} · 보류 ${summary.hold}`;
    item.append(title, meta);
    groups.append(item);
  }
}

function updateFilterControls() {
  const counts = countActions(state.decisionItems);
  document.querySelectorAll("[data-action-filter]").forEach((button) => {
    const filter = button.getAttribute("data-action-filter") ?? "ALL";
    button.classList.toggle("active", filter === state.filters.action);
    const count = counts[filter] ?? 0;
    button.textContent =
      filter === "ALL" ? `전체 ${count}` : `${displayFilterLabel(filter)} ${count}`;
  });
}

function countActions(items) {
  const counts = { ALL: items.length, BUY: 0, SELL: 0, HOLD: 0 };
  for (const item of items) {
    const action = String(item.action ?? "").replace("VIRTUAL_", "");
    if (action in counts) {
      counts[action] += 1;
    }
  }
  return counts;
}

function renderRiskSummary(riskSummary, decisionOutcome) {
  const list = document.getElementById("risk-summary");
  clear(list);
  appendDefinition(list, "승인", String(riskSummary?.approvedCount ?? 0));
  appendDefinition(list, "거절", String(riskSummary?.rejectedCount ?? 0));
  appendDefinition(list, "판단 수", String(decisionOutcome?.decisionItemCount ?? 0));
  appendDefinition(list, "액션", summarizeActionRecord(decisionOutcome?.byAction));
  appendDefinition(
    list,
    "최근 거절",
    (riskSummary?.recentRejectedSummaries ?? []).join(" | ") || "none"
  );
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

function timelineVolatilityRatio(timeline) {
  const returns = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const previous = Number(timeline[index - 1]?.virtualNetWorthKrw);
    const current = Number(timeline[index]?.virtualNetWorthKrw);
    if (Number.isFinite(previous) && previous > 0 && Number.isFinite(current)) {
      returns.push((current - previous) / previous);
    }
  }
  if (returns.length < 2) {
    return null;
  }
  const mean = average(returns) ?? 0;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;
  return Math.sqrt(variance);
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

function actionPill(action) {
  const pill = document.createElement("span");
  const normalized = actionLabel(action).toLowerCase();
  pill.className = `action-pill ${normalized}`;
  pill.textContent = displayActionLabel(action);
  return pill;
}

function actionLabel(action) {
  return String(action ?? "UNKNOWN").replace("VIRTUAL_", "");
}

function displayActionLabel(action) {
  const normalized = actionLabel(action);
  if (normalized === "BUY") {
    return "매수";
  }
  if (normalized === "SELL") {
    return "매도";
  }
  if (normalized === "HOLD") {
    return "보류";
  }
  return normalized;
}

function displayFilterLabel(filter) {
  if (filter === "BUY") {
    return "매수";
  }
  if (filter === "SELL") {
    return "매도";
  }
  if (filter === "HOLD") {
    return "보류";
  }
  return String(filter ?? "-");
}

function riskOutcomeLabel(riskEvent) {
  if (!riskEvent) {
    return "리스크 미확인";
  }
  if (riskEvent.eventType === "VIRTUAL_RISK_APPROVED") {
    return "리스크 승인";
  }
  if (riskEvent.eventType === "VIRTUAL_RISK_REJECTED") {
    return "리스크 반려";
  }
  return String(riskEvent.eventType ?? "-");
}

function tradeOutcomeLabel(trade) {
  if (!trade) {
    return "가상 체결 없음";
  }
  return `${tradeStatusLabel(trade.status)} ${formatKrw(trade.amountKrw)}`;
}

function tradeStatusLabel(status) {
  if (status === "VIRTUAL_FILLED") {
    return "체결";
  }
  if (status === "VIRTUAL_REJECTED") {
    return "반려";
  }
  if (status === "VIRTUAL_PENDING") {
    return "대기";
  }
  if (status === "VIRTUAL_EXPIRED") {
    return "만료";
  }
  return String(status ?? "-");
}

function tagList(values, prefix) {
  const wrap = document.createElement("div");
  wrap.className = "tag-list";
  for (const value of values) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${prefix}: ${value}`;
    wrap.append(tag);
  }
  return wrap;
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

function cell(value, className) {
  const td = document.createElement("td");
  if (className) {
    td.className = className;
  }
  td.textContent = value ?? "-";
  return td;
}

function paragraph(value) {
  const node = document.createElement("p");
  node.className = "decision-text";
  node.textContent = value ?? "-";
  return node;
}

function appendDefinition(list, term, description) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = description ?? "-";
  list.append(dt, dd);
}

function appendEmptyRow(body, colspan, message) {
  const row = document.createElement("tr");
  const empty = document.createElement("td");
  empty.colSpan = colspan;
  empty.append(emptyState(message));
  row.append(empty);
  body.append(row);
}

function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value ?? "-";
  }
}

function setStatus(id, status, text) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.className = `status-pill ${statusClass(status)}`;
  node.textContent = text;
}

function setProgressBar(id, percent) {
  const node = document.getElementById(id);
  if (node) {
    node.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  }
}

function statusClass(status) {
  if (status === "ok" || status === "completed") {
    return "ok";
  }
  if (
    status === "degraded" ||
    status === "loading" ||
    status === "unknown" ||
    status === "running"
  ) {
    return "degraded";
  }
  if (
    status === "error" ||
    status === "blocked" ||
    status === "corrupt" ||
    status === "failed"
  ) {
    return "error";
  }
  return "neutral";
}

function clear(node) {
  if (node) {
    node.replaceChildren();
  }
}

function showError(message) {
  const banner = document.getElementById("error-banner");
  if (!banner) {
    return;
  }
  banner.textContent = message;
  banner.hidden = false;
}

function hideError() {
  const banner = document.getElementById("error-banner");
  if (banner) {
    banner.hidden = true;
  }
}

function formatKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR").format(Number(value))}원`;
}

function formatSignedKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${formatKrw(number)}`;
}

function compactKrw(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value))}원`;
}

function formatQuantity(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 6
  }).format(Number(value));
}

function formatPercent(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Math.round(Number(value) * 100)}%`;
}

function formatRatio(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatDurationMs(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const milliseconds = Number(value);
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  const seconds = milliseconds / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}초`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}분 ${remainingSeconds}초`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}시간 ${remainingMinutes}분`;
}

function performanceBottleneckLabel(value) {
  if (value === "packet_build") {
    return "packet build";
  }
  if (value === "sampling") {
    return "sampling";
  }
  if (value === "decision_provider") {
    return "AI 판단";
  }
  if (value === "order_execution") {
    return "리스크/체결";
  }
  if (value === "none") {
    return "없음";
  }
  return "-";
}

function formatSignedRatio(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return "-";
  }
  const number = Number(value);
  const prefix = number > 0 ? "+" : "";
  return `${prefix}${(number * 100).toFixed(2)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function average(values) {
  const finiteValues = values.filter(
    (value) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
  );
  if (!finiteValues.length) {
    return null;
  }
  return (
    finiteValues.reduce((sum, value) => sum + Number(value), 0) /
    finiteValues.length
  );
}

function replayRangeText(range) {
  if (!range?.startAt && !range?.endAt) {
    return "-";
  }
  return `${formatDateTime(range.startAt)} - ${formatDateTime(range.endAt)} · ${range.tickCount ?? 0} ticks`;
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

function decisionFreshness(expiresAt) {
  return isExpired(expiresAt)
    ? `만료 ${formatDateTime(expiresAt)}`
    : `만료 예정 ${formatDateTime(expiresAt)}`;
}

function isExpired(value) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() < Date.now();
}

function summarizeRecord(value) {
  if (!value || typeof value !== "object") {
    return "none";
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    return "none";
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(", ");
}

function summarizeActionRecord(value) {
  if (!value || typeof value !== "object") {
    return "none";
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    return "none";
  }
  return entries
    .map(([key, count]) => `${displayActionLabel(key)}:${count}`)
    .join(", ");
}

function positionMarketValue(position) {
  const quantity = Number(position?.quantity ?? 0);
  const averagePriceKrw = Number(position?.averagePriceKrw ?? 0);
  const marketValueKrw = Number(position?.marketValueKrw);
  if (Number.isFinite(marketValueKrw)) {
    return marketValueKrw;
  }
  return Math.round(quantity * averagePriceKrw);
}

function positionCostBasis(position) {
  return Math.round(
    Number(position?.quantity ?? 0) * Number(position?.averagePriceKrw ?? 0)
  );
}

function valueToneClass(value, baseClass = "") {
  const number = Number(value);
  const tone =
    Number.isFinite(number) && number > 0
      ? "positive"
      : Number.isFinite(number) && number < 0
        ? "negative"
        : "";
  return [baseClass, tone].filter(Boolean).join(" ");
}

function setValueTone(id, value) {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.classList.remove("positive", "negative");
  const tone = valueToneClass(value);
  if (tone) {
    node.classList.add(tone);
  }
}

function svgNode(name, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}
