import {
  buildPaperPortfolioAnalytics,
  type PaperPortfolioAnalytics
} from "../analytics/paperPortfolioAnalytics.js";
import type { VirtualDecision, VirtualPortfolio, VirtualTrade } from "../domain/schemas.js";
import type {
  HistoricalPortfolioTimelineItem,
  HistoricalReplayResult
} from "../replay/historicalReplayRunner.js";
import {
  missingReplayResearchManifestReference,
  replayResearchManifestReference,
  type ReplayResearchManifestReference
} from "../replay/replayRunManifest.js";
import type { ReplayResearchManifest } from "../domain/schemas.js";
import { maskSensitiveText } from "../security/masking.js";
import {
  buildHistoricalReplayBenchmarks,
  type HistoricalReplayBenchmarkReport
} from "./historicalReplayBenchmark.js";

export interface HistoricalReplayReportOptions {
  result: HistoricalReplayResult;
  generatedAt: Date;
  title?: string;
  researchManifest?: ReplayResearchManifest | null;
  researchManifestPath?: string | null;
}

export interface HistoricalReplayReport {
  title: string;
  mode: "paper_only";
  generatedAt: string;
  simulatedRange: HistoricalReplayRangeSummary;
  replaySummary: HistoricalReplaySummary;
  allocationPolicy: HistoricalReplayResult["allocationPolicy"];
  paperExitPolicy: HistoricalReplayResult["paperExitPolicy"];
  portfolio: HistoricalReplayPortfolioSummary;
  portfolioConstruction: HistoricalReplayPortfolioConstructionMetrics;
  analytics: PaperPortfolioAnalytics;
  decisionOutcome: HistoricalReplayDecisionOutcomeSummary;
  tradeSummary: HistoricalReplayTradeSummary;
  riskSummary: HistoricalReplayRiskSummary;
  samplingSummary: HistoricalReplaySamplingSummary;
  reproducibility: ReplayResearchManifestReference;
  benchmarks: HistoricalReplayBenchmarkReport;
  sourceWarningSummary: HistoricalReplaySourceWarningSummary;
  portfolioTimeline: HistoricalPortfolioTimelineItem[];
  disclaimer: string;
}

export interface HistoricalReplayRangeSummary {
  startAt: string | null;
  endAt: string | null;
  tickCount: number;
}

export interface HistoricalReplaySummary {
  packetCount: number;
  decisionProviderCallCount: number;
  decisionSkippedCount: number;
  decisionRecordCount: number;
  decisionItemCount: number;
  tradeCount: number;
  rejectedCount: number;
}

export interface HistoricalReplayPortfolioSummary {
  initialCashKrw: number;
  finalCashKrw: number;
  finalPositionCount: number;
  finalPositionMarketValueKrw: number;
  finalVirtualNetWorthKrw: number;
}

export interface HistoricalReplayPortfolioConstructionMetrics {
  avgExposureRatio: number | null;
  avgCashRatio: number | null;
  maxExposureRatio: number | null;
  minExposureRatio: number | null;
  timeInMarketRatio: number | null;
  finalCashRatio: number | null;
  finalPositionRatio: number | null;
  targetExposureRatio: number | null;
  averageTargetExposureGapRatio: number | null;
  finalTargetExposureGapRatio: number | null;
}

export interface HistoricalReplayDecisionOutcomeSummary {
  byAction: Record<string, number>;
  averageConfidence: number | null;
  symbols: string[];
}

export interface HistoricalReplayTradeSummary {
  tradeCount: number;
  virtualBuyAmountKrw: number;
  virtualSellAmountKrw: number;
  symbols: string[];
}

export interface HistoricalReplayRiskSummary {
  approvedCount: number;
  rejectedCount: number;
  meaningfulRejectCount: number;
  dustRejectCount: number;
  rejectCodes: Record<string, number>;
}

export interface HistoricalReplaySamplingSummary {
  policy: HistoricalReplayResult["samplingPolicy"];
  decisionsRequested: number;
  decisionsSkipped: number;
  skipReasons: Record<string, number>;
}

export interface HistoricalReplaySourceWarningSummary {
  warningCount: number;
  futureSnapshotWarningCount: number;
  staleSnapshotWarningCount: number;
  recentWarnings: string[];
  lookaheadGuardStatus: "future_snapshots_excluded" | "no_future_snapshot_warnings";
}

export function buildHistoricalReplayReport(
  options: HistoricalReplayReportOptions
): HistoricalReplayReport {
  const result = options.result;

  return {
    title: options.title ?? "Historical Replay Paper Report",
    mode: "paper_only",
    generatedAt: options.generatedAt.toISOString(),
    simulatedRange: summarizeRange(result),
    replaySummary: {
      packetCount: result.packetCount,
      decisionProviderCallCount: result.decisionProviderCallCount,
      decisionSkippedCount: result.decisionSkippedCount,
      decisionRecordCount: result.decisionRecordCount,
      decisionItemCount: result.decisionItemCount,
      tradeCount: result.tradeCount,
      rejectedCount: result.rejectedCount
    },
    allocationPolicy: result.allocationPolicy,
    paperExitPolicy: result.paperExitPolicy,
    portfolio: summarizePortfolio(result.initialPortfolio, result.finalPortfolio),
    portfolioConstruction: buildPortfolioConstructionMetrics(
      result.portfolioTimeline,
      result.allocationPolicy
    ),
    analytics: buildPaperPortfolioAnalytics({
      portfolio: result.finalPortfolio,
      decisions: result.decisions,
      trades: result.trades
    }),
    decisionOutcome: summarizeDecisions(result.decisions),
    tradeSummary: summarizeTrades(result.trades),
    riskSummary: summarizeRisk(result),
    samplingSummary: summarizeSampling(result),
    reproducibility:
      options.researchManifest === undefined || options.researchManifest === null
        ? missingReplayResearchManifestReference("RESEARCH_MANIFEST_MISSING")
        : replayResearchManifestReference({
            manifest: options.researchManifest,
            manifestPath: options.researchManifestPath ?? "unknown"
          }),
    benchmarks: buildHistoricalReplayBenchmarks(result),
    sourceWarningSummary: summarizeWarnings(result.warnings),
    portfolioTimeline: result.portfolioTimeline,
    disclaimer: historicalReplayDisclaimer()
  };
}

export function renderHistoricalReplayReport(
  report: HistoricalReplayReport
): string {
  const lines = [
    `# ${report.title}`,
    "",
    `mode: ${report.mode}`,
    `generated_at: ${report.generatedAt}`,
    "",
    "## Simulated Range",
    `start_at: ${report.simulatedRange.startAt ?? "null"}`,
    `end_at: ${report.simulatedRange.endAt ?? "null"}`,
    `tick_count: ${report.simulatedRange.tickCount}`,
    "",
    "## Replay Summary",
    `packet_count: ${report.replaySummary.packetCount}`,
    `decision_provider_calls: ${report.replaySummary.decisionProviderCallCount}`,
    `decision_skipped_count: ${report.replaySummary.decisionSkippedCount}`,
    `decision_records: ${report.replaySummary.decisionRecordCount}`,
    `decision_items: ${report.replaySummary.decisionItemCount}`,
    `trade_count: ${report.replaySummary.tradeCount}`,
    `risk_rejected_count: ${report.replaySummary.rejectedCount}`,
    `allocation_policy: ${JSON.stringify(report.allocationPolicy)}`,
    `paper_exit_policy: ${JSON.stringify(report.paperExitPolicy)}`,
    "",
    "## Final Virtual Portfolio",
    `initial_cash_krw: ${report.portfolio.initialCashKrw}`,
    `final_cash_krw: ${report.portfolio.finalCashKrw}`,
    `final_position_count: ${report.portfolio.finalPositionCount}`,
    `final_position_market_value_krw: ${report.portfolio.finalPositionMarketValueKrw}`,
    `final_virtual_net_worth_krw: ${report.portfolio.finalVirtualNetWorthKrw}`,
    "",
    "## Portfolio Analytics",
    `avg_exposure_ratio: ${formatNullable(report.portfolioConstruction.avgExposureRatio)}`,
    `avg_cash_ratio: ${formatNullable(report.portfolioConstruction.avgCashRatio)}`,
    `max_exposure_ratio: ${formatNullable(report.portfolioConstruction.maxExposureRatio)}`,
    `min_exposure_ratio: ${formatNullable(report.portfolioConstruction.minExposureRatio)}`,
    `time_in_market_ratio: ${formatNullable(report.portfolioConstruction.timeInMarketRatio)}`,
    `final_cash_ratio: ${formatNullable(report.portfolioConstruction.finalCashRatio)}`,
    `final_position_ratio: ${formatNullable(report.portfolioConstruction.finalPositionRatio)}`,
    `target_exposure_ratio: ${formatNullable(report.portfolioConstruction.targetExposureRatio)}`,
    `average_target_exposure_gap_ratio: ${formatNullable(report.portfolioConstruction.averageTargetExposureGapRatio)}`,
    `final_target_exposure_gap_ratio: ${formatNullable(report.portfolioConstruction.finalTargetExposureGapRatio)}`,
    `cash_allocation_ratio: ${formatNullable(report.analytics.cashAllocationRatio)}`,
    `position_allocation_ratio: ${formatNullable(report.analytics.positionAllocationRatio)}`,
    `exposure_by_market: ${JSON.stringify(report.analytics.exposureByMarket)}`,
    `exposure_by_asset_type: ${JSON.stringify(report.analytics.exposureByAssetType)}`,
    `decision_trade_linkage: ${JSON.stringify(report.analytics.decisionTradeLinkage)}`,
    "",
    "## Decision Outcome",
    `by_action: ${JSON.stringify(report.decisionOutcome.byAction)}`,
    `average_confidence: ${formatNullable(report.decisionOutcome.averageConfidence)}`,
    `symbols: ${report.decisionOutcome.symbols.join(", ") || "none"}`,
    "",
    "## Virtual Trades",
    `trade_count: ${report.tradeSummary.tradeCount}`,
    `virtual_buy_amount_krw: ${report.tradeSummary.virtualBuyAmountKrw}`,
    `virtual_sell_amount_krw: ${report.tradeSummary.virtualSellAmountKrw}`,
    `symbols: ${report.tradeSummary.symbols.join(", ") || "none"}`,
    "",
    "## Virtual Risk",
    `approved_count: ${report.riskSummary.approvedCount}`,
    `rejected_count: ${report.riskSummary.rejectedCount}`,
    `meaningful_reject_count: ${report.riskSummary.meaningfulRejectCount}`,
    `dust_reject_count: ${report.riskSummary.dustRejectCount}`,
    `reject_codes: ${JSON.stringify(report.riskSummary.rejectCodes)}`,
    "",
    "## Sampling",
    `policy: ${JSON.stringify(report.samplingSummary.policy)}`,
    `decisions_requested: ${report.samplingSummary.decisionsRequested}`,
    `decisions_skipped: ${report.samplingSummary.decisionsSkipped}`,
    `skip_reasons: ${JSON.stringify(report.samplingSummary.skipReasons)}`,
    "",
    "## Reproducibility",
    `status: ${report.reproducibility.status}`,
    `manifest_path: ${report.reproducibility.manifestPath ?? "null"}`,
    `config_hash: ${report.reproducibility.configHash ?? "null"}`,
    `data_snapshot_hash: ${report.reproducibility.dataSnapshotHash ?? "null"}`,
    `universe_hash: ${report.reproducibility.universeHash ?? "null"}`,
    `coverage_hash: ${report.reproducibility.coverageHash ?? "null"}`,
    `prompt_hash: ${report.reproducibility.promptHash ?? "null"}`,
    `schema_hash: ${report.reproducibility.schemaHash ?? "null"}`,
    `risk_policy_hash: ${report.reproducibility.riskPolicyHash ?? "null"}`,
    `cost_model_hash: ${report.reproducibility.costModelHash ?? "null"}`,
    `execution_model_version: ${report.reproducibility.executionModelVersion ?? "null"}`,
    `warnings: ${report.reproducibility.warnings.join(" | ") || "none"}`,
    "",
    "## Benchmarks",
    `strategy: ${formatMetricSummary(report.benchmarks.strategy)}`,
    `cash_only: ${formatMetricSummary(report.benchmarks.cashOnly)}`,
    `equal_weight_buy_and_hold: ${
      report.benchmarks.equalWeightBuyAndHold
        ? formatMetricSummary(report.benchmarks.equalWeightBuyAndHold)
        : "null"
    }`,
    `initial_portfolio_buy_and_hold: ${formatMetricSummary(report.benchmarks.initialPortfolioBuyAndHold)}`,
    `benchmark_comparisons: ${JSON.stringify(report.benchmarks.comparisons)}`,
    `benchmark_notes: ${report.benchmarks.notes.join(" | ")}`,
    "",
    "## Source and Lookahead Warnings",
    `lookahead_guard_status: ${report.sourceWarningSummary.lookaheadGuardStatus}`,
    `warning_count: ${report.sourceWarningSummary.warningCount}`,
    `future_snapshot_warning_count: ${report.sourceWarningSummary.futureSnapshotWarningCount}`,
    `stale_snapshot_warning_count: ${report.sourceWarningSummary.staleSnapshotWarningCount}`,
    `recent_warnings: ${report.sourceWarningSummary.recentWarnings.join(" | ") || "none"}`,
    "",
    "## Virtual Portfolio Timeline",
    ...report.portfolioTimeline
      .slice(-10)
      .map(
        (item) =>
          `${item.simulatedAt} cash=${item.cashKrw} positions=${item.positionCount} net=${item.virtualNetWorthKrw}`
      ),
    "",
    report.disclaimer
  ];

  return maskSensitiveText(lines.join("\n"));
}

function summarizeRange(
  result: HistoricalReplayResult
): HistoricalReplayRangeSummary {
  const first = result.portfolioTimeline[0];
  const last = result.portfolioTimeline.at(-1);

  return {
    startAt: first?.simulatedAt ?? null,
    endAt: last?.simulatedAt ?? null,
    tickCount: result.tickCount
  };
}

function summarizePortfolio(
  initialPortfolio: VirtualPortfolio,
  finalPortfolio: VirtualPortfolio
): HistoricalReplayPortfolioSummary {
  const finalPositionMarketValueKrw = sumPositionMarketValue(finalPortfolio);

  return {
    initialCashKrw: initialPortfolio.cashKrw,
    finalCashKrw: finalPortfolio.cashKrw,
    finalPositionCount: finalPortfolio.positions.length,
    finalPositionMarketValueKrw,
    finalVirtualNetWorthKrw: finalPortfolio.cashKrw + finalPositionMarketValueKrw
  };
}

function summarizeDecisions(
  decisions: VirtualDecision[]
): HistoricalReplayDecisionOutcomeSummary {
  const items = decisions.flatMap((decision) => decision.decisions);
  const byAction: Record<string, number> = {};
  for (const item of items) {
    byAction[item.action] = (byAction[item.action] ?? 0) + 1;
  }

  return {
    byAction,
    averageConfidence:
      items.length > 0
        ? Number(
            (
              items.reduce((sum, item) => sum + item.confidence, 0) / items.length
            ).toFixed(4)
          )
        : null,
    symbols: Array.from(new Set(items.map((item) => item.symbol))).sort()
  };
}

function summarizeTrades(trades: VirtualTrade[]): HistoricalReplayTradeSummary {
  return {
    tradeCount: trades.length,
    virtualBuyAmountKrw: trades
      .filter((trade) => trade.action === "VIRTUAL_BUY")
      .reduce((sum, trade) => sum + trade.amountKrw, 0),
    virtualSellAmountKrw: trades
      .filter((trade) => trade.action === "VIRTUAL_SELL")
      .reduce((sum, trade) => sum + trade.amountKrw, 0),
    symbols: Array.from(new Set(trades.map((trade) => trade.symbol))).sort()
  };
}

function summarizeRisk(
  result: HistoricalReplayResult
): HistoricalReplayRiskSummary {
  const rejectCodes: Record<string, number> = {};
  for (const decision of result.riskDecisions) {
    for (const code of decision.rejectCodes) {
      rejectCodes[code] = (rejectCodes[code] ?? 0) + 1;
    }
  }

  return {
    approvedCount: result.riskDecisions.filter((decision) => decision.approved)
      .length,
    rejectedCount: result.rejectedCount,
    meaningfulRejectCount: result.rejectedCount,
    dustRejectCount: result.auditEvents.filter(
      (event) => event.eventType === "NO_OP_EXIT_DUST_CLOSED"
    ).length,
    rejectCodes
  };
}

export function buildPortfolioConstructionMetrics(
  timeline: HistoricalPortfolioTimelineItem[],
  allocationPolicy: HistoricalReplayResult["allocationPolicy"] = null
): HistoricalReplayPortfolioConstructionMetrics {
  if (timeline.length === 0) {
    return {
      avgExposureRatio: null,
      avgCashRatio: null,
      maxExposureRatio: null,
      minExposureRatio: null,
      timeInMarketRatio: null,
      finalCashRatio: null,
      finalPositionRatio: null,
      targetExposureRatio: allocationPolicy?.targetExposureRatio ?? null,
      averageTargetExposureGapRatio: null,
      finalTargetExposureGapRatio: null
    };
  }

  const exposureRatios = timeline.map(exposureRatio);
  const cashRatios = timeline.map(cashRatio);
  const targetExposureRatio = allocationPolicy?.targetExposureRatio ?? null;
  const targetExposureGapRatios =
    targetExposureRatio === null
      ? []
      : exposureRatios.map((ratio) =>
          Math.max(0, targetExposureRatio - ratio)
        );
  const final = timeline[timeline.length - 1]!;

  return {
    avgExposureRatio: roundRatio(average(exposureRatios)),
    avgCashRatio: roundRatio(average(cashRatios)),
    maxExposureRatio: roundRatio(Math.max(...exposureRatios)),
    minExposureRatio: roundRatio(Math.min(...exposureRatios)),
    timeInMarketRatio: roundRatio(
      exposureRatios.filter((ratio) => ratio > 0.05).length / timeline.length
    ),
    finalCashRatio: roundRatio(cashRatio(final)),
    finalPositionRatio: roundRatio(exposureRatio(final)),
    targetExposureRatio,
    averageTargetExposureGapRatio:
      targetExposureGapRatios.length === 0
        ? null
        : roundRatio(average(targetExposureGapRatios)),
    finalTargetExposureGapRatio:
      targetExposureRatio === null
        ? null
        : roundRatio(Math.max(0, targetExposureRatio - exposureRatio(final)))
  };
}

function exposureRatio(item: HistoricalPortfolioTimelineItem): number {
  if (!Number.isFinite(item.virtualNetWorthKrw) || item.virtualNetWorthKrw <= 0) {
    return 0;
  }
  return boundedRatio(item.positionMarketValueKrw / item.virtualNetWorthKrw);
}

function cashRatio(item: HistoricalPortfolioTimelineItem): number {
  if (!Number.isFinite(item.virtualNetWorthKrw) || item.virtualNetWorthKrw <= 0) {
    return 0;
  }
  return boundedRatio(item.cashKrw / item.virtualNetWorthKrw);
}

function boundedRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function summarizeSampling(
  result: HistoricalReplayResult
): HistoricalReplaySamplingSummary {
  const skipReasons: Record<string, number> = {};
  for (const decision of result.samplingDecisions) {
    if (!decision.shouldEvaluate) {
      skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;
    }
  }

  return {
    policy: result.samplingPolicy,
    decisionsRequested: result.decisionProviderCallCount,
    decisionsSkipped: result.decisionSkippedCount,
    skipReasons
  };
}

function summarizeWarnings(
  warnings: string[]
): HistoricalReplaySourceWarningSummary {
  const futureSnapshotWarningCount = warnings.filter((warning) =>
    warning.toLowerCase().includes("future snapshot")
  ).length;
  const staleSnapshotWarningCount = warnings.filter((warning) =>
    warning.toLowerCase().includes("stale")
  ).length;

  return {
    warningCount: warnings.length,
    futureSnapshotWarningCount,
    staleSnapshotWarningCount,
    recentWarnings: warnings.slice(-10),
    lookaheadGuardStatus:
      futureSnapshotWarningCount > 0
        ? "future_snapshots_excluded"
        : "no_future_snapshot_warnings"
  };
}

function sumPositionMarketValue(portfolio: VirtualPortfolio): number {
  return portfolio.positions.reduce(
    (sum, position) =>
      sum +
      (position.marketValueKrw ??
        Math.round(position.quantity * position.averagePriceKrw)),
    0
  );
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatNullable(value: number | null): string {
  return value === null ? "null" : String(value);
}

function formatMetricSummary(
  value: HistoricalReplayBenchmarkReport["strategy"]
): string {
  return JSON.stringify(value);
}

function historicalReplayDisclaimer(): string {
  return "Paper-only historical replay simulation. This is not financial advice, not a performance guarantee, and cannot place live orders.";
}
