import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import { verifyEvidenceExpansionPreflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifier.js";
import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";
import type { VerifyValidationRoleRegimeEvidenceExpansionSourceOptions } from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  createEvidenceExpansionSourceVerifierTestAssignments,
  createEvidenceExpansionSourceVerifierTestFixture
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

test("preflight bundle verifier composes boundary, source pair, and policy", () => {
  const input = preflightBundle();

  const verified = verifyEvidenceExpansionPreflightBundle(input);

  assert.equal(
    verified.verifiedDeclaredPolicy.roleRegimeSampleMinimum,
    null
  );
  assert.deepEqual(
    verified.verifiedSourcePair.expansion.baselineProvenanceHashes,
    verified.verifiedSourcePair.baseline.baselineProvenanceHashes
  );
  assert.equal(
    verified.verifiedSourcePair.expansion.hashes.validationSplitHash,
    verified.verifiedSourcePair.baseline.hashes.validationSplitHash
  );
  assert.equal(
    verified.acceptedInput.baseline.feasibilityArtifact,
    input.baseline.feasibilityArtifact
  );
});

test("preflight bundle verifier rejects result input before source verification", () => {
  const input = {
    ...preflightBundle(),
    historicalReplayReport: {
      status: "completed"
    }
  };

  assert.throws(
    () => verifyEvidenceExpansionPreflightBundle(input),
    /preflight input rejected: \$\.historicalReplayReport/
  );
});

test("preflight bundle verifier rejects source-pair split drift", () => {
  const input = preflightBundle();
  input.expansion = {
    ...input.expansion,
    validationSplitSource: {
      sourceVersion: "expanded-split-source",
      assignments:
        createEvidenceExpansionSourceVerifierTestAssignments()
    }
  };

  assert.throws(
    () => verifyEvidenceExpansionPreflightBundle(input),
    /baseline and expansion validation split sources must match/
  );
});

test("preflight bundle verifier rejects a non-canonical declared target", () => {
  const input = preflightBundle();
  input.targetMatrix.byRole.validation.byRegime.bear = 9;

  assert.throws(
    () => verifyEvidenceExpansionPreflightBundle(input),
    /target matrix must use one canonical role-regime minimum/
  );
});

interface PreflightBundleFixture {
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

function preflightBundle(): PreflightBundleFixture {
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
