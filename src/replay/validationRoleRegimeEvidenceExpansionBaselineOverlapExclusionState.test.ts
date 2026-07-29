import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionBaselineOverlapExclusionState
} from "./validationRoleRegimeEvidenceExpansionBaselineOverlapExclusionState.js";
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
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

const policy: EvidenceExpansionGroupWindowPolicy = {
  candidateStrategyBucket: "short_term",
  windowMonths: 1,
  timezoneOffsetMinutes: 540
};

test("baseline overlap state preserves duplicate expansion evidence", () => {
  const baselineOverlap = group(0, "bull", ["train"], "a", true);
  const expansionOverlap = group(
    0,
    "bull",
    ["validation"],
    "b",
    false
  );
  const incremental = group(
    32,
    "bear",
    ["test"],
    "c",
    false
  );

  const state = buildEvidenceExpansionBaselineOverlapExclusionState({
    baseline: consolidation([baselineOverlap]),
    expansion: consolidation([incremental, expansionOverlap]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.equal(
    state.capacityState.classification
      .baselineOverlapEvidenceGroupCount,
    1
  );
  assert.equal(
    state.capacityState.capacity.incremental
      .globalUniqueEvidenceGroupCount,
    1
  );
  assert.deepEqual(state.exclusions, [
    {
      sourceVariants: [
        expansionOverlap.sourceVariants[0]!.sourceVariant
      ],
      evidenceGroupHash: expansionOverlap.evidenceGroupHash,
      splitRole: "validation",
      targetRegime: "bull",
      reason: "DUPLICATE_BASELINE_EVIDENCE",
      message: "expansion evidence group duplicates baseline evidence"
    }
  ]);
});

test("baseline overlap state keeps multi-role exclusion unscoped", () => {
  const baselineOverlap = group(0, "bull", ["train"], "a", true);
  const expansionOverlap = group(
    0,
    "bull",
    ["validation", "test"],
    "b",
    false
  );

  const state = buildEvidenceExpansionBaselineOverlapExclusionState({
    baseline: consolidation([baselineOverlap]),
    expansion: consolidation([expansionOverlap]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.equal(state.exclusions[0]!.splitRole, null);
});

test("baseline overlap state sorts exclusions canonically", () => {
  const firstBaseline = group(0, "bull", ["train"], "a", true);
  const secondBaseline = group(32, "bull", ["train"], "b", true);
  const firstExpansion = group(
    0,
    "bull",
    ["validation"],
    "c",
    false
  );
  const secondExpansion = group(
    32,
    "bull",
    ["validation"],
    "d",
    false
  );

  const state = buildEvidenceExpansionBaselineOverlapExclusionState({
    baseline: consolidation([secondBaseline, firstBaseline]),
    expansion: consolidation([secondExpansion, firstExpansion]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  const hashes = state.exclusions.map(
    (value) => value.evidenceGroupHash
  );
  assert.deepEqual(hashes, [...hashes].sort());
});

test("baseline overlap state returns no exclusion without overlap", () => {
  const state = buildEvidenceExpansionBaselineOverlapExclusionState({
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([
      group(32, "bear", ["test"], "b", false)
    ]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.deepEqual(state.exclusions, []);
  assert.equal(
    state.capacityState.capacity.incremental
      .globalUniqueEvidenceGroupCount,
    1
  );
});

test("baseline overlap state rejects source ownership drift", () => {
  const expansion = group(
    0,
    "bull",
    ["validation"],
    "b",
    false
  );
  expansion.sourceVariants[0]!.evidenceGroupHash = hash("9");

  assert.throws(
    () =>
      buildEvidenceExpansionBaselineOverlapExclusionState({
        baseline: consolidation([
          group(0, "bull", ["train"], "a", true)
        ]),
        expansion: consolidation([expansion]),
        baselineWindowPolicy: policy,
        expansionWindowPolicy: policy
      }),
    /source variant does not match group hash/
  );
});

test("baseline overlap state rejects unknown input fields", () => {
  const input = {
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy,
    blockers: []
  } as unknown as Parameters<
    typeof buildEvidenceExpansionBaselineOverlapExclusionState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionBaselineOverlapExclusionState(input),
    /input contains unknown fields/
  );
});

function consolidation(
  evidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[]
): EvidenceExpansionEvidenceGroupConsolidationResult {
  return {
    evidenceGroups,
    acceptedCandidateCount: evidenceGroups.reduce(
      (total, value) => total + value.splitRoles.length,
      0
    ),
    uniqueEvidenceGroupCount: evidenceGroups.length
  };
}

function group(
  intervalOffsetDays: number,
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"],
  splitRoles: ValidationSplitRole[],
  sourceCharacter: string,
  baseline: boolean
): EvidenceExpansionAcceptedEvidenceGroup {
  const startAt = new Date(
    Date.parse("2025-01-01T00:00:00.000Z") +
      intervalOffsetDays * 24 * 60 * 60 * 1_000
  ).toISOString();
  const endAt = new Date(
    Date.parse(startAt) + 31 * 24 * 60 * 60 * 1_000 - 1
  ).toISOString();
  const evidenceGroupHash = createReplayResearchHash({
    startAt,
    endAt,
    candidateStrategyBucket: policy.candidateStrategyBucket,
    windowMonths: policy.windowMonths,
    timezoneOffsetMinutes: policy.timezoneOffsetMinutes
  });
  return {
    evidenceGroupHash,
    startAt,
    endAt,
    targetRegime,
    splitRoles,
    sourceVariants: [
      variant(evidenceGroupHash, sourceCharacter, baseline)
    ]
  };
}

function variant(
  evidenceGroupHash: Sha256Hash,
  sourceCharacter: string,
  baseline: boolean
): EvidenceExpansionSourceCandidateVariant {
  const observedTradingDates = [
    { market: "KR" as const, sessionDate: "2025-01-02" }
  ];
  const universeMembership = [
    { market: "KR" as const, symbol: "005930" }
  ];
  const feasibilityCandidateHash = hash(sourceCharacter);
  return {
    evidenceGroupHash,
    sourceVariant: {
      feasibilityCandidateHash,
      legacyReplayPlanEvidenceGroupHash: baseline
        ? feasibilityCandidateHash
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
    },
    observedTradingDates,
    universeMembership
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
