import { z } from "zod";

import {
  EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM,
  evidenceExpansionTargetMatrixSchema,
  type EvidenceExpansionTargetMatrix
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

const targetMatrixInputSchema = z
  .object({
    roleSampleMinimum: z.literal(
      EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM
    ),
    roleRegimeSampleMinimum: z.number().int().positive().nullable()
  })
  .strict();

export function buildEvidenceExpansionTargetMatrix(
  input: unknown
): EvidenceExpansionTargetMatrix {
  const parsed = targetMatrixInputSchema.parse(input);
  const roleTarget = () => ({
    roleLocalUniqueMinimum: parsed.roleSampleMinimum,
    roleExclusiveMinimum: parsed.roleSampleMinimum,
    byRegime: {
      bull: parsed.roleRegimeSampleMinimum,
      bear: parsed.roleRegimeSampleMinimum,
      sideways: parsed.roleRegimeSampleMinimum,
      mixed: parsed.roleRegimeSampleMinimum
    }
  });

  return evidenceExpansionTargetMatrixSchema.parse({
    byRole: {
      train: roleTarget(),
      validation: roleTarget(),
      test: roleTarget()
    }
  });
}
