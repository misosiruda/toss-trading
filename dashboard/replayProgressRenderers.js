import {
  appendEmptyRow,
  cell,
  clear,
  setProgressBar,
  setStatus,
  setText
} from "./dom.js";
import {
  formatDateTime,
  formatDurationMs,
  formatKrw,
  performanceBottleneckLabel
} from "./formatters.js";
import {
  displayActionLabel,
  flattenDecisionRecords
} from "./decisionRenderers.js";
import { currentPortfolioSummary } from "./portfolioModel.js";
import { symbolCell } from "./tableRenderers.js";

export function renderReplayProgress(progressPayload) {
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

export function replayProgressStatus(progressPayload) {
  return progressPayload?.progress?.status ?? progressPayload?.status ?? "missing";
}

export function replayProgressPortfolio(progressPayload) {
  return progressPayload?.progress?.currentPortfolio ?? null;
}

export function isReplayProgressActive(progressPayload) {
  return replayProgressStatus(progressPayload) === "running";
}

export function replayProgressRiskSummary(progress) {
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

export function replayProgressDecisionOutcome(progress) {
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
