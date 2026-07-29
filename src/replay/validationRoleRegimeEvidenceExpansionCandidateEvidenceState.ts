import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import type {
  EvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import {
  buildEvidenceExpansionCandidatePartitionSummary,
  type EvidenceExpansionCandidatePartitionSummary
} from "./validationRoleRegimeEvidenceExpansionCandidatePartitionSummary.js";
import {
  buildEvidenceExpansionCrossRoleSharedExclusionState
} from "./validationRoleRegimeEvidenceExpansionCrossRoleSharedExclusionState.js";
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

export interface EvidenceExpansionCandidateEvidenceState {
  partitionSummary: EvidenceExpansionCandidatePartitionSummary;
  capacityState: EvidenceExpansionCrossSourceCapacityState;
  exclusions: EvidenceExpansionExclusion[];
}

export function buildEvidenceExpansionCandidateEvidenceState(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): EvidenceExpansionCandidateEvidenceState {
  assertExactInputKeys(input);
  const partitionSummary =
    buildEvidenceExpansionCandidatePartitionSummary({
      aggregation: input.aggregation,
      partition: input.partition,
      windowMonths: input.expansionWindowPolicy.windowMonths,
      timezoneOffsetMinutes:
        input.expansionWindowPolicy.timezoneOffsetMinutes
    });
  const crossSourceState =
    buildEvidenceExpansionCrossRoleSharedExclusionState({
      baseline: input.baseline,
      expansion: input.partition.consolidation,
      baselineWindowPolicy: input.baselineWindowPolicy,
      expansionWindowPolicy: input.expansionWindowPolicy
    });
  const exclusions = evidenceExpansionExclusionSchema
    .array()
    .parse([
      ...input.partition.exclusions,
      ...crossSourceState.exclusions
    ])
    .sort(compareEvidenceExpansionPreflightExclusions);
  assertDistinctExclusions(exclusions);

  return {
    partitionSummary,
    capacityState: crossSourceState.capacityState,
    exclusions
  };
}

function assertDistinctExclusions(
  exclusions: readonly EvidenceExpansionExclusion[]
): void {
  for (let index = 1; index < exclusions.length; index += 1) {
    if (
      compareEvidenceExpansionPreflightExclusions(
        exclusions[index - 1]!,
        exclusions[index]!
      ) === 0
    ) {
      throw new Error(
        "candidate evidence state exclusions contain duplicate identities"
      );
    }
  }
}

function assertExactInputKeys(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "aggregation",
    "baseline",
    "baselineWindowPolicy",
    "expansionWindowPolicy",
    "partition"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "candidate evidence state input contains unknown fields"
    );
  }
}
