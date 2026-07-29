import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  EvidenceExpansionEnumeratedAssignmentCandidate
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidates.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionCalendarRejectionExclusions
} from "./validationRoleRegimeEvidenceExpansionCalendarRejectionExclusions.js";
import type {
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionEligibilityPartition
} from "./validationRoleRegimeEvidenceExpansionEligibilityPartition.js";
import {
  evidenceExpansionExclusionSchema,
  type EvidenceExpansionExclusion
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  compareEvidenceExpansionPreflightExclusions
} from "./validationRoleRegimeEvidenceExpansionPreflightExclusionOrder.js";
import type { ValidationSplitAssignment } from "./validationProtocol.js";

export interface EvidenceExpansionCandidatePartition {
  consolidation: ReturnType<
    typeof buildEvidenceExpansionEligibilityPartition
  >["consolidation"];
  exclusions: EvidenceExpansionExclusion[];
}

export function buildEvidenceExpansionCandidatePartition(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  eligibility: EvidenceExpansionCandidateEligibilityResult;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionCandidatePartition {
  assertExactInputKeys(input);
  assertEligibilityMatchesAggregation(
    input.aggregation,
    input.eligibility,
    input.windowMonths,
    input.timezoneOffsetMinutes
  );
  assertCalendarRejectionsMatchAggregation(input.aggregation);

  const eligibilityPartition =
    buildEvidenceExpansionEligibilityPartition({
      eligibility: input.eligibility
    });
  const calendarExclusions =
    buildEvidenceExpansionCalendarRejectionExclusions({
      aggregation: input.aggregation,
      windowMonths: input.windowMonths,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    });
  assertCalendarGroupsDoNotOverlapEligibility(
    calendarExclusions,
    input.eligibility
  );

  const exclusions = evidenceExpansionExclusionSchema.array().parse(
    [...calendarExclusions, ...eligibilityPartition.exclusions].sort(
      compareEvidenceExpansionPreflightExclusions
    )
  );
  assertUniqueExclusions(exclusions);

  return {
    consolidation: eligibilityPartition.consolidation,
    exclusions
  };
}

function assertEligibilityMatchesAggregation(
  aggregation: EvidenceExpansionAssignmentCandidateAggregation,
  eligibility: EvidenceExpansionCandidateEligibilityResult,
  windowMonths: number,
  timezoneOffsetMinutes: number
): void {
  const aggregationRows = aggregation.assignmentCandidates.flatMap(
    ({ assignment, result }) =>
      result.candidates.map((candidate) => {
        assertCandidateGroupHashMatchesPolicy(
          candidate,
          windowMonths,
          timezoneOffsetMinutes
        );
        return candidateRowKey(assignment, candidate);
      })
  );
  const eligibilityRows = eligibility.candidates.map(
    ({ assignment, candidate }) =>
      candidateRowKey(assignment, candidate)
  );
  const expected = uniqueRowSet(
    aggregationRows,
    "aggregation contains duplicate calendar-valid candidates"
  );
  const actual = uniqueRowSet(
    eligibilityRows,
    "eligibility contains duplicate calendar-valid candidates"
  );
  if (!sameSet(expected, actual)) {
    throw new Error(
      "eligibility candidates do not match aggregation candidates"
    );
  }
}

function assertCalendarRejectionsMatchAggregation(
  aggregation: EvidenceExpansionAssignmentCandidateAggregation
): void {
  const nestedRows = aggregation.assignmentCandidates.flatMap(
    ({ assignment, result }) =>
      result.calendarRejectedCandidates.map((candidate) =>
        calendarRejectedRowKey(assignment, candidate)
      )
  );
  const flattenedRows = aggregation.calendarRejectedCandidates.map(
    ({ assignment, candidate }) =>
      calendarRejectedRowKey(assignment, candidate)
  );
  const expected = uniqueRowSet(
    nestedRows,
    "aggregation contains duplicate nested calendar rejections"
  );
  const actual = uniqueRowSet(
    flattenedRows,
    "aggregation contains duplicate flattened calendar rejections"
  );
  if (!sameSet(expected, actual)) {
    throw new Error(
      "flattened calendar rejections do not match assignment diagnostics"
    );
  }
}

function calendarRejectedRowKey(
  assignment: ValidationSplitAssignment,
  candidate: { startAt: string; endAt: string }
): string {
  return JSON.stringify([
    ...assignmentIdentity(assignment),
    candidate.startAt,
    candidate.endAt
  ]);
}

function assertCandidateGroupHashMatchesPolicy(
  candidate: EvidenceExpansionEnumeratedAssignmentCandidate,
  windowMonths: number,
  timezoneOffsetMinutes: number
): void {
  const expected = createEvidenceExpansionEvidenceGroupHash({
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    candidateStrategyBucket: "short_term",
    windowMonths,
    timezoneOffsetMinutes
  });
  if (candidate.variant.evidenceGroupHash !== expected) {
    throw new Error(
      "calendar-valid evidence group hash does not match partition policy"
    );
  }
}

function candidateRowKey(
  assignment: ValidationSplitAssignment,
  candidate: EvidenceExpansionEnumeratedAssignmentCandidate
): string {
  const { sourceVariant } = candidate.variant;
  return JSON.stringify([
    ...assignmentIdentity(assignment),
    candidate.startAt,
    candidate.endAt,
    candidate.regime,
    candidate.scopeAvailable,
    candidate.variant.evidenceGroupHash,
    sourceVariant.feasibilityCandidateHash,
    sourceVariant.legacyReplayPlanEvidenceGroupHash,
    sourceVariant.sourceVariantHashVersion,
    sourceVariant.sourceVariantHash,
    sourceVariant.observedTradingDatesHash,
    sourceVariant.universeMembershipHash,
    candidate.variant.observedTradingDates.map((entry) => [
      entry.market,
      entry.sessionDate
    ]),
    candidate.variant.universeMembership.map((entry) => [
      entry.market,
      entry.symbol
    ])
  ]);
}

function assignmentIdentity(
  assignment: ValidationSplitAssignment
): unknown[] {
  return [
    assignment.validationProtocol,
    assignment.splitId,
    assignment.splitIndex,
    assignment.splitRole,
    assignment.trainStart,
    assignment.trainEnd,
    assignment.validationStart,
    assignment.validationEnd,
    assignment.testStart,
    assignment.testEnd,
    assignment.purgeDurationDays,
    assignment.embargoDurationDays
  ];
}

function assertCalendarGroupsDoNotOverlapEligibility(
  calendarExclusions: readonly EvidenceExpansionExclusion[],
  eligibility: EvidenceExpansionCandidateEligibilityResult
): void {
  const calendarGroups = new Set(
    calendarExclusions.map((entry) => entry.evidenceGroupHash)
  );
  if (
    eligibility.candidates.some((entry) =>
      calendarGroups.has(entry.candidate.variant.evidenceGroupHash)
    )
  ) {
    throw new Error(
      "calendar-rejected evidence group overlaps calendar-valid eligibility"
    );
  }
}

function assertUniqueExclusions(
  exclusions: readonly EvidenceExpansionExclusion[]
): void {
  const keys = new Set<string>();
  for (const exclusion of exclusions) {
    const key = JSON.stringify([
      exclusion.reason,
      exclusion.evidenceGroupHash
    ]);
    if (keys.has(key)) {
      throw new Error(
        "candidate partition exclusions contain duplicate groups"
      );
    }
    keys.add(key);
  }
}

function uniqueRowSet(
  rows: readonly string[],
  message: string
): Set<string> {
  const result = new Set(rows);
  if (result.size !== rows.length) {
    throw new Error(message);
  }
  return result;
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function assertExactInputKeys(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  eligibility: EvidenceExpansionCandidateEligibilityResult;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "aggregation",
    "eligibility",
    "timezoneOffsetMinutes",
    "windowMonths"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "candidate partition input contains unknown fields"
    );
  }
}
