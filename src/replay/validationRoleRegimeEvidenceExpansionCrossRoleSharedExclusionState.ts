import {
  buildEvidenceExpansionBaselineOverlapExclusionState
} from "./validationRoleRegimeEvidenceExpansionBaselineOverlapExclusionState.js";
import type {
  EvidenceExpansionCrossSourceCapacityState
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

export interface EvidenceExpansionCrossRoleSharedExclusionState {
  capacityState: EvidenceExpansionCrossSourceCapacityState;
  exclusions: EvidenceExpansionExclusion[];
}

export function buildEvidenceExpansionCrossRoleSharedExclusionState(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): EvidenceExpansionCrossRoleSharedExclusionState {
  assertExactInputKeys(input);
  const overlapState =
    buildEvidenceExpansionBaselineOverlapExclusionState(input);
  const crossRoleExclusions =
    overlapState.capacityState.union.combinedEvidenceGroups
      .filter((group) => group.splitRoles.length > 1)
      .map((group) => ({
        sourceVariants: group.sourceVariants.map(
          (variant) => variant.sourceVariant
        ),
        evidenceGroupHash: group.evidenceGroupHash,
        splitRole: null,
        targetRegime: group.targetRegime,
        reason: "CROSS_ROLE_SHARED_EVIDENCE" as const,
        message:
          "evidence group is shared across validation roles"
      }));
  const exclusions = evidenceExpansionExclusionSchema
    .array()
    .parse([
      ...overlapState.exclusions,
      ...crossRoleExclusions
    ])
    .sort(compareEvidenceExpansionPreflightExclusions);

  return {
    capacityState: overlapState.capacityState,
    exclusions
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
      "cross-role shared exclusion state input contains unknown fields"
    );
  }
}
