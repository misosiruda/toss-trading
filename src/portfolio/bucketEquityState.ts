import {
  type BucketEquityEvent,
  type BucketRiskState,
  createBucketRiskState,
  parseBucketEquityEvent,
  parseBucketRiskState
} from "./bucketEquity.js";
import { compareText } from "./runtimePolicyContracts.js";

export interface BucketEquityHistorySnapshot {
  events: readonly BucketEquityEvent[];
  states: readonly BucketRiskState[];
}

interface ScopeHistory {
  currentEpochId: string;
  state: BucketRiskState;
}

/**
 * Rehashes and folds the complete append-only bucket equity history.
 *
 * The fold deliberately validates only the event-local accounting contract.
 * Exact fill, valuation, migration, and policy origin resolution belongs to
 * the coordinator that owns those repositories.
 */
export function foldBucketEquityHistory(
  values: readonly unknown[]
): BucketEquityHistorySnapshot {
  const events = values.map((value) => parseBucketEquityEvent(value));
  const eventIds = new Set<string>();
  const epochScopes = new Map<string, string>();
  const scopes = new Map<string, ScopeHistory>();

  for (const event of events) {
    if (eventIds.has(event.bucketEquityEventId)) {
      throw new Error("bucket equity history contains a duplicate event ID");
    }
    eventIds.add(event.bucketEquityEventId);

    const key = scopeKey(event);
    const history = scopes.get(key);
    if (event.eventType === "epoch_initialized") {
      const existingEpochScope = epochScopes.get(event.riskStateEpochId);
      if (existingEpochScope !== undefined) {
        throw new Error("bucket equity history contains a duplicate epoch ID");
      }
      assertEpochInitialization(history, event);
      const state = stateFromInitialization(event);
      epochScopes.set(event.riskStateEpochId, key);
      scopes.set(key, {
        currentEpochId: event.riskStateEpochId,
        state
      });
      continue;
    }

    if (history === undefined) {
      throw new Error("bucket equity event appears before epoch initialization");
    }
    const state = applyVerifiedChainedEventToCurrentState(
      history.state,
      event
    );
    scopes.set(key, {
      currentEpochId: history.currentEpochId,
      state
    });
  }

  const states = [...scopes.values()]
    .map((history) => history.state)
    .sort(
      (left, right) =>
        compareText(left.portfolioId, right.portfolioId) ||
        compareText(left.bucket, right.bucket)
    );
  return Object.freeze({
    events: Object.freeze(events),
    states: Object.freeze(states)
  });
}

/** Replays one strict chained event against one strict current risk state. */
export function applyBucketEquityEventToCurrentState(input: {
  currentState: unknown;
  event: unknown;
}): BucketRiskState {
  const currentState = parseBucketRiskState(input.currentState);
  const event = parseBucketEquityEvent(input.event);
  if (event.eventType === "epoch_initialized") {
    throw new Error(
      "bucket equity current-state projection requires a chained event"
    );
  }
  return applyVerifiedChainedEventToCurrentState(currentState, event);
}

function assertEpochInitialization(
  history: ScopeHistory | undefined,
  event: Extract<BucketEquityEvent, { eventType: "epoch_initialized" }>
): void {
  if (history !== undefined && Date.parse(event.asOf) < Date.parse(history.state.asOf)) {
    throw new Error("bucket equity epoch asOf cannot move backward");
  }
  if (event.initializationMode === "carried_forward") {
    if (history === undefined) {
      throw new Error("carried-forward bucket equity epoch has no previous state");
    }
    if (event.previousRiskStateEpochId !== history.currentEpochId) {
      throw new Error("carried-forward bucket equity epoch is not the current epoch successor");
    }
    if (event.drawdownSemanticsHash !== history.state.drawdownSemanticsHash) {
      throw new Error("carried-forward bucket equity epoch changes drawdown semantics");
    }
    if (
      event.initialEquityKrw !== history.state.equityKrw ||
      event.initialUnits !== history.state.units ||
      event.initialUnitNavKrw !== history.state.unitNavKrw ||
      event.initialHighWaterMarkUnitNavKrw !==
        history.state.highWaterMarkUnitNavKrw
    ) {
      throw new Error("carried-forward bucket equity epoch does not preserve risk state");
    }
    return;
  }
  if (
    history !== undefined &&
    (history.state.units !== 0 || history.state.equityKrw !== 0)
  ) {
    throw new Error("initial-or-empty bucket equity epoch requires an empty previous state");
  }
}

function stateFromInitialization(
  event: Extract<BucketEquityEvent, { eventType: "epoch_initialized" }>
): BucketRiskState {
  return createBucketRiskState({
    riskStateEpochId: event.riskStateEpochId,
    portfolioId: event.portfolioId,
    bucket: event.bucket,
    policyHash: event.policyHash,
    drawdownSemanticsHash: event.drawdownSemanticsHash,
    units: event.initialUnits,
    unitNavKrw: event.initialUnitNavKrw,
    highWaterMarkUnitNavKrw: event.initialHighWaterMarkUnitNavKrw,
    equityKrw: event.initialEquityKrw,
    drawdownRatio:
      1 - event.initialUnitNavKrw / event.initialHighWaterMarkUnitNavKrw,
    lastBucketEquityEventId: event.bucketEquityEventId,
    asOf: event.asOf
  });
}

function applyChainedEvent(
  state: BucketRiskState,
  event: Exclude<BucketEquityEvent, { eventType: "epoch_initialized" }>
): BucketRiskState {
  if (
    event.eventType === "capital_flow" ||
    event.eventType === "strategy_transfer_out" ||
    event.eventType === "strategy_transfer_in"
  ) {
    return applyUnitFlow(state, event, event.amountKrw);
  }
  return applyEquityDelta(state, event, event.equityDeltaKrw);
}

function applyVerifiedChainedEventToCurrentState(
  state: BucketRiskState,
  event: Exclude<BucketEquityEvent, { eventType: "epoch_initialized" }>
): BucketRiskState {
  if (
    event.portfolioId !== state.portfolioId ||
    event.bucket !== state.bucket
  ) {
    throw new Error("bucket equity event scope does not match current state");
  }
  if (event.riskStateEpochId !== state.riskStateEpochId) {
    throw new Error("bucket equity event does not target the current epoch");
  }
  if (event.previousBucketEquityEventId !== state.lastBucketEquityEventId) {
    throw new Error(
      "bucket equity event predecessor does not match current head"
    );
  }
  if (event.policyHash !== state.policyHash) {
    throw new Error("bucket equity event policy does not match current epoch");
  }
  if (Date.parse(event.asOf) < Date.parse(state.asOf)) {
    throw new Error("bucket equity event asOf cannot move backward");
  }
  return applyChainedEvent(state, event);
}

function applyUnitFlow(
  state: BucketRiskState,
  event: Exclude<BucketEquityEvent, { eventType: "epoch_initialized" }>,
  amountKrw: number
): BucketRiskState {
  if (state.unitNavKrw === 0) {
    throw new Error("bucket equity unit flow is undefined at zero unit NAV");
  }
  if (amountKrw < 0 && -amountKrw > state.equityKrw) {
    throw new Error("bucket equity unit burn exceeds current units");
  }
  const nextEquityKrw = state.equityKrw + amountKrw;
  const nextUnits =
    amountKrw === -state.equityKrw
      ? 0
      : state.units + amountKrw / state.unitNavKrw;
  if (
    !Number.isFinite(nextEquityKrw) ||
    !Number.isFinite(nextUnits) ||
    nextEquityKrw < 0 ||
    nextUnits < 0
  ) {
    throw new Error("bucket equity unit flow produces an invalid balance");
  }
  if (
    nextEquityKrw === state.equityKrw ||
    nextUnits === state.units
  ) {
    throw new Error("bucket equity unit flow is below numeric precision");
  }
  return createBucketRiskState({
    ...statePayloadBase(state, event),
    units: nextUnits,
    unitNavKrw: state.unitNavKrw,
    highWaterMarkUnitNavKrw: state.highWaterMarkUnitNavKrw,
    equityKrw: nextEquityKrw,
    drawdownRatio: state.drawdownRatio
  });
}

function applyEquityDelta(
  state: BucketRiskState,
  event: Exclude<BucketEquityEvent, { eventType: "epoch_initialized" }>,
  equityDeltaKrw: number
): BucketRiskState {
  const nextEquityKrw = state.equityKrw + equityDeltaKrw;
  if (!Number.isFinite(nextEquityKrw) || nextEquityKrw < 0) {
    throw new Error("bucket equity delta produces a negative or non-finite balance");
  }
  if (equityDeltaKrw !== 0 && nextEquityKrw === state.equityKrw) {
    throw new Error("bucket equity delta is below numeric precision");
  }
  if (state.units === 0 && equityDeltaKrw !== 0) {
    throw new Error("bucket equity delta cannot change an empty epoch balance");
  }
  const nextUnitNavKrw =
    state.units === 0 ? state.unitNavKrw : nextEquityKrw / state.units;
  if (!Number.isFinite(nextUnitNavKrw) || nextUnitNavKrw < 0) {
    throw new Error("bucket equity delta produces an invalid unit NAV");
  }
  const nextHighWaterMarkUnitNavKrw = Math.max(
    state.highWaterMarkUnitNavKrw,
    nextUnitNavKrw
  );
  return createBucketRiskState({
    ...statePayloadBase(state, event),
    units: state.units,
    unitNavKrw: nextUnitNavKrw,
    highWaterMarkUnitNavKrw: nextHighWaterMarkUnitNavKrw,
    equityKrw: nextEquityKrw,
    drawdownRatio:
      1 - nextUnitNavKrw / nextHighWaterMarkUnitNavKrw
  });
}

function statePayloadBase(
  state: BucketRiskState,
  event: Exclude<BucketEquityEvent, { eventType: "epoch_initialized" }>
) {
  return {
    riskStateEpochId: state.riskStateEpochId,
    portfolioId: state.portfolioId,
    bucket: state.bucket,
    policyHash: state.policyHash,
    drawdownSemanticsHash: state.drawdownSemanticsHash,
    lastBucketEquityEventId: event.bucketEquityEventId,
    asOf: event.asOf
  };
}

function scopeKey(value: {
  portfolioId: string;
  bucket: BucketRiskState["bucket"];
}): string {
  return JSON.stringify([value.portfolioId, value.bucket]);
}
