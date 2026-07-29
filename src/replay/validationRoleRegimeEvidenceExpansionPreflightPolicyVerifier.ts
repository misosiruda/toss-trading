import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
  evidenceExpansionTargetMatrixSchema,
  type EvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import { buildEvidenceExpansionTargetMatrix } from "./validationRoleRegimeEvidenceExpansionTargetMatrix.js";

export const EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION =
  "overlap_adjacency_inputs.v1" as const;

const declaredPolicySchema = z
  .object({
    targetMatrix: evidenceExpansionTargetMatrixSchema,
    dependencyDiagnosticPolicy: z
      .object({
        version: z.literal(
          EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION
        )
      })
      .strict()
  })
  .strict();

export interface VerifiedEvidenceExpansionPreflightDeclaredPolicy {
  targetMatrix: EvidenceExpansionTargetMatrix;
  roleRegimeSampleMinimum: number | null;
  dependencyDiagnosticPolicyVersion:
    typeof EVIDENCE_EXPANSION_DEPENDENCY_DIAGNOSTIC_POLICY_VERSION;
}

export function verifyEvidenceExpansionPreflightDeclaredPolicy(
  input: unknown
): VerifiedEvidenceExpansionPreflightDeclaredPolicy {
  const parsed = declaredPolicySchema.parse(input);
  const roleRegimeSampleMinimum =
    parsed.targetMatrix.byRole.train.byRegime.bull;
  const canonicalTargetMatrix = buildEvidenceExpansionTargetMatrix({
    roleSampleMinimum: EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
    roleRegimeSampleMinimum
  });
  if (!isDeepStrictEqual(parsed.targetMatrix, canonicalTargetMatrix)) {
    throw new Error(
      "evidence expansion target matrix must use one canonical role-regime minimum"
    );
  }

  return {
    targetMatrix: canonicalTargetMatrix,
    roleRegimeSampleMinimum,
    dependencyDiagnosticPolicyVersion:
      parsed.dependencyDiagnosticPolicy.version
  };
}
