import {
  verifyValidationRoleRegimeEvidenceExpansionSource,
  type VerifiedValidationRoleRegimeEvidenceExpansionSource,
  type VerifyValidationRoleRegimeEvidenceExpansionSourceOptions
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  assertCompatibleEvidenceExpansionValidationSplits
} from "./validationRoleRegimeEvidenceExpansionSplitCompatibility.js";

export interface VerifyEvidenceExpansionSourcePairOptions {
  baseline: VerifyValidationRoleRegimeEvidenceExpansionSourceOptions;
  expansion: VerifyValidationRoleRegimeEvidenceExpansionSourceOptions;
}

export interface VerifiedEvidenceExpansionSourcePair {
  baseline: VerifiedValidationRoleRegimeEvidenceExpansionSource;
  expansion: VerifiedValidationRoleRegimeEvidenceExpansionSource;
}

export function verifyEvidenceExpansionSourcePair(
  input: VerifyEvidenceExpansionSourcePairOptions
): VerifiedEvidenceExpansionSourcePair {
  assertExactKeys(input, ["baseline", "expansion"], "source pair");
  assertExactKeys(
    input.baseline,
    ["coverage", "snapshots", "universe", "validationSplitSource"],
    "baseline source"
  );
  assertExactKeys(
    input.expansion,
    ["coverage", "snapshots", "universe", "validationSplitSource"],
    "expansion source"
  );
  const baseline =
    verifyValidationRoleRegimeEvidenceExpansionSource(input.baseline);
  const verifiedExpansion =
    verifyValidationRoleRegimeEvidenceExpansionSource(input.expansion);
  assertCompatibleEvidenceExpansionValidationSplits({
    baselineAssignments: baseline.assignments,
    expansionAssignments: verifiedExpansion.assignments
  });

  return {
    baseline,
    expansion: {
      ...verifiedExpansion,
      baselineProvenanceHashes:
        baseline.baselineProvenanceHashes
    }
  };
}

function assertExactKeys(
  input: object,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(input).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} contains unknown fields`);
  }
}
