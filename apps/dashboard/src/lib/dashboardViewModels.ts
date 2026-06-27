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
  | "portfolio-compliance"
  | "strategy-test-lab"
  | "strategy-test-progress"
  | "risk-gate-trace"
  | "validation-lab";

export interface BucketComplianceRow {
  bucket: StrategyBucket;
  targetWeightRatio: number;
  currentWeightRatio: number;
  gapRatio: number;
  exposureKrw: number;
  turnoverRatio: number | null;
  status: "ok" | "under" | "over" | "missing";
  primaryReason: string | null;
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
  validationSplitRole: "train" | "validation" | "test" | null;
  totalReturnRatio: number | null;
  maxDrawdownRatio: number | null;
  turnoverRatio: number | null;
  costDragRatio: number | null;
  riskRejectRate: number | null;
  providerFailureRate: number | null;
  warnings: string[];
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

export interface StrategyTestLabPageData {
  apiBaseLabel: string;
  fetchedAt: string;
  strategyLab: ViewModelResult<StrategyBucketTestLabViewModel>;
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
      isValidationLabViewModel
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

async function fetchViewModel<T>(
  apiBaseUrl: string,
  endpoint: string,
  expectedViewModel: DashboardViewModelName,
  validator: (value: unknown) => value is T
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
    if (
      !isViewModelPayload(data, expectedViewModel) ||
      !validator(data)
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
      data
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
    value.policyStatus === "missing" &&
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
    isRecord(value.executionAssumptions) &&
    value.executionAssumptions["paperOnly"] === true &&
    value.executionAssumptions["liveTradingEnabled"] === false &&
    value.executionAssumptions["orderPlacementEnabled"] === false
  );
}

function isBucketComplianceRow(value: unknown): value is BucketComplianceRow {
  return (
    isRecord(value) &&
    isStrategyBucket(value["bucket"]) &&
    isNumber(value["targetWeightRatio"]) &&
    isNumber(value["currentWeightRatio"]) &&
    isNumber(value["gapRatio"]) &&
    isNumber(value["exposureKrw"]) &&
    isNullableNumber(value["turnoverRatio"]) &&
    (value["status"] === "ok" ||
      value["status"] === "under" ||
      value["status"] === "over" ||
      value["status"] === "missing") &&
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
    isNullableString(value["selectionWarning"])
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
