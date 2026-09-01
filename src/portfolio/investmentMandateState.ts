import {
  type InvestmentMandateEvent,
  type InvestmentMandateRecord,
  parseInvestmentMandateEvent,
  parseInvestmentMandateRecord
} from "./investmentMandate.js";

export type InvestmentMandateStatus =
  | "proposed"
  | "active"
  | "review_required"
  | "retired";

export interface InvestmentMandateState {
  record: InvestmentMandateRecord;
  status: InvestmentMandateStatus;
  events: readonly InvestmentMandateEvent[];
  currentEvent?: InvestmentMandateEvent;
}

export interface InvestmentMandateHistorySnapshot {
  records: readonly InvestmentMandateRecord[];
  events: readonly InvestmentMandateEvent[];
  states: readonly InvestmentMandateState[];
}

interface MutableMandateState {
  record: InvestmentMandateRecord;
  status: InvestmentMandateStatus;
  events: InvestmentMandateEvent[];
  currentEvent?: InvestmentMandateEvent;
}

/**
 * Rehashes and folds the complete mandate history for each instrument scope.
 *
 * The predecessor chain is scoped by portfolio, market and symbol rather than
 * by mandate ID so an explicit retirement can hand the chain to its declared
 * successor mandate without allowing two current mandates for one instrument.
 */
export function validateInvestmentMandateHistory(input: {
  records: readonly unknown[];
  events: readonly unknown[];
}): InvestmentMandateHistorySnapshot {
  const records = parseUniqueRecords(input.records);
  const events = parseUniqueEvents(input.events);
  const statesById = new Map<string, MutableMandateState>();
  const scopeHeads = new Map<string, InvestmentMandateEvent>();

  for (const record of records) {
    statesById.set(record.mandateId, {
      record,
      status: "proposed",
      events: []
    });
  }

  for (const event of events) {
    const state = statesById.get(event.mandateId);
    if (state === undefined) {
      throw new Error("investment mandate event references an unknown mandate");
    }
    assertEventRecordBinding(event, state.record);
    const scope = mandateScope(state.record);
    const head = scopeHeads.get(scope);
    assertEventChronology(event, state.record, head);

    if (event.eventType === "activated") {
      assertActivationTransition(event, state, head, statesById);
      state.status = "active";
    } else {
      assertCurrentPredecessor(event, state, head);
      if (event.eventType === "review_required") {
        if (state.status !== "active") {
          throw new Error("mandate review transition requires active status");
        }
        state.status = "review_required";
      } else {
        if (state.status !== "active" && state.status !== "review_required") {
          throw new Error("mandate retirement requires a current mandate");
        }
        assertRetirementSuccessor(event, state.record, statesById);
        state.status = "retired";
      }
    }

    state.events.push(event);
    state.currentEvent = event;
    scopeHeads.set(scope, event);
  }

  const states = records.map((record) => {
    const state = statesById.get(record.mandateId);
    if (state === undefined) {
      throw new Error("investment mandate state reconstruction failed");
    }
    return freezeState(state);
  });
  return Object.freeze({
    records,
    events,
    states: Object.freeze(states)
  });
}

export function resolveInvestmentMandateState(input: {
  mandateId: string;
  records: readonly unknown[];
  events: readonly unknown[];
}): InvestmentMandateState {
  const snapshot = validateInvestmentMandateHistory(input);
  const state = snapshot.states.find(
    (candidate) => candidate.record.mandateId === input.mandateId
  );
  if (state === undefined) {
    throw new Error("investment mandate is not found");
  }
  return state;
}

export function resolveCurrentInvestmentMandate(input: {
  portfolioId: string;
  market: InvestmentMandateRecord["market"];
  symbol: string;
  records: readonly unknown[];
  events: readonly unknown[];
}): InvestmentMandateState {
  const snapshot = validateInvestmentMandateHistory(input);
  const matches = snapshot.states.filter(
    (state) =>
      state.record.portfolioId === input.portfolioId &&
      state.record.market === input.market &&
      state.record.symbol === input.symbol &&
      (state.status === "active" || state.status === "review_required")
  );
  if (matches.length !== 1) {
    throw new Error("exactly one current investment mandate is required");
  }
  return matches[0] as InvestmentMandateState;
}

function parseUniqueRecords(
  values: readonly unknown[]
): readonly InvestmentMandateRecord[] {
  const records: InvestmentMandateRecord[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    const record = parseInvestmentMandateRecord(value);
    if (ids.has(record.mandateId)) {
      throw new Error("investment mandate history contains a duplicate record ID");
    }
    ids.add(record.mandateId);
    records.push(record);
  }
  return Object.freeze(records);
}

function parseUniqueEvents(
  values: readonly unknown[]
): readonly InvestmentMandateEvent[] {
  const events: InvestmentMandateEvent[] = [];
  const ids = new Set<string>();
  for (const value of values) {
    const event = parseInvestmentMandateEvent(value);
    if (ids.has(event.mandateEventId)) {
      throw new Error("investment mandate history contains a duplicate event ID");
    }
    ids.add(event.mandateEventId);
    events.push(event);
  }
  return Object.freeze(events);
}

function assertEventRecordBinding(
  event: InvestmentMandateEvent,
  record: InvestmentMandateRecord
): void {
  if (
    event.mandateHash !== record.mandateHash ||
    event.portfolioId !== record.portfolioId ||
    event.market !== record.market ||
    event.symbol !== record.symbol ||
    event.bucket !== record.bucket ||
    event.policyHash !== record.policyHash
  ) {
    throw new Error("investment mandate event does not match its mandate record");
  }
}

function assertActivationTransition(
  event: Extract<InvestmentMandateEvent, { eventType: "activated" }>,
  state: MutableMandateState,
  head: InvestmentMandateEvent | undefined,
  statesById: ReadonlyMap<string, MutableMandateState>
): void {
  if (state.status !== "proposed" || state.events.length !== 0) {
    throw new Error("mandate activation requires proposed status");
  }
  if (head === undefined) {
    if (event.previousMandateEventId !== undefined) {
      throw new Error("first mandate activation must omit its predecessor");
    }
    return;
  }
  if (event.previousMandateEventId !== head.mandateEventId) {
    throw new Error("mandate activation predecessor is not the current chain head");
  }
  if (
    head.eventType !== "retired" ||
    head.supersededByMandateId !== event.mandateId
  ) {
    throw new Error("mandate activation is not authorized by its predecessor");
  }
  const previousState = statesById.get(head.mandateId);
  if (previousState?.status !== "retired") {
    throw new Error("mandate activation predecessor is not retired");
  }
}

function assertCurrentPredecessor(
  event: Exclude<InvestmentMandateEvent, { eventType: "activated" }>,
  state: MutableMandateState,
  head: InvestmentMandateEvent | undefined
): void {
  if (
    head === undefined ||
    event.previousMandateEventId !== head.mandateEventId
  ) {
    throw new Error("mandate event predecessor is not the current chain head");
  }
  if (head.mandateId !== state.record.mandateId) {
    throw new Error("mandate event branches from another mandate");
  }
}

function assertRetirementSuccessor(
  event: Extract<InvestmentMandateEvent, { eventType: "retired" }>,
  record: InvestmentMandateRecord,
  statesById: ReadonlyMap<string, MutableMandateState>
): void {
  if (event.supersededByMandateId === undefined) {
    return;
  }
  const successor = statesById.get(event.supersededByMandateId);
  if (successor === undefined) {
    throw new Error("retired mandate references an unknown successor");
  }
  if (mandateScope(successor.record) !== mandateScope(record)) {
    throw new Error("retired mandate successor has a different instrument scope");
  }
  if (successor.status !== "proposed" || successor.events.length !== 0) {
    throw new Error("retired mandate successor must still be proposed");
  }
  assertNotAfter(
    successor.record.createdAt,
    event.createdAt,
    "successor mandate createdAt"
  );
}

function assertEventChronology(
  event: InvestmentMandateEvent,
  record: InvestmentMandateRecord,
  head: InvestmentMandateEvent | undefined
): void {
  assertNotAfter(record.createdAt, event.createdAt, "mandate createdAt");
  if (event.eventType === "activated") {
    assertNotAfter(record.validFrom, event.asOf, "mandate activation asOf");
    if (record.expiresAt !== undefined) {
      assertNotAfter(event.asOf, record.expiresAt, "mandate activation expiresAt");
    }
  }
  if (head !== undefined) {
    assertNotAfter(head.asOf, event.asOf, "mandate event asOf");
    assertNotAfter(head.createdAt, event.createdAt, "mandate event createdAt");
  }
}

function assertNotAfter(left: string, right: string, label: string): void {
  if (Date.parse(left) > Date.parse(right)) {
    throw new Error(`${label} must not be after its boundary`);
  }
}

function mandateScope(value: {
  portfolioId: string;
  market: InvestmentMandateRecord["market"];
  symbol: string;
}): string {
  return JSON.stringify([value.portfolioId, value.market, value.symbol]);
}

function freezeState(state: MutableMandateState): InvestmentMandateState {
  const events = Object.freeze([...state.events]);
  return Object.freeze({
    record: state.record,
    status: state.status,
    events,
    ...(state.currentEvent === undefined
      ? {}
      : { currentEvent: state.currentEvent })
  });
}
