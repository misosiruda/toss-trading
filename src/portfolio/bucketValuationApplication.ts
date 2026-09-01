import {
  type BucketEquityEvent,
  type BucketRiskState,
  createBucketEquityEvent,
  parseBucketRiskState
} from "./bucketEquity.js";
import { applyBucketEquityEventToCurrentState } from "./bucketEquityState.js";
import {
  type BucketPositionMarkHeadEvent,
  createBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import {
  type ResolvedBucketValuationMarkOrigins,
  resolveBucketValuationMarkOrigins
} from "./bucketValuationMarkOriginResolver.js";

export type BucketValuationEquityEvent = Extract<
  BucketEquityEvent,
  { eventType: "valuation" }
>;

export type BucketValuationPositionMarkHeadEvent = Extract<
  BucketPositionMarkHeadEvent,
  { eventType: "valuation_applied" }
>;

export interface ResolvedBucketValuationApplication
  extends ResolvedBucketValuationMarkOrigins {
  currentRiskState: BucketRiskState;
  bucketEquityEvent: BucketValuationEquityEvent;
  resultingRiskState: BucketRiskState;
  positionMarkHeadEvents: readonly BucketValuationPositionMarkHeadEvent[];
}

/**
 * Projects one verified valuation mark into its complete deterministic events.
 *
 * Persistence remains the responsibility of the atomic repository coordinator.
 * This function performs no file, broker, network, or order mutation.
 */
export function resolveBucketValuationApplication(input: {
  value: unknown;
  currentPositionStates: readonly unknown[];
  currentPriceEvidence: readonly unknown[];
  currentRiskState: unknown;
}): ResolvedBucketValuationApplication {
  const origins = resolveBucketValuationMarkOrigins({
    value: input.value,
    currentStates: input.currentPositionStates,
    currentPriceEvidence: input.currentPriceEvidence
  });
  const currentRiskState = parseBucketRiskState(input.currentRiskState);
  assertRiskStateMatches(origins, currentRiskState);

  const bucketEquityEvent = asValuationEquityEvent(
    createBucketEquityEvent({
      eventType: "valuation",
      previousBucketEquityEventId:
        currentRiskState.lastBucketEquityEventId,
      riskStateEpochId: currentRiskState.riskStateEpochId,
      portfolioId: origins.record.portfolioId,
      bucket: origins.record.bucket,
      policyHash: origins.record.policyHash,
      equityDeltaKrw: origins.record.equityDeltaKrw,
      bucketValuationMarkRecordId:
        origins.record.bucketValuationMarkRecordId,
      valuationMarkHash: origins.record.valuationMarkHash,
      evidenceRefs: origins.positions.map(
        (position) => position.currentPriceEvidence.evidenceRef
      ),
      asOf: origins.record.asOf
    })
  );
  const positionMarkHeadEvents = origins.positions.map((position) =>
    asValuationPositionEvent(
      createBucketPositionMarkHeadEvent({
        eventType: "valuation_applied",
        portfolioId: origins.record.portfolioId,
        bucket: origins.record.bucket,
        market: position.input.market,
        symbol: position.input.symbol,
        resultingQuantity: position.input.quantity,
        resultingPriceKrw: position.input.currentPriceKrw,
        resultingPriceEvidenceRef:
          position.currentPriceEvidence.evidenceRef,
        previousPositionMarkHeadEventId:
          position.previousHead.lastPositionMarkHeadEventId,
        previousPositionMarkHeadEventHash:
          position.previousHead.lastPositionMarkHeadEventHash,
        bucketValuationMarkRecordId:
          origins.record.bucketValuationMarkRecordId,
        valuationMarkHash: origins.record.valuationMarkHash,
        bucketEquityEventId: bucketEquityEvent.bucketEquityEventId,
        bucketEquityEventHash: bucketEquityEvent.bucketEquityEventHash,
        asOf: origins.record.asOf,
        createdAt: origins.record.createdAt
      })
    )
  );
  const resultingRiskState = applyBucketEquityEventToCurrentState({
    currentState: currentRiskState,
    event: bucketEquityEvent
  });

  return deepFreeze({
    ...origins,
    currentRiskState,
    bucketEquityEvent,
    resultingRiskState,
    positionMarkHeadEvents
  });
}

function assertRiskStateMatches(
  origins: ResolvedBucketValuationMarkOrigins,
  state: BucketRiskState
): void {
  if (
    state.portfolioId !== origins.record.portfolioId ||
    state.bucket !== origins.record.bucket
  ) {
    throw new Error("bucket valuation risk state scope mismatch");
  }
  if (state.policyHash !== origins.record.policyHash) {
    throw new Error("bucket valuation risk state policy mismatch");
  }
  if (Date.parse(state.asOf) > Date.parse(origins.record.asOf)) {
    throw new Error("bucket valuation risk state is ahead of the mark");
  }
}

function asValuationEquityEvent(
  event: BucketEquityEvent
): BucketValuationEquityEvent {
  if (event.eventType !== "valuation") {
    throw new Error(
      "bucket valuation projection produced a non-valuation event"
    );
  }
  return event;
}

function asValuationPositionEvent(
  event: BucketPositionMarkHeadEvent
): BucketValuationPositionMarkHeadEvent {
  if (event.eventType !== "valuation_applied") {
    throw new Error(
      "bucket valuation projection produced a non-valuation position event"
    );
  }
  return event;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
