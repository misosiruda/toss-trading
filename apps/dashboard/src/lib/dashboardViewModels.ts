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
  apiBaseUrl: string;
  fetchedAt: string;
  portfolio: ViewModelResult<PolicyComplianceViewModel>;
  strategyLab: ViewModelResult<StrategyBucketTestLabViewModel>;
  riskGate: ViewModelResult<RiskGateTraceViewModel>;
  validationLab: ViewModelResult<ValidationLabViewModel>;
}

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787";
const FETCH_TIMEOUT_MS = 2_000;

export async function readDashboardViewModels(): Promise<DashboardViewModels> {
  const apiBaseUrl = readOperationsApiBaseUrl();
  const fetchedAt = new Date().toISOString();
  const [portfolio, strategyLab, riskGate, validationLab] = await Promise.all([
    fetchViewModel<PolicyComplianceViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/portfolio-compliance",
      "portfolio-compliance"
    ),
    fetchViewModel<StrategyBucketTestLabViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/strategy-test-lab",
      "strategy-test-lab"
    ),
    fetchViewModel<RiskGateTraceViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/risk-gate-trace?limit=8",
      "risk-gate-trace"
    ),
    fetchViewModel<ValidationLabViewModel>(
      apiBaseUrl,
      "/dashboard/view-model/validation-lab",
      "validation-lab"
    )
  ]);

  return {
    apiBaseUrl,
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

function readOperationsApiBaseUrl(): string {
  const value = (
    process.env.DASHBOARD_OPS_API_BASE_URL ??
    process.env.OPS_API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).trim();
  return (value.length > 0 ? value : DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

async function fetchViewModel<T>(
  apiBaseUrl: string,
  endpoint: string,
  expectedViewModel: DashboardViewModelName
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
    if (!isViewModelPayload(data, expectedViewModel)) {
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
      data: data as T
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
): value is {
  mode: "paper_only";
  readOnly: true;
  viewModel: DashboardViewModelName;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    "readOnly" in value &&
    "viewModel" in value &&
    value.mode === "paper_only" &&
    value.readOnly === true &&
    value.viewModel === expectedViewModel
  );
}
