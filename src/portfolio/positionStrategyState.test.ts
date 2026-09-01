import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvestmentMandateEvent,
  createInvestmentMandateRecord,
  type InvestmentMandateEvent,
  type InvestmentMandateRecord
} from "./investmentMandate.js";
import {
  createAssignedPositionStrategyState,
  createUnassignedLegacyPositionStrategyState,
  parsePositionStrategyState,
  resolvePositionStrategyStateDependencies
} from "./positionStrategyState.js";

const HASH_A = `sha256:${"a".repeat(64)}` as `sha256:${string}`;
const HASH_B = `sha256:${"b".repeat(64)}` as `sha256:${string}`;
const HASH_C = `sha256:${"c".repeat(64)}` as `sha256:${string}`;

test("assigned position state hashes the complete strict payload", () => {
  const state = createAssignedPositionStrategyState(assignedStateInput());

  assert.deepEqual(parsePositionStrategyState(state), state);
  assert.ok(Object.isFrozen(state));
  assert.throws(
    () => parsePositionStrategyState({ ...state, peakPriceKrw: 72_000 }),
    /hash does not match/
  );
  assert.throws(
    () =>
      createAssignedPositionStrategyState({
        ...assignedStateInput(),
        openedAt: "2026-09-01T02:00:00.000Z"
      }),
    /openedAt/
  );
  assert.throws(
    () =>
      createAssignedPositionStrategyState({
        ...assignedStateInput(),
        peakPriceKrw: 0
      }),
    />0/
  );
});

test("legacy position state canonicalizes reasons without fabricating lineage", () => {
  const state = createUnassignedLegacyPositionStrategyState({
    stateKind: "unassigned_legacy",
    portfolioId: "portfolio-1",
    market: "KR",
    symbol: "005930",
    observedPositionRef: "position-1",
    reasonCodes: ["missing_policy_lineage", "missing_mandate"],
    detectedAt: "2026-09-01T01:00:00.000Z",
    status: "review_required"
  });

  assert.deepEqual(state.reasonCodes, [
    "missing_mandate",
    "missing_policy_lineage"
  ]);
  assert.deepEqual(parsePositionStrategyState(state), state);
  assert.equal("mandateId" in state, false);
  assert.throws(
    () =>
      createUnassignedLegacyPositionStrategyState({
        stateKind: "unassigned_legacy",
        portfolioId: "portfolio-1",
        market: "KR",
        symbol: "005930",
        observedPositionRef: "position-1",
        reasonCodes: ["missing_mandate", "missing_mandate"],
        detectedAt: "2026-09-01T01:00:00.000Z",
        status: "review_required"
      }),
    /must not contain duplicates/
  );
  assert.throws(
    () =>
      parsePositionStrategyState({
        ...state,
        reasonCodes: [...state.reasonCodes].reverse()
      }),
    /canonical order/
  );
});

test("assigned state resolves the exact every-tick mandate head", () => {
  const mandate = everyTickMandate();
  const activated = mandateEvent(mandate, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const state = createAssignedPositionStrategyState(
    assignedStateInput({
      mandateId: mandate.mandateId,
      mandateHash: mandate.mandateHash,
      lastMandateEventId: activated.mandateEventId,
      lastMandateEventHash: activated.mandateEventHash,
      policyHash: mandate.policyHash,
      lastReviewedTriggerRef: HASH_C
    })
  );

  const resolved = resolvePositionStrategyStateDependencies({
    value: state,
    mandateRecords: [mandate],
    mandateEvents: [activated]
  });
  assert.equal(resolved.state.stateKind, "assigned");
  assert.equal("mandate" in resolved && resolved.mandate.status, "active");
  assert.throws(
    () =>
      resolvePositionStrategyStateDependencies({
        value: createAssignedPositionStrategyState({
          ...assignedStateInput(),
          mandateId: mandate.mandateId,
          mandateHash: mandate.mandateHash,
          lastMandateEventId: activated.mandateEventId,
          lastMandateEventHash: activated.mandateEventHash,
          policyHash: mandate.policyHash,
          lastReviewedTriggerRef: "packet-ref-without-hash"
        }),
        mandateRecords: [mandate],
        mandateEvents: [activated]
      }),
    /market packet hash trigger/
  );
});

test("assigned state rejects stale mandate heads and lineage drift", () => {
  const mandate = everyTickMandate();
  const successor = everyTickMandate("manual-event-2");
  const activated = mandateEvent(mandate, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const reviewRequired = mandateEvent(mandate, {
    eventType: "review_required",
    previousMandateEventId: activated.mandateEventId,
    asOf: "2026-09-01T02:00:00.000Z",
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  const stale = createAssignedPositionStrategyState(
    assignedStateInput({
      mandateId: mandate.mandateId,
      mandateHash: mandate.mandateHash,
      lastMandateEventId: activated.mandateEventId,
      lastMandateEventHash: activated.mandateEventHash,
      policyHash: mandate.policyHash,
      lastReviewedTriggerRef: HASH_C
    })
  );
  assert.throws(
    () =>
      resolvePositionStrategyStateDependencies({
        value: stale,
        mandateRecords: [mandate],
        mandateEvents: [activated, reviewRequired]
      }),
    /does not match its mandate lineage/
  );
  assert.throws(
    () =>
      resolvePositionStrategyStateDependencies({
        value: createAssignedPositionStrategyState({
          ...assignedStateInput(),
          mandateId: mandate.mandateId,
          mandateHash: mandate.mandateHash,
          lastMandateEventId: activated.mandateEventId,
          lastMandateEventHash: activated.mandateEventHash,
          policyHash: HASH_B,
          lastReviewedTriggerRef: HASH_C
        }),
        mandateRecords: [mandate],
        mandateEvents: [activated]
      }),
    /does not match its mandate lineage/
  );

  const retired = mandateEvent(mandate, {
    eventType: "retired",
    previousMandateEventId: reviewRequired.mandateEventId,
    supersededByMandateId: successor.mandateId,
    asOf: "2026-09-01T03:00:00.000Z",
    createdAt: "2026-09-01T03:00:00.000Z"
  });
  const successorActivated = mandateEvent(successor, {
    eventType: "activated",
    previousMandateEventId: retired.mandateEventId,
    asOf: "2026-09-01T03:00:00.000Z",
    createdAt: "2026-09-01T03:00:00.000Z"
  });
  const retiredState = createAssignedPositionStrategyState(
    assignedStateInput({
      mandateId: mandate.mandateId,
      mandateHash: mandate.mandateHash,
      lastMandateEventId: retired.mandateEventId,
      lastMandateEventHash: retired.mandateEventHash,
      policyHash: mandate.policyHash,
      lastReviewedTriggerRef: HASH_C
    })
  );
  assert.throws(
    () =>
      resolvePositionStrategyStateDependencies({
        value: retiredState,
        mandateRecords: [mandate, successor],
        mandateEvents: [
          activated,
          reviewRequired,
          retired,
          successorActivated
        ]
      }),
    /cannot resolve a retired mandate/
  );
});

test("scheduled state binds nextReviewAt to the mandate reviewAfter", () => {
  const mandate = scheduledMandate();
  const activated = mandateEvent(mandate, {
    eventType: "activated",
    asOf: "2026-09-01T01:00:00.000Z",
    createdAt: "2026-09-01T01:00:00.000Z"
  });
  const base = {
    ...assignedStateInput(),
    mandateId: mandate.mandateId,
    mandateHash: mandate.mandateHash,
    lastMandateEventId: activated.mandateEventId,
    lastMandateEventHash: activated.mandateEventHash,
    policyHash: mandate.policyHash,
    nextReviewAt: mandate.reviewAfter,
    lastReviewedTriggerRef: "schedule-boundary-1"
  };
  const resolved = resolvePositionStrategyStateDependencies({
    value: createAssignedPositionStrategyState(base),
    mandateRecords: [mandate],
    mandateEvents: [activated]
  });
  assert.equal(resolved.state.stateKind, "assigned");

  const { nextReviewAt: _nextReviewAt, ...missingNextReview } = base;
  assert.throws(
    () =>
      resolvePositionStrategyStateDependencies({
        value: createAssignedPositionStrategyState(missingNextReview),
        mandateRecords: [mandate],
        mandateEvents: [activated]
      }),
    /must match the mandate reviewAfter/
  );
  assert.throws(
    () =>
      resolvePositionStrategyStateDependencies({
        value: createAssignedPositionStrategyState({
          ...base,
          nextReviewAt: "2026-09-03T00:30:00.000Z"
        }),
        mandateRecords: [mandate],
        mandateEvents: [activated]
      }),
    /must match the mandate reviewAfter/
  );
});

function assignedStateInput(
  overrides: Partial<Parameters<typeof createAssignedPositionStrategyState>[0]> = {}
): Parameters<typeof createAssignedPositionStrategyState>[0] {
  return {
    stateKind: "assigned",
    portfolioId: "portfolio-1",
    market: "KR",
    symbol: "005930",
    mandateId: "mandate-1",
    mandateHash: HASH_A,
    lastMandateEventId: "mandate-event-1",
    lastMandateEventHash: HASH_B,
    policyHash: HASH_A,
    openedAt: "2026-09-01T00:30:00.000Z",
    lastReviewedAt: "2026-09-01T01:00:00.000Z",
    lastReviewedTriggerRef: HASH_C,
    peakPriceKrw: 71_000,
    partialTakeProfitExecuted: false,
    thesisStatus: "intact",
    ...overrides
  };
}

function everyTickMandate(
  manualAssignmentEventId = "manual-event-1"
): InvestmentMandateRecord {
  return mandateRecord({
    bucket: "intraday",
    reviewCadence: { mode: "every_tick" }
  }, manualAssignmentEventId);
}

function scheduledMandate(): InvestmentMandateRecord {
  return mandateRecord({
    bucket: "long_term",
    reviewCadence: {
      mode: "scheduled",
      boundaryRefs: [
        {
          scheduleBoundaryRecordId: "boundary-1",
          version: "v1",
          hash: HASH_A,
          lineageHash: HASH_B
        }
      ]
    },
    reviewAfter: "2026-09-02T00:30:00.000Z"
  });
}

function mandateRecord(
  cadence:
    | {
        bucket: "intraday";
        reviewCadence: { mode: "every_tick" };
      }
    | {
        bucket: "long_term";
        reviewCadence: {
          mode: "scheduled";
          boundaryRefs: Array<{
            scheduleBoundaryRecordId: string;
            version: string;
            hash: `sha256:${string}`;
            lineageHash: `sha256:${string}`;
          }>;
        };
        reviewAfter: string;
      },
  manualAssignmentEventId = "manual-event-1"
): InvestmentMandateRecord {
  return createInvestmentMandateRecord({
    portfolioId: "portfolio-1",
    market: "KR",
    symbol: "005930",
    policyHash: HASH_A,
    asOf: "2026-09-01T00:30:00.000Z",
    targetWeightRatio: 0.2,
    minWeightRatio: 0.1,
    maxWeightRatio: 0.3,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: ["reason-a"],
    evidenceRefs: ["evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    validFrom: "2026-09-01T00:30:00.000Z",
    expiresAt: "2026-10-01T00:30:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId,
    createdAt: "2026-09-01T01:00:00.000Z",
    ...cadence
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
