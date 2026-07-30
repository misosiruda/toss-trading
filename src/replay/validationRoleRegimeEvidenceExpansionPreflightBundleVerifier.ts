import {
  validateValidationRoleRegimeEvidenceExpansionInputBoundary,
  type ValidationRoleRegimeEvidenceExpansionInput
} from "./validationRoleRegimeEvidenceExpansionInputBoundary.js";
import {
  verifyValidationRoleRegimeEvidenceExpansionBaseline,
  type VerifiedValidationRoleRegimeEvidenceExpansionBaseline
} from "./validationRoleRegimeEvidenceExpansionBaselineVerifier.js";
import {
  assertEvidenceExpansionBaselineSourceMatches
} from "./validationRoleRegimeEvidenceExpansionBaselineSourceMatch.js";
import {
  verifyEvidenceExpansionPreflightDeclaredPolicy,
  type VerifiedEvidenceExpansionPreflightDeclaredPolicy
} from "./validationRoleRegimeEvidenceExpansionPreflightPolicyVerifier.js";
import {
  verifyEvidenceExpansionSourcePair,
  type VerifiedEvidenceExpansionSourcePair
} from "./validationRoleRegimeEvidenceExpansionSourcePairVerifier.js";

export interface EvidenceExpansionPreflightBundleVerificationState {
  acceptedInput: ValidationRoleRegimeEvidenceExpansionInput;
  verifiedBaseline: VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  verifiedSourcePair: VerifiedEvidenceExpansionSourcePair;
  verifiedDeclaredPolicy: VerifiedEvidenceExpansionPreflightDeclaredPolicy;
}

export function verifyEvidenceExpansionPreflightBundle(
  input: unknown
): EvidenceExpansionPreflightBundleVerificationState {
  const boundary =
    validateValidationRoleRegimeEvidenceExpansionInputBoundary(input);
  if (boundary.status === "invalid") {
    throw new Error(
      `evidence expansion preflight input rejected: ${boundary.forbiddenPaths.join(", ")}`
    );
  }
  const accepted = boundary.input;
  const sourcePair = verifyEvidenceExpansionSourcePair({
    baseline: {
      snapshots: accepted.baseline.snapshots,
      universe: accepted.baseline.universe,
      coverage: accepted.baseline.coverage,
      validationSplitSource:
        accepted.baseline.validationSplitSource
    },
    expansion: {
      snapshots: accepted.expansion.snapshots,
      universe: accepted.expansion.universe,
      coverage: accepted.expansion.coverage,
      validationSplitSource:
        accepted.expansion.validationSplitSource
    }
  });
  const verifiedBaseline =
    verifyValidationRoleRegimeEvidenceExpansionBaseline({
      feasibilityArtifact:
        accepted.baseline.feasibilityArtifact,
      planArtifact: accepted.baseline.planArtifact,
      readinessArtifact: accepted.baseline.readinessArtifact,
      validationSplitSource:
        accepted.baseline.validationSplitSource
    });
  assertEvidenceExpansionBaselineSourceMatches({
    baselineProvenance: verifiedBaseline.plan.source,
    verifiedSourceProvenance:
      sourcePair.baseline.baselineProvenanceHashes
  });
  const declaredPolicy =
    verifyEvidenceExpansionPreflightDeclaredPolicy({
      targetMatrix: accepted.targetMatrix,
      dependencyDiagnosticPolicy:
        accepted.dependencyDiagnosticPolicy
    });

  return {
    acceptedInput: accepted,
    verifiedBaseline,
    verifiedSourcePair: sourcePair,
    verifiedDeclaredPolicy: declaredPolicy
  };
}
