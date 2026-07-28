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
  const expectedCombinedHashes = new Set([
    ...baselineByHash.keys(),
    ...expansionByHash.keys()
  ]);
  const expectedIncrementalHashes = new Set(
    [...expansionByHash.keys()].filter(
      (hash) => !baselineByHash.has(hash)
    )
  );
  const expectedOverlapCount = [...expansionByHash.keys()].filter(
    (hash) => baselineByHash.has(hash)
  ).length;
  if (
    input.union.baselineOverlapEvidenceGroupCount !==
    expectedOverlapCount
  ) {
    throw new Error(
      "capacity summary overlap count does not match source hash intersection"
    );
  }
  if (
    !sameSet(new Set(combinedByHash.keys()), expectedCombinedHashes) ||
    !sameSet(
      new Set(incrementalByHash.keys()),
      expectedIncrementalHashes
    )
  ) {
    throw new Error(
      "capacity summary union membership does not match source collections"
    );
  }

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

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}
