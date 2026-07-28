import {
  buildEvidenceExpansionCapacityTargetBlockers
} from "./validationRoleRegimeEvidenceExpansionCapacityTargetBlockers.js";
import type {
  EvidenceExpansionDependencyInputsInput
} from "./validationRoleRegimeEvidenceExpansionDependencyInputs.js";
import {
  evidenceExpansionPreflightBlockerSchema,
  type EvidenceExpansionCapacitySummary,
  type EvidenceExpansionDependencyInputs,
  type EvidenceExpansionPreflightBlocker,
  type EvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import {
  compareEvidenceExpansionPreflightBlockers
} from "./validationRoleRegimeEvidenceExpansionPreflightBlockerOrder.js";
import {
  buildEvidenceExpansionPreflightDependencyState
} from "./validationRoleRegimeEvidenceExpansionPreflightDependencyState.js";

export interface EvidenceExpansionPreflightDerivedStateInput {
  targetMatrix: EvidenceExpansionTargetMatrix;
  capacity: EvidenceExpansionCapacitySummary;
  dependency: EvidenceExpansionDependencyInputsInput;
}

export interface EvidenceExpansionPreflightDerivedState {
  dependencyInputs: EvidenceExpansionDependencyInputs;
  blockers: EvidenceExpansionPreflightBlocker[];
}

export function buildEvidenceExpansionPreflightDerivedState(
  input: EvidenceExpansionPreflightDerivedStateInput
): EvidenceExpansionPreflightDerivedState {
  assertExactInputKeys(input);
  const dependencyState =
    buildEvidenceExpansionPreflightDependencyState(input.dependency);
  const capacityBlockers = buildEvidenceExpansionCapacityTargetBlockers({
    targetMatrix: input.targetMatrix,
    capacity: input.capacity
  });
  const blockers = evidenceExpansionPreflightBlockerSchema.array().parse(
    [...dependencyState.blockers, ...capacityBlockers].sort(
      compareEvidenceExpansionPreflightBlockers
    )
  );
  assertUniqueBlockerKeys(blockers);

  return {
    dependencyInputs: dependencyState.dependencyInputs,
    blockers
  };
}

function assertUniqueBlockerKeys(
  blockers: readonly EvidenceExpansionPreflightBlocker[]
): void {
  const keys = new Set<string>();
  for (const blocker of blockers) {
    const key =
      `${blocker.code}:${blocker.splitRole ?? "*"}:` +
      `${blocker.targetRegime ?? "*"}`;
    if (keys.has(key)) {
      throw new Error("derived preflight blockers must be unique");
    }
    keys.add(key);
  }
}

function assertExactInputKeys(
  input: EvidenceExpansionPreflightDerivedStateInput
): void {
  const actual = Object.keys(input).sort();
  const expected = ["capacity", "dependency", "targetMatrix"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("preflight derived state input contains unknown fields");
  }
}
