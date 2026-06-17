import {
  endpointErrorMessage,
  endpoints,
  fetchJson
} from "./apiClient.js";
import {
  setText,
  showError
} from "./dom.js";
import { formatDateTime } from "./formatters.js";
import {
  flattenDecisionRecords,
  renderDecisionPerformance,
  renderDecisionTimeline,
  renderRiskSummary,
  updateFilterControls
} from "./decisionRenderers.js";
import {
  renderBenchmarkComparison,
  renderEventCoverage,
  renderExposureBreakdown,
  renderIncomeGoalPanel,
  renderMarketMonitor,
  renderPortfolioPerformance,
  renderPortfolioRiskMetrics
} from "./portfolioRenderers.js";
import { currentPortfolioSummary } from "./portfolioModel.js";
import {
  isReplayProgressActive,
  replayProgressDecisionOutcome,
  replayProgressRiskSummary,
  replayProgressStatus,
  renderReplayProgress
} from "./replayProgressRenderers.js";
import {
  replayProgressPollMs,
  state
} from "./state.js";
import { rememberSymbolMetadata } from "./sourceRenderers.js";
import {
  renderPackets,
  renderPositions,
  renderTrades
} from "./tableRenderers.js";

export function renderLiveReplaySections(progressPayload) {
  if (!isReplayProgressActive(progressPayload)) {
    return;
  }

  const progress = progressPayload?.progress ?? null;
  if (!progress) {
    return;
  }

  rememberSymbolMetadata({ replayProgress: progressPayload });

  const replayPortfolio = currentPortfolioSummary(
    { replayProgress: progressPayload },
    []
  );
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

export function scheduleReplayProgressPolling(progressPayload, options = {}) {
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
    void refreshReplayProgress(options).catch((error) => {
      showError(endpointErrorMessage(endpoints.replayProgress, error));
    });
  }, replayProgressPollMs);
}

async function refreshReplayProgress(options) {
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
      await options.onCompleted?.();
      return;
    }

    scheduleReplayProgressPolling(payload, options);
  } finally {
    state.replayProgressInFlight = false;
  }
}

function shouldPollReplayProgress(status) {
  return status === "running" || status === "missing" || status === "idle";
}
