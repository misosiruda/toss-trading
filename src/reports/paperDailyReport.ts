import type { AuditEvent, VirtualDecision, VirtualPortfolio, VirtualTrade } from "../domain/schemas.js";
import {
  buildPaperPortfolioAnalytics,
  type PaperPortfolioAnalytics
} from "../analytics/paperPortfolioAnalytics.js";
import { maskSensitiveText } from "../security/masking.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";

export interface PaperDailyReportOptions {
  storageBaseDir: string;
  date: string;
  generatedAt: Date;
}

export interface PaperDailyReport {
  title: string;
  date: string;
  mode: "paper_only";
  generatedAt: string;
  portfolio: PaperPortfolioSummary;
  analytics: PaperPortfolioAnalytics;
  decisionOutcome: PaperDecisionOutcomeSummary;
  tradeSummary: PaperTradeSummary;
  riskSummary: PaperRiskSummary;
  sourceStatus: PaperSourceStatusSummary;
  disclaimer: string;
}

export interface PaperPortfolioSummary {
  portfolioPresent: boolean;
  cashKrw: number | null;
  positionCount: number;
  positionMarketValueKrw: number;
  virtualNetWorthKrw: number | null;
}

export interface PaperDecisionOutcomeSummary {
  decisionRecordCount: number;
  decisionItemCount: number;
  byAction: Record<string, number>;
  averageConfidence: number | null;
}

export interface PaperTradeSummary {
  tradeCount: number;
  virtualBuyAmountKrw: number;
  virtualSellAmountKrw: number;
  symbols: string[];
  corruptLineCount: number;
}

export interface PaperRiskSummary {
  approvedCount: number;
  rejectedCount: number;
  recentRejectedSummaries: string[];
}

export interface PaperSourceStatusSummary {
  status: "ok" | "degraded" | "unknown";
  packetCreatedCount: number;
  warningCount: number;
  warnings: string[];
}

export async function buildPaperDailyReport(
  options: PaperDailyReportOptions
): Promise<PaperDailyReport> {
  const paths = createStoragePaths(options.storageBaseDir);
  const [portfolio, decisions, trades, audit] = await Promise.all([
    new FileVirtualPortfolioStore(paths.virtualPortfolioPath).read(),
    new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll(),
    new FileVirtualTradeStore(paths.virtualTradesPath).readAll(),
    new FileAuditLog(paths.auditLogPath).readAll()
  ]);
  const dailyTrades = trades.records.filter((trade) =>
    isSameReportDate(trade.executedAt, options.date)
  );
  const dailyAudit = audit.records.filter((event) =>
    isSameReportDate(event.createdAt, options.date)
  );

  return {
    title: "Paper Trading Daily Report",
    date: options.date,
    mode: "paper_only",
    generatedAt: options.generatedAt.toISOString(),
    portfolio: summarizePortfolio(portfolio),
    analytics: buildPaperPortfolioAnalytics({
      portfolio,
      decisions: decisions.records,
      trades: dailyTrades
    }),
    decisionOutcome: summarizeDecisions(decisions.records),
    tradeSummary: summarizeTrades(dailyTrades, trades.corruptLineCount),
    riskSummary: summarizeRisk(dailyAudit),
    sourceStatus: summarizeSources(dailyAudit),
    disclaimer: paperReportDisclaimer()
  };
}

export function renderPaperDailyReport(report: PaperDailyReport): string {
  const lines = [
    `# ${report.title}`,
    "",
    `date: ${report.date}`,
    `mode: ${report.mode}`,
    `generated_at: ${report.generatedAt}`,
    "",
    "## Portfolio",
    `portfolio_present: ${report.portfolio.portfolioPresent}`,
    `cash_krw: ${formatNullable(report.portfolio.cashKrw)}`,
    `position_count: ${report.portfolio.positionCount}`,
    `position_market_value_krw: ${report.portfolio.positionMarketValueKrw}`,
    `virtual_net_worth_krw: ${formatNullable(report.portfolio.virtualNetWorthKrw)}`,
    "",
    "## Portfolio Analytics",
    `cash_allocation_ratio: ${formatNullable(report.analytics.cashAllocationRatio)}`,
    `position_allocation_ratio: ${formatNullable(report.analytics.positionAllocationRatio)}`,
    `exposure_by_market: ${JSON.stringify(report.analytics.exposureByMarket)}`,
    `exposure_by_asset_type: ${JSON.stringify(report.analytics.exposureByAssetType)}`,
    `exposure_by_asset_class: ${JSON.stringify(report.analytics.exposureByAssetClass)}`,
    `exposure_by_strategy_bucket: ${JSON.stringify(report.analytics.exposureByStrategyBucket)}`,
    `unknown_metadata_exposure_krw: ${report.analytics.unknownMetadataExposureKrw}`,
    `unknown_metadata_exposure_ratio: ${report.analytics.unknownMetadataExposureRatio}`,
    `symbol_allocations: ${report.analytics.symbolAllocations
      .map((allocation) => `${allocation.market}:${allocation.symbol}:${allocation.allocationRatio ?? "null"}`)
      .join(", ") || "none"}`,
    `unrealized_pnl_krw: ${formatNullable(report.analytics.virtualPnl.unrealizedPnlKrw)}`,
    `realized_pnl_krw: ${formatNullable(report.analytics.virtualPnl.realizedPnlKrw)}`,
    `decision_trade_linkage: ${JSON.stringify(report.analytics.decisionTradeLinkage)}`,
    "",
    "## Decision Outcome",
    `decision_records: ${report.decisionOutcome.decisionRecordCount}`,
    `decision_items: ${report.decisionOutcome.decisionItemCount}`,
    `by_action: ${JSON.stringify(report.decisionOutcome.byAction)}`,
    `average_confidence: ${formatNullable(report.decisionOutcome.averageConfidence)}`,
    "",
    "## Virtual Trades",
    `trade_count: ${report.tradeSummary.tradeCount}`,
    `virtual_buy_amount_krw: ${report.tradeSummary.virtualBuyAmountKrw}`,
    `virtual_sell_amount_krw: ${report.tradeSummary.virtualSellAmountKrw}`,
    `symbols: ${report.tradeSummary.symbols.join(", ") || "none"}`,
    `corrupt_trade_line_count: ${report.tradeSummary.corruptLineCount}`,
    "",
    "## Virtual Risk",
    `approved_count: ${report.riskSummary.approvedCount}`,
    `rejected_count: ${report.riskSummary.rejectedCount}`,
    `recent_rejected: ${report.riskSummary.recentRejectedSummaries.join(" | ") || "none"}`,
    "",
    "## Source Status",
    `status: ${report.sourceStatus.status}`,
    `packet_created_count: ${report.sourceStatus.packetCreatedCount}`,
    `warning_count: ${report.sourceStatus.warningCount}`,
    `warnings: ${report.sourceStatus.warnings.join(" | ") || "none"}`,
    "",
    report.disclaimer
  ];

  return maskSensitiveText(lines.join("\n"));
}

function summarizePortfolio(
  portfolio: VirtualPortfolio | null
): PaperPortfolioSummary {
  const positionMarketValueKrw =
    portfolio?.positions.reduce(
      (sum, position) =>
        sum +
        (position.marketValueKrw ??
          Math.round(position.quantity * position.averagePriceKrw)),
      0
    ) ?? 0;

  return {
    portfolioPresent: portfolio !== null,
    cashKrw: portfolio?.cashKrw ?? null,
    positionCount: portfolio?.positions.length ?? 0,
    positionMarketValueKrw,
    virtualNetWorthKrw: portfolio ? portfolio.cashKrw + positionMarketValueKrw : null
  };
}

function summarizeDecisions(
  decisions: VirtualDecision[]
): PaperDecisionOutcomeSummary {
  const items = decisions.flatMap((decision) => decision.decisions);
  const byAction: Record<string, number> = {};
  for (const item of items) {
    byAction[item.action] = (byAction[item.action] ?? 0) + 1;
  }

  return {
    decisionRecordCount: decisions.length,
    decisionItemCount: items.length,
    byAction,
    averageConfidence:
      items.length > 0
        ? Number(
            (
              items.reduce((sum, item) => sum + item.confidence, 0) / items.length
            ).toFixed(4)
          )
        : null
  };
}

function summarizeTrades(
  trades: VirtualTrade[],
  corruptLineCount: number
): PaperTradeSummary {
  return {
    tradeCount: trades.length,
    virtualBuyAmountKrw: trades
      .filter((trade) => trade.action === "VIRTUAL_BUY")
      .reduce((sum, trade) => sum + trade.amountKrw, 0),
    virtualSellAmountKrw: trades
      .filter((trade) => trade.action === "VIRTUAL_SELL")
      .reduce((sum, trade) => sum + trade.amountKrw, 0),
    symbols: Array.from(new Set(trades.map((trade) => trade.symbol))).sort(),
    corruptLineCount
  };
}

function summarizeRisk(audit: AuditEvent[]): PaperRiskSummary {
  const rejected = audit.filter((event) => event.eventType === "VIRTUAL_RISK_REJECTED");
  return {
    approvedCount: audit.filter((event) => event.eventType === "VIRTUAL_RISK_APPROVED")
      .length,
    rejectedCount: rejected.length,
    recentRejectedSummaries: rejected.slice(-5).map((event) => event.summary)
  };
}

function summarizeSources(audit: AuditEvent[]): PaperSourceStatusSummary {
  const packetCreated = audit.filter(
    (event) => event.eventType === "MARKET_PACKET_CREATED"
  );
  const warnings = audit.filter((event) => event.eventType === "MARKET_PACKET_WARNING");
  return {
    status:
      warnings.length > 0 ? "degraded" : packetCreated.length > 0 ? "ok" : "unknown",
    packetCreatedCount: packetCreated.length,
    warningCount: warnings.length,
    warnings: warnings.slice(-5).map((event) => event.summary)
  };
}

function isSameReportDate(isoDateTime: string, reportDate: string): boolean {
  return isoDateTime.slice(0, 10) === reportDate;
}

function formatNullable(value: number | null): string {
  return value === null ? "null" : String(value);
}

function paperReportDisclaimer(): string {
  return "Paper-only virtual simulation. This is not financial advice, not a performance guarantee, and cannot place live orders.";
}
