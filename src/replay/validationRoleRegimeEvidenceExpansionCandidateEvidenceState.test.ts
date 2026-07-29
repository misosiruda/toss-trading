import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  EvidenceExpansionEnumeratedAssignmentCandidate
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidates.js";
import {
  buildEvidenceExpansionCandidateEvidenceState
} from "./validationRoleRegimeEvidenceExpansionCandidateEvidenceState.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import type {
  EvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import type {
  EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  EvidenceExpansionExclusion,
  EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";
import type {
  ValidationSplitAssignment,
  ValidationSplitRole
} from "./validationProtocol.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

const policy: EvidenceExpansionGroupWindowPolicy = {
  candidateStrategyBucket: "short_term",
  windowMonths: 1,
  timezoneOffsetMinutes: 540
};

test("candidate evidence state merges partition and cross-source exclusions", () => {
  const input = stateInput();

  const state = buildEvidenceExpansionCandidateEvidenceState(input);

  assert.deepEqual(state.partitionSummary, {
    structuralCandidateCount: 2,
    calendarValidCandidateCount: 2,
    calendarRejectedCandidateCount: 0,
    acceptedCandidateCount: 1,
    excludedCandidateCount: 1,
    uniqueStructuralEvidenceGroupCount: 2,
    uniqueAcceptedEvidenceGroupCount: 1,
    uniqueExcludedEvidenceGroupCount: 1,
    acceptedExcludedSharedEvidenceGroupCount: 0
  });
  assert.equal(
    state.capacityState.classification
      .baselineOverlapEvidenceGroupCount,
    1
  );
  assert.deepEqual(
    state.exclusions.map((value) => value.reason),
    [
      "CROSS_ROLE_SHARED_EVIDENCE",
      "DUPLICATE_BASELINE_EVIDENCE",
      "SCOPE_UNAVAILABLE"
    ]
  );
});

test("candidate evidence state preserves exclusion provenance by stage", () => {
  const input = stateInput();

  const state = buildEvidenceExpansionCandidateEvidenceState(input);
  const shared = state.exclusions[0]!;
  const baselineOverlap = state.exclusions[1]!;
  const scope = state.exclusions[2]!;

  assert.equal(shared.sourceVariants.length, 2);
  assert.equal(shared.splitRole, null);
  assert.equal(baselineOverlap.sourceVariants.length, 1);
  assert.equal(baselineOverlap.splitRole, "train");
  assert.equal(scope.sourceVariants.length, 1);
  assert.equal(scope.splitRole, "validation");
});

test("candidate evidence state rejects partition count drift", () => {
  const input = stateInput();
  input.partition.consolidation.acceptedCandidateCount = 2;

  assert.throws(
    () => buildEvidenceExpansionCandidateEvidenceState(input),
    /accepted raw count does not match source variants/
  );
});

test("candidate evidence state rejects mismatched window policies", () => {
  const input = stateInput();
  input.baselineWindowPolicy = {
    ...policy,
    windowMonths: 2
  };

  assert.throws(
    () => buildEvidenceExpansionCandidateEvidenceState(input),
    /matching window policies/
  );
});

test("candidate evidence state rejects unknown input fields", () => {
  const input = {
    ...stateInput(),
    status: "ready_for_expansion_replay"
  } as unknown as Parameters<
    typeof buildEvidenceExpansionCandidateEvidenceState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionCandidateEvidenceState(input),
    /input contains unknown fields/
  );
});

function stateInput(): {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
} {
  const accepted = candidate(
    "2025-01-01T00:00:00.000Z",
    "2025-01-31T23:59:59.999Z",
    "1",
    true
  );
  const excluded = candidate(
    "2025-02-01T00:00:00.000Z",
    "2025-02-28T23:59:59.999Z",
    "2",
    false
  );
  const acceptedAssignment = assignment("train");
  const excludedAssignment = assignment("validation");
  const acceptedGroup = evidenceGroup(
    accepted,
    ["train"]
  );
  const baselineGroup: EvidenceExpansionAcceptedEvidenceGroup = {
    ...acceptedGroup,
    splitRoles: ["validation"],
    sourceVariants: [
      sourceVariant(
        accepted.variant.evidenceGroupHash,
        "3",
        true,
        accepted.variant.observedTradingDates,
        accepted.variant.universeMembership
      )
    ]
  };
  return {
    aggregation: {
      assignmentCandidates: [
        assignmentCandidates(acceptedAssignment, [accepted]),
        assignmentCandidates(excludedAssignment, [excluded])
      ],
      calendarRejectedCandidates: [],
      structuralCapacityCount: 2,
      calendarValidCandidateCount: 2,
      calendarRejectedCandidateCount: 0,
      scopeUnavailableCandidateCount: 1
    },
    partition: {
      consolidation: {
        evidenceGroups: [acceptedGroup],
        acceptedCandidateCount: 1,
        uniqueEvidenceGroupCount: 1
      },
      exclusions: [scopeExclusion(excluded, "validation")]
    },
    baseline: {
      evidenceGroups: [baselineGroup],
      acceptedCandidateCount: 1,
      uniqueEvidenceGroupCount: 1
    },
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  };
}

function assignmentCandidates(
  value: ValidationSplitAssignment,
  candidates: EvidenceExpansionEnumeratedAssignmentCandidate[]
): EvidenceExpansionAssignmentCandidateAggregation[
  "assignmentCandidates"
][number] {
  return {
    assignment: value,
    result: {
      roleWindow: validationRoleWindow(value),
      structuralCapacityCount: candidates.length,
      candidates,
      calendarRejectedCandidates: [],
      calendarRejectedCandidateCount: 0,
      scopeUnavailableCandidateCount: candidates.filter(
        (candidateValue) => !candidateValue.scopeAvailable
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
  const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: "short_term",
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: startAt.slice(0, 10) }
  ];
  const universeMembership = scopeAvailable
    ? [{ market: "KR" as const, symbol: "005930" }]
    : [];
  return {
    startAt,
    endAt,
    regime: "bull",
    scopeAvailable,
    variant: sourceVariant(
      evidenceGroupHash,
      sourceCharacter,
      false,
      observedTradingDates,
      universeMembership
    )
  };
}

function evidenceGroup(
  value: EvidenceExpansionEnumeratedAssignmentCandidate,
  splitRoles: ValidationSplitRole[]
): EvidenceExpansionAcceptedEvidenceGroup {
  return {
    evidenceGroupHash: value.variant.evidenceGroupHash,
    startAt: value.startAt,
    endAt: value.endAt,
    targetRegime: "bull",
    splitRoles,
    sourceVariants: [value.variant]
  };
}

function scopeExclusion(
  value: EvidenceExpansionEnumeratedAssignmentCandidate,
  splitRole: ValidationSplitRole
): EvidenceExpansionExclusion {
  return {
    sourceVariants: [value.variant.sourceVariant],
    evidenceGroupHash: value.variant.evidenceGroupHash,
    splitRole,
    targetRegime: "bull",
    reason: "SCOPE_UNAVAILABLE",
    message: "validation candidate scope is unavailable"
  };
}

function sourceVariant(
  evidenceGroupHash: Sha256Hash,
  sourceCharacter: string,
  baseline: boolean,
  observedTradingDates: EvidenceExpansionSourceCandidateVariant[
    "observedTradingDates"
  ],
  universeMembership: EvidenceExpansionSourceCandidateVariant[
    "universeMembership"
  ]
): EvidenceExpansionSourceCandidateVariant {
  const sourceReference: EvidenceExpansionSourceVariantReference = {
    feasibilityCandidateHash: hash(sourceCharacter),
    legacyReplayPlanEvidenceGroupHash: baseline
      ? hash(sourceCharacter)
      : null,
    sourceVariantHashVersion:
      "evidence_expansion_source_variant.v1",
    sourceVariantHash: hash(sourceCharacter),
    observedTradingDatesHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: observedTradingDates
    }),
    universeMembershipHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: universeMembership
    })
  };
  return {
    evidenceGroupHash,
    sourceVariant: sourceReference,
    observedTradingDates,
    universeMembership
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

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
