import {
  appendDefinition,
  appendEmptyRow,
  cell,
  clear,
  emptyState,
  setStatus,
  setText,
  setValueTone
} from "./dom.js";
import {
  formatDateTime,
  formatExposureBreakdown,
  formatKrw,
  formatPercent,
  formatRatio,
  formatSignedRatio,
  valueToneClass
} from "./formatters.js";
import {
  regimeLabel,
  replayRangeText,
  summarizeRecord
} from "./reportViewHelpers.js";

export function renderDailyReport(report) {
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
    sourceStatusText(report?.sourceStatus)
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
    sourceWarningText(report?.sourceStatus)
  );
}

function sourceStatusText(sourceStatus) {
  const status = sourceStatus?.status ?? "unknown";
  const warningCount = Number(sourceStatus?.warningCount ?? 0);
  const routineFilterCount = Number(sourceStatus?.routineFilterCount ?? 0);
  if (warningCount > 0) {
    return `${status} · warnings ${warningCount}`;
  }
  if (routineFilterCount > 0) {
    return `${status} · routine filters ${routineFilterCount}`;
  }
  return `${status} · warnings 0`;
}

function sourceWarningText(sourceStatus) {
  const warnings = Array.isArray(sourceStatus?.warnings)
    ? sourceStatus.warnings
    : [];
  if (warnings.length > 0) {
    return warnings.join(" | ");
  }

  const futureCount = Number(sourceStatus?.futureSnapshotFilterCount ?? 0);
  const staleCount = Number(sourceStatus?.staleSnapshotFilterCount ?? 0);
  if (futureCount > 0 || staleCount > 0) {
    return `routine historical filters: future snapshots ${futureCount}, stale snapshots ${staleCount}`;
  }

  return "none";
}

export function renderReplayReport(replayPayload) {
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
  setText(
    "replay-disclaimer",
    report?.disclaimer ?? "저장된 과거 리플레이 리포트 없음"
  );

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

export function renderBatchReplayReport(batchPayload) {
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
  appendDefinition(
    detail,
    "중앙값 수익률",
    formatSignedRatio(overall.medianTotalReturnRatio)
  );
  appendDefinition(
    detail,
    "최저/최고",
    `${formatSignedRatio(overall.minTotalReturnRatio)} / ${formatSignedRatio(overall.maxTotalReturnRatio)}`
  );
  appendDefinition(
    detail,
    "평균 최종자산",
    formatKrw(overall.averageFinalVirtualNetWorthKrw)
  );
  appendDefinition(
    detail,
    "시장별 평균 노출",
    formatExposureBreakdown(overall.averageFinalExposureByMarketKrw)
  );
  appendDefinition(
    detail,
    "자산유형별 평균 노출",
    formatExposureBreakdown(overall.averageFinalExposureByAssetTypeKrw)
  );
  appendDefinition(detail, "가상 체결", `${overall.totalTradeCount ?? 0}건`);
  appendDefinition(detail, "Risk Reject", `${overall.totalRejectedCount ?? 0}건`);

  renderBatchRegimeList(report?.byRegime ?? {});
}

function renderBatchRegimeList(byRegime) {
  const list = document.getElementById("batch-regime-list");
  clear(list);
  const entries = Object.entries(byRegime ?? {}).sort(
    ([left], [right]) => regimeSortKey(left) - regimeSortKey(right)
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
      batchRegimeMetric(
        "평균",
        formatSignedRatio(group.averageTotalReturnRatio),
        group.averageTotalReturnRatio
      ),
      batchRegimeMetric("승률", formatRatio(group.winRate), group.winRate),
      batchRegimeMetric("체결", `${group.totalTradeCount ?? 0}건`, null)
    );

    item.append(header, metrics);
    list?.append(item);
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
