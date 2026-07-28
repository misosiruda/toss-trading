import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionCapacityView,
  type EvidenceExpansionCapacityView
} from "./validationRoleRegimeEvidenceExpansionCapacityView.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionCrossSourceGroupUnion
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupUnion.js";

export interface EvidenceExpansionCrossSourceCapacityViews {
  combined: EvidenceExpansionCapacityView;
  incremental: EvidenceExpansionCapacityView;
}

export function buildEvidenceExpansionCrossSourceCapacityViews(
  union: EvidenceExpansionCrossSourceGroupUnion
): EvidenceExpansionCrossSourceCapacityViews {
  assertUnionCounts(union);

  const combined = buildEvidenceExpansionCapacityView({
    evidenceGroups: union.combinedEvidenceGroups,
    uniqueEvidenceGroupCount: union.combinedUniqueEvidenceGroupCount
  });
  const incremental = buildEvidenceExpansionCapacityView({
    evidenceGroups: union.incrementalEvidenceGroups,
    uniqueEvidenceGroupCount: union.incrementalUniqueEvidenceGroupCount
  });

  const combinedByHash = new Map(
    union.combinedEvidenceGroups.map((group) => [
      group.evidenceGroupHash,
      group
    ])
  );
  for (const incrementalGroup of union.incrementalEvidenceGroups) {
    const combinedGroup = combinedByHash.get(
      incrementalGroup.evidenceGroupHash
    );
    if (combinedGroup === undefined) {
      throw new Error(
        "incremental capacity group is missing from combined collection"
      );
    }
    if (
      createReplayResearchHash(combinedGroup) !==
      createReplayResearchHash(incrementalGroup)
    ) {
      throw new Error(
        "incremental capacity group conflicts with combined payload"
      );
    }
  }

  if (
    combined.globalUniqueEvidenceGroupCount !==
      union.combinedUniqueEvidenceGroupCount ||
    incremental.globalUniqueEvidenceGroupCount !==
      union.incrementalUniqueEvidenceGroupCount
  ) {
    throw new Error(
      "cross-source capacity view does not match union group counts"
    );
  }

  return { combined, incremental };
}

function assertUnionCounts(
  union: EvidenceExpansionCrossSourceGroupUnion
): void {
  const counts = [
    union.baselineUniqueEvidenceGroupCount,
    union.expansionUniqueEvidenceGroupCount,
    union.baselineOverlapEvidenceGroupCount,
    union.incrementalUniqueEvidenceGroupCount,
    union.combinedUniqueEvidenceGroupCount
  ];
  if (
    counts.some(
      (count) => !Number.isInteger(count) || count < 0
    ) ||
    union.baselineUniqueEvidenceGroupCount === 0
  ) {
    throw new Error(
      "cross-source capacity requires valid non-negative union counts"
    );
  }
  if (
    union.combinedEvidenceGroups.length !==
      union.combinedUniqueEvidenceGroupCount ||
    union.incrementalEvidenceGroups.length !==
      union.incrementalUniqueEvidenceGroupCount
  ) {
    throw new Error(
      "cross-source capacity collections do not match union counts"
    );
  }
  if (
    union.baselineOverlapEvidenceGroupCount >
      union.baselineUniqueEvidenceGroupCount ||
    union.expansionUniqueEvidenceGroupCount !==
      union.baselineOverlapEvidenceGroupCount +
        union.incrementalUniqueEvidenceGroupCount ||
    union.combinedUniqueEvidenceGroupCount !==
      union.baselineUniqueEvidenceGroupCount +
        union.incrementalUniqueEvidenceGroupCount
  ) {
    throw new Error(
      "cross-source capacity union counts violate conservation"
    );
  }
}
