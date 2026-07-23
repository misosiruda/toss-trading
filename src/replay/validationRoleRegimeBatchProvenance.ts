import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import { feasibilityTargetRegimeSchema } from "./validationSplitRegimeFeasibility.js";
import {
  validationSplitAssignmentSchema,
  validationSplitRoleSchema,
  type ValidationSplitAssignment,
  type ValidationSplitRole
} from "./validationProtocol.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  VALIDATION_ROLE_ORDER,
  parseValidationRoleRegimeReplayPlan,
  validationRoleRegimeReplayPlanWarningSchema
} from "./validationRoleRegimeReplayPlan.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

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
    plannedRunCount: z.number().int().positive(),
    globalUniqueEvidenceGroupCount: z.number().int().positive(),
    crossRoleSharedEvidenceGroupCount: z.number().int().nonnegative(),
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
    validateRunAssignments(value, context);
    validateSharedRoles(value, context);
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
      plannedRunCount: manifest.plannedRunCount,
      globalUniqueEvidenceGroupCount:
        manifest.globalUniqueEvidenceGroupCount,
      crossRoleSharedEvidenceGroupCount:
        manifest.crossRoleSharedEvidenceGroupCount,
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

function validateRunAssignments(
  value: z.infer<typeof validationRoleRegimeBatchRunProvenanceSchema>,
  context: z.RefinementCtx
): void {
  const ordered = [...value.sourceAssignments].sort(compareAssignments);
  if (!sameValue(value.sourceAssignments, ordered)) {
    context.addIssue({
      code: "custom",
      path: ["sourceAssignments"],
      message: "batch provenance sourceAssignments must use canonical order"
    });
  }

  const assignmentKeys = new Set<string>();
  for (const [index, assignment] of value.sourceAssignments.entries()) {
    if (assignment.splitRole !== value.splitRole) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssignments", index, "splitRole"],
        message: "batch provenance source assignment role must match splitRole"
      });
    }

    const roleWindow = validationRoleWindow(assignment);
    const effectiveRoleEnd = roleWindow.effectiveRoleEnd ?? roleWindow.roleEnd;
    if (
      Date.parse(value.startAt) < Date.parse(roleWindow.roleStart) ||
      Date.parse(value.endAt) > Date.parse(effectiveRoleEnd)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssignments", index],
        message: "batch provenance run window must fit every source assignment"
      });
    }

    const key = assignmentKey(assignment);
    if (assignmentKeys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["sourceAssignments", index],
        message: "batch provenance source assignments must not contain duplicates"
      });
    }
    assignmentKeys.add(key);
  }

  if (!sameValue(value.executionAssignment, value.sourceAssignments[0])) {
    context.addIssue({
      code: "custom",
      path: ["executionAssignment"],
      message:
        "batch provenance executionAssignment must match the first source assignment"
    });
  }
}

function validateSharedRoles(
  value: z.infer<typeof validationRoleRegimeBatchRunProvenanceSchema>,
  context: z.RefinementCtx
): void {
  const uniqueRoles = new Set(value.sharedRoles);
  if (uniqueRoles.size !== value.sharedRoles.length) {
    context.addIssue({
      code: "custom",
      path: ["sharedRoles"],
      message: "batch provenance sharedRoles must not contain duplicates"
    });
  }

  const canonicalRoles = [...uniqueRoles].sort(
    (left, right) => roleIndex(left) - roleIndex(right)
  );
  if (!sameValue(value.sharedRoles, canonicalRoles)) {
    context.addIssue({
      code: "custom",
      path: ["sharedRoles"],
      message: "batch provenance sharedRoles must use canonical order"
    });
  }

  if (!uniqueRoles.has(value.splitRole)) {
    context.addIssue({
      code: "custom",
      path: ["sharedRoles"],
      message: "batch provenance sharedRoles must include splitRole"
    });
  }

  if (value.sharedAcrossRoles !== (uniqueRoles.size > 1)) {
    context.addIssue({
      code: "custom",
      path: ["sharedAcrossRoles"],
      message:
        "batch provenance sharedAcrossRoles must match the shared role count"
    });
  }
}

function compareAssignments(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): number {
  return (
    left.splitIndex - right.splitIndex ||
    compareStrings(left.splitId, right.splitId) ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole)
  );
}

function assignmentKey(assignment: ValidationSplitAssignment): string {
  return `${assignment.splitIndex}\u0000${assignment.splitId}\u0000${assignment.splitRole}`;
}

function roleIndex(role: ValidationSplitRole): number {
  return VALIDATION_ROLE_ORDER.indexOf(role);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameValue(left: unknown, right: unknown): boolean {
  return createReplayResearchHash(left) === createReplayResearchHash(right);
}
