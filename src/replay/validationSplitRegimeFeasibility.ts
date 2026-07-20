import { z } from "zod";

import {
  DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG,
  MARKET_REGIME_CLASSIFIER_VERSION
} from "../analytics/marketRegimeClassifier.js";
import {
  isoDateTimeSchema,
  sha256HashSchema
} from "../domain/schemas.js";
import {
  replayWindowCandidates,
  type ReplayWindowCandidate
} from "./replayWindowSampler.js";
import {
  validationSplitRoleSchema,
  type ValidationSplitAssignment
} from "./validationProtocol.js";
import {
  validationRoleWindow,
  type ValidationRoleWindow
} from "./validationRoleWindow.js";

export const VALIDATION_SPLIT_REGIME_FEASIBILITY_SCHEMA_VERSION =
  "validation_split_regime_feasibility.v1";

export const feasibilityTargetRegimeSchema = z.enum([
  "bull",
  "bear",
  "sideways",
  "mixed"
]);
export const feasibilityRegimeSchema = z.enum([
  ...feasibilityTargetRegimeSchema.options,
  "insufficient_data"
]);
export const validationSplitRegimeFeasibilityStatusSchema = z.enum([
  "available",
  "insufficient",
  "invalid"
]);
export const validationSplitRegimeFeasibilityWarningSchema = z
  .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    splitId: z.string().trim().min(1).nullable(),
    splitRole: validationSplitRoleSchema.nullable()
  })
  .strict();

const regimeCountsSchema = z
  .object({
    bull: z.number().int().nonnegative(),
    bear: z.number().int().nonnegative(),
    sideways: z.number().int().nonnegative(),
    mixed: z.number().int().nonnegative(),
    insufficient_data: z.number().int().nonnegative()
  })
  .strict();
const roleCountsSchema = z
  .object({
    train: z.number().int().nonnegative(),
    validation: z.number().int().nonnegative(),
    test: z.number().int().nonnegative()
  })
  .strict();
const calendarRuleSchema = z
  .object({
    market: z.enum(["KR", "US"]),
    exchange: z.string().trim().min(1),
    timezone: z.enum(["Asia/Seoul", "America/New_York"])
  })
  .strict();
const marketRegimeClassifierConfigSchema = z
  .object({
    version: z.literal(MARKET_REGIME_CLASSIFIER_VERSION),
    minSymbols: z.number().int().positive(),
    minSnapshotsPerSymbol: z.number().int().positive(),
    bullReturnThreshold: z.number().finite(),
    bearReturnThreshold: z.number().finite(),
    sidewaysAbsReturnThreshold: z.number().finite().nonnegative(),
    breadthThreshold: z.number().finite().min(0).max(1)
  })
  .strict();
const candidateSchema = z
  .object({
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    regime: feasibilityRegimeSchema,
    scopeAvailable: z.boolean(),
    candidateHash: sha256HashSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) > Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        message: "candidate startAt must be before or equal to endAt"
      });
    }
  });
const assignmentSchema = z
  .object({
    splitId: z.string().trim().min(1),
    splitIndex: z.number().int().nonnegative(),
    splitRole: validationSplitRoleSchema,
    roleStart: isoDateTimeSchema,
    roleEnd: isoDateTimeSchema,
    effectiveRoleEnd: isoDateTimeSchema.nullable(),
    structuralCapacityCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    regimeCounts: regimeCountsSchema,
    availableTargetRegimes: z.array(feasibilityTargetRegimeSchema),
    unavailableTargetRegimes: z.array(feasibilityTargetRegimeSchema),
    candidates: z.array(candidateSchema),
    maximumPairwiseOverlapRatio: z.number().finite().min(0).max(1),
    calendarRejectedCandidateCount: z.number().int().nonnegative(),
    scopeUnavailableCandidateCount: z.number().int().nonnegative(),
    warnings: z.array(validationSplitRegimeFeasibilityWarningSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const roleStartMs = Date.parse(value.roleStart);
    const roleEndMs = Date.parse(value.roleEnd);
    const effectiveRoleEndMs = Date.parse(
      value.effectiveRoleEnd ?? value.roleEnd
    );
    if (roleStartMs > roleEndMs || effectiveRoleEndMs < roleStartMs) {
      context.addIssue({
        code: "custom",
        message: "assignment role range must be valid"
      });
    }
    if (effectiveRoleEndMs > roleEndMs) {
      context.addIssue({
        code: "custom",
        message: "effectiveRoleEnd must not exceed roleEnd"
      });
    }
    if (
      (value.splitRole === "train" && value.effectiveRoleEnd === null) ||
      (value.splitRole !== "train" && value.effectiveRoleEnd !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "effectiveRoleEnd must be present only for train role"
      });
    }
    if (value.candidateCount !== value.candidates.length) {
      context.addIssue({
        code: "custom",
        message: "candidateCount must match candidates length"
      });
    }
    if (
      value.scopeUnavailableCandidateCount !==
      value.candidates.filter((candidate) => !candidate.scopeAvailable).length
    ) {
      context.addIssue({
        code: "custom",
        message:
          "scopeUnavailableCandidateCount must match unavailable candidates"
      });
    }
    for (const candidate of value.candidates) {
      if (
        Date.parse(candidate.startAt) < roleStartMs ||
        Date.parse(candidate.endAt) > effectiveRoleEndMs
      ) {
        context.addIssue({
          code: "custom",
          message: "candidate must remain inside the effective role range"
        });
      }
    }
  });
const roleSchema = z
  .object({
    splitRole: validationSplitRoleSchema,
    assignmentCount: z.number().int().nonnegative(),
    structuralCapacityCount: z.number().int().nonnegative(),
    uniqueCandidateCount: z.number().int().nonnegative(),
    regimeCounts: regimeCountsSchema,
    availableTargetRegimes: z.array(feasibilityTargetRegimeSchema),
    unavailableTargetRegimes: z.array(feasibilityTargetRegimeSchema),
    minimumCandidatesPerRoleRegime: z.number().int().positive(),
    capacityStatus: z.enum(["sufficient", "insufficient"]),
    maximumPairwiseOverlapRatio: z.number().finite().min(0).max(1),
    warnings: z.array(validationSplitRegimeFeasibilityWarningSchema)
  })
  .strict();

const validationSplitRegimeFeasibilityArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(
      VALIDATION_SPLIT_REGIME_FEASIBILITY_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    status: validationSplitRegimeFeasibilityStatusSchema,
    generatedAt: isoDateTimeSchema,
    config: z
      .object({
        windowMonths: z.number().int().positive(),
        timezoneOffsetMinutes: z.number().int(),
        targetRegimes: z.array(feasibilityTargetRegimeSchema).min(1),
        candidateStrategyBucket: z.literal("short_term"),
        minimumCandidatesPerRoleRegime: z.number().int().positive(),
        calendarValidation: z
          .object({ rules: z.array(calendarRuleSchema).min(1) })
          .strict(),
        marketRegimeClassifier: marketRegimeClassifierConfigSchema
      })
      .strict(),
    provenance: z
      .object({
        dataSnapshotHash: sha256HashSchema,
        universeHash: sha256HashSchema,
        coverageHash: sha256HashSchema,
        validationSplitHash: sha256HashSchema,
        calendarHash: sha256HashSchema,
        marketRegimeClassifierHash: sha256HashSchema
      })
      .strict(),
    summary: z
      .object({
        assignmentCount: z.number().int().nonnegative(),
        roleCounts: roleCountsSchema,
        candidateCount: z.number().int().nonnegative(),
        uniqueCandidateCount: z.number().int().nonnegative(),
        roleCapacityCounts: roleCountsSchema,
        boundaryViolationCount: z.number().int().nonnegative(),
        embargoViolationCount: z.number().int().nonnegative(),
        unavailableRoleRegimeCount: z.number().int().nonnegative()
      })
      .strict(),
    roles: z.array(roleSchema),
    assignments: z.array(assignmentSchema),
    warnings: z.array(validationSplitRegimeFeasibilityWarningSchema)
  })
  .strict();

export const validationSplitRegimeFeasibilityArtifactSchema =
  validationSplitRegimeFeasibilityArtifactBaseSchema.superRefine(
    (value, context) => {
    if (value.summary.assignmentCount !== value.assignments.length) {
      context.addIssue({
        code: "custom",
        message: "summary assignmentCount must match assignments length"
      });
    }
    const roleCounts = { train: 0, validation: 0, test: 0 };
    for (const assignment of value.assignments) {
      roleCounts[assignment.splitRole] += 1;
    }
    if (
      value.summary.roleCounts.train !== roleCounts.train ||
      value.summary.roleCounts.validation !== roleCounts.validation ||
      value.summary.roleCounts.test !== roleCounts.test
    ) {
      context.addIssue({
        code: "custom",
        message: "summary roleCounts must match assignments"
      });
    }
    validateRoleAggregates(value, context);
    if (
      value.status === "available" &&
      (value.summary.assignmentCount === 0 ||
        value.summary.candidateCount === 0 ||
        value.summary.boundaryViolationCount !== 0 ||
        value.summary.embargoViolationCount !== 0 ||
        value.summary.unavailableRoleRegimeCount !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "available artifact must satisfy structural availability gates"
      });
    }
    }
  );

export interface ValidationRoleCandidateEnumeration {
  roleWindow: ValidationRoleWindow;
  structuralCapacityCount: number;
  candidates: ReplayWindowCandidate[];
  warnings: Array<
    z.infer<typeof validationSplitRegimeFeasibilityWarningSchema>
  >;
}

export function enumerateValidationRoleCandidates(input: {
  assignment: ValidationSplitAssignment;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): ValidationRoleCandidateEnumeration {
  const roleWindow = validationRoleWindow(input.assignment);
  const effectiveEnd = roleWindow.effectiveRoleEnd ?? roleWindow.roleEnd;
  const candidates = replayWindowCandidates({
    rangeStart: new Date(roleWindow.roleStart),
    rangeEnd: new Date(effectiveEnd),
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes
  });

  assertCandidatesInsideRole(candidates, roleWindow, effectiveEnd);
  return {
    roleWindow,
    structuralCapacityCount: candidates.length,
    candidates,
    warnings:
      candidates.length === 0
        ? [
            {
              code: "ROLE_FULL_WINDOW_CAPACITY_ZERO",
              message: "validation split role contains no full replay window",
              splitId: roleWindow.splitId,
              splitRole: roleWindow.splitRole
            }
          ]
        : []
  };
}

export function defaultMarketRegimeClassifierConfig() {
  return {
    version: MARKET_REGIME_CLASSIFIER_VERSION,
    ...DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG
  };
}

export type ValidationSplitRegimeFeasibilityArtifact = z.infer<
  typeof validationSplitRegimeFeasibilityArtifactSchema
>;

function assertCandidatesInsideRole(
  candidates: ReplayWindowCandidate[],
  roleWindow: ValidationRoleWindow,
  effectiveEnd: string
): void {
  const roleStartMs = Date.parse(roleWindow.roleStart);
  const roleEndMs = Date.parse(effectiveEnd);
  for (const candidate of candidates) {
    if (candidate.startMs < roleStartMs || candidate.endMs > roleEndMs) {
      throw new Error(
        "validation split candidate crosses role or embargo boundary"
      );
    }
  }
}

type FeasibilityArtifactValue = z.infer<
  typeof validationSplitRegimeFeasibilityArtifactBaseSchema
>;
type FeasibilityAssignment = FeasibilityArtifactValue["assignments"][number];
type FeasibilityCandidate = FeasibilityAssignment["candidates"][number];

function validateRoleAggregates(
  value: FeasibilityArtifactValue,
  context: z.RefinementCtx
): void {
  const assignmentsByRole = new Map<
    FeasibilityAssignment["splitRole"],
    FeasibilityAssignment[]
  >();
  for (const assignment of value.assignments) {
    const assignments = assignmentsByRole.get(assignment.splitRole) ?? [];
    assignments.push(assignment);
    assignmentsByRole.set(assignment.splitRole, assignments);
  }

  const rolesByName = new Map<
    FeasibilityArtifactValue["roles"][number]["splitRole"],
    FeasibilityArtifactValue["roles"][number]
  >();
  for (const role of value.roles) {
    if (rolesByName.has(role.splitRole)) {
      addAggregateIssue(context, `duplicate role aggregate: ${role.splitRole}`);
      continue;
    }
    rolesByName.set(role.splitRole, role);
  }

  let unavailableRoleRegimeCount = 0;
  for (const splitRole of validationSplitRoleSchema.options) {
    const assignments = assignmentsByRole.get(splitRole) ?? [];
    const role = rolesByName.get(splitRole);
    if (assignments.length === 0) {
      if (role !== undefined) {
        addAggregateIssue(
          context,
          `role aggregate has no assignments: ${splitRole}`
        );
      }
      continue;
    }
    if (role === undefined) {
      addAggregateIssue(context, `missing role aggregate: ${splitRole}`);
      unavailableRoleRegimeCount += value.config.targetRegimes.length;
      continue;
    }
    if (role.assignmentCount !== assignments.length) {
      addAggregateIssue(
        context,
        `role assignmentCount mismatch: ${splitRole}`
      );
    }
    if (
      role.minimumCandidatesPerRoleRegime !==
      value.config.minimumCandidatesPerRoleRegime
    ) {
      addAggregateIssue(
        context,
        `role minimum candidate count mismatch: ${splitRole}`
      );
    }

    const candidates = deduplicatedRoleCandidates(assignments, context);
    const regimeCounts = countCandidateRegimes(candidates.values());
    if (!sameRegimeCounts(role.regimeCounts, regimeCounts)) {
      addAggregateIssue(context, `role regimeCounts mismatch: ${splitRole}`);
    }
    if (role.uniqueCandidateCount !== candidates.size) {
      addAggregateIssue(
        context,
        `role uniqueCandidateCount mismatch: ${splitRole}`
      );
    }

    const availableTargetRegimes = value.config.targetRegimes.filter(
      (regime) =>
        regimeCounts[regime] >= value.config.minimumCandidatesPerRoleRegime
    );
    const unavailableTargetRegimes = value.config.targetRegimes.filter(
      (regime) => !availableTargetRegimes.includes(regime)
    );
    if (!sameRegimeSet(role.availableTargetRegimes, availableTargetRegimes)) {
      addAggregateIssue(
        context,
        `role availableTargetRegimes mismatch: ${splitRole}`
      );
    }
    if (
      !sameRegimeSet(
        role.unavailableTargetRegimes,
        unavailableTargetRegimes
      )
    ) {
      addAggregateIssue(
        context,
        `role unavailableTargetRegimes mismatch: ${splitRole}`
      );
    }
    unavailableRoleRegimeCount += unavailableTargetRegimes.length;

    const requiredCapacity =
      value.config.targetRegimes.length *
      value.config.minimumCandidatesPerRoleRegime;
    const expectedCapacityStatus =
      role.structuralCapacityCount >= requiredCapacity
        ? "sufficient"
        : "insufficient";
    if (role.capacityStatus !== expectedCapacityStatus) {
      addAggregateIssue(context, `role capacityStatus mismatch: ${splitRole}`);
    }
    if (
      value.summary.roleCapacityCounts[splitRole] !==
      role.structuralCapacityCount
    ) {
      addAggregateIssue(
        context,
        `summary roleCapacityCounts mismatch: ${splitRole}`
      );
    }
  }

  if (
    value.summary.unavailableRoleRegimeCount !==
    unavailableRoleRegimeCount
  ) {
    addAggregateIssue(
      context,
      "summary unavailableRoleRegimeCount must match role aggregates"
    );
  }
  if (
    value.status === "available" &&
    validationSplitRoleSchema.options.some(
      (splitRole) =>
        (assignmentsByRole.get(splitRole)?.length ?? 0) === 0 ||
        !rolesByName.has(splitRole)
    )
  ) {
    addAggregateIssue(
      context,
      "available artifact requires train, validation, and test aggregates"
    );
  }
}

function deduplicatedRoleCandidates(
  assignments: FeasibilityAssignment[],
  context: z.RefinementCtx
): Map<string, FeasibilityCandidate> {
  const candidates = new Map<string, FeasibilityCandidate>();
  for (const assignment of assignments) {
    for (const candidate of assignment.candidates) {
      if (!candidate.scopeAvailable) {
        continue;
      }
      const existing = candidates.get(candidate.candidateHash);
      if (existing !== undefined && !sameCandidate(existing, candidate)) {
        addAggregateIssue(
          context,
          `candidateHash payload mismatch: ${candidate.candidateHash}`
        );
        continue;
      }
      candidates.set(candidate.candidateHash, candidate);
    }
  }
  return candidates;
}

function countCandidateRegimes(candidates: Iterable<FeasibilityCandidate>) {
  const counts = {
    bull: 0,
    bear: 0,
    sideways: 0,
    mixed: 0,
    insufficient_data: 0
  };
  for (const candidate of candidates) {
    counts[candidate.regime] += 1;
  }
  return counts;
}

function sameRegimeCounts(
  left: z.infer<typeof regimeCountsSchema>,
  right: z.infer<typeof regimeCountsSchema>
): boolean {
  return feasibilityRegimeSchema.options.every(
    (regime) => left[regime] === right[regime]
  );
}

function sameRegimeSet(
  left: Array<z.infer<typeof feasibilityTargetRegimeSchema>>,
  right: Array<z.infer<typeof feasibilityTargetRegimeSchema>>
): boolean {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.length === right.length &&
    left.every((regime) => right.includes(regime))
  );
}

function sameCandidate(
  left: FeasibilityCandidate,
  right: FeasibilityCandidate
): boolean {
  return (
    left.startAt === right.startAt &&
    left.endAt === right.endAt &&
    left.regime === right.regime &&
    left.scopeAvailable === right.scopeAvailable
  );
}

function addAggregateIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: "custom", message });
}
