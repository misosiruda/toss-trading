import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import type {
  EvidenceExpansionCandidateEligibility,
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

test("candidate partition combines accepted and all implemented exclusions", () => {
  const rows = [
    eligibility("1", "1", "train", true, null),
    eligibility(
      "2",
      "2",
      "validation",
      false,
      "SCOPE_UNAVAILABLE"
    )
  ];
  const input = partitionInput(rows);

  const partition = buildEvidenceExpansionCandidatePartition(input);

  assert.deepEqual(
    partition.consolidation.evidenceGroups.map(
      (group) => group.evidenceGroupHash
    ),
    [hash("1")]
  );
  assert.deepEqual(
    partition.exclusions.map((exclusion) => exclusion.reason),
    ["CALENDAR_SESSION_REJECTED", "SCOPE_UNAVAILABLE"]
  );
  assert.deepEqual(
    partition.exclusions[0]?.sourceVariants,
    []
  );
  assert.deepEqual(
    partition.exclusions[1]?.sourceVariants.map(
      (variant) => variant.sourceVariantHash
    ),
    [hash("2")]
  );
});

test("candidate partition rejects aggregation and eligibility drift", () => {
  const rows = [
    eligibility("1", "1", "train", true, null)
  ];
  const input = partitionInput(rows);
  input.eligibility.candidates[0]!.candidate.endAt =
    "2025-01-20T23:59:59.999Z";

  assert.throws(
    () => buildEvidenceExpansionCandidatePartition(input),
    /eligibility candidates do not match aggregation candidates/
  );
});

test("candidate partition rejects calendar-valid and rejected group overlap", () => {
  const rows = [
    eligibility("1", "1", "train", true, null)
  ];
  const input = partitionInput(rows);
  const rejected = input.aggregation.calendarRejectedCandidates[0]!;
  const rejectedGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt: rejected.candidate.startAt,
    endAt: rejected.candidate.endAt,
    candidateStrategyBucket: "short_term",
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes
  });
  input.eligibility.candidates[0]!.candidate.variant.evidenceGroupHash =
    rejectedGroupHash;
  input.aggregation.assignmentCandidates[0]!.result.candidates[0]!
    .variant.evidenceGroupHash = rejectedGroupHash;

  assert.throws(
    () => buildEvidenceExpansionCandidatePartition(input),
    /calendar-rejected evidence group overlaps/
  );
});

test("candidate partition rejects duplicate eligibility rows", () => {
  const row = eligibility("1", "1", "train", true, null);
  const input = partitionInput([row]);
  input.eligibility.candidates.push(structuredClone(row));
  input.eligibility.acceptedCandidateCount += 1;

  assert.throws(
    () => buildEvidenceExpansionCandidatePartition(input),
    /eligibility contains duplicate calendar-valid candidates/
  );
});

test("candidate partition rejects unrecognized root fields", () => {
  const input = {
    ...partitionInput([]),
    status: "ready_for_expansion_replay"
  } as unknown as Parameters<
    typeof buildEvidenceExpansionCandidatePartition
  >[0];

  assert.throws(
    () => buildEvidenceExpansionCandidatePartition(input),
    /candidate partition input contains unknown fields/
  );
});

function partitionInput(
  rows: EvidenceExpansionCandidateEligibility[]
): {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  eligibility: EvidenceExpansionCandidateEligibilityResult;
  windowMonths: number;
  timezoneOffsetMinutes: number;
} {
  const eligibilityResult = result(rows);
  const calendarRejectedCandidates = [
    {
      assignment: assignment("test"),
      candidate: {
        startAt: "2025-03-01T00:00:00.000Z",
        endAt: "2025-03-31T23:59:59.999Z"
      }
    }
  ];
  const assignmentCandidates = rows.map((row) => {
    const candidate = structuredClone(row.candidate);
    return {
      assignment: structuredClone(row.assignment),
      result: {
        roleWindow: validationRoleWindow(row.assignment),
        structuralCapacityCount: 1,
        candidates: [candidate],
        calendarRejectedCandidates: [],
        calendarRejectedCandidateCount: 0,
        scopeUnavailableCandidateCount:
          candidate.scopeAvailable ? 0 : 1,
        warnings: []
      }
    };
  });
  return {
    aggregation: {
      assignmentCandidates,
      calendarRejectedCandidates,
      structuralCapacityCount: rows.length + 1,
      calendarValidCandidateCount: rows.length,
      calendarRejectedCandidateCount: 1,
      scopeUnavailableCandidateCount: rows.filter(
        (row) => !row.candidate.scopeAvailable
      ).length
    },
    eligibility: eligibilityResult,
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  };
}

function result(
  candidates: EvidenceExpansionCandidateEligibility[]
): EvidenceExpansionCandidateEligibilityResult {
  return {
    candidates,
    acceptedCandidateCount: candidates.filter(
      (candidate) => candidate.status === "accepted"
    ).length,
    scopeUnavailableCandidateCount: candidates.filter(
      (candidate) =>
        candidate.exclusionReason === "SCOPE_UNAVAILABLE"
    ).length,
    insufficientRegimeDataCandidateCount: candidates.filter(
      (candidate) =>
        candidate.exclusionReason === "INSUFFICIENT_REGIME_DATA"
    ).length
  };
}

function eligibility(
  groupCharacter: string,
  sourceCharacter: string,
  splitRole: ValidationSplitRole,
  scopeAvailable: boolean,
  exclusionReason: EvidenceExpansionCandidateEligibility[
    "exclusionReason"
  ]
): EvidenceExpansionCandidateEligibility {
  const interval = candidateInterval(groupCharacter);
  return {
    assignment: assignment(splitRole),
    candidate: {
      startAt: interval.startAt,
      endAt: interval.endAt,
      regime: "bull",
      scopeAvailable,
      variant: {
        evidenceGroupHash: hash(groupCharacter),
        sourceVariant: {
          feasibilityCandidateHash: hash(sourceCharacter),
          legacyReplayPlanEvidenceGroupHash: null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash: hash(sourceCharacter),
          observedTradingDatesHash: hash("e"),
          universeMembershipHash: hash("f")
        },
        observedTradingDates: [],
        universeMembership: scopeAvailable
          ? [{ market: "KR", symbol: "005930" }]
          : []
      }
    },
    status: exclusionReason === null ? "accepted" : "excluded",
    exclusionReason
  };
}

function assignment(
  splitRole: ValidationSplitRole
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: `split-${splitRole}`,
    splitIndex: 0,
    splitRole,
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

function candidateInterval(character: string): {
  startAt: string;
  endAt: string;
} {
  const day = Number.parseInt(character, 16);
  return {
    startAt: `2025-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    endAt: `2025-01-${String(day + 10).padStart(2, "0")}T23:59:59.999Z`
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
