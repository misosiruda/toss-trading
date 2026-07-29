import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionCrossSourceCapacityState
} from "./validationRoleRegimeEvidenceExpansionCrossSourceCapacityState.js";
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

test("cross-source capacity state assembles classification, union, and capacity", () => {
  const baselineOverlap = group(0, "bull", ["train"], "a", true);
  const baselineOnly = group(32, "bear", ["test"], "b", true);
  const expansionOverlap = group(
    0,
    "bull",
    ["validation"],
    "c",
    false
  );
  const incremental = group(
    64,
    "sideways",
    ["validation", "test"],
    "d",
    false
  );

  const state = buildEvidenceExpansionCrossSourceCapacityState({
    baseline: consolidation([baselineOnly, baselineOverlap]),
    expansion: consolidation([incremental, expansionOverlap]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.equal(state.classification.baselineOverlapEvidenceGroupCount, 1);
  assert.equal(state.union.combinedUniqueEvidenceGroupCount, 3);
  assert.equal(state.capacity.baseline.globalUniqueEvidenceGroupCount, 2);
  assert.equal(state.capacity.expansion.globalUniqueEvidenceGroupCount, 2);
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 3);
  assert.equal(state.capacity.incremental.globalUniqueEvidenceGroupCount, 1);
  assert.equal(
    state.capacity.combined.byRole.validation
      .roleLocalUniqueEvidenceGroupCount,
    2
  );
});

test("cross-source capacity state supports an empty expansion", () => {
  const baseline = group(0, "bull", ["train"], "a", true);

  const state = buildEvidenceExpansionCrossSourceCapacityState({
    baseline: consolidation([baseline]),
    expansion: consolidation([]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.equal(state.classification.expansionUniqueEvidenceGroupCount, 0);
  assert.equal(state.union.combinedUniqueEvidenceGroupCount, 1);
  assert.equal(state.capacity.expansion.globalUniqueEvidenceGroupCount, 0);
  assert.equal(state.capacity.incremental.globalUniqueEvidenceGroupCount, 0);
});

test("cross-source capacity state treats an empty baseline as zero capacity", () => {
  const expansion = group(
    0,
    "bull",
    ["train"],
    "a",
    false
  );

  const state = buildEvidenceExpansionCrossSourceCapacityState({
    baseline: consolidation([]),
    expansion: consolidation([expansion]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.equal(state.capacity.baseline.globalUniqueEvidenceGroupCount, 0);
  assert.equal(state.capacity.combined.globalUniqueEvidenceGroupCount, 1);
  assert.equal(state.capacity.incremental.globalUniqueEvidenceGroupCount, 1);
});

test("cross-source capacity state rejects mismatched window policies", () => {
  const input = {
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: {
      ...policy,
      windowMonths: 2
    }
  };

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityState(input),
    /matching window policies/
  );
});

test("cross-source capacity state rejects source ownership drift", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  baseline.sourceVariants[0]!.evidenceGroupHash = hash("9");

  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceCapacityState({
        baseline: consolidation([baseline]),
        expansion: consolidation([]),
        baselineWindowPolicy: policy,
        expansionWindowPolicy: policy
      }),
    /source variant does not match group hash/
  );
});

test("cross-source capacity state rejects unknown input fields", () => {
  const input = {
    baseline: consolidation([
      group(0, "bull", ["train"], "a", true)
    ]),
    expansion: consolidation([]),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy,
    status: "ready_for_expansion_replay"
  } as unknown as Parameters<
    typeof buildEvidenceExpansionCrossSourceCapacityState
  >[0];

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityState(input),
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
