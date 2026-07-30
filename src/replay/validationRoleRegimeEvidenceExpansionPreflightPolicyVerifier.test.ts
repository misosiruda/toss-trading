import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";
import {
  EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION,
  EVIDENCE_EXPANSION_ROLE_REGIME_SAMPLE_MINIMUM,
  verifyEvidenceExpansionPreflightDeclaredPolicy
} from "./validationRoleRegimeEvidenceExpansionPreflightPolicyVerifier.js";

test("preflight policy verifier accepts a canonical nullable target", () => {
  const targetMatrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: null
  });

  const verified = verifyEvidenceExpansionPreflightDeclaredPolicy({
    targetMatrix,
    dependencyDiagnosticPolicy: {
      version: EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION
    }
  });

  assert.deepEqual(verified.targetMatrix, targetMatrix);
  assert.equal(verified.roleRegimeSampleMinimum, null);
  assert.equal(
    verified.dependencyDiagnosticPolicyVersion,
    "overlap_adjacency_inputs.v1"
  );
});

test("preflight policy verifier accepts the preregistered role-regime minimum", () => {
  const targetMatrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum:
      EVIDENCE_EXPANSION_ROLE_REGIME_SAMPLE_MINIMUM
  });

  const verified = verifyEvidenceExpansionPreflightDeclaredPolicy({
    targetMatrix,
    dependencyDiagnosticPolicy: {
      version: EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION
    }
  });

  assert.equal(
    verified.roleRegimeSampleMinimum,
    EVIDENCE_EXPANSION_ROLE_REGIME_SAMPLE_MINIMUM
  );
});

test("preflight policy verifier rejects a different positive role-regime minimum", () => {
  const targetMatrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: 7
  });

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightDeclaredPolicy({
        targetMatrix,
        dependencyDiagnosticPolicy: {
          version:
            EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION
        }
      }),
    /role-regime minimum must be null or 8/
  );
});

test("preflight policy verifier rejects mixed role-regime targets", () => {
  const targetMatrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: 8
  });
  targetMatrix.byRole.validation.byRegime.bear = 9;

  assert.throws(
    () =>
      verifyEvidenceExpansionPreflightDeclaredPolicy({
        targetMatrix,
        dependencyDiagnosticPolicy: {
          version:
            EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION
        }
      }),
    /target matrix must use one canonical role-regime minimum/
  );
});

test("preflight policy verifier rejects unknown policy input", () => {
  const targetMatrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: 30,
    roleRegimeSampleMinimum: null
  });

  assert.throws(() =>
    verifyEvidenceExpansionPreflightDeclaredPolicy({
      targetMatrix,
      dependencyDiagnosticPolicy: {
        version: "estimated_effective_sample_size.v1"
      }
    })
  );
  assert.throws(() =>
    verifyEvidenceExpansionPreflightDeclaredPolicy({
      targetMatrix,
      dependencyDiagnosticPolicy: {
        version:
          EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION
      },
      generatedAt: "2026-07-29T00:00:00.000Z"
    })
  );
});
