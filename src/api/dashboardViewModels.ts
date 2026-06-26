import { readFile } from "node:fs/promises";

import type { BatchReplayAggregateReport } from "../reports/batchReplayReport.js";
import { buildReplayResearchReport } from "../reports/replayResearchReport.js";
import {
  createStoragePaths,
  FileAuditLog,
  FileVirtualDecisionStore,
  FileVirtualPortfolioStore,
  FileVirtualTradeStore
} from "../storage/repositories.js";
import type {
  AuditEvent,
  Market,
  StrategyBucket,
  VirtualAction,
  VirtualDecision,
  VirtualDecisionItem,
  VirtualPortfolio,
  VirtualPosition,
  VirtualTrade
} from "../domain/schemas.js";

const STRATEGY_BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const satisfies readonly StrategyBucket[];

type DashboardViewModelStatus = "ok" | "watch" | "breach" | "missing";
type JsonFileStatus = "missing" | "ok" | "corrupt";
type JsonlReadStatus = "missing" | "ok" | "degraded";
type RiskGateTraceArtifactFamily = "historical_replay" | "virtual";
type MarketRegimeView =
  | "bull"
  | "bear"
  | "sideways"
  | "mixed"
  | "insufficient_data";
type HoldingPeriodHint =
  | "multi_month"
  | "multi_week"
  | "multi_day"
  | "intraday"
  | "hedge";

interface JsonFileRead {
  status: JsonFileStatus;
  value: unknown | null;
}

interface JsonlRead {
  status: JsonlReadStatus;
  records: Record<string, unknown>[];
  corruptLineCount: number;
}

interface BucketComplianceRow {
  bucket: StrategyBucket;
  targetWeightRatio: number;
  currentWeightRatio: number;
  gapRatio: number;
  exposureKrw: number;
  turnoverRatio: number | null;
  status: "ok" | "under" | "over" | "missing";
  primaryReason: string | null;
}

interface CashComplianceView {
  marketRegime: MarketRegimeView;
  targetCashRatio: number;
  currentCashRatio: number;
  currentCashKrw: number;
  minimumCashReserveKrw: number;
  cashGapKrw: number;
  ruleSource: "static" | "dynamic_regime" | "high_volatility" | "fallback";
  status: "ok" | "under_reserved" | "missing";
  rejectedCount: number;
  rejectCodes: Record<string, number>;
}

interface HedgeComplianceView {
  hedgeEnabled: boolean;
  hedgeExposureKrw: number;
  hedgeExposureRatio: number;
  grossExposureKrw: number;
  netDownsideExposureKrw: number;
  estimatedDownsideReductionKrw: number | null;
  hedgeCostKrw: number;
  hedgeTradeCount: number;
  rejectedCount: number;
  rejectCodes: Record<string, number>;
  status: "ok" | "ineffective" | "over_hedged" | "missing";
}

interface ExposureBucket {
  key: string;
  exposureKrw: number;
  exposureRatio: number;
}

interface ExposureComplianceView {
  grossExposureKrw: number;
  grossExposureRatio: number;
  byMarket: ExposureBucket[];
  byStrategyBucket: ExposureBucket[];
  maxSymbolExposure: ExposureBucket | null;
  status: DashboardViewModelStatus;
}

interface RiskGateSummaryView {
  decisionRecordCount: number;
  decisionItemCount: number;
  actionableDecisionCount: number;
  simulatedTradeCount: number;
  rejectedCount: number;
  rejectCodes: Record<string, number>;
}

interface BucketCostTurnoverRow {
  bucket: StrategyBucket;
  tradeCount: number;
  grossTradeAmountKrw: number;
  totalCostKrw: number;
  turnoverRatio: number | null;
  costDragRatio: number | null;
}

interface ComplianceAnalyticsView {
  strategyBucket: {
    occupiedBucketCount: number;
    missingPolicyTargetCount: number;
    largestBucket: ExposureBucket | null;
    concentrationRatio: number | null;
    status: DashboardViewModelStatus;
  };
  cashReserve: {
    currentCashKrw: number;
    currentCashRatio: number;
    targetCashRatio: number;
    minimumCashReserveKrw: number;
    cashGapKrw: number;
    reserveStatus: CashComplianceView["status"];
    marketRegime: MarketRegimeView;
    ruleSource: CashComplianceView["ruleSource"];
  };
  hedgeEffectiveness: {
    hedgeCoverageRatio: number | null;
    netDownsideExposureRatio: number | null;
    costDragRatio: number | null;
    status: HedgeComplianceView["status"];
  };
  costTurnover: {
    totalTradeAmountKrw: number;
    totalCostKrw: number;
    totalTurnoverRatio: number | null;
    totalCostDragRatio: number | null;
    byStrategyBucket: BucketCostTurnoverRow[];
  };
}

export interface PolicyComplianceViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "portfolio-compliance";
  asOf: string | null;
  portfolioId: string | null;
  virtualNetWorthKrw: number;
  policyStatus: "missing";
  bucketCompliance: BucketComplianceRow[];
  cashCompliance: CashComplianceView;
  hedgeCompliance: HedgeComplianceView;
  exposureCompliance: ExposureComplianceView;
  riskGateSummary: RiskGateSummaryView;
  complianceAnalytics: ComplianceAnalyticsView;
  sourceStatus: {
    portfolio: "ok" | "missing";
    decisions: JsonlReadStatus;
    trades: JsonlReadStatus;
    auditEvents: JsonlReadStatus;
    batchAggregate: JsonFileStatus;
  };
  warnings: string[];
  status: DashboardViewModelStatus;
}

interface StrategyBucketTestCapability {
  bucket: StrategyBucket;
  canRunIsolatedReplay: boolean;
  requiredPolicyFields: string[];
  defaultHoldingPeriodHint: HoldingPeriodHint;
  disabledReason: string | null;
}

interface StrategyBucketTestResultSummary {
  testId: string;
  bucket: StrategyBucket;
  validationSplitRole: "train" | "validation" | "test" | null;
  totalReturnRatio: number | null;
  maxDrawdownRatio: number | null;
  turnoverRatio: number | null;
  costDragRatio: number | null;
  riskRejectRate: number | null;
  providerFailureRate: number | null;
  warnings: string[];
}

type StrategyBucketTestPhase =
  | "queued"
  | "loading_data"
  | "building_packets"
  | "calling_provider"
  | "risk_gate"
  | "simulating_execution"
  | "writing_artifacts"
  | "aggregating_report"
  | "completed"
  | "failed"
  | "cancelled";

type StrategyBucketTestStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface StrategyBucketTestProgressView {
  phase: StrategyBucketTestPhase;
  progressRatio: number | null;
  completedPacketCount: number;
  totalPacketCount: number | null;
  decisionCount: number;
  riskApprovedCount: number;
  riskRejectedCount: number;
  simulatedTradeCount: number;
  providerFailureCount: number;
  latestMessage: string | null;
  latestAuditEventRef: string | null;
  updatedAt: string;
}

interface StrategyBucketTestHeartbeatView {
  status: "fresh" | "stale" | "missing";
  lastSeenAt: string | null;
  staleAfterSeconds: number;
}

interface StrategyBucketTestSummary {
  testId: string;
  bucket: StrategyBucket;
  status: StrategyBucketTestStatus;
  startedAt: string | null;
  completedAt: string | null;
  runId: string | null;
  configHash: string;
  progress: StrategyBucketTestProgressView;
  heartbeat: StrategyBucketTestHeartbeatView;
}

interface StrategyBucketComparisonView {
  rows: StrategyBucketTestResultSummary[];
  baselineBucket: StrategyBucket | null;
  selectionWarning: string | null;
}

export interface StrategyBucketTestLabViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "strategy-test-lab";
  policyId: string;
  policyStatus: "missing";
  supportedBuckets: StrategyBucketTestCapability[];
  activeTests: StrategyBucketTestSummary[];
  recentResults: StrategyBucketTestResultSummary[];
  comparison: StrategyBucketComparisonView;
  sourceStatus: {
    batchAggregate: JsonFileStatus;
    strategyBucketTestRecords: JsonlReadStatus;
  };
  status: "ok";
}

export interface StrategyBucketTestProgressViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "strategy-test-progress";
  testId: string;
  test: StrategyBucketTestSummary | null;
  sourceStatus: {
    strategyBucketTestRecords: JsonlReadStatus;
  };
  storageMutationEnabled: false;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  status: "ok" | "missing" | "invalid";
}

interface RiskDecisionSnapshot {
  riskDecisionId: string | null;
  packetId: string;
  symbol: string | null;
  approved: boolean;
  rejectCodes: string[];
}

interface RiskGateTraceRow {
  packetId: string;
  decisionId: string;
  market: Market;
  symbol: string;
  action: VirtualAction;
  strategyBucket: StrategyBucket | "unknown";
  aiThesis: string | null;
  evidenceRefs: string[];
  normalizedBudgetKrw: number | null;
  riskApproved: boolean;
  rejectCodes: string[];
  simulatedExecutionStatus: "filled" | "partial" | "rejected" | "none";
  auditEventRefs: string[];
}

export interface RiskGateTraceViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "risk-gate-trace";
  sourceFamily: RiskGateTraceArtifactFamily;
  traces: RiskGateTraceRow[];
  count: number;
  totalDecisionItemCount: number;
  sourceStatus: {
    decisions: JsonlReadStatus;
    trades: JsonlReadStatus;
    riskDecisions: JsonlReadStatus;
    auditEvents: JsonlReadStatus;
  };
}

export interface ValidationLabViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "validation-lab";
  status: "missing" | "ok" | "corrupt" | "invalid";
  aggregateReportStatus: "missing" | "ok" | "corrupt" | "invalid";
  sourceGeneratedAt: string | null;
  runIdentity: unknown | null;
  reproducibilityHashes: unknown | null;
  validationProtocol: unknown | null;
  dataUniverseCoverage: unknown | null;
  promptTrialDistribution: unknown | null;
  overfittingWarning: unknown | null;
  providerFailureSummary: unknown | null;
  riskRejectSummary: unknown | null;
  exposureBreakdown: unknown | null;
  warnings: string[];
  executionAssumptions: {
    paperOnly: true;
    liveTradingEnabled: false;
    orderPlacementEnabled: false;
  };
}

export async function readDashboardPortfolioComplianceViewModel(
  storageBaseDir: string
): Promise<PolicyComplianceViewModel> {
  const paths = createStoragePaths(storageBaseDir);
  const [portfolio, decisions, trades, auditEvents, aggregate] =
    await Promise.all([
      new FileVirtualPortfolioStore(paths.virtualPortfolioPath).read(),
      new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll(),
      new FileVirtualTradeStore(paths.virtualTradesPath).readAll(),
      new FileAuditLog(paths.auditLogPath).readAll(),
      readJsonFile(paths.batchReplayAggregateReportPath)
    ]);
  const exposure = portfolioExposure(portfolio);
  const decisionItems = flattenDecisionItems(decisions.records);
  const riskRejectCodes = rejectCodeCounts(decisionItems, auditEvents.records);
  const rejectedCount = countCurrentRejected(decisionItems, auditEvents.records);
  const marketRegime = inferMarketRegime(aggregate.value);
  const bucketCompliance = bucketComplianceRows(exposure, trades.records);
  const cashCompliance = cashComplianceView({
    portfolio,
    virtualNetWorthKrw: exposure.virtualNetWorthKrw,
    marketRegime,
    rejectedCount,
    rejectCodes: riskRejectCodes
  });
  const hedgeCompliance = hedgeComplianceView({
    exposure,
    trades: trades.records,
    rejectedCount,
    rejectCodes: riskRejectCodes
  });
  const warnings = [
    "portfolio policy artifact is not available; target weights are reported as missing",
    "strategy bucket isolated replay artifacts are not available in this ViewModel"
  ];

  return {
    mode: "paper_only",
    readOnly: true,
    viewModel: "portfolio-compliance",
    asOf: portfolio?.updatedAt ?? null,
    portfolioId: portfolio?.portfolioId ?? null,
    virtualNetWorthKrw: exposure.virtualNetWorthKrw,
    policyStatus: "missing",
    bucketCompliance,
    cashCompliance,
    hedgeCompliance,
    exposureCompliance: exposureComplianceView(exposure, portfolio !== null),
    riskGateSummary: {
      decisionRecordCount: decisions.records.length,
      decisionItemCount: decisionItems.length,
      actionableDecisionCount: decisionItems.filter(
        ({ item }) => item.action !== "VIRTUAL_HOLD"
      ).length,
      simulatedTradeCount: trades.records.length,
      rejectedCount,
      rejectCodes: riskRejectCodes
    },
    complianceAnalytics: complianceAnalyticsView({
      exposure,
      bucketCompliance,
      cashCompliance,
      hedgeCompliance,
      trades: trades.records,
      hasPortfolio: portfolio !== null
    }),
    sourceStatus: {
      portfolio: portfolio === null ? "missing" : "ok",
      decisions: jsonlStatus(decisions.corruptLineCount),
      trades: jsonlStatus(trades.corruptLineCount),
      auditEvents: jsonlStatus(auditEvents.corruptLineCount),
      batchAggregate: aggregate.status
    },
    warnings,
    status: portfolio === null ? "missing" : "watch"
  };
}

export async function readDashboardStrategyTestLabViewModel(
  storageBaseDir: string,
  now: Date = new Date()
): Promise<StrategyBucketTestLabViewModel> {
  const paths = createStoragePaths(storageBaseDir);
  const [aggregate, strategyBucketTestRecords] = await Promise.all([
    readJsonFile(paths.batchReplayAggregateReportPath),
    readJsonlRecords(paths.strategyBucketTestRecordsPath)
  ]);
  const activeTests = latestActiveStrategyBucketTests(
    strategyBucketTestRecords.records,
    now,
    20
  );
  const recentResults: StrategyBucketTestResultSummary[] = [];

  return {
    mode: "paper_only",
    readOnly: true,
    viewModel: "strategy-test-lab",
    policyId: "paper_policy_unconfigured",
    policyStatus: "missing",
    supportedBuckets: STRATEGY_BUCKETS.map((bucket) => ({
      bucket,
      canRunIsolatedReplay: false,
      requiredPolicyFields: requiredPolicyFieldsFor(bucket),
      defaultHoldingPeriodHint: holdingPeriodHintFor(bucket),
      disabledReason:
        "paper-only queued record creation is available; replay runner is not connected yet"
    })),
    activeTests,
    recentResults,
    comparison: {
      rows: recentResults,
      baselineBucket: null,
      selectionWarning:
        aggregate.status === "ok"
          ? "portfolio-level batch aggregate is available, but isolated strategy bucket result artifacts are missing"
          : "batch replay aggregate is missing; strategy bucket comparison is unavailable"
    },
    sourceStatus: {
      batchAggregate: aggregate.status,
      strategyBucketTestRecords: strategyBucketTestRecords.status
    },
    status: "ok"
  };
}

export async function readDashboardStrategyBucketTestProgressViewModel(
  storageBaseDir: string,
  testId: string,
  now: Date = new Date()
): Promise<StrategyBucketTestProgressViewModel> {
  const normalizedTestId = testId.trim();
  const paths = createStoragePaths(storageBaseDir);
  const strategyBucketTestRecords = await readJsonlRecords(
    paths.strategyBucketTestRecordsPath
  );
  const test =
    normalizedTestId.length === 0
      ? null
      : latestStrategyBucketTestById(
          strategyBucketTestRecords.records,
          normalizedTestId,
          now
        );

  return {
    mode: "paper_only",
    readOnly: true,
    viewModel: "strategy-test-progress",
    testId: normalizedTestId,
    test,
    sourceStatus: {
      strategyBucketTestRecords: strategyBucketTestRecords.status
    },
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    replayRunnerStarted: false,
    status:
      normalizedTestId.length === 0 ? "invalid" : test === null ? "missing" : "ok"
  };
}

export async function readDashboardRiskGateTraceViewModel(
  storageBaseDir: string,
  limit: number
): Promise<RiskGateTraceViewModel> {
  const paths = createStoragePaths(storageBaseDir);
  const [
    virtualDecisions,
    virtualTrades,
    historicalDecisions,
    historicalTrades,
    historicalRiskDecisions,
    auditEvents
  ] = await Promise.all([
    new FileVirtualDecisionStore(paths.virtualDecisionsPath).readAll(),
    new FileVirtualTradeStore(paths.virtualTradesPath).readAll(),
    new FileVirtualDecisionStore(paths.historicalReplayDecisionLogPath).readAll(),
    new FileVirtualTradeStore(paths.historicalReplayTradeLogPath).readAll(),
    readJsonlRecords(paths.historicalReplayRiskDecisionLogPath),
    new FileAuditLog(paths.auditLogPath).readAll()
  ]);
  const useHistoricalFamily =
    historicalDecisions.records.length > 0 ||
    historicalTrades.records.length > 0 ||
    historicalRiskDecisions.status !== "missing";
  const sourceFamily: RiskGateTraceArtifactFamily = useHistoricalFamily
    ? "historical_replay"
    : "virtual";
  const decisions = useHistoricalFamily ? historicalDecisions : virtualDecisions;
  const trades = useHistoricalFamily ? historicalTrades : virtualTrades;
  const riskDecisionRead = useHistoricalFamily
    ? historicalRiskDecisions
    : emptyJsonlRead("missing");
  const riskDecisions = riskDecisionRead.records
    .map(parseRiskDecision)
    .filter((record): record is RiskDecisionSnapshot => record !== null);
  const rows = flattenDecisionItems(decisions.records).map(
    ({ record, item, itemIndex }) =>
      riskGateTraceRow({
        record,
        item,
        itemIndex,
        trades: trades.records,
        riskDecisions,
        auditEvents: auditEvents.records
      })
  );
  const traces = rows.slice(-limit).reverse();

  return {
    mode: "paper_only",
    readOnly: true,
    viewModel: "risk-gate-trace",
    sourceFamily,
    traces,
    count: traces.length,
    totalDecisionItemCount: rows.length,
    sourceStatus: {
      decisions: storeJsonlStatus(
        decisions.records.length,
        decisions.corruptLineCount
      ),
      trades: storeJsonlStatus(trades.records.length, trades.corruptLineCount),
      riskDecisions: riskDecisionRead.status,
      auditEvents: jsonlStatus(auditEvents.corruptLineCount)
    }
  };
}

export async function readDashboardValidationLabViewModel(
  storageBaseDir: string
): Promise<ValidationLabViewModel> {
  const aggregate = await readJsonFile(
    createStoragePaths(storageBaseDir).batchReplayAggregateReportPath
  );

  if (aggregate.status !== "ok") {
    return validationLabUnavailable(aggregate.status);
  }
  if (!isBatchReplayAggregateReportShape(aggregate.value)) {
    return validationLabUnavailable("invalid");
  }

  try {
    const report = buildReplayResearchReport({
      aggregateReport: aggregate.value,
      generatedAt: new Date()
    });

    return {
      mode: "paper_only",
      readOnly: true,
      viewModel: "validation-lab",
      status: "ok",
      aggregateReportStatus: "ok",
      sourceGeneratedAt: report.sourceGeneratedAt,
      runIdentity: report.runIdentity,
      reproducibilityHashes: report.reproducibilityHashes,
      validationProtocol: report.validationProtocol,
      dataUniverseCoverage: report.dataUniverseCoverage,
      promptTrialDistribution: report.promptTrialDistribution,
      overfittingWarning: report.overfittingWarning,
      providerFailureSummary: report.providerFailureSummary,
      riskRejectSummary: report.riskRejectSummary,
      exposureBreakdown: report.exposureBreakdown,
      warnings: report.warnings,
      executionAssumptions: {
        paperOnly: true,
        liveTradingEnabled: false,
        orderPlacementEnabled: false
      }
    };
  } catch {
    return validationLabUnavailable("invalid");
  }
}

function portfolioExposure(portfolio: VirtualPortfolio | null): {
  virtualNetWorthKrw: number;
  grossExposureKrw: number;
  cashRatio: number;
  byMarket: Map<string, number>;
  byBucket: Record<StrategyBucket, number>;
  bySymbol: Map<string, number>;
  hedgeExposureKrw: number;
} {
  const byMarket = new Map<string, number>();
  const byBucket = emptyBucketAmounts();
  const bySymbol = new Map<string, number>();
  let grossExposureKrw = 0;
  let hedgeExposureKrw = 0;

  for (const position of portfolio?.positions ?? []) {
    const value = positionMarketValue(position);
    grossExposureKrw += value;
    byMarket.set(position.market, (byMarket.get(position.market) ?? 0) + value);
    bySymbol.set(
      `${position.market}:${position.symbol}`,
      (bySymbol.get(`${position.market}:${position.symbol}`) ?? 0) + value
    );
    if (position.strategyBucket !== undefined) {
      byBucket[position.strategyBucket] += value;
    }
    if (isHedgePosition(position)) {
      hedgeExposureKrw += value;
    }
  }

  const virtualNetWorthKrw = (portfolio?.cashKrw ?? 0) + grossExposureKrw;
  return {
    virtualNetWorthKrw,
    grossExposureKrw,
    cashRatio: ratio(portfolio?.cashKrw ?? 0, virtualNetWorthKrw),
    byMarket,
    byBucket,
    bySymbol,
    hedgeExposureKrw
  };
}

function bucketComplianceRows(
  exposure: ReturnType<typeof portfolioExposure>,
  trades: VirtualTrade[]
): BucketComplianceRow[] {
  return STRATEGY_BUCKETS.map((bucket) => {
    const exposureKrw = exposure.byBucket[bucket];
    return {
      bucket,
      targetWeightRatio: 0,
      currentWeightRatio: ratio(exposureKrw, exposure.virtualNetWorthKrw),
      gapRatio: ratio(exposureKrw, exposure.virtualNetWorthKrw),
      exposureKrw,
      turnoverRatio: bucketTurnoverRatio(
        bucket,
        trades,
        exposure.virtualNetWorthKrw
      ),
      status: "missing",
      primaryReason: "portfolio policy artifact is not available"
    };
  });
}

function cashComplianceView(input: {
  portfolio: VirtualPortfolio | null;
  virtualNetWorthKrw: number;
  marketRegime: MarketRegimeView;
  rejectedCount: number;
  rejectCodes: Record<string, number>;
}): CashComplianceView {
  const currentCashKrw = input.portfolio?.cashKrw ?? 0;
  const rule = cashReserveRule(input.marketRegime);
  const minimumCashReserveKrw = Math.round(
    input.virtualNetWorthKrw * rule.targetCashRatio
  );
  const cashGapKrw = Math.max(0, minimumCashReserveKrw - currentCashKrw);
  return {
    marketRegime: input.marketRegime,
    targetCashRatio: rule.targetCashRatio,
    currentCashRatio: ratio(currentCashKrw, input.virtualNetWorthKrw),
    currentCashKrw,
    minimumCashReserveKrw,
    cashGapKrw,
    ruleSource: rule.ruleSource,
    status:
      input.portfolio === null
        ? "missing"
        : cashGapKrw > 0
          ? "under_reserved"
          : "ok",
    rejectedCount: input.rejectedCount,
    rejectCodes: input.rejectCodes
  };
}

function hedgeComplianceView(input: {
  exposure: ReturnType<typeof portfolioExposure>;
  trades: VirtualTrade[];
  rejectedCount: number;
  rejectCodes: Record<string, number>;
}): HedgeComplianceView {
  const hedgeTradeCount = input.trades.filter(
    (trade) => trade.strategyBucket === "hedge"
  ).length;
  const hedgeCostKrw = input.trades
    .filter((trade) => trade.strategyBucket === "hedge")
    .reduce((sum, trade) => sum + tradeCostKrw(trade), 0);
  const hedgeCoverageRatio =
    input.exposure.grossExposureKrw > 0
      ? ratio(input.exposure.hedgeExposureKrw, input.exposure.grossExposureKrw)
      : 0;

  return {
    hedgeEnabled: input.exposure.hedgeExposureKrw > 0 || hedgeTradeCount > 0,
    hedgeExposureKrw: input.exposure.hedgeExposureKrw,
    hedgeExposureRatio: ratio(
      input.exposure.hedgeExposureKrw,
      input.exposure.virtualNetWorthKrw
    ),
    grossExposureKrw: input.exposure.grossExposureKrw,
    netDownsideExposureKrw: Math.max(
      0,
      input.exposure.grossExposureKrw - input.exposure.hedgeExposureKrw
    ),
    estimatedDownsideReductionKrw:
      input.exposure.hedgeExposureKrw > 0
        ? Math.min(input.exposure.hedgeExposureKrw, input.exposure.grossExposureKrw)
        : null,
    hedgeCostKrw,
    hedgeTradeCount,
    rejectedCount: input.rejectedCount,
    rejectCodes: input.rejectCodes,
    status:
      input.exposure.grossExposureKrw <= 0
        ? "missing"
        : input.exposure.hedgeExposureKrw <= 0
          ? "ineffective"
          : hedgeCoverageRatio > 0.4
            ? "over_hedged"
            : "ok"
  };
}

function exposureComplianceView(
  exposure: ReturnType<typeof portfolioExposure>,
  hasPortfolio: boolean
): ExposureComplianceView {
  return {
    grossExposureKrw: exposure.grossExposureKrw,
    grossExposureRatio: ratio(
      exposure.grossExposureKrw,
      exposure.virtualNetWorthKrw
    ),
    byMarket: mapToExposureBuckets(
      exposure.byMarket,
      exposure.virtualNetWorthKrw
    ),
    byStrategyBucket: STRATEGY_BUCKETS.map((bucket) => ({
      key: bucket,
      exposureKrw: exposure.byBucket[bucket],
      exposureRatio: ratio(
        exposure.byBucket[bucket],
        exposure.virtualNetWorthKrw
      )
    })),
    maxSymbolExposure: maxExposureBucket(
      exposure.bySymbol,
      exposure.virtualNetWorthKrw
    ),
    status: hasPortfolio ? "ok" : "missing"
  };
}

function complianceAnalyticsView(input: {
  exposure: ReturnType<typeof portfolioExposure>;
  bucketCompliance: BucketComplianceRow[];
  cashCompliance: CashComplianceView;
  hedgeCompliance: HedgeComplianceView;
  trades: VirtualTrade[];
  hasPortfolio: boolean;
}): ComplianceAnalyticsView {
  const bucketExposures = STRATEGY_BUCKETS.map((bucket) => ({
    key: bucket,
    exposureKrw: input.exposure.byBucket[bucket],
    exposureRatio: ratio(
      input.exposure.byBucket[bucket],
      input.exposure.virtualNetWorthKrw
    )
  }));
  const occupiedBuckets = bucketExposures.filter(
    (bucket) => bucket.exposureKrw > 0
  );
  const largestBucket = maxExposureBucketFromBuckets(bucketExposures);
  const costTurnoverRows = bucketCostTurnoverRows(
    input.trades,
    input.exposure.virtualNetWorthKrw
  );
  const totalTradeAmountKrw = input.trades.reduce(
    (sum, trade) => sum + tradeAmountKrw(trade),
    0
  );
  const totalCostKrw = input.trades.reduce(
    (sum, trade) => sum + tradeCostKrw(trade),
    0
  );
  const hedgeCoverageRatio =
    input.exposure.grossExposureKrw > 0
      ? ratio(
          input.hedgeCompliance.hedgeExposureKrw,
          input.exposure.grossExposureKrw
        )
      : null;

  return {
    strategyBucket: {
      occupiedBucketCount: occupiedBuckets.length,
      missingPolicyTargetCount: input.bucketCompliance.filter(
        (row) => row.status === "missing"
      ).length,
      largestBucket,
      concentrationRatio:
        largestBucket === null
          ? null
          : ratio(largestBucket.exposureKrw, input.exposure.grossExposureKrw),
      status: !input.hasPortfolio
        ? "missing"
        : input.bucketCompliance.some((row) => row.status === "missing")
          ? "watch"
          : "ok"
    },
    cashReserve: {
      currentCashKrw: input.cashCompliance.currentCashKrw,
      currentCashRatio: input.cashCompliance.currentCashRatio,
      targetCashRatio: input.cashCompliance.targetCashRatio,
      minimumCashReserveKrw: input.cashCompliance.minimumCashReserveKrw,
      cashGapKrw: input.cashCompliance.cashGapKrw,
      reserveStatus: input.cashCompliance.status,
      marketRegime: input.cashCompliance.marketRegime,
      ruleSource: input.cashCompliance.ruleSource
    },
    hedgeEffectiveness: {
      hedgeCoverageRatio,
      netDownsideExposureRatio:
        input.exposure.grossExposureKrw > 0
          ? ratio(
              input.hedgeCompliance.netDownsideExposureKrw,
              input.exposure.grossExposureKrw
            )
          : null,
      costDragRatio:
        input.hedgeCompliance.hedgeExposureKrw > 0
          ? ratio(
              input.hedgeCompliance.hedgeCostKrw,
              input.hedgeCompliance.hedgeExposureKrw
            )
          : null,
      status: input.hedgeCompliance.status
    },
    costTurnover: {
      totalTradeAmountKrw,
      totalCostKrw,
      totalTurnoverRatio:
        input.exposure.virtualNetWorthKrw > 0
          ? ratio(totalTradeAmountKrw, input.exposure.virtualNetWorthKrw)
          : null,
      totalCostDragRatio:
        totalTradeAmountKrw > 0
          ? ratio(totalCostKrw, totalTradeAmountKrw)
          : null,
      byStrategyBucket: costTurnoverRows
    }
  };
}

function riskGateTraceRow(input: {
  record: VirtualDecision;
  item: VirtualDecisionItem;
  itemIndex: number;
  trades: VirtualTrade[];
  riskDecisions: RiskDecisionSnapshot[];
  auditEvents: AuditEvent[];
}): RiskGateTraceRow {
  const trade = input.trades.find(
    (candidate) =>
      candidate.packetId === input.record.packetId &&
      candidate.symbol === input.item.symbol &&
      candidate.action === input.item.action
  );
  const riskDecision = input.riskDecisions.find(
    (candidate) =>
      candidate.packetId === input.record.packetId &&
      (candidate.symbol === input.item.symbol || candidate.symbol === null)
  );
  const executionStatus = simulatedExecutionStatus(trade ?? null);
  const auditEventRefs = matchingAuditEventRefs(
    input.auditEvents,
    input.record.packetId,
    input.item.symbol
  );
  const riskApproved =
    riskDecision?.approved ??
    (input.item.action === "VIRTUAL_HOLD" ||
      executionStatus === "filled" ||
      executionStatus === "partial");

  return {
    packetId: input.record.packetId,
    decisionId: decisionItemId(input.record, input.item, input.itemIndex),
    market: input.item.market,
    symbol: input.item.symbol,
    action: input.item.action,
    strategyBucket: trade?.strategyBucket ?? "unknown",
    aiThesis: input.item.thesis,
    evidenceRefs: evidenceRefs(input.item),
    normalizedBudgetKrw: input.item.budgetKrw,
    riskApproved,
    rejectCodes:
      riskDecision?.rejectCodes ??
      (input.item.holdReasonCode ? [input.item.holdReasonCode] : []),
    simulatedExecutionStatus: executionStatus,
    auditEventRefs
  };
}

function flattenDecisionItems(
  records: VirtualDecision[]
): Array<{
  record: VirtualDecision;
  item: VirtualDecisionItem;
  itemIndex: number;
}> {
  return records.flatMap((record) =>
    record.decisions.map((item, itemIndex) => ({ record, item, itemIndex }))
  );
}

function validationLabUnavailable(
  status: "missing" | "corrupt" | "invalid"
): ValidationLabViewModel {
  return {
    mode: "paper_only",
    readOnly: true,
    viewModel: "validation-lab",
    status,
    aggregateReportStatus: status,
    sourceGeneratedAt: null,
    runIdentity: null,
    reproducibilityHashes: null,
    validationProtocol: null,
    dataUniverseCoverage: null,
    promptTrialDistribution: null,
    overfittingWarning: null,
    providerFailureSummary: null,
    riskRejectSummary: null,
    exposureBreakdown: null,
    warnings:
      status === "missing"
        ? ["batch replay aggregate report is missing"]
        : ["batch replay aggregate report is not usable"],
    executionAssumptions: {
      paperOnly: true,
      liveTradingEnabled: false,
      orderPlacementEnabled: false
    }
  };
}

function parseStrategyBucketTestSummary(
  value: Record<string, unknown>,
  now: Date
): StrategyBucketTestSummary | null {
  const testId = readStringField(value, "testId");
  const bucket = value["bucket"];
  const status = value["status"];
  const configHash = readStringField(value, "configHash");
  const progress = readRecordField(value, "progress");
  const heartbeat = readRecordField(value, "heartbeat");
  if (
    testId === null ||
    !isStrategyBucket(bucket) ||
    !isStrategyBucketTestStatus(status) ||
    configHash === null ||
    progress === null ||
    heartbeat === null
  ) {
    return null;
  }

  const progressView = parseStrategyBucketTestProgress(progress);
  const heartbeatView = parseStrategyBucketTestHeartbeat(heartbeat, now);
  if (progressView === null || heartbeatView === null) {
    return null;
  }

  return {
    testId,
    bucket,
    status,
    startedAt: readNullableStringField(value, "startedAt"),
    completedAt: readNullableStringField(value, "completedAt"),
    runId: readNullableStringField(value, "runId"),
    configHash,
    progress: progressView,
    heartbeat: heartbeatView
  };
}

function latestActiveStrategyBucketTests(
  records: Record<string, unknown>[],
  now: Date,
  limit: number
): StrategyBucketTestSummary[] {
  const activeTests: StrategyBucketTestSummary[] = [];
  const seenTestIds = new Set<string>();

  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (activeTests.length >= limit) {
      break;
    }
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    const summary = parseStrategyBucketTestSummary(record, now);
    if (summary === null || seenTestIds.has(summary.testId)) {
      continue;
    }
    seenTestIds.add(summary.testId);
    if (isActiveStrategyBucketTest(summary.status)) {
      activeTests.push(summary);
    }
  }

  return activeTests;
}

function latestStrategyBucketTestById(
  records: Record<string, unknown>[],
  testId: string,
  now: Date
): StrategyBucketTestSummary | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    const summary = parseStrategyBucketTestSummary(record, now);
    if (summary?.testId === testId) {
      return summary;
    }
  }

  return null;
}

function parseStrategyBucketTestProgress(
  value: Record<string, unknown>
): StrategyBucketTestProgressView | null {
  const phase = value["phase"];
  const progressRatio = readNullableNumber(value["progressRatio"]);
  const completedPacketCount = readNumberField(value, "completedPacketCount");
  const totalPacketCount = readNullableNumber(value["totalPacketCount"]);
  const decisionCount = readNumberField(value, "decisionCount");
  const riskApprovedCount = readNumberField(value, "riskApprovedCount");
  const riskRejectedCount = readNumberField(value, "riskRejectedCount");
  const simulatedTradeCount = readNumberField(value, "simulatedTradeCount");
  const providerFailureCount = readNumberField(value, "providerFailureCount");
  const updatedAt = readStringField(value, "updatedAt");
  if (
    !isStrategyBucketTestPhase(phase) ||
    progressRatio === undefined ||
    completedPacketCount === null ||
    totalPacketCount === undefined ||
    decisionCount === null ||
    riskApprovedCount === null ||
    riskRejectedCount === null ||
    simulatedTradeCount === null ||
    providerFailureCount === null ||
    updatedAt === null
  ) {
    return null;
  }

  return {
    phase,
    progressRatio,
    completedPacketCount,
    totalPacketCount,
    decisionCount,
    riskApprovedCount,
    riskRejectedCount,
    simulatedTradeCount,
    providerFailureCount,
    latestMessage: readNullableStringField(value, "latestMessage"),
    latestAuditEventRef: readNullableStringField(value, "latestAuditEventRef"),
    updatedAt
  };
}

function parseStrategyBucketTestHeartbeat(
  value: Record<string, unknown>,
  now: Date
): StrategyBucketTestHeartbeatView | null {
  const status = value["status"];
  const staleAfterSeconds = readNumberField(value, "staleAfterSeconds");
  if (
    !isStrategyBucketTestHeartbeatStatus(status) ||
    staleAfterSeconds === null ||
    staleAfterSeconds <= 0
  ) {
    return null;
  }
  const lastSeenAt = readNullableStringField(value, "lastSeenAt");
  return {
    status: strategyBucketHeartbeatStatus(lastSeenAt, staleAfterSeconds, now),
    lastSeenAt,
    staleAfterSeconds
  };
}

function strategyBucketHeartbeatStatus(
  lastSeenAt: string | null,
  staleAfterSeconds: number,
  now: Date
): StrategyBucketTestHeartbeatView["status"] {
  if (lastSeenAt === null) {
    return "missing";
  }

  const lastSeenTime = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenTime)) {
    return "missing";
  }

  return now.getTime() - lastSeenTime > staleAfterSeconds * 1000
    ? "stale"
    : "fresh";
}

function isActiveStrategyBucketTest(status: StrategyBucketTestStatus): boolean {
  return status === "queued" || status === "running";
}

function isStrategyBucketTestStatus(
  value: unknown
): value is StrategyBucketTestStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isStrategyBucketTestPhase(
  value: unknown
): value is StrategyBucketTestPhase {
  return (
    value === "queued" ||
    value === "loading_data" ||
    value === "building_packets" ||
    value === "calling_provider" ||
    value === "risk_gate" ||
    value === "simulating_execution" ||
    value === "writing_artifacts" ||
    value === "aggregating_report" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isStrategyBucketTestHeartbeatStatus(
  value: unknown
): value is StrategyBucketTestHeartbeatView["status"] {
  return value === "fresh" || value === "stale" || value === "missing";
}

function isStrategyBucket(value: unknown): value is StrategyBucket {
  return (
    value === "long_term" ||
    value === "swing" ||
    value === "short_term" ||
    value === "intraday" ||
    value === "hedge"
  );
}

function requiredPolicyFieldsFor(bucket: StrategyBucket): string[] {
  if (bucket === "hedge") {
    return [
      "hedgeEnabled",
      "targetWeightRatio",
      "downsideExposureRule",
      "hedgeCostLimitRatio"
    ];
  }
  return [
    "targetWeightRatio",
    "minWeightRatio",
    "maxWeightRatio",
    "holdingPeriodHint",
    "maxTurnoverRatio"
  ];
}

function holdingPeriodHintFor(bucket: StrategyBucket): HoldingPeriodHint {
  switch (bucket) {
    case "long_term":
      return "multi_month";
    case "swing":
      return "multi_week";
    case "short_term":
      return "multi_day";
    case "intraday":
      return "intraday";
    case "hedge":
      return "hedge";
  }
}

function positionMarketValue(position: VirtualPosition): number {
  return Math.round(
    position.marketValueKrw ?? position.averagePriceKrw * position.quantity
  );
}

function isHedgePosition(position: VirtualPosition): boolean {
  return (
    position.strategyBucket === "hedge" ||
    position.assetClass === "inverse" ||
    (position.riskTags ?? []).includes("inverse")
  );
}

function bucketTurnoverRatio(
  bucket: StrategyBucket,
  trades: VirtualTrade[],
  virtualNetWorthKrw: number
): number | null {
  const amount = trades
    .filter((trade) => trade.strategyBucket === bucket)
    .reduce((sum, trade) => sum + (trade.grossAmountKrw ?? trade.amountKrw), 0);
  return virtualNetWorthKrw > 0 ? ratio(amount, virtualNetWorthKrw) : null;
}

function cashReserveRule(marketRegime: MarketRegimeView): {
  targetCashRatio: number;
  ruleSource: CashComplianceView["ruleSource"];
} {
  switch (marketRegime) {
    case "bull":
      return { targetCashRatio: 0.05, ruleSource: "dynamic_regime" };
    case "sideways":
      return { targetCashRatio: 0.15, ruleSource: "dynamic_regime" };
    case "bear":
      return { targetCashRatio: 0.3, ruleSource: "dynamic_regime" };
    case "mixed":
      return { targetCashRatio: 0.2, ruleSource: "dynamic_regime" };
    case "insufficient_data":
      return { targetCashRatio: 0.2, ruleSource: "fallback" };
  }
}

function bucketCostTurnoverRows(
  trades: VirtualTrade[],
  virtualNetWorthKrw: number
): BucketCostTurnoverRow[] {
  return STRATEGY_BUCKETS.map((bucket) => {
    const bucketTrades = trades.filter(
      (trade) => trade.strategyBucket === bucket
    );
    const grossTradeAmountKrw = bucketTrades.reduce(
      (sum, trade) => sum + tradeAmountKrw(trade),
      0
    );
    const totalCostKrw = bucketTrades.reduce(
      (sum, trade) => sum + tradeCostKrw(trade),
      0
    );
    return {
      bucket,
      tradeCount: bucketTrades.length,
      grossTradeAmountKrw,
      totalCostKrw,
      turnoverRatio:
        virtualNetWorthKrw > 0
          ? ratio(grossTradeAmountKrw, virtualNetWorthKrw)
          : null,
      costDragRatio:
        grossTradeAmountKrw > 0 ? ratio(totalCostKrw, grossTradeAmountKrw) : null
    };
  });
}

function tradeAmountKrw(trade: VirtualTrade): number {
  return trade.grossAmountKrw ?? trade.filledNotionalKrw ?? trade.amountKrw;
}

function tradeCostKrw(trade: VirtualTrade): number {
  const componentTotal =
    (trade.feeKrw ?? 0) +
    (trade.taxKrw ?? 0) +
    (trade.slippageKrw ?? 0) +
    (trade.spreadCostKrw ?? 0) +
    (trade.impactCostKrw ?? 0);
  return componentTotal > 0 ? componentTotal : trade.totalCostKrw ?? 0;
}

function maxExposureBucketFromBuckets(
  buckets: ExposureBucket[]
): ExposureBucket | null {
  return buckets.reduce<ExposureBucket | null>((current, bucket) => {
    if (bucket.exposureKrw <= 0) {
      return current;
    }
    if (current === null || bucket.exposureKrw > current.exposureKrw) {
      return bucket;
    }
    return current;
  }, null);
}

function rejectCodeCounts(
  decisionItems: Array<{ item: VirtualDecisionItem }>,
  auditEvents: AuditEvent[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { item } of decisionItems) {
    if (item.holdReasonCode !== undefined) {
      counts[item.holdReasonCode] = (counts[item.holdReasonCode] ?? 0) + 1;
    }
  }
  for (const event of auditEvents) {
    if (event.eventType.toUpperCase().includes("REJECT")) {
      counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
    }
  }
  return counts;
}

function countRejectedAuditEvents(events: AuditEvent[]): number {
  return events.filter((event) => event.eventType.toUpperCase().includes("REJECT"))
    .length;
}

function countCurrentRejected(
  decisionItems: Array<{ item: VirtualDecisionItem }>,
  auditEvents: AuditEvent[]
): number {
  return (
    decisionItems.filter(({ item }) => item.holdReasonCode !== undefined).length +
    countRejectedAuditEvents(auditEvents)
  );
}

function inferMarketRegime(value: unknown): MarketRegimeView {
  const summary = readRecordField(value, "summary");
  const regimeCounts = readRecordField(summary, "regimeCounts");
  if (regimeCounts === null) {
    return "insufficient_data";
  }

  const counts = Object.entries(regimeCounts)
    .map(([key, entry]) => [key, readNumber(entry)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null)
    .filter(([key]) => key !== "insufficient_data");
  if (counts.length === 0) {
    return "insufficient_data";
  }

  counts.sort((left, right) => right[1] - left[1]);
  if (counts.length > 1 && counts[0]![1] === counts[1]![1]) {
    return "mixed";
  }

  const regime = counts[0]![0];
  return regime === "bull" || regime === "bear" || regime === "sideways"
    ? regime
    : "mixed";
}

function parseRiskDecision(
  value: Record<string, unknown>
): RiskDecisionSnapshot | null {
  const packetId = readStringField(value, "packetId");
  const approved = value["approved"];
  if (packetId === null || typeof approved !== "boolean") {
    return null;
  }
  return {
    riskDecisionId: readStringField(value, "riskDecisionId"),
    packetId,
    symbol: readStringField(value, "symbol"),
    approved,
    rejectCodes: stringArray(value["rejectCodes"])
  };
}

function simulatedExecutionStatus(
  trade: VirtualTrade | null
): "filled" | "partial" | "rejected" | "none" {
  if (trade === null) {
    return "none";
  }
  if (trade.fillStatus !== undefined) {
    return trade.fillStatus;
  }
  switch (trade.status) {
    case "VIRTUAL_FILLED":
      return "filled";
    case "VIRTUAL_REJECTED":
      return "rejected";
    case "VIRTUAL_PENDING":
    case "VIRTUAL_EXPIRED":
      return "none";
  }
}

function decisionItemId(
  record: VirtualDecision,
  item: VirtualDecisionItem,
  itemIndex: number
): string {
  return (
    record.decisionHash ??
    `${record.packetId}:${item.market}:${item.symbol}:${itemIndex}`
  );
}

function evidenceRefs(item: VirtualDecisionItem): string[] {
  return [...item.dataRefs, ...(item.featureRefs ?? [])];
}

function matchingAuditEventRefs(
  events: AuditEvent[],
  packetId: string,
  symbol: string
): string[] {
  return events
    .filter(
      (event) =>
        event.summary.includes(packetId) ||
        event.summary.includes(symbol) ||
        event.maskedRefs.includes(packetId) ||
        event.maskedRefs.includes(symbol)
    )
    .map((event) => event.eventId);
}

function mapToExposureBuckets(
  source: Map<string, number>,
  virtualNetWorthKrw: number
): ExposureBucket[] {
  return [...source.entries()]
    .map(([key, exposureKrw]) => ({
      key,
      exposureKrw,
      exposureRatio: ratio(exposureKrw, virtualNetWorthKrw)
    }))
    .sort((left, right) => right.exposureKrw - left.exposureKrw);
}

function maxExposureBucket(
  source: Map<string, number>,
  virtualNetWorthKrw: number
): ExposureBucket | null {
  return mapToExposureBuckets(source, virtualNetWorthKrw)[0] ?? null;
}

function emptyBucketAmounts(): Record<StrategyBucket, number> {
  return {
    long_term: 0,
    swing: 0,
    short_term: 0,
    intraday: 0,
    hedge: 0
  };
}

function jsonlStatus(corruptLineCount: number): JsonlReadStatus {
  return corruptLineCount > 0 ? "degraded" : "ok";
}

function storeJsonlStatus(
  recordCount: number,
  corruptLineCount: number
): JsonlReadStatus {
  if (corruptLineCount > 0) {
    return "degraded";
  }
  return recordCount > 0 ? "ok" : "missing";
}

async function readJsonFile(filePath: string): Promise<JsonFileRead> {
  try {
    return { status: "ok", value: JSON.parse(await readFile(filePath, "utf8")) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing", value: null };
    }
    if (error instanceof SyntaxError) {
      return { status: "corrupt", value: null };
    }
    throw error;
  }
}

async function readJsonlRecords(filePath: string): Promise<JsonlRead> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { status: "missing", records: [], corruptLineCount: 0 };
    }
    throw error;
  }

  const records: Record<string, unknown>[] = [];
  let corruptLineCount = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        records.push(parsed);
      } else {
        corruptLineCount += 1;
      }
    } catch {
      corruptLineCount += 1;
    }
  }

  return {
    status: corruptLineCount > 0 ? "degraded" : "ok",
    records,
    corruptLineCount
  };
}

function emptyJsonlRead(status: JsonlReadStatus): JsonlRead {
  return {
    status,
    records: [],
    corruptLineCount: 0
  };
}

function isBatchReplayAggregateReportShape(
  value: unknown
): value is BatchReplayAggregateReport {
  if (!isRecord(value) || value["mode"] !== "paper_only") {
    return false;
  }
  const summary = readRecordField(value, "summary");
  const overall = readRecordField(value, "overall");
  return (
    readStringField(value, "generatedAt") !== null &&
    readNumberField(summary, "runCount") !== null &&
    readNumberField(summary, "completedCount") !== null &&
    readNumberField(summary, "skippedCount") !== null &&
    readNumberField(summary, "failedCount") !== null &&
    readNumberField(summary, "returnSampleCount") !== null &&
    readNumberField(overall, "runCount") !== null &&
    readNumberField(overall, "completedCount") !== null &&
    readNumberField(overall, "returnSampleCount") !== null
  );
}

function readRecordField(
  value: unknown,
  key: string
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return isRecord(field) ? field : null;
}

function readStringField(
  value: Record<string, unknown>,
  key: string
): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field : null;
}

function readNullableStringField(
  value: Record<string, unknown>,
  key: string
): string | null {
  const field = value[key];
  return field === null ? null : readStringField(value, key);
}

function readNumberField(
  value: Record<string, unknown> | null,
  key: string
): number | null {
  if (value === null) {
    return null;
  }
  return readNumber(value[key]);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readNumber(value) ?? undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
