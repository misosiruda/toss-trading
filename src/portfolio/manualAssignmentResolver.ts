import { isDeepStrictEqual } from "node:util";

import {
  type InvestmentMandateRecord,
  type ManualAssignmentEvent,
  parseInvestmentMandateRecord,
  parseManualAssignmentEvent
} from "./investmentMandate.js";
import {
  type RuntimePortfolioPolicyRecord,
  parseRuntimePortfolioPolicyRecord
} from "./runtimePortfolioPolicy.js";
import {
  type BucketSelectionPolicyRecord,
  type StrategyBucketRuntimePolicy,
  parseBucketSelectionPolicyRecord
} from "./runtimePolicyContracts.js";

export interface ResolvedManualAssignmentPolicyBinding {
  event: ManualAssignmentEvent;
  policy: RuntimePortfolioPolicyRecord;
  bucketPolicy: StrategyBucketRuntimePolicy;
  selectionPolicy: BucketSelectionPolicyRecord;
}

export interface ResolvedManualMandateAssignmentBinding {
  event: ManualAssignmentEvent;
  mandate: Extract<
    InvestmentMandateRecord,
    { assignmentSource: "manual_policy" }
  >;
}

/**
 * Verifies the exact runtime policy and bucket selection policy supplied by an
 * activation-aware caller. Evidence observations and opening sizing records
 * remain separate immutable dependencies and are not inferred here.
 */
export function resolveManualAssignmentPolicyBinding(input: {
  value: unknown;
  activePolicy: unknown;
  selectionPolicy: unknown;
}): ResolvedManualAssignmentPolicyBinding {
  const event = parseManualAssignmentEvent(input.value);
  const policy = parseRuntimePortfolioPolicyRecord(input.activePolicy);
  const selectionPolicy = parseBucketSelectionPolicyRecord(
    input.selectionPolicy
  );
  if (
    event.portfolioId !== policy.portfolioId ||
    event.policyHash !== policy.policyHash
  ) {
    throw new Error("manual assignment does not match the active policy");
  }
  const bucketPolicies = policy.strategyBuckets.filter(
    (candidate) => candidate.bucket === event.bucket
  );
  if (bucketPolicies.length !== 1) {
    throw new Error("manual assignment bucket policy does not resolve exactly once");
  }
  const bucketPolicy = bucketPolicies[0] as StrategyBucketRuntimePolicy;
  if (!bucketPolicy.enabledMarkets.includes(event.market)) {
    throw new Error("manual assignment market is disabled for its bucket");
  }
  if (
    selectionPolicy.bucket !== event.bucket ||
    event.selectionPolicyRecordId !==
      bucketPolicy.selectionPolicyRef.selectionPolicyRecordId ||
    event.selectionPolicyHash !== bucketPolicy.selectionPolicyRef.hash ||
    selectionPolicy.selectionPolicyRecordId !==
      bucketPolicy.selectionPolicyRef.selectionPolicyRecordId ||
    selectionPolicy.version !== bucketPolicy.selectionPolicyRef.version ||
    selectionPolicy.hash !== bucketPolicy.selectionPolicyRef.hash ||
    selectionPolicy.lineageHash !== bucketPolicy.selectionPolicyRef.lineageHash
  ) {
    throw new Error(
      "manual assignment selection policy lineage does not match the active bucket"
    );
  }
  return deepFreeze({ event, policy, bucketPolicy, selectionPolicy });
}

/**
 * Binds one previously stored manual assignment event to a proposed mandate.
 * Opening reservation record resolution is intentionally left to the capacity
 * ledger coordinator; this function only accepts the exact reserved notional
 * already carried by the mandate lineage.
 */
export function resolveManualMandateAssignmentBinding(input: {
  mandate: unknown;
  manualAssignmentEvent: unknown;
}): ResolvedManualMandateAssignmentBinding {
  const parsedMandate = parseInvestmentMandateRecord(input.mandate);
  const event = parseManualAssignmentEvent(input.manualAssignmentEvent);
  if (parsedMandate.assignmentSource !== "manual_policy") {
    throw new Error("manual assignment cannot bind a selector mandate");
  }
  if (
    parsedMandate.manualAssignmentEventId !== event.manualAssignmentEventId ||
    parsedMandate.manualAuthorizationScope !== event.authorizationScope
  ) {
    throw new Error("manual mandate authorization lineage does not match");
  }
  if (
    parsedMandate.portfolioId !== event.portfolioId ||
    parsedMandate.policyHash !== event.policyHash ||
    parsedMandate.market !== event.market ||
    parsedMandate.symbol !== event.symbol ||
    parsedMandate.bucket !== event.bucket ||
    parsedMandate.asOf !== event.asOf ||
    parsedMandate.evidenceAsOf !== event.evidenceAsOf ||
    !isDeepStrictEqual(parsedMandate.reasonCodes, event.reasonCodes) ||
    !isDeepStrictEqual(parsedMandate.evidenceRefs, event.evidenceRefs)
  ) {
    throw new Error("manual mandate scope or evidence does not match its event");
  }
  if (event.authorizationScope === "classify_existing_reduce_only") {
    if (
      parsedMandate.manualAuthorizationScope !==
        "classify_existing_reduce_only" ||
      parsedMandate.minWeightRatio !== event.classificationMinWeightRatio ||
      parsedMandate.targetWeightRatio !==
        event.classificationTargetWeightRatio ||
      parsedMandate.maxWeightRatio !== event.classificationMaxWeightRatio ||
      parsedMandate.maximumOpeningNotionalKrw !== 0
    ) {
      throw new Error("manual classification range does not match its event");
    }
  } else {
    if (parsedMandate.manualAuthorizationScope !== "open_or_increase") {
      throw new Error("manual opening authorization scope does not match");
    }
    if (
      parsedMandate.minWeightRatio !== event.minWeightRatio ||
      parsedMandate.targetWeightRatio !== event.targetWeightRatio ||
      parsedMandate.maxWeightRatio !== event.maxWeightRatio
    ) {
      throw new Error("manual opening range does not match its event");
    }
    const reservedMaximumNotionalKrw =
      parsedMandate.capacityReservation.reservedMaximumNotionalKrw;
    if (
      reservedMaximumNotionalKrw <= 0 ||
      parsedMandate.maximumOpeningNotionalKrw !==
        reservedMaximumNotionalKrw ||
      reservedMaximumNotionalKrw > event.maximumNotionalKrw
    ) {
      throw new Error("manual opening reserved notional is invalid");
    }
  }
  return deepFreeze({ event, mandate: parsedMandate });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
