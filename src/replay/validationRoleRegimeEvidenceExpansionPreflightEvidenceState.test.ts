import assert from "node:assert/strict";
import test from "node:test";

import type { Market, Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  classifyEvidenceExpansionCandidateEligibility
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import type {
  EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionPreflightEvidenceState,
  type EvidenceExpansionPreflightDependencySource
} from "./validationRoleRegimeEvidenceExpansionPreflightEvidenceState.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  buildEvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";
import type {
  ValidationSplitAssignment
} from "./validationProtocol.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

const policy: EvidenceExpansionGroupWindowPolicy = {
  candidateStrategyBucket: "short_term",
  windowMonths: 1,
  timezoneOffsetMinutes: 0
};

test("preflight evidence state connects candidate capacity and dependency blockers", () => {
  const state = buildEvidenceExpansionPreflightEvidenceState(stateInput());

  assert.deepEqual(state.partitionSummary, {
    structuralCandidateCount: 1,
    calendarValidCandidateCount: 1,
    calendarRejectedCandidateCount: 0,
    acceptedCandidateCount: 1,
    excludedCandidateCount: 0,
    uniqueStructuralEvidenceGroupCount: 1,
    uniqueAcceptedEvidenceGroupCount: 1,
    uniqueExcludedEvidenceGroupCount: 0,
    acceptedExcludedSharedEvidenceGroupCount: 0
  });
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 2);
  assert.deepEqual(state.dependencyInputs, {
    candidateIntervals: [],
    pairwise: []
  });
  assert.deepEqual(state.exclusions, []);
  assert.deepEqual(
    state.blockers.map(
      ({ code, splitRole }) => `${code}:${splitRole ?? "*"}`
    ),
    [
      "DEPENDENCY_INPUT_INCOMPLETE:*",
      "OFFICIAL_CALENDAR_EVIDENCE_MISSING:*",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:train",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:validation",
      "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET:test",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:train",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:validation",
      "ROLE_LOCAL_CAPACITY_BELOW_TARGET:test",
      "ROLE_REGIME_TARGET_UNDEFINED:*"
    ]
  );
});

test("preflight evidence state rejects caller-provided dependency groups", () => {
  const input = stateInput();
  input.dependencySource = {
    ...input.dependencySource,
    groups: []
  } as unknown as EvidenceExpansionPreflightDependencySource;

  assert.throws(
    () => buildEvidenceExpansionPreflightEvidenceState(input),
    /dependency source contains unknown fields/
  );
});

test("preflight evidence state rejects caller-provided capacity", () => {
  const input = {
    ...stateInput(),
    capacity: {}
  } as unknown as Parameters<
    typeof buildEvidenceExpansionPreflightEvidenceState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionPreflightEvidenceState(input),
    /evidence state input contains unknown fields/
  );
});

function stateInput(): Parameters<
  typeof buildEvidenceExpansionPreflightEvidenceState
>[0] {
  const aggregation = candidateAggregation();
  const partition = buildEvidenceExpansionCandidatePartition({
    aggregation,
    eligibility:
      classifyEvidenceExpansionCandidateEligibility(aggregation),
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  return {
    aggregation,
    partition,
    baseline: baselineConsolidation(),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy,
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null
    }),
    dependencySource: dependencySource()
  };
}

function candidateAggregation(): EvidenceExpansionAssignmentCandidateAggregation {
  const assignment = validationAssignment();
  const startAt = "2025-02-01T00:00:00.000Z";
  const endAt = "2025-02-28T23:59:59.999Z";
  const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: policy.candidateStrategyBucket,
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: "2025-02-03" }
  ];
  const universeMembership = [
    { market: "KR" as const, symbol: "000660" }
  ];
  const candidate = {
    startAt,
    endAt,
    regime: "bear" as const,
    scopeAvailable: true,
    variant: {
      evidenceGroupHash,
      sourceVariant: {
        feasibilityCandidateHash: hash("6"),
        legacyReplayPlanEvidenceGroupHash: null,
        sourceVariantHashVersion:
          "evidence_expansion_source_variant.v1" as const,
        sourceVariantHash: hash("7"),
        observedTradingDatesHash: createReplayResearchHash({
          version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
          sessions: observedTradingDates
        }),
        universeMembershipHash: createReplayResearchHash({
          version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
          members: universeMembership
        })
      },
      observedTradingDates,
      universeMembership
    }
  };
  return {
    assignmentCandidates: [
      {
        assignment,
        result: {
          roleWindow: validationRoleWindow(assignment),
          structuralCapacityCount: 1,
          candidates: [candidate],
          calendarRejectedCandidates: [],
          calendarRejectedCandidateCount: 0,
          scopeUnavailableCandidateCount: 0,
          warnings: []
        }
      }
    ],
    calendarRejectedCandidates: [],
    structuralCapacityCount: 1,
    calendarValidCandidateCount: 1,
    calendarRejectedCandidateCount: 0,
    scopeUnavailableCandidateCount: 0
  };
}

function validationAssignment(): ValidationSplitAssignment {
  return {
    validationProtocol: "walk_forward",
    splitId: "split-validation",
    splitIndex: 0,
    splitRole: "validation",
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

function baselineConsolidation(): Parameters<
  typeof buildEvidenceExpansionPreflightEvidenceState
>[0]["baseline"] {
  const feasibilityCandidateHash = hash("1");
  const startAt = "2025-01-01T00:00:00.000Z";
  const endAt = "2025-01-31T23:59:59.999Z";
  const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: policy.candidateStrategyBucket,
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: "2025-01-02" }
  ];
  const universeMembership = [
    { market: "KR" as const, symbol: "005930" }
  ];
  return {
    evidenceGroups: [
      {
        evidenceGroupHash,
        startAt,
        endAt,
        targetRegime: "bull",
        splitRoles: ["train"],
        sourceVariants: [
          {
            evidenceGroupHash,
            sourceVariant: {
              feasibilityCandidateHash,
              legacyReplayPlanEvidenceGroupHash:
                feasibilityCandidateHash,
              sourceVariantHashVersion:
                "evidence_expansion_source_variant.v1",
              sourceVariantHash: hash("3"),
              observedTradingDatesHash: createReplayResearchHash({
                version:
                  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
                sessions: observedTradingDates
              }),
              universeMembershipHash: createReplayResearchHash({
                version:
                  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
                members: universeMembership
              })
            },
            observedTradingDates,
            universeMembership
          }
        ]
      }
    ],
    acceptedCandidateCount: 1,
    uniqueEvidenceGroupCount: 1
  };
}

function dependencySource(): EvidenceExpansionPreflightDependencySource {
  const coverage = {
    mode: "paper_only" as const,
    universeId: "fixture-universe",
    status: "available" as const,
    rangeStart: "2025-01-01T00:00:00.000Z",
    rangeEnd: "2025-01-31T23:59:59.999Z",
    timezoneOffsetMinutes: 0,
    minMonthlyCoverageRatio: 1,
    minSnapshotsPerSymbol: 1,
    minAvailableSymbolCount: 1,
    minAvailableMarketSymbolCounts: {},
    minAvailableAssetTypeSymbolCounts: {},
    minAvailableStrategyBucketSymbolCounts: {},
    requireOptionalSymbols: false,
    requiredMarkets: ["KR"] as Market[],
    requiredAssetTypes: [],
    requiredStrategyBuckets: ["short_term" as const],
    corruptLineCount: 0 as const,
    availableStrategyBuckets: ["short_term" as const]
  };
  const source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "coverage" | "hashes"
  > = {
    coverage,
    hashes: {
      expansionDataSnapshotHash: hash("a"),
      expansionUniverseHash: hash("b"),
      expansionCoverageHash: createReplayResearchHash(coverage),
      validationSplitHash: hash("c")
    }
  };
  const calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "officialCalendarArtifact" | "hashes"
  > = {
    officialCalendarArtifact: null,
    hashes: {
      calendarHash: hash("d"),
      officialCalendarArtifactHash: null,
      marketRegimeClassifierHash: hash("e")
    }
  };
  return { source, calendarClassifier };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
