import {
  classifyMarketRegime,
  type MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
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
    "snapshots" | "assignments" | "hashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "calendarValidation" | "marketRegimeClassifier" | "hashes"
  >;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionAssignmentCandidates {
  assertAssignmentBelongsToVerifiedSource(
    input.assignment,
    input.source.assignments
  );
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

  const {
    version: _classifierVersion,
    ...classifierConfig
  } = input.calendarClassifier.marketRegimeClassifier;
  const candidates = assessment.candidates.map((candidate) => {
    const regime = classifyMarketRegime({
      snapshots: input.source.snapshots,
      windowStart: new Date(candidate.startAt),
      windowEnd: new Date(candidate.endAt),
      ...classifierConfig
    }).label;
    return {
      ...candidate,
      regime,
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
    };
  });

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

function assertAssignmentBelongsToVerifiedSource(
  assignment: ValidationSplitAssignment,
  verifiedAssignments: readonly ValidationSplitAssignment[]
): void {
  if (
    !verifiedAssignments.some((candidate) =>
      sameAssignment(candidate, assignment)
    )
  ) {
    throw new Error(
      "assignment does not match verified validation split source"
    );
  }
}

function sameAssignment(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): boolean {
  return (
    left.validationProtocol === right.validationProtocol &&
    left.splitId === right.splitId &&
    left.splitIndex === right.splitIndex &&
    left.splitRole === right.splitRole &&
    left.trainStart === right.trainStart &&
    left.trainEnd === right.trainEnd &&
    left.validationStart === right.validationStart &&
    left.validationEnd === right.validationEnd &&
    left.testStart === right.testStart &&
    left.testEnd === right.testEnd &&
    left.purgeDurationDays === right.purgeDurationDays &&
    left.embargoDurationDays === right.embargoDurationDays
  );
}
