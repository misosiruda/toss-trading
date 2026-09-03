import { isDeepStrictEqual } from "node:util";

import {
  strategyBucketSchema,
  type StrategyBucket
} from "../domain/schemas.js";
import {
  parseBucketSelectionRequest,
  type BucketSelectionRequest
} from "./bucketSelectionRequest.js";
import {
  analyzePortfolioGaps,
  type BucketPortfolioGap,
  type PortfolioGapAnalysis,
  type PortfolioGapAnalysisInput
} from "./portfolioGapAnalyzer.js";
import {
  resolvePortfolioSizingSnapshot,
  type ResolvedPortfolioSizingSnapshot
} from "./portfolioSizingSnapshotResolver.js";
import type { StrategyBucketRuntimePolicy } from "./runtimePolicyContracts.js";
import {
  resolvePortfolioCycleTrigger,
  type PortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";
import {
  parseRuntimePortfolioPolicyRecord,
  type RuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";

export type BucketSelectionOpeningCapacity =
  PortfolioGapAnalysisInput["exposure"]["bucketOpeningCapacities"][number];

export interface ResolvedBucketSelectionRequest {
  request: BucketSelectionRequest;
  sizingSnapshot: ResolvedPortfolioSizingSnapshot["snapshot"];
  verifiedExposure: ResolvedPortfolioSizingSnapshot["verifiedExposure"];
  policy: RuntimePortfolioPolicyRecord;
  bucketPolicy: StrategyBucketRuntimePolicy;
  cycleTrigger: ResolvedPortfolioCycleTrigger;
  analysis: PortfolioGapAnalysis;
  gap: BucketPortfolioGap;
}

/**
 * Resolves a stored selection request against immutable sizing and policy data.
 *
 * `activePolicy` must be obtained by an activation-aware caller for the request
 * timestamp. Opening-capacity counts must come from the mandate/reservation
 * replay boundary. The trigger must already be resolved against its immutable
 * source artifact by the caller; this function independently derives and
 * compares its canonical identity, reference, and evidence cutoff.
 */
export function resolveBucketSelectionRequest(input: {
  value: unknown;
  sizingSnapshot: unknown;
  activePolicy: unknown;
  cycleTrigger: unknown;
  bucketOpeningCapacities: readonly BucketSelectionOpeningCapacity[];
}): ResolvedBucketSelectionRequest {
  const request = parseBucketSelectionRequest(input.value);
  const resolvedSnapshot = resolvePortfolioSizingSnapshot(
    input.sizingSnapshot
  );
  const policy = parseRuntimePortfolioPolicyRecord(input.activePolicy);
  const cycleTrigger = resolvePortfolioCycleTrigger(input.cycleTrigger);
  assertSnapshotBinding(request, resolvedSnapshot.snapshot);
  assertPolicyBinding(request, policy);

  const bucketPolicy = resolveBucketPolicy(policy, request.bucket);
  assertTriggerBinding(request, bucketPolicy, cycleTrigger);
  const analysis = analyzePortfolioGaps({
    policy,
    exposure: {
      portfolioId: request.portfolioId,
      policyHash: request.policyHash,
      virtualNetWorthKrw:
        resolvedSnapshot.snapshot.exposureSnapshot.virtualNetWorthKrw,
      cashKrw: resolvedSnapshot.snapshot.exposureSnapshot.cashKrw,
      pendingBuyExposureKrw:
        resolvedSnapshot.snapshot.exposureSnapshot.pendingBuyExposureKrw,
      bucketExposures: strategyBucketSchema.options.map((bucket) => ({
        bucket,
        exposureKrw:
          resolvedSnapshot.snapshot.exposureSnapshot.bucketExposureKrw[
            bucket
          ]
      })),
      bucketOpeningCapacities: [...input.bucketOpeningCapacities]
    },
    dueBuckets:
      bucketPolicy.selectionTrigger.mode === "entry_floor_on_due_cycle"
        ? [request.bucket]
        : []
  });
  const gap = resolveBucketGap(analysis, request.bucket);
  if (!gap.requestEligible) {
    throw new Error("bucket selection request is not eligible after gap replay");
  }
  if (
    !isDeepStrictEqual(
      {
        gapBasis: request.gapBasis,
        gapKrw: request.gapKrw,
        availableSlots: request.availableSlots,
        maximumAdditionalExposureKrw:
          request.maximumAdditionalExposureKrw
      },
      {
        gapBasis: gap.gapBasis,
        gapKrw: gap.gapKrw,
        availableSlots: gap.availableSlots,
        maximumAdditionalExposureKrw: gap.maximumAdditionalExposureKrw
      }
    )
  ) {
    throw new Error(
      "bucket selection request gap, slot, or capacity does not match replay"
    );
  }

  return deepFreeze({
    request,
    sizingSnapshot: resolvedSnapshot.snapshot,
    verifiedExposure: resolvedSnapshot.verifiedExposure,
    policy,
    bucketPolicy,
    cycleTrigger,
    analysis,
    gap
  });
}

function assertTriggerBinding(
  request: BucketSelectionRequest,
  bucketPolicy: StrategyBucketRuntimePolicy,
  resolved: ResolvedPortfolioCycleTrigger
): void {
  if (
    request.triggerIdentity !== resolved.triggerIdentity ||
    request.triggerRef !== resolved.triggerRef ||
    request.evidenceCutoffAt !== resolved.evidenceCutoffAt
  ) {
    throw new Error("bucket selection request trigger binding mismatch");
  }
  assertTriggerCompatibility(bucketPolicy, resolved.trigger);
}

function assertTriggerCompatibility(
  bucketPolicy: StrategyBucketRuntimePolicy,
  trigger: PortfolioCycleTrigger
): void {
  if (trigger.triggerKind === "risk_breach") {
    throw new Error(
      "risk-breach cycle cannot create a bucket selection request"
    );
  }
  if (trigger.triggerKind === "scheduled") {
    if (
      bucketPolicy.reviewCadence.mode !== "scheduled" ||
      !bucketPolicy.reviewCadence.boundaryRefs.some(
        (reference) => reference.hash === trigger.scheduleBoundaryHash
      )
    ) {
      throw new Error(
        "scheduled cycle trigger does not match bucket review cadence"
      );
    }
    return;
  }
  if (trigger.triggerKind === "every_tick") {
    if (bucketPolicy.reviewCadence.mode !== "every_tick") {
      throw new Error(
        "every-tick cycle trigger does not match bucket review cadence"
      );
    }
    return;
  }
  if (
    trigger.triggerKind === "policy_event" &&
    !bucketPolicy.eventTriggers.includes(trigger.eventType)
  ) {
    throw new Error("policy event trigger is not enabled for bucket");
  }
}

function assertSnapshotBinding(
  request: BucketSelectionRequest,
  snapshot: ResolvedPortfolioSizingSnapshot["snapshot"]
): void {
  if (
    request.portfolioSnapshotId !== snapshot.portfolioSnapshotId ||
    request.portfolioSnapshotHash !== snapshot.portfolioSnapshotHash
  ) {
    throw new Error("bucket selection request snapshot identity mismatch");
  }
  if (
    request.portfolioId !== snapshot.portfolioId ||
    request.policyHash !== snapshot.policyHash ||
    request.asOf !== snapshot.asOf
  ) {
    throw new Error("bucket selection request snapshot scope mismatch");
  }
}

function assertPolicyBinding(
  request: BucketSelectionRequest,
  policy: RuntimePortfolioPolicyRecord
): void {
  if (
    request.portfolioId !== policy.portfolioId ||
    request.policyHash !== policy.policyHash
  ) {
    throw new Error("bucket selection request active policy mismatch");
  }
  if (Date.parse(policy.createdAt) > Date.parse(request.asOf)) {
    throw new Error("bucket selection request predates its runtime policy");
  }
}

function resolveBucketPolicy(
  policy: RuntimePortfolioPolicyRecord,
  bucket: StrategyBucket
): StrategyBucketRuntimePolicy {
  const matches = policy.strategyBuckets.filter(
    (candidate) => candidate.bucket === bucket
  );
  if (matches.length !== 1) {
    throw new Error("bucket selection request policy does not resolve exactly once");
  }
  return matches[0] as StrategyBucketRuntimePolicy;
}

function resolveBucketGap(
  analysis: PortfolioGapAnalysis,
  bucket: StrategyBucket
): BucketPortfolioGap {
  const matches = analysis.bucketGaps.filter(
    (candidate) => candidate.bucket === bucket
  );
  if (matches.length !== 1) {
    throw new Error("bucket selection request gap does not resolve exactly once");
  }
  return matches[0] as BucketPortfolioGap;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
