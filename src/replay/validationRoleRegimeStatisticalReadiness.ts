import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import { feasibilityTargetRegimeSchema } from "./validationSplitRegimeFeasibility.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_ROLE_REGIME_STATISTICAL_MINIMUM,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import { validationSplitRoleSchema } from "./validationProtocol.js";

export const VALIDATION_ROLE_REGIME_STATISTICAL_READINESS_SCHEMA_VERSION =
  "validation_role_regime_statistical_readiness.v1";

export const validationRoleRegimeStatisticalReadinessStatusSchema = z.enum([
  "ready_for_statistical_validation",
  "inconclusive",
  "invalid"
]);

export const validationRoleRegimeStatisticalReadinessBlockerCodeSchema = z.enum(
  [
    "PROVENANCE_COUNT_CONFLICT",
    "CROSS_ROLE_EVIDENCE_SHARED",
    "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
    "ROLE_EXCLUSIVE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
    "ROLE_REGIME_STATISTICAL_MINIMUM_UNDEFINED",
    "ROLE_REGIME_EMPTY",
    "ROLE_REGIME_SINGLE_CANDIDATE",
    "ROLE_REGIME_SAMPLE_BELOW_STATISTICAL_MINIMUM"
  ]
);

export const validationRoleRegimeStatisticalReadinessBlockerSchema = z
  .object({
    code: validationRoleRegimeStatisticalReadinessBlockerCodeSchema,
    message: z.string().trim().min(1),
    splitRole: validationSplitRoleSchema.nullable(),
    targetRegime: feasibilityTargetRegimeSchema.nullable()
  })
  .strict();

const evidenceCountSchema = z
  .object({
    plannedRunCount: z.number().int().nonnegative(),
    globalUniqueEvidenceGroupCount: z.number().int().nonnegative(),
    crossRoleSharedEvidenceGroupCount: z.number().int().nonnegative()
  })
  .strict();

const roleEvidenceCountSchema = z
  .object({
    plannedRunCount: z.number().int().nonnegative(),
    roleLocalUniqueEvidenceGroupCount: z.number().int().nonnegative(),
    roleExclusiveEvidenceGroupCount: z.number().int().nonnegative(),
    crossRoleSharedEvidenceGroupCount: z.number().int().nonnegative()
  })
  .strict();

const roleEvidenceCountsSchema = z
  .object({
    train: roleEvidenceCountSchema,
    validation: roleEvidenceCountSchema,
    test: roleEvidenceCountSchema
  })
  .strict();

const roleRegimeCellCountSchema = z
  .object({
    plannedRunCount: z.number().int().nonnegative(),
    uniqueEvidenceGroupCount: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.uniqueEvidenceGroupCount > value.plannedRunCount) {
      context.addIssue({
        code: "custom",
        message:
          "role-regime unique evidence count must not exceed planned run count"
      });
    }
  });

const roleRegimeCellCountsSchema = z
  .object({
    bull: roleRegimeCellCountSchema,
    bear: roleRegimeCellCountSchema,
    sideways: roleRegimeCellCountSchema,
    mixed: roleRegimeCellCountSchema
  })
  .strict();

const roleRegimeCountsSchema = z
  .object({
    train: roleRegimeCellCountsSchema,
    validation: roleRegimeCellCountsSchema,
    test: roleRegimeCellCountsSchema
  })
  .strict();

export const validationRoleRegimeStatisticalReadinessArtifactSchema = z
  .object({
    schemaVersion: z.literal(
      VALIDATION_ROLE_REGIME_STATISTICAL_READINESS_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    purpose: z.literal("statistical_readiness_diagnostic"),
    status: validationRoleRegimeStatisticalReadinessStatusSchema,
    generatedAt: isoDateTimeSchema,
    source: z
      .object({
        planHash: sha256HashSchema
      })
      .strict(),
    config: z
      .object({
        roleSampleMinimum: z.literal(
          VALIDATION_ROLE_REGIME_STATISTICAL_MINIMUM
        ),
        roleRegimeSampleMinimum: z.number().int().positive().nullable()
      })
      .strict(),
    provenance: z
      .object({
        status: z.enum(["verified", "conflict"]),
        expectedCounts: evidenceCountSchema,
        observedCounts: evidenceCountSchema
      })
      .strict(),
    evidence: z
      .object({
        global: evidenceCountSchema,
        byRole: roleEvidenceCountsSchema,
        byRoleRegime: roleRegimeCountsSchema
      })
      .strict(),
    blockers: z.array(
      validationRoleRegimeStatisticalReadinessBlockerSchema
    )
  })
  .strict()
  .superRefine((value, context) => {
    const expectedBlockers = new Set<string>();
    validateProvenance(value, expectedBlockers, context);
    validateEvidenceCounts(value, expectedBlockers, context);
    validateBlockersAndStatus(value, expectedBlockers, context);
  });

export type ValidationRoleRegimeStatisticalReadinessStatus = z.infer<
  typeof validationRoleRegimeStatisticalReadinessStatusSchema
>;
export type ValidationRoleRegimeStatisticalReadinessBlockerCode = z.infer<
  typeof validationRoleRegimeStatisticalReadinessBlockerCodeSchema
>;
export type ValidationRoleRegimeStatisticalReadinessBlocker = z.infer<
  typeof validationRoleRegimeStatisticalReadinessBlockerSchema
>;
export type ValidationRoleRegimeStatisticalReadinessArtifact = z.infer<
  typeof validationRoleRegimeStatisticalReadinessArtifactSchema
>;

type ReadinessArtifactInput = z.infer<
  typeof validationRoleRegimeStatisticalReadinessArtifactSchema
>;

function validateProvenance(
  value: ReadinessArtifactInput,
  expectedBlockers: Set<string>,
  context: z.RefinementCtx
): void {
  const hasConflict =
    value.provenance.expectedCounts.plannedRunCount !==
      value.provenance.observedCounts.plannedRunCount ||
    value.provenance.expectedCounts.globalUniqueEvidenceGroupCount !==
      value.provenance.observedCounts.globalUniqueEvidenceGroupCount ||
    value.provenance.expectedCounts.crossRoleSharedEvidenceGroupCount !==
      value.provenance.observedCounts.crossRoleSharedEvidenceGroupCount;
  const expectedStatus = hasConflict ? "conflict" : "verified";

  if (value.provenance.status !== expectedStatus) {
    context.addIssue({
      code: "custom",
      path: ["provenance", "status"],
      message: "provenance status must match expected and observed counts"
    });
  }
  if (hasConflict) {
    expectedBlockers.add(
      blockerKey("PROVENANCE_COUNT_CONFLICT", null, null)
    );
  }

  if (!sameCounts(value.provenance.observedCounts, value.evidence.global)) {
    context.addIssue({
      code: "custom",
      path: ["provenance", "observedCounts"],
      message: "provenance observed counts must match global evidence counts"
    });
  }
}

function validateEvidenceCounts(
  value: ReadinessArtifactInput,
  expectedBlockers: Set<string>,
  context: z.RefinementCtx
): void {
  const global = value.evidence.global;
  if (global.globalUniqueEvidenceGroupCount > global.plannedRunCount) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "global"],
      message: "global unique evidence count must not exceed planned run count"
    });
  }
  if (
    global.crossRoleSharedEvidenceGroupCount >
    global.globalUniqueEvidenceGroupCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "global"],
      message:
        "cross-role shared evidence count must not exceed global unique evidence count"
    });
  }
  if (global.crossRoleSharedEvidenceGroupCount > 0) {
    expectedBlockers.add(
      blockerKey("CROSS_ROLE_EVIDENCE_SHARED", null, null)
    );
  }

  let plannedRunCount = 0;
  let roleExclusiveEvidenceGroupCount = 0;
  let sharedRoleMembershipCount = 0;
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const role = value.evidence.byRole[splitRole];
    plannedRunCount += role.plannedRunCount;
    roleExclusiveEvidenceGroupCount += role.roleExclusiveEvidenceGroupCount;
    sharedRoleMembershipCount += role.crossRoleSharedEvidenceGroupCount;

    if (
      role.roleLocalUniqueEvidenceGroupCount !==
      role.roleExclusiveEvidenceGroupCount +
        role.crossRoleSharedEvidenceGroupCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "byRole", splitRole],
        message:
          "role-local unique evidence count must equal exclusive and shared counts"
      });
    }
    if (role.roleLocalUniqueEvidenceGroupCount > role.plannedRunCount) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "byRole", splitRole],
        message:
          "role-local unique evidence count must not exceed planned run count"
      });
    }
    if (
      role.roleLocalUniqueEvidenceGroupCount <
      value.config.roleSampleMinimum
    ) {
      expectedBlockers.add(
        blockerKey(
          "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
          splitRole,
          null
        )
      );
    }
    if (
      role.roleExclusiveEvidenceGroupCount <
      value.config.roleSampleMinimum
    ) {
      expectedBlockers.add(
        blockerKey(
          "ROLE_EXCLUSIVE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
          splitRole,
          null
        )
      );
    }

    validateRoleRegimeCounts(value, splitRole, expectedBlockers, context);
  }

  if (plannedRunCount !== global.plannedRunCount) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "global", "plannedRunCount"],
      message: "global planned run count must match the role total"
    });
  }
  if (
    roleExclusiveEvidenceGroupCount +
      global.crossRoleSharedEvidenceGroupCount !==
    global.globalUniqueEvidenceGroupCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "global", "globalUniqueEvidenceGroupCount"],
      message:
        "global unique evidence count must equal exclusive and shared groups"
    });
  }

  const minimumSharedMembershipCount =
    global.crossRoleSharedEvidenceGroupCount * 2;
  const maximumSharedMembershipCount =
    global.crossRoleSharedEvidenceGroupCount * VALIDATION_ROLE_ORDER.length;
  if (
    sharedRoleMembershipCount < minimumSharedMembershipCount ||
    sharedRoleMembershipCount > maximumSharedMembershipCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "byRole"],
      message:
        "role shared evidence memberships must cover each shared group in two or more roles"
    });
  }

  if (value.config.roleRegimeSampleMinimum === null) {
    expectedBlockers.add(
      blockerKey("ROLE_REGIME_STATISTICAL_MINIMUM_UNDEFINED", null, null)
    );
  }
}

function validateRoleRegimeCounts(
  value: ReadinessArtifactInput,
  splitRole: (typeof VALIDATION_ROLE_ORDER)[number],
  expectedBlockers: Set<string>,
  context: z.RefinementCtx
): void {
  const role = value.evidence.byRole[splitRole];
  const cells = value.evidence.byRoleRegime[splitRole];
  let plannedRunCount = 0;
  let uniqueEvidenceGroupCount = 0;

  for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
    const cell = cells[targetRegime];
    plannedRunCount += cell.plannedRunCount;
    uniqueEvidenceGroupCount += cell.uniqueEvidenceGroupCount;

    if (cell.uniqueEvidenceGroupCount === 0) {
      expectedBlockers.add(
        blockerKey("ROLE_REGIME_EMPTY", splitRole, targetRegime)
      );
    }
    if (cell.uniqueEvidenceGroupCount === 1) {
      expectedBlockers.add(
        blockerKey("ROLE_REGIME_SINGLE_CANDIDATE", splitRole, targetRegime)
      );
    }
    if (
      value.config.roleRegimeSampleMinimum !== null &&
      cell.uniqueEvidenceGroupCount < value.config.roleRegimeSampleMinimum
    ) {
      expectedBlockers.add(
        blockerKey(
          "ROLE_REGIME_SAMPLE_BELOW_STATISTICAL_MINIMUM",
          splitRole,
          targetRegime
        )
      );
    }
  }

  if (plannedRunCount !== role.plannedRunCount) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "byRoleRegime", splitRole],
      message: "role-regime planned run counts must match the role total"
    });
  }
  if (uniqueEvidenceGroupCount !== role.roleLocalUniqueEvidenceGroupCount) {
    context.addIssue({
      code: "custom",
      path: ["evidence", "byRoleRegime", splitRole],
      message: "role-regime unique evidence counts must match the role total"
    });
  }
}

function validateBlockersAndStatus(
  value: ReadinessArtifactInput,
  expectedBlockers: Set<string>,
  context: z.RefinementCtx
): void {
  const actualBlockers = new Set<string>();
  for (const [index, blocker] of value.blockers.entries()) {
    const key = blockerKey(
      blocker.code,
      blocker.splitRole,
      blocker.targetRegime
    );
    if (actualBlockers.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["blockers", index],
        message: "readiness blockers must not contain duplicates"
      });
    }
    actualBlockers.add(key);
  }

  if (!sameSet(actualBlockers, expectedBlockers)) {
    context.addIssue({
      code: "custom",
      path: ["blockers"],
      message: "readiness blockers must match the evidence and provenance state"
    });
  }

  const expectedStatus =
    value.provenance.status === "conflict"
      ? "invalid"
      : expectedBlockers.size > 0
        ? "inconclusive"
        : "ready_for_statistical_validation";
  if (value.status !== expectedStatus) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message:
        "readiness status must fail closed for provenance conflicts and blockers"
    });
  }
}

function blockerKey(
  code: ValidationRoleRegimeStatisticalReadinessBlockerCode,
  splitRole: z.infer<typeof validationSplitRoleSchema> | null,
  targetRegime: z.infer<typeof feasibilityTargetRegimeSchema> | null
): string {
  return `${code}:${splitRole ?? "*"}:${targetRegime ?? "*"}`;
}

function sameCounts(
  left: z.infer<typeof evidenceCountSchema>,
  right: z.infer<typeof evidenceCountSchema>
): boolean {
  return (
    left.plannedRunCount === right.plannedRunCount &&
    left.globalUniqueEvidenceGroupCount ===
      right.globalUniqueEvidenceGroupCount &&
    left.crossRoleSharedEvidenceGroupCount ===
      right.crossRoleSharedEvidenceGroupCount
  );
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return (
    left.size === right.size &&
    Array.from(left).every((value) => right.has(value))
  );
}
