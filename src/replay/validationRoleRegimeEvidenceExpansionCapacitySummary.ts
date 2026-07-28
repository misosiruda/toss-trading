import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionBaselineCapacityView
} from "./validationRoleRegimeEvidenceExpansionBaselineCapacityView.js";
import {
  buildEvidenceExpansionCapacityView
} from "./validationRoleRegimeEvidenceExpansionCapacityView.js";
import {
  buildEvidenceExpansionCrossSourceCapacityViews
} from "./validationRoleRegimeEvidenceExpansionCrossSourceCapacityViews.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  mergeEvidenceExpansionOverlappingGroup
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupMerge.js";
import type {
  EvidenceExpansionCrossSourceGroupUnion
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupUnion.js";
import {
  evidenceExpansionCapacitySummarySchema,
  type EvidenceExpansionCapacitySummary
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export function buildEvidenceExpansionCapacitySummary(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  union: EvidenceExpansionCrossSourceGroupUnion;
}): EvidenceExpansionCapacitySummary {
  if (
    input.baseline.uniqueEvidenceGroupCount !==
    input.union.baselineUniqueEvidenceGroupCount
  ) {
    throw new Error(
      "capacity summary baseline collection does not match union count"
    );
  }
  if (
    input.expansion.uniqueEvidenceGroupCount !==
    input.union.expansionUniqueEvidenceGroupCount
  ) {
    throw new Error(
      "capacity summary expansion collection does not match union count"
    );
  }

  const baseline = buildEvidenceExpansionBaselineCapacityView(
    input.baseline
  );
  const expansion = buildEvidenceExpansionCapacityView(
    input.expansion
  );
  const crossSource = buildEvidenceExpansionCrossSourceCapacityViews(
    input.union
  );
  assertUnionMatchesSourceCollections(input);

  return evidenceExpansionCapacitySummarySchema.parse({
    baseline,
    expansion,
    combined: crossSource.combined,
    incremental: crossSource.incremental
  });
}

function assertUnionMatchesSourceCollections(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  union: EvidenceExpansionCrossSourceGroupUnion;
}): void {
  const baselineByHash = indexGroups(input.baseline.evidenceGroups);
  const expansionByHash = indexGroups(input.expansion.evidenceGroups);
  const combinedByHash = indexGroups(
    input.union.combinedEvidenceGroups
  );
  const incrementalByHash = indexGroups(
    input.union.incrementalEvidenceGroups
  );

  for (const baselineGroup of input.baseline.evidenceGroups) {
    const expansionGroup = expansionByHash.get(
      baselineGroup.evidenceGroupHash
    );
    const expected =
      expansionGroup === undefined
        ? baselineGroup
        : mergeEvidenceExpansionOverlappingGroup({
            baseline: baselineGroup,
            expansion: expansionGroup
          });
    if (
      !sameGroup(
        combinedByHash.get(baselineGroup.evidenceGroupHash),
        expected
      )
    ) {
      throw new Error(
        "capacity summary combined group does not match baseline union payload"
      );
    }
  }

  for (const expansionGroup of input.expansion.evidenceGroups) {
    if (baselineByHash.has(expansionGroup.evidenceGroupHash)) {
      continue;
    }
    if (
      !sameGroup(
        incrementalByHash.get(expansionGroup.evidenceGroupHash),
        expansionGroup
      ) ||
      !sameGroup(
        combinedByHash.get(expansionGroup.evidenceGroupHash),
        expansionGroup
      )
    ) {
      throw new Error(
        "capacity summary incremental group does not match expansion payload"
      );
    }
  }
}

function indexGroups(
  groups: readonly EvidenceExpansionAcceptedEvidenceGroup[]
): Map<string, EvidenceExpansionAcceptedEvidenceGroup> {
  return new Map(groups.map((group) => [group.evidenceGroupHash, group]));
}

function sameGroup(
  actual: EvidenceExpansionAcceptedEvidenceGroup | undefined,
  expected: EvidenceExpansionAcceptedEvidenceGroup
): boolean {
  return (
    actual !== undefined &&
    createReplayResearchHash(actual) ===
      createReplayResearchHash(expected)
  );
}
