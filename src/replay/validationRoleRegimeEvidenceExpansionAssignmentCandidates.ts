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

export interface EvidenceExpansionCalendarRejectedCandidate {
  startAt: string;
  endAt: string;
}

export interface EvidenceExpansionAssignmentCandidates {
  roleWindow: ValidationRoleWindow;
  structuralCapacityCount: number;
  candidates: EvidenceExpansionEnumeratedAssignmentCandidate[];
  calendarRejectedCandidates: EvidenceExpansionCalendarRejectedCandidate[];
  calendarRejectedCandidateCount: number;
  scopeUnavailableCandidateCount: number;
  warnings: ValidationRoleCandidateAvailabilityResult["warnings"];
}

export function enumerateEvidenceExpansionAssignmentCandidates(input: {
  assignment: ValidationSplitAssignment;
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    | "snapshots"
    | "assignments"
    | "hashes"
    | "baselineProvenanceHashes"
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
  const calendarRejectedCandidates =
    buildCalendarRejectedCandidates(enumeration, assessment);
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
        sourceIdentity: "expansion",
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
    calendarRejectedCandidates,
    calendarRejectedCandidateCount:
      assessment.calendarRejectedCandidateCount,
    scopeUnavailableCandidateCount:
      assessment.scopeUnavailableCandidateCount,
    warnings: assessment.warnings
  };
}

function buildCalendarRejectedCandidates(
  enumeration: ReturnType<typeof enumerateValidationRoleCandidates>,
  assessment: ReturnType<typeof assessValidationRoleCandidateAvailability>
): EvidenceExpansionCalendarRejectedCandidate[] {
  const structuralIntervals = new Set(
    enumeration.candidates.map((candidate) =>
      intervalKey(
        new Date(candidate.startMs).toISOString(),
        new Date(candidate.endMs).toISOString()
      )
    )
  );
  if (structuralIntervals.size !== enumeration.candidates.length) {
    throw new Error(
      "assignment structural candidates contain duplicate intervals"
    );
  }
  const validIntervals = new Set(
    assessment.candidates.map((candidate) =>
      intervalKey(candidate.startAt, candidate.endAt)
    )
  );
  if (
    validIntervals.size !== assessment.candidates.length ||
    [...validIntervals].some(
      (candidate) => !structuralIntervals.has(candidate)
    )
  ) {
    throw new Error(
      "assignment assessed candidates do not match structural intervals"
    );
  }

  const rejected = enumeration.candidates
    .map((candidate) => ({
      startAt: new Date(candidate.startMs).toISOString(),
      endAt: new Date(candidate.endMs).toISOString()
    }))
    .filter(
      (candidate) =>
        !validIntervals.has(intervalKey(candidate.startAt, candidate.endAt))
    );
  if (rejected.length !== assessment.calendarRejectedCandidateCount) {
    throw new Error(
      "assignment calendar rejection rows do not match assessed count"
    );
  }
  return rejected;
}

function intervalKey(startAt: string, endAt: string): string {
  return JSON.stringify([startAt, endAt]);
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
