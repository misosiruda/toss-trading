import assert from "node:assert/strict";
import test from "node:test";

import type { Market, Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  createEvidenceExpansionEvidenceGroupHash
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionPreflightCoreState
} from "./validationRoleRegimeEvidenceExpansionPreflightCoreState.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

test("preflight core state derives identity and evidence inputs from verified sources", () => {
  const state = buildEvidenceExpansionPreflightCoreState(coreInput());

  assert.deepEqual(state.config, {
    candidateStrategyBucket: "short_term",
    targetRegimes: ["bull", "bear", "sideways", "mixed"],
    windowMonths: 1,
    timezoneOffsetMinutes: 0,
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: null,
    inputPolicyVersion: "result_blind_capacity_scan.v1",
    dependencyDiagnosticPolicyVersion:
      "overlap_adjacency_inputs.v1"
  });
  assert.equal(state.source.validationSplitHash, hash("c"));
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 1);
  assert.equal(state.targetMatrix.byRole.train.byRegime.bull, null);
  assert.deepEqual(state.partitionSummary, {
    structuralCandidateCount: 0,
    calendarValidCandidateCount: 0,
    calendarRejectedCandidateCount: 0,
    acceptedCandidateCount: 0,
    excludedCandidateCount: 0,
    uniqueStructuralEvidenceGroupCount: 0,
    uniqueAcceptedEvidenceGroupCount: 0,
    uniqueExcludedEvidenceGroupCount: 0,
    acceptedExcludedSharedEvidenceGroupCount: 0
  });
});

test("preflight core state rejects caller-provided derived inputs", () => {
  for (const field of [
    "targetMatrix",
    "capacity",
    "dependencySource",
    "windowPolicy"
  ]) {
    const input = {
      ...coreInput(),
      [field]: {}
    } as unknown as Parameters<
      typeof buildEvidenceExpansionPreflightCoreState
    >[0];

    assert.throws(
      () => buildEvidenceExpansionPreflightCoreState(input),
      /core state input contains unknown fields/
    );
  }
});

function coreInput(): Parameters<
  typeof buildEvidenceExpansionPreflightCoreState
>[0] {
  return {
    baselineIdentity: baselineIdentity(),
    baselineEvidence: baselineEvidence(),
    expansion: expansionSource(),
    calendarClassifier: calendarClassifier(),
    roleRegimeSampleMinimum: null,
    aggregation: {
      assignmentCandidates: [],
      calendarRejectedCandidates: [],
      structuralCapacityCount: 0,
      calendarValidCandidateCount: 0,
      calendarRejectedCandidateCount: 0,
      scopeUnavailableCandidateCount: 0
    },
    partition: {
      consolidation: {
        evidenceGroups: [],
        acceptedCandidateCount: 0,
        uniqueEvidenceGroupCount: 0
      },
      exclusions: []
    }
  };
}

function baselineIdentity(): VerifiedValidationRoleRegimeEvidenceExpansionBaseline {
  return {
    feasibility: {
      config: {
        candidateStrategyBucket: "short_term",
        windowMonths: 1,
        timezoneOffsetMinutes: 0
      },
      provenance: {
        validationSplitHash: hash("c"),
        calendarHash: hash("d"),
        marketRegimeClassifierHash: hash("e")
      }
    },
    hashes: {
      baselineFeasibilityArtifactHash: hash("f"),
      baselinePlanHash: hash("0"),
      baselineReadinessArtifactHash: hash("a")
    }
  } as VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
}

function expansionSource(): VerifiedValidationRoleRegimeEvidenceExpansionSource {
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
  return {
    coverage,
    hashes: {
      expansionDataSnapshotHash: hash("1"),
      expansionUniverseHash: hash("2"),
      expansionCoverageHash: createReplayResearchHash(coverage),
      validationSplitHash: hash("c")
    }
  } as unknown as VerifiedValidationRoleRegimeEvidenceExpansionSource;
}

function calendarClassifier(): VerifiedEvidenceExpansionCalendarClassifier {
  return {
    officialCalendarArtifact: null,
    hashes: {
      calendarHash: hash("d"),
      officialCalendarArtifactHash: null,
      marketRegimeClassifierHash: hash("e")
    }
  } as VerifiedEvidenceExpansionCalendarClassifier;
}

function baselineEvidence(): Parameters<
  typeof buildEvidenceExpansionPreflightCoreState
>[0]["baselineEvidence"] {
  const startAt = "2025-01-01T00:00:00.000Z";
  const endAt = "2025-01-31T23:59:59.999Z";
  const evidenceGroupHash = createEvidenceExpansionEvidenceGroupHash({
    startAt,
    endAt,
    candidateStrategyBucket: "short_term",
    windowMonths: 1,
    timezoneOffsetMinutes: 0
  });
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: "2025-01-02" }
  ];
  const universeMembership = [
    { market: "KR" as const, symbol: "005930" }
  ];
  const feasibilityCandidateHash = hash("3");
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
              sourceVariantHash: hash("4"),
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

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
