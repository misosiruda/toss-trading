import assert from "node:assert/strict";
import test from "node:test";

import {
  createInvestmentMandateEvent,
  createInvestmentMandateRecord,
  createManualAssignmentEvent,
  parseInvestmentMandateEvent,
  parseInvestmentMandateRecord,
  parseManualAssignmentEvent
} from "./investmentMandate.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const CREATED_AT = "2026-09-01T01:00:00.000Z";

test("mandate record canonicalizes ordered sets and verifies full payload identity", () => {
  const record = createInvestmentMandateRecord({
    ...mandateBase(),
    reasonCodes: ["reason-b", "reason-a"],
    evidenceRefs: ["evidence-b", "evidence-a"],
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-event-1",
    createdAt: CREATED_AT
  });

  assert.deepEqual(record.reasonCodes, ["reason-a", "reason-b"]);
  assert.deepEqual(record.evidenceRefs, ["evidence-a", "evidence-b"]);
  assert.deepEqual(parseInvestmentMandateRecord(record), record);
  assert.throws(
    () =>
      parseInvestmentMandateRecord({
        ...record,
        targetWeightRatio: 0.25
      }),
    /identity does not match/
  );
});

test("mandate record rejects noncanonical stored arrays and duplicates", () => {
  const record = createInvestmentMandateRecord({
    ...mandateBase(),
    reasonCodes: ["reason-b", "reason-a"],
    evidenceRefs: ["evidence-b", "evidence-a"],
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-event-1",
    createdAt: CREATED_AT
  });
  assert.throws(
    () =>
      parseInvestmentMandateRecord({
        ...record,
        reasonCodes: [...record.reasonCodes].reverse()
      }),
    /canonical order/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        reasonCodes: ["same", "same"],
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /must not contain duplicates/
  );
});

test("mandate variants reject foreign lineage and invalid range or chronology", () => {
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        capacityReservation: manualReservation(),
        createdAt: CREATED_AT
      } as never),
    /unrecognized/i
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        minWeightRatio: 0.3,
        targetWeightRatio: 0.2,
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /min <= target <= max/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        evidenceAsOf: "2026-09-01T02:00:00.000Z",
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /evidenceAsOf/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        validFrom: "2026-09-01T00:29:59.000Z",
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /mandate validFrom/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        maximumOpeningNotionalKrw: 1,
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /reduce-only mandate opening cap must be zero/
  );
});

test("selector and manual-open mandate variants preserve exclusive lineage", () => {
  const manual = createInvestmentMandateRecord({
    ...mandateBase(),
    maximumOpeningNotionalKrw: 100_000,
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "open_or_increase",
    manualAssignmentEventId: "manual-event-1",
    capacityReservation: manualReservation(),
    createdAt: CREATED_AT
  });
  assert.equal(manual.assignmentSource, "manual_policy");
  assert.throws(
    () =>
      parseInvestmentMandateRecord({
        ...manual,
        minWeightRatio: 0,
        targetWeightRatio: 0,
        maxWeightRatio: 0
      }),
    /opening target and maximum weights must be positive/
  );

  const selector = createInvestmentMandateRecord({
    ...mandateBase(),
    maximumOpeningNotionalKrw: 100_000,
    assignmentSource: "deterministic_selector",
    selectionRequestId: "request-1",
    candidateAssignmentId: "assignment-1",
    candidateAssignmentSetId: "set-1",
    candidateAssignmentSetHash: HASH_A,
    selectedRank: 1,
    openingCapacityReservationId: "reservation-1",
    openingCapacityReservationHash: HASH_B,
    reservedSlotOrdinal: 0,
    reservedMaximumNotionalKrw: 100_000,
    scoringModelVersion: "score-v1",
    selectionScore: 0.75,
    createdAt: CREATED_AT
  });
  assert.equal(selector.assignmentSource, "deterministic_selector");
  assert.deepEqual(parseInvestmentMandateRecord(selector), selector);
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        maximumOpeningNotionalKrw: 50_000,
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "open_or_increase",
        manualAssignmentEventId: "manual-event-1",
        capacityReservation: manualReservation(),
        createdAt: CREATED_AT
      }),
    /opening cap must match/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        minWeightRatio: 0,
        targetWeightRatio: 0,
        maxWeightRatio: 0,
        maximumOpeningNotionalKrw: 100_000,
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "open_or_increase",
        manualAssignmentEventId: "manual-event-1",
        capacityReservation: manualReservation(),
        createdAt: CREATED_AT
      }),
    /opening target and maximum weights must be positive/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        minWeightRatio: 0,
        targetWeightRatio: 0,
        maxWeightRatio: 0,
        maximumOpeningNotionalKrw: 100_000,
        assignmentSource: "deterministic_selector",
        selectionRequestId: "request-1",
        candidateAssignmentId: "assignment-1",
        candidateAssignmentSetId: "set-1",
        candidateAssignmentSetHash: HASH_A,
        selectedRank: 1,
        openingCapacityReservationId: "reservation-1",
        openingCapacityReservationHash: HASH_B,
        reservedSlotOrdinal: 0,
        reservedMaximumNotionalKrw: 100_000,
        scoringModelVersion: "score-v1",
        selectionScore: 0.75,
        createdAt: CREATED_AT
      }),
    /opening target and maximum weights must be positive/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "open_or_increase",
        manualAssignmentEventId: "manual-event-1",
        capacityReservation: {
          ...manualReservation(),
          reservedMaximumNotionalKrw: 0
        },
        createdAt: CREATED_AT
      }),
    /must be positive/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        assignmentSource: "deterministic_selector",
        selectionRequestId: "request-1",
        candidateAssignmentId: "assignment-1",
        candidateAssignmentSetId: "set-1",
        candidateAssignmentSetHash: HASH_A,
        selectedRank: 1,
        openingCapacityReservationId: "reservation-1",
        openingCapacityReservationHash: HASH_B,
        reservedSlotOrdinal: 0,
        reservedMaximumNotionalKrw: 0,
        scoringModelVersion: "score-v1",
        selectionScore: 0.75,
        createdAt: CREATED_AT
      }),
    /must be positive/
  );
});

test("mandate identity excludes createdAt but rejects ambiguous or invalid timestamps", () => {
  const input = {
    ...mandateBase(),
    assignmentSource: "manual_policy" as const,
    manualAuthorizationScope: "classify_existing_reduce_only" as const,
    manualAssignmentEventId: "manual-event-1"
  };
  const first = createInvestmentMandateRecord({
    ...input,
    createdAt: CREATED_AT
  });
  const retry = createInvestmentMandateRecord({
    ...input,
    createdAt: "2026-09-01T02:00:00.000Z"
  });
  assert.equal(first.mandateId, retry.mandateId);
  assert.equal(first.mandateHash, retry.mandateHash);
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...input,
        asOf: "2026-09-01T00:30:00.000",
        createdAt: CREATED_AT
      }),
    /timezone offset/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...input,
        asOf: "2026-02-30T00:30:00.000Z",
        createdAt: CREATED_AT
      }),
    /valid calendar date/
  );
});

test("mandate rejects noncanonical scheduled cadence boundary refs", () => {
  const boundary = (id: string) => ({
    scheduleBoundaryRecordId: id,
    version: "v1",
    hash: HASH_A,
    lineageHash: HASH_B
  });
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        bucket: "long_term",
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /every_tick cadence is restricted to intraday bucket/
  );
  const intraday = createInvestmentMandateRecord({
    ...mandateBase(),
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-event-1",
    createdAt: CREATED_AT
  });
  assert.throws(
    () => parseInvestmentMandateRecord({ ...intraday, bucket: "long_term" }),
    /every_tick cadence is restricted to intraday bucket/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        reviewCadence: {
          mode: "scheduled",
          boundaryRefs: [boundary("boundary-a")]
        },
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /scheduled mandate requires reviewAfter/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        reviewCadence: {
          mode: "scheduled",
          boundaryRefs: [boundary("boundary-b"), boundary("boundary-a")]
        },
        reviewAfter: "2026-09-02T00:30:00.000Z",
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /canonical record ID order/
  );
  assert.throws(
    () =>
      createInvestmentMandateRecord({
        ...mandateBase(),
        reviewAfter: "2026-09-02T00:30:00.000Z",
        assignmentSource: "manual_policy",
        manualAuthorizationScope: "classify_existing_reduce_only",
        manualAssignmentEventId: "manual-event-1",
        createdAt: CREATED_AT
      }),
    /every_tick mandate must omit reviewAfter/
  );
  const scheduled = createInvestmentMandateRecord({
    ...mandateBase(),
    reviewCadence: {
      mode: "scheduled",
      boundaryRefs: [boundary("boundary-a"), boundary("boundary-b")]
    },
    reviewAfter: "2026-09-02T00:30:00.000Z",
    assignmentSource: "manual_policy",
    manualAuthorizationScope: "classify_existing_reduce_only",
    manualAssignmentEventId: "manual-event-1",
    createdAt: CREATED_AT
  });
  assert.deepEqual(parseInvestmentMandateRecord(scheduled), scheduled);
});

test("mandate events hash the complete strict variant payload", () => {
  const event = createInvestmentMandateEvent({
    ...mandateEventBase(),
    eventType: "activated",
    createdAt: CREATED_AT
  });
  assert.deepEqual(parseInvestmentMandateEvent(event), event);
  assert.throws(
    () => parseInvestmentMandateEvent({ ...event, reasonCodes: ["changed"] }),
    /identity does not match/
  );
  assert.throws(
    () =>
      createInvestmentMandateEvent({
        ...mandateEventBase(),
        eventType: "review_required",
        createdAt: CREATED_AT
      } as never),
    /invalid input/i
  );
});

test("retired mandate event preserves predecessor and superseding identity", () => {
  const event = createInvestmentMandateEvent({
    ...mandateEventBase(),
    eventType: "retired",
    previousMandateEventId: "mandate-event-1",
    supersededByMandateId: "mandate-2",
    createdAt: CREATED_AT
  });
  assert.equal(event.eventType, "retired");
  assert.equal(event.supersededByMandateId, "mandate-2");
});

test("manual open assignment requires eligible sizing lineage and rehashes", () => {
  const event = createManualAssignmentEvent({
    ...manualAssignmentBase(),
    authorizationScope: "open_or_increase",
    evidenceEligibility: "eligible",
    portfolioSnapshotId: "snapshot-1",
    portfolioSnapshotHash: HASH_A,
    sizingInputRecordId: "sizing-1",
    minWeightRatio: 0.1,
    targetWeightRatio: 0.2,
    maxWeightRatio: 0.3,
    maximumNotionalKrw: 100_000,
    sizingInputHash: HASH_B,
    sizingOutputHash: HASH_C,
    createdAt: CREATED_AT
  });
  assert.deepEqual(parseManualAssignmentEvent(event), event);
  assert.throws(
    () => parseManualAssignmentEvent({ ...event, sizingOutputHash: HASH_A }),
    /identity does not match/
  );
  assert.throws(
    () =>
      createManualAssignmentEvent({
        ...manualAssignmentBase(),
        authorizationScope: "open_or_increase",
        evidenceEligibility: "eligible",
        portfolioSnapshotId: "snapshot-1",
        portfolioSnapshotHash: HASH_A,
        sizingInputRecordId: "sizing-1",
        minWeightRatio: 0.1,
        targetWeightRatio: 0.2,
        maxWeightRatio: 0.3,
        maximumNotionalKrw: 0,
        sizingInputHash: HASH_B,
        sizingOutputHash: HASH_C,
        createdAt: CREATED_AT
      }),
    />0/
  );
  assert.throws(
    () => parseManualAssignmentEvent({ ...event, maximumNotionalKrw: 0 }),
    />0/
  );
  assert.throws(
    () =>
      parseManualAssignmentEvent({
        ...event,
        minWeightRatio: 0,
        targetWeightRatio: 0,
        maxWeightRatio: 0
      }),
    /opening target and maximum weights must be positive/
  );
  assert.throws(
    () =>
      createManualAssignmentEvent({
        ...manualAssignmentBase(),
        authorizationScope: "open_or_increase",
        evidenceEligibility: "eligible",
        portfolioSnapshotId: "snapshot-1",
        portfolioSnapshotHash: HASH_A,
        sizingInputRecordId: "sizing-1",
        minWeightRatio: 0,
        targetWeightRatio: 0,
        maxWeightRatio: 0,
        maximumNotionalKrw: 100_000,
        sizingInputHash: HASH_B,
        sizingOutputHash: HASH_C,
        createdAt: CREATED_AT
      }),
    /opening target and maximum weights must be positive/
  );
  assert.throws(
    () =>
      createManualAssignmentEvent({
        ...manualAssignmentBase(),
        authorizationScope: "open_or_increase",
        evidenceEligibility: "blocked",
        createdAt: CREATED_AT
      } as never),
    /invalid input/i
  );
});

test("manual reduce-only classification may preserve blocked evidence without sizing fields", () => {
  const event = createManualAssignmentEvent({
    ...manualAssignmentBase(),
    authorizationScope: "classify_existing_reduce_only",
    evidenceEligibility: "blocked",
    classificationMinWeightRatio: 0,
    classificationTargetWeightRatio: 0,
    classificationMaxWeightRatio: 0.2,
    createdAt: CREATED_AT
  });
  assert.equal(event.authorizationScope, "classify_existing_reduce_only");
  assert.equal(event.evidenceEligibility, "blocked");
  assert.deepEqual(parseManualAssignmentEvent(event), event);
});

function mandateBase() {
  return {
    portfolioId: "portfolio-1",
    market: "KR" as const,
    symbol: "005930",
    bucket: "intraday" as const,
    policyHash: HASH_A,
    asOf: "2026-09-01T00:30:00.000Z",
    targetWeightRatio: 0.2,
    minWeightRatio: 0.1,
    maxWeightRatio: 0.3,
    maximumOpeningNotionalKrw: 0,
    reasonCodes: ["reason-a"],
    evidenceRefs: ["evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    reviewCadence: { mode: "every_tick" as const },
    validFrom: "2026-09-01T00:30:00.000Z",
    expiresAt: "2026-10-01T00:30:00.000Z"
  };
}

function mandateEventBase() {
  return {
    mandateId: "mandate-1",
    mandateHash: HASH_A,
    portfolioId: "portfolio-1",
    market: "KR" as const,
    symbol: "005930",
    bucket: "long_term" as const,
    policyHash: HASH_B,
    asOf: "2026-09-01T00:30:00.000Z",
    reasonCodes: ["reason-b", "reason-a"]
  };
}

function manualAssignmentBase() {
  return {
    portfolioId: "portfolio-1",
    policyHash: HASH_A,
    market: "KR" as const,
    symbol: "005930",
    bucket: "long_term" as const,
    asOf: "2026-09-01T00:30:00.000Z",
    selectionPolicyRecordId: "selection-policy-1",
    selectionPolicyHash: HASH_B,
    reasonCodes: ["reason-b", "reason-a"],
    evidenceRefs: ["evidence-b", "evidence-a"],
    evidenceAsOf: "2026-09-01T00:00:00.000Z",
    evidenceValidationHash: HASH_C,
    authorizationRef: "authorization-1"
  };
}

function manualReservation() {
  return {
    manualCapacityReservationId: "reservation-1",
    manualCapacityReservationHash: HASH_C,
    reservedMaximumNotionalKrw: 100_000,
    reservationKind: "new_position" as const,
    reservedSlotOrdinal: 0
  };
}
