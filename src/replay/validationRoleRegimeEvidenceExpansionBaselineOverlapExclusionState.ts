import {
  buildEvidenceExpansionCrossSourceCapacityState,
  type EvidenceExpansionCrossSourceCapacityState
} from "./validationRoleRegimeEvidenceExpansionCrossSourceCapacityState.js";
import type {
  EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import type {
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  evidenceExpansionExclusionSchema,
  type EvidenceExpansionExclusion
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  compareEvidenceExpansionPreflightExclusions
} from "./validationRoleRegimeEvidenceExpansionPreflightExclusionOrder.js";

export interface EvidenceExpansionBaselineOverlapExclusionState {
  capacityState: EvidenceExpansionCrossSourceCapacityState;
  exclusions: EvidenceExpansionExclusion[];
}

export function buildEvidenceExpansionBaselineOverlapExclusionState(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): EvidenceExpansionBaselineOverlapExclusionState {
  assertExactInputKeys(input);
  const capacityState =
    buildEvidenceExpansionCrossSourceCapacityState(input);
  const expansionByHash = new Map(
    input.expansion.evidenceGroups.map((group) => [
      group.evidenceGroupHash,
      group
    ])
  );
  const exclusions =
    capacityState.classification.overlapEvidenceGroupHashes.map(
      (evidenceGroupHash) => {
        const group = expansionByHash.get(evidenceGroupHash);
        if (group === undefined) {
          throw new Error(
            "baseline overlap exclusion is missing expansion evidence"
          );
        }
        return {
          sourceVariants: group.sourceVariants.map(
            (variant) => variant.sourceVariant
          ),
          evidenceGroupHash,
          splitRole:
            group.splitRoles.length === 1
              ? group.splitRoles[0]!
              : null,
          targetRegime: group.targetRegime,
          reason: "DUPLICATE_BASELINE_EVIDENCE" as const,
          message:
            "expansion evidence group duplicates baseline evidence"
        };
      }
    );
  const parsedExclusions = evidenceExpansionExclusionSchema
    .array()
    .parse(exclusions)
    .sort(compareEvidenceExpansionPreflightExclusions);

  return {
    capacityState,
    exclusions: parsedExclusions
  };
}

function assertExactInputKeys(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "baseline",
    "baselineWindowPolicy",
    "expansion",
    "expansionWindowPolicy"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "baseline overlap exclusion state input contains unknown fields"
    );
  }
}
