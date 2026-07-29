import {
  buildEvidenceExpansionCapacitySummary
} from "./validationRoleRegimeEvidenceExpansionCapacitySummary.js";
import {
  classifyEvidenceExpansionCrossSourceGroups,
  type EvidenceExpansionCrossSourceGroupClassification,
  type EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import {
  buildEvidenceExpansionCrossSourceGroupUnion,
  type EvidenceExpansionCrossSourceGroupUnion
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupUnion.js";
import type {
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  EvidenceExpansionCapacitySummary
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionCrossSourceCapacityState {
  classification: EvidenceExpansionCrossSourceGroupClassification;
  union: EvidenceExpansionCrossSourceGroupUnion;
  capacity: EvidenceExpansionCapacitySummary;
}

export function buildEvidenceExpansionCrossSourceCapacityState(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): EvidenceExpansionCrossSourceCapacityState {
  assertExactInputKeys(input);
  const classification = classifyEvidenceExpansionCrossSourceGroups({
    baseline: input.baseline,
    expansion: input.expansion,
    baselineWindowPolicy: input.baselineWindowPolicy,
    expansionWindowPolicy: input.expansionWindowPolicy
  });
  const union = buildEvidenceExpansionCrossSourceGroupUnion({
    baseline: input.baseline,
    expansion: input.expansion,
    classification,
    baselineWindowPolicy: input.baselineWindowPolicy,
    expansionWindowPolicy: input.expansionWindowPolicy
  });
  const capacity = buildEvidenceExpansionCapacitySummary({
    baseline: input.baseline,
    expansion: input.expansion,
    union
  });

  return {
    classification,
    union,
    capacity
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
      "cross-source capacity state input contains unknown fields"
    );
  }
}
