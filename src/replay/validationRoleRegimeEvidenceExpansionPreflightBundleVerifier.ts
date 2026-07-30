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
  verifyEvidenceExpansionCalendarClassifier,
  type VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionPreflightArtifactState
} from "./validationRoleRegimeEvidenceExpansionPreflightArtifactBuilder.js";
import type {
  EvidenceExpansionPreflightCoreState
} from "./validationRoleRegimeEvidenceExpansionPreflightCoreState.js";
import {
  verifyEvidenceExpansionPreflightDeclaredPolicy,
  type VerifiedEvidenceExpansionPreflightDeclaredPolicy
} from "./validationRoleRegimeEvidenceExpansionPreflightPolicyVerifier.js";
import {
  verifyEvidenceExpansionSourcePair,
  type VerifiedEvidenceExpansionSourcePair
} from "./validationRoleRegimeEvidenceExpansionSourcePairVerifier.js";
import type {
  EvidenceExpansionPreflightStatus,
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionPreflightBundleVerificationState {
  acceptedInput: ValidationRoleRegimeEvidenceExpansionInput;
  artifact: ValidationRoleRegimeEvidenceExpansionPreflightArtifact;
  coreState: EvidenceExpansionPreflightCoreState;
  status: EvidenceExpansionPreflightStatus;
  verifiedBaseline: VerifiedValidationRoleRegimeEvidenceExpansionBaseline;
  verifiedCalendarClassifier: VerifiedEvidenceExpansionCalendarClassifier;
  verifiedSourcePair: VerifiedEvidenceExpansionSourcePair;
  verifiedDeclaredPolicy: VerifiedEvidenceExpansionPreflightDeclaredPolicy;
}

export interface VerifyEvidenceExpansionPreflightBundleOptions {
  generatedAt: string;
}

export function verifyEvidenceExpansionPreflightBundle(
  input: unknown,
  options: VerifyEvidenceExpansionPreflightBundleOptions
): EvidenceExpansionPreflightBundleVerificationState {
  assertExactVerificationOptions(options);
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
  const verifiedCalendarClassifier =
    verifyEvidenceExpansionCalendarClassifier({
      calendarValidation: accepted.calendarValidation,
      marketRegimeClassifier: accepted.marketRegimeClassifier,
      officialCalendarArtifact:
        accepted.officialCalendarArtifact,
      asOf: options.generatedAt,
      baselineCalendarHash:
        verifiedBaseline.plan.source.calendarHash,
      baselineMarketRegimeClassifierHash:
        verifiedBaseline.plan.source.marketRegimeClassifierHash
    });
  const declaredPolicy =
    verifyEvidenceExpansionPreflightDeclaredPolicy({
      targetMatrix: accepted.targetMatrix,
      dependencyDiagnosticPolicy:
        accepted.dependencyDiagnosticPolicy
    });
  const { artifact, coreState, status } =
    buildEvidenceExpansionPreflightArtifactState({
      baselineIdentity: verifiedBaseline,
      baselineSource: sourcePair.baseline,
      expansion: sourcePair.expansion,
      calendarClassifier: verifiedCalendarClassifier,
      roleRegimeSampleMinimum:
        declaredPolicy.roleRegimeSampleMinimum,
      generatedAt: options.generatedAt
    });

  return {
    acceptedInput: accepted,
    artifact,
    coreState,
    status,
    verifiedBaseline,
    verifiedCalendarClassifier,
    verifiedSourcePair: sourcePair,
    verifiedDeclaredPolicy: declaredPolicy
  };
}

function assertExactVerificationOptions(
  options: VerifyEvidenceExpansionPreflightBundleOptions
): void {
  const actual = Object.keys(options).sort();
  const expected = ["generatedAt"];
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "preflight bundle verification options contain unknown fields"
    );
  }
}
