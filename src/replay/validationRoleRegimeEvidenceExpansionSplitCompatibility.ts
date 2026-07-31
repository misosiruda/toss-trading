import {
  validationSplitAssignmentSchema,
  type ValidationSplitAssignment
} from "./validationProtocol.js";
import {
  assertValidValidationSplitAssignments
} from "./validationSplitRegimeFeasibility.js";

export interface EvidenceExpansionSplitCompatibilityInput {
  baselineAssignments: readonly ValidationSplitAssignment[];
  expansionAssignments: readonly ValidationSplitAssignment[];
}

interface ValidationSplitPolicy {
  validationProtocol: ValidationSplitAssignment["validationProtocol"];
  purgeDurationDays: number;
  embargoDurationDays: number;
}

export function assertCompatibleEvidenceExpansionValidationSplits(
  input: EvidenceExpansionSplitCompatibilityInput
): void {
  assertExactInputKeys(input);
  const baselineAssignments = validateAssignments(
    input.baselineAssignments
  );
  const expansionAssignments = validateAssignments(
    input.expansionAssignments
  );
  const baselinePolicy = deriveUniformPolicy(
    baselineAssignments,
    "baseline"
  );
  const expansionPolicy = deriveUniformPolicy(
    expansionAssignments,
    "expansion"
  );
  assertSamePolicy(baselinePolicy, expansionPolicy);
  assertNoConflictingSplitIdentities(
    baselineAssignments,
    expansionAssignments
  );
}

function validateAssignments(
  assignments: readonly ValidationSplitAssignment[]
): ValidationSplitAssignment[] {
  const parsed = assignments.map((assignment) =>
    validationSplitAssignmentSchema.parse(assignment)
  );
  assertValidValidationSplitAssignments(parsed);
  return parsed;
}

function deriveUniformPolicy(
  assignments: readonly ValidationSplitAssignment[],
  label: string
): ValidationSplitPolicy {
  const first = assignments[0];
  if (first === undefined) {
    throw new Error(
      `${label} validation split assignments must not be empty`
    );
  }
  const policy = splitPolicy(first);
  if (policy.validationProtocol !== "walk_forward") {
    throw new Error(
      `${label} validation split protocol must be walk_forward`
    );
  }
  for (const assignment of assignments.slice(1)) {
    if (!samePolicy(policy, splitPolicy(assignment))) {
      throw new Error(
        `${label} validation split assignments must use one compatibility policy`
      );
    }
  }
  return policy;
}

function assertSamePolicy(
  baseline: ValidationSplitPolicy,
  expansion: ValidationSplitPolicy
): void {
  if (baseline.validationProtocol !== expansion.validationProtocol) {
    throw new Error(
      "baseline and expansion validation split protocols must match"
    );
  }
  if (baseline.purgeDurationDays !== expansion.purgeDurationDays) {
    throw new Error(
      "baseline and expansion validation split purge policies must match"
    );
  }
  if (baseline.embargoDurationDays !== expansion.embargoDurationDays) {
    throw new Error(
      "baseline and expansion validation split embargo policies must match"
    );
  }
}

function assertNoConflictingSplitIdentities(
  baselineAssignments: readonly ValidationSplitAssignment[],
  expansionAssignments: readonly ValidationSplitAssignment[]
): void {
  const baselineDefinitions = new Map<
    string,
    ValidationSplitAssignment
  >();
  for (const assignment of baselineAssignments) {
    baselineDefinitions.set(splitIdentity(assignment), assignment);
  }
  for (const assignment of expansionAssignments) {
    const baseline = baselineDefinitions.get(splitIdentity(assignment));
    if (
      baseline !== undefined &&
      !sameSplitDefinition(baseline, assignment)
    ) {
      throw new Error(
        `validation split identity maps to conflicting boundaries: ${splitIdentity(assignment)}`
      );
    }
  }
}

function splitPolicy(
  assignment: ValidationSplitAssignment
): ValidationSplitPolicy {
  return {
    validationProtocol: assignment.validationProtocol,
    purgeDurationDays: assignment.purgeDurationDays,
    embargoDurationDays: assignment.embargoDurationDays
  };
}

function samePolicy(
  left: ValidationSplitPolicy,
  right: ValidationSplitPolicy
): boolean {
  return (
    left.validationProtocol === right.validationProtocol &&
    left.purgeDurationDays === right.purgeDurationDays &&
    left.embargoDurationDays === right.embargoDurationDays
  );
}

function splitIdentity(
  assignment: ValidationSplitAssignment
): string {
  return `${assignment.splitIndex}:${assignment.splitId}`;
}

function sameSplitDefinition(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): boolean {
  return (
    left.validationProtocol === right.validationProtocol &&
    left.trainStart === right.trainStart &&
    left.trainEnd === right.trainEnd &&
    left.validationStart === right.validationStart &&
    left.validationEnd === right.validationEnd &&
    left.testStart === right.testStart &&
    left.testEnd === right.testEnd &&
    left.purgeDurationDays === right.purgeDurationDays &&
    left.embargoDurationDays === right.embargoDurationDays
  );
}

function assertExactInputKeys(
  input: EvidenceExpansionSplitCompatibilityInput
): void {
  const actual = Object.keys(input).sort();
  const expected = ["baselineAssignments", "expansionAssignments"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "validation split compatibility input contains unknown fields"
    );
  }
}
