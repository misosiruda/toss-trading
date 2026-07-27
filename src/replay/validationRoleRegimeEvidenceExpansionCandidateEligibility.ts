import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  EvidenceExpansionEnumeratedAssignmentCandidate
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidates.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

export type EvidenceExpansionCandidateEligibilityStatus =
  | "accepted"
  | "excluded";

export type EvidenceExpansionCandidateEligibilityExclusionReason =
  | "SCOPE_UNAVAILABLE"
  | "INSUFFICIENT_REGIME_DATA";

export interface EvidenceExpansionCandidateEligibility {
  assignment: ValidationSplitAssignment;
  candidate: EvidenceExpansionEnumeratedAssignmentCandidate;
  status: EvidenceExpansionCandidateEligibilityStatus;
  exclusionReason:
    | EvidenceExpansionCandidateEligibilityExclusionReason
    | null;
}

export interface EvidenceExpansionCandidateEligibilityResult {
  candidates: EvidenceExpansionCandidateEligibility[];
  acceptedCandidateCount: number;
  scopeUnavailableCandidateCount: number;
  insufficientRegimeDataCandidateCount: number;
}

export function classifyEvidenceExpansionCandidateEligibility(
  aggregation: EvidenceExpansionAssignmentCandidateAggregation
): EvidenceExpansionCandidateEligibilityResult {
  const candidates = aggregation.assignmentCandidates.flatMap(
    ({ assignment, result }) =>
      result.candidates.map(
        (candidate): EvidenceExpansionCandidateEligibility => {
          const exclusionReason = candidateExclusionReason(candidate);
          return {
            assignment,
            candidate,
            status: exclusionReason === null ? "accepted" : "excluded",
            exclusionReason
          };
        }
      )
  );

  if (candidates.length !== aggregation.calendarValidCandidateCount) {
    throw new Error(
      "candidate eligibility rows do not match calendar-valid count"
    );
  }

  const scopeUnavailableCandidateCount = candidates.filter(
    (candidate) =>
      candidate.exclusionReason === "SCOPE_UNAVAILABLE"
  ).length;
  if (
    scopeUnavailableCandidateCount !==
    aggregation.scopeUnavailableCandidateCount
  ) {
    throw new Error(
      "candidate eligibility scope exclusions do not match aggregation"
    );
  }

  const insufficientRegimeDataCandidateCount = candidates.filter(
    (candidate) =>
      candidate.exclusionReason === "INSUFFICIENT_REGIME_DATA"
  ).length;
  const acceptedCandidateCount = candidates.filter(
    (candidate) => candidate.status === "accepted"
  ).length;
  if (
    acceptedCandidateCount +
      scopeUnavailableCandidateCount +
      insufficientRegimeDataCandidateCount !==
    candidates.length
  ) {
    throw new Error(
      "candidate eligibility counts do not match classified rows"
    );
  }

  return {
    candidates,
    acceptedCandidateCount,
    scopeUnavailableCandidateCount,
    insufficientRegimeDataCandidateCount
  };
}

function candidateExclusionReason(
  candidate: EvidenceExpansionEnumeratedAssignmentCandidate
): EvidenceExpansionCandidateEligibilityExclusionReason | null {
  if (!candidate.scopeAvailable) {
    return "SCOPE_UNAVAILABLE";
  }
  if (candidate.regime === "insufficient_data") {
    return "INSUFFICIENT_REGIME_DATA";
  }
  return null;
}
