export function currentSimulationDashboardData(data) {
  const artifacts = data?.batchRuns?.latestRunArtifacts;
  if (!artifacts || artifacts.status !== "ok") {
    return data;
  }

  const report = artifacts.report ?? null;
  const progress = currentRunProgress(artifacts);
  const packets = Array.isArray(artifacts.packets) ? artifacts.packets : [];
  const decisions = Array.isArray(artifacts.decisions) ? artifacts.decisions : [];
  const riskDecisions = Array.isArray(artifacts.riskDecisions)
    ? artifacts.riskDecisions
    : [];
  const trades = Array.isArray(artifacts.trades) ? artifacts.trades : [];
  const currentPortfolio = currentPortfolioSnapshot(progress, report);
  const dailyReport = currentRunDailyReport(report, progress, artifacts);

  return {
    ...data,
    replay: {
      ...(data.replay ?? {}),
      status: report ? "ok" : data.replay?.status,
      report: report ?? data.replay?.report
    },
    replayProgress: progress
      ? {
          ...(data.replayProgress ?? {}),
          status: progress.status ?? artifacts.progressStatus ?? "ok",
          fileStatus: artifacts.progressStatus ?? data.replayProgress?.fileStatus,
          progress
        }
      : data.replayProgress,
    report: dailyReport ?? data.report,
    portfolio: currentPortfolio
      ? {
          ...(data.portfolio ?? {}),
          portfolio: currentPortfolio,
          sourceStatus: "current_run"
        }
      : data.portfolio,
    decisions: decisions.length
      ? {
          mode: "paper_only",
          readOnly: true,
          decisions,
          count: artifacts.decisionCount ?? decisions.length,
          totalCount: artifacts.totalDecisionCount ?? decisions.length,
          corruptLineCount: artifacts.decisionCorruptLineCount ?? 0
        }
      : data.decisions,
    trades: trades.length
      ? {
          mode: "paper_only",
          readOnly: true,
          trades,
          count: artifacts.tradeCount ?? trades.length,
          totalCount: artifacts.totalTradeCount ?? trades.length,
          corruptLineCount: artifacts.tradeCorruptLineCount ?? 0
        }
      : data.trades,
    packets: packets.length
      ? {
          mode: "paper_only",
          readOnly: true,
          packets,
          count: artifacts.packetCount ?? packets.length,
          totalCount: artifacts.totalPacketCount ?? packets.length,
          corruptLineCount: artifacts.packetCorruptLineCount ?? 0
        }
      : data.packets,
    source: packets.length
      ? currentRunSourceStatus(packets, artifacts)
      : data.source,
    currentRunArtifacts: {
      ...artifacts,
      riskDecisions
    }
  };
}

function currentRunProgress(artifacts) {
  const progress = artifacts.progress;
  if (!progress) {
    return null;
  }
  return {
    ...progress,
    recentPackets: Array.isArray(artifacts.packets)
      ? artifacts.packets
      : progress.recentPackets,
    recentDecisions: Array.isArray(artifacts.decisions)
      ? artifacts.decisions
      : progress.recentDecisions,
    recentRiskDecisions: Array.isArray(artifacts.riskDecisions)
      ? artifacts.riskDecisions
      : progress.recentRiskDecisions,
    recentTrades: Array.isArray(artifacts.trades)
      ? artifacts.trades
      : progress.recentTrades
  };
}

function currentPortfolioSnapshot(progress, report) {
  if (progress?.currentPortfolio) {
    const portfolio = progress.currentPortfolio;
    return {
      portfolioId: "current_simulation",
      cashKrw: Number(portfolio.cashKrw ?? 0),
      positions: Array.isArray(portfolio.positions) ? portfolio.positions : [],
      updatedAt:
        portfolio.simulatedAt ??
        progress.simulatedAt ??
        progress.updatedAt ??
        report?.generatedAt ??
        new Date().toISOString()
    };
  }

  const latestPoint = Array.isArray(report?.portfolioTimeline)
    ? report.portfolioTimeline.at(-1)
    : null;
  if (!latestPoint) {
    return null;
  }
  return {
    portfolioId: "current_simulation",
    cashKrw: Number(latestPoint.cashKrw ?? report?.portfolio?.finalCashKrw ?? 0),
    positions: [],
    updatedAt: latestPoint.simulatedAt ?? report?.generatedAt ?? new Date().toISOString()
  };
}

function currentRunDailyReport(report, progress, artifacts) {
  if (!report && !progress) {
    return null;
  }

  const currentPortfolio = progress?.currentPortfolio;
  const latestTimelinePoint = Array.isArray(report?.portfolioTimeline)
    ? report.portfolioTimeline.at(-1)
    : null;
  const decisionOutcome = {
    ...(report?.decisionOutcome ?? {}),
    decisionItemCount:
      report?.replaySummary?.decisionItemCount ??
      progress?.decisionRecordCount ??
      countDecisionItems(artifacts.decisions),
    averageConfidence: report?.decisionOutcome?.averageConfidence ?? null
  };
  const riskSummary = {
    ...(report?.riskSummary ?? {}),
    approvedCount:
      report?.riskSummary?.approvedCount ?? progress?.riskApprovedCount ?? 0,
    rejectedCount:
      report?.riskSummary?.rejectedCount ?? progress?.rejectedCount ?? 0,
    recentRejectedSummaries: recentRejectedSummaries(
      artifacts.riskDecisions,
      report?.riskSummary
    )
  };

  return {
    title: "Current Simulation Paper Report",
    mode: "paper_only",
    date: localDateFromTimestamp(
      progress?.simulatedAt ??
        report?.simulatedRange?.endAt ??
        report?.generatedAt
    ),
    generatedAt: report?.generatedAt ?? progress?.updatedAt ?? null,
    decisionOutcome,
    tradeSummary:
      report?.tradeSummary ??
      tradeSummaryFromTrades(artifacts.trades),
    riskSummary,
    sourceStatus: currentRunDailySourceStatus(report, artifacts),
    portfolio: {
      ...(report?.portfolio ?? {}),
      cashKrw:
        currentPortfolio?.cashKrw ??
        latestTimelinePoint?.cashKrw ??
        report?.portfolio?.finalCashKrw ??
        null,
      positionCount:
        currentPortfolio?.positionCount ??
        latestTimelinePoint?.positionCount ??
        report?.portfolio?.finalPositionCount ??
        0,
      virtualNetWorthKrw:
        currentPortfolio?.virtualNetWorthKrw ??
        latestTimelinePoint?.virtualNetWorthKrw ??
        report?.portfolio?.finalVirtualNetWorthKrw ??
        null
    },
    analytics: report?.analytics,
    disclaimer:
      report?.disclaimer ??
      "Paper-only virtual simulation. This is not financial advice, not a performance guarantee, and cannot place live orders."
  };
}

function currentRunDailySourceStatus(report, artifacts) {
  const summary = report?.sourceWarningSummary ?? {};
  const recentWarnings = Array.isArray(summary.recentWarnings)
    ? summary.recentWarnings
    : [];
  const nonRoutineWarnings = recentWarnings.filter(
    (warning) => !isRoutineHistoricalSnapshotFilterWarning(warning)
  );
  const warningCount = Math.max(
    0,
    Number(summary.warningCount ?? 0) -
      Number(summary.futureSnapshotWarningCount ?? 0) -
      Number(summary.staleSnapshotWarningCount ?? 0)
  );
  const routineFilterCount =
    Number(summary.futureSnapshotWarningCount ?? 0) +
    Number(summary.staleSnapshotWarningCount ?? 0);

  return {
    status: warningCount > 0 ? "degraded" : "ok",
    packetCreatedCount:
      report?.replaySummary?.packetCount ?? artifacts.totalPacketCount ?? 0,
    warningCount,
    warnings: nonRoutineWarnings,
    routineFilterCount,
    futureSnapshotFilterCount: Number(summary.futureSnapshotWarningCount ?? 0),
    staleSnapshotFilterCount: Number(summary.staleSnapshotWarningCount ?? 0),
    lookaheadGuardStatus: summary.lookaheadGuardStatus ?? "unknown"
  };
}

function isRoutineHistoricalSnapshotFilterWarning(warning) {
  const normalized = String(warning ?? "").toLowerCase();
  return (
    normalized.includes("future snapshot") ||
    normalized.includes("stale historical snapshot")
  );
}

function currentRunSourceStatus(packets, artifacts) {
  const sorted = [...packets].sort(
    (left, right) => new Date(left.generatedAt) - new Date(right.generatedAt)
  );
  return {
    mode: "paper_only",
    readOnly: true,
    status: "ok",
    totalCount: artifacts.totalPacketCount ?? packets.length,
    byStatus: { ok: artifacts.totalPacketCount ?? packets.length },
    byCommandKey: { historical_replay: artifacts.totalPacketCount ?? packets.length },
    lastCollectedAt: sorted.at(-1)?.generatedAt ?? null,
    corruptLineCount: artifacts.packetCorruptLineCount ?? 0
  };
}

function countDecisionItems(records) {
  return Array.isArray(records)
    ? records.reduce((sum, record) => sum + (record.decisions?.length ?? 0), 0)
    : 0;
}

function tradeSummaryFromTrades(trades) {
  const records = Array.isArray(trades) ? trades : [];
  return {
    tradeCount: records.length,
    virtualBuyAmountKrw: records
      .filter((trade) => trade.action === "VIRTUAL_BUY")
      .reduce((sum, trade) => sum + Number(trade.amountKrw ?? 0), 0),
    virtualSellAmountKrw: records
      .filter((trade) => trade.action === "VIRTUAL_SELL")
      .reduce((sum, trade) => sum + Number(trade.amountKrw ?? 0), 0),
    symbols: Array.from(new Set(records.map((trade) => trade.symbol).filter(Boolean)))
  };
}

function recentRejectedSummaries(riskDecisions, riskSummary) {
  const rejected = Array.isArray(riskDecisions)
    ? riskDecisions.filter((decision) => decision && decision.approved === false)
    : [];
  if (rejected.length) {
    return rejected.slice(-3).map((decision) => {
      const symbol = [decision.market, decision.symbol].filter(Boolean).join(":");
      const action = decision.action ?? "VIRTUAL";
      const codes = Array.isArray(decision.rejectCodes)
        ? decision.rejectCodes.join(",")
        : "rejected";
      return `${symbol || "-"} ${action} ${codes}`;
    });
  }
  return riskSummary?.recentRejectedSummaries ?? [];
}

function localDateFromTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}
