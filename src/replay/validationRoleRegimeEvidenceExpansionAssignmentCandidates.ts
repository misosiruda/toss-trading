import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  assessValidationRoleCandidateAvailability,
  enumerateValidationRoleCandidates,
  type ValidationRoleCandidateAvailabilityResult
} from "./validationSplitRegimeFeasibility.js";
import {
  buildEvidenceExpansionSourceCandidateVariant,
  type EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";
import type { ValidationRoleWindow } from "./validationRoleWindow.js";

export interface EvidenceExpansionEnumeratedAssignmentCandidate {
  startAt: string;
  endAt: string;
  regime: MarketRegimeLabel;
  scopeAvailable: boolean;
  variant: EvidenceExpansionSourceCandidateVariant;
}

export interface EvidenceExpansionAssignmentCandidates {
  roleWindow: ValidationRoleWindow;
  structuralCapacityCount: number;
  candidates: EvidenceExpansionEnumeratedAssignmentCandidate[];
  calendarRejectedCandidateCount: number;
  scopeUnavailableCandidateCount: number;
  warnings: ValidationRoleCandidateAvailabilityResult["warnings"];
}

export function enumerateEvidenceExpansionAssignmentCandidates(input: {
  assignment: ValidationSplitAssignment;
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "snapshots" | "hashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "calendarValidation" | "hashes"
  >;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionAssignmentCandidates {
  const enumeration = enumerateValidationRoleCandidates({
    assignment: input.assignment,
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes
  });
  const assessment = assessValidationRoleCandidateAvailability({
    enumeration,
    snapshots: input.source.snapshots,
    calendarValidation: input.calendarClassifier.calendarValidation,
    candidateStrategyBucket: "short_term",
    timezoneOffsetMinutes: input.timezoneOffsetMinutes
  });

  if (
    assessment.structuralCapacityCount !==
    assessment.candidates.length +
      assessment.calendarRejectedCandidateCount
  ) {
    throw new Error(
      "assignment structural capacity does not match assessed candidates"
    );
  }
  const scopeUnavailableCandidateCount = assessment.candidates.filter(
    (candidate) => !candidate.scopeAvailable
  ).length;
  if (
    assessment.scopeUnavailableCandidateCount !==
    scopeUnavailableCandidateCount
  ) {
    throw new Error(
      "assignment scope-unavailable count does not match assessed candidates"
    );
  }

  const candidates = assessment.candidates.map((candidate) => ({
    ...candidate,
    variant: buildEvidenceExpansionSourceCandidateVariant({
      candidate: {
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        scopeAvailable: candidate.scopeAvailable,
        legacyReplayPlanEvidenceGroupHash: null
      },
      source: input.source,
      calendarClassifier: input.calendarClassifier,
      windowMonths: input.windowMonths,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    })
  }));

  return {
    roleWindow: assessment.roleWindow,
    structuralCapacityCount: assessment.structuralCapacityCount,
    candidates,
    calendarRejectedCandidateCount:
      assessment.calendarRejectedCandidateCount,
    scopeUnavailableCandidateCount:
      assessment.scopeUnavailableCandidateCount,
    warnings: assessment.warnings
  };
}
