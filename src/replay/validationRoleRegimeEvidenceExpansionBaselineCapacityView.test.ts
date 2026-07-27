import assert from "node:assert/strict";
import test from "node:test";

import type { Sha256Hash } from "../domain/schemas.js";
import {
  buildEvidenceExpansionBaselineCapacityView
} from "./validationRoleRegimeEvidenceExpansionBaselineCapacityView.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

test("baseline capacity counts unique, shared, role, and regime groups", () => {
  const result = buildEvidenceExpansionBaselineCapacityView(
    consolidation([
      group("1", "bull", ["train"]),
      group("2", "bear", ["train", "validation"]),
      group("3", "sideways", ["test"])
    ])
  );

  assert.deepEqual(result, {
    globalUniqueEvidenceGroupCount: 3,
    crossRoleSharedEvidenceGroupCount: 1,
    byRole: {
      train: {
        roleLocalUniqueEvidenceGroupCount: 2,
        roleExclusiveEvidenceGroupCount: 1,
        byRegime: { bull: 1, bear: 1, sideways: 0, mixed: 0 }
      },
      validation: {
        roleLocalUniqueEvidenceGroupCount: 1,
        roleExclusiveEvidenceGroupCount: 0,
        byRegime: { bull: 0, bear: 1, sideways: 0, mixed: 0 }
      },
      test: {
        roleLocalUniqueEvidenceGroupCount: 1,
        roleExclusiveEvidenceGroupCount: 1,
        byRegime: { bull: 0, bear: 0, sideways: 1, mixed: 0 }
      }
    }
  });
});

test("baseline capacity rejects empty consolidation", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionBaselineCapacityView({
        evidenceGroups: [],
        acceptedCandidateCount: 0,
        uniqueEvidenceGroupCount: 0
      }),
    /requires consolidated evidence groups/
  );
});

test("baseline capacity rejects accepted run count drift", () => {
  const value = consolidation([
    group("1", "bull", ["train", "validation"])
  ]);
  value.acceptedCandidateCount = 1;

  assert.throws(
    () => buildEvidenceExpansionBaselineCapacityView(value),
    /role memberships do not match accepted runs/
  );
});

test("baseline capacity rejects multiple source variants", () => {
  const value = consolidation([
    group("1", "bull", ["train"])
  ]);
  value.evidenceGroups[0]!.sourceVariants.push({
    ...value.evidenceGroups[0]!.sourceVariants[0]!,
    sourceVariant: {
      ...value.evidenceGroups[0]!.sourceVariants[0]!.sourceVariant,
      sourceVariantHash: hash("f")
    }
  });

  assert.throws(
    () => buildEvidenceExpansionBaselineCapacityView(value),
    /requires one source variant/
  );
});

test("baseline capacity rejects expansion source identity", () => {
  const value = consolidation([
    group("1", "bull", ["train"])
  ]);
  value.evidenceGroups[0]!.sourceVariants[0]!.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = null;

  assert.throws(
    () => buildEvidenceExpansionBaselineCapacityView(value),
    /must preserve legacy identity/
  );
});

test("baseline capacity rejects legacy identity drift", () => {
  const value = consolidation([
    group("1", "bull", ["train"])
  ]);
  value.evidenceGroups[0]!.sourceVariants[0]!.sourceVariant
    .legacyReplayPlanEvidenceGroupHash = hash("f");

  assert.throws(
    () => buildEvidenceExpansionBaselineCapacityView(value),
    /must preserve legacy identity/
  );
});

test("baseline capacity preserves generic consolidation gates", () => {
  const value = consolidation([
    group("1", "bull", ["train"])
  ]);
  value.uniqueEvidenceGroupCount = 2;

  assert.throws(
    () => buildEvidenceExpansionBaselineCapacityView(value),
    /do not match consolidation unique count/
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
  character: string,
  targetRegime: EvidenceExpansionAcceptedEvidenceGroup["targetRegime"],
  splitRoles: ValidationSplitRole[]
): EvidenceExpansionAcceptedEvidenceGroup {
  const candidateHash = hash(character);
  const evidenceGroupHash = hash(
    character === "1" ? "a" : character === "2" ? "b" : "c"
  );
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
          feasibilityCandidateHash: candidateHash,
          legacyReplayPlanEvidenceGroupHash: candidateHash,
          sourceVariantHashVersion:
            "evidence_expansion_source_variant.v1",
          sourceVariantHash: hash(character),
          observedTradingDatesHash: hash("d"),
          universeMembershipHash: hash("e")
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
