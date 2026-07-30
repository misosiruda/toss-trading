import type { EvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";
import type { VerifyValidationRoleRegimeEvidenceExpansionSourceOptions } from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import { createEvidenceExpansionSourceVerifierTestFixture } from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

export interface EvidenceExpansionPreflightBundleTestFixture {
  baseline: VerifyValidationRoleRegimeEvidenceExpansionSourceOptions & {
    feasibilityArtifact: object;
    planArtifact: object;
    readinessArtifact: object;
  };
  expansion: VerifyValidationRoleRegimeEvidenceExpansionSourceOptions;
  calendarValidation: object;
  marketRegimeClassifier: object;
  targetMatrix: EvidenceExpansionTargetMatrix;
  dependencyDiagnosticPolicy: {
    version: "overlap_adjacency_inputs.v1";
  };
}

export function createEvidenceExpansionPreflightBundleTestFixture(): EvidenceExpansionPreflightBundleTestFixture {
  return {
    baseline: {
      feasibilityArtifact: { fixture: "baseline-feasibility" },
      planArtifact: { fixture: "baseline-plan" },
      readinessArtifact: { fixture: "baseline-readiness" },
      ...sourceOptions()
    },
    expansion: sourceOptions(),
    calendarValidation: { fixture: "calendar-validation" },
    marketRegimeClassifier: {
      fixture: "market-regime-classifier"
    },
    targetMatrix: buildEvidenceExpansionTargetMatrix({
      roleSampleMinimum: 30,
      roleRegimeSampleMinimum: null
    }),
    dependencyDiagnosticPolicy: {
      version: "overlap_adjacency_inputs.v1"
    }
  };
}

function sourceOptions(): VerifyValidationRoleRegimeEvidenceExpansionSourceOptions {
  const {
    assignments: _assignments,
    ...source
  } = createEvidenceExpansionSourceVerifierTestFixture();
  return source;
}
