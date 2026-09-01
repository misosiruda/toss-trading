import {
  type BucketEquityEvent,
  parseBucketEquityEvent
} from "./bucketEquity.js";
import {
  type BucketDrawdownSemanticsRecord,
  type StrategyBucketRuntimePolicy
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import {
  type PortfolioPolicyActivatedEvent,
  parsePortfolioPolicyActivationEvent
} from "./runtimePortfolioPolicyActivation.js";
import {
  type RuntimePortfolioPolicyRecord,
  validateRuntimePortfolioPolicyDependencies
} from "./runtimePortfolioPolicy.js";

type EpochInitializedEvent = Extract<
  BucketEquityEvent,
  { eventType: "epoch_initialized" }
>;

export interface ResolvedBucketEquityEpochInitialization {
  event: EpochInitializedEvent;
  activation: PortfolioPolicyActivatedEvent;
  policy: RuntimePortfolioPolicyRecord;
  bucketPolicy: StrategyBucketRuntimePolicy;
  drawdownSemantics: BucketDrawdownSemanticsRecord;
}

/**
 * Resolves one epoch initialization against an already active policy pair.
 *
 * Callers must obtain `activePolicy` from the activation history resolver for
 * the event timestamp. This function independently rehashes that activation,
 * runtime policy, and immutable drawdown dependency before comparing lineage.
 */
export function resolveBucketEquityEpochInitialization(input: {
  value: unknown;
  activePolicy: unknown;
  dependencies: ImmutablePolicyDependencyRepository;
}): ResolvedBucketEquityEpochInitialization {
  const event = parseBucketEquityEvent(input.value);
  if (event.eventType !== "epoch_initialized") {
    throw new Error("bucket equity epoch initialization event is required");
  }
  const activePolicy = parseActivePolicyPair(
    input.activePolicy,
    input.dependencies
  );
  const { activation, policy } = activePolicy;
  if (
    activation.portfolioId !== policy.portfolioId ||
    activation.policyRecordId !== policy.runtimePolicyRecordId ||
    activation.policyId !== policy.policyId ||
    activation.policyVersion !== policy.version ||
    activation.policyHash !== policy.policyHash ||
    activation.policyLineageHash !== policy.lineageHash
  ) {
    throw new Error("active runtime policy pair identity mismatch");
  }
  if (event.activationId !== activation.activationId) {
    throw new Error("bucket equity epoch activation ID mismatch");
  }
  if (event.asOf !== activation.effectiveFrom) {
    throw new Error(
      "bucket equity epoch asOf must equal policy activation effectiveFrom"
    );
  }
  if (
    event.portfolioId !== policy.portfolioId ||
    event.policyHash !== policy.policyHash
  ) {
    throw new Error("bucket equity epoch runtime policy scope mismatch");
  }
  const bucketPolicy = policy.strategyBuckets.find(
    (candidate) => candidate.bucket === event.bucket
  );
  if (bucketPolicy === undefined) {
    throw new Error("bucket equity epoch bucket policy does not resolve");
  }
  const drawdownSemantics = input.dependencies.resolveDrawdownSemantics(
    bucketPolicy.drawdownSemanticsRef
  );
  if (event.drawdownSemanticsHash !== drawdownSemantics.hash) {
    throw new Error("bucket equity epoch drawdown semantics hash mismatch");
  }
  return Object.freeze({
    event,
    activation,
    policy,
    bucketPolicy,
    drawdownSemantics
  });
}

function parseActivePolicyPair(
  value: unknown,
  dependencies: ImmutablePolicyDependencyRepository
): {
  activation: PortfolioPolicyActivatedEvent;
  policy: RuntimePortfolioPolicyRecord;
} {
  if (value === null || typeof value !== "object") {
    throw new Error("active runtime policy pair is required");
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "activation" ||
    keys[1] !== "policy"
  ) {
    throw new Error("active runtime policy pair must be canonical");
  }
  const activationEvent = parsePortfolioPolicyActivationEvent(
    candidate.activation
  );
  if (activationEvent.eventType !== "activated") {
    throw new Error("active runtime policy activation event is required");
  }
  return Object.freeze({
    activation: activationEvent,
    policy: validateRuntimePortfolioPolicyDependencies(
      candidate.policy,
      dependencies
    )
  });
}
