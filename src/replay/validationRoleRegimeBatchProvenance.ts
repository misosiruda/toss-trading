import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import { feasibilityTargetRegimeSchema } from "./validationSplitRegimeFeasibility.js";
import {
  validationSplitAssignmentSchema,
  validationSplitRoleSchema
} from "./validationProtocol.js";
import {
  parseValidationRoleRegimeReplayPlan,
  validationRoleRegimeReplayPlanWarningSchema
} from "./validationRoleRegimeReplayPlan.js";

export const VALIDATION_ROLE_REGIME_PLAN_SAMPLING_MODE =
  "validation_role_regime_plan";

const crossRoleSharedEvidenceWarningSchema =
  validationRoleRegimeReplayPlanWarningSchema.refine(
    (warning) => warning.code === "CROSS_ROLE_EVIDENCE_SHARED",
    "batch provenance only accepts cross-role shared evidence warnings"
  );

export const validationRoleRegimeBatchManifestProvenanceSchema = z
  .object({
    samplingMode: z.literal(VALIDATION_ROLE_REGIME_PLAN_SAMPLING_MODE),
    planHash: sha256HashSchema,
    plannedRunCount: z.number().int().positive(),
    globalUniqueEvidenceGroupCount: z.number().int().positive(),
    crossRoleSharedEvidenceGroupCount: z.number().int().nonnegative(),
    crossRoleSharedEvidenceWarnings: z.array(
      crossRoleSharedEvidenceWarningSchema
    )
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.crossRoleSharedEvidenceGroupCount >
      value.globalUniqueEvidenceGroupCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "cross-role shared evidence count must not exceed global unique evidence count"
      });
    }
    if (
      value.crossRoleSharedEvidenceWarnings.length !==
      value.crossRoleSharedEvidenceGroupCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "cross-role shared evidence warning count must match the manifest summary"
      });
    }
  });

export const validationRoleRegimeBatchRunProvenanceSchema = z
  .object({
    samplingMode: z.literal(VALIDATION_ROLE_REGIME_PLAN_SAMPLING_MODE),
    planHash: sha256HashSchema,
    planIndex: z.number().int().nonnegative(),
    runKey: z
      .string()
      .trim()
      .min(1)
      .regex(/^[a-z0-9_-]+$/, "runKey must be output-path safe"),
    splitRole: validationSplitRoleSchema,
    targetRegime: feasibilityTargetRegimeSchema,
    candidateOrdinalWithinRoleRegime: z.number().int().nonnegative(),
    candidateHash: sha256HashSchema,
    evidenceGroupHash: sha256HashSchema,
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    sourceAssignments: z.array(validationSplitAssignmentSchema).min(1),
    executionAssignment: validationSplitAssignmentSchema,
    sharedAcrossRoles: z.boolean(),
    sharedRoles: z.array(validationSplitRoleSchema).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) > Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        message: "batch provenance startAt must be before or equal to endAt"
      });
    }
    if (value.evidenceGroupHash !== value.candidateHash) {
      context.addIssue({
        code: "custom",
        message: "batch provenance evidenceGroupHash must match candidateHash"
      });
    }
  });

export type ValidationRoleRegimeBatchManifestProvenance = z.infer<
  typeof validationRoleRegimeBatchManifestProvenanceSchema
>;
export type ValidationRoleRegimeBatchRunProvenance = z.infer<
  typeof validationRoleRegimeBatchRunProvenanceSchema
>;

export interface ValidationRoleRegimeBatchProvenance {
  manifest: ValidationRoleRegimeBatchManifestProvenance;
  runs: ValidationRoleRegimeBatchRunProvenance[];
}

export function buildValidationRoleRegimeBatchProvenance(
  value: unknown
): ValidationRoleRegimeBatchProvenance {
  const plan = parseValidationRoleRegimeReplayPlan(value);
  if (plan.status !== "ready_for_paper_diagnostic") {
    throw new Error(
      "validation role-regime batch provenance requires a ready plan"
    );
  }

  const crossRoleSharedEvidenceWarnings = plan.warnings.filter(
    (warning) => warning.code === "CROSS_ROLE_EVIDENCE_SHARED"
  );
  const manifest = validationRoleRegimeBatchManifestProvenanceSchema.parse({
    samplingMode: VALIDATION_ROLE_REGIME_PLAN_SAMPLING_MODE,
    planHash: plan.planHash,
    plannedRunCount: plan.summary.plannedRunCount,
    globalUniqueEvidenceGroupCount:
      plan.summary.globalUniqueEvidenceGroupCount,
    crossRoleSharedEvidenceGroupCount:
      plan.summary.crossRoleSharedEvidenceGroupCount,
    crossRoleSharedEvidenceWarnings
  });
  const runs = plan.runs.map((run) =>
    validationRoleRegimeBatchRunProvenanceSchema.parse({
      samplingMode: VALIDATION_ROLE_REGIME_PLAN_SAMPLING_MODE,
      planHash: plan.planHash,
      ...run
    })
  );

  if (runs.length !== manifest.plannedRunCount) {
    throw new Error(
      "batch provenance run count must match the planned run count"
    );
  }

  return { manifest, runs };
}
