import assert from "node:assert/strict";
import test from "node:test";

import { verifyEvidenceExpansionPreflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifier.js";
import { createEvidenceExpansionPreflightBundleTestFixture as preflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifierTestFixture.js";
import {
  createEvidenceExpansionSourceVerifierTestAssignments
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

test("preflight bundle verifier composes boundary, source pair, baseline, and policy", () => {
  const input = preflightBundle();

  const verified = verifyEvidenceExpansionPreflightBundle(input);

  assert.equal(
    verified.verifiedDeclaredPolicy.roleRegimeSampleMinimum,
    null
  );
  assert.equal(
    verified.verifiedBaseline.plan.status,
    "ready_for_paper_diagnostic"
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

test("preflight bundle verifier rejects baseline raw source provenance drift", () => {
  const input = preflightBundle();
  input.baseline.universe = {
    ...(input.baseline.universe as Record<string, unknown>),
    disclaimer: "Changed after baseline artifact generation."
  };

  assert.throws(
    () => verifyEvidenceExpansionPreflightBundle(input),
    /baseline raw source hash mismatch: universeHash/
  );
});
