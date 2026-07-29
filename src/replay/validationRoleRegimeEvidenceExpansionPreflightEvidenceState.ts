import type {
  EvidenceExpansionAssignmentCandidateAggregation
} from "./validationRoleRegimeEvidenceExpansionAssignmentCandidateAggregation.js";
import {
  buildEvidenceExpansionCandidateEvidenceState,
  type EvidenceExpansionCandidateEvidenceState
} from "./validationRoleRegimeEvidenceExpansionCandidateEvidenceState.js";
import type {
  EvidenceExpansionCandidatePartition
} from "./validationRoleRegimeEvidenceExpansionCandidatePartition.js";
import type {
  EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import type {
  EvidenceExpansionDependencyInputsInput
} from "./validationRoleRegimeEvidenceExpansionDependencyInputs.js";
import type {
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  buildEvidenceExpansionPreflightDerivedState
} from "./validationRoleRegimeEvidenceExpansionPreflightDerivedState.js";
import type {
  EvidenceExpansionDependencyInputs,
  EvidenceExpansionPreflightBlocker,
  EvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionPreflightDependencySource {
  source: EvidenceExpansionDependencyInputsInput["source"];
  calendarClassifier:
    EvidenceExpansionDependencyInputsInput["calendarClassifier"];
}

export interface EvidenceExpansionPreflightEvidenceState {
  partitionSummary:
    EvidenceExpansionCandidateEvidenceState["partitionSummary"];
  capacity: EvidenceExpansionCandidateEvidenceState[
    "capacityState"
  ]["capacity"];
  dependencyInputs: EvidenceExpansionDependencyInputs;
  exclusions: EvidenceExpansionCandidateEvidenceState["exclusions"];
  blockers: EvidenceExpansionPreflightBlocker[];
}

export function buildEvidenceExpansionPreflightEvidenceState(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  targetMatrix: EvidenceExpansionTargetMatrix;
  dependencySource: EvidenceExpansionPreflightDependencySource;
}): EvidenceExpansionPreflightEvidenceState {
  assertExactInputKeys(input);
  assertExactDependencySourceKeys(input.dependencySource);
  const candidateState =
    buildEvidenceExpansionCandidateEvidenceState({
      aggregation: input.aggregation,
      partition: input.partition,
      baseline: input.baseline,
      baselineWindowPolicy: input.baselineWindowPolicy,
      expansionWindowPolicy: input.expansionWindowPolicy
    });
  const derivedState = buildEvidenceExpansionPreflightDerivedState({
    targetMatrix: input.targetMatrix,
    capacity: candidateState.capacityState.capacity,
    dependency: {
      groups:
        candidateState.capacityState.union.combinedEvidenceGroups,
      source: input.dependencySource.source,
      calendarClassifier:
        input.dependencySource.calendarClassifier
    }
  });

  return {
    partitionSummary: candidateState.partitionSummary,
    capacity: candidateState.capacityState.capacity,
    dependencyInputs: derivedState.dependencyInputs,
    exclusions: candidateState.exclusions,
    blockers: derivedState.blockers
  };
}

function assertExactDependencySourceKeys(
  input: EvidenceExpansionPreflightDependencySource
): void {
  const actual = Object.keys(input).sort();
  const expected = ["calendarClassifier", "source"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight evidence dependency source contains unknown fields"
    );
  }
}

function assertExactInputKeys(input: {
  aggregation: EvidenceExpansionAssignmentCandidateAggregation;
  partition: EvidenceExpansionCandidatePartition;
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  targetMatrix: EvidenceExpansionTargetMatrix;
  dependencySource: EvidenceExpansionPreflightDependencySource;
}): void {
  const actual = Object.keys(input).sort();
  const expected = [
    "aggregation",
    "baseline",
    "baselineWindowPolicy",
    "dependencySource",
    "expansionWindowPolicy",
    "partition",
    "targetMatrix"
  ];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight evidence state input contains unknown fields"
    );
  }
}
