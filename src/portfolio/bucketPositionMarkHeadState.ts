import {
  type BucketPositionMarkHeadEvent,
  type BucketPositionMarkHeadState,
  createBucketPositionMarkHeadState,
  parseBucketPositionMarkHeadEvent
} from "./bucketPositionMarkHead.js";
import { compareText } from "./runtimePolicyContracts.js";

export interface BucketPositionMarkHeadHistorySnapshot {
  events: readonly BucketPositionMarkHeadEvent[];
  states: readonly BucketPositionMarkHeadState[];
}

/**
 * Rehashes and folds the complete append-only position mark-head history.
 *
 * External fill, valuation, migration, price-evidence, and bucket-equity
 * resolution belongs to the coordinator that owns those repositories.
 */
export function foldBucketPositionMarkHeadHistory(
  values: readonly unknown[]
): BucketPositionMarkHeadHistorySnapshot {
  const events = values.map((value) => parseBucketPositionMarkHeadEvent(value));
  const eventIds = new Set<string>();
  const originKeys = new Set<string>();
  const states = new Map<string, BucketPositionMarkHeadState>();
  const lastCreatedAtByScope = new Map<string, string>();

  for (const event of events) {
    if (eventIds.has(event.positionMarkHeadEventId)) {
      throw new Error("position mark head history contains a duplicate event ID");
    }
    eventIds.add(event.positionMarkHeadEventId);

    const key = scopeKey(event);
    const current = states.get(key);
    const lastCreatedAt = lastCreatedAtByScope.get(key);
    if (
      lastCreatedAt !== undefined &&
      Date.parse(event.createdAt) < Date.parse(lastCreatedAt)
    ) {
      throw new Error("position mark head createdAt cannot move backward");
    }
    if (
      event.eventType === "initialized" ||
      event.eventType === "bucket_transfer_in"
    ) {
      assertRootTransition(current, event);
      assertUniqueOrigin(originKeys, event);
      states.set(key, stateFromRoot(event));
      lastCreatedAtByScope.set(key, event.createdAt);
      continue;
    }

    if (current === undefined) {
      throw new Error("position mark head event appears before initialization");
    }
    if (current.quantity === 0) {
      throw new Error("closed position mark head requires a new root event");
    }
    if (
      event.previousPositionMarkHeadEventId !==
        current.lastPositionMarkHeadEventId ||
      event.previousPositionMarkHeadEventHash !==
        current.lastPositionMarkHeadEventHash
    ) {
      throw new Error("position mark head predecessor does not match current head");
    }
    if (Date.parse(event.asOf) < Date.parse(current.asOf)) {
      throw new Error("position mark head asOf cannot move backward");
    }
    assertChainedTransition(current, event);
    assertUniqueOrigin(originKeys, event);
    states.set(key, stateFromChainedEvent(current, event));
    lastCreatedAtByScope.set(key, event.createdAt);
  }

  const canonicalStates = [...states.values()].sort(compareStates);
  return Object.freeze({
    events: Object.freeze(events),
    states: Object.freeze(canonicalStates)
  });
}

function assertRootTransition(
  current: BucketPositionMarkHeadState | undefined,
  event: Extract<
    BucketPositionMarkHeadEvent,
    { eventType: "initialized" | "bucket_transfer_in" }
  >
): void {
  if (current !== undefined && current.quantity !== 0) {
    throw new Error("active position mark head cannot accept another root event");
  }
  if (
    current !== undefined &&
    Date.parse(event.asOf) < Date.parse(current.asOf)
  ) {
    throw new Error("position mark head root asOf cannot move backward");
  }
}

function assertChainedTransition(
  current: BucketPositionMarkHeadState,
  event: Exclude<
    BucketPositionMarkHeadEvent,
    { eventType: "initialized" | "bucket_transfer_in" }
  >
): void {
  if (event.eventType === "valuation_applied") {
    if (Date.parse(event.asOf) <= Date.parse(current.asOf)) {
      throw new Error("position valuation must advance the mark interval");
    }
    if (event.resultingQuantity !== current.quantity) {
      throw new Error("position valuation cannot change quantity");
    }
    return;
  }
  if (
    event.resultingPriceKrw !== current.currentPriceKrw ||
    event.resultingPriceEvidenceRef !== current.currentPriceEvidenceRef
  ) {
    throw new Error(
      "position mutation or transfer cannot change the accepted mark basis"
    );
  }
  if (event.eventType === "position_mutation_applied") {
    if (event.resultingQuantity === current.quantity) {
      throw new Error("position mutation must change quantity");
    }
    return;
  }
  if (event.resultingQuantity !== 0) {
    throw new Error("bucket transfer out must close the source mark head");
  }
}

function stateFromRoot(
  event: Extract<
    BucketPositionMarkHeadEvent,
    { eventType: "initialized" | "bucket_transfer_in" }
  >
): BucketPositionMarkHeadState {
  return createBucketPositionMarkHeadState({
    ...stateBase(event),
    ...(event.eventType === "bucket_transfer_in"
      ? { lastPositionMutationRef: event.migrationRecordId }
      : event.initializationOrigin.originKind === "position_opening_fill"
        ? { lastPositionMutationRef: event.initializationOrigin.fillId }
        : {})
  });
}

function stateFromChainedEvent(
  current: BucketPositionMarkHeadState,
  event: Exclude<
    BucketPositionMarkHeadEvent,
    { eventType: "initialized" | "bucket_transfer_in" }
  >
): BucketPositionMarkHeadState {
  const previousOrigins = {
    ...(current.lastValuationMarkRecordId === undefined
      ? {}
      : {
          lastValuationMarkRecordId: current.lastValuationMarkRecordId,
          lastValuationMarkHash: current.lastValuationMarkHash
        }),
    ...(current.lastPositionMutationRef === undefined
      ? {}
      : { lastPositionMutationRef: current.lastPositionMutationRef })
  };
  if (event.eventType === "valuation_applied") {
    return createBucketPositionMarkHeadState({
      ...stateBase(event),
      ...previousOrigins,
      lastValuationMarkRecordId: event.bucketValuationMarkRecordId,
      lastValuationMarkHash: event.valuationMarkHash
    });
  }
  return createBucketPositionMarkHeadState({
    ...stateBase(event),
    ...previousOrigins,
    lastPositionMutationRef:
      event.eventType === "bucket_transfer_out"
        ? event.migrationRecordId
        : mutationOriginRef(event)
  });
}

function stateBase(event: BucketPositionMarkHeadEvent) {
  return {
    portfolioId: event.portfolioId,
    bucket: event.bucket,
    market: event.market,
    symbol: event.symbol,
    quantity: event.resultingQuantity,
    currentPriceKrw: event.resultingPriceKrw,
    currentPriceEvidenceRef: event.resultingPriceEvidenceRef,
    lastPositionMarkHeadEventId: event.positionMarkHeadEventId,
    lastPositionMarkHeadEventHash: event.positionMarkHeadEventHash,
    asOf: event.asOf
  };
}

function mutationOriginRef(
  event: Extract<
    BucketPositionMarkHeadEvent,
    { eventType: "position_mutation_applied" }
  >
): string {
  return event.mutationOrigin.originKind === "paper_fill"
    ? event.mutationOrigin.fillId
    : event.mutationOrigin.migrationRecordId;
}

function assertUniqueOrigin(
  origins: Set<string>,
  event: BucketPositionMarkHeadEvent
): void {
  const key = eventOriginKey(event);
  if (origins.has(key)) {
    throw new Error("position mark head history contains a duplicate origin");
  }
  origins.add(key);
}

function eventOriginKey(event: BucketPositionMarkHeadEvent): string {
  const scope = scopeKey(event);
  switch (event.eventType) {
    case "initialized":
      return JSON.stringify([
        scope,
        event.eventType,
        event.initializationOrigin.originKind,
        event.initializationOrigin.originKind === "position_opening_fill"
          ? event.initializationOrigin.fillId
          : event.initializationOrigin.observedPositionRef
      ]);
    case "valuation_applied":
      return JSON.stringify([
        scope,
        event.eventType,
        event.bucketValuationMarkRecordId
      ]);
    case "position_mutation_applied":
      return JSON.stringify([
        scope,
        event.eventType,
        event.mutationOrigin.originKind,
        mutationOriginRef(event)
      ]);
    case "bucket_transfer_out":
    case "bucket_transfer_in":
      return JSON.stringify([
        scope,
        event.eventType,
        event.migrationRecordId,
        event.transferGroupId
      ]);
  }
}

function compareStates(
  left: BucketPositionMarkHeadState,
  right: BucketPositionMarkHeadState
): number {
  return (
    compareText(left.portfolioId, right.portfolioId) ||
    compareText(left.bucket, right.bucket) ||
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol)
  );
}

function scopeKey(value: {
  portfolioId: string;
  bucket: string;
  market: string;
  symbol: string;
}): string {
  return JSON.stringify([
    value.portfolioId,
    value.bucket,
    value.market,
    value.symbol
  ]);
}
