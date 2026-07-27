import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  enumerateEvidenceExpansionAssignmentCandidates,
  type EvidenceExpansionAssignmentCandidates
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidates.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  VALIDATION_ROLE_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

export interface EvidenceExpansionAssignmentCandidateGroup {
  assignment: ValidationSplitAssignment;
  result: EvidenceExpansionAssignmentCandidates;
}

export interface EvidenceExpansionAssignmentCandidateAggregation {
  assignmentCandidates: EvidenceExpansionAssignmentCandidateGroup[];
  structuralCapacityCount: number;
  calendarValidCandidateCount: number;
  calendarRejectedCandidateCount: number;
  scopeUnavailableCandidateCount: number;
}

export function aggregateEvidenceExpansionAssignmentCandidates(input: {
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "snapshots" | "assignments" | "hashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "calendarValidation" | "marketRegimeClassifier" | "hashes"
  >;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionAssignmentCandidateAggregation {
  if (input.source.assignments.length === 0) {
    throw new Error(
      "evidence expansion aggregation requires verified assignments"
    );
  }

  const assignmentCandidates = [...input.source.assignments]
    .sort(compareAssignments)
    .map((assignment) => ({
      assignment,
      result: enumerateEvidenceExpansionAssignmentCandidates({
        assignment,
        source: input.source,
        calendarClassifier: input.calendarClassifier,
        windowMonths: input.windowMonths,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes
      })
    }));

  const structuralCapacityCount = assignmentCandidates.reduce(
    (total, entry) => total + entry.result.structuralCapacityCount,
    0
  );
  const calendarValidCandidateCount = assignmentCandidates.reduce(
    (total, entry) => total + entry.result.candidates.length,
    0
  );
  const calendarRejectedCandidateCount = assignmentCandidates.reduce(
    (total, entry) =>
      total + entry.result.calendarRejectedCandidateCount,
    0
  );
  const scopeUnavailableCandidateCount = assignmentCandidates.reduce(
    (total, entry) =>
      total + entry.result.scopeUnavailableCandidateCount,
    0
  );

  if (
    structuralCapacityCount !==
    calendarValidCandidateCount + calendarRejectedCandidateCount
  ) {
    throw new Error(
      "aggregate structural capacity does not match candidate diagnostics"
    );
  }
  if (scopeUnavailableCandidateCount > calendarValidCandidateCount) {
    throw new Error(
      "aggregate scope-unavailable count exceeds calendar-valid candidates"
    );
  }

  return {
    assignmentCandidates,
    structuralCapacityCount,
    calendarValidCandidateCount,
    calendarRejectedCandidateCount,
    scopeUnavailableCandidateCount
  };
}

function compareAssignments(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): number {
  return (
    left.splitIndex - right.splitIndex ||
    compareStrings(left.splitId, right.splitId) ||
    VALIDATION_ROLE_ORDER.indexOf(left.splitRole) -
      VALIDATION_ROLE_ORDER.indexOf(right.splitRole)
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
