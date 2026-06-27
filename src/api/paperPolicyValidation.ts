import { createHash } from "node:crypto";

import { z } from "zod";

import { strategyBucketSchema, type StrategyBucket } from "../domain/schemas.js";

export const PAPER_POLICY_VALIDATION_ROUTE = "/paper/policies/validate";
export const PAPER_POLICY_VALIDATION_OPERATION = "paper-policy-validate";
export const PAPER_POLICY_VALIDATION_HEADER_NAME = "x-toss-trading-operation";

const TOLERANCE_RATIO = 0.0001;
const REQUIRED_BUCKETS = strategyBucketSchema.options;
const finiteNumberSchema = z.number().finite();

const holdingPeriodHintSchema = z.enum([
  "multi_month",
  "multi_week",
  "multi_day",
  "intraday",
  "hedge"
]);

const cashRuleSourceSchema = z.enum([
  "static",
  "dynamic_regime",
  "high_volatility",
  "fallback"
]);

const policyBucketCandidateSchema = z
  .object({
    bucket: strategyBucketSchema,
    targetWeightRatio: finiteNumberSchema,
    minWeightRatio: finiteNumberSchema,
    maxWeightRatio: finiteNumberSchema,
    maxTurnoverRatio: finiteNumberSchema,
    maxDrawdownRatio: finiteNumberSchema,
    holdingPeriodHint: holdingPeriodHintSchema,
    enabledAssetClasses: z.array(z.string().min(1).max(80)).min(1).max(12)
  })
  .strict();

export const paperPolicyValidationCandidateSchema = z
  .object({
    mode: z.literal("paper_only"),
    policyId: z.string().min(1).max(120),
    version: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    validationStatus: z.enum(["valid", "invalid"]).optional(),
    strategyBuckets: z.array(policyBucketCandidateSchema).min(1).max(5),
    cashPolicy: z
      .object({
        targetCashRatio: finiteNumberSchema,
        minimumCashReserveKrw: finiteNumberSchema,
        ruleSource: cashRuleSourceSchema
      })
      .strict(),
    hedgePolicy: z
      .object({
        hedgeEnabled: z.boolean(),
        hedgeTargetRatio: finiteNumberSchema,
        maxCostRatio: finiteNumberSchema
      })
      .strict(),
    exposurePolicy: z
      .object({
        maxSymbolExposureRatio: finiteNumberSchema,
        maxCountryExposureRatio: finiteNumberSchema,
        maxCurrencyExposureRatio: finiteNumberSchema
      })
      .strict(),
    executionBoundary: z
      .object({
        liveTradingEnabled: z.literal(false),
        orderPlacementEnabled: z.literal(false),
        backendValidationRequired: z.literal(true)
      })
      .strict(),
    warnings: z.array(z.string().min(1).max(120)).max(50).optional()
  })
  .strict();

export type PaperPolicyValidationCandidate = z.infer<
  typeof paperPolicyValidationCandidateSchema
>;
type PolicyHoldingPeriodHint =
  PaperPolicyValidationCandidate["strategyBuckets"][number]["holdingPeriodHint"];

export interface PaperPolicyValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error";
}

export interface PaperPolicyValidationResponse {
  mode: "paper_only";
  validation: "paper_policy";
  readOnly: true;
  storageMutationEnabled: false;
  liveTradingEnabled: false;
  orderPlacementEnabled: false;
  policyId: string;
  version: string;
  policyHash: string;
  status: "valid" | "invalid";
  validatedForPaperSimulationConfig: boolean;
  issueCount: number;
  issues: PaperPolicyValidationIssue[];
  summary: {
    bucketTargetWeightRatio: number;
    cashTargetRatio: number;
    totalAllocationRatio: number;
    enabledBucketCount: number;
    hedgeEnabled: boolean;
    backendValidationRequired: true;
  };
  validatedAt: string;
}

export class PaperPolicyValidationRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
  }
}

export function parsePaperPolicyValidationCandidate(
  value: unknown
): PaperPolicyValidationCandidate {
  const result = paperPolicyValidationCandidateSchema.safeParse(value);
  if (!result.success) {
    throw new PaperPolicyValidationRequestError(
      formatSchemaIssues(result.error.issues),
      400,
      "invalid_policy_candidate"
    );
  }
  return result.data;
}

export function validatePaperPolicyCandidate(
  value: unknown,
  validatedAt = new Date()
): PaperPolicyValidationResponse {
  const candidate = parsePaperPolicyValidationCandidate(value);
  const issues: PaperPolicyValidationIssue[] = [];
  const bucketTargetWeightRatio = roundRatio(
    sum(candidate.strategyBuckets.map((bucket) => bucket.targetWeightRatio))
  );
  const totalAllocationRatio = roundRatio(
    bucketTargetWeightRatio + candidate.cashPolicy.targetCashRatio
  );

  if (Math.abs(totalAllocationRatio - 1) > TOLERANCE_RATIO) {
    issues.push({
      code: "ALLOCATION_TOTAL_MISMATCH",
      path: "strategyBuckets,cashPolicy.targetCashRatio",
      message: `Bucket targets plus cash reserve must equal 100%; received ${formatRatio(totalAllocationRatio)}.`,
      severity: "error"
    });
  }

  validateBucketSet(candidate, issues);
  validateBuckets(candidate, issues);
  validateCashPolicy(candidate, issues);
  validateHedgePolicy(candidate, issues);
  validateExposurePolicy(candidate, issues);

  const status = issues.length === 0 ? "valid" : "invalid";

  return {
    mode: "paper_only",
    validation: "paper_policy",
    readOnly: true,
    storageMutationEnabled: false,
    liveTradingEnabled: false,
    orderPlacementEnabled: false,
    policyId: candidate.policyId,
    version: candidate.version,
    policyHash: policyHash(candidate),
    status,
    validatedForPaperSimulationConfig: status === "valid",
    issueCount: issues.length,
    issues,
    summary: {
      bucketTargetWeightRatio,
      cashTargetRatio: candidate.cashPolicy.targetCashRatio,
      totalAllocationRatio,
      enabledBucketCount: candidate.strategyBuckets.filter(
        (bucket) => bucket.targetWeightRatio > 0
      ).length,
      hedgeEnabled: candidate.hedgePolicy.hedgeEnabled,
      backendValidationRequired: true
    },
    validatedAt: validatedAt.toISOString()
  };
}

function validateBucketSet(
  candidate: PaperPolicyValidationCandidate,
  issues: PaperPolicyValidationIssue[]
): void {
  const counts = new Map<StrategyBucket, number>();
  for (const bucket of candidate.strategyBuckets) {
    counts.set(bucket.bucket, (counts.get(bucket.bucket) ?? 0) + 1);
  }

  for (const bucket of REQUIRED_BUCKETS) {
    const count = counts.get(bucket) ?? 0;
    if (count === 0) {
      issues.push({
        code: "STRATEGY_BUCKET_MISSING",
        path: "strategyBuckets",
        message: `${bucket} bucket is required for portfolio-level policy validation.`,
        severity: "error"
      });
    }
    if (count > 1) {
      issues.push({
        code: "STRATEGY_BUCKET_DUPLICATED",
        path: "strategyBuckets",
        message: `${bucket} bucket appears more than once.`,
        severity: "error"
      });
    }
  }
}

function validateBuckets(
  candidate: PaperPolicyValidationCandidate,
  issues: PaperPolicyValidationIssue[]
): void {
  candidate.strategyBuckets.forEach((bucket, index) => {
    validateRatioRange(
      bucket.targetWeightRatio,
      `strategyBuckets[${index}].targetWeightRatio`,
      "BUCKET_TARGET_WEIGHT_OUT_OF_RANGE",
      `${bucket.bucket} target weight must stay between 0% and 100%.`,
      issues
    );
    validateRatioRange(
      bucket.minWeightRatio,
      `strategyBuckets[${index}].minWeightRatio`,
      "BUCKET_MIN_WEIGHT_OUT_OF_RANGE",
      `${bucket.bucket} minimum weight must stay between 0% and 100%.`,
      issues
    );
    validateRatioRange(
      bucket.maxWeightRatio,
      `strategyBuckets[${index}].maxWeightRatio`,
      "BUCKET_MAX_WEIGHT_OUT_OF_RANGE",
      `${bucket.bucket} maximum weight must stay between 0% and 100%.`,
      issues
    );
    validateRatioRange(
      bucket.maxTurnoverRatio,
      `strategyBuckets[${index}].maxTurnoverRatio`,
      "BUCKET_TURNOVER_OUT_OF_RANGE",
      `${bucket.bucket} turnover cap must stay between 0% and 100%.`,
      issues
    );
    validateRatioRange(
      bucket.maxDrawdownRatio,
      `strategyBuckets[${index}].maxDrawdownRatio`,
      "BUCKET_DRAWDOWN_OUT_OF_RANGE",
      `${bucket.bucket} drawdown cap must stay between 0% and 100%.`,
      issues
    );

    if (bucket.minWeightRatio > bucket.maxWeightRatio) {
      issues.push({
        code: "BUCKET_MIN_EXCEEDS_MAX",
        path: `strategyBuckets[${index}]`,
        message: `${bucket.bucket} minimum weight exceeds maximum weight.`,
        severity: "error"
      });
    }

    if (
      bucket.targetWeightRatio < bucket.minWeightRatio ||
      bucket.targetWeightRatio > bucket.maxWeightRatio
    ) {
      issues.push({
        code: "BUCKET_TARGET_OUT_OF_RANGE",
        path: `strategyBuckets[${index}].targetWeightRatio`,
        message: `${bucket.bucket} target must stay between its minimum and maximum exposure.`,
        severity: "error"
      });
    }

    if (bucket.holdingPeriodHint !== holdingPeriodHintFor(bucket.bucket)) {
      issues.push({
        code: "BUCKET_HOLDING_PERIOD_MISMATCH",
        path: `strategyBuckets[${index}].holdingPeriodHint`,
        message: `${bucket.bucket} holding period hint does not match the strategy bucket.`,
        severity: "error"
      });
    }
  });
}

function validateCashPolicy(
  candidate: PaperPolicyValidationCandidate,
  issues: PaperPolicyValidationIssue[]
): void {
  if (
    candidate.cashPolicy.targetCashRatio < 0 ||
    candidate.cashPolicy.targetCashRatio > 0.8
  ) {
    issues.push({
      code: "CASH_TARGET_OUT_OF_RANGE",
      path: "cashPolicy.targetCashRatio",
      message: "Target cash reserve must stay between 0% and 80%.",
      severity: "error"
    });
  }

  if (
    !Number.isInteger(candidate.cashPolicy.minimumCashReserveKrw) ||
    candidate.cashPolicy.minimumCashReserveKrw < 0
  ) {
    issues.push({
      code: "MINIMUM_CASH_INVALID",
      path: "cashPolicy.minimumCashReserveKrw",
      message: "Minimum cash reserve must be a non-negative KRW integer.",
      severity: "error"
    });
  }
}

function validateHedgePolicy(
  candidate: PaperPolicyValidationCandidate,
  issues: PaperPolicyValidationIssue[]
): void {
  const hedgeTargetRatio =
    candidate.strategyBuckets.find((bucket) => bucket.bucket === "hedge")
      ?.targetWeightRatio ?? 0;

  if (
    Math.abs(candidate.hedgePolicy.hedgeTargetRatio - hedgeTargetRatio) >
    TOLERANCE_RATIO
  ) {
    issues.push({
      code: "HEDGE_TARGET_MISMATCH",
      path: "hedgePolicy.hedgeTargetRatio",
      message: "Hedge policy target must match the hedge strategy bucket target.",
      severity: "error"
    });
  }

  if (!candidate.hedgePolicy.hedgeEnabled && hedgeTargetRatio > 0) {
    issues.push({
      code: "HEDGE_BUCKET_ENABLED_WITHOUT_POLICY",
      path: "hedgePolicy.hedgeEnabled",
      message: "Hedge bucket target must be 0% when hedge policy is disabled.",
      severity: "error"
    });
  }

  if (candidate.hedgePolicy.hedgeEnabled && hedgeTargetRatio <= 0) {
    issues.push({
      code: "HEDGE_POLICY_WITHOUT_BUCKET",
      path: "strategyBuckets[hedge].targetWeightRatio",
      message: "Hedge policy is enabled but hedge bucket target is 0%.",
      severity: "error"
    });
  }

  if (
    candidate.hedgePolicy.maxCostRatio < 0 ||
    candidate.hedgePolicy.maxCostRatio > 0.1
  ) {
    issues.push({
      code: "HEDGE_COST_OUT_OF_RANGE",
      path: "hedgePolicy.maxCostRatio",
      message: "Hedge cost cap must stay between 0% and 10%.",
      severity: "error"
    });
  }
}

function validateExposurePolicy(
  candidate: PaperPolicyValidationCandidate,
  issues: PaperPolicyValidationIssue[]
): void {
  for (const [path, value] of [
    [
      "exposurePolicy.maxSymbolExposureRatio",
      candidate.exposurePolicy.maxSymbolExposureRatio
    ],
    [
      "exposurePolicy.maxCountryExposureRatio",
      candidate.exposurePolicy.maxCountryExposureRatio
    ],
    [
      "exposurePolicy.maxCurrencyExposureRatio",
      candidate.exposurePolicy.maxCurrencyExposureRatio
    ]
  ] as const) {
    if (value <= 0 || value > 1) {
      issues.push({
        code: "EXPOSURE_CAP_OUT_OF_RANGE",
        path,
        message: "Exposure caps must be greater than 0% and no more than 100%.",
        severity: "error"
      });
    }
  }
}

function validateRatioRange(
  value: number,
  path: string,
  code: string,
  message: string,
  issues: PaperPolicyValidationIssue[]
): void {
  if (value < 0 || value > 1) {
    issues.push({
      code,
      path,
      message,
      severity: "error"
    });
  }
}

function holdingPeriodHintFor(bucket: StrategyBucket): PolicyHoldingPeriodHint {
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

function policyHash(candidate: PaperPolicyValidationCandidate): string {
  return createHash("sha256")
    .update(JSON.stringify(candidate))
    .digest("hex");
}

function formatSchemaIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>
): string {
  return issues.map(formatSchemaIssue).join("; ");
}

function formatSchemaIssue(issue: {
  path: PropertyKey[];
  message: string;
}): string {
  const path = issue.path.map(String).join(".") || "policy";
  return `${path}: ${issue.message}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
