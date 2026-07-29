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
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import type {
  EvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import {
  buildEvidenceExpansionCandidatePartitionSummary
} from "./validationRoleRegimeEvidenceExpansionCandidatePartitionSummary.js";
import type {
  EvidenceExpansionExclusion,
  EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

test("partition summary reconciles raw candidates and unique groups", () => {
  const input = summaryInput();

  const summary =
    buildEvidenceExpansionCandidatePartitionSummary(input);

  assert.deepEqual(summary, {
    structuralCandidateCount: 4,
    calendarValidCandidateCount: 3,
    calendarRejectedCandidateCount: 1,
    acceptedCandidateCount: 1,
    excludedCandidateCount: 3,
    uniqueStructuralEvidenceGroupCount: 2,
    uniqueAcceptedEvidenceGroupCount: 1,
    uniqueExcludedEvidenceGroupCount: 2,
    acceptedExcludedSharedEvidenceGroupCount: 1
  });
});

test("partition summary rejects incomplete structural coverage", () => {
  const input = summaryInput();
  input.partition.exclusions = input.partition.exclusions.filter(
    (exclusion) =>
      exclusion.reason !== "CALENDAR_SESSION_REJECTED"
  );

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /groups do not cover structural evidence/
  );
});

test("partition summary rejects duplicate excluded groups", () => {
  const input = summaryInput();
  input.partition.exclusions.push(
    structuredClone(input.partition.exclusions[0]!)
  );

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /exclusions contain duplicate groups/
  );
});

test("partition summary rejects accepted raw count drift", () => {
  const input = summaryInput();
  input.partition.consolidation.acceptedCandidateCount = 2;

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /accepted raw count does not match source variants/
  );
});

test("partition summary rejects aggregation count drift", () => {
  const input = summaryInput();
  input.aggregation.structuralCapacityCount = 5;

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /aggregation counts do not reconcile/
  );
});

test("partition summary rejects flattened rejection drift", () => {
  const input = summaryInput();
  input.aggregation.calendarRejectedCandidates[0]!.candidate.endAt =
    "2025-03-01T23:59:59.999Z";

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /flattened calendar rejections do not match assignment diagnostics/
  );
});

test("partition summary rejects window policy hash drift", () => {
  const input = summaryInput();
  input.windowMonths = 2;

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /valid group hash does not match policy/
  );
});

test("partition summary rejects unrecognized root fields", () => {
  const input = {
    ...summaryInput(),
    blocker: null
  } as unknown as Parameters<
    typeof buildEvidenceExpansionCandidatePartitionSummary
  >[0];

  assert.throws(
    () => buildEvidenceExpansionCandidatePartitionSummary(input),
    /summary input contains unknown fields/
  );
});

function summaryInput(): {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  windowMonths: number;
  timezoneOffsetMinutes: number;
} {
  const accepted = candidate(
    "2025-01-01T00:00:00.000Z",
    "2025-01-31T23:59:59.999Z",
    "1",
    true
  );
  const excluded = candidate(
    accepted.startAt,
    accepted.endAt,
    "2",
    false
  );
  const secondExcluded = candidate(
    accepted.startAt,
    accepted.endAt,
    "3",
    false
  );
  const rejected = {
    startAt: "2025-02-01T00:00:00.000Z",
    endAt: "2025-02-28T23:59:59.999Z"
  };
  const acceptedAssignment = assignment("train");
  const excludedAssignment = assignment("validation");
  const rejectedAssignment = assignment("test");
  const rejectedGroupHash = groupHash(
    rejected.startAt,
    rejected.endAt
  );
  return {
    aggregation: {
      assignmentCandidates: [
        assignmentCandidates(acceptedAssignment, [accepted], []),
        assignmentCandidates(
          excludedAssignment,
          [excluded, secondExcluded],
          []
        ),
        assignmentCandidates(rejectedAssignment, [], [rejected])
      ],
      calendarRejectedCandidates: [
        {
          assignment: structuredClone(rejectedAssignment),
          candidate: structuredClone(rejected)
        }
      ],
      structuralCapacityCount: 4,
      calendarValidCandidateCount: 3,
      calendarRejectedCandidateCount: 1,
      scopeUnavailableCandidateCount: 2
    },
    partition: {
      consolidation: {
        evidenceGroups: [
          {
            evidenceGroupHash: accepted.variant.evidenceGroupHash,
            startAt: accepted.startAt,
            endAt: accepted.endAt,
            targetRegime: "bull",
            splitRoles: ["train"],
            sourceVariants: [accepted.variant]
          }
        ],
        acceptedCandidateCount: 1,
        uniqueEvidenceGroupCount: 1
      },
      exclusions: [
        calendarExclusion(rejectedGroupHash),
        scopeExclusion(excluded, secondExcluded)
      ]
    },
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  };
}

function assignmentCandidates(
  value: ValidationSplitAssignment,
  candidates: EvidenceExpansionEnumeratedAssignmentCandidate[],
  calendarRejectedCandidates: Array<{
    startAt: string;
    endAt: string;
  }>
): EvidenceExpansionAssignmentCandidateAggregation[
  "assignmentCandidates"
][number] {
  return {
    assignment: value,
    result: {
      roleWindow: validationRoleWindow(value),
      structuralCapacityCount:
        candidates.length + calendarRejectedCandidates.length,
      candidates,
      calendarRejectedCandidates,
      calendarRejectedCandidateCount:
        calendarRejectedCandidates.length,
      scopeUnavailableCandidateCount: candidates.filter(
        (candidate) => !candidate.scopeAvailable
      ).length,
      warnings: []
    }
  };
}

function candidate(
  startAt: string,
  endAt: string,
  sourceCharacter: string,
  scopeAvailable: boolean
): EvidenceExpansionEnumeratedAssignmentCandidate {
  const evidenceGroupHash = groupHash(startAt, endAt);
  const sourceVariant = sourceReference(sourceCharacter);
  return {
    startAt,
    endAt,
    regime: "bull",
    scopeAvailable,
    variant: {
      evidenceGroupHash,
      sourceVariant,
      observedTradingDates: [],
      universeMembership: scopeAvailable
        ? [{ market: "KR", symbol: "005930" }]
        : []
    }
  };
}

function calendarExclusion(
  evidenceGroupHash: Sha256Hash
): EvidenceExpansionExclusion {
  return {
    sourceVariants: [],
    evidenceGroupHash,
    splitRole: "test",
    targetRegime: null,
    reason: "CALENDAR_SESSION_REJECTED",
    message: "candidate interval failed calendar validation"
  };
}

function scopeExclusion(
  ...values: EvidenceExpansionEnumeratedAssignmentCandidate[]
): EvidenceExpansionExclusion {
  return {
    sourceVariants: values.map(
      (value) => value.variant.sourceVariant
    ),
    evidenceGroupHash: values[0]!.variant.evidenceGroupHash,
    splitRole: "validation",
    targetRegime: "bull",
    reason: "SCOPE_UNAVAILABLE",
    message: "validation candidate scope is unavailable"
  };
}

function sourceReference(
  character: string
): EvidenceExpansionSourceVariantReference {
  return {
    feasibilityCandidateHash: hash(character),
    legacyReplayPlanEvidenceGroupHash: null,
    sourceVariantHashVersion:
      "evidence_expansion_source_variant.v1",
    sourceVariantHash: hash(character),
    observedTradingDatesHash: hash("e"),
    universeMembershipHash: hash("f")
  };
}

function groupHash(startAt: string, endAt: string): Sha256Hash {
  return createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: "short_term",
    windowMonths: 1,
    timezoneOffsetMinutes: 540
  });
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

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
