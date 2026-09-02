import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  strategyBucketSchema,
  type StrategyBucket
} from "../domain/schemas.js";
import {
  parseRuntimePortfolioPolicyRecord,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";

const identifierSchema = z.string().trim().min(1).max(160);
const nonNegativeAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .refine((value) => !Object.is(value, -0), "amount must not be negative zero");
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

const bucketExposureSchema = z
  .object({
    bucket: strategyBucketSchema,
    exposureKrw: nonNegativeAmountSchema
  })
  .strict();

const bucketOpeningCapacitySchema = z
  .object({
    bucket: strategyBucketSchema,
    maximumPositionCount: positiveIntegerSchema,
    activePositionCount: nonNegativeIntegerSchema,
    pendingReservationCount: nonNegativeIntegerSchema,
    mandateBoundUnusedSlotCount: nonNegativeIntegerSchema
  })
  .strict();

const portfolioGapExposureSchema = z
  .object({
    portfolioId: identifierSchema,
    policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    virtualNetWorthKrw: nonNegativeAmountSchema,
    cashKrw: nonNegativeAmountSchema,
    pendingBuyExposureKrw: nonNegativeAmountSchema,
    bucketExposures: z.array(bucketExposureSchema).length(5),
    bucketOpeningCapacities: z.array(bucketOpeningCapacitySchema).length(5)
  })
  .strict();

const portfolioGapAnalysisInputSchema = z
  .object({
    exposure: portfolioGapExposureSchema,
    dueBuckets: z.array(strategyBucketSchema).max(5)
  })
  .strict();

export interface PortfolioGapAnalysisInput {
  policy: RuntimePortfolioPolicyRecord;
  exposure: z.input<typeof portfolioGapExposureSchema>;
  dueBuckets: readonly StrategyBucket[];
}

export type BucketGapBasis = "min" | "entry_floor";

export interface BucketPortfolioGap {
  bucket: StrategyBucket;
  currentExposureKrw: number;
  currentWeightRatio: number;
  targetWeightKrw: number;
  minWeightKrw: number;
  maxWeightKrw: number;
  targetGapKrw: number;
  underweightKrw: number;
  overweightKrw: number;
  entryWeightKrw?: number;
  entryGapKrw?: number;
  triggerDue: boolean;
  selectionTriggerSatisfied: boolean;
  gapBasis: BucketGapBasis;
  gapKrw: number;
  availableSlots: number;
  maximumAdditionalExposureKrw: number;
  requestEligible: boolean;
  blockingReasons: Array<
    | "trigger_not_satisfied"
    | "overweight"
    | "no_available_slot"
    | "cash_opening_capacity_exhausted"
    | "no_buy_capacity"
  >;
}

export interface PortfolioGapAnalysis {
  mode: "paper_only";
  portfolioId: string;
  policyHash: string;
  virtualNetWorthKrw: number;
  cashKrw: number;
  minimumCashReserveKrw: number;
  pendingBuyExposureKrw: number;
  cashOpeningCapacityKrw: number;
  bucketGaps: BucketPortfolioGap[];
}

export function analyzePortfolioGaps(
  input: PortfolioGapAnalysisInput
): PortfolioGapAnalysis {
  const policy = parseRuntimePortfolioPolicyRecord(input.policy);
  const parsed = portfolioGapAnalysisInputSchema.parse({
    exposure: input.exposure,
    dueBuckets: [...input.dueBuckets]
  });
  assertScope(policy, parsed.exposure);
  const bucketExposures = canonicalBucketMap(
    parsed.exposure.bucketExposures,
    "bucket exposures"
  );
  const bucketOpeningCapacities = canonicalBucketMap(
    parsed.exposure.bucketOpeningCapacities,
    "bucket opening capacities"
  );
  const dueBuckets = canonicalDueBuckets(parsed.dueBuckets);
  const minimumCashReserveKrw = Math.max(
    policy.cashPolicy.minimumCashReserveKrw,
    weightedAmount(
      parsed.exposure.virtualNetWorthKrw,
      policy.cashPolicy.targetCashRatio
    )
  );
  const cashOpeningCapacityKrw = Math.max(
    0,
    parsed.exposure.cashKrw -
      minimumCashReserveKrw -
      parsed.exposure.pendingBuyExposureKrw
  );

  const bucketGaps = policy.strategyBuckets.map((bucketPolicy) => {
    const exposure = requiredBucketValue(bucketExposures, bucketPolicy.bucket);
    const capacity = requiredBucketValue(
      bucketOpeningCapacities,
      bucketPolicy.bucket
    );
    const currentExposureKrw = exposure.exposureKrw;
    const targetWeightKrw = weightedAmount(
      parsed.exposure.virtualNetWorthKrw,
      bucketPolicy.targetWeightRatio
    );
    const minWeightKrw = weightedAmount(
      parsed.exposure.virtualNetWorthKrw,
      bucketPolicy.minWeightRatio
    );
    const maxWeightKrw = weightedAmount(
      parsed.exposure.virtualNetWorthKrw,
      bucketPolicy.maxWeightRatio
    );
    const targetGapKrw = Math.max(0, targetWeightKrw - currentExposureKrw);
    const underweightKrw = Math.max(0, minWeightKrw - currentExposureKrw);
    const overweightKrw = Math.max(0, currentExposureKrw - maxWeightKrw);
    const triggerDue = dueBuckets.has(bucketPolicy.bucket);
    const occupiedSlots =
      capacity.activePositionCount +
      capacity.pendingReservationCount +
      capacity.mandateBoundUnusedSlotCount;
    const availableSlots = Math.max(
      0,
      capacity.maximumPositionCount - occupiedSlots
    );
    const maxBandGapKrw = Math.max(0, maxWeightKrw - currentExposureKrw);

    const trigger = bucketPolicy.selectionTrigger;
    const gapBasis: BucketGapBasis =
      trigger.mode === "below_min" ? "min" : "entry_floor";
    const entryWeightKrw =
      trigger.mode === "entry_floor_on_due_cycle"
        ? weightedAmount(
            parsed.exposure.virtualNetWorthKrw,
            trigger.entryWeightRatio
          )
        : undefined;
    const entryGapKrw =
      entryWeightKrw === undefined
        ? undefined
        : Math.max(0, entryWeightKrw - currentExposureKrw);
    const gapKrw = gapBasis === "min" ? underweightKrw : entryGapKrw!;
    const selectionTriggerSatisfied =
      overweightKrw === 0 &&
      (gapBasis === "min" ? gapKrw > 0 : triggerDue && gapKrw > 0);
    const maximumAdditionalExposureKrw =
      selectionTriggerSatisfied && availableSlots > 0
      ? Math.min(gapKrw, maxBandGapKrw, cashOpeningCapacityKrw)
      : 0;
    const blockingReasons: BucketPortfolioGap["blockingReasons"] = [];
    if (!selectionTriggerSatisfied) {
      blockingReasons.push("trigger_not_satisfied");
    }
    if (overweightKrw > 0) {
      blockingReasons.push("overweight");
    }
    if (availableSlots === 0) {
      blockingReasons.push("no_available_slot");
    }
    if (cashOpeningCapacityKrw === 0) {
      blockingReasons.push("cash_opening_capacity_exhausted");
    }
    if (
      selectionTriggerSatisfied &&
      availableSlots > 0 &&
      cashOpeningCapacityKrw > 0 &&
      maximumAdditionalExposureKrw === 0
    ) {
      blockingReasons.push("no_buy_capacity");
    }

    return deepFreeze({
      bucket: bucketPolicy.bucket,
      currentExposureKrw,
      currentWeightRatio: ratio(
        currentExposureKrw,
        parsed.exposure.virtualNetWorthKrw
      ),
      targetWeightKrw,
      minWeightKrw,
      maxWeightKrw,
      targetGapKrw,
      underweightKrw,
      overweightKrw,
      ...(entryWeightKrw === undefined ? {} : { entryWeightKrw }),
      ...(entryGapKrw === undefined ? {} : { entryGapKrw }),
      triggerDue,
      selectionTriggerSatisfied,
      gapBasis,
      gapKrw,
      availableSlots,
      maximumAdditionalExposureKrw,
      requestEligible:
        selectionTriggerSatisfied &&
        availableSlots > 0 &&
        maximumAdditionalExposureKrw > 0,
      blockingReasons
    });
  });

  return deepFreeze({
    mode: "paper_only",
    portfolioId: parsed.exposure.portfolioId,
    policyHash: parsed.exposure.policyHash,
    virtualNetWorthKrw: parsed.exposure.virtualNetWorthKrw,
    cashKrw: parsed.exposure.cashKrw,
    minimumCashReserveKrw,
    pendingBuyExposureKrw: parsed.exposure.pendingBuyExposureKrw,
    cashOpeningCapacityKrw,
    bucketGaps
  });
}

function assertScope(
  policy: RuntimePortfolioPolicyRecord,
  exposure: z.infer<typeof portfolioGapExposureSchema>
): void {
  if (
    exposure.portfolioId !== policy.portfolioId ||
    exposure.policyHash !== policy.policyHash
  ) {
    throw new Error("portfolio gap exposure scope does not match active policy");
  }
}

function canonicalBucketMap<Value extends { bucket: StrategyBucket }>(
  values: readonly Value[],
  label: string
): Map<StrategyBucket, Value> {
  const canonical = [...values].sort(
    (left, right) =>
      bucketOrdinal(left.bucket) - bucketOrdinal(right.bucket)
  );
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error(`${label} must use canonical bucket order`);
  }
  const result = new Map<StrategyBucket, Value>();
  for (const value of canonical) {
    if (result.has(value.bucket)) {
      throw new Error(`${label} must contain each bucket exactly once`);
    }
    result.set(value.bucket, value);
  }
  if (result.size !== strategyBucketSchema.options.length) {
    throw new Error(`${label} must contain each bucket exactly once`);
  }
  return result;
}

function canonicalDueBuckets(
  values: readonly StrategyBucket[]
): ReadonlySet<StrategyBucket> {
  const canonical = [...values].sort(
    (left, right) => bucketOrdinal(left) - bucketOrdinal(right)
  );
  if (!isDeepStrictEqual(values, canonical)) {
    throw new Error("due buckets must use canonical bucket order");
  }
  const result = new Set(canonical);
  if (result.size !== canonical.length) {
    throw new Error("due buckets must not contain duplicates");
  }
  return result;
}

function requiredBucketValue<Value>(
  values: ReadonlyMap<StrategyBucket, Value>,
  bucket: StrategyBucket
): Value {
  const value = values.get(bucket);
  if (value === undefined) {
    throw new Error(`missing bucket value: ${bucket}`);
  }
  return value;
}

function weightedAmount(total: number, ratioValue: number): number {
  return Math.round(total * ratioValue);
}

function ratio(value: number, denominator: number): number {
  return denominator > 0 ? Number((value / denominator).toFixed(12)) : 0;
}

function bucketOrdinal(bucket: StrategyBucket): number {
  return strategyBucketSchema.options.indexOf(bucket);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
