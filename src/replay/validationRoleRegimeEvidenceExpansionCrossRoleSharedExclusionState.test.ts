import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionCrossRoleSharedExclusionState
} from "./validationRoleRegimeEvidenceExpansionCrossRoleSharedExclusionState.js";
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

test("cross-role state preserves expansion-only shared evidence", () => {
  const shared = group(
    32,
    "bear",
    ["validation", "test"],
    "b",
    false
  );

  const state = buildEvidenceExpansionCrossRoleSharedExclusionState({
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([shared]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.equal(
    state.capacityState.capacity.combined
      .crossRoleSharedEvidenceGroupCount,
    1
  );
  assert.deepEqual(state.exclusions, [
    {
      sourceVariants: [shared.sourceVariants[0]!.sourceVariant],
      evidenceGroupHash: shared.evidenceGroupHash,
      splitRole: null,
      targetRegime: "bear",
      reason: "CROSS_ROLE_SHARED_EVIDENCE",
      message: "evidence group is shared across validation roles"
    }
  ]);
});

test("cross-role state combines overlap and shared exclusions", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  const expansion = group(
    0,
    "bull",
    ["validation"],
    "b",
    false
  );

  const state = buildEvidenceExpansionCrossRoleSharedExclusionState({
    baseline: consolidation([baseline]),
    expansion: consolidation([expansion]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.deepEqual(
    state.exclusions.map((value) => value.reason),
    [
      "CROSS_ROLE_SHARED_EVIDENCE",
      "DUPLICATE_BASELINE_EVIDENCE"
    ]
  );
  assert.deepEqual(
    state.exclusions[0]!.sourceVariants.map(
      (value) => value.sourceVariantHash
    ),
    [
      baseline.sourceVariants[0]!.sourceVariant.sourceVariantHash,
      expansion.sourceVariants[0]!.sourceVariant.sourceVariantHash
    ]
  );
  assert.deepEqual(
    state.exclusions[1]!.sourceVariants.map(
      (value) => value.sourceVariantHash
    ),
    [expansion.sourceVariants[0]!.sourceVariant.sourceVariantHash]
  );
});

test("cross-role state keeps shared evidence in role-local capacity", () => {
  const shared = group(
    32,
    "sideways",
    ["validation", "test"],
    "b",
    false
  );

  const state = buildEvidenceExpansionCrossRoleSharedExclusionState({
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([shared]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  const combined = state.capacityState.capacity.combined;
  assert.equal(
    combined.byRole.validation.roleLocalUniqueEvidenceGroupCount,
    1
  );
  assert.equal(
    combined.byRole.test.roleLocalUniqueEvidenceGroupCount,
    1
  );
  assert.equal(
    combined.byRole.validation.roleExclusiveEvidenceGroupCount,
    0
  );
  assert.equal(
    combined.byRole.test.roleExclusiveEvidenceGroupCount,
    0
  );
});

test("cross-role state returns no exclusion for single-role groups", () => {
  const state = buildEvidenceExpansionCrossRoleSharedExclusionState({
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([
      group(32, "bear", ["validation"], "b", false)
    ]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.deepEqual(state.exclusions, []);
});

test("cross-role state rejects source ownership drift", () => {
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
      buildEvidenceExpansionCrossRoleSharedExclusionState({
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

test("cross-role state rejects unknown input fields", () => {
  const input = {
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy,
    status: "inconclusive"
  } as unknown as Parameters<
    typeof buildEvidenceExpansionCrossRoleSharedExclusionState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionCrossRoleSharedExclusionState(input),
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
