import { z } from "zod";

import { isoDateTimeSchema, sha256HashSchema } from "../domain/schemas.js";
import { feasibilityTargetRegimeSchema } from "./validationSplitRegimeFeasibility.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import { validationSplitRoleSchema } from "./validationProtocol.js";

export const VALIDATION_ROLE_REGIME_EVIDENCE_EXPANSION_PREFLIGHT_SCHEMA_VERSION =
  "validation_role_regime_evidence_expansion_preflight.v1";
export const EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM = 30;

export const evidenceExpansionPreflightStatusSchema = z.enum([
  "ready_for_expansion_replay",
  "inconclusive",
  "invalid"
]);

export const evidenceExpansionPreflightBlockerCodeSchema = z.enum([
  "RESULT_METRIC_INPUT_FORBIDDEN",
  "SOURCE_PROVENANCE_INVALID",
  "BASELINE_PROVENANCE_CONFLICT",
  "EXPANSION_SOURCE_COVERAGE_MISSING",
  "OFFICIAL_CALENDAR_EVIDENCE_MISSING",
  "OFFICIAL_CALENDAR_EVIDENCE_INVALID",
  "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
  "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET",
  "ROLE_REGIME_TARGET_UNDEFINED",
  "ROLE_REGIME_CAPACITY_BELOW_TARGET",
  "DEPENDENCY_INPUT_INCOMPLETE",
  "TRADING_DATE_SET_CONFLICT",
  "CANDIDATE_IDENTITY_CONFLICT",
  "EXCLUSION_COUNT_CONFLICT"
]);

export const evidenceExpansionExclusionReasonSchema = z.enum([
  "CALENDAR_SESSION_REJECTED",
  "SCOPE_UNAVAILABLE",
  "ROLE_BOUNDARY_VIOLATION",
  "EMBARGO_VIOLATION",
  "DUPLICATE_BASELINE_EVIDENCE",
  "DUPLICATE_EXPANSION_EVIDENCE",
  "CROSS_ROLE_SHARED_EVIDENCE",
  "INSUFFICIENT_REGIME_DATA"
]);

export const evidenceExpansionSourceVariantReferenceSchema = z
  .object({
    feasibilityCandidateHash: sha256HashSchema,
    legacyReplayPlanEvidenceGroupHash: sha256HashSchema.nullable(),
    sourceVariantHashVersion: z.literal(
      "evidence_expansion_source_variant.v1"
    ),
    sourceVariantHash: sha256HashSchema,
    observedTradingDatesHash: sha256HashSchema,
    universeMembershipHash: sha256HashSchema
  })
  .strict();

const sourceVariantReferencesSchema = z
  .array(evidenceExpansionSourceVariantReferenceSchema)
  .min(1)
  .superRefine((variants, context) => {
    for (let index = 1; index < variants.length; index += 1) {
      if (
        compareSourceVariants(variants[index - 1]!, variants[index]!) >= 0
      ) {
        context.addIssue({
          code: "custom",
          path: [index],
          message:
            "source variants must use canonical hash and candidate order"
        });
      }
    }
  });

const roleRegimeTargetSchema = z
  .object({
    bull: z.number().int().positive().nullable(),
    bear: z.number().int().positive().nullable(),
    sideways: z.number().int().positive().nullable(),
    mixed: z.number().int().positive().nullable()
  })
  .strict();

const roleTargetSchema = z
  .object({
    roleLocalUniqueMinimum: z.literal(
      EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM
    ),
    roleExclusiveMinimum: z.literal(
      EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM
    ),
    byRegime: roleRegimeTargetSchema
  })
  .strict();

const targetMatrixSchema = z
  .object({
    byRole: z
      .object({
        train: roleTargetSchema,
        validation: roleTargetSchema,
        test: roleTargetSchema
      })
      .strict()
  })
  .strict();

const capacityRoleSchema = z
  .object({
    roleLocalUniqueEvidenceGroupCount: z.number().int().nonnegative(),
    roleExclusiveEvidenceGroupCount: z.number().int().nonnegative(),
    byRegime: z
      .object({
        bull: z.number().int().nonnegative(),
        bear: z.number().int().nonnegative(),
        sideways: z.number().int().nonnegative(),
        mixed: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.roleExclusiveEvidenceGroupCount >
      value.roleLocalUniqueEvidenceGroupCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["roleExclusiveEvidenceGroupCount"],
        message: "role-exclusive capacity must not exceed role-local capacity"
      });
    }
    const regimeTotal = Object.values(value.byRegime).reduce(
      (total, count) => total + count,
      0
    );
    if (regimeTotal !== value.roleLocalUniqueEvidenceGroupCount) {
      context.addIssue({
        code: "custom",
        path: ["byRegime"],
        message: "role-regime capacity must equal role-local capacity"
      });
    }
  });

const capacityViewSchema = z
  .object({
    globalUniqueEvidenceGroupCount: z.number().int().nonnegative(),
    crossRoleSharedEvidenceGroupCount: z.number().int().nonnegative(),
    byRole: z
      .object({
        train: capacityRoleSchema,
        validation: capacityRoleSchema,
        test: capacityRoleSchema
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.crossRoleSharedEvidenceGroupCount >
      value.globalUniqueEvidenceGroupCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["crossRoleSharedEvidenceGroupCount"],
        message: "cross-role shared capacity must not exceed global capacity"
      });
    }
    const roles = Object.values(value.byRole);
    const exclusiveCount = roles.reduce(
      (total, role) =>
        total + role.roleExclusiveEvidenceGroupCount,
      0
    );
    if (
      exclusiveCount + value.crossRoleSharedEvidenceGroupCount !==
      value.globalUniqueEvidenceGroupCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["globalUniqueEvidenceGroupCount"],
        message:
          "global capacity must equal role-exclusive and shared evidence groups"
      });
    }
    const sharedMembershipCount = roles.reduce(
      (total, role) =>
        total +
        role.roleLocalUniqueEvidenceGroupCount -
        role.roleExclusiveEvidenceGroupCount,
      0
    );
    const minimumSharedMembershipCount =
      value.crossRoleSharedEvidenceGroupCount * 2;
    const maximumSharedMembershipCount =
      value.crossRoleSharedEvidenceGroupCount * VALIDATION_ROLE_ORDER.length;
    if (
      sharedMembershipCount < minimumSharedMembershipCount ||
      sharedMembershipCount > maximumSharedMembershipCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["byRole"],
        message:
          "shared evidence groups must appear in two or more validation roles"
      });
    }
  });

const capacitySummarySchema = z
  .object({
    baseline: capacityViewSchema,
    expansion: capacityViewSchema,
    combined: capacityViewSchema,
    incremental: capacityViewSchema
  })
  .strict()
  .superRefine((value, context) => {
    validateCapacitySummaryRelationships(value, context);
  });

const candidateIntervalSchema = z
  .object({
    evidenceGroupHash: sha256HashSchema,
    sourceVariants: sourceVariantReferencesSchema,
    splitRoles: z.array(validationSplitRoleSchema).min(1),
    targetRegime: feasibilityTargetRegimeSchema,
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    canonicalTradingDatesHash: sha256HashSchema,
    combinedUniverseMembershipHash: sha256HashSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) >= Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "candidate interval startAt must be before endAt"
      });
    }
    if (new Set(value.splitRoles).size !== value.splitRoles.length) {
      context.addIssue({
        code: "custom",
        path: ["splitRoles"],
        message: "candidate interval split roles must be unique"
      });
    }
    for (let index = 1; index < value.splitRoles.length; index += 1) {
      if (
        VALIDATION_ROLE_ORDER.indexOf(value.splitRoles[index - 1]!) >=
        VALIDATION_ROLE_ORDER.indexOf(value.splitRoles[index]!)
      ) {
        context.addIssue({
          code: "custom",
          path: ["splitRoles", index],
          message: "candidate interval split roles must use canonical order"
        });
      }
    }
    const sourceVariantHashes = value.sourceVariants.map(
      (variant) => variant.sourceVariantHash
    );
    if (
      new Set(sourceVariantHashes).size !== sourceVariantHashes.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceVariants"],
        message: "candidate interval source variants must be unique"
      });
    }
  });

const pairwiseDependencySchema = z
  .object({
    leftEvidenceGroupHash: sha256HashSchema,
    rightEvidenceGroupHash: sha256HashSchema,
    tradingDateOverlapCount: z.number().int().nonnegative(),
    tradingDateUnionCount: z.number().int().positive(),
    tradingDateOverlapRatio: z.number().min(0).max(1),
    adjacencyTradingDayGap: z.number().int().nonnegative().nullable(),
    sharedUniverse: z.boolean(),
    sameRegime: z.boolean(),
    crossRole: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.leftEvidenceGroupHash === value.rightEvidenceGroupHash) {
      context.addIssue({
        code: "custom",
        path: ["rightEvidenceGroupHash"],
        message: "pairwise dependency must not compare an interval to itself"
      });
    }
    if (value.tradingDateOverlapCount > value.tradingDateUnionCount) {
      context.addIssue({
        code: "custom",
        path: ["tradingDateOverlapCount"],
        message: "trading-date overlap must not exceed union count"
      });
    }
    const expectedRatio =
      value.tradingDateOverlapCount / value.tradingDateUnionCount;
    if (Math.abs(value.tradingDateOverlapRatio - expectedRatio) > 1e-12) {
      context.addIssue({
        code: "custom",
        path: ["tradingDateOverlapRatio"],
        message: "trading-date overlap ratio must match overlap and union counts"
      });
    }
    if (
      (value.tradingDateOverlapCount > 0 &&
        value.adjacencyTradingDayGap !== null) ||
      (value.tradingDateOverlapCount === 0 &&
        value.adjacencyTradingDayGap === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["adjacencyTradingDayGap"],
        message:
          "adjacency gap must be null for overlap and present without overlap"
      });
    }
  });

const dependencyInputsSchema = z
  .object({
    candidateIntervals: z.array(candidateIntervalSchema),
    pairwise: z.array(pairwiseDependencySchema)
  })
  .strict();

export const evidenceExpansionExclusionSchema = z
  .object({
    sourceVariants: sourceVariantReferencesSchema,
    evidenceGroupHash: sha256HashSchema,
    splitRole: validationSplitRoleSchema.nullable(),
    targetRegime: feasibilityTargetRegimeSchema.nullable(),
    reason: evidenceExpansionExclusionReasonSchema,
    message: z.string().trim().min(1)
  })
  .strict();

export const evidenceExpansionPreflightBlockerSchema = z
  .object({
    code: evidenceExpansionPreflightBlockerCodeSchema,
    message: z.string().trim().min(1),
    splitRole: validationSplitRoleSchema.nullable(),
    targetRegime: feasibilityTargetRegimeSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const roleScoped =
      value.code === "ROLE_LOCAL_CAPACITY_BELOW_TARGET" ||
      value.code === "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET";
    const regimeScoped = value.code === "ROLE_REGIME_CAPACITY_BELOW_TARGET";
    if (
      (roleScoped &&
        (value.splitRole === null || value.targetRegime !== null)) ||
      (regimeScoped &&
        (value.splitRole === null || value.targetRegime === null)) ||
      (!roleScoped &&
        !regimeScoped &&
        (value.splitRole !== null || value.targetRegime !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: "preflight blocker scope does not match blocker code"
      });
    }
  });

export const validationRoleRegimeEvidenceExpansionPreflightArtifactSchema = z
  .object({
    schemaVersion: z.literal(
      VALIDATION_ROLE_REGIME_EVIDENCE_EXPANSION_PREFLIGHT_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    purpose: z.literal("evidence_expansion_preflight"),
    status: evidenceExpansionPreflightStatusSchema,
    generatedAt: isoDateTimeSchema,
    source: z
      .object({
        baselineFeasibilityArtifactHash: sha256HashSchema,
        baselinePlanHash: sha256HashSchema,
        baselineReadinessArtifactHash: sha256HashSchema,
        expansionDataSnapshotHash: sha256HashSchema,
        expansionUniverseHash: sha256HashSchema,
        expansionCoverageHash: sha256HashSchema,
        validationSplitHash: sha256HashSchema,
        calendarHash: sha256HashSchema,
        officialCalendarArtifactHash: sha256HashSchema.nullable(),
        marketRegimeClassifierHash: sha256HashSchema
      })
      .strict(),
    config: z
      .object({
        candidateStrategyBucket: z.literal("short_term"),
        targetRegimes: z.tuple([
          z.literal("bull"),
          z.literal("bear"),
          z.literal("sideways"),
          z.literal("mixed")
        ]),
        windowMonths: z.number().int().positive(),
        timezoneOffsetMinutes: z.number().int(),
        roleSampleMinimum: z.literal(
          EVIDENCE_EXPANSION_ROLE_SAMPLE_MINIMUM
        ),
        roleRegimeSampleMinimum: z.number().int().positive().nullable(),
        inputPolicyVersion: z.literal("result_blind_capacity_scan.v1"),
        dependencyDiagnosticPolicyVersion: z.literal(
          "overlap_adjacency_inputs.v1"
        )
      })
      .strict(),
    targetMatrix: targetMatrixSchema,
    capacity: capacitySummarySchema,
    dependencyInputs: dependencyInputsSchema,
    exclusions: z.array(evidenceExpansionExclusionSchema),
    blockers: z.array(evidenceExpansionPreflightBlockerSchema),
    preflightHash: sha256HashSchema
  })
  .strict()
  .superRefine((value, context) => {
    validateTargets(value, context);
    const tradingDateSetConflict = hasTradingDateSetConflict(value);
    const officialCalendarMissing =
      value.source.officialCalendarArtifactHash === null;
    const dependencyInputsIncomplete = validateDependencyCompleteness(
      value,
      tradingDateSetConflict || officialCalendarMissing,
      context
    );
    validateRequiredBlockers(
      value,
      dependencyInputsIncomplete || officialCalendarMissing,
      tradingDateSetConflict,
      context
    );
    validateBlockerStatus(value, context);
  });

export type EvidenceExpansionPreflightStatus = z.infer<
  typeof evidenceExpansionPreflightStatusSchema
>;
export type EvidenceExpansionPreflightBlockerCode = z.infer<
  typeof evidenceExpansionPreflightBlockerCodeSchema
>;
export type EvidenceExpansionSourceVariantReference = z.infer<
  typeof evidenceExpansionSourceVariantReferenceSchema
>;
export type EvidenceExpansionExclusion = z.infer<
  typeof evidenceExpansionExclusionSchema
>;
export type EvidenceExpansionPreflightBlocker = z.infer<
  typeof evidenceExpansionPreflightBlockerSchema
>;
export type ValidationRoleRegimeEvidenceExpansionPreflightArtifact = z.infer<
  typeof validationRoleRegimeEvidenceExpansionPreflightArtifactSchema
>;

type PreflightArtifact = z.infer<
  typeof validationRoleRegimeEvidenceExpansionPreflightArtifactSchema
>;
type ValidationRole = (typeof VALIDATION_ROLE_ORDER)[number];
type TargetRegime = (typeof VALIDATION_TARGET_REGIME_ORDER)[number];
type CapacitySummary = z.infer<typeof capacitySummarySchema>;

const INVALID_BLOCKER_CODES = new Set<EvidenceExpansionPreflightBlockerCode>([
  "RESULT_METRIC_INPUT_FORBIDDEN",
  "SOURCE_PROVENANCE_INVALID",
  "BASELINE_PROVENANCE_CONFLICT",
  "EXPANSION_SOURCE_COVERAGE_MISSING",
  "OFFICIAL_CALENDAR_EVIDENCE_INVALID",
  "TRADING_DATE_SET_CONFLICT",
  "CANDIDATE_IDENTITY_CONFLICT",
  "EXCLUSION_COUNT_CONFLICT"
]);

function validateDependencyCompleteness(
  value: PreflightArtifact,
  pairwiseDiagnosticsUnavailable: boolean,
  context: z.RefinementCtx
): boolean {
  const intervals = value.dependencyInputs.candidateIntervals;
  let incomplete = false;
  const intervalHashes = new Set<string>();
  const intervalsByHash = new Map<string, (typeof intervals)[number]>();
  const roleLocalCounts = createRoleCounts();
  const roleExclusiveCounts = createRoleCounts();
  const roleRegimeCounts = createRoleRegimeCounts();
  let crossRoleSharedCount = 0;

  for (const [index, interval] of intervals.entries()) {
    if (
      index > 0 &&
      compareCandidateIntervals(intervals[index - 1]!, interval) >= 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "candidateIntervals", index],
        message: "candidate intervals must use canonical order"
      });
    }
    if (intervalHashes.has(interval.evidenceGroupHash)) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "candidateIntervals", index],
        message: "candidate intervals must contain one row per evidence group"
      });
    }
    intervalHashes.add(interval.evidenceGroupHash);
    intervalsByHash.set(interval.evidenceGroupHash, interval);
    if (interval.splitRoles.length > 1) {
      crossRoleSharedCount += 1;
    }
    for (const splitRole of interval.splitRoles) {
      roleLocalCounts[splitRole] += 1;
      roleRegimeCounts[splitRole][interval.targetRegime] += 1;
      if (interval.splitRoles.length === 1) {
        roleExclusiveCounts[splitRole] += 1;
      }
    }
  }

  const combined = value.capacity.combined;
  if (
    intervals.length !== combined.globalUniqueEvidenceGroupCount ||
    crossRoleSharedCount !== combined.crossRoleSharedEvidenceGroupCount
  ) {
    incomplete = true;
  }
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const capacity = combined.byRole[splitRole];
    if (
      roleLocalCounts[splitRole] !==
        capacity.roleLocalUniqueEvidenceGroupCount ||
      roleExclusiveCounts[splitRole] !==
        capacity.roleExclusiveEvidenceGroupCount
    ) {
      incomplete = true;
    }
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      if (
        roleRegimeCounts[splitRole][targetRegime] !==
        capacity.byRegime[targetRegime]
      ) {
        incomplete = true;
      }
    }
  }

  if (pairwiseDiagnosticsUnavailable) {
    if (value.dependencyInputs.pairwise.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise"],
        message:
          "pairwise dependencies must be empty when diagnostics are unavailable"
      });
    }
    return incomplete;
  }

  const expectedPairKeys = new Set<string>();
  const orderedHashes = [...intervalHashes].sort((left, right) =>
    left.localeCompare(right)
  );
  for (let leftIndex = 0; leftIndex < orderedHashes.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < orderedHashes.length;
      rightIndex += 1
    ) {
      expectedPairKeys.add(
        pairKey(orderedHashes[leftIndex]!, orderedHashes[rightIndex]!)
      );
    }
  }

  const actualPairKeys = new Set<string>();
  let previousPairKey: string | null = null;
  for (const [index, pair] of value.dependencyInputs.pairwise.entries()) {
    const leftInterval = intervalsByHash.get(pair.leftEvidenceGroupHash);
    const rightInterval = intervalsByHash.get(pair.rightEvidenceGroupHash);
    if (leftInterval === undefined || rightInterval === undefined) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise", index],
        message: "pairwise dependency must reference accepted evidence groups"
      });
      continue;
    }
    const expectedSameRegime =
      leftInterval.targetRegime === rightInterval.targetRegime;
    if (pair.sameRegime !== expectedSameRegime) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise", index, "sameRegime"],
        message: "pairwise sameRegime must match accepted intervals"
      });
    }
    const expectedCrossRole =
      new Set([
        ...leftInterval.splitRoles,
        ...rightInterval.splitRoles
      ]).size > 1;
    if (pair.crossRole !== expectedCrossRole) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise", index, "crossRole"],
        message: "pairwise crossRole must match accepted interval roles"
      });
    }
    if (
      pair.leftEvidenceGroupHash.localeCompare(
        pair.rightEvidenceGroupHash
      ) >= 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise", index],
        message: "pairwise dependency hashes must use canonical order"
      });
    }
    const key = pairKey(
      pair.leftEvidenceGroupHash,
      pair.rightEvidenceGroupHash
    );
    if (previousPairKey !== null && previousPairKey.localeCompare(key) >= 0) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise", index],
        message: "pairwise dependencies must use canonical row order"
      });
    }
    previousPairKey = key;
    if (actualPairKeys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["dependencyInputs", "pairwise", index],
        message: "pairwise dependencies must not contain duplicates"
      });
    }
    actualPairKeys.add(key);
  }
  if (!sameSet(actualPairKeys, expectedPairKeys)) {
    incomplete = true;
  }
  return incomplete;
}

function validateCapacitySummaryRelationships(
  value: CapacitySummary,
  context: z.RefinementCtx
): void {
  const baseline = value.baseline;
  const expansion = value.expansion;
  const combined = value.combined;
  const incremental = value.incremental;

  if (
    baseline.globalUniqueEvidenceGroupCount +
      incremental.globalUniqueEvidenceGroupCount !==
    combined.globalUniqueEvidenceGroupCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["incremental", "globalUniqueEvidenceGroupCount"],
      message:
        "combined global capacity must equal baseline and incremental capacity"
    });
  }
  if (
    incremental.globalUniqueEvidenceGroupCount >
    expansion.globalUniqueEvidenceGroupCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["incremental", "globalUniqueEvidenceGroupCount"],
      message: "incremental global capacity must not exceed expansion capacity"
    });
  }
  if (
    incremental.crossRoleSharedEvidenceGroupCount >
    expansion.crossRoleSharedEvidenceGroupCount
  ) {
    context.addIssue({
      code: "custom",
      path: ["incremental", "crossRoleSharedEvidenceGroupCount"],
      message:
        "incremental shared capacity must not exceed expansion shared capacity"
    });
  }

  for (const splitRole of VALIDATION_ROLE_ORDER) {
    validateUnionDimension(
      baseline.byRole[splitRole].roleLocalUniqueEvidenceGroupCount,
      expansion.byRole[splitRole].roleLocalUniqueEvidenceGroupCount,
      combined.byRole[splitRole].roleLocalUniqueEvidenceGroupCount,
      incremental.byRole[splitRole].roleLocalUniqueEvidenceGroupCount,
      ["incremental", "byRole", splitRole, "roleLocalUniqueEvidenceGroupCount"],
      context
    );
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      validateUnionDimension(
        baseline.byRole[splitRole].byRegime[targetRegime],
        expansion.byRole[splitRole].byRegime[targetRegime],
        combined.byRole[splitRole].byRegime[targetRegime],
        incremental.byRole[splitRole].byRegime[targetRegime],
        ["incremental", "byRole", splitRole, "byRegime", targetRegime],
        context
      );
    }
  }
}

function validateUnionDimension(
  baseline: number,
  expansion: number,
  combined: number,
  incremental: number,
  path: Array<string | number>,
  context: z.RefinementCtx
): void {
  if (
    combined < Math.max(baseline, expansion) ||
    combined > baseline + expansion ||
    incremental > expansion
  ) {
    context.addIssue({
      code: "custom",
      path,
      message:
        "capacity view must satisfy baseline, expansion, combined, and incremental bounds"
    });
  }
}

function validateTargets(
  value: PreflightArtifact,
  context: z.RefinementCtx
): void {
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const roleTarget = value.targetMatrix.byRole[splitRole];
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      if (
        roleTarget.byRegime[targetRegime] !==
        value.config.roleRegimeSampleMinimum
      ) {
        context.addIssue({
          code: "custom",
          path: ["targetMatrix", "byRole", splitRole, "byRegime", targetRegime],
          message: "role-regime target must match configured minimum"
        });
      }
    }
  }
}

function validateRequiredBlockers(
  value: PreflightArtifact,
  dependencyInputsIncomplete: boolean,
  tradingDateSetConflict: boolean,
  context: z.RefinementCtx
): void {
  const blockerKeys = new Set<string>();
  const requiredBlockerKeys = new Set<string>();
  for (const [index, blocker] of value.blockers.entries()) {
    const key = blockerKey(
      blocker.code,
      blocker.splitRole,
      blocker.targetRegime
    );
    if (blockerKeys.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["blockers", index],
        message: "preflight blockers must not contain duplicates"
      });
    }
    blockerKeys.add(key);
  }

  if (value.source.officialCalendarArtifactHash === null) {
    requireDerivedBlocker(
      blockerKeys,
      requiredBlockerKeys,
      "OFFICIAL_CALENDAR_EVIDENCE_MISSING",
      null,
      null,
      context
    );
  }
  if (value.config.roleRegimeSampleMinimum === null) {
    requireDerivedBlocker(
      blockerKeys,
      requiredBlockerKeys,
      "ROLE_REGIME_TARGET_UNDEFINED",
      null,
      null,
      context
    );
  }
  if (dependencyInputsIncomplete) {
    requireDerivedBlocker(
      blockerKeys,
      requiredBlockerKeys,
      "DEPENDENCY_INPUT_INCOMPLETE",
      null,
      null,
      context
    );
  }

  const combined = value.capacity.combined;
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    const target = value.targetMatrix.byRole[splitRole];
    const capacity = combined.byRole[splitRole];
    if (
      capacity.roleLocalUniqueEvidenceGroupCount <
      target.roleLocalUniqueMinimum
    ) {
      requireDerivedBlocker(
        blockerKeys,
        requiredBlockerKeys,
        "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
        splitRole,
        null,
        context
      );
    }
    if (
      capacity.roleExclusiveEvidenceGroupCount <
      target.roleExclusiveMinimum
    ) {
      requireDerivedBlocker(
        blockerKeys,
        requiredBlockerKeys,
        "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET",
        splitRole,
        null,
        context
      );
    }
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      const regimeTarget = target.byRegime[targetRegime];
      if (
        regimeTarget !== null &&
        capacity.byRegime[targetRegime] < regimeTarget
      ) {
        requireDerivedBlocker(
          blockerKeys,
          requiredBlockerKeys,
          "ROLE_REGIME_CAPACITY_BELOW_TARGET",
          splitRole,
          targetRegime,
          context
        );
      }
    }
  }

  if (tradingDateSetConflict) {
    requireDerivedBlocker(
      blockerKeys,
      requiredBlockerKeys,
      "TRADING_DATE_SET_CONFLICT",
      null,
      null,
      context
    );
  }

  for (const [index, blocker] of value.blockers.entries()) {
    if (
      DERIVED_BLOCKER_CODES.has(blocker.code) &&
      !requiredBlockerKeys.has(
        blockerKey(
          blocker.code,
          blocker.splitRole,
          blocker.targetRegime
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["blockers", index],
        message: "derived preflight blocker does not match artifact state"
      });
    }
  }
}

function validateBlockerStatus(
  value: PreflightArtifact,
  context: z.RefinementCtx
): void {
  const hasInvalidBlocker = value.blockers.some((blocker) =>
    INVALID_BLOCKER_CODES.has(blocker.code)
  );
  const expectedStatus = hasInvalidBlocker
    ? "invalid"
    : value.blockers.length > 0
      ? "inconclusive"
      : "ready_for_expansion_replay";
  if (value.status !== expectedStatus) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "preflight status must fail closed for blockers"
    });
  }
}

const DERIVED_BLOCKER_CODES = new Set<EvidenceExpansionPreflightBlockerCode>([
  "OFFICIAL_CALENDAR_EVIDENCE_MISSING",
  "ROLE_LOCAL_CAPACITY_BELOW_TARGET",
  "ROLE_EXCLUSIVE_CAPACITY_BELOW_TARGET",
  "ROLE_REGIME_TARGET_UNDEFINED",
  "ROLE_REGIME_CAPACITY_BELOW_TARGET",
  "DEPENDENCY_INPUT_INCOMPLETE",
  "TRADING_DATE_SET_CONFLICT"
]);

function requireDerivedBlocker(
  blockerKeys: ReadonlySet<string>,
  requiredBlockerKeys: Set<string>,
  code: EvidenceExpansionPreflightBlockerCode,
  splitRole: ValidationRole | null,
  targetRegime: TargetRegime | null,
  context: z.RefinementCtx
): void {
  const key = blockerKey(code, splitRole, targetRegime);
  requiredBlockerKeys.add(key);
  if (!blockerKeys.has(key)) {
    context.addIssue({
      code: "custom",
      path: ["blockers"],
      message: `preflight blockers must include ${code}`
    });
  }
}

function blockerKey(
  code: EvidenceExpansionPreflightBlockerCode,
  splitRole: ValidationRole | null,
  targetRegime: TargetRegime | null
): string {
  return `${code}:${splitRole ?? "*"}:${targetRegime ?? "*"}`;
}

function hasTradingDateSetConflict(value: PreflightArtifact): boolean {
  return value.dependencyInputs.candidateIntervals.some((interval) =>
    interval.sourceVariants.some(
      (variant) =>
        variant.observedTradingDatesHash !==
        interval.canonicalTradingDatesHash
    )
  );
}

function compareCandidateIntervals(
  left: PreflightArtifact["dependencyInputs"]["candidateIntervals"][number],
  right: PreflightArtifact["dependencyInputs"]["candidateIntervals"][number]
): number {
  return (
    compareRoleLists(left.splitRoles, right.splitRoles) ||
    VALIDATION_TARGET_REGIME_ORDER.indexOf(left.targetRegime) -
      VALIDATION_TARGET_REGIME_ORDER.indexOf(right.targetRegime) ||
    left.startAt.localeCompare(right.startAt) ||
    left.endAt.localeCompare(right.endAt) ||
    left.evidenceGroupHash.localeCompare(right.evidenceGroupHash) ||
    compareSourceVariantLists(left.sourceVariants, right.sourceVariants)
  );
}

function compareRoleLists(
  left: readonly ValidationRole[],
  right: readonly ValidationRole[]
): number {
  const comparableLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const difference =
      VALIDATION_ROLE_ORDER.indexOf(left[index]!) -
      VALIDATION_ROLE_ORDER.indexOf(right[index]!);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function compareSourceVariantLists(
  left: readonly EvidenceExpansionSourceVariantReference[],
  right: readonly EvidenceExpansionSourceVariantReference[]
): number {
  const comparableLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const difference = compareSourceVariants(left[index]!, right[index]!);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function compareSourceVariants(
  left: EvidenceExpansionSourceVariantReference,
  right: EvidenceExpansionSourceVariantReference
): number {
  return (
    left.sourceVariantHash.localeCompare(right.sourceVariantHash) ||
    left.feasibilityCandidateHash.localeCompare(
      right.feasibilityCandidateHash
    )
  );
}

function pairKey(leftHash: string, rightHash: string): string {
  return `${leftHash}:${rightHash}`;
}

function createRoleCounts(): Record<ValidationRole, number> {
  return {
    train: 0,
    validation: 0,
    test: 0
  };
}

function createRoleRegimeCounts(): Record<
  ValidationRole,
  Record<TargetRegime, number>
> {
  return {
    train: createRegimeCounts(),
    validation: createRegimeCounts(),
    test: createRegimeCounts()
  };
}

function createRegimeCounts(): Record<TargetRegime, number> {
  return {
    bull: 0,
    bear: 0,
    sideways: 0,
    mixed: 0
  };
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return (
    left.size === right.size &&
    Array.from(left).every((value) => right.has(value))
  );
}
