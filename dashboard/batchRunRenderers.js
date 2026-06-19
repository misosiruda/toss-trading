import {
  endpointErrorMessage,
  endpoints,
  fetchJson
} from "./apiClient.js";
import {
  appendDefinition,
  clear,
  emptyState,
  setProgressBar,
  setStatus,
  setText,
  setValueTone,
  showError,
  statusClass
} from "./dom.js";
import {
  compactKrw,
  formatDateTime,
  formatDateOnly,
  formatExposureBreakdown,
  formatKrw,
  formatRatio,
  formatSignedKrw,
  formatSignedRatio,
  valueToneClass
} from "./formatters.js";
import { regimeLabel } from "./reportViewHelpers.js";
import { batchRunsPollMs, state } from "./state.js";
import { pendingSimulationBatchStorageKey } from "./simulationForm.js";

export function renderBatchReplayRuns(runsPayload) {
  const status = runsPayload?.status ?? "missing";
  const statusCounts = runsPayload?.statusCounts ?? {};
  const completedCount = Number(statusCounts.completed ?? 0);
  const skippedCount = Number(statusCounts.skipped ?? 0);
  const failedCount = Number(statusCounts.failed ?? 0);
  const problemCount = currentProblemCount(runsPayload);
  const corruptLineCount = Number(runsPayload?.corruptLineCount ?? 0);
  const runs = Array.isArray(runsPayload?.runs)
    ? [...runsPayload.runs].sort(compareBatchRunRecords)
    : [];
  const visibleRuns = displayRunsWithActiveRun(runsPayload, runs);
  const pendingBatchId = pendingSimulationBatchIdWaitingFor(runsPayload);
  const visibleRunCount = visibleRuns.length;
  const totalRunCount =
    finiteNumber(runsPayload?.requestedRunCount) ??
    finiteNumber(runsPayload?.totalCount) ??
    visibleRunCount;

  setStatus("batch-run-status", status, status);
  renderActiveSimulationMetricCards(runsPayload);
  setText("batch-run-record-count", `${visibleRunCount}개`);
  setText("batch-run-total-count", `${totalRunCount}개`);
  setText("batch-run-completed-count", `${completedCount}개`);
  setText("batch-run-problem-count", `${problemCount}개`);
  setText(
    "batch-run-log-state",
    corruptLineCount > 0 ? `corrupt ${corruptLineCount}` : status
  );
  setText("batch-run-source", runsPayload?.sourceRunsPath ?? "-");

  renderCurrentSimulationMonitor(runsPayload, visibleRuns, pendingBatchId);

  const tabs = document.getElementById("batch-run-tabs");
  const list = document.getElementById("batch-run-list");
  clear(tabs);
  clear(list);

  if (status === "blocked") {
    list?.append(emptyState("허용되지 않은 반복 리플레이 로그 경로"));
    return;
  }

  if (!visibleRuns.length) {
    list?.append(emptyState("개별 가상 투자 실행 로그 없음"));
    return;
  }

  const batchKey = currentBatchKey(runsPayload);
  if (
    state.selectedBatchRunBatchKey !== batchKey ||
    runsPayload?.batchStatus === "running"
  ) {
    state.selectedBatchRunBatchKey = batchKey;
    state.selectedBatchRunIndex = visibleRuns.length - 1;
  } else {
    state.selectedBatchRunIndex = Math.max(
      0,
      Math.min(state.selectedBatchRunIndex, visibleRuns.length - 1)
    );
  }
  renderBatchRunTabs(tabs, list, visibleRuns);
  renderBatchRunPage(list, visibleRuns[state.selectedBatchRunIndex]);
}

function renderCurrentSimulationMonitor(runsPayload, runs, pendingBatchId) {
  if (pendingBatchId) {
    renderPendingSimulationMonitor(pendingBatchId);
    return;
  }

  const latestRun = runs.length ? runs[runs.length - 1] : null;
  const status = runsPayload?.batchStatus ?? runsPayload?.status ?? "missing";
  const progress = currentSimulationProgress(runsPayload);
  const performance = currentRunPerformance(latestRun, runsPayload);
  const problemCount = currentProblemCount(runsPayload);
  const activeProgress = activeRunProgress(runsPayload);
  const tradeCount =
    finiteNumber(activeProgress?.tradeCount) ??
    finiteNumber(latestRun?.summary?.tradeCount);
  const aiCallCount =
    finiteNumber(activeProgress?.decisionProviderCallCount) ??
    finiteNumber(latestRun?.summary?.decisionProviderCallCount);

  setStatus("current-simulation-status", status, currentSimulationStatusLabel(status));
  setText("current-simulation-batch", runsPayload?.batchId ?? "-");
  setText("current-simulation-run", currentSimulationRunText(latestRun, runsPayload));
  setText("current-simulation-progress", progress.text);
  setProgressBar("current-simulation-progress-bar", progress.percent);
  setText(
    "current-simulation-updated",
    formatDateTime(currentSimulationUpdatedAt(runsPayload))
  );
  setText("current-simulation-pnl", formatSignedKrw(performance.pnlKrw));
  setValueTone("current-simulation-pnl", performance.pnlKrw);
  setText("current-simulation-return", formatSignedRatio(performance.returnRatio));
  setValueTone("current-simulation-return", performance.returnRatio);
  setText(
    "current-simulation-trades",
    formatMetricCount(tradeCount, "건")
  );
  setText(
    "current-simulation-ai-calls",
    formatMetricCount(aiCallCount, "회")
  );
  setText("current-simulation-problems", `${problemCount}개`);
  setValueTone("current-simulation-problems", problemCount > 0 ? -problemCount : 0);
  setText("current-simulation-provider", currentProviderText(runsPayload));
  setText(
    "current-simulation-detail",
    currentSimulationDetailText(runsPayload, latestRun, performance)
  );
  setText("current-simulation-source", currentSimulationSourceText(runsPayload));
}

function renderPendingSimulationMonitor(batchId) {
  setStatus("current-simulation-status", "running", "manifest 대기");
  setText("current-simulation-batch", batchId);
  setText("current-simulation-run", "새 run manifest 생성 대기");
  setText("current-simulation-progress", "대기 중");
  setProgressBar("current-simulation-progress-bar", 0);
  setText("current-simulation-updated", "-");
  setText("current-simulation-pnl", "-");
  setValueTone("current-simulation-pnl", null);
  setText("current-simulation-return", "-");
  setValueTone("current-simulation-return", null);
  setText("current-simulation-trades", "-");
  setText("current-simulation-ai-calls", "-");
  setText("current-simulation-problems", "0개");
  setValueTone("current-simulation-problems", 0);
  setText("current-simulation-provider", "요청 수락됨");
  setText(
    "current-simulation-detail",
    "새 가상 투자 run 생성 요청이 수락되어 batch manifest 생성을 기다리는 중입니다."
  );
  setText("current-simulation-source", "-");
}

function renderActiveSimulationMetricCards(runsPayload) {
  const progress = activeRunProgress(runsPayload);
  const portfolio = progress?.currentPortfolio;
  if (!portfolio) {
    return;
  }

  setText("metric-net-worth", formatKrw(portfolio.virtualNetWorthKrw));
  setText("metric-cash", formatKrw(portfolio.cashKrw));
  setText("metric-positions", String(portfolio.positionCount ?? 0));
  setText("metric-source", currentSimulationStatusLabel(runsPayload?.batchStatus));
}

export function scheduleBatchRunsPolling(runsPayload) {
  clearBatchRunsPolling();
  if (!shouldUseBatchRunsPollingPage(state.currentPage) || !shouldPollBatchRuns(runsPayload)) {
    return;
  }

  state.batchRunsTimer = window.setTimeout(() => {
    state.batchRunsTimer = null;
    void refreshBatchRuns().catch(() => undefined);
  }, batchRunsPollMs);
}

function shouldUseBatchRunsPollingPage(page) {
  return page === "virtual" || page === "active-simulation" || page === "history";
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
    const event = new CustomEvent("batch-runs-refreshed", {
      cancelable: true,
      detail: payload
    });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) {
      renderBatchReplayRuns(payload);
      scheduleBatchRunsPolling(payload);
    }
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
  appendDefinition(diagnostics, "AI 실패 사유", aiDecisionFailureText(run));
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

function currentSimulationProgress(runsPayload) {
  const activeRun = currentActiveRun(runsPayload);
  const activeProgress = activeRunProgress(runsPayload);
  const completedTicks = finiteNumber(activeProgress?.completedTickCount);
  const totalTicks = finiteNumber(activeProgress?.tickCount);
  if (activeRun && completedTicks !== null && totalTicks !== null && totalTicks > 0) {
    const runIndex = finiteNumber(activeRun.runIndex);
    const runNumber = runIndex === null ? 1 : runIndex + 1;
    const requestedRunCount = finiteNumber(runsPayload?.requestedRunCount) ?? 1;
    return {
      text: `Run ${runNumber}/${requestedRunCount} · Tick ${completedTicks}/${totalTicks}`,
      percent: (completedTicks / totalTicks) * 100
    };
  }

  const counts = currentStatusCounts(runsPayload);
  const completed =
    Number(counts.completed ?? 0) +
    Number(counts.skipped ?? 0) +
    Number(counts.failed ?? 0);
  const requestedRunCount = finiteNumber(runsPayload?.requestedRunCount);
  const totalCount = finiteNumber(runsPayload?.totalCount);
  const total = requestedRunCount ?? totalCount ?? 0;

  if (total <= 0) {
    return {
      text: completed > 0 ? `${completed}개 처리` : "대기 중",
      percent: 0
    };
  }

  const boundedCompleted = Math.max(0, Math.min(completed, total));
  return {
    text: `${boundedCompleted}/${total}개`,
    percent: (boundedCompleted / total) * 100
  };
}

function currentStatusCounts(runsPayload) {
  const manifestCounts = runsPayload?.manifestCounts ?? {};
  const statusCounts = runsPayload?.statusCounts ?? {};
  return {
    completed:
      finiteNumber(manifestCounts.completed) ??
      finiteNumber(statusCounts.completed) ??
      0,
    skipped:
      finiteNumber(manifestCounts.skipped) ??
      finiteNumber(statusCounts.skipped) ??
      0,
    failed:
      finiteNumber(manifestCounts.failed) ??
      finiteNumber(statusCounts.failed) ??
      0
  };
}

function currentProblemCount(runsPayload) {
  const counts = currentStatusCounts(runsPayload);
  const runs = Array.isArray(runsPayload?.runs) ? runsPayload.runs : [];
  const aiFailureRuns =
    finiteNumber(runsPayload?.aiDecisionFailureRunCount) ??
    runs.filter((run) => Number(run?.summary?.aiDecisionFailureCount ?? 0) > 0)
      .length;
  return Number(counts.skipped ?? 0) + Number(counts.failed ?? 0) + aiFailureRuns;
}

function currentRunPerformance(run, runsPayload) {
  const activeProgress = activeRunProgress(runsPayload);
  const activeNetWorth = finiteNumber(
    activeProgress?.currentPortfolio?.virtualNetWorthKrw
  );
  const initialCashKrw = finiteNumber(runsPayload?.initialCashKrw);
  if (activeNetWorth !== null && initialCashKrw !== null && initialCashKrw > 0) {
    return {
      pnlKrw: activeNetWorth - initialCashKrw,
      returnRatio: activeNetWorth / initialCashKrw - 1
    };
  }

  const summary = run?.summary;
  const finalNetWorth = finiteNumber(summary?.finalVirtualNetWorthKrw);
  const returnRatio = finiteNumber(summary?.totalReturnRatio);
  const initialNetWorth =
    finalNetWorth !== null && returnRatio !== null && returnRatio > -1
      ? finalNetWorth / (1 + returnRatio)
      : null;

  return {
    pnlKrw: initialNetWorth !== null ? finalNetWorth - initialNetWorth : null,
    returnRatio
  };
}

function currentSimulationRunText(run, runsPayload) {
  const activeRun = currentActiveRun(runsPayload);
  if (activeRun) {
    return `${activeRunTitle(activeRun)} · 실행 중`;
  }
  if (run) {
    return `${batchRunTitle(run)} · ${runStatusLabel(run?.status)}`;
  }
  if (runsPayload?.batchId) {
    return "개별 run record 대기 중";
  }
  return "-";
}

function currentSimulationDetailText(runsPayload, latestRun, performance) {
  const status = runsPayload?.batchStatus ?? runsPayload?.status ?? "missing";
  if (status === "blocked") {
    return "runsPath가 허용된 artifact 경계 밖에 있어 읽지 않았습니다.";
  }
  if (!latestRun) {
    const activeRun = currentActiveRun(runsPayload);
    if (activeRun) {
      return `${currentSimulationStatusLabel(status)} · 현재 ${activeRunTitle(
        activeRun
      )} · ${batchRunRangeText(activeRun?.window)}`;
    }
    return runsPayload?.batchId
      ? "batch manifest는 생성되었고 개별 run record 생성을 기다리는 중입니다."
      : "표시할 batch replay manifest 또는 run log가 없습니다.";
  }

  const activeRun = currentActiveRun(runsPayload);
  if (activeRun) {
    const netWorth = finiteNumber(
      activeRunProgress(runsPayload)?.currentPortfolio?.virtualNetWorthKrw
    );
    const netWorthText = netWorth !== null ? ` · 현재 순자산 ${compactKrw(netWorth)}` : "";
    const pnlText =
      performance.pnlKrw !== null
        ? ` · 손익 ${formatSignedKrw(performance.pnlKrw)}`
        : "";
    return `${currentSimulationStatusLabel(status)} · 현재 ${activeRunTitle(
      activeRun
    )} · ${batchRunRangeText(activeRun?.window)}${netWorthText}${pnlText}`;
  }

  const pnlText =
    performance.pnlKrw !== null
      ? ` · 손익 ${formatSignedKrw(performance.pnlKrw)}`
      : "";
  return `${currentSimulationStatusLabel(status)} · 최신 ${runStatusLabel(
    latestRun?.status
  )} · ${batchRunRangeText(latestRun?.window)} · ${batchRunDetailText(
    latestRun
  )}${pnlText}`;
}

function currentSimulationUpdatedAt(runsPayload) {
  const progress = activeRunProgress(runsPayload);
  return (
    progress?.updatedAt ??
    runsPayload?.batchUpdatedAt ??
    runsPayload?.batchCompletedAt ??
    runsPayload?.batchStartedAt
  );
}

function displayRunsWithActiveRun(runsPayload, runs) {
  const activeRun = currentActiveRun(runsPayload);
  if (!activeRun) {
    return runs;
  }
  const activeDisplayRun = activeRunDisplayRecord(runsPayload, activeRun);
  return [
    ...runs.filter((run) => run?.runId !== activeDisplayRun.runId),
    activeDisplayRun
  ].sort(compareBatchRunRecords);
}

function activeRunDisplayRecord(runsPayload, activeRun) {
  const progress = activeRunProgress(runsPayload);
  const currentPortfolio = progress?.currentPortfolio ?? {};
  const netWorth = finiteNumber(currentPortfolio.virtualNetWorthKrw);
  const initialCashKrw = finiteNumber(runsPayload?.initialCashKrw);
  const positionValue = finiteNumber(currentPortfolio.positionMarketValueKrw);
  const cashKrw = finiteNumber(currentPortfolio.cashKrw);
  const positionRatio =
    netWorth !== null && netWorth > 0 && positionValue !== null
      ? positionValue / netWorth
      : null;
  const cashRatio =
    netWorth !== null && netWorth > 0 && cashKrw !== null ? cashKrw / netWorth : null;
  const totalReturnRatio =
    netWorth !== null && initialCashKrw !== null && initialCashKrw > 0
      ? netWorth / initialCashKrw - 1
      : null;

  return {
    ...activeRun,
    status: "running",
    completedAt: null,
    skippedAt: null,
    failedAt: null,
    summary: {
      finalVirtualNetWorthKrw: netWorth,
      totalReturnRatio,
      tradeCount: finiteNumber(progress?.tradeCount) ?? 0,
      decisionProviderCallCount:
        finiteNumber(progress?.decisionProviderCallCount) ?? 0,
      aiDecisionFailureCount: 0,
      aiDecisionFailureReasons: [],
      lastAiDecisionFailureSummary: null,
      rejectedCount: finiteNumber(progress?.rejectedCount) ?? 0,
      meaningfulRejectCount: 0,
      dustRejectCount: 0,
      avgExposureRatio: positionRatio,
      avgCashRatio: cashRatio,
      maxExposureRatio: positionRatio,
      minExposureRatio: positionRatio,
      timeInMarketRatio: positionRatio !== null && positionRatio > 0 ? 1 : 0,
      finalCashRatio: cashRatio,
      finalPositionRatio: positionRatio,
      targetExposureRatio: activeTargetExposureRatio(progress),
      averageTargetExposureGapRatio: null,
      finalTargetExposureGapRatio: null,
      finalExposureByMarketKrw: {},
      finalExposureByAssetTypeKrw: {}
    },
    reportPath: progress?.finalReportPath ?? null,
    error: progress?.error ?? null,
    skipReason: null
  };
}

function activeTargetExposureRatio(progress) {
  const packets = Array.isArray(progress?.recentPackets) ? progress.recentPackets : [];
  return finiteNumber(packets.at(-1)?.portfolioAllocation?.targetExposureRatio);
}

function currentSimulationSourceText(runsPayload) {
  const sourceDataDir = runsPayload?.sourceDataDir;
  const sourceRunsPath = runsPayload?.sourceRunsPath;
  if (sourceDataDir && sourceRunsPath) {
    return `${sourceDataDir} · ${sourceRunsPath}`;
  }
  return sourceDataDir ?? sourceRunsPath ?? "-";
}

function currentProviderText(runsPayload) {
  const mode = providerModeLabel(runsPayload?.decisionProviderMode);
  const maxCalls = finiteNumber(runsPayload?.decisionProviderMaxCallsPerRun);
  const riskProfile = runsPayload?.riskProfile;
  const maxCallsText = maxCalls !== null ? ` · max ${maxCalls}` : "";
  const riskText = riskProfile ? ` · ${riskProfile}` : "";
  return `${mode}${maxCallsText}${riskText}`;
}

function currentBatchKey(runsPayload) {
  return [
    runsPayload?.batchId ?? "",
    runsPayload?.sourceRunsPath ?? "",
    runsPayload?.batchStartedAt ?? ""
  ].join("|");
}

function currentActiveRun(runsPayload) {
  return runsPayload?.batchStatus === "running" && runsPayload?.activeRun
    ? runsPayload.activeRun
    : null;
}

function activeRunProgress(runsPayload) {
  return currentActiveRun(runsPayload) && runsPayload?.activeRunProgress
    ? runsPayload.activeRunProgress
    : null;
}

function activeRunTitle(run) {
  const runIndex = Number(run?.runIndex);
  const indexText = Number.isInteger(runIndex) ? `#${runIndex + 1}` : "#-";
  return `${indexText} ${run?.runId ?? "unknown"}`;
}

function providerModeLabel(mode) {
  if (mode === "codex_cli") {
    return "Codex paper";
  }
  if (mode === "deterministic_fixture") {
    return "fixture";
  }
  return mode ?? "-";
}

function currentSimulationStatusLabel(status) {
  if (status === "running") {
    return "실행 중";
  }
  if (status === "completed") {
    return "완료";
  }
  if (status === "completed_with_failures") {
    return "일부 실패";
  }
  if (status === "blocked") {
    return "차단";
  }
  if (status === "missing") {
    return "없음";
  }
  return String(status ?? "-");
}

function formatMetricCount(value, unit) {
  const number = finiteNumber(value);
  return number === null ? "-" : `${number}${unit}`;
}

function finiteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0)
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shouldPollBatchRuns(runsPayload) {
  const status = runsPayload?.status;
  return (
    pendingSimulationBatchIdWaitingFor(runsPayload) !== null ||
    status === "running" ||
    (status === "missing" && runsPayload?.aggregateStatus === "missing") ||
    runsPayload === undefined
  );
}

function pendingSimulationBatchIdWaitingFor(runsPayload) {
  const pendingBatchId = currentPendingSimulationBatchId();
  if (!pendingBatchId) {
    return null;
  }
  if (runsPayload?.batchId === pendingBatchId) {
    clearPendingSimulationBatchId();
    return null;
  }
  return pendingBatchId;
}

function currentPendingSimulationBatchId() {
  if (state.pendingSimulationBatchId) {
    return state.pendingSimulationBatchId;
  }
  try {
    const stored = window.sessionStorage.getItem(
      pendingSimulationBatchStorageKey
    );
    if (typeof stored === "string" && stored.trim().length > 0) {
      state.pendingSimulationBatchId = stored.trim();
      return state.pendingSimulationBatchId;
    }
  } catch {
    return null;
  }
  return null;
}

function clearPendingSimulationBatchId() {
  state.pendingSimulationBatchId = null;
  try {
    window.sessionStorage.removeItem(pendingSimulationBatchStorageKey);
  } catch {
    // Session storage can be unavailable in restricted browser contexts.
  }
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
  if (run?.status === "running") {
    return "현재 실행 중인 run입니다. 진행 중 결과는 historical-replay-progress.json 기준입니다.";
  }
  if (run?.status === "skipped") {
    return `skip: ${run?.skipReason ?? "unknown"}`;
  }
  if (run?.status === "failed") {
    return `error: ${run?.error ?? "unknown"}`;
  }
  const aiFailureCount = Number(run?.summary?.aiDecisionFailureCount ?? 0);
  if (aiFailureCount > 0) {
    return `AI 실패 ${aiFailureCount}건 · ${aiDecisionFailureText(run)}`;
  }
  const exposure = formatRatio(run?.summary?.finalPositionRatio);
  const target = formatRatio(run?.summary?.targetExposureRatio);
  return `노출 ${exposure} / 목표 ${target} · report ${run?.reportPath ?? "-"}`;
}

function aiDecisionFailureText(run) {
  const summary = run?.summary ?? {};
  const lastSummary = summary?.lastAiDecisionFailureSummary;
  if (typeof lastSummary === "string" && lastSummary.trim().length > 0) {
    return lastSummary;
  }
  const reasons = Array.isArray(summary?.aiDecisionFailureReasons)
    ? summary.aiDecisionFailureReasons
    : [];
  const lastReason = reasons.at(-1);
  return typeof lastReason === "string" && lastReason.trim().length > 0
    ? lastReason
    : "-";
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
  if (status === "running") {
    return "실행 중";
  }
  if (status === "completed") {
    return "완료";
  }
  if (status === "completed_with_failures") {
    return "일부 실패";
  }
  if (status === "skipped") {
    return "스킵";
  }
  if (status === "failed") {
    return "실패";
  }
  return String(status ?? "-");
}
