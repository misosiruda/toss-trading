import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import {
  buildEvidenceExpansionCalendarRejectionExclusions
} from "./validationRoleRegimeEvidenceExpansionCalendarRejectionExclusions.js";
import {
  evidenceExpansionExclusionSchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";

test("calendar rejection exclusions preserve interval identity and role", () => {
  const rejected = candidate("validation");
  const exclusions =
    buildEvidenceExpansionCalendarRejectionExclusions({
      aggregation: aggregation([rejected]),
      windowMonths: 1,
      timezoneOffsetMinutes: 540
    });

  assert.deepEqual(exclusions, [
    {
      sourceVariants: [],
      evidenceGroupHash: createEvidenceExpansionEvidenceGroupHash({
        startAt: rejected.candidate.startAt,
        endAt: rejected.candidate.endAt,
        candidateStrategyBucket: "short_term",
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      }),
      splitRole: "validation",
      targetRegime: null,
      reason: "CALENDAR_SESSION_REJECTED",
      message: "candidate interval failed calendar validation"
    }
  ]);
});

test("calendar rejection exclusions consolidate cross-role evidence", () => {
  const exclusions =
    buildEvidenceExpansionCalendarRejectionExclusions({
      aggregation: aggregation([
        candidate("test"),
        candidate("train"),
        candidate("validation")
      ]),
      windowMonths: 1,
      timezoneOffsetMinutes: 540
    });

  assert.equal(exclusions.length, 1);
  assert.equal(exclusions[0]?.splitRole, null);
});

test("calendar rejection exclusions reject count drift", () => {
  const value = aggregation([candidate("validation")]);
  value.calendarRejectedCandidateCount = 0;

  assert.throws(
    () =>
      buildEvidenceExpansionCalendarRejectionExclusions({
        aggregation: value,
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /rows do not match aggregation count/
  );
});

test("calendar rejection exclusions reject duplicate assignment candidates", () => {
  const rejected = candidate("validation");

  assert.throws(
    () =>
      buildEvidenceExpansionCalendarRejectionExclusions({
        aggregation: aggregation([rejected, structuredClone(rejected)]),
        windowMonths: 1,
        timezoneOffsetMinutes: 540
      }),
    /duplicate assignment candidate/
  );
});

test("calendar rejection exclusion source variant rules fail closed", () => {
  const calendarRejection = {
    sourceVariants: [sourceVariant()],
    evidenceGroupHash: hash("1"),
    splitRole: "validation",
    targetRegime: null,
    reason: "CALENDAR_SESSION_REJECTED",
    message: "calendar rejected"
  };
  assert.throws(
    () => evidenceExpansionExclusionSchema.parse(calendarRejection),
    /must not claim a validated source variant/
  );

  assert.throws(
    () =>
      evidenceExpansionExclusionSchema.parse({
        ...calendarRejection,
        sourceVariants: [],
        reason: "SCOPE_UNAVAILABLE"
      }),
    /non-calendar exclusion requires a source variant/
  );

  assert.throws(
    () =>
      evidenceExpansionExclusionSchema.parse({
        ...calendarRejection,
        sourceVariants: [],
        targetRegime: "bull"
      }),
    /must not claim a target regime/
  );
});

test("calendar rejection exclusions reject unrecognized root fields", () => {
  const input = {
    aggregation: aggregation([]),
    windowMonths: 1,
    timezoneOffsetMinutes: 540,
    status: "ready_for_expansion_replay"
  } as unknown as Parameters<
    typeof buildEvidenceExpansionCalendarRejectionExclusions
  >[0];

  assert.throws(
    () => buildEvidenceExpansionCalendarRejectionExclusions(input),
    /input contains unknown fields/
  );
});

function aggregation(
  calendarRejectedCandidates: EvidenceExpansionAssignmentCandidateAggregation[
    "calendarRejectedCandidates"
  ]
): EvidenceExpansionAssignmentCandidateAggregation {
  return {
    assignmentCandidates: [],
    calendarRejectedCandidates,
    structuralCapacityCount: calendarRejectedCandidates.length,
    calendarValidCandidateCount: 0,
    calendarRejectedCandidateCount:
      calendarRejectedCandidates.length,
    scopeUnavailableCandidateCount: 0
  };
}

function candidate(splitRole: ValidationSplitRole) {
  return {
    assignment: assignment(splitRole),
    candidate: {
      startAt: "2025-01-31T15:00:00.000Z",
      endAt: "2025-02-28T14:59:59.999Z"
    }
  };
}

function assignment(
  splitRole: ValidationSplitRole
): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-0",
    splitIndex: 0,
    splitRole,
    trainStart: "2025-01-01T00:00:00+09:00",
    trainEnd: "2025-01-31T23:59:59.999+09:00",
    validationStart: "2025-02-01T00:00:00+09:00",
    validationEnd: "2025-02-28T23:59:59.999+09:00",
    testStart: "2025-03-01T00:00:00+09:00",
    testEnd: "2025-03-31T23:59:59.999+09:00",
    purgeDurationDays: 0,
    embargoDurationDays: 0
  };
}

function sourceVariant() {
  return {
    feasibilityCandidateHash: hash("2"),
    legacyReplayPlanEvidenceGroupHash: null,
    sourceVariantHashVersion:
      "evidence_expansion_source_variant.v1" as const,
    sourceVariantHash: hash("3"),
    observedTradingDatesHash: hash("4"),
    universeMembershipHash: hash("5")
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
