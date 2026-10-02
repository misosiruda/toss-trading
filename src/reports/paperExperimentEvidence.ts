import type { MarketPacket, VirtualDecision, VirtualPortfolio, VirtualRiskDecision, VirtualTrade } from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createVirtualDecisionHash } from "../paper/decisionHash.js";
import type { HistoricalReplayPortfolioTimelineRecord, HistoricalReplayRunMetadata } from "../replay/historicalReplayAuditLog.js";
import { HISTORICAL_REPLAY_PROGRESS_DEFAULT_LIMITS as progressLimits, toHistoricalReplayPortfolioProgress, type HistoricalReplayProgressSnapshot } from "../replay/historicalReplayProgress.js";
import type { parsePaperExperimentInput } from "../replay/paperExperimentInput.js";
import type { ReplaySamplingDecisionReason } from "../replay/replaySamplingPolicy.js";
import { createReplayResearchHash } from "../replay/replayRunManifest.js";
import { buildHistoricalReplayRetainedEvidence, type HistoricalReplayReport } from "./historicalReplayReport.js";

export interface PaperExperimentRetainedEvidence {
  input: ReturnType<typeof parsePaperExperimentInput>;
  metadata: HistoricalReplayRunMetadata;
  progress: HistoricalReplayProgressSnapshot;
  // The storage boundary has already checked the full shape; equality never trusts a report-derived input.
  report: { [K in keyof HistoricalReplayReport]: unknown };
  packets: MarketPacket[];
  decisions: VirtualDecision[];
  risks: VirtualRiskDecision[];
  trades: VirtualTrade[];
  timeline: HistoricalReplayPortfolioTimelineRecord[];
}

/** Pure evidence checks only. No runner, provider, filesystem, repairs, or new financial formulas. */
export function verifyPaperExperimentRetainedEvidence(evidence: PaperExperimentRetainedEvidence): void {
  const { input, metadata, progress, report, packets, decisions, risks, trades, timeline } = evidence;
  const config = input.normalizedInput.configuration;
  const ticks = input.preflight.ticks;
  const finalTick = ticks.at(-1);
  requireEvidence(finalTick !== undefined);
  const portfolio = (row: HistoricalReplayPortfolioTimelineRecord): VirtualPortfolio => ({
    portfolioId: "retained-experiment-evidence", cashKrw: row.portfolio.cashKrw,
    positions: row.portfolio.positions, updatedAt: row.simulatedAt
  });
  let previousTick = -1;
  for (const row of timeline) {
    requireEvidence(row.tickIndex >= previousTick);
    previousTick = row.tickIndex;
    equalEvidence(row.portfolio, toHistoricalReplayPortfolioProgress(new Date(row.simulatedAt), portfolio(row)));
  }
  const finalRecords = ticks.map((_, index) => {
    const row = timeline.filter((row) => row.tickIndex === index).at(-1);
    requireEvidence(row !== undefined);
    return row;
  });
  const final = finalRecords.at(-1);
  requireEvidence(final !== undefined);
  const summaries = buildHistoricalReplayRetainedEvidence({
    initialPortfolio: { portfolioId: "retained-experiment-evidence", cashKrw: config.initialCashKrw,
      positions: [], updatedAt: config.clock.startAt },
    finalPortfolio: portfolio(final),
    portfolioTimeline: finalRecords.map(({ portfolio: { positions, ...summary } }) => { void positions; return summary; }),
    packets, decisions, riskDecisions: risks, trades,
    // JSON normalization has removed undefined; this preserves the existing policy type without resolving defaults again.
    allocationPolicy: JSON.parse(JSON.stringify(config.allocationPolicy))
  });
  const { riskEvidence, ...reproducibleSections } = summaries;
  for (const [key, value] of Object.entries(reproducibleSections)) {
    equalEvidence(report[key as keyof HistoricalReplayReport], value);
  }
  equalEvidence(metadata.riskPolicySummary, riskEvidence.policySummary);
  const reportRisk = report.riskSummary as HistoricalReplayReport["riskSummary"];
  equalEvidence(reportRisk.rejectCodes, riskEvidence.rejectCodes);
  equalEvidence(reportRisk.policySummary, riskEvidence.policySummary);
  equalEvidence(reportRisk.meaningfulRejectCount, risks.filter((row) => !row.approved).length);
  equalEvidence(report.allocationPolicy, config.allocationPolicy);
  equalEvidence(report.paperExitPolicy, config.paperExitPolicy);
  equalEvidence(report.generatedAt, input.normalizedInput.evaluation.generatedAt);
  equalEvidence(metadata.window, {
    source: "explicit", startAt: config.clock.startAt, endAt: config.clock.endAt,
    rangeStart: null, rangeEnd: null, seed: null, selectedMonth: null, localStartDate: null,
    localEndDate: null, windowMonths: null, timezoneOffsetMinutes: 0
  });

  equalEvidence(progress.tickIndex, ticks.length - 1);
  equalEvidence(progress.simulatedAt, finalTick.simulatedAt);
  equalEvidence(progress.currentPortfolio, final.portfolio);
  equalEvidence(progress.portfolioTimeline, finalRecords.map((row) => row.portfolio).slice(-progressLimits.portfolioTimeline));
  for (const [recent, all, maximum] of [
    [progress.recentPackets, packets, progressLimits.recentPackets], [progress.recentDecisions, decisions, progressLimits.recentRecords],
    [progress.recentRiskDecisions, risks, progressLimits.recentRecords], [progress.recentTrades, trades, progressLimits.recentRecords]
  ] as const) {
    equalEvidence(recent, all.slice(-maximum).reverse());
  }

  const tickByTime = new Map(ticks.map((tick, index) => [tick.simulatedAt, index]));
  let previousPacketTick = -1;
  for (const packet of packets) {
    const index = tickByTime.get(packet.generatedAt);
    requireEvidence(index !== undefined && index > previousPacketTick);
    previousPacketTick = index;
  }
  const packetById = new Map(packets.map((packet) => [packet.packetId, packet]));
  for (const decision of decisions) {
    const packet = packetById.get(decision.packetId);
    requireEvidence(packet !== undefined);
    equalEvidence(decision.decisionHash, createVirtualDecisionHash(decision));
    if (decision.packetHash !== undefined) equalEvidence(decision.packetHash, createMarketPacketHash(packet));
  }
  for (const risk of risks) {
    const packet = packetById.get(risk.packetId);
    requireEvidence(packet !== undefined && risk.createdAt === packet.generatedAt);
    requireEvidence(decisions.some((decision) => decision.packetId === risk.packetId
      && (risk.symbol === undefined || decision.decisions.some((item) => item.symbol === risk.symbol))));
  }
  const riskById = new Map(risks.map((risk) => [risk.riskDecisionId, risk]));
  for (const trade of trades) {
    requireEvidence(packetById.has(trade.packetId));
    const risk = riskById.get(trade.decisionId);
    requireEvidence(risk !== undefined && risk.approved && risk.packetId === trade.packetId && risk.symbol === trade.symbol
      && trade.executedAt === risk.createdAt);
    requireEvidence(decisions.some((decision) => decision.packetId === trade.packetId
      && decision.decisions.some((item) => item.market === trade.market && item.symbol === trade.symbol && item.action === trade.action)));
  }

  requireEvidence(progress.recentEvents.length <= progressLimits.recentEvents);
  for (const event of progress.recentEvents) {
    requireEvidence(event.simulatedAt === ticks[event.tickIndex]?.simulatedAt
      && event.simulatedAt === packetById.get(event.packetId)?.generatedAt);
    requireEvidence(decisions.some((decision) => decision.packetId === event.packetId
      && decision.decisions.some((item) => item.market === event.market && item.symbol === event.symbol && item.action === event.action)));
    if (event.eventType === "VIRTUAL_BUY" || event.eventType === "VIRTUAL_SELL") {
      requireEvidence(event.approved && event.rejectCodes.length === 0 && trades.some((trade) =>
        trade.packetId === event.packetId && trade.market === event.market && trade.symbol === event.symbol
        && trade.action === event.eventType && trade.action === event.action && trade.amountKrw === event.amountKrw));
    } else if (event.eventType === "RISK_REJECTED") {
      requireEvidence(!event.approved && risks.some((risk) => !risk.approved && risk.packetId === event.packetId
        && risk.symbol === event.symbol && createReplayResearchHash(risk.rejectCodes) === createReplayResearchHash(event.rejectCodes)));
    }
  }

  // These facts lack full per-event histories in the inventory. Check bounded agreement, not invented receipts.
  const sampling = report.samplingSummary as HistoricalReplayReport["samplingSummary"];
  equalEvidence(sampling.policy, config.samplingPolicy);
  equalEvidence(sampling.decisionsRequested, progress.decisionProviderCallCount);
  equalEvidence(sampling.decisionsSkipped, progress.decisionSkippedCount);
  requireEvidence(progress.decisionProviderCallCount >= decisions.length
    && progress.decisionProviderCallCount <= input.preflight.decisionCallUpperBound
    && progress.decisionProviderCallCount + progress.decisionSkippedCount <= packets.length);
  const supportedSkipReasons: readonly ReplaySamplingDecisionReason[] = ["STEP_INTERVAL_SKIPPED", "CANDIDATES_UNCHANGED",
    "FREQUENCY_WINDOW_ALREADY_EVALUATED", "DECISION_CALL_BUDGET_EXHAUSTED"];
  requireEvidence(Object.entries(sampling.skipReasons).every(([reason, count]) =>
    supportedSkipReasons.includes(reason as ReplaySamplingDecisionReason) && count > 0));
  equalEvidence(Object.values(sampling.skipReasons).reduce((sum, count) => sum + count, 0), sampling.decisionsSkipped);
  const decisionItemCount = decisions.reduce((sum, decision) => sum + decision.decisions.length, 0);
  requireEvidence(reportRisk.dustRejectCount <= decisionItemCount
    && reportRisk.dustRejectCount >= progress.recentEvents.filter((event) => event.eventType === "NO_OP_EXIT_DUST_CLOSED").length);
  const warnings = report.sourceWarningSummary as HistoricalReplayReport["sourceWarningSummary"];
  requireEvidence(warnings.futureSnapshotWarningCount <= warnings.warningCount && warnings.staleSnapshotWarningCount <= warnings.warningCount);
  equalEvidence(warnings.recentWarnings.length, Math.min(warnings.warningCount, 10));
  equalEvidence(warnings.lookaheadGuardStatus, warnings.futureSnapshotWarningCount > 0 ? "future_snapshots_excluded" : "no_future_snapshot_warnings");
}

function equalEvidence(left: unknown, right: unknown): void {
  requireEvidence(createReplayResearchHash(left) === createReplayResearchHash(right));
}
function requireEvidence(condition: unknown): asserts condition {
  if (!condition) throw new Error("Paper experiment retained evidence mismatch");
}
