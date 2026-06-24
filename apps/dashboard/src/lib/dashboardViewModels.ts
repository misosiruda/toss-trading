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
    minimumCashReserveKrw: number;
    cashGapKrw: number;
    ruleSource: string;
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
  sourceStatus: Record<string, JsonReadStatus>;
  warnings: string[];
  status: ViewModelStatus;
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
  supportedBuckets: Array<{
    bucket: StrategyBucket;
    canRunIsolatedReplay: boolean;
    requiredPolicyFields: string[];
    defaultHoldingPeriodHint: string;
    disabledReason: string | null;
  }>;
  activeTests: unknown[];
  recentResults: unknown[];
  comparison: {
    rows: unknown[];
    baselineBucket: StrategyBucket | null;
    selectionWarning: string | null;
  };
  sourceStatus: Record<string, JsonReadStatus>;
  status: "ok";
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
    Array.isArray(value.recentResults) &&
    isStrategyComparison(value.comparison) &&
    isSourceStatus(value.sourceStatus) &&
    value.status === "ok"
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
    isNumber(value["minimumCashReserveKrw"]) &&
    isNumber(value["cashGapKrw"]) &&
    typeof value["ruleSource"] === "string" &&
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

function isStrategyBucketCapability(
  value: unknown
): value is StrategyBucketTestLabViewModel["supportedBuckets"][number] {
  return (
    isRecord(value) &&
    isStrategyBucket(value["bucket"]) &&
    typeof value["canRunIsolatedReplay"] === "boolean" &&
    isStringArray(value["requiredPolicyFields"]) &&
    typeof value["defaultHoldingPeriodHint"] === "string" &&
    isNullableString(value["disabledReason"])
  );
}

function isStrategyComparison(
  value: unknown
): value is StrategyBucketTestLabViewModel["comparison"] {
  return (
    isRecord(value) &&
    Array.isArray(value["rows"]) &&
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
