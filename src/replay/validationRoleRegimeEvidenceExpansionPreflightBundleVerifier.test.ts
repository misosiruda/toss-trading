import assert from "node:assert/strict";
import test from "node:test";

import { verifyEvidenceExpansionPreflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifier.js";
import { createEvidenceExpansionPreflightBundleTestFixture as preflightBundle } from "./validationRoleRegimeEvidenceExpansionPreflightBundleVerifierTestFixture.js";
import {
  createEvidenceExpansionSourceVerifierTestAssignments
} from "./validationRoleRegimeEvidenceExpansionSourceVerifierTestFixture.js";

const verificationOptions = {
  asOf: "2026-07-23T00:00:00.000Z"
} as const;

test("preflight bundle verifier composes source, baseline, calendar, and policy verification", () => {
  const input = preflightBundle();

  const verified = verifyEvidenceExpansionPreflightBundle(
    input,
    verificationOptions
  );

  assert.equal(
    verified.verifiedDeclaredPolicy.roleRegimeSampleMinimum,
    null
  );
  assert.equal(
    verified.verifiedBaseline.plan.status,
    "ready_for_paper_diagnostic"
  );
  assert.equal(
    verified.verifiedCalendarClassifier.hashes.calendarHash,
    verified.verifiedBaseline.plan.source.calendarHash
  );
  assert.equal(
    verified.verifiedCalendarClassifier.hashes
      .marketRegimeClassifierHash,
    verified.verifiedBaseline.plan.source.marketRegimeClassifierHash
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
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
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
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /baseline and expansion validation split sources must match/
  );
});

test("preflight bundle verifier rejects a non-canonical declared target", () => {
  const input = preflightBundle();
  input.targetMatrix.byRole.validation.byRegime.bear = 9;

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
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
    () =>
      verifyEvidenceExpansionPreflightBundle(
        input,
        verificationOptions
      ),
    /baseline raw source hash mismatch: universeHash/
  );
});

test("preflight bundle verifier rejects calendar and classifier provenance drift", () => {
  const calendarDrift = preflightBundle();
  (
    calendarDrift.calendarValidation as {
      fixtures: Array<{ sourceRefs: string[] }>;
    }
  ).fixtures[0]!.sourceRefs.push("fixture:calendar-drift");

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        calendarDrift,
        verificationOptions
      ),
    /calendar hash does not match baseline/
  );

  const classifierDrift = preflightBundle();
  (
    classifierDrift.marketRegimeClassifier as {
      bullReturnThreshold: number;
    }
  ).bullReturnThreshold = 0.04;

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightBundle(
        classifierDrift,
        verificationOptions
      ),
    /classifier hash does not match baseline/
  );
});
