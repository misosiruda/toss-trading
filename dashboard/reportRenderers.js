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

export function renderReplayResearchReport(researchPayload) {
  const report = researchPayload?.report ?? null;
  const status = researchPayload?.status ?? "missing";
  const runIdentity = report?.runIdentity ?? {};
  const validationProtocol = report?.validationProtocol ?? {};
  const overfittingWarning = report?.overfittingWarning ?? {};
  const sharpeValidation = report?.sharpeValidation ?? null;
  const cpcvPboWarning = report?.cpcvPboWarning ?? null;
  const providerFailure = report?.providerFailureSummary ?? {};
  const riskReject = report?.riskRejectSummary ?? {};
  const warnings = researchReportWarnings(report);

  setStatus("research-report-status", status, status);
  setText("research-run-count", `${runIdentity.runCount ?? 0}회`);
  setText(
    "research-validation-protocol",
    validationProtocol.validationProtocol ??
      validationProtocol.overfittingDiagnosticStatus ??
      "-"
  );
  setText("research-pbo-score", formatRatio(overfittingWarning.pboLikeScore));
  setText(
    "research-provider-failures",
    `${providerFailure.totalAiDecisionFailureCount ?? 0}건`
  );
  setText(
    "research-risk-rejects",
    `${riskReject.totalRejectedCount ?? 0}건`
  );
  setText("research-warning-count", `${warnings.length}개`);
  setText(
    "research-report-disclaimer",
    report?.disclaimer ?? "저장된 연구 리포트 없음"
  );

  const detail = document.getElementById("research-report-detail");
  clear(detail);
  appendDefinition(detail, "생성 시각", formatDateTime(report?.generatedAt));
  appendDefinition(
    detail,
    "원본 생성 시각",
    formatDateTime(report?.sourceGeneratedAt)
  );
  appendDefinition(detail, "입력 로그", report?.sourceRunsPath ?? "-");
  appendDefinition(
    detail,
    "완료/제외/실패",
    `${runIdentity.completedCount ?? 0} completed / ${runIdentity.skippedCount ?? 0} skipped / ${runIdentity.failedCount ?? 0} failed`
  );
  appendDefinition(
    detail,
    "Return sample",
    `${runIdentity.returnSampleCount ?? 0}개`
  );
  appendDefinition(
    detail,
    "Validation roles",
    summarizeRecord(validationProtocol.validationSplitRoleCounts)
  );
  appendDefinition(
    detail,
    "Trial 분포",
    researchTrialSummary(report?.promptTrialDistribution)
  );
  appendDefinition(
    detail,
    "Hash bucket",
    researchBucketSummary(report?.reproducibilityHashes)
  );
  appendDefinition(
    detail,
    "노출",
    researchExposureSummary(report?.exposureBreakdown)
  );
  appendDefinition(
    detail,
    "Cost/Benchmark",
    `${report?.costBreakdown?.status ?? "unavailable"} / ${report?.benchmarkComparison?.status ?? "unavailable"}`
  );
  appendDefinition(
    detail,
    "Sharpe validation",
    researchSharpeValidationSummary(sharpeValidation)
  );
  appendDefinition(
    detail,
    "CPCV/PBO",
    researchCpcvPboSummary(cpcvPboWarning)
  );

  renderResearchWarningList(warnings, status);
  renderResearchRegimeList(report?.regimeBreakdown ?? []);
}

function renderResearchWarningList(warnings, status) {
  const list = document.getElementById("research-warning-list");
  clear(list);
  setText(
    "research-warning-list-count",
    warnings.length ? `${warnings.length}개` : "-"
  );

  if (!warnings.length) {
    list?.append(
      emptyState(
        status === "ok"
          ? "연구 리포트 경고 없음"
          : "표시할 연구 리포트 artifact 없음"
      )
    );
    return;
  }

  for (const warning of warnings.slice(0, 6)) {
    const item = document.createElement("div");
    item.className = "research-warning-item";
    item.textContent = warning;
    list?.append(item);
  }
}

function researchReportWarnings(report) {
  const warnings = [];
  appendUniqueWarnings(warnings, report?.warnings);
  appendUniqueWarnings(warnings, report?.validationProtocol?.warnings);
  appendUniqueWarnings(warnings, report?.dataUniverseCoverage?.warnings);
  appendUniqueWarnings(warnings, report?.overfittingWarning?.warnings);
  appendUniqueWarnings(warnings, report?.sharpeValidation?.warnings);
  appendUniqueWarnings(warnings, report?.cpcvPboWarning?.warnings);
  return warnings;
}

function researchSharpeValidationSummary(summary) {
  if (!summary || !summary.status || summary.status === "missing") {
    return "missing";
  }
  return [
    `status=${summary.status ?? "missing"}`,
    `sample=${summary.sampleSharpeStatus ?? "missing"}:${formatRatio(summary.sampleSharpeValue)}`,
    `lo=${summary.loAdjustedSharpeStatus ?? "missing"}`,
    `psr=${summary.probabilisticSharpeRatioStatus ?? "missing"}:${formatRatio(summary.probabilisticSharpeRatioProbability)}`,
    `dsr=${summary.deflatedSharpeRatioStatus ?? "missing"}:${formatRatio(summary.deflatedSharpeRatioProbability)}`,
    `samples=${summary.returnSampleCount ?? 0}/${summary.minimumSampleCount ?? "?"}`
  ].join(" / ");
}

function researchCpcvPboSummary(summary) {
  if (!summary || !summary.status || summary.status === "missing") {
    return "missing";
  }
  return [
    `status=${summary.status ?? "missing"}`,
    `pbo=${summary.pboStatus ?? "missing"}`,
    `probability=${formatRatio(summary.pboProbability)}`,
    `evaluated=${summary.evaluatedCombinationCount ?? 0}`,
    `split_plan=${summary.splitPlanAvailable ? "available" : "missing"}`
  ].join(" / ");
}

function appendUniqueWarnings(target, values) {
  if (!Array.isArray(values)) {
    return;
  }
  const existing = new Set(target);
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    if (!existing.has(value)) {
      existing.add(value);
      target.push(value);
    }
  }
}

function renderResearchRegimeList(groups) {
  const list = document.getElementById("research-regime-list");
  clear(list);
  setText(
    "research-regime-count",
    groups.length ? `${groups.length}개 그룹` : "-"
  );

  if (!groups.length) {
    list?.append(emptyState("장세별 연구 요약 없음"));
    return;
  }

  for (const group of groups
    .slice()
    .sort((left, right) => regimeSortKey(left.key) - regimeSortKey(right.key))) {
    const item = document.createElement("article");
    item.className = "research-regime-item";
    const header = document.createElement("div");
    header.className = "batch-regime-header";
    const title = document.createElement("strong");
    title.textContent = regimeLabel(group.key);
    const count = document.createElement("span");
    count.textContent = `${group.completedCount ?? 0}/${group.runCount ?? 0} completed`;
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
      batchRegimeMetric(
        "Risk",
        `${group.totalRejectedCount ?? 0}건`,
        null
      )
    );

    item.append(header, metrics);
    list?.append(item);
  }
}

function researchBucketSummary(hashes) {
  if (!hashes) {
    return "-";
  }
  const promptCount = hashes.promptHashes?.length ?? 0;
  const configCount = hashes.configHashes?.length ?? 0;
  const riskCount = hashes.riskPolicyHashes?.length ?? 0;
  const exitCount = hashes.exitPolicyHashes?.length ?? 0;
  return `prompt ${promptCount} · config ${configCount} · risk ${riskCount} · exit ${exitCount}`;
}

function researchTrialSummary(distribution) {
  if (!distribution || distribution.trialCount === null) {
    return "unavailable";
  }
  return [
    `${distribution.trialCount} trials`,
    `selected ${distribution.selectedCount ?? 0}`
  ].join(" · ");
}

function researchExposureSummary(exposure) {
  if (!exposure) {
    return "-";
  }
  return [
    `평균 노출 ${formatRatio(exposure.averageExposureRatio)}`,
    `현금 ${formatRatio(exposure.averageCashRatio)}`,
    `시장 ${formatExposureBreakdown(exposure.averageFinalExposureByMarketKrw)}`
  ].join(" · ");
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
