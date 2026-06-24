export const STRATEGY_BUCKETS = [
  "long_term",
  "swing",
  "short_term",
  "intraday",
  "hedge"
] as const;

export type StrategyBucket = (typeof STRATEGY_BUCKETS)[number];

export type HoldingPeriodHint =
  | "multi_month"
  | "multi_week"
  | "multi_day"
  | "intraday"
  | "hedge";

export type CashRuleSource =
  | "static"
  | "dynamic_regime"
  | "high_volatility"
  | "fallback";

export interface PolicyBucketDraft {
  bucket: StrategyBucket;
  targetWeightPct: number;
  minWeightPct: number;
  maxWeightPct: number;
  maxTurnoverPct: number;
  maxDrawdownPct: number;
  holdingPeriodHint: HoldingPeriodHint;
  enabledAssetClasses: string[];
}

export interface PortfolioPolicyDraft {
  mode: "paper_only";
  policyId: string;
  version: string;
  name: string;
  buckets: PolicyBucketDraft[];
  cashPolicy: {
    targetCashPct: number;
    minimumCashReserveKrw: number;
    ruleSource: CashRuleSource;
  };
  hedgePolicy: {
    enabled: boolean;
    maxCostPct: number;
  };
  exposurePolicy: {
    maxSymbolExposurePct: number;
    maxCountryExposurePct: number;
    maxCurrencyExposurePct: number;
  };
}

export interface PolicyDraftValidationIssue {
  code: string;
  message: string;
}

export interface PolicyDraftValidationResult {
  status: "valid" | "invalid";
  totalAllocationPct: number;
  issues: PolicyDraftValidationIssue[];
}

export function createDefaultPolicyDraft(): PortfolioPolicyDraft {
  return {
    mode: "paper_only",
    policyId: "local-draft",
    version: "draft.v1",
    name: "Balanced paper policy draft",
    buckets: [
      bucketDraft("long_term", 35, 20, 50, 15, 18, "multi_month", [
        "equity",
        "etf"
      ]),
      bucketDraft("swing", 20, 10, 30, 35, 12, "multi_week", [
        "equity",
        "etf"
      ]),
      bucketDraft("short_term", 15, 0, 25, 50, 8, "multi_day", [
        "equity",
        "etf"
      ]),
      bucketDraft("intraday", 10, 0, 15, 100, 4, "intraday", ["equity"]),
      bucketDraft("hedge", 5, 0, 15, 40, 6, "hedge", [
        "inverse_etf",
        "cash_equivalent"
      ])
    ],
    cashPolicy: {
      targetCashPct: 15,
      minimumCashReserveKrw: 1_000_000,
      ruleSource: "dynamic_regime"
    },
    hedgePolicy: {
      enabled: true,
      maxCostPct: 1.5
    },
    exposurePolicy: {
      maxSymbolExposurePct: 20,
      maxCountryExposurePct: 70,
      maxCurrencyExposurePct: 70
    }
  };
}

export function validatePolicyDraft(
  draft: PortfolioPolicyDraft
): PolicyDraftValidationResult {
  const issues: PolicyDraftValidationIssue[] = [];
  const bucketTotalPct = sum(draft.buckets.map((bucket) => bucket.targetWeightPct));
  const totalAllocationPct = roundPct(bucketTotalPct + draft.cashPolicy.targetCashPct);

  if (Math.abs(totalAllocationPct - 100) > 0.01) {
    issues.push({
      code: "ALLOCATION_TOTAL_MISMATCH",
      message: `Total allocation is ${formatPct(totalAllocationPct)}. Bucket targets plus cash reserve must equal 100%.`
    });
  }

  for (const bucket of draft.buckets) {
    if (isPctOutsideInclusiveRange(bucket.targetWeightPct)) {
      issues.push({
        code: "BUCKET_TARGET_WEIGHT_OUT_OF_RANGE",
        message: `${bucket.bucket} target weight must stay between 0% and 100%.`
      });
    }
    if (isPctOutsideInclusiveRange(bucket.minWeightPct)) {
      issues.push({
        code: "BUCKET_MIN_WEIGHT_OUT_OF_RANGE",
        message: `${bucket.bucket} minimum weight must stay between 0% and 100%.`
      });
    }
    if (isPctOutsideInclusiveRange(bucket.maxWeightPct)) {
      issues.push({
        code: "BUCKET_MAX_WEIGHT_OUT_OF_RANGE",
        message: `${bucket.bucket} maximum weight must stay between 0% and 100%.`
      });
    }
    if (bucket.minWeightPct > bucket.maxWeightPct) {
      issues.push({
        code: "BUCKET_MIN_EXCEEDS_MAX",
        message: `${bucket.bucket} minimum weight exceeds maximum weight.`
      });
    }
    if (
      bucket.targetWeightPct < bucket.minWeightPct ||
      bucket.targetWeightPct > bucket.maxWeightPct
    ) {
      issues.push({
        code: "BUCKET_TARGET_OUT_OF_RANGE",
        message: `${bucket.bucket} target must stay between its minimum and maximum exposure.`
      });
    }
    if (bucket.maxTurnoverPct < 0 || bucket.maxTurnoverPct > 100) {
      issues.push({
        code: "BUCKET_TURNOVER_OUT_OF_RANGE",
        message: `${bucket.bucket} turnover cap must stay between 0% and 100%.`
      });
    }
    if (bucket.maxDrawdownPct < 0 || bucket.maxDrawdownPct > 100) {
      issues.push({
        code: "BUCKET_DRAWDOWN_OUT_OF_RANGE",
        message: `${bucket.bucket} drawdown cap must stay between 0% and 100%.`
      });
    }
  }

  const hedgeBucket = draft.buckets.find((bucket) => bucket.bucket === "hedge");
  const hedgeTargetPct = hedgeBucket?.targetWeightPct ?? 0;
  if (!draft.hedgePolicy.enabled && hedgeTargetPct > 0) {
    issues.push({
      code: "HEDGE_BUCKET_ENABLED_WITHOUT_POLICY",
      message: "Hedge bucket target must be 0% when hedge policy is disabled."
    });
  }
  if (draft.hedgePolicy.enabled && hedgeTargetPct <= 0) {
    issues.push({
      code: "HEDGE_POLICY_WITHOUT_BUCKET",
      message: "Hedge policy is enabled but hedge bucket target is 0%."
    });
  }
  if (draft.hedgePolicy.maxCostPct < 0 || draft.hedgePolicy.maxCostPct > 10) {
    issues.push({
      code: "HEDGE_COST_OUT_OF_RANGE",
      message: "Hedge cost cap must stay between 0% and 10%."
    });
  }

  if (draft.cashPolicy.targetCashPct < 0 || draft.cashPolicy.targetCashPct > 80) {
    issues.push({
      code: "CASH_TARGET_OUT_OF_RANGE",
      message: "Target cash reserve must stay between 0% and 80%."
    });
  }
  if (draft.cashPolicy.minimumCashReserveKrw < 0) {
    issues.push({
      code: "MINIMUM_CASH_NEGATIVE",
      message: "Minimum cash reserve cannot be negative."
    });
  }

  for (const [code, value] of [
    ["MAX_SYMBOL_EXPOSURE_OUT_OF_RANGE", draft.exposurePolicy.maxSymbolExposurePct],
    ["MAX_COUNTRY_EXPOSURE_OUT_OF_RANGE", draft.exposurePolicy.maxCountryExposurePct],
    ["MAX_CURRENCY_EXPOSURE_OUT_OF_RANGE", draft.exposurePolicy.maxCurrencyExposurePct]
  ] as const) {
    if (value <= 0 || value > 100) {
      issues.push({
        code,
        message: "Exposure caps must be greater than 0% and no more than 100%."
      });
    }
  }

  return {
    status: issues.length === 0 ? "valid" : "invalid",
    totalAllocationPct,
    issues
  };
}

export function buildPolicyPreview(
  draft: PortfolioPolicyDraft,
  validation: PolicyDraftValidationResult
) {
  return {
    mode: "paper_only",
    policyId: draft.policyId,
    version: draft.version,
    name: draft.name,
    validationStatus: validation.status,
    strategyBuckets: draft.buckets.map((bucket) => ({
      bucket: bucket.bucket,
      targetWeightRatio: toRatio(bucket.targetWeightPct),
      minWeightRatio: toRatio(bucket.minWeightPct),
      maxWeightRatio: toRatio(bucket.maxWeightPct),
      maxTurnoverRatio: toRatio(bucket.maxTurnoverPct),
      maxDrawdownRatio: toRatio(bucket.maxDrawdownPct),
      holdingPeriodHint: bucket.holdingPeriodHint,
      enabledAssetClasses: bucket.enabledAssetClasses
    })),
    cashPolicy: {
      targetCashRatio: toRatio(draft.cashPolicy.targetCashPct),
      minimumCashReserveKrw: draft.cashPolicy.minimumCashReserveKrw,
      ruleSource: draft.cashPolicy.ruleSource
    },
    hedgePolicy: {
      hedgeEnabled: draft.hedgePolicy.enabled,
      hedgeTargetRatio: toRatio(
        draft.buckets.find((bucket) => bucket.bucket === "hedge")
          ?.targetWeightPct ?? 0
      ),
      maxCostRatio: toRatio(draft.hedgePolicy.maxCostPct)
    },
    exposurePolicy: {
      maxSymbolExposureRatio: toRatio(
        draft.exposurePolicy.maxSymbolExposurePct
      ),
      maxCountryExposureRatio: toRatio(
        draft.exposurePolicy.maxCountryExposurePct
      ),
      maxCurrencyExposureRatio: toRatio(
        draft.exposurePolicy.maxCurrencyExposurePct
      )
    },
    executionBoundary: {
      liveTradingEnabled: false,
      orderPlacementEnabled: false,
      backendValidationRequired: true
    },
    warnings: validation.issues.map((issue) => issue.code)
  };
}

export function formatPct(value: number): string {
  return `${roundPct(value).toFixed(2)}%`;
}

function bucketDraft(
  bucket: StrategyBucket,
  targetWeightPct: number,
  minWeightPct: number,
  maxWeightPct: number,
  maxTurnoverPct: number,
  maxDrawdownPct: number,
  holdingPeriodHint: HoldingPeriodHint,
  enabledAssetClasses: string[]
): PolicyBucketDraft {
  return {
    bucket,
    targetWeightPct,
    minWeightPct,
    maxWeightPct,
    maxTurnoverPct,
    maxDrawdownPct,
    holdingPeriodHint,
    enabledAssetClasses
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function toRatio(value: number): number {
  return roundPct(value) / 100;
}

function isPctOutsideInclusiveRange(value: number): boolean {
  return value < 0 || value > 100;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}
