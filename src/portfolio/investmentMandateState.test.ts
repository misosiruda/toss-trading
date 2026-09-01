import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvestmentMandateEvent,
  createInvestmentMandateRecord,
  type InvestmentMandateEvent,
  type InvestmentMandateRecord
} from "./investmentMandate.js";
import {
  resolveCurrentInvestmentMandate,
  validateInvestmentMandateHistory
} from "./investmentMandateState.js";

const HASH_A = `sha256:${"a".repeat(64)}`;

test("mandate history folds an instrument chain across an explicit successor", () => {
  const first = mandateRecord("manual-event-1", {
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const successor = mandateRecord("manual-event-2", {
    validFrom: "2026-09-01T03:30:00.000Z",
    createdAt: "2026-09-01T01:30:00.000Z"
  });
  const activated = mandateEvent(first, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const reviewRequired = mandateEvent(first, {
    eventType: "review_required",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  const retired = mandateEvent(first, {
    eventType: "retired",
    previousMandateEventId: reviewRequired.mandateEventId,
    supersededByMandateId: successor.mandateId,
    asOf: "2026-09-01T03:00:00.000Z",
    createdAt: "2026-09-01T03:00:00.000Z"
  });
  const successorActivated = mandateEvent(successor, {
    eventType: "activated",
    previousMandateEventId: retired.mandateEventId,
    asOf: "2026-09-01T03:30:00.000Z",
    createdAt: "2026-09-01T04:00:00.000Z"
  });

  const snapshot = validateInvestmentMandateHistory({
    records: [first, successor],
    events: [activated, reviewRequired, retired, successorActivated]
  });

  assert.deepEqual(
    snapshot.states.map((state) => state.status),
    ["retired", "active"]
  );
  assert.equal(snapshot.states[0]?.events.length, 3);
  assert.equal(snapshot.states[1]?.currentEvent?.mandateEventId, successorActivated.mandateEventId);
  assert.equal(
    resolveCurrentInvestmentMandate({
      portfolioId: first.portfolioId,
      market: first.market,
      symbol: first.symbol,
      records: snapshot.records,
      events: snapshot.events
    }).record.mandateId,
    successor.mandateId
  );
});

test("mandate history preserves proposed and review-required derived states", () => {
  const activeRecord = mandateRecord("manual-event-1");
  const proposedRecord = mandateRecord("manual-event-2");
  const activated = mandateEvent(activeRecord, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const reviewRequired = mandateEvent(activeRecord, {
    eventType: "review_required",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  const snapshot = validateInvestmentMandateHistory({
    records: [activeRecord, proposedRecord],
    events: [activated, reviewRequired]
  });

  assert.deepEqual(
    snapshot.states.map((state) => state.status),
    ["review_required", "proposed"]
  );
  assert.equal(
    resolveCurrentInvestmentMandate({
      portfolioId: activeRecord.portfolioId,
      market: activeRecord.market,
      symbol: activeRecord.symbol,
      records: snapshot.records,
      events: snapshot.events
    }).status,
    "review_required"
  );
});

test("mandate history rejects unknown predecessors, branches, and terminal transitions", () => {
  const first = mandateRecord("manual-event-1");
  const second = mandateRecord("manual-event-2");
  const activated = mandateEvent(first, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const branch = mandateEvent(second, {
    eventType: "activated",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T01:30:00.000Z",
    createdAt: "2026-09-01T01:30:00.000Z"
  });
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [first, second],
        events: [activated, branch]
      }),
    /not authorized/
  );

  const unknownPredecessor = mandateEvent(first, {
    eventType: "review_required",
    previousMandateEventId: "unknown-event",
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [first],
        events: [activated, unknownPredecessor]
      }),
    /current chain head/
  );

  const retired = mandateEvent(first, {
    eventType: "retired",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  const afterTerminal = mandateEvent(first, {
    eventType: "review_required",
    previousMandateEventId: retired.mandateEventId,
    asOf: "2026-09-01T03:00:00.000Z",
    createdAt: "2026-09-01T03:00:00.000Z"
  });
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [first],
        events: [activated, retired, afterTerminal]
      }),
    /requires active status/
  );
});

test("mandate history rejects binding drift, duplicate identities, and backdating", () => {
  const record = mandateRecord("manual-event-1");
  const activated = mandateEvent(record, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const wrongRecord = mandateRecord("manual-event-2");
  const drifted = mandateEvent(wrongRecord, {
    eventType: "review_required",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [record, wrongRecord],
        events: [activated, drifted]
      }),
    /branches from another mandate/
  );
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [record, record],
        events: []
      }),
    /duplicate record ID/
  );
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [record],
        events: [activated, activated]
      }),
    /duplicate event ID/
  );

  const backdated = mandateEvent(record, {
    eventType: "review_required",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T00:59:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [record],
        events: [activated, backdated]
      }),
    /event asOf/
  );

  const expiredActivation = mandateEvent(record, {
    eventType: "activated",
    asOf: "2026-10-01T00:30:00.001Z",
    createdAt: "2026-10-01T00:31:00.000Z"
  });
  assert.throws(
    () =>
      validateInvestmentMandateHistory({
        records: [record],
        events: [expiredActivation]
      }),
    /activation expiresAt/
  );
});

function mandateRecord(
  manualAssignmentEventId: string,
  overrides: Partial<{
    validFrom: string;
    createdAt: string;
  }> = {}
): InvestmentMandateRecord {
  return createInvestmentMandateRecord({
    portfolioId: "portfolio-1",
    market: "KR",
    symbol: "005930",
    bucket: "intraday",
    policyHash: HASH_A,
    asOf: "2026-09-01T00:30:00.000Z",
    targetWeightRatio: 0.2,
    minWeightRatio: 0.1,
    maxWeightRatio: 0.3,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: ["reason-a"],
    evidenceRefs: ["evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    reviewCadence: { mode: "every_tick" },
    validFrom: overrides.validFrom ?? "2026-09-01T00:30:00.000Z",
    expiresAt: "2026-10-01T00:30:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId,
    createdAt: overrides.createdAt ?? "2026-09-01T01:00:00.000Z"
  });
}

function mandateEvent(
  record: InvestmentMandateRecord,
  transition:
    | {
        eventType: "activated";
        previousMandateEventId?: string;
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "review_required";
        previousMandateEventId: string;
        asOf: string;
        createdAt: string;
      }
    | {
        eventType: "retired";
        previousMandateEventId: string;
        supersededByMandateId?: string;
        asOf: string;
        createdAt: string;
      }
): InvestmentMandateEvent {
  return createInvestmentMandateEvent({
    mandateId: record.mandateId,
    mandateHash: record.mandateHash,
    portfolioId: record.portfolioId,
    market: record.market,
    symbol: record.symbol,
    bucket: record.bucket,
    policyHash: record.policyHash,
    reasonCodes: ["lifecycle"],
    ...transition
  });
}
