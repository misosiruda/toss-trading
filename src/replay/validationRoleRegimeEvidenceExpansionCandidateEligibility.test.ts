import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  EvidenceExpansionEnumeratedAssignmentCandidate
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidates.js";
import {
  classifyEvidenceExpansionCandidateEligibility
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

test("candidate eligibility accepts only scoped target regimes", () => {
  const result = classifyEvidenceExpansionCandidateEligibility(
    aggregation([
      candidate("bull", true, "1"),
      candidate("insufficient_data", true, "2"),
      candidate("sideways", false, "3")
    ])
  );

  assert.deepEqual(
    result.candidates.map(({ status, exclusionReason }) => ({
      status,
      exclusionReason
    })),
    [
      { status: "accepted", exclusionReason: null },
      {
        status: "excluded",
        exclusionReason: "INSUFFICIENT_REGIME_DATA"
      },
      { status: "excluded", exclusionReason: "SCOPE_UNAVAILABLE" }
    ]
  );
  assert.equal(result.acceptedCandidateCount, 1);
  assert.equal(result.scopeUnavailableCandidateCount, 1);
  assert.equal(result.insufficientRegimeDataCandidateCount, 1);
});

test("scope unavailability is primary over insufficient regime data", () => {
  const result = classifyEvidenceExpansionCandidateEligibility(
    aggregation([
      candidate("insufficient_data", false, "1")
    ])
  );

  assert.equal(
    result.candidates[0]?.exclusionReason,
    "SCOPE_UNAVAILABLE"
  );
  assert.equal(result.scopeUnavailableCandidateCount, 1);
  assert.equal(result.insufficientRegimeDataCandidateCount, 0);
});

test("candidate eligibility rejects calendar-valid count mismatch", () => {
  const value = aggregation([candidate("bull", true, "1")]);
  value.calendarValidCandidateCount = 2;

  assert.throws(
    () => classifyEvidenceExpansionCandidateEligibility(value),
    /do not match calendar-valid count/
  );
});

test("candidate eligibility rejects scope diagnostic mismatch", () => {
  const value = aggregation([
    candidate("sideways", false, "1")
  ]);
  value.scopeUnavailableCandidateCount = 0;

  assert.throws(
    () => classifyEvidenceExpansionCandidateEligibility(value),
    /scope exclusions do not match aggregation/
  );
});

function aggregation(
  candidates: EvidenceExpansionEnumeratedAssignmentCandidate[]
): EvidenceExpansionAssignmentCandidateAggregation {
  const sourceAssignment = assignment();
  const scopeUnavailableCandidateCount = candidates.filter(
    (candidate) => !candidate.scopeAvailable
  ).length;
  return {
    assignmentCandidates: [
      {
        assignment: sourceAssignment,
        result: {
          roleWindow: {
            splitId: sourceAssignment.splitId,
            splitIndex: sourceAssignment.splitIndex,
            splitRole: sourceAssignment.splitRole,
            roleStart: sourceAssignment.trainStart,
            roleEnd: sourceAssignment.trainEnd,
            effectiveRoleEnd: sourceAssignment.trainEnd
          },
          structuralCapacityCount: candidates.length,
          candidates,
          calendarRejectedCandidates: [],
          calendarRejectedCandidateCount: 0,
          scopeUnavailableCandidateCount,
          warnings: []
        }
      }
    ],
    structuralCapacityCount: candidates.length,
    calendarValidCandidateCount: candidates.length,
    calendarRejectedCandidates: [],
    calendarRejectedCandidateCount: 0,
    scopeUnavailableCandidateCount
  };
}

function candidate(
  regime: EvidenceExpansionEnumeratedAssignmentCandidate["regime"],
  scopeAvailable: boolean,
  character: string
): EvidenceExpansionEnumeratedAssignmentCandidate {
  return {
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    regime,
    scopeAvailable,
    variant: {
      evidenceGroupHash: hash(character),
      sourceVariant: {
        feasibilityCandidateHash: hash(character),
        legacyReplayPlanEvidenceGroupHash: null,
        sourceVariantHashVersion:
          "evidence_expansion_source_variant.v1",
        sourceVariantHash: hash(character),
        observedTradingDatesHash: hash(character),
        universeMembershipHash: hash(character)
      },
      observedTradingDates: [],
      universeMembership: scopeAvailable
        ? [{ market: "KR", symbol: `symbol-${character}` }]
        : []
    }
  };
}

function assignment(): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole: "train",
    trainStart: "2025-01-01T00:00:00.000Z",
    trainEnd: "2025-01-31T23:59:59.999Z",
    validationStart: "2025-02-01T00:00:00.000Z",
    validationEnd: "2025-02-28T23:59:59.999Z",
    testStart: "2025-03-01T00:00:00.000Z",
    testEnd: "2025-03-31T23:59:59.999Z",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
