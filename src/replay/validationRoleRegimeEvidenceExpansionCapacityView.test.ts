import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  buildEvidenceExpansionCapacityView
} from "./validationRoleRegimeEvidenceExpansionCapacityView.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("capacity view counts unique, shared, role, and regime groups", () => {
  const result = buildEvidenceExpansionCapacityView(
    consolidation([
      group("1", "bull", ["train"]),
      group("2", "bear", ["train", "validation"]),
      group("3", "sideways", ["train", "validation", "test"]),
      group("4", "mixed", ["test"])
    ])
  );

  assert.deepEqual(result, {
    globalUniqueEvidenceGroupCount: 4,
    crossRoleSharedEvidenceGroupCount: 2,
    byRole: {
      train: {
        roleLocalUniqueEvidenceGroupCount: 3,
        roleExclusiveEvidenceGroupCount: 1,
        byRegime: { bull: 1, bear: 1, sideways: 1, mixed: 0 }
      },
      validation: {
        roleLocalUniqueEvidenceGroupCount: 2,
        roleExclusiveEvidenceGroupCount: 0,
        byRegime: { bull: 0, bear: 1, sideways: 1, mixed: 0 }
      },
      test: {
        roleLocalUniqueEvidenceGroupCount: 2,
        roleExclusiveEvidenceGroupCount: 1,
        byRegime: { bull: 0, bear: 0, sideways: 1, mixed: 1 }
      }
    }
  });
});

test("capacity view supports an empty consolidated result", () => {
  const result = buildEvidenceExpansionCapacityView(consolidation([]));

  assert.equal(result.globalUniqueEvidenceGroupCount, 0);
  assert.equal(result.crossRoleSharedEvidenceGroupCount, 0);
  assert.equal(result.byRole.train.roleLocalUniqueEvidenceGroupCount, 0);
});

test("capacity view rejects duplicate evidence group hashes", () => {
  const duplicate = group("1", "bull", ["train"]);

  assert.throws(
    () =>
      buildEvidenceExpansionCapacityView(
        consolidation([duplicate, { ...duplicate }])
      ),
    /duplicate evidenceGroupHash/
  );
});

test("capacity view rejects non-canonical roles", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionCapacityView(
        consolidation([
          group("1", "bull", ["validation", "train"])
        ])
      ),
    /canonical order/
  );
});

test("capacity view rejects source variant group mismatch", () => {
  const value = group("1", "bull", ["train"]);
  value.sourceVariants[0]!.evidenceGroupHash = hash("2");

  assert.throws(
    () =>
      buildEvidenceExpansionCapacityView(consolidation([value])),
    /source variant does not match evidence group hash/
  );
});

test("capacity view rejects unknown validation roles", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionCapacityView(
        consolidation([
          group("1", "bull", [
            "unknown" as ValidationSplitRole
          ])
        ])
      ),
    /unknown validation role/
  );
});

test("capacity view rejects consolidation count mismatch", () => {
  const value = consolidation([
    group("1", "bull", ["train"])
  ]);
  value.uniqueEvidenceGroupCount = 2;

  assert.throws(
    () => buildEvidenceExpansionCapacityView(value),
    /do not match consolidation unique count/
  );
});

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
  character: string,
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"],
  splitRoles: ValidationSplitRole[]
): EvidenceExpansionAcceptedEvidenceGroup {
  const sourceVariantHash = hash(character);
  return {
    evidenceGroupHash: hash(character),
    startAt: "2025-01-01T00:00:00.000Z",
    endAt: "2025-01-31T23:59:59.999Z",
    targetRegime,
    splitRoles,
    sourceVariants: [
      {
        evidenceGroupHash: hash(character),
        sourceVariant: {
          feasibilityCandidateHash: sourceVariantHash,
          legacyReplayPlanEvidenceGroupHash: null,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash,
          observedTradingDatesHash: sourceVariantHash,
          universeMembershipHash: sourceVariantHash
        },
        observedTradingDates: [],
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
