import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  mergeEvidenceExpansionOverlappingGroup
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupMerge.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("overlapping group merges roles and source variants", () => {
  const baseline = group(
    ["train"],
    [variant("a", "b", true)]
  );
  const expansion = group(
    ["validation"],
    [variant("c", "d", false)]
  );

  const result = mergeEvidenceExpansionOverlappingGroup({
    baseline,
    expansion
  });

  assert.deepEqual(result.splitRoles, ["train", "validation"]);
  assert.deepEqual(
    result.sourceVariants.map(
      (value) => value.sourceVariant.sourceVariantHash
    ),
    [hash("b"), hash("d")]
  );
});

test("overlapping group deduplicates canonical source variants", () => {
  const baselineVariant = variant("a", "b", true);
  const expansionVariant = {
    ...baselineVariant,
    sourceVariant: {
      ...baselineVariant.sourceVariant,
      legacyReplayPlanEvidenceGroupHash: null
    }
  };

  const result = mergeEvidenceExpansionOverlappingGroup({
    baseline: group(["train"], [baselineVariant]),
    expansion: group(["validation"], [expansionVariant])
  });

  assert.equal(result.sourceVariants.length, 1);
  assert.equal(
    result.sourceVariants[0]!.sourceVariant
      .legacyReplayPlanEvidenceGroupHash,
    hash("a")
  );
});

test("overlapping group rejects evidence group hash drift", () => {
  const expansion = group(
    ["validation"],
    [variant("c", "d", false)]
  );
  expansion.evidenceGroupHash = hash("f");
  expansion.sourceVariants[0]!.evidenceGroupHash = hash("f");

  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [variant("a", "b", true)]),
        expansion
      }),
    /must use the same evidenceGroupHash/
  );
});

test("overlapping group rejects interval and regime drift", () => {
  const intervalDrift = group(
    ["validation"],
    [variant("c", "d", false)]
  );
  intervalDrift.endAt = "2025-02-01T23:59:59.999Z";
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [variant("a", "b", true)]),
        expansion: intervalDrift
      }),
    /conflicting interval payload/
  );

  const regimeDrift = group(
    ["validation"],
    [variant("c", "d", false)]
  );
  regimeDrift.targetRegime = "bear";
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [variant("a", "b", true)]),
        expansion: regimeDrift
      }),
    /conflicting regime labels/
  );
});

test("overlapping group rejects source discriminator drift", () => {
  const invalidBaseline = variant("a", "b", true);
  invalidBaseline.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = null;
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [invalidBaseline]),
        expansion: group(
          ["validation"],
          [variant("c", "d", false)]
        )
      }),
    /baseline source variant must preserve legacy identity/
  );

  const mismatchedBaseline = variant("a", "b", true);
  mismatchedBaseline.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = hash("c");
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [mismatchedBaseline]),
        expansion: group(
          ["validation"],
          [variant("d", "e", false)]
        )
      }),
    /baseline source variant must preserve legacy identity/
  );

  const invalidExpansion = variant("c", "d", false);
  invalidExpansion.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = hash("c");
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [variant("a", "b", true)]),
        expansion: group(["validation"], [invalidExpansion])
      }),
    /expansion source variant must not carry legacy identity/
  );
});

test("overlapping group rejects invalid source variant cardinality", () => {
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(
          ["train"],
          [variant("a", "b", true), variant("c", "d", true)]
        ),
        expansion: group(
          ["validation"],
          [variant("e", "f", false)]
        )
      }),
    /requires one baseline source variant/
  );

  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [variant("a", "b", true)]),
        expansion: group(["validation"], [])
      }),
    /requires expansion source variants/
  );
});

test("overlapping group rejects variant group hash drift", () => {
  const invalidExpansion = variant("c", "d", false);
  invalidExpansion.evidenceGroupHash = hash("f");

  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [variant("a", "b", true)]),
        expansion: group(["validation"], [invalidExpansion])
      }),
    /source variant does not match evidence group hash/
  );
});

test("overlapping group rejects source hash payload conflicts", () => {
  const baselineVariant = variant("a", "b", true);
  const expansionVariant = variant("a", "b", false);
  expansionVariant.universeMembership = [
    { market: "KR", symbol: "000660" }
  ];

  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["train"], [baselineVariant]),
        expansion: group(["validation"], [expansionVariant])
      }),
    /conflicting canonical payload/
  );
});

test("overlapping group rejects non-canonical roles", () => {
  assert.throws(
    () =>
      mergeEvidenceExpansionOverlappingGroup({
        baseline: group(["validation", "train"], [
          variant("a", "b", true)
        ]),
        expansion: group(
          ["test"],
          [variant("c", "d", false)]
        )
      }),
    /roles must use canonical order/
  );
});

function group(
  splitRoles: ValidationSplitRole[],
  sourceVariants: EvidenceExpansionSourceCandidateVariant[]
): EvidenceExpansionAcceptedEvidenceGroup {
  return {
    evidenceGroupHash: hash("e"),
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    targetRegime: "bull",
    splitRoles,
    sourceVariants
  };
}

function variant(
  candidateCharacter: string,
  variantCharacter: string,
  baseline: boolean
): EvidenceExpansionSourceCandidateVariant {
  const candidateHash = hash(candidateCharacter);
  return {
    evidenceGroupHash: hash("e"),
    sourceVariant: {
      feasibilityCandidateHash: candidateHash,
      legacyReplayPlanEvidenceGroupHash: baseline
        ? candidateHash
        : null,
      sourceVariantHashVersion:
        "evidence_expansion_source_variant.v1",
      sourceVariantHash: hash(variantCharacter),
      observedTradingDatesHash: hash("1"),
      universeMembershipHash: hash("2")
    },
    observedTradingDates: [
      { market: "KR", sessionDate: "2025-01-02" }
    ],
    universeMembership: [
      { market: "KR", symbol: "005930" }
    ]
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
