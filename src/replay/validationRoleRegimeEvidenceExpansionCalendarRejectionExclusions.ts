import type { Sha256Hash } from "../domain/schemas.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import {
  evidenceExpansionExclusionSchema,
  type EvidenceExpansionExclusion
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  VALIDATION_ROLE_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

interface CalendarRejectionGroup {
  startAt: string;
  endAt: string;
  roles: Set<ValidationSplitRole>;
}

export function buildEvidenceExpansionCalendarRejectionExclusions(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionExclusion[] {
  assertExactInputKeys(input);
  if (
    input.aggregation.calendarRejectedCandidates.length !==
    input.aggregation.calendarRejectedCandidateCount
  ) {
    throw new Error(
      "calendar rejection rows do not match aggregation count"
    );
  }

  const groups = new Map<Sha256Hash, CalendarRejectionGroup>();
  const assignmentCandidates = new Set<string>();
  for (const { assignment, candidate } of
    input.aggregation.calendarRejectedCandidates) {
    const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      candidateStrategyBucket: "short_term",
      windowMonths: input.windowMonths,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    });
    const assignmentCandidateKey = JSON.stringify([
      assignment.splitId,
      assignment.splitIndex,
      assignment.splitRole,
      evidenceGroupHash
    ]);
    if (assignmentCandidates.has(assignmentCandidateKey)) {
      throw new Error(
        "calendar rejection diagnostics contain a duplicate assignment candidate"
      );
    }
    assignmentCandidates.add(assignmentCandidateKey);

    const existing = groups.get(evidenceGroupHash);
    if (existing === undefined) {
      groups.set(evidenceGroupHash, {
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        roles: new Set([assignment.splitRole])
      });
      continue;
    }
    if (
      existing.startAt !== candidate.startAt ||
      existing.endAt !== candidate.endAt
    ) {
      throw new Error(
        "calendar rejection evidence group has conflicting intervals"
      );
    }
    existing.roles.add(assignment.splitRole);
  }

  return [...groups.entries()]
    .map(([evidenceGroupHash, group]) =>
      evidenceExpansionExclusionSchema.parse({
        sourceVariants: [],
        evidenceGroupHash,
        splitRole:
          group.roles.size === 1 ? [...group.roles][0]! : null,
        targetRegime: null,
        reason: "CALENDAR_SESSION_REJECTED",
        message: "candidate interval failed calendar validation"
      })
    )
    .sort(compareCalendarRejectionExclusions);
}

function compareCalendarRejectionExclusions(
  left: EvidenceExpansionExclusion,
  right: EvidenceExpansionExclusion
): number {
  const roleDifference =
    roleIndex(left.splitRole) - roleIndex(right.splitRole);
  return roleDifference !== 0
    ? roleDifference
    : left.evidenceGroupHash.localeCompare(right.evidenceGroupHash);
}

function roleIndex(role: ValidationSplitRole | null): number {
  return role === null
    ? VALIDATION_ROLE_ORDER.length
    : VALIDATION_ROLE_ORDER.indexOf(role);
}

function assertExactInputKeys(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "aggregation",
    "timezoneOffsetMinutes",
    "windowMonths"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "calendar rejection exclusion input contains unknown fields"
    );
  }
}
