import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  buildEvidenceExpansionCrossSourceCapacityViews
} from "./validationRoleRegimeEvidenceExpansionCrossSourceCapacityViews.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionCrossSourceGroupUnion
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupUnion.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("cross-source capacity projects combined and incremental views", () => {
  const result = buildEvidenceExpansionCrossSourceCapacityViews(
    populatedUnion()
  );

  assert.deepEqual(result.combined, {
    globalUniqueEvidenceGroupCount: 3,
    crossRoleSharedEvidenceGroupCount: 2,
    byRole: {
      train: {
        roleLocalUniqueEvidenceGroupCount: 2,
        roleExclusiveEvidenceGroupCount: 1,
        byRegime: { bull: 1, bear: 1, sideways: 0, mixed: 0 }
      },
      validation: {
        roleLocalUniqueEvidenceGroupCount: 2,
        roleExclusiveEvidenceGroupCount: 0,
        byRegime: { bull: 0, bear: 1, sideways: 1, mixed: 0 }
      },
      test: {
        roleLocalUniqueEvidenceGroupCount: 1,
        roleExclusiveEvidenceGroupCount: 0,
        byRegime: { bull: 0, bear: 0, sideways: 1, mixed: 0 }
      }
    }
  });
  assert.equal(result.incremental.globalUniqueEvidenceGroupCount, 1);
  assert.equal(
    result.incremental.crossRoleSharedEvidenceGroupCount,
    1
  );
  assert.equal(
    result.incremental.byRole.validation.byRegime.sideways,
    1
  );
  assert.equal(result.incremental.byRole.test.byRegime.sideways, 1);
});

test("cross-source capacity supports an empty incremental view", () => {
  const baseline = group("a", "bull", ["train"]);
  const result = buildEvidenceExpansionCrossSourceCapacityViews({
    baselineUniqueEvidenceGroupCount: 1,
    expansionUniqueEvidenceGroupCount: 0,
    baselineOverlapEvidenceGroupCount: 0,
    incrementalUniqueEvidenceGroupCount: 0,
    combinedUniqueEvidenceGroupCount: 1,
    combinedEvidenceGroups: [baseline],
    incrementalEvidenceGroups: []
  });

  assert.equal(result.combined.globalUniqueEvidenceGroupCount, 1);
  assert.equal(result.incremental.globalUniqueEvidenceGroupCount, 0);
});

test("cross-source capacity supports an empty baseline view", () => {
  const incremental = group("a", "bull", ["train"]);
  const result = buildEvidenceExpansionCrossSourceCapacityViews({
    baselineUniqueEvidenceGroupCount: 0,
    expansionUniqueEvidenceGroupCount: 1,
    baselineOverlapEvidenceGroupCount: 0,
    incrementalUniqueEvidenceGroupCount: 1,
    combinedUniqueEvidenceGroupCount: 1,
    combinedEvidenceGroups: [incremental],
    incrementalEvidenceGroups: [incremental]
  });

  assert.equal(result.combined.globalUniqueEvidenceGroupCount, 1);
  assert.equal(result.incremental.globalUniqueEvidenceGroupCount, 1);
});

test("cross-source capacity rejects collection count drift", () => {
  const union = populatedUnion();
  union.combinedUniqueEvidenceGroupCount = 4;

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityViews(union),
    /collections do not match union counts/
  );
});

test("cross-source capacity rejects count conservation drift", () => {
  const union = populatedUnion();
  union.expansionUniqueEvidenceGroupCount = 3;

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityViews(union),
    /counts violate conservation/
  );
});

test("cross-source capacity rejects missing incremental groups", () => {
  const union = populatedUnion();
  const missing = group("d", "mixed", ["test"]);
  union.incrementalEvidenceGroups = [missing];

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityViews(union),
    /missing from combined collection/
  );
});

test("cross-source capacity rejects incremental payload drift", () => {
  const union = populatedUnion();
  union.incrementalEvidenceGroups = [
    {
      ...union.incrementalEvidenceGroups[0]!,
      splitRoles: ["validation"]
    }
  ];

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityViews(union),
    /conflicts with combined payload/
  );
});

test("cross-source capacity preserves generic group validation", () => {
  const union = populatedUnion();
  union.combinedEvidenceGroups[0]!.splitRoles = [
    "validation",
    "train"
  ];

  assert.throws(
    () => buildEvidenceExpansionCrossSourceCapacityViews(union),
    /canonical order/
  );
});

function populatedUnion(): EvidenceExpansionCrossSourceGroupUnion {
  const baselineOnly = group("a", "bull", ["train"]);
  const overlap = group("b", "bear", ["train", "validation"]);
  const incremental = group(
    "c",
    "sideways",
    ["validation", "test"]
  );
  return {
    baselineUniqueEvidenceGroupCount: 2,
    expansionUniqueEvidenceGroupCount: 2,
    baselineOverlapEvidenceGroupCount: 1,
    incrementalUniqueEvidenceGroupCount: 1,
    combinedUniqueEvidenceGroupCount: 3,
    combinedEvidenceGroups: [baselineOnly, overlap, incremental],
    incrementalEvidenceGroups: [incremental]
  };
}

function group(
  character: string,
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"],
  splitRoles: ValidationSplitRole[]
): EvidenceExpansionAcceptedEvidenceGroup {
  const identity = hash(character);
  return {
    evidenceGroupHash: identity,
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    targetRegime,
    splitRoles,
    sourceVariants: [
      {
        evidenceGroupHash: identity,
        sourceVariant: {
          feasibilityCandidateHash: identity,
          legacyReplayPlanEvidenceGroupHash: null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash: identity,
          observedTradingDatesHash: identity,
          universeMembershipHash: identity
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
