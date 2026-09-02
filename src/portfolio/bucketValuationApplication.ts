import {
  type BucketEquityEvent,
  type BucketRiskState,
  createBucketEquityEvent,
  parseBucketRiskState
} from "./bucketEquity.js";
import { applyBucketEquityEventToCurrentState } from "./bucketEquityState.js";
import {
  type BucketPositionMarkHeadEvent,
  createBucketPositionMarkHeadEvent,
  parseBucketPositionMarkHeadEvent
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
  currentPositionHeadEvents: readonly BucketPositionMarkHeadEvent[];
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
  currentPositionEvents: readonly unknown[];
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
  const currentPositionHeadEvents = resolveCurrentPositionHeadEvents(
    origins,
    input.currentPositionEvents
  );

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
  const positionMarkHeadEvents = origins.positions.map((position, index) =>
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
        createdAt: laterCreatedAt(
          origins.record.createdAt,
          currentPositionHeadEvents[index]!.createdAt
        )
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
    currentPositionHeadEvents,
    bucketEquityEvent,
    resultingRiskState,
    positionMarkHeadEvents
  });
}

function resolveCurrentPositionHeadEvents(
  origins: ResolvedBucketValuationMarkOrigins,
  values: readonly unknown[]
): readonly BucketPositionMarkHeadEvent[] {
  if (values.length !== origins.positions.length) {
    throw new Error(
      "bucket valuation current position events must form the complete active set"
    );
  }
  const eventsById = new Map<string, BucketPositionMarkHeadEvent>();
  for (const value of values) {
    const event = parseBucketPositionMarkHeadEvent(value);
    if (eventsById.has(event.positionMarkHeadEventId)) {
      throw new Error(
        "bucket valuation current position events contain a duplicate event ID"
      );
    }
    eventsById.set(event.positionMarkHeadEventId, event);
  }
  const events = origins.positions.map((position) => {
    const event = eventsById.get(
      position.previousHead.lastPositionMarkHeadEventId
    );
    if (event === undefined) {
      throw new Error(
        "bucket valuation current position event is unresolved"
      );
    }
    assertCurrentPositionHeadEventMatches(position.previousHead, event);
    return event;
  });
  return Object.freeze(events);
}

function assertCurrentPositionHeadEventMatches(
  state: ResolvedBucketValuationMarkOrigins["positions"][number]["previousHead"],
  event: BucketPositionMarkHeadEvent
): void {
  if (
    event.positionMarkHeadEventHash !== state.lastPositionMarkHeadEventHash ||
    event.portfolioId !== state.portfolioId ||
    event.bucket !== state.bucket ||
    event.market !== state.market ||
    event.symbol !== state.symbol ||
    event.resultingQuantity !== state.quantity ||
    event.resultingPriceKrw !== state.currentPriceKrw ||
    event.resultingPriceEvidenceRef !== state.currentPriceEvidenceRef ||
    event.asOf !== state.asOf
  ) {
    throw new Error(
      "bucket valuation current position event does not match its head state"
    );
  }
}

function laterCreatedAt(markCreatedAt: string, headCreatedAt: string): string {
  return Date.parse(markCreatedAt) >= Date.parse(headCreatedAt)
    ? markCreatedAt
    : headCreatedAt;
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
  if (state.units === 0) {
    throw new Error(
      "bucket valuation active positions cannot use an empty risk epoch"
    );
  }
  if (Date.parse(state.asOf) > Date.parse(origins.record.asOf)) {
    throw new Error("bucket valuation risk state is ahead of the mark");
  }
  if (
    origins.positions.some(
      (position) =>
        Date.parse(state.asOf) < Date.parse(position.previousHead.asOf)
    )
  ) {
    throw new Error(
      "bucket valuation risk state predates a position mark head"
    );
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
