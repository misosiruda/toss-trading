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

export const validationRoleRegimeStatisticalReadinessEvidenceRowSchema = z
  .object({
    splitRole: validationSplitRoleSchema,
    targetRegime: feasibilityTargetRegimeSchema,
    evidenceGroupHash: sha256HashSchema
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
    const expectedBlockers = deriveExpectedBlockers(value);
    validateProvenance(value, context);
    validateEvidenceCounts(value, context);
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
export type ValidationRoleRegimeStatisticalReadinessEvidenceRow = z.infer<
  typeof validationRoleRegimeStatisticalReadinessEvidenceRowSchema
>;
export type ValidationRoleRegimeStatisticalReadinessArtifact = z.infer<
  typeof validationRoleRegimeStatisticalReadinessArtifactSchema
>;

export interface BuildValidationRoleRegimeStatisticalReadinessArtifactOptions {
  generatedAt: Date | string;
  planHash: string;
  expectedCounts: {
    plannedRunCount: number;
    globalUniqueEvidenceGroupCount: number;
    crossRoleSharedEvidenceGroupCount: number;
  };
  evidenceRows: readonly ValidationRoleRegimeStatisticalReadinessEvidenceRow[];
  roleRegimeSampleMinimum?: number | null;
}

type ReadinessArtifactInput = z.infer<
  typeof validationRoleRegimeStatisticalReadinessArtifactSchema
>;

type ValidationRole = (typeof VALIDATION_ROLE_ORDER)[number];
type TargetRegime = (typeof VALIDATION_TARGET_REGIME_ORDER)[number];
type ReadinessContext = Pick<
  ReadinessArtifactInput,
  "config" | "provenance" | "evidence"
>;

export function buildValidationRoleRegimeStatisticalReadinessArtifact(
  options: BuildValidationRoleRegimeStatisticalReadinessArtifactOptions
): ValidationRoleRegimeStatisticalReadinessArtifact {
  const expectedCounts = evidenceCountSchema.parse(options.expectedCounts);
  const evidenceRows = options.evidenceRows.map((row) =>
    validationRoleRegimeStatisticalReadinessEvidenceRowSchema.parse(row)
  );
  const evidence = summarizeEvidenceRows(evidenceRows);
  const provenanceStatus = sameCounts(expectedCounts, evidence.global)
    ? "verified"
    : "conflict";
  const context: ReadinessContext = {
    config: {
      roleSampleMinimum: VALIDATION_ROLE_REGIME_STATISTICAL_MINIMUM,
      roleRegimeSampleMinimum: options.roleRegimeSampleMinimum ?? null
    },
    provenance: {
      status: provenanceStatus,
      expectedCounts,
      observedCounts: evidence.global
    },
    evidence
  };
  const blockers = deriveExpectedBlockers(context);
  const status =
    provenanceStatus === "conflict"
      ? "invalid"
      : blockers.length > 0
        ? "inconclusive"
        : "ready_for_statistical_validation";

  return validationRoleRegimeStatisticalReadinessArtifactSchema.parse({
    schemaVersion:
      VALIDATION_ROLE_REGIME_STATISTICAL_READINESS_SCHEMA_VERSION,
    mode: "paper_only",
    purpose: "statistical_readiness_diagnostic",
    status,
    generatedAt:
      options.generatedAt instanceof Date
        ? options.generatedAt.toISOString()
        : options.generatedAt,
    source: {
      planHash: options.planHash
    },
    ...context,
    blockers
  });
}

function validateProvenance(
  value: ReadinessArtifactInput,
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
    validateRoleRegimeCounts(value, splitRole, context);
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

}

function validateRoleRegimeCounts(
  value: ReadinessArtifactInput,
  splitRole: ValidationRole,
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
  expectedBlockers: readonly ValidationRoleRegimeStatisticalReadinessBlocker[],
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

  const expectedBlockerKeys = new Set(
    expectedBlockers.map((blocker) =>
      blockerKey(blocker.code, blocker.splitRole, blocker.targetRegime)
    )
  );
  if (!sameSet(actualBlockers, expectedBlockerKeys)) {
    context.addIssue({
      code: "custom",
      path: ["blockers"],
      message: "readiness blockers must match the evidence and provenance state"
    });
  }

  const expectedStatus =
    value.provenance.status === "conflict"
      ? "invalid"
      : expectedBlockers.length > 0
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

function summarizeEvidenceRows(
  evidenceRows: readonly ValidationRoleRegimeStatisticalReadinessEvidenceRow[]
): ReadinessArtifactInput["evidence"] {
  const groups = new Map<
    string,
    {
      roles: Set<ValidationRole>;
    }
  >();
  const roleEvidenceGroups = createRoleSets();
  const roleRegimeEvidenceGroups = createRoleRegimeSets();
  const rolePlannedRunCounts = createRoleCounts();
  const roleRegimePlannedRunCounts = createRoleRegimeCounts();

  for (const row of evidenceRows) {
    rolePlannedRunCounts[row.splitRole] += 1;
    roleRegimePlannedRunCounts[row.splitRole][row.targetRegime] += 1;
    roleEvidenceGroups[row.splitRole].add(row.evidenceGroupHash);
    roleRegimeEvidenceGroups[row.splitRole][row.targetRegime].add(
      row.evidenceGroupHash
    );
    const group = groups.get(row.evidenceGroupHash) ?? {
      roles: new Set<ValidationRole>()
    };
    group.roles.add(row.splitRole);
    groups.set(row.evidenceGroupHash, group);
  }

  const byRole = createRoleEvidenceCounts();
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const roleGroups = roleEvidenceGroups[splitRole];
    let roleExclusiveEvidenceGroupCount = 0;
    let crossRoleSharedEvidenceGroupCount = 0;
    for (const evidenceGroupHash of roleGroups) {
      const roleCount = groups.get(evidenceGroupHash)!.roles.size;
      if (roleCount === 1) {
        roleExclusiveEvidenceGroupCount += 1;
      } else {
        crossRoleSharedEvidenceGroupCount += 1;
      }
    }
    byRole[splitRole] = {
      plannedRunCount: rolePlannedRunCounts[splitRole],
      roleLocalUniqueEvidenceGroupCount: roleGroups.size,
      roleExclusiveEvidenceGroupCount,
      crossRoleSharedEvidenceGroupCount
    };
  }

  const byRoleRegime = createRoleRegimeCellCounts();
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      byRoleRegime[splitRole][targetRegime] = {
        plannedRunCount:
          roleRegimePlannedRunCounts[splitRole][targetRegime],
        uniqueEvidenceGroupCount:
          roleRegimeEvidenceGroups[splitRole][targetRegime].size
      };
    }
  }

  return {
    global: {
      plannedRunCount: evidenceRows.length,
      globalUniqueEvidenceGroupCount: groups.size,
      crossRoleSharedEvidenceGroupCount: Array.from(groups.values()).filter(
        (group) => group.roles.size > 1
      ).length
    },
    byRole,
    byRoleRegime
  };
}

function deriveExpectedBlockers(
  value: ReadinessContext
): ValidationRoleRegimeStatisticalReadinessBlocker[] {
  const blockers: ValidationRoleRegimeStatisticalReadinessBlocker[] = [];
  if (
    !sameCounts(
      value.provenance.expectedCounts,
      value.provenance.observedCounts
    )
  ) {
    blockers.push(
      blocker(
        "PROVENANCE_COUNT_CONFLICT",
        "expected and observed provenance counts conflict"
      )
    );
  }
  if (value.evidence.global.crossRoleSharedEvidenceGroupCount > 0) {
    blockers.push(
      blocker(
        "CROSS_ROLE_EVIDENCE_SHARED",
        "candidate evidence is shared across validation roles"
      )
    );
  }

  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const role = value.evidence.byRole[splitRole];
    if (
      role.roleLocalUniqueEvidenceGroupCount <
      value.config.roleSampleMinimum
    ) {
      blockers.push(
        blocker(
          "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
          "role-local sample count is below the statistical minimum",
          splitRole
        )
      );
    }
    if (
      role.roleExclusiveEvidenceGroupCount <
      value.config.roleSampleMinimum
    ) {
      blockers.push(
        blocker(
          "ROLE_EXCLUSIVE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
          "role-exclusive sample count is below the statistical minimum",
          splitRole
        )
      );
    }
  }

  if (value.config.roleRegimeSampleMinimum === null) {
    blockers.push(
      blocker(
        "ROLE_REGIME_STATISTICAL_MINIMUM_UNDEFINED",
        "role-regime statistical minimum is not defined"
      )
    );
  }
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      const cell = value.evidence.byRoleRegime[splitRole][targetRegime];
      if (cell.uniqueEvidenceGroupCount === 0) {
        blockers.push(
          blocker(
            "ROLE_REGIME_EMPTY",
            "role-regime cell has no evidence",
            splitRole,
            targetRegime
          )
        );
      }
      if (cell.uniqueEvidenceGroupCount === 1) {
        blockers.push(
          blocker(
            "ROLE_REGIME_SINGLE_CANDIDATE",
            "role-regime cell has one candidate",
            splitRole,
            targetRegime
          )
        );
      }
      if (
        value.config.roleRegimeSampleMinimum !== null &&
        cell.uniqueEvidenceGroupCount <
          value.config.roleRegimeSampleMinimum
      ) {
        blockers.push(
          blocker(
            "ROLE_REGIME_SAMPLE_BELOW_STATISTICAL_MINIMUM",
            "role-regime sample count is below the statistical minimum",
            splitRole,
            targetRegime
          )
        );
      }
    }
  }
  return blockers;
}

function blocker(
  code: ValidationRoleRegimeStatisticalReadinessBlockerCode,
  message: string,
  splitRole: ValidationRole | null = null,
  targetRegime: TargetRegime | null = null
): ValidationRoleRegimeStatisticalReadinessBlocker {
  return { code, message, splitRole, targetRegime };
}

function createRoleCounts(): Record<ValidationRole, number> {
  return { train: 0, validation: 0, test: 0 };
}

function createRoleSets(): Record<ValidationRole, Set<string>> {
  return {
    train: new Set<string>(),
    validation: new Set<string>(),
    test: new Set<string>()
  };
}

function createRoleRegimeCounts(): Record<
  ValidationRole,
  Record<TargetRegime, number>
> {
  return {
    train: { bull: 0, bear: 0, sideways: 0, mixed: 0 },
    validation: { bull: 0, bear: 0, sideways: 0, mixed: 0 },
    test: { bull: 0, bear: 0, sideways: 0, mixed: 0 }
  };
}

function createRoleRegimeSets(): Record<
  ValidationRole,
  Record<TargetRegime, Set<string>>
> {
  return {
    train: {
      bull: new Set<string>(),
      bear: new Set<string>(),
      sideways: new Set<string>(),
      mixed: new Set<string>()
    },
    validation: {
      bull: new Set<string>(),
      bear: new Set<string>(),
      sideways: new Set<string>(),
      mixed: new Set<string>()
    },
    test: {
      bull: new Set<string>(),
      bear: new Set<string>(),
      sideways: new Set<string>(),
      mixed: new Set<string>()
    }
  };
}

function createRoleEvidenceCounts(): ReadinessArtifactInput["evidence"]["byRole"] {
  return {
    train: emptyRoleEvidenceCount(),
    validation: emptyRoleEvidenceCount(),
    test: emptyRoleEvidenceCount()
  };
}

function emptyRoleEvidenceCount(): ReadinessArtifactInput["evidence"]["byRole"]["train"] {
  return {
    plannedRunCount: 0,
    roleLocalUniqueEvidenceGroupCount: 0,
    roleExclusiveEvidenceGroupCount: 0,
    crossRoleSharedEvidenceGroupCount: 0
  };
}

function createRoleRegimeCellCounts(): ReadinessArtifactInput["evidence"]["byRoleRegime"] {
  return {
    train: emptyRoleRegimeCellCounts(),
    validation: emptyRoleRegimeCellCounts(),
    test: emptyRoleRegimeCellCounts()
  };
}

function emptyRoleRegimeCellCounts(): ReadinessArtifactInput["evidence"]["byRoleRegime"]["train"] {
  return {
    bull: emptyRoleRegimeCellCount(),
    bear: emptyRoleRegimeCellCount(),
    sideways: emptyRoleRegimeCellCount(),
    mixed: emptyRoleRegimeCellCount()
  };
}

function emptyRoleRegimeCellCount(): ReadinessArtifactInput["evidence"]["byRoleRegime"]["train"]["bull"] {
  return {
    plannedRunCount: 0,
    uniqueEvidenceGroupCount: 0
  };
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
