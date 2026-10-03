export type StrategyBucket =
  | "long_term"
  | "swing"
  | "short_term"
  | "intraday"
  | "hedge";

export type ViewModelStatus = "ok" | "watch" | "breach" | "missing";
export type JsonReadStatus = "missing" | "ok" | "corrupt" | "degraded";
export type FetchStatus = "ok" | "offline" | "invalid";
export type DashboardViewModelName =
  | "live-readiness"
  | "portfolio-compliance"
  | "strategy-test-lab"
  | "strategy-test-progress"
  | "risk-gate-trace"
  | "validation-lab"
  | "audit";

export interface BucketComplianceRow {
  bucket: StrategyBucket;
  minWeightRatio: number | null;
  targetWeightRatio: number | null;
  maxWeightRatio: number | null;
  currentWeightRatio: number;
  gapRatio: number | null;
  exposureKrw: number;
  turnoverRatio: number | null;
  status: "ok" | "under" | "over" | "missing_policy";
  primaryReason: string | null;
}

export interface ActivePolicySummary {
  runtimePolicyRecordId: string;
  policyId: string;
  version: string;
  policyHash: string;
  activationId: string;
  effectiveFrom: string;
}

export interface PolicyComplianceViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "portfolio-compliance";
  asOf: string | null;
  portfolioId: string | null;
  virtualNetWorthKrw: number;
  policyStatus: "active" | "missing" | "invalid";
  activePolicy: ActivePolicySummary | null;
  bucketCompliance: BucketComplianceRow[];
  cashCompliance: {
    marketRegime: string;
    targetCashRatio: number;
    currentCashRatio: number;
    currentCashKrw: number;
    minimumCashReserveKrw: number;
    cashGapKrw: number;
    ruleSource: string;
    status: "ok" | "under_reserved" | "missing";
    rejectedCount: number;
    rejectCodes: Record<string, number>;
  };
  hedgeCompliance: {
    policyEnabled: boolean | null;
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
  };
  exposureCompliance: {
    grossExposureKrw: number;
    grossExposureRatio: number;
    byMarket: ExposureBucket[];
    byStrategyBucket: ExposureBucket[];
    maxSymbolExposure: ExposureBucket | null;
    status: ViewModelStatus;
  };
  riskGateSummary: {
    decisionRecordCount: number;
    decisionItemCount: number;
    actionableDecisionCount: number;
    simulatedTradeCount: number;
    rejectedCount: number;
    rejectCodes: Record<string, number>;
  };
  complianceAnalytics: ComplianceAnalyticsView;
  sourceStatus: Record<string, JsonReadStatus>;
  warnings: string[];
  status: ViewModelStatus;
}

export function isHedgeComplianceBreachStatus(
  status: PolicyComplianceViewModel["hedgeCompliance"]["status"],
  policyEnabled: PolicyComplianceViewModel["hedgeCompliance"]["policyEnabled"]
): boolean {
  return policyEnabled === true && status !== "ok" && status !== "missing";
}

export interface ComplianceAnalyticsView {
  strategyBucket: {
    occupiedBucketCount: number;
    missingPolicyTargetCount: number;
    largestBucket: ExposureBucket | null;
    concentrationRatio: number | null;
    status: ViewModelStatus;
  };
  cashReserve: {
    currentCashKrw: number;
    currentCashRatio: number;
    targetCashRatio: number;
    minimumCashReserveKrw: number;
    cashGapKrw: number;
    reserveStatus: "ok" | "under_reserved" | "missing";
    marketRegime: string;
    ruleSource: string;
  };
  hedgeEffectiveness: {
    hedgeCoverageRatio: number | null;
    netDownsideExposureRatio: number | null;
    costDragRatio: number | null;
    status: "ok" | "ineffective" | "over_hedged" | "missing";
  };
  costTurnover: {
    totalTradeAmountKrw: number;
    totalCostKrw: number;
    totalTurnoverRatio: number | null;
    totalCostDragRatio: number | null;
    byStrategyBucket: BucketCostTurnoverRow[];
  };
}

export interface BucketCostTurnoverRow {
  bucket: StrategyBucket;
  tradeCount: number;
  grossTradeAmountKrw: number;
  totalCostKrw: number;
  turnoverRatio: number | null;
  costDragRatio: number | null;
}

export interface ExposureBucket {
  key: string;
  exposureKrw: number;
  exposureRatio: number;
}

export interface LiveReadinessViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "live-readiness";
  generatedAt: string;
  environment: {
    tradingEnabled: boolean;
    brokerProvider: string;
    aiDecisionMode: string;
    aiDecisionEnabled: boolean;
  };
  officialApi: {
    authEnabled: boolean;
    authStatus: "disabled" | "ready" | "invalid";
    baseUrl: string;
    clientIdConfigured: boolean;
    clientCredentialConfigured: boolean;
    issueCodes: string[];
    snapshotStatus: "disabled" | "configured" | "invalid";
  };
  orderGateway: {
    liveOrderGatewayStatus: "disabled";
    orderRouterConnectionStatus: "not_connected";
    mcpMutationToolExposureStatus: "not_exposed";
    orderPlacementEnabled: false;
    rawTossctlExecutionEnabled: false;
    rawCodexExecEnabled: false;
  };
  checks: LiveReadinessCheck[];
  warnings: string[];
  status: ViewModelStatus;
}

export interface LiveReadinessCheck {
  key:
    | "trading_enabled"
    | "broker_provider"
    | "ai_decision_mode"
    | "official_auth_config"
    | "read_only_account_snapshot"
    | "live_order_gateway"
    | "order_router_connection"
    | "mcp_mutation_tool_exposure";
  label: string;
  value: string;
  tone: "ok" | "watch" | "blocked";
  detail: string;
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
  sourceStatus: Record<string, JsonReadStatus>;
  status: "ok";
}

export interface StrategyBucketTestCapability {
  bucket: StrategyBucket;
  canRunIsolatedReplay: boolean;
  requiredPolicyFields: string[];
  defaultHoldingPeriodHint: string;
  disabledReason: string | null;
}

export interface StrategyBucketTestResultSummary {
  testId: string;
  bucket: StrategyBucket;
  status: "completed" | "failed" | "cancelled";
  validationSplitRole: "train" | "validation" | "test" | null;
  totalReturnRatio: number | null;
  maxDrawdownRatio: number | null;
  turnoverRatio: number | null;
  costDragRatio: number | null;
  riskRejectRate: number | null;
  providerFailureRate: number | null;
  warnings: string[];
}

export interface StrategyBucketPortfolioBaseline {
  source: "batch_aggregate_overall";
  runCount: number;
  completedCount: number;
  returnSampleCount: number;
  averageTotalReturnRatio: number | null;
}

export interface StrategyBucketPortfolioDeltaRow {
  testId: string;
  bucket: StrategyBucket;
  totalReturnDeltaRatio: number | null;
}

export interface StrategyBucketTestSummary {
  testId: string;
  bucket: StrategyBucket;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string | null;
  completedAt: string | null;
  runId: string | null;
  configHash: string;
  progress: {
    phase:
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
  };
  heartbeat: {
    status: "fresh" | "stale" | "missing";
    lastSeenAt: string | null;
    staleAfterSeconds: number;
  };
}

export interface StrategyBucketComparisonView {
  rows: StrategyBucketTestResultSummary[];
  baselineBucket: StrategyBucket | null;
  portfolioBaseline: StrategyBucketPortfolioBaseline | null;
  portfolioDeltaRows: StrategyBucketPortfolioDeltaRow[];
  selectionWarning: string | null;
}

export interface StrategyBucketTestProgressViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "strategy-test-progress";
  testId: string;
  test: StrategyBucketTestSummary | null;
  sourceStatus: {
    strategyBucketTestRecords: JsonReadStatus;
  };
  storageMutationEnabled: false;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  replayRunnerStarted: false;
  status: "ok" | "missing" | "invalid";
}

export interface RiskGateTraceViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "risk-gate-trace";
  sourceFamily: "historical_replay" | "virtual";
  traces: Array<{
    packetId: string;
    decisionId: string;
    market: string;
    symbol: string;
    action: string;
    strategyBucket: StrategyBucket | "unknown";
    aiThesis: string | null;
    evidenceRefs: string[];
    normalizedBudgetKrw: number | null;
    riskApproved: boolean;
    rejectCodes: string[];
    simulatedExecutionStatus: "filled" | "partial" | "rejected" | "none";
    auditEventRefs: string[];
  }>;
  count: number;
  totalDecisionItemCount: number;
  sourceStatus: Record<string, JsonReadStatus>;
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
  sharpeValidation: SharpeValidationView;
  cpcvPboValidation: CpcvPboValidationView;
  metaLabelEvaluation: MetaLabelEvaluationView;
  costRiskWarning: CostRiskWarningView;
  candidateComparison: ValidationCandidateComparisonView;
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

export interface CostRiskWarningView {
  status: "missing" | "available" | "warning";
  sampleCount: number;
  tradeCount: number;
  totalCostKrw: number;
  feeKrw: number;
  taxKrw: number;
  slippageKrw: number;
  spreadCostKrw: number;
  impactCostKrw: number;
  partialFillCount: number;
  notModeledLiquidityCount: number;
  averageCostPerTradeKrw: number | null;
  maxParticipationRate: number | null;
  highestCostBucket: CostRiskBucketWarningView | null;
  missingStrategyBucketBreakdownCount: number;
  missingStrategyBucketBreakdownRunIds: string[];
  warningCount: number;
  warnings: CostRiskWarningMessageView[];
  readOnlyNotice: string;
}

export interface CostRiskBucketWarningView {
  strategyBucket: StrategyBucket | "UNKNOWN";
  tradeCount: number;
  totalCostKrw: number;
  slippageKrw: number;
  spreadCostKrw: number;
  impactCostKrw: number;
  averageCostPerTradeKrw: number | null;
  maxParticipationRate: number | null;
  runIds: string[];
}

export interface CostRiskWarningMessageView {
  code: string;
  severity: "warning";
  message: string;
}

export interface SharpeValidationView {
  status: "missing" | "available" | "unavailable";
  schemaVersion: string | null;
  returnSampleCount: number;
  minimumSampleCount: number | null;
  sampleSharpeStatus: string | null;
  sampleSharpeValue: number | null;
  loAdjustedSharpeStatus: string | null;
  probabilisticSharpeRatioStatus: string | null;
  probabilisticSharpeRatioProbability: number | null;
  deflatedSharpeRatioStatus: string | null;
  deflatedSharpeRatioProbability: number | null;
  selectionContext: {
    candidateCount: number | null;
    trialCount: number | null;
    trialSharpeRatioStandardDeviation: number | null;
    selectedByMetric: string | null;
    multipleTestingAdjustment: string | null;
  };
  warningCount: number;
  warnings: SharpeValidationWarningView[];
  readOnlyNotice: string;
}

export interface SharpeValidationWarningView {
  code: string;
  severity: "info" | "warning";
  message: string;
}

export interface CpcvPboValidationView {
  status: "missing" | "available" | "sampled" | "unavailable";
  schemaVersion: string | null;
  generatedAt: string | null;
  pboStatus: string | null;
  pboProbability: number | null;
  evaluatedCombinationCount: number;
  selectedBelowMedianCount: number;
  combinationMode: string | null;
  splitPlanAvailable: boolean;
  warningCount: number;
  warnings: CpcvPboWarningView[];
  readOnlyNotice: string;
}

export interface CpcvPboWarningView {
  code: string;
  severity: "info" | "warning";
  message: string;
}

export interface MetaLabelEvaluationView {
  status: "missing" | "available" | "invalid";
  schemaVersion: string | null;
  generatedAt: string | null;
  totalCandidateCount: number;
  actionableCandidateCount: number;
  correctSideCount: number;
  wrongSideCount: number;
  notActionableCount: number;
  accuracyRatio: number | null;
  warningCount: number;
  warnings: MetaLabelEvaluationWarningView[];
  readOnlyNotice: string;
}

export interface MetaLabelEvaluationWarningView {
  code: string;
  severity: "info" | "warning";
  message: string;
}

export interface ValidationCandidateComparisonView {
  status: "available" | "missing";
  selectionMetric: string | null;
  selectedCandidateKey: string | null;
  candidateCount: number;
  returnSampleCount: number;
  rows: ValidationCandidateComparisonRow[];
  warnings: string[];
}

export interface ValidationCandidateComparisonRow {
  candidateKey: string;
  selected: boolean;
  decisionProviderMode: string;
  promptHash: string | null;
  riskProfile: string | null;
  configHashes: Array<string | null>;
  trainAverageTotalReturnRatio: number | null;
  validationAverageTotalReturnRatio: number | null;
  testAverageTotalReturnRatio: number | null;
  trainReturnSampleCount: number;
  validationReturnSampleCount: number;
  testReturnSampleCount: number;
  runIds: string[];
  holdoutDegradationCount: number;
}

export interface DashboardAuditEventRow {
  eventId: string;
  eventType: string;
  actor: string;
  summary: string;
  maskedRefs: string[];
  createdAt: string;
  severity: "info" | "warning" | "failure";
  category:
    | "risk_gate"
    | "paper_policy"
    | "strategy_test"
    | "simulation"
    | "market_data"
    | "system";
  rejectedAction: boolean;
  failureTrace: boolean;
}

export interface DashboardAuditViewModel {
  mode: "paper_only";
  readOnly: true;
  viewModel: "audit";
  events: DashboardAuditEventRow[];
  count: number;
  totalCount: number;
  rejectedActionCount: number;
  failureTraceCount: number;
  eventTypeCounts: Record<string, number>;
  actorCounts: Record<string, number>;
  latestEventAt: string | null;
  sourceStatus: Record<string, JsonReadStatus>;
  warnings: string[];
  status: ViewModelStatus;
}

export interface BatchReplayRunSummary {
  runId: string;
  batchId: string | null;
  status: string;
  runIndex: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  skippedAt: string | null;
  marketRegimeLabel: string | null;
  totalReturnRatio: number | null;
  finalVirtualNetWorthKrw: number | null;
  tradeCount: number | null;
  rejectedCount: number | null;
  aiDecisionFailureCount: number | null;
  storageBaseDir: string | null;
  reportPath: string | null;
  error: string | null;
  skipReason: string | null;
}

export type RunArtifactReadStatus = JsonReadStatus | "blocked" | "invalid";

export interface BatchReplayRunArtifacts {
  status: string;
  runId: string | null;
  runStatus: string | null;
  reportStatus: RunArtifactReadStatus;
  progressStatus: RunArtifactReadStatus;
  decisionsStatus: RunArtifactReadStatus;
  riskDecisionsStatus: RunArtifactReadStatus;
  tradesStatus: RunArtifactReadStatus;
  reportTitle: string | null;
  progressStatusLabel: string | null;
  simulatedAt: string | null;
  completedTickCount: number | null;
  tickCount: number | null;
  decisionCount: number;
  totalDecisionCount: number;
  riskDecisionCount: number;
  totalRiskDecisionCount: number;
  tradeCount: number;
  totalTradeCount: number;
  rejectedCount: number | null;
  currentVirtualNetWorthKrw: number | null;
  currentCashKrw: number | null;
  currentPositionCount: number | null;
}

export type SimulationObservationView = {
  status: "available";
  simulationRunId: string;
  acceptedAt: string;
  outcome: "unknown" | "runner_failed";
  runnerFailure: { observedAt: string; reasonCode: "runner_rejected" } | null;
} | { status: "missing" | "invalid" | "unavailable" | "unsupported" | "not_requested" };

export interface RunDetailView {
  mode: "paper_only";
  readOnly: true;
  runId: string;
  batchId: string | null;
  batchStatus: string | null;
  sourceRunsPath: string | null;
  run: BatchReplayRunSummary | null;
  artifacts: BatchReplayRunArtifacts | null;
  latestArtifactsRunId: string | null;
  warnings: string[];
  status: "ok" | "missing";
  requestedId: string;
  endpointStatus: string | null;
  simulationObservation: SimulationObservationView;
}

export type ViewModelResult<T> =
  | {
      status: "ok";
      endpoint: string;
      fetchedAt: string;
      data: T;
    }
  | {
      status: Exclude<FetchStatus, "ok">;
      endpoint: string;
      fetchedAt: string;
      data: null;
      message: string;
    };

export interface DashboardViewModels {
  apiBaseLabel: string;
  fetchedAt: string;
  portfolio: ViewModelResult<PolicyComplianceViewModel>;
  strategyLab: ViewModelResult<StrategyBucketTestLabViewModel>;
  riskGate: ViewModelResult<RiskGateTraceViewModel>;
  validationLab: ViewModelResult<ValidationLabViewModel>;
}

export interface LiveReadinessPageData {
  apiBaseLabel: string;
  fetchedAt: string;
  liveReadiness: ViewModelResult<LiveReadinessViewModel>;
}

export interface PortfolioCompliancePageData {
  apiBaseLabel: string;
  fetchedAt: string;
  portfolio: ViewModelResult<PolicyComplianceViewModel>;
}

export interface StrategyTestLabPageData {
  apiBaseLabel: string;
  fetchedAt: string;
  strategyLab: ViewModelResult<StrategyBucketTestLabViewModel>;
}

export interface AuditPageData {
  apiBaseLabel: string;
  fetchedAt: string;
  audit: ViewModelResult<DashboardAuditViewModel>;
}

export interface RiskGateTracePageData {
  apiBaseLabel: string;
  fetchedAt: string;
  riskGate: ViewModelResult<RiskGateTraceViewModel>;
}

export interface ValidationLabPageData {
  apiBaseLabel: string;
  fetchedAt: string;
  validationLab: ViewModelResult<ValidationLabViewModel>;
}

export interface RunDetailPageData {
  apiBaseLabel: string;
  fetchedAt: string;
  runDetail: ViewModelResult<RunDetailView>;
}

export type ExperimentTerminalStatus =
  | "completed"
  | "completed_with_failures"
  | "failed"
  | "skipped";

export type ExperimentListWarningCode =
  | "batch_metadata_invalid"
  | "batch_status_unknown"
  | "aggregate_status_unknown"
  | "active_progress_status_unknown"
  | "row_invalid"
  | "row_status_unknown"
  | "row_batch_mismatch"
  | "row_duplicate"
  | "row_metadata_invalid"
  | "unbound_rows"
  | "active_run_invalid"
  | "active_run_unbound"
  | "active_run_inconsistent"
  | "active_run_terminal_duplicate"
  | "status_counts_unknown"
  | "corrupt_lines";

export interface ExperimentListWarning {
  code: ExperimentListWarningCode;
  count: number;
}

export interface ExperimentListRow {
  runId: string;
  batchId: string | null;
  status: ExperimentTerminalStatus | "running";
  provenance: "bound_manifest" | "unbound_stored";
  detailHref: string;
  runIndex: number | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  skippedAt: string | null;
  windowStartAt: string | null;
  windowEndAt: string | null;
  marketRegimeLabel: string | null;
  totalReturnRatio: number | null;
  finalVirtualNetWorthKrw: number | null;
  tradeCount: number | null;
  rejectedCount: number | null;
  aiDecisionFailureCount: number | null;
}

export interface ExperimentListView {
  mode: "paper_only";
  readOnly: true;
  sourceLabel: "API-selected/latest-unverified";
  endpointStatus: "ok" | "running" | "missing" | "blocked" | "degraded";
  aggregateStatus: "ok" | "missing" | "corrupt" | null;
  batchId: string | null;
  batchStatus: "running" | "completed" | "completed_with_failures" | null;
  batchStartedAt: string | null;
  batchUpdatedAt: string | null;
  batchCompletedAt: string | null;
  requestedRunCount: number | null;
  manifestCounts: {
    completed: number | null;
    skipped: number | null;
    failed: number | null;
  };
  riskProfile: string | null;
  decisionProviderMode: string | null;
  initialCashKrw: number | null;
  // These are API counts over the returned window / complete stored source.
  // They must not be replaced by the validated projection or manifest counts.
  count: number;
  totalCount: number;
  statusCounts: Partial<Record<ExperimentTerminalStatus, number>>;
  unknownStatusCount: number;
  corruptLineCount: number;
  activeRunProgressStatus: "ok" | "missing" | "corrupt" | null;
  rows: ExperimentListRow[];
  projectedTerminalCount: number;
  projectedActiveCount: number;
  excludedRowCount: number;
  warnings: ExperimentListWarning[];
}

export interface ExperimentListPageData {
  fetchedAt: string;
  experimentList: ViewModelResult<ExperimentListView>;
}

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787";
const FETCH_TIMEOUT_MS = 2_000;

export async function readDashboardViewModels(): Promise<DashboardViewModels> {
  const apiConfig = readOperationsApiConfig();
  const apiBaseUrl = apiConfig.baseUrl;
  const fetchedAt = new Date().toISOString();
  const [portfolio, strategyLab, riskGate, validationLab] = await Promise.all([
    fetchViewModel<PolicyComplianceViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/portfolio-compliance",
      "portfolio-compliance",
      isPolicyComplianceViewModel
    ),
    fetchViewModel<StrategyBucketTestLabViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/strategy-test-lab",
      "strategy-test-lab",
      isStrategyBucketTestLabViewModel
    ),
    fetchViewModel<RiskGateTraceViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/risk-gate-trace?limit=8",
      "risk-gate-trace",
      isRiskGateTraceViewModel
    ),
    fetchViewModel<ValidationLabViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/validation-lab",
      "validation-lab",
      isValidationLabViewModel,
      withValidationLabCandidateComparisonFallback
    )
  ]);

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    portfolio,
    strategyLab,
    riskGate,
    validationLab
  };
}

export function countOnlineViewModels(viewModels: DashboardViewModels): number {
  return [
    viewModels.portfolio,
    viewModels.strategyLab,
    viewModels.riskGate,
    viewModels.validationLab
  ].filter((result) => result.status === "ok").length;
}

export async function readLiveReadinessPageData(): Promise<LiveReadinessPageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const liveReadiness = await fetchViewModel<LiveReadinessViewModel>(
    apiConfig.baseUrl,
    "/dashboard/view-model/live-readiness",
    "live-readiness",
    isLiveReadinessViewModel
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    liveReadiness
  };
}

export async function readPortfolioCompliancePageData(): Promise<PortfolioCompliancePageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const portfolio = await fetchViewModel<PolicyComplianceViewModel>(
    apiConfig.baseUrl,
    "/dashboard/view-model/portfolio-compliance",
    "portfolio-compliance",
    isPolicyComplianceViewModel
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    portfolio
  };
}

export async function readStrategyTestLabPageData(): Promise<StrategyTestLabPageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const strategyLab = await fetchViewModel<StrategyBucketTestLabViewModel>(
    apiConfig.baseUrl,
    "/dashboard/view-model/strategy-test-lab",
    "strategy-test-lab",
    isStrategyBucketTestLabViewModel
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    strategyLab
  };
}

export async function readAuditPageData(): Promise<AuditPageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const audit = await fetchViewModel<DashboardAuditViewModel>(
    apiConfig.baseUrl,
    "/dashboard/view-model/audit?limit=30",
    "audit",
    isDashboardAuditViewModel
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    audit
  };
}

export async function readRiskGateTracePageData(): Promise<RiskGateTracePageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const riskGate = await fetchViewModel<RiskGateTraceViewModel>(
    apiConfig.baseUrl,
    "/dashboard/view-model/risk-gate-trace?limit=30",
    "risk-gate-trace",
    isRiskGateTraceViewModel
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    riskGate
  };
}

export async function readValidationLabPageData(): Promise<ValidationLabPageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const validationLab = await fetchViewModel<ValidationLabViewModel>(
    apiConfig.baseUrl,
    "/dashboard/view-model/validation-lab",
    "validation-lab",
    isValidationLabViewModel,
    withValidationLabCandidateComparisonFallback
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    validationLab
  };
}

export async function readRunDetailPageData(
  runId: string
): Promise<RunDetailPageData> {
  const apiConfig = readOperationsApiConfig();
  const fetchedAt = new Date().toISOString();
  const endpoint = `/batch/replay/runs?limit=100&includeLatestRunArtifacts=1&runId=${encodeURIComponent(runId)}`;
  const runDetail = await fetchBatchReplayRunDetail(
    apiConfig.baseUrl,
    endpoint,
    runId
  );

  return {
    apiBaseLabel: apiConfig.label,
    fetchedAt,
    runDetail
  };
}

/** A single read of the API-selected source, without run artifacts or mutations. */
export async function readExperimentListPageData(): Promise<ExperimentListPageData> {
  const { baseUrl } = readOperationsApiConfig();
  const endpoint = "/batch/replay/runs?limit=100";
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const unavailable = (
    status: "offline" | "invalid",
    message: string
  ): ExperimentListPageData => ({
    fetchedAt,
    experimentList: { status, endpoint, fetchedAt, data: null, message }
  });

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      return unavailable("offline", "실험 목록 API에 연결할 수 없습니다");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return unavailable("invalid", "실험 목록 응답 형식이 올바르지 않습니다");
      }
      throw error;
    }
    const data = normalizeExperimentListView(payload);
    if (data === null) {
      return unavailable("invalid", "실험 목록 응답이 읽기 전용 계약과 일치하지 않습니다");
    }
    return {
      fetchedAt,
      experimentList: { status: "ok", endpoint, fetchedAt, data }
    };
  } catch {
    // Never forward transport errors, configured API URLs, or runner diagnostics.
    return unavailable("offline", "실험 목록 API에 연결할 수 없습니다");
  } finally {
    clearTimeout(timeout);
  }
}

/** Safe list payload only; raw detail records never cross this public boundary. */
export function normalizeExperimentListView(value: unknown): ExperimentListView | null {
  return projectExperimentListSource(value)?.view ?? null;
}

function projectExperimentListSource(value: unknown): {
  view: ExperimentListView;
  terminalRecordsById: Map<string, Record<string, unknown>>;
} | null {
  if (
    !isRecord(value) || value["mode"] !== "paper_only" || value["readOnly"] !== true ||
    !Array.isArray(value["runs"]) || value["runs"].length > 100 ||
    !isExperimentEndpointStatus(value["status"]) ||
    !isExperimentCount(value["count"]) || !isExperimentCount(value["totalCount"]) ||
    !isExperimentCount(value["corruptLineCount"]) ||
    value["count"] !== value["runs"].length || value["totalCount"] < value["count"] ||
    !isRecord(value["statusCounts"])
  ) {
    return null;
  }

  const warningCounts = new Map<ExperimentListWarningCode, number>();
  const warn = (code: ExperimentListWarningCode, count = 1) => {
    if (count > 0) warningCounts.set(code, (warningCounts.get(code) ?? 0) + count);
  };
  const statusCounts: ExperimentListView["statusCounts"] = {};
  let allStatusCount = 0;
  let unknownStatusCount = 0;
  for (const [status, count] of Object.entries(value["statusCounts"])) {
    if (!isExperimentCount(count)) return null;
    allStatusCount += count;
    if (!Number.isSafeInteger(allStatusCount)) return null;
    if (isExperimentTerminalStatus(status)) statusCounts[status] = count;
    else unknownStatusCount += count;
  }
  if (allStatusCount !== value["totalCount"]) return null;
  warn("status_counts_unknown", unknownStatusCount);
  warn("corrupt_lines", value["corruptLineCount"]);

  const metadata = <T>(
    raw: unknown,
    read: (input: unknown) => T | null,
    code: ExperimentListWarningCode = "batch_metadata_invalid"
  ): T | null => {
    const parsed = read(raw);
    if (raw !== null && raw !== undefined && parsed === null) warn(code);
    return parsed;
  };
  // Manifest counts describe optional metadata, not the returned source cardinality.
  // Degrade only malformed fields so independently valid stored children survive.
  const rawManifestCounts = metadata(value["manifestCounts"],
    (input) => isRecord(input) ? input : null) ?? {};
  const manifestCounts = {
    completed: metadata(rawManifestCounts["completed"], readExperimentCount),
    skipped: metadata(rawManifestCounts["skipped"], readExperimentCount),
    failed: metadata(rawManifestCounts["failed"], readExperimentCount)
  };
  const requestedRunCount = metadata(value["requestedRunCount"], readExperimentCount);
  const batchId = metadata(value["batchId"], readExperimentId);
  const rawBatchStatus = value["batchStatus"];
  const batchStatus = rawBatchStatus === "running" || rawBatchStatus === "completed" ||
    rawBatchStatus === "completed_with_failures" ? rawBatchStatus : null;
  if (batchStatus === null && rawBatchStatus !== null && rawBatchStatus !== undefined) {
    warn("batch_status_unknown");
  }
  const aggregateStatus = metadata(
    value["aggregateStatus"], readExperimentSourceStatus, "aggregate_status_unknown"
  );
  const activeRunProgressStatus = metadata(
    value["activeRunProgressStatus"], readExperimentSourceStatus, "active_progress_status_unknown"
  );
  const batchStartedAt = metadata(value["batchStartedAt"], readExperimentTimestamp);
  const batchUpdatedAt = metadata(value["batchUpdatedAt"], readExperimentTimestamp);
  const batchCompletedAt = metadata(value["batchCompletedAt"], readExperimentTimestamp);
  const riskProfile = metadata(value["riskProfile"], readExperimentLabel);
  const decisionProviderMode = metadata(value["decisionProviderMode"], readExperimentLabel);
  const initialCashKrw = metadata(value["initialCashKrw"], readExperimentNonnegativeNumber);
  const terminalRows = new Map<string, ExperimentListRow>();
  const terminalRecordsById = new Map<string, Record<string, unknown>>();
  const observedTerminalIds = new Set<string>();
  let excludedRowCount = 0;

  for (const raw of value["runs"]) {
    if (!isRecord(raw)) {
      warn("row_invalid");
      excludedRowCount++;
      continue;
    }
    if (!isExperimentTerminalStatus(raw["status"])) {
      warn("row_status_unknown");
      excludedRowCount++;
      continue;
    }
    const runId = readExperimentId(raw["runId"]);
    const rowBatchId = readExperimentId(raw["batchId"]);
    if (runId === null) {
      warn("row_invalid");
      excludedRowCount++;
      continue;
    }
    observedTerminalIds.add(runId);
    // Legacy rows may omit mode; an explicit contradiction cannot become paper data.
    if (raw["mode"] !== undefined && raw["mode"] !== "paper_only") {
      warn("row_invalid");
      excludedRowCount++;
      continue;
    }
    if (batchId !== null && rowBatchId !== batchId) {
      warn("row_batch_mismatch");
      excludedRowCount++;
      continue;
    }
    const row = projectExperimentRow(raw, runId, rowBatchId, raw["status"],
      batchId === null ? "unbound_stored" : "bound_manifest", warn,
      raw["batchId"] != null && rowBatchId === null);
    if (terminalRows.has(runId)) {
      warn("row_duplicate");
      excludedRowCount++;
    }
    // Use returned source order, not timestamps: the last valid terminal record wins.
    terminalRows.set(runId, row);
    terminalRecordsById.set(runId, raw);
  }

  const rows = [...terminalRows.values()];
  const projectedTerminalCount = rows.length;
  if (batchId === null) warn("unbound_rows", projectedTerminalCount);
  let projectedActiveCount = 0;
  const active = value["activeRun"];
  if (active !== null && active !== undefined) {
    const activeId = isRecord(active) ? readExperimentId(active["runId"]) : null;
    if (!isRecord(active) || activeId === null ||
      (active["mode"] !== undefined && active["mode"] !== "paper_only")) {
      warn("active_run_invalid");
    } else if (observedTerminalIds.has(activeId)) {
      warn("active_run_terminal_duplicate");
    } else if (batchId === null) {
      warn("active_run_unbound");
    } else if (batchStatus !== "running") {
      warn("active_run_inconsistent");
    } else {
      rows.unshift(projectExperimentRow(active, activeId, batchId, "running", "bound_manifest", warn));
      projectedActiveCount = 1;
    }
  }

  const view: ExperimentListView = {
    mode: "paper_only",
    readOnly: true,
    sourceLabel: "API-selected/latest-unverified",
    endpointStatus: value["status"],
    aggregateStatus,
    batchId,
    batchStatus,
    batchStartedAt,
    batchUpdatedAt,
    batchCompletedAt,
    requestedRunCount,
    manifestCounts,
    riskProfile,
    decisionProviderMode,
    initialCashKrw,
    count: value["count"],
    totalCount: value["totalCount"],
    statusCounts,
    unknownStatusCount,
    corruptLineCount: value["corruptLineCount"],
    activeRunProgressStatus,
    rows,
    projectedTerminalCount,
    projectedActiveCount,
    excludedRowCount,
    warnings: [...warningCounts].map(([code, count]) => ({ code, count }))
  };
  return { view, terminalRecordsById };
}

function projectExperimentRow(
  raw: Record<string, unknown>,
  runId: string,
  batchId: string | null,
  status: ExperimentListRow["status"],
  provenance: ExperimentListRow["provenance"],
  warn: (code: ExperimentListWarningCode, count?: number) => void,
  invalidMetadata = false
): ExperimentListRow {
  let malformed = invalidMetadata;
  const optional = <T>(value: unknown, read: (input: unknown) => T | null): T | null => {
    const parsed = read(value);
    if (value != null && parsed === null) malformed = true;
    return parsed;
  };
  const record = (value: unknown): Record<string, unknown> => {
    if (value != null && !isRecord(value)) malformed = true;
    return isRecord(value) ? value : {};
  };
  const summary = status === "running" ? {} : record(raw["summary"]);
  const marketRegime = record(raw["marketRegime"]);
  const window = record(raw["window"]);
  let windowStartAt = optional(window["startAt"], readExperimentTimestamp);
  let windowEndAt = optional(window["endAt"], readExperimentTimestamp);
  if (windowStartAt === null || windowEndAt === null ||
    Date.parse(windowStartAt) > Date.parse(windowEndAt)) {
    if (window["startAt"] != null || window["endAt"] != null) malformed = true;
    windowStartAt = null;
    windowEndAt = null;
  }
  const terminalTime = (key: string) => status === "running"
    ? null : optional(raw[key], readExperimentTimestamp);
  const row: ExperimentListRow = {
    runId,
    batchId,
    status,
    provenance,
    detailHref: `/dashboard/lab/runs/${encodeURIComponent(runId)}`,
    runIndex: optional(raw["runIndex"], readExperimentCount),
    startedAt: optional(raw["startedAt"], readExperimentTimestamp),
    completedAt: terminalTime("completedAt"),
    failedAt: terminalTime("failedAt"),
    skippedAt: terminalTime("skippedAt"),
    windowStartAt,
    windowEndAt,
    marketRegimeLabel: optional(marketRegime["label"], readExperimentLabel),
    totalReturnRatio: optional(summary["totalReturnRatio"], readExperimentFiniteNumber),
    finalVirtualNetWorthKrw: optional(summary["finalVirtualNetWorthKrw"], readExperimentNonnegativeNumber),
    tradeCount: optional(summary["tradeCount"], readExperimentCount),
    rejectedCount: optional(summary["rejectedCount"], readExperimentCount),
    aiDecisionFailureCount: optional(summary["aiDecisionFailureCount"], readExperimentCount)
  };
  if (malformed) warn("row_metadata_invalid");
  return row;
}

function isExperimentTerminalStatus(value: unknown): value is ExperimentTerminalStatus {
  return value === "completed" || value === "completed_with_failures" ||
    value === "failed" || value === "skipped";
}

function isExperimentEndpointStatus(value: unknown): value is ExperimentListView["endpointStatus"] {
  return value === "ok" || value === "running" || value === "missing" ||
    value === "blocked" || value === "degraded";
}

function readExperimentSourceStatus(value: unknown): ExperimentListView["aggregateStatus"] {
  return value === "ok" || value === "missing" || value === "corrupt" ? value : null;
}

function isExperimentCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readExperimentCount(value: unknown): number | null {
  return isExperimentCount(value) ? value : null;
}

function readExperimentFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readExperimentNonnegativeNumber(value: unknown): number | null {
  const number = readExperimentFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function readExperimentId(value: unknown): string | null {
  // UI projection limit for one ASCII filesystem component; the backend does not
  // impose this cap on raw IDs. Preserve accepted identities exactly, never truncate.
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(value)
    ? value : null;
}

function readExperimentLabel(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
    ? value : null;
}

function readExperimentTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null || !Number.isFinite(Date.parse(value))) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59
    ? value : null;
}

export function readOperationsApiConfig(): { baseUrl: string; label: string } {
  const value =
    [
      process.env.DASHBOARD_OPS_API_BASE_URL,
      process.env.OPS_API_BASE_URL,
      DEFAULT_API_BASE_URL
    ]
      .map((candidate) => candidate?.trim())
      .find((candidate): candidate is string => Boolean(candidate)) ??
    DEFAULT_API_BASE_URL;
  const baseUrl = value.replace(/\/+$/, "");
  return {
    baseUrl,
    label:
      baseUrl === DEFAULT_API_BASE_URL
        ? "default local operations endpoint"
        : "configured operations endpoint"
  };
}

async function fetchBatchReplayRunDetail(
  apiBaseUrl: string,
  endpoint: string,
  runId: string
): Promise<ViewModelResult<RunDetailView>> {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      cache: "no-store",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        status: "offline",
        endpoint,
        fetchedAt,
        data: null,
        message: `Local Operations API returned HTTP ${response.status}`
      };
    }

    const data: unknown = await response.json();
    const view = normalizeRunDetailView(data, runId);
    if (view === null) {
      return {
        status: "invalid",
        endpoint,
        fetchedAt,
        data: null,
        message: "Batch replay run response did not match the dashboard contract"
      };
    }

    return {
      status: "ok",
      endpoint,
      fetchedAt,
      data: view
    };
  } catch (error) {
    return {
      status: "offline",
      endpoint,
      fetchedAt,
      data: null,
      message:
        error instanceof Error
          ? error.message
          : "Local Operations API request failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViewModel<T>(
  apiBaseUrl: string,
  endpoint: string,
  expectedViewModel: DashboardViewModelName,
  validator: (value: unknown) => value is T,
  normalize: (value: unknown) => unknown = (value) => value
): Promise<ViewModelResult<T>> {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      cache: "no-store",
      headers: {
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        status: "offline",
        endpoint,
        fetchedAt,
        data: null,
        message: `Local Operations API returned HTTP ${response.status}`
      };
    }

    const data: unknown = await response.json();
    const normalizedData = normalize(data);
    if (
      !isViewModelPayload(normalizedData, expectedViewModel) ||
      !validator(normalizedData)
    ) {
      return {
        status: "invalid",
        endpoint,
        fetchedAt,
        data: null,
        message: "ViewModel response did not match the dashboard contract"
      };
    }

    return {
      status: "ok",
      endpoint,
      fetchedAt,
      data: normalizedData
    };
  } catch (error) {
    return {
      status: "offline",
      endpoint,
      fetchedAt,
      data: null,
      message:
        error instanceof Error
          ? error.message
          : "Local Operations API request failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRunDetailView(
  value: unknown,
  runId: string
): RunDetailView | null {
  if (
    !isRecord(value) ||
    value["mode"] !== "paper_only" ||
    value["readOnly"] !== true ||
    !Array.isArray(value["runs"])
  ) {
    return null;
  }

  const rawArtifacts = isRecord(value["latestRunArtifacts"])
    ? value["latestRunArtifacts"]
    : null;
  const artifacts = normalizeBatchReplayRunArtifacts(rawArtifacts);
  const batchId = readNullableString(value["batchId"]);
  const batchStatus = readNullableString(value["batchStatus"]);
  const activeRun = normalizeActiveBatchReplayRunSummary(
    value["activeRun"],
    {
      artifacts,
      batchId,
      batchStatus
    }
  );
  const runs = value["runs"]
    .map(normalizeBatchReplayRunSummary)
    .filter((run): run is BatchReplayRunSummary => run !== null);
  const selectedRun = normalizeBatchReplayRunSummary(value["selectedRun"]);
  // An exact child link from the list must resolve to the same last eligible
  // terminal source record. Keep detail fields and all legacy lookup fallbacks.
  const exactTerminal = normalizeBatchReplayRunSummary(
    projectExperimentListSource(value)?.terminalRecordsById.get(runId)
  );
  const run = exactTerminal ?? findRunDetailTargetRun({
    activeRun,
    batchId,
    batchStatus,
    lookupId: runId,
    runs,
    selectedRun
  });
  const resolvedRunId = run?.runId ?? runId;
  const latestArtifactsRunId = artifacts?.runId ?? null;
  const warnings =
    artifacts !== null &&
    latestArtifactsRunId !== null &&
    latestArtifactsRunId !== resolvedRunId
      ? [
          "latest run artifacts belong to a different run; detail artifacts are unavailable for this run"
        ]
      : [];

  return {
    mode: "paper_only",
    readOnly: true,
    runId: resolvedRunId,
    requestedId: runId,
    endpointStatus: readNullableString(value["status"]),
    simulationObservation: normalizeSimulationObservation(value["simulationObservation"], runId),
    batchId,
    batchStatus,
    sourceRunsPath: readNullableString(value["sourceRunsPath"]),
    run,
    artifacts: latestArtifactsRunId === resolvedRunId ? artifacts : null,
    latestArtifactsRunId,
    warnings,
    status: run === null ? "missing" : "ok"
  };
}

function normalizeSimulationObservation(value: unknown, requestedId: string): SimulationObservationView {
  if (value === undefined) return { status: "unsupported" };
  if (value === null) return { status: "not_requested" };
  const invalid = { status: "invalid" as const };
  if (!isRecord(value) || value["simulationRunId"] !== requestedId) return invalid;
  if (value["status"] === "missing" || value["status"] === "invalid" || value["status"] === "unavailable") return { status: value["status"] };
  if (value["status"] !== "available" || value["schemaVersion"] !== "paper_simulation_observation.v1" ||
      value["batchId"] !== requestedId || !/^paper_sim_\d{17}_[A-Za-z0-9_-]{1,32}(?![\s\S])/.test(requestedId)) return invalid;
  const acceptedAt = value["acceptedAt"];
  const validTimestamp = (time: unknown): time is string => typeof time === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(time) && Number.isFinite(Date.parse(time)) && new Date(time).toISOString().slice(0, 19) === time.slice(0, 19);
  if (!validTimestamp(acceptedAt)) return invalid;
  const outcome = value["outcome"], failure = value["runnerFailure"];
  if (outcome === "unknown" && failure === null) return { status: "available", simulationRunId: requestedId, acceptedAt, outcome, runnerFailure: null };
  if (outcome !== "runner_failed" || !isRecord(failure) || failure["reasonCode"] !== "runner_rejected" || !validTimestamp(failure["observedAt"]) || Date.parse(failure["observedAt"]) < Date.parse(acceptedAt)) return invalid;
  return { status: "available", simulationRunId: requestedId, acceptedAt, outcome, runnerFailure: { observedAt: failure["observedAt"], reasonCode: "runner_rejected" } };
}

function findRunDetailTargetRun({
  activeRun,
  batchId,
  batchStatus,
  lookupId,
  runs,
  selectedRun
}: {
  activeRun: BatchReplayRunSummary | null;
  batchId: string | null;
  batchStatus: string | null;
  lookupId: string;
  runs: BatchReplayRunSummary[];
  selectedRun: BatchReplayRunSummary | null;
}): BatchReplayRunSummary | null {
  const directRun = runs.find((candidate) => candidate.runId === lookupId);
  if (directRun !== undefined) {
    return directRun;
  }
  if (
    selectedRun !== null &&
    (selectedRun.runId === lookupId || selectedRun.batchId === lookupId)
  ) {
    return selectedRun;
  }
  if (activeRun !== null && activeRun.runId === lookupId) {
    return activeRun;
  }
  if (
    activeRun !== null &&
    batchId === lookupId &&
    (batchStatus === "running" || runs.length === 0)
  ) {
    return activeRun;
  }
  return (
    [...runs].reverse().find((candidate) => candidate.batchId === lookupId) ??
    (activeRun !== null && batchId === lookupId ? activeRun : null) ??
    null
  );
}

function normalizeActiveBatchReplayRunSummary(
  value: unknown,
  context: {
    artifacts: BatchReplayRunArtifacts | null;
    batchId: string | null;
    batchStatus: string | null;
  }
): BatchReplayRunSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const runId = readString(value["runId"]) ?? context.artifacts?.runId ?? null;
  if (runId === null) {
    return null;
  }
  const marketRegime = isRecord(value["marketRegime"]) ? value["marketRegime"] : {};
  const status =
    readString(value["status"]) ??
    context.artifacts?.runStatus ??
    (context.batchStatus === "running" ? "running" : "active");

  return {
    runId,
    batchId: context.batchId,
    status,
    runIndex: readNullableNumber(value["runIndex"]),
    startedAt: readNullableString(value["startedAt"]),
    completedAt: null,
    failedAt: null,
    skippedAt: null,
    marketRegimeLabel: readNullableString(marketRegime["label"]),
    totalReturnRatio: null,
    finalVirtualNetWorthKrw: null,
    tradeCount: null,
    rejectedCount: null,
    aiDecisionFailureCount: null,
    storageBaseDir: readNullableString(value["storageBaseDir"]),
    reportPath: null,
    error: null,
    skipReason: null
  };
}

function normalizeBatchReplayRunSummary(
  value: unknown
): BatchReplayRunSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const runId = readString(value["runId"]);
  const status = readString(value["status"]);
  if (runId === null || status === null) {
    return null;
  }
  const summary = isRecord(value["summary"]) ? value["summary"] : {};
  const marketRegime = isRecord(value["marketRegime"]) ? value["marketRegime"] : {};

  return {
    runId,
    batchId: readNullableString(value["batchId"]),
    status,
    runIndex: readNullableNumber(value["runIndex"]),
    startedAt: readNullableString(value["startedAt"]),
    completedAt: readNullableString(value["completedAt"]),
    failedAt: readNullableString(value["failedAt"]),
    skippedAt: readNullableString(value["skippedAt"]),
    marketRegimeLabel: readNullableString(marketRegime["label"]),
    totalReturnRatio: readNullableNumber(summary["totalReturnRatio"]),
    finalVirtualNetWorthKrw: readNullableNumber(
      summary["finalVirtualNetWorthKrw"]
    ),
    tradeCount: readNullableNumber(summary["tradeCount"]),
    rejectedCount: readNullableNumber(summary["rejectedCount"]),
    aiDecisionFailureCount: readNullableNumber(
      summary["aiDecisionFailureCount"]
    ),
    storageBaseDir: readNullableString(value["storageBaseDir"]),
    reportPath: readNullableString(value["reportPath"]),
    error: readNullableString(value["error"]),
    skipReason: readNullableString(value["skipReason"])
  };
}

function normalizeBatchReplayRunArtifacts(
  value: Record<string, unknown> | null
): BatchReplayRunArtifacts | null {
  if (value === null) {
    return null;
  }
  const status = readString(value["status"]);
  if (status === null) {
    return null;
  }
  const report = isRecord(value["report"]) ? value["report"] : null;
  const progress = isRecord(value["progress"]) ? value["progress"] : null;
  const currentPortfolio =
    progress !== null && isRecord(progress["currentPortfolio"])
      ? progress["currentPortfolio"]
      : null;

  return {
    status,
    runId: readNullableString(value["runId"]),
    runStatus: readNullableString(value["runStatus"]),
    reportStatus: readJsonReadStatus(value["reportStatus"]),
    progressStatus: readJsonReadStatus(value["progressStatus"]),
    decisionsStatus: readJsonReadStatus(value["decisionsStatus"]),
    riskDecisionsStatus: readJsonReadStatus(value["riskDecisionsStatus"]),
    tradesStatus: readJsonReadStatus(value["tradesStatus"]),
    reportTitle: report === null ? null : readNullableString(report["title"]),
    progressStatusLabel:
      progress === null ? null : readNullableString(progress["status"]),
    simulatedAt: progress === null ? null : readNullableString(progress["simulatedAt"]),
    completedTickCount:
      progress === null ? null : readNullableNumber(progress["completedTickCount"]),
    tickCount: progress === null ? null : readNullableNumber(progress["tickCount"]),
    decisionCount: readNumberOrZero(value["decisionCount"]),
    totalDecisionCount: readNumberOrZero(value["totalDecisionCount"]),
    riskDecisionCount: readNumberOrZero(value["riskDecisionCount"]),
    totalRiskDecisionCount: readNumberOrZero(value["totalRiskDecisionCount"]),
    tradeCount: readNumberOrZero(value["tradeCount"]),
    totalTradeCount: readNumberOrZero(value["totalTradeCount"]),
    rejectedCount: progress === null ? null : readNullableNumber(progress["rejectedCount"]),
    currentVirtualNetWorthKrw:
      currentPortfolio === null
        ? null
        : readNullableNumber(currentPortfolio["virtualNetWorthKrw"]),
    currentCashKrw:
      currentPortfolio === null
        ? null
        : readNullableNumber(currentPortfolio["cashKrw"]),
    currentPositionCount:
      currentPortfolio === null
        ? null
        : readNullableNumber(currentPortfolio["positionCount"])
  };
}

function isViewModelPayload(
  value: unknown,
  expectedViewModel: DashboardViewModelName
): value is Record<string, unknown> & {
  mode: "paper_only";
  readOnly: true;
  viewModel: DashboardViewModelName;
} {
  return (
    isRecord(value) &&
    value["mode"] === "paper_only" &&
    value["readOnly"] === true &&
    value["viewModel"] === expectedViewModel
  );
}

function isLiveReadinessViewModel(
  value: unknown
): value is LiveReadinessViewModel {
  if (!isViewModelPayload(value, "live-readiness")) {
    return false;
  }
  return (
    typeof value.generatedAt === "string" &&
    isLiveReadinessEnvironment(value.environment) &&
    isLiveReadinessOfficialApi(value.officialApi) &&
    isLiveReadinessOrderGateway(value.orderGateway) &&
    Array.isArray(value.checks) &&
    value.checks.every(isLiveReadinessCheck) &&
    isStringArray(value.warnings) &&
    isViewModelStatus(value.status)
  );
}

function isPolicyComplianceViewModel(
  value: unknown
): value is PolicyComplianceViewModel {
  if (!isViewModelPayload(value, "portfolio-compliance")) {
    return false;
  }
  return (
    isNullableString(value.asOf) &&
    isNullableString(value.portfolioId) &&
    isNumber(value.virtualNetWorthKrw) &&
    (value.policyStatus === "active" ||
      value.policyStatus === "missing" ||
      value.policyStatus === "invalid") &&
    (value.activePolicy === null || isActivePolicySummary(value.activePolicy)) &&
    (value.policyStatus === "active") === (value.activePolicy !== null) &&
    Array.isArray(value.bucketCompliance) &&
    value.bucketCompliance.every(isBucketComplianceRow) &&
    isCashCompliance(value.cashCompliance) &&
    isHedgeCompliance(value.hedgeCompliance) &&
    isExposureCompliance(value.exposureCompliance) &&
    isRiskGateSummary(value.riskGateSummary) &&
    isComplianceAnalytics(value.complianceAnalytics) &&
    isSourceStatus(value.sourceStatus) &&
    isStringArray(value.warnings) &&
    isViewModelStatus(value.status)
  );
}

function isActivePolicySummary(value: unknown): value is ActivePolicySummary {
  return (
    isRecord(value) &&
    typeof value["runtimePolicyRecordId"] === "string" &&
    typeof value["policyId"] === "string" &&
    typeof value["version"] === "string" &&
    typeof value["policyHash"] === "string" &&
    typeof value["activationId"] === "string" &&
    typeof value["effectiveFrom"] === "string"
  );
}

function isStrategyBucketTestLabViewModel(
  value: unknown
): value is StrategyBucketTestLabViewModel {
  if (!isViewModelPayload(value, "strategy-test-lab")) {
    return false;
  }
  return (
    typeof value.policyId === "string" &&
    value.policyStatus === "missing" &&
    Array.isArray(value.supportedBuckets) &&
    value.supportedBuckets.every(isStrategyBucketCapability) &&
    Array.isArray(value.activeTests) &&
    value.activeTests.every(isStrategyBucketTestSummary) &&
    Array.isArray(value.recentResults) &&
    value.recentResults.every(isStrategyBucketResultSummary) &&
    isStrategyComparison(value.comparison) &&
    isSourceStatus(value.sourceStatus) &&
    value.status === "ok"
  );
}

export function isStrategyBucketTestProgressViewModel(
  value: unknown
): value is StrategyBucketTestProgressViewModel {
  if (!isViewModelPayload(value, "strategy-test-progress")) {
    return false;
  }
  return (
    typeof value.testId === "string" &&
    (value.test === null || isStrategyBucketTestSummary(value.test)) &&
    isSourceStatus(value.sourceStatus) &&
    value.storageMutationEnabled === false &&
    value.liveTradingEnabled === false &&
    value.orderPlacementEnabled === false &&
    value.replayRunnerStarted === false &&
    (value.status === "ok" ||
      value.status === "missing" ||
      value.status === "invalid")
  );
}

function isRiskGateTraceViewModel(
  value: unknown
): value is RiskGateTraceViewModel {
  if (!isViewModelPayload(value, "risk-gate-trace")) {
    return false;
  }
  return (
    (value.sourceFamily === "historical_replay" ||
      value.sourceFamily === "virtual") &&
    Array.isArray(value.traces) &&
    value.traces.every(isRiskGateTraceRow) &&
    isNumber(value.count) &&
    isNumber(value.totalDecisionItemCount) &&
    isSourceStatus(value.sourceStatus)
  );
}

function isValidationLabViewModel(
  value: unknown
): value is ValidationLabViewModel {
  if (!isViewModelPayload(value, "validation-lab")) {
    return false;
  }
  return (
    isValidationStatus(value.status) &&
    isValidationStatus(value.aggregateReportStatus) &&
    isNullableString(value.sourceGeneratedAt) &&
    isStringArray(value.warnings) &&
    isSharpeValidationView(value.sharpeValidation) &&
    isCpcvPboValidationView(value.cpcvPboValidation) &&
    isMetaLabelEvaluationView(value.metaLabelEvaluation) &&
    isCostRiskWarningView(value.costRiskWarning) &&
    isValidationCandidateComparison(value.candidateComparison) &&
    isRecord(value.executionAssumptions) &&
    value.executionAssumptions["paperOnly"] === true &&
    value.executionAssumptions["liveTradingEnabled"] === false &&
    value.executionAssumptions["orderPlacementEnabled"] === false
  );
}

function isDashboardAuditViewModel(
  value: unknown
): value is DashboardAuditViewModel {
  if (!isViewModelPayload(value, "audit")) {
    return false;
  }
  return (
    Array.isArray(value.events) &&
    value.events.every(isDashboardAuditEventRow) &&
    isNumber(value.count) &&
    isNumber(value.totalCount) &&
    isNumber(value.rejectedActionCount) &&
    isNumber(value.failureTraceCount) &&
    isNumberRecord(value.eventTypeCounts) &&
    isNumberRecord(value.actorCounts) &&
    isNullableString(value.latestEventAt) &&
    isSourceStatus(value.sourceStatus) &&
    isStringArray(value.warnings) &&
    isViewModelStatus(value.status)
  );
}

function isDashboardAuditEventRow(
  value: unknown
): value is DashboardAuditEventRow {
  return (
    isRecord(value) &&
    typeof value["eventId"] === "string" &&
    typeof value["eventType"] === "string" &&
    typeof value["actor"] === "string" &&
    typeof value["summary"] === "string" &&
    isStringArray(value["maskedRefs"]) &&
    typeof value["createdAt"] === "string" &&
    (value["severity"] === "info" ||
      value["severity"] === "warning" ||
      value["severity"] === "failure") &&
    (value["category"] === "risk_gate" ||
      value["category"] === "paper_policy" ||
      value["category"] === "strategy_test" ||
      value["category"] === "simulation" ||
      value["category"] === "market_data" ||
      value["category"] === "system") &&
    typeof value["rejectedAction"] === "boolean" &&
    typeof value["failureTrace"] === "boolean"
  );
}

function isLiveReadinessEnvironment(
  value: unknown
): value is LiveReadinessViewModel["environment"] {
  return (
    isRecord(value) &&
    typeof value["tradingEnabled"] === "boolean" &&
    typeof value["brokerProvider"] === "string" &&
    typeof value["aiDecisionMode"] === "string" &&
    typeof value["aiDecisionEnabled"] === "boolean"
  );
}

function isLiveReadinessOfficialApi(
  value: unknown
): value is LiveReadinessViewModel["officialApi"] {
  return (
    isRecord(value) &&
    typeof value["authEnabled"] === "boolean" &&
    (value["authStatus"] === "disabled" ||
      value["authStatus"] === "ready" ||
      value["authStatus"] === "invalid") &&
    typeof value["baseUrl"] === "string" &&
    typeof value["clientIdConfigured"] === "boolean" &&
    typeof value["clientCredentialConfigured"] === "boolean" &&
    isStringArray(value["issueCodes"]) &&
    (value["snapshotStatus"] === "disabled" ||
      value["snapshotStatus"] === "configured" ||
      value["snapshotStatus"] === "invalid")
  );
}

function isLiveReadinessOrderGateway(
  value: unknown
): value is LiveReadinessViewModel["orderGateway"] {
  return (
    isRecord(value) &&
    value["liveOrderGatewayStatus"] === "disabled" &&
    value["orderRouterConnectionStatus"] === "not_connected" &&
    value["mcpMutationToolExposureStatus"] === "not_exposed" &&
    value["orderPlacementEnabled"] === false &&
    value["rawTossctlExecutionEnabled"] === false &&
    value["rawCodexExecEnabled"] === false
  );
}

function isLiveReadinessCheck(value: unknown): value is LiveReadinessCheck {
  return (
    isRecord(value) &&
    (value["key"] === "trading_enabled" ||
      value["key"] === "broker_provider" ||
      value["key"] === "ai_decision_mode" ||
      value["key"] === "official_auth_config" ||
      value["key"] === "read_only_account_snapshot" ||
      value["key"] === "live_order_gateway" ||
      value["key"] === "order_router_connection" ||
      value["key"] === "mcp_mutation_tool_exposure") &&
    typeof value["label"] === "string" &&
    typeof value["value"] === "string" &&
    (value["tone"] === "ok" ||
      value["tone"] === "watch" ||
      value["tone"] === "blocked") &&
    typeof value["detail"] === "string"
  );
}

function isBucketComplianceRow(value: unknown): value is BucketComplianceRow {
  return (
    isRecord(value) &&
    isStrategyBucket(value["bucket"]) &&
    isNullableNumber(value["minWeightRatio"]) &&
    isNullableNumber(value["targetWeightRatio"]) &&
    isNullableNumber(value["maxWeightRatio"]) &&
    isNumber(value["currentWeightRatio"]) &&
    isNullableNumber(value["gapRatio"]) &&
    isNumber(value["exposureKrw"]) &&
    isNullableNumber(value["turnoverRatio"]) &&
    (value["status"] === "ok" ||
      value["status"] === "under" ||
      value["status"] === "over" ||
      value["status"] === "missing_policy") &&
    isNullableString(value["primaryReason"])
  );
}

function isCashCompliance(value: unknown): value is PolicyComplianceViewModel["cashCompliance"] {
  return (
    isRecord(value) &&
    typeof value["marketRegime"] === "string" &&
    isNumber(value["targetCashRatio"]) &&
    isNumber(value["currentCashRatio"]) &&
    isNumber(value["currentCashKrw"]) &&
    isNumber(value["minimumCashReserveKrw"]) &&
    isNumber(value["cashGapKrw"]) &&
    typeof value["ruleSource"] === "string" &&
    (value["status"] === "ok" ||
      value["status"] === "under_reserved" ||
      value["status"] === "missing") &&
    isNumber(value["rejectedCount"]) &&
    isNumberRecord(value["rejectCodes"])
  );
}

function isHedgeCompliance(
  value: unknown
): value is PolicyComplianceViewModel["hedgeCompliance"] {
  return (
    isRecord(value) &&
    (typeof value["policyEnabled"] === "boolean" ||
      value["policyEnabled"] === null) &&
    typeof value["hedgeEnabled"] === "boolean" &&
    isNumber(value["hedgeExposureKrw"]) &&
    isNumber(value["hedgeExposureRatio"]) &&
    isNumber(value["grossExposureKrw"]) &&
    isNumber(value["netDownsideExposureKrw"]) &&
    isNullableNumber(value["estimatedDownsideReductionKrw"]) &&
    isNumber(value["hedgeCostKrw"]) &&
    isNumber(value["hedgeTradeCount"]) &&
    isNumber(value["rejectedCount"]) &&
    isNumberRecord(value["rejectCodes"]) &&
    (value["status"] === "ok" ||
      value["status"] === "ineffective" ||
      value["status"] === "over_hedged" ||
      value["status"] === "missing")
  );
}

function isExposureCompliance(
  value: unknown
): value is PolicyComplianceViewModel["exposureCompliance"] {
  return (
    isRecord(value) &&
    isNumber(value["grossExposureKrw"]) &&
    isNumber(value["grossExposureRatio"]) &&
    Array.isArray(value["byMarket"]) &&
    value["byMarket"].every(isExposureBucket) &&
    Array.isArray(value["byStrategyBucket"]) &&
    value["byStrategyBucket"].every(isExposureBucket) &&
    (value["maxSymbolExposure"] === null ||
      isExposureBucket(value["maxSymbolExposure"])) &&
    isViewModelStatus(value["status"])
  );
}

function isRiskGateSummary(
  value: unknown
): value is PolicyComplianceViewModel["riskGateSummary"] {
  return (
    isRecord(value) &&
    isNumber(value["decisionRecordCount"]) &&
    isNumber(value["decisionItemCount"]) &&
    isNumber(value["actionableDecisionCount"]) &&
    isNumber(value["simulatedTradeCount"]) &&
    isNumber(value["rejectedCount"]) &&
    isNumberRecord(value["rejectCodes"])
  );
}

function isComplianceAnalytics(
  value: unknown
): value is ComplianceAnalyticsView {
  if (!isRecord(value)) {
    return false;
  }

  const strategyBucket = value["strategyBucket"];
  const cashReserve = value["cashReserve"];
  const hedgeEffectiveness = value["hedgeEffectiveness"];
  const costTurnover = value["costTurnover"];

  return (
    isRecord(strategyBucket) &&
    isNumber(strategyBucket["occupiedBucketCount"]) &&
    isNumber(strategyBucket["missingPolicyTargetCount"]) &&
    (strategyBucket["largestBucket"] === null ||
      isExposureBucket(strategyBucket["largestBucket"])) &&
    isNullableNumber(strategyBucket["concentrationRatio"]) &&
    isViewModelStatus(strategyBucket["status"]) &&
    isRecord(cashReserve) &&
    isNumber(cashReserve["currentCashKrw"]) &&
    isNumber(cashReserve["currentCashRatio"]) &&
    isNumber(cashReserve["targetCashRatio"]) &&
    isNumber(cashReserve["minimumCashReserveKrw"]) &&
    isNumber(cashReserve["cashGapKrw"]) &&
    (cashReserve["reserveStatus"] === "ok" ||
      cashReserve["reserveStatus"] === "under_reserved" ||
      cashReserve["reserveStatus"] === "missing") &&
    typeof cashReserve["marketRegime"] === "string" &&
    typeof cashReserve["ruleSource"] === "string" &&
    isRecord(hedgeEffectiveness) &&
    isNullableNumber(hedgeEffectiveness["hedgeCoverageRatio"]) &&
    isNullableNumber(hedgeEffectiveness["netDownsideExposureRatio"]) &&
    isNullableNumber(hedgeEffectiveness["costDragRatio"]) &&
    (hedgeEffectiveness["status"] === "ok" ||
      hedgeEffectiveness["status"] === "ineffective" ||
      hedgeEffectiveness["status"] === "over_hedged" ||
      hedgeEffectiveness["status"] === "missing") &&
    isRecord(costTurnover) &&
    isNumber(costTurnover["totalTradeAmountKrw"]) &&
    isNumber(costTurnover["totalCostKrw"]) &&
    isNullableNumber(costTurnover["totalTurnoverRatio"]) &&
    isNullableNumber(costTurnover["totalCostDragRatio"]) &&
    Array.isArray(costTurnover["byStrategyBucket"]) &&
    costTurnover["byStrategyBucket"].every(isBucketCostTurnoverRow)
  );
}

function isBucketCostTurnoverRow(
  value: unknown
): value is BucketCostTurnoverRow {
  return (
    isRecord(value) &&
    isStrategyBucket(value["bucket"]) &&
    isNumber(value["tradeCount"]) &&
    isNumber(value["grossTradeAmountKrw"]) &&
    isNumber(value["totalCostKrw"]) &&
    isNullableNumber(value["turnoverRatio"]) &&
    isNullableNumber(value["costDragRatio"])
  );
}

function isStrategyBucketCapability(
  value: unknown
): value is StrategyBucketTestCapability {
  return (
    isRecord(value) &&
    isStrategyBucket(value["bucket"]) &&
    typeof value["canRunIsolatedReplay"] === "boolean" &&
    isStringArray(value["requiredPolicyFields"]) &&
    typeof value["defaultHoldingPeriodHint"] === "string" &&
    isNullableString(value["disabledReason"])
  );
}

function isStrategyBucketResultSummary(
  value: unknown
): value is StrategyBucketTestResultSummary {
  return (
    isRecord(value) &&
    typeof value["testId"] === "string" &&
    isStrategyBucket(value["bucket"]) &&
    (value["status"] === "completed" ||
      value["status"] === "failed" ||
      value["status"] === "cancelled") &&
    (value["validationSplitRole"] === null ||
      value["validationSplitRole"] === "train" ||
      value["validationSplitRole"] === "validation" ||
      value["validationSplitRole"] === "test") &&
    isNullableNumber(value["totalReturnRatio"]) &&
    isNullableNumber(value["maxDrawdownRatio"]) &&
    isNullableNumber(value["turnoverRatio"]) &&
    isNullableNumber(value["costDragRatio"]) &&
    isNullableNumber(value["riskRejectRate"]) &&
    isNullableNumber(value["providerFailureRate"]) &&
    isStringArray(value["warnings"])
  );
}

function isStrategyBucketTestSummary(
  value: unknown
): value is StrategyBucketTestSummary {
  return (
    isRecord(value) &&
    typeof value["testId"] === "string" &&
    isStrategyBucket(value["bucket"]) &&
    isStrategyBucketTestStatus(value["status"]) &&
    isNullableString(value["startedAt"]) &&
    isNullableString(value["completedAt"]) &&
    isNullableString(value["runId"]) &&
    typeof value["configHash"] === "string" &&
    isStrategyBucketTestProgress(value["progress"]) &&
    isStrategyBucketTestHeartbeat(value["heartbeat"])
  );
}

function isStrategyBucketTestProgress(
  value: unknown
): value is StrategyBucketTestSummary["progress"] {
  return (
    isRecord(value) &&
    isStrategyBucketTestPhase(value["phase"]) &&
    isNullableNumber(value["progressRatio"]) &&
    isNumber(value["completedPacketCount"]) &&
    isNullableNumber(value["totalPacketCount"]) &&
    isNumber(value["decisionCount"]) &&
    isNumber(value["riskApprovedCount"]) &&
    isNumber(value["riskRejectedCount"]) &&
    isNumber(value["simulatedTradeCount"]) &&
    isNumber(value["providerFailureCount"]) &&
    isNullableString(value["latestMessage"]) &&
    isNullableString(value["latestAuditEventRef"]) &&
    typeof value["updatedAt"] === "string"
  );
}

function isStrategyBucketTestHeartbeat(
  value: unknown
): value is StrategyBucketTestSummary["heartbeat"] {
  return (
    isRecord(value) &&
    (value["status"] === "fresh" ||
      value["status"] === "stale" ||
      value["status"] === "missing") &&
    isNullableString(value["lastSeenAt"]) &&
    isNumber(value["staleAfterSeconds"])
  );
}

function isStrategyComparison(
  value: unknown
): value is StrategyBucketTestLabViewModel["comparison"] {
  return (
    isRecord(value) &&
    Array.isArray(value["rows"]) &&
    value["rows"].every(isStrategyBucketResultSummary) &&
    (value["baselineBucket"] === null || isStrategyBucket(value["baselineBucket"])) &&
    (value["portfolioBaseline"] === null ||
      isStrategyBucketPortfolioBaseline(value["portfolioBaseline"])) &&
    Array.isArray(value["portfolioDeltaRows"]) &&
    value["portfolioDeltaRows"].every(isStrategyBucketPortfolioDeltaRow) &&
    isNullableString(value["selectionWarning"])
  );
}

function isStrategyBucketPortfolioBaseline(
  value: unknown
): value is StrategyBucketPortfolioBaseline {
  return (
    isRecord(value) &&
    value["source"] === "batch_aggregate_overall" &&
    isNumber(value["runCount"]) &&
    isNumber(value["completedCount"]) &&
    isNumber(value["returnSampleCount"]) &&
    isNullableNumber(value["averageTotalReturnRatio"])
  );
}

function isStrategyBucketPortfolioDeltaRow(
  value: unknown
): value is StrategyBucketPortfolioDeltaRow {
  return (
    isRecord(value) &&
    typeof value["testId"] === "string" &&
    isStrategyBucket(value["bucket"]) &&
    isNullableNumber(value["totalReturnDeltaRatio"])
  );
}

export function withValidationLabCandidateComparisonFallback(
  value: unknown
): unknown {
  if (!isRecord(value)) {
    return value;
  }

  let normalized = value;
  if (normalized["candidateComparison"] === undefined) {
    normalized = {
      ...normalized,
      candidateComparison: missingValidationCandidateComparison([
        "candidate comparison unavailable: Local Operations API response does not include candidateComparison"
      ])
    };
  }

  if (normalized["sharpeValidation"] === undefined) {
    normalized = {
      ...normalized,
      sharpeValidation: missingSharpeValidation([
        "sharpe_validation unavailable: Local Operations API response does not include sharpeValidation"
      ])
    };
  }

  if (normalized["cpcvPboValidation"] === undefined) {
    normalized = {
      ...normalized,
      cpcvPboValidation: missingCpcvPboValidation([
        "cpcv_pbo_validation unavailable: Local Operations API response does not include cpcvPboValidation"
      ])
    };
  }

  if (normalized["metaLabelEvaluation"] === undefined) {
    normalized = {
      ...normalized,
      metaLabelEvaluation: missingMetaLabelEvaluation([
        "meta_label_evaluation unavailable: Local Operations API response does not include metaLabelEvaluation"
      ])
    };
  }

  if (normalized["costRiskWarning"] === undefined) {
    normalized = {
      ...normalized,
      costRiskWarning: missingCostRiskWarning([
        "cost risk warning unavailable: Local Operations API response does not include costRiskWarning"
      ])
    };
  }

  return normalized;
}

function isSharpeValidationView(
  value: unknown
): value is SharpeValidationView {
  return (
    isRecord(value) &&
    isSharpeValidationStatus(value["status"]) &&
    isNullableString(value["schemaVersion"]) &&
    isNumber(value["returnSampleCount"]) &&
    isNullableNumber(value["minimumSampleCount"]) &&
    isNullableString(value["sampleSharpeStatus"]) &&
    isNullableNumber(value["sampleSharpeValue"]) &&
    isNullableString(value["loAdjustedSharpeStatus"]) &&
    isNullableString(value["probabilisticSharpeRatioStatus"]) &&
    isNullableNumber(value["probabilisticSharpeRatioProbability"]) &&
    isNullableString(value["deflatedSharpeRatioStatus"]) &&
    isNullableNumber(value["deflatedSharpeRatioProbability"]) &&
    isSharpeSelectionContext(value["selectionContext"]) &&
    isNumber(value["warningCount"]) &&
    Array.isArray(value["warnings"]) &&
    value["warnings"].every(isSharpeValidationWarningView) &&
    typeof value["readOnlyNotice"] === "string"
  );
}

function isSharpeSelectionContext(
  value: unknown
): value is SharpeValidationView["selectionContext"] {
  return (
    isRecord(value) &&
    isNullableNumber(value["candidateCount"]) &&
    isNullableNumber(value["trialCount"]) &&
    isNullableNumber(value["trialSharpeRatioStandardDeviation"]) &&
    isNullableString(value["selectedByMetric"]) &&
    isNullableString(value["multipleTestingAdjustment"])
  );
}

function isSharpeValidationWarningView(
  value: unknown
): value is SharpeValidationWarningView {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    (value["severity"] === "info" || value["severity"] === "warning") &&
    typeof value["message"] === "string"
  );
}

function isSharpeValidationStatus(
  value: unknown
): value is SharpeValidationView["status"] {
  return value === "missing" || value === "available" || value === "unavailable";
}

function missingSharpeValidation(
  warnings: string[] = []
): SharpeValidationView {
  return {
    status: "missing",
    schemaVersion: null,
    returnSampleCount: 0,
    minimumSampleCount: null,
    sampleSharpeStatus: null,
    sampleSharpeValue: null,
    loAdjustedSharpeStatus: null,
    probabilisticSharpeRatioStatus: null,
    probabilisticSharpeRatioProbability: null,
    deflatedSharpeRatioStatus: null,
    deflatedSharpeRatioProbability: null,
    selectionContext: {
      candidateCount: null,
      trialCount: null,
      trialSharpeRatioStandardDeviation: null,
      selectedByMetric: null,
      multipleTestingAdjustment: null
    },
    warningCount: warnings.length,
    warnings: warnings.map((message) => ({
      code: "SHARPE_VALIDATION_MISSING",
      severity: "warning",
      message
    })),
    readOnlyNotice:
      "Sharpe validation is paper-only research evidence. It is not a strategy recommendation or performance guarantee."
  };
}

function isCpcvPboValidationView(
  value: unknown
): value is CpcvPboValidationView {
  return (
    isRecord(value) &&
    isCpcvPboValidationStatus(value["status"]) &&
    isNullableString(value["schemaVersion"]) &&
    isNullableString(value["generatedAt"]) &&
    isNullableString(value["pboStatus"]) &&
    isNullableNumber(value["pboProbability"]) &&
    isNumber(value["evaluatedCombinationCount"]) &&
    isNumber(value["selectedBelowMedianCount"]) &&
    isNullableString(value["combinationMode"]) &&
    typeof value["splitPlanAvailable"] === "boolean" &&
    isNumber(value["warningCount"]) &&
    Array.isArray(value["warnings"]) &&
    value["warnings"].every(isCpcvPboWarningView) &&
    typeof value["readOnlyNotice"] === "string"
  );
}

function isCpcvPboWarningView(value: unknown): value is CpcvPboWarningView {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    (value["severity"] === "info" || value["severity"] === "warning") &&
    typeof value["message"] === "string"
  );
}

function isCpcvPboValidationStatus(
  value: unknown
): value is CpcvPboValidationView["status"] {
  return (
    value === "missing" ||
    value === "available" ||
    value === "sampled" ||
    value === "unavailable"
  );
}

function missingCpcvPboValidation(
  warnings: string[] = []
): CpcvPboValidationView {
  return {
    status: "missing",
    schemaVersion: null,
    generatedAt: null,
    pboStatus: null,
    pboProbability: null,
    evaluatedCombinationCount: 0,
    selectedBelowMedianCount: 0,
    combinationMode: null,
    splitPlanAvailable: false,
    warningCount: warnings.length,
    warnings: warnings.map((message) => ({
      code: "CPCV_PBO_VALIDATION_MISSING",
      severity: "warning",
      message
    })),
    readOnlyNotice:
      "CPCV/PBO validation is paper-only research evidence, not a strategy recommendation or performance guarantee."
  };
}

function isMetaLabelEvaluationView(
  value: unknown
): value is MetaLabelEvaluationView {
  return (
    isRecord(value) &&
    isMetaLabelEvaluationStatus(value["status"]) &&
    isNullableString(value["schemaVersion"]) &&
    isNullableString(value["generatedAt"]) &&
    isNumber(value["totalCandidateCount"]) &&
    isNumber(value["actionableCandidateCount"]) &&
    isNumber(value["correctSideCount"]) &&
    isNumber(value["wrongSideCount"]) &&
    isNumber(value["notActionableCount"]) &&
    isNullableNumber(value["accuracyRatio"]) &&
    isNumber(value["warningCount"]) &&
    Array.isArray(value["warnings"]) &&
    value["warnings"].every(isMetaLabelEvaluationWarningView) &&
    typeof value["readOnlyNotice"] === "string"
  );
}

function isMetaLabelEvaluationWarningView(
  value: unknown
): value is MetaLabelEvaluationWarningView {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    (value["severity"] === "info" || value["severity"] === "warning") &&
    typeof value["message"] === "string"
  );
}

function isMetaLabelEvaluationStatus(
  value: unknown
): value is MetaLabelEvaluationView["status"] {
  return value === "missing" || value === "available" || value === "invalid";
}

function missingMetaLabelEvaluation(
  warnings: string[] = []
): MetaLabelEvaluationView {
  return {
    status: "missing",
    schemaVersion: null,
    generatedAt: null,
    totalCandidateCount: 0,
    actionableCandidateCount: 0,
    correctSideCount: 0,
    wrongSideCount: 0,
    notActionableCount: 0,
    accuracyRatio: null,
    warningCount: warnings.length,
    warnings: warnings.map((message) => ({
      code: "META_LABEL_EVALUATION_MISSING",
      severity: "warning",
      message
    })),
    readOnlyNotice:
      "Meta-label evaluation is paper-only research evidence. It is not a strategy recommendation, sizing directive, or performance guarantee."
  };
}

function isCostRiskWarningView(
  value: unknown
): value is CostRiskWarningView {
  return (
    isRecord(value) &&
    isCostRiskWarningStatus(value["status"]) &&
    isNumber(value["sampleCount"]) &&
    isNumber(value["tradeCount"]) &&
    isNumber(value["totalCostKrw"]) &&
    isNumber(value["feeKrw"]) &&
    isNumber(value["taxKrw"]) &&
    isNumber(value["slippageKrw"]) &&
    isNumber(value["spreadCostKrw"]) &&
    isNumber(value["impactCostKrw"]) &&
    isNumber(value["partialFillCount"]) &&
    isNumber(value["notModeledLiquidityCount"]) &&
    isNullableNumber(value["averageCostPerTradeKrw"]) &&
    isNullableNumber(value["maxParticipationRate"]) &&
    (value["highestCostBucket"] === null ||
      isCostRiskBucketWarningView(value["highestCostBucket"])) &&
    isNumber(value["missingStrategyBucketBreakdownCount"]) &&
    isStringArray(value["missingStrategyBucketBreakdownRunIds"]) &&
    isNumber(value["warningCount"]) &&
    Array.isArray(value["warnings"]) &&
    value["warnings"].every(isCostRiskWarningMessageView) &&
    typeof value["readOnlyNotice"] === "string"
  );
}

function isCostRiskBucketWarningView(
  value: unknown
): value is CostRiskBucketWarningView {
  return (
    isRecord(value) &&
    (isStrategyBucket(value["strategyBucket"]) ||
      value["strategyBucket"] === "UNKNOWN") &&
    isNumber(value["tradeCount"]) &&
    isNumber(value["totalCostKrw"]) &&
    isNumber(value["slippageKrw"]) &&
    isNumber(value["spreadCostKrw"]) &&
    isNumber(value["impactCostKrw"]) &&
    isNullableNumber(value["averageCostPerTradeKrw"]) &&
    isNullableNumber(value["maxParticipationRate"]) &&
    isStringArray(value["runIds"])
  );
}

function isCostRiskWarningMessageView(
  value: unknown
): value is CostRiskWarningMessageView {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    value["severity"] === "warning" &&
    typeof value["message"] === "string"
  );
}

function isCostRiskWarningStatus(
  value: unknown
): value is CostRiskWarningView["status"] {
  return value === "missing" || value === "available" || value === "warning";
}

function missingCostRiskWarning(
  warnings: string[] = []
): CostRiskWarningView {
  return {
    status: "missing",
    sampleCount: 0,
    tradeCount: 0,
    totalCostKrw: 0,
    feeKrw: 0,
    taxKrw: 0,
    slippageKrw: 0,
    spreadCostKrw: 0,
    impactCostKrw: 0,
    partialFillCount: 0,
    notModeledLiquidityCount: 0,
    averageCostPerTradeKrw: null,
    maxParticipationRate: null,
    highestCostBucket: null,
    missingStrategyBucketBreakdownCount: 0,
    missingStrategyBucketBreakdownRunIds: [],
    warningCount: warnings.length,
    warnings: warnings.map((message) => ({
      code: "COST_RISK_WARNING_MISSING",
      severity: "warning",
      message
    })),
    readOnlyNotice:
      "Cost risk warning is paper-only replay evidence. It is not a strategy recommendation, sizing directive, or performance guarantee."
  };
}

function isValidationCandidateComparison(
  value: unknown
): value is ValidationCandidateComparisonView {
  return (
    isRecord(value) &&
    (value["status"] === "available" || value["status"] === "missing") &&
    isNullableString(value["selectionMetric"]) &&
    isNullableString(value["selectedCandidateKey"]) &&
    isNumber(value["candidateCount"]) &&
    isNumber(value["returnSampleCount"]) &&
    Array.isArray(value["rows"]) &&
    value["rows"].every(isValidationCandidateComparisonRow) &&
    isStringArray(value["warnings"])
  );
}

function missingValidationCandidateComparison(
  warnings: string[] = []
): ValidationCandidateComparisonView {
  return {
    status: "missing",
    selectionMetric: null,
    selectedCandidateKey: null,
    candidateCount: 0,
    returnSampleCount: 0,
    rows: [],
    warnings
  };
}

function isValidationCandidateComparisonRow(
  value: unknown
): value is ValidationCandidateComparisonRow {
  return (
    isRecord(value) &&
    typeof value["candidateKey"] === "string" &&
    typeof value["selected"] === "boolean" &&
    typeof value["decisionProviderMode"] === "string" &&
    isNullableString(value["promptHash"]) &&
    isNullableString(value["riskProfile"]) &&
    Array.isArray(value["configHashes"]) &&
    value["configHashes"].every(
      (entry) => typeof entry === "string" || entry === null
    ) &&
    isNullableNumber(value["trainAverageTotalReturnRatio"]) &&
    isNullableNumber(value["validationAverageTotalReturnRatio"]) &&
    isNullableNumber(value["testAverageTotalReturnRatio"]) &&
    isNumber(value["trainReturnSampleCount"]) &&
    isNumber(value["validationReturnSampleCount"]) &&
    isNumber(value["testReturnSampleCount"]) &&
    isStringArray(value["runIds"]) &&
    isNumber(value["holdoutDegradationCount"])
  );
}

function isRiskGateTraceRow(
  value: unknown
): value is RiskGateTraceViewModel["traces"][number] {
  return (
    isRecord(value) &&
    typeof value["packetId"] === "string" &&
    typeof value["decisionId"] === "string" &&
    typeof value["market"] === "string" &&
    typeof value["symbol"] === "string" &&
    typeof value["action"] === "string" &&
    (isStrategyBucket(value["strategyBucket"]) ||
      value["strategyBucket"] === "unknown") &&
    isNullableString(value["aiThesis"]) &&
    isStringArray(value["evidenceRefs"]) &&
    isNullableNumber(value["normalizedBudgetKrw"]) &&
    typeof value["riskApproved"] === "boolean" &&
    isStringArray(value["rejectCodes"]) &&
    (value["simulatedExecutionStatus"] === "filled" ||
      value["simulatedExecutionStatus"] === "partial" ||
      value["simulatedExecutionStatus"] === "rejected" ||
      value["simulatedExecutionStatus"] === "none") &&
    isStringArray(value["auditEventRefs"])
  );
}

function isExposureBucket(value: unknown): value is ExposureBucket {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    isNumber(value["exposureKrw"]) &&
    isNumber(value["exposureRatio"])
  );
}

function isSourceStatus(value: unknown): value is Record<string, JsonReadStatus> {
  return isRecord(value) && Object.values(value).every(isJsonReadStatus);
}

function isJsonReadStatus(value: unknown): value is JsonReadStatus {
  return (
    value === "missing" ||
    value === "ok" ||
    value === "corrupt" ||
    value === "degraded"
  );
}

function isViewModelStatus(value: unknown): value is ViewModelStatus {
  return (
    value === "ok" ||
    value === "watch" ||
    value === "breach" ||
    value === "missing"
  );
}

function isValidationStatus(
  value: unknown
): value is ValidationLabViewModel["status"] {
  return (
    value === "missing" ||
    value === "ok" ||
    value === "corrupt" ||
    value === "invalid"
  );
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

function isStrategyBucketTestStatus(
  value: unknown
): value is StrategyBucketTestSummary["status"] {
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
): value is StrategyBucketTestSummary["progress"]["phase"] {
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

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : null;
}

function readNullableNumber(value: unknown): number | null {
  return isNumber(value) ? value : null;
}

function readNumberOrZero(value: unknown): number {
  return isNumber(value) ? value : 0;
}

function readJsonReadStatus(value: unknown): RunArtifactReadStatus {
  return value === "ok" ||
    value === "missing" ||
    value === "corrupt" ||
    value === "degraded" ||
    value === "blocked" ||
    value === "invalid"
    ? value
    : "invalid";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isNumber);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
