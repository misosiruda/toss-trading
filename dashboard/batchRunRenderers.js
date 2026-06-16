import {
  endpointErrorMessage,
  endpoints,
  fetchJson
} from "./apiClient.js";
import {
  appendDefinition,
  clear,
  emptyState,
  setStatus,
  setText,
  showError,
  statusClass
} from "./dom.js";
import {
  compactKrw,
  formatDateOnly,
  formatExposureBreakdown,
  formatRatio,
  formatSignedRatio,
  valueToneClass
} from "./formatters.js";
import { regimeLabel } from "./reportViewHelpers.js";
import { batchRunsPollMs, state } from "./state.js";

export function renderBatchReplayRuns(runsPayload) {
  const status = runsPayload?.status ?? "missing";
  const statusCounts = runsPayload?.statusCounts ?? {};
  const completedCount = Number(statusCounts.completed ?? 0);
  const skippedCount = Number(statusCounts.skipped ?? 0);
  const failedCount = Number(statusCounts.failed ?? 0);
  const corruptLineCount = Number(runsPayload?.corruptLineCount ?? 0);

  setStatus("batch-run-status", status, status);
  setText("batch-run-record-count", `${runsPayload?.count ?? 0}개`);
  setText("batch-run-total-count", `${runsPayload?.totalCount ?? 0}개`);
  setText("batch-run-completed-count", `${completedCount}개`);
  setText("batch-run-problem-count", `${failedCount + skippedCount}개`);
  setText(
    "batch-run-log-state",
    corruptLineCount > 0 ? `corrupt ${corruptLineCount}` : status
  );
  setText("batch-run-source", runsPayload?.sourceRunsPath ?? "-");

  const tabs = document.getElementById("batch-run-tabs");
  const list = document.getElementById("batch-run-list");
  clear(tabs);
  clear(list);

  if (status === "blocked") {
    list?.append(emptyState("허용되지 않은 반복 리플레이 로그 경로"));
    return;
  }

  const runs = Array.isArray(runsPayload?.runs)
    ? [...runsPayload.runs].sort(compareBatchRunRecords)
    : [];

  if (!runs.length) {
    list?.append(emptyState("개별 가상 투자 실행 로그 없음"));
    return;
  }

  state.selectedBatchRunIndex = Math.max(
    0,
    Math.min(state.selectedBatchRunIndex, runs.length - 1)
  );
  renderBatchRunTabs(tabs, list, runs);
  renderBatchRunPage(list, runs[state.selectedBatchRunIndex]);
}

export function scheduleBatchRunsPolling(runsPayload) {
  clearBatchRunsPolling();
  if (state.currentPage !== "virtual-replays" || !shouldPollBatchRuns(runsPayload)) {
    return;
  }

  state.batchRunsTimer = window.setTimeout(() => {
    state.batchRunsTimer = null;
    void refreshBatchRuns().catch(() => undefined);
  }, batchRunsPollMs);
}

export function clearBatchRunsPolling() {
  if (state.batchRunsTimer !== null) {
    window.clearTimeout(state.batchRunsTimer);
    state.batchRunsTimer = null;
  }
}

export async function refreshBatchRuns() {
  if (state.batchRunsInFlight) {
    return;
  }
  state.batchRunsInFlight = true;
  try {
    const payload = await fetchJson(endpoints.batchRuns);
    renderBatchReplayRuns(payload);
    scheduleBatchRunsPolling(payload);
  } catch (error) {
    showError(endpointErrorMessage(endpoints.batchRuns, error));
    scheduleBatchRunsPolling({ status: "missing", aggregateStatus: "missing" });
  } finally {
    state.batchRunsInFlight = false;
  }
}

function renderBatchRunTabs(tabs, list, runs) {
  clear(tabs);
  for (const [index, run] of runs.entries()) {
    const button = document.createElement("button");
    button.className = "batch-run-tab";
    button.type = "button";
    button.role = "tab";
    button.textContent = String(index + 1);
    button.title = run?.runId ?? `run ${index + 1}`;
    button.setAttribute("aria-selected", String(index === state.selectedBatchRunIndex));
    button.classList.toggle("active", index === state.selectedBatchRunIndex);
    button.addEventListener("click", () => {
      state.selectedBatchRunIndex = index;
      updateBatchRunTabs(tabs);
      clear(list);
      renderBatchRunPage(list, runs[index]);
    });
    tabs?.append(button);
  }
}

function updateBatchRunTabs(tabs) {
  tabs?.querySelectorAll(".batch-run-tab").forEach((button, index) => {
    const isActive = index === state.selectedBatchRunIndex;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function renderBatchRunPage(list, run) {
  if (!run) {
    list?.append(emptyState("선택된 가상 투자 실행 없음"));
    return;
  }

  const item = document.createElement("article");
  item.className = "batch-run-item batch-run-page";

  const header = document.createElement("div");
  header.className = "batch-run-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = batchRunTitle(run);
  const meta = document.createElement("span");
  meta.textContent = `${regimeLabel(run?.marketRegime?.label)} · ${batchRunRangeText(run?.window)}`;
  titleWrap.append(title, meta);
  const statusPill = document.createElement("span");
  statusPill.className = `status-pill ${statusClass(run?.status)}`;
  statusPill.textContent = runStatusLabel(run?.status);
  header.append(titleWrap, statusPill);

  const metrics = document.createElement("div");
  metrics.className = "batch-run-metrics";
  metrics.append(
    batchRunMetric(
      "수익률",
      formatSignedRatio(run?.summary?.totalReturnRatio),
      run?.summary?.totalReturnRatio
    ),
    batchRunMetric("최종자산", compactKrw(run?.summary?.finalVirtualNetWorthKrw), null),
    batchRunMetric("체결", `${run?.summary?.tradeCount ?? 0}건`, null),
    batchRunMetric(
      "AI 호출",
      `${run?.summary?.decisionProviderCallCount ?? 0}회`,
      null
    ),
    batchRunMetric("Reject", `${run?.summary?.rejectedCount ?? 0}건`, null),
    batchRunMetric(
      "현금비중",
      formatRatio(run?.summary?.finalCashRatio),
      run?.summary?.finalCashRatio
    )
  );

  const pageLayout = document.createElement("div");
  pageLayout.className = "batch-run-page-layout";
  const summary = document.createElement("dl");
  summary.className = "definition-list batch-run-page-detail";
  appendDefinition(summary, "Run ID", run?.runId ?? "-");
  appendDefinition(summary, "실행 Seed", run?.runSeed ?? "-");
  appendDefinition(summary, "기간", batchRunRangeText(run?.window));
  appendDefinition(summary, "장세", regimeLabel(run?.marketRegime?.label));
  appendDefinition(
    summary,
    "Sampling",
    `${run?.windowSampling?.mode ?? "-"} · target ${regimeLabel(run?.windowSampling?.targetRegime)}`
  );
  appendDefinition(
    summary,
    "데이터",
    `${run?.dataAvailability?.status ?? "unknown"} · ${run?.dataAvailability?.windowSnapshotCount ?? 0} snapshots`
  );

  const diagnostics = document.createElement("dl");
  diagnostics.className = "definition-list batch-run-page-detail";
  appendDefinition(
    diagnostics,
    "AI 실패",
    `${run?.summary?.aiDecisionFailureCount ?? 0}건`
  );
  appendDefinition(
    diagnostics,
    "의미있는 Reject",
    `${run?.summary?.meaningfulRejectCount ?? 0}건`
  );
  appendDefinition(
    diagnostics,
    "Dust Reject",
    `${run?.summary?.dustRejectCount ?? 0}건`
  );
  appendDefinition(diagnostics, "목표 노출", formatRatio(run?.summary?.targetExposureRatio));
  appendDefinition(
    diagnostics,
    "최종 노출",
    `${formatRatio(run?.summary?.finalPositionRatio)} / 현금 ${formatRatio(run?.summary?.finalCashRatio)}`
  );
  appendDefinition(
    diagnostics,
    "시장별 노출",
    formatExposureBreakdown(run?.summary?.finalExposureByMarketKrw)
  );
  appendDefinition(
    diagnostics,
    "자산유형별 노출",
    formatExposureBreakdown(run?.summary?.finalExposureByAssetTypeKrw)
  );
  appendDefinition(diagnostics, "Report", run?.reportPath ?? "-");
  appendDefinition(diagnostics, "상태 상세", batchRunDetailText(run));

  pageLayout.append(summary, diagnostics);
  item.append(header, metrics, pageLayout);
  list?.append(item);
}

function shouldPollBatchRuns(runsPayload) {
  const status = runsPayload?.status;
  return (
    status === "running" ||
    (status === "missing" && runsPayload?.aggregateStatus === "missing") ||
    runsPayload === undefined
  );
}

function compareBatchRunRecords(left, right) {
  const leftIndex = Number(left?.runIndex);
  const rightIndex = Number(right?.runIndex);
  if (Number.isFinite(leftIndex) && Number.isFinite(rightIndex)) {
    return leftIndex - rightIndex;
  }
  return String(left?.runId ?? "").localeCompare(String(right?.runId ?? ""));
}

function batchRunTitle(run) {
  const runIndex = Number(run?.runIndex);
  const indexText = Number.isInteger(runIndex) ? `#${runIndex + 1}` : "#-";
  return `${indexText} ${run?.runId ?? "unknown"}`;
}

function batchRunRangeText(windowSelection) {
  if (!windowSelection?.startAt && !windowSelection?.endAt) {
    return "-";
  }
  return `${formatDateOnly(windowSelection.startAt)} - ${formatDateOnly(windowSelection.endAt)}`;
}

function batchRunDetailText(run) {
  if (run?.status === "skipped") {
    return `skip: ${run?.skipReason ?? "unknown"}`;
  }
  if (run?.status === "failed") {
    return `error: ${run?.error ?? "unknown"}`;
  }
  const exposure = formatRatio(run?.summary?.finalPositionRatio);
  const target = formatRatio(run?.summary?.targetExposureRatio);
  return `노출 ${exposure} / 목표 ${target} · report ${run?.reportPath ?? "-"}`;
}

function batchRunMetric(label, value, toneValue) {
  const item = document.createElement("div");
  const term = document.createElement("span");
  term.textContent = label;
  const metric = document.createElement("strong");
  metric.className = valueToneClass(toneValue);
  metric.textContent = value;
  item.append(term, metric);
  return item;
}

function runStatusLabel(status) {
  if (status === "completed") {
    return "완료";
  }
  if (status === "skipped") {
    return "스킵";
  }
  if (status === "failed") {
    return "실패";
  }
  return String(status ?? "-");
}
