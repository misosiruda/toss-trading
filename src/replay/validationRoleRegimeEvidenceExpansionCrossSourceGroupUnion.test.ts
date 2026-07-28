import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  classifyEvidenceExpansionCrossSourceGroups,
  type EvidenceExpansionCrossSourceGroupClassification,
  type EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import {
  buildEvidenceExpansionCrossSourceGroupUnion
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupUnion.js";
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

test("cross-source group union merges overlap and appends incremental groups", () => {
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
    ["validation"],
    "d",
    false
  );
  const input = unionInput(
    consolidation([baselineOnly, baselineOverlap]),
    consolidation([incremental, expansionOverlap])
  );

  const result = buildEvidenceExpansionCrossSourceGroupUnion(input);

  assert.equal(result.baselineUniqueEvidenceGroupCount, 2);
  assert.equal(result.expansionUniqueEvidenceGroupCount, 2);
  assert.equal(result.baselineOverlapEvidenceGroupCount, 1);
  assert.equal(result.incrementalUniqueEvidenceGroupCount, 1);
  assert.equal(result.combinedUniqueEvidenceGroupCount, 3);
  assert.deepEqual(
    result.combinedEvidenceGroups.map((value) => value.evidenceGroupHash),
    [...result.combinedEvidenceGroups]
      .map((value) => value.evidenceGroupHash)
      .sort()
  );
  const overlap = result.combinedEvidenceGroups.find(
    (value) => value.evidenceGroupHash === baselineOverlap.evidenceGroupHash
  );
  assert.deepEqual(overlap?.splitRoles, ["train", "validation"]);
  assert.equal(overlap?.sourceVariants.length, 2);
  assert.deepEqual(result.incrementalEvidenceGroups, [incremental]);
});

test("cross-source group union supports an empty expansion", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  const input = unionInput(consolidation([baseline]), consolidation([]));

  const result = buildEvidenceExpansionCrossSourceGroupUnion(input);

  assert.equal(result.combinedUniqueEvidenceGroupCount, 1);
  assert.deepEqual(result.combinedEvidenceGroups, [baseline]);
  assert.deepEqual(result.incrementalEvidenceGroups, []);
});

test("cross-source group union rejects classification drift", () => {
  const input = unionInput(
    consolidation([group(0, "bull", ["train"], "a", true)]),
    consolidation([])
  );
  input.classification.baselineUniqueEvidenceGroupCount = 2;

  assert.throws(
    () => buildEvidenceExpansionCrossSourceGroupUnion(input),
    /classification does not match source collections/
  );
});

test("cross-source group union rejects source-independent hash drift", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  baseline.evidenceGroupHash = hash("f");
  baseline.sourceVariants[0]!.evidenceGroupHash = hash("f");
  const input = unionInput(consolidation([baseline]), consolidation([]));

  assert.throws(
    () => buildEvidenceExpansionCrossSourceGroupUnion(input),
    /group hash does not match window policy payload/
  );
});

test("cross-source group union rejects source discriminator drift", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  baseline.sourceVariants[0]!.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = null;
  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(consolidation([baseline]), consolidation([]))
      ),
    /must preserve legacy identity/
  );

  const expansion = group(
    32,
    "bear",
    ["validation"],
    "b",
    false
  );
  expansion.sourceVariants[0]!.sourceVariant
    .legacyReplayPlanEvidenceGroupHash =
      expansion.sourceVariants[0]!.sourceVariant.feasibilityCandidateHash;
  const validBaseline = group(0, "bull", ["train"], "c", true);
  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(
          consolidation([validBaseline]),
          consolidation([expansion])
        )
      ),
    /must not carry legacy identity/
  );
});

test("cross-source group union rejects observed evidence hash drift", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  baseline.sourceVariants[0]!.observedTradingDates.push({
    market: "KR",
    sessionDate: "2025-01-03"
  });

  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(consolidation([baseline]), consolidation([]))
      ),
    /evidence hash mismatch/
  );
});

test("cross-source group union rejects non-canonical observed evidence", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  const variant = baseline.sourceVariants[0]!;
  variant.observedTradingDates = [
    { market: "KR", sessionDate: "2025-01-03" },
    { market: "KR", sessionDate: "2025-01-02" }
  ];
  variant.sourceVariant.observedTradingDatesHash =
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: variant.observedTradingDates
    });

  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(consolidation([baseline]), consolidation([]))
      ),
    /observed trading dates must use canonical order/
  );
});

test("cross-source group union rejects non-canonical roles and variants", () => {
  const roles = group(
    0,
    "bull",
    ["validation", "train"],
    "a",
    true
  );
  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(consolidation([roles]), consolidation([]))
      ),
    /roles must use canonical order/
  );

  const expansion = group(
    32,
    "bear",
    ["validation"],
    "b",
    false
  );
  expansion.sourceVariants = [
    variant(expansion.evidenceGroupHash, "d", false),
    variant(expansion.evidenceGroupHash, "c", false)
  ];
  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(
          consolidation([group(0, "bull", ["train"], "e", true)]),
          consolidation([expansion])
        )
      ),
    /source variants must use canonical order/
  );
});

test("cross-source group union rejects duplicate source variant hashes", () => {
  const expansion = group(
    32,
    "bear",
    ["validation"],
    "b",
    false
  );
  const first = variant(expansion.evidenceGroupHash, "a", false);
  const second = variant(expansion.evidenceGroupHash, "b", false);
  second.sourceVariant.sourceVariantHash =
    first.sourceVariant.sourceVariantHash;
  expansion.sourceVariants = [first, second];

  assert.throws(
    () =>
      buildEvidenceExpansionCrossSourceGroupUnion(
        unionInput(
          consolidation([group(0, "bull", ["train"], "c", true)]),
          consolidation([expansion])
        )
      ),
    /duplicate sourceVariantHash/
  );
});

test("cross-source group union rejects source hash reuse across groups", () => {
  const baseline = group(0, "bull", ["train"], "a", true);
  const incremental = group(
    32,
    "bear",
    ["validation"],
    "b",
    false
  );
  incremental.sourceVariants[0]!.sourceVariant.sourceVariantHash =
    baseline.sourceVariants[0]!.sourceVariant.sourceVariantHash;
  const input = unionInput(
    consolidation([baseline]),
    consolidation([incremental])
  );
  input.classification = classifyEvidenceExpansionCrossSourceGroups({
    baseline: input.baseline,
    expansion: input.expansion,
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  });

  assert.throws(
    () => buildEvidenceExpansionCrossSourceGroupUnion(input),
    /source variant hash is reused across evidence groups/
  );
});

function unionInput(
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult,
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult
): {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  classification: EvidenceExpansionCrossSourceGroupClassification;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
} {
  return {
    baseline,
    expansion,
    classification: classifyEvidenceExpansionCrossSourceGroups({
      baseline,
      expansion,
      baselineWindowPolicy: policy,
      expansionWindowPolicy: policy
    }),
    baselineWindowPolicy: policy,
    expansionWindowPolicy: policy
  };
}

function consolidation(
  evidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[]
): EvidenceExpansionEvidenceGroupConsolidationResult {
  return {
    evidenceGroups,
    acceptedCandidateCount: evidenceGroups.length,
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
