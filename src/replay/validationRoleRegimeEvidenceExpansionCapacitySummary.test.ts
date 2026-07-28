import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  buildEvidenceExpansionCapacitySummary
} from "./validationRoleRegimeEvidenceExpansionCapacitySummary.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionCrossSourceGroupUnion
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupUnion.js";
import {
  evidenceExpansionCapacitySummarySchema
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("capacity summary assembles all four source views", () => {
  const input = populatedInput();

  const result = buildEvidenceExpansionCapacitySummary(input);

  assert.equal(result.baseline.globalUniqueEvidenceGroupCount, 2);
  assert.equal(result.expansion.globalUniqueEvidenceGroupCount, 2);
  assert.equal(result.combined.globalUniqueEvidenceGroupCount, 3);
  assert.equal(result.incremental.globalUniqueEvidenceGroupCount, 1);
  assert.equal(
    result.combined.byRole.train.roleLocalUniqueEvidenceGroupCount,
    2
  );
  assert.equal(
    result.incremental.byRole.test.byRegime.sideways,
    1
  );
});

test("capacity summary supports an empty expansion", () => {
  const baselineGroup = group(
    "a",
    "a",
    "bull",
    ["train"],
    true
  );
  const baseline = consolidation([baselineGroup], true);

  const result = buildEvidenceExpansionCapacitySummary({
    baseline,
    expansion: consolidation([], false),
    union: {
      baselineUniqueEvidenceGroupCount: 1,
      expansionUniqueEvidenceGroupCount: 0,
      baselineOverlapEvidenceGroupCount: 0,
      incrementalUniqueEvidenceGroupCount: 0,
      combinedUniqueEvidenceGroupCount: 1,
      combinedEvidenceGroups: [baselineGroup],
      incrementalEvidenceGroups: []
    }
  });

  assert.equal(result.baseline.globalUniqueEvidenceGroupCount, 1);
  assert.equal(result.expansion.globalUniqueEvidenceGroupCount, 0);
  assert.equal(result.combined.globalUniqueEvidenceGroupCount, 1);
  assert.equal(result.incremental.globalUniqueEvidenceGroupCount, 0);
});

test("capacity summary rejects baseline union count drift", () => {
  const input = populatedInput();
  input.union.baselineUniqueEvidenceGroupCount = 3;
  input.union.combinedUniqueEvidenceGroupCount = 4;

  assert.throws(
    () => buildEvidenceExpansionCapacitySummary(input),
    /baseline collection does not match union count/
  );
});

test("capacity summary rejects expansion union count drift", () => {
  const input = populatedInput();
  input.union.expansionUniqueEvidenceGroupCount = 3;
  input.union.baselineOverlapEvidenceGroupCount = 2;

  assert.throws(
    () => buildEvidenceExpansionCapacitySummary(input),
    /expansion collection does not match union count/
  );
});

test("exported capacity summary schema rejects impossible role capacity", () => {
  const summary = buildEvidenceExpansionCapacitySummary(
    populatedInput()
  );
  summary.combined.byRole.train.roleLocalUniqueEvidenceGroupCount = 1;

  assert.throws(
    () => evidenceExpansionCapacitySummarySchema.parse(summary),
    /capacity view must satisfy baseline, expansion, combined, and incremental bounds/
  );
});

test("capacity summary rejects source collection payload drift", () => {
  const input = populatedInput();
  const baselineOnly = input.union.combinedEvidenceGroups[0]!;
  input.union.combinedEvidenceGroups[0] = {
    ...baselineOnly,
    sourceVariants: [
      {
        ...baselineOnly.sourceVariants[0]!,
        sourceVariant: {
          ...baselineOnly.sourceVariants[0]!.sourceVariant,
          observedTradingDatesHash: hash("9")
        }
      }
    ]
  };

  assert.throws(
    () => buildEvidenceExpansionCapacitySummary(input),
    /combined group does not match baseline union payload/
  );
});

test("capacity summary preserves baseline provenance validation", () => {
  const input = populatedInput();
  input.baseline.evidenceGroups[0]!.sourceVariants[0]!.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = null;

  assert.throws(
    () => buildEvidenceExpansionCapacitySummary(input),
    /must preserve legacy identity/
  );
});

function populatedInput(): {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  union: EvidenceExpansionCrossSourceGroupUnion;
} {
  const baselineOnly = group(
    "a",
    "a",
    "bull",
    ["train"],
    true
  );
  const baselineOverlap = group(
    "b",
    "b",
    "bear",
    ["train"],
    true
  );
  const expansionOverlap = group(
    "b",
    "c",
    "bear",
    ["validation"],
    false
  );
  const incremental = group(
    "d",
    "d",
    "sideways",
    ["validation", "test"],
    false
  );
  const combinedOverlap: EvidenceExpansionAcceptedEvidenceGroup = {
    ...baselineOverlap,
    splitRoles: ["train", "validation"],
    sourceVariants: [
      ...baselineOverlap.sourceVariants,
      ...expansionOverlap.sourceVariants
    ]
  };
  return {
    baseline: consolidation([baselineOnly, baselineOverlap], true),
    expansion: consolidation(
      [expansionOverlap, incremental],
      false
    ),
    union: {
      baselineUniqueEvidenceGroupCount: 2,
      expansionUniqueEvidenceGroupCount: 2,
      baselineOverlapEvidenceGroupCount: 1,
      incrementalUniqueEvidenceGroupCount: 1,
      combinedUniqueEvidenceGroupCount: 3,
      combinedEvidenceGroups: [
        baselineOnly,
        combinedOverlap,
        incremental
      ],
      incrementalEvidenceGroups: [incremental]
    }
  };
}

function consolidation(
  evidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[],
  baseline: boolean
): EvidenceExpansionEvidenceGroupConsolidationResult {
  return {
    evidenceGroups,
    acceptedCandidateCount: baseline
      ? evidenceGroups.reduce(
          (total, groupValue) =>
            total + groupValue.splitRoles.length,
          0
        )
      : evidenceGroups.length,
    uniqueEvidenceGroupCount: evidenceGroups.length
  };
}

function group(
  groupCharacter: string,
  sourceCharacter: string,
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"],
  splitRoles: ValidationSplitRole[],
  baseline: boolean
): EvidenceExpansionAcceptedEvidenceGroup {
  const evidenceGroupHash = hash(groupCharacter);
  const sourceVariantHash = hash(sourceCharacter);
  return {
    evidenceGroupHash,
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    targetRegime,
    splitRoles,
    sourceVariants: [
      {
        evidenceGroupHash,
        sourceVariant: {
          feasibilityCandidateHash: sourceVariantHash,
          legacyReplayPlanEvidenceGroupHash: baseline
            ? sourceVariantHash
            : null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash,
          observedTradingDatesHash: hash("e"),
          universeMembershipHash: hash("f")
        },
        observedTradingDates: [
          { market: "KR", sessionDate: "2025-01-02" }
        ],
        universeMembership: [
          { market: "KR", symbol: "005930" }
        ]
      }
    ]
  };
}

function hash(character: string): Sha256Hash {
  return `sha256:${character.repeat(64)}`;
}
