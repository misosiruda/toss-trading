import { z } from "zod";

import {
  classifyMarketRegime,
  DEFAULT_MARKET_REGIME_CLASSIFIER_CONFIG,
  MARKET_REGIME_CLASSIFIER_VERSION,
  type MarketRegimeLabel
} from "../analytics/marketRegimeClassifier.js";
import type {
  HistoricalMarketSnapshot,
  Sha256Hash
} from "../domain/schemas.js";
import {
  historicalMarketSnapshotSchema,
  isoDateTimeSchema,
  parseWithSchema,
  sha256HashSchema,
  strategyBucketSchema
} from "../domain/schemas.js";
import {
  assessHistoricalDataAvailability,
  type HistoricalDataAvailabilityCalendarOptions
} from "./historicalDataAvailability.js";
import {
  MarketCalendarFixtureIndex,
  parseMarketCalendarFixtures,
  type MarketCalendarFixture
} from "./marketCalendar.js";
import {
  replayWindowCandidates,
  type ReplayWindowCandidate
} from "./replayWindowSampler.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  validationSplitAssignmentSchema,
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
const calendarRulesSchema = z
  .array(calendarRuleSchema)
  .min(1)
  .superRefine((rules, context) => {
    const markets = new Set<string>();
    for (const [index, rule] of rules.entries()) {
      if (markets.has(rule.market)) {
        context.addIssue({
          code: "custom",
          message: `duplicate calendarValidation rule for market: ${rule.market}`
        });
      }
      markets.add(rule.market);
      if (
        index > 0 &&
        compareCalendarRules(rules[index - 1]!, rule) > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "calendarValidation rules must use canonical order"
        });
      }
    }
  });
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
const feasibilityCandidateHashInputSchema = z
  .object({
    startAt: isoDateTimeSchema,
    endAt: isoDateTimeSchema,
    timezoneOffsetMinutes: z.number().int(),
    windowMonths: z.number().int().positive(),
    calendarHash: sha256HashSchema,
    marketRegimeClassifierHash: sha256HashSchema,
    candidateStrategyBucket: z.literal("short_term"),
    scopeAvailable: z.boolean(),
    dataSnapshotHash: sha256HashSchema,
    universeHash: sha256HashSchema,
    coverageHash: sha256HashSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) > Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        message: "candidate hash startAt must be before or equal to endAt"
      });
    }
  });
const feasibilityCoverageGateSchema = z
  .object({
    status: z.literal("available"),
    corruptLineCount: z.literal(0),
    availableStrategyBuckets: z.array(strategyBucketSchema)
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!value.availableStrategyBuckets.includes("short_term")) {
      context.addIssue({
        code: "custom",
        message: "coverage must include available short_term strategy bucket"
      });
    }
  });
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
    if (
      value.structuralCapacityCount <
      value.candidateCount + value.calendarRejectedCandidateCount
    ) {
      context.addIssue({
        code: "custom",
        message:
          "structuralCapacityCount must cover candidates and calendar rejections"
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
          .object({ rules: calendarRulesSchema })
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
    validateAssignmentDiagnostics(value, context);
    validateSummaryCandidateCounts(value, context);
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

export interface ValidationRoleCandidateAssessment {
  startAt: string;
  endAt: string;
  regime: MarketRegimeLabel;
  scopeAvailable: boolean;
}

export interface ValidationRoleCandidateAvailabilityResult {
  roleWindow: ValidationRoleWindow;
  structuralCapacityCount: number;
  candidates: ValidationRoleCandidateAssessment[];
  calendarRejectedCandidateCount: number;
  scopeUnavailableCandidateCount: number;
  maximumPairwiseOverlapRatio: number;
  warnings: Array<
    z.infer<typeof validationSplitRegimeFeasibilityWarningSchema>
  >;
}

export interface ValidationSplitRegimeFeasibilityProvenanceInput {
  dataSnapshot: unknown;
  universe: unknown;
  coverage: unknown;
  validationSplit: unknown;
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
  marketRegimeClassifier: z.infer<
    typeof marketRegimeClassifierConfigSchema
  >;
}

export interface BuildValidationSplitRegimeFeasibilityArtifactOptions {
  generatedAt?: Date | string;
  assignments: ValidationSplitAssignment[];
  snapshots: HistoricalMarketSnapshot[];
  dataSnapshot: unknown;
  universe: unknown;
  coverage: unknown;
  validationSplit: unknown;
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
  windowMonths: number;
  timezoneOffsetMinutes: number;
  targetRegimes: Array<z.infer<typeof feasibilityTargetRegimeSchema>>;
  candidateStrategyBucket: "short_term";
  minimumCandidatesPerRoleRegime: number;
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

export function assessValidationRoleCandidateAvailability(input: {
  enumeration: ValidationRoleCandidateEnumeration;
  snapshots: HistoricalMarketSnapshot[];
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
  candidateStrategyBucket: "short_term";
  timezoneOffsetMinutes: number;
}): ValidationRoleCandidateAvailabilityResult {
  if (input.candidateStrategyBucket !== "short_term") {
    throw new Error("candidateStrategyBucket must be short_term");
  }
  if (!Number.isInteger(input.timezoneOffsetMinutes)) {
    throw new Error("timezoneOffsetMinutes must be an integer");
  }

  const candidates: ValidationRoleCandidateAssessment[] = [];
  const overlapCandidates: ReplayWindowCandidate[] = [];
  const warnings = [...input.enumeration.warnings];
  let calendarRejectedCandidateCount = 0;
  let scopeUnavailableCandidateCount = 0;

  for (const candidate of input.enumeration.candidates) {
    const windowStart = new Date(candidate.startMs);
    const windowEnd = new Date(candidate.endMs);
    const availability = assessHistoricalDataAvailability({
      snapshots: input.snapshots,
      windowStart,
      windowEnd,
      minWindowSnapshots: 0,
      calendarValidation: input.calendarValidation
    });
    if (
      (availability.calendarValidation?.rejectedSnapshotCount ?? 0) > 0
    ) {
      calendarRejectedCandidateCount += 1;
      warnings.push({
        code: "ROLE_CANDIDATE_CALENDAR_REJECTED",
        message: "validation role candidate failed calendar validation",
        splitId: input.enumeration.roleWindow.splitId,
        splitRole: input.enumeration.roleWindow.splitRole
      });
      continue;
    }

    overlapCandidates.push(candidate);
    const scopedSnapshotCount = input.snapshots.filter((snapshot) => {
      const observedAt = Date.parse(snapshot.observedAt);
      return (
        snapshot.strategyBucket === input.candidateStrategyBucket &&
        observedAt >= candidate.startMs &&
        observedAt <= candidate.endMs
      );
    }).length;
    const scopeAvailable = scopedSnapshotCount > 0;
    if (!scopeAvailable) {
      scopeUnavailableCandidateCount += 1;
      warnings.push({
        code: "ROLE_CANDIDATE_SCOPE_UNAVAILABLE",
        message: "validation role candidate has no scoped new-buy snapshot",
        splitId: input.enumeration.roleWindow.splitId,
        splitRole: input.enumeration.roleWindow.splitRole
      });
    }

    candidates.push({
      startAt: windowStart.toISOString(),
      endAt: windowEnd.toISOString(),
      regime: classifyMarketRegime({
        snapshots: input.snapshots,
        windowStart,
        windowEnd
      }).label,
      scopeAvailable
    });
  }

  return {
    roleWindow: input.enumeration.roleWindow,
    structuralCapacityCount: input.enumeration.structuralCapacityCount,
    candidates,
    calendarRejectedCandidateCount,
    scopeUnavailableCandidateCount,
    maximumPairwiseOverlapRatio:
      maximumPairwiseTradingDateOverlapRatio({
        candidates: overlapCandidates,
        snapshots: input.snapshots,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes
      }),
    warnings
  };
}

export function maximumPairwiseTradingDateOverlapRatio(input: {
  candidates: ReplayWindowCandidate[];
  snapshots: HistoricalMarketSnapshot[];
  timezoneOffsetMinutes: number;
}): number {
  if (!Number.isInteger(input.timezoneOffsetMinutes)) {
    throw new Error("timezoneOffsetMinutes must be an integer");
  }

  const tradingDates = input.candidates.map((candidate) =>
    candidateTradingDates({
      candidate,
      snapshots: input.snapshots,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    })
  );
  let maximumOverlapRatio = 0;
  for (let leftIndex = 0; leftIndex < tradingDates.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < tradingDates.length;
      rightIndex += 1
    ) {
      const left = tradingDates[leftIndex]!;
      const right = tradingDates[rightIndex]!;
      const intersectionCount = Array.from(left).filter((date) =>
        right.has(date)
      ).length;
      const unionCount = new Set([...left, ...right]).size;
      const overlapRatio =
        unionCount === 0 ? 0 : intersectionCount / unionCount;
      maximumOverlapRatio = Math.max(maximumOverlapRatio, overlapRatio);
    }
  }
  return roundOverlapRatio(maximumOverlapRatio);
}

export function createValidationSplitRegimeFeasibilityProvenance(
  input: ValidationSplitRegimeFeasibilityProvenanceInput
): FeasibilityArtifactValue["provenance"] {
  return {
    dataSnapshotHash: createReplayResearchHash(input.dataSnapshot),
    universeHash: createReplayResearchHash(input.universe),
    coverageHash: createReplayResearchHash(input.coverage),
    validationSplitHash: createReplayResearchHash(input.validationSplit),
    calendarHash: createValidationFeasibilityCalendarHash(
      input.calendarValidation
    ),
    marketRegimeClassifierHash:
      createValidationFeasibilityClassifierHash(
        input.marketRegimeClassifier
      )
  };
}

export function buildValidationSplitRegimeFeasibilityArtifact(
  options: BuildValidationSplitRegimeFeasibilityArtifactOptions
): ValidationSplitRegimeFeasibilityArtifact {
  const generatedAt = normalizeGeneratedAt(options.generatedAt);
  const assignments = options.assignments
    .map((assignment) =>
      parseWithSchema(
        validationSplitAssignmentSchema,
        assignment,
        "validation split assignment"
      )
    )
    .sort(compareValidationAssignments);
  assertUniqueValidationAssignments(assignments);
  const snapshots = options.snapshots.map((snapshot) =>
    parseWithSchema(
      historicalMarketSnapshotSchema,
      snapshot,
      "historical market snapshot"
    )
  );
  assertUniqueSnapshotIds(snapshots);
  const targetRegimes = normalizeTargetRegimes(options.targetRegimes);
  parseWithSchema(
    feasibilityCoverageGateSchema,
    options.coverage,
    "validation feasibility coverage gate"
  );
  const classifierConfig = defaultMarketRegimeClassifierConfig();
  const calendarRules = normalizeCalendarRules(
    options.calendarValidation.rules
  );
  const provenance = createValidationSplitRegimeFeasibilityProvenance({
    dataSnapshot: options.dataSnapshot,
    universe: options.universe,
    coverage: options.coverage,
    validationSplit: options.validationSplit,
    calendarValidation: options.calendarValidation,
    marketRegimeClassifier: classifierConfig
  });

  const assessedAssignments = assignments.map((assignment) => {
    const enumeration = enumerateValidationRoleCandidates({
      assignment,
      windowMonths: options.windowMonths,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes
    });
    const assessment = assessValidationRoleCandidateAvailability({
      enumeration,
      snapshots,
      calendarValidation: options.calendarValidation,
      candidateStrategyBucket: options.candidateStrategyBucket,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes
    });
    const candidates = assessment.candidates.map((candidate) => ({
      ...candidate,
      candidateHash: createValidationFeasibilityCandidateHash({
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        timezoneOffsetMinutes: options.timezoneOffsetMinutes,
        windowMonths: options.windowMonths,
        calendarHash: provenance.calendarHash,
        marketRegimeClassifierHash:
          provenance.marketRegimeClassifierHash,
        candidateStrategyBucket: options.candidateStrategyBucket,
        scopeAvailable: candidate.scopeAvailable,
        dataSnapshotHash: provenance.dataSnapshotHash,
        universeHash: provenance.universeHash,
        coverageHash: provenance.coverageHash
      })
    }));
    const scopedCandidates = candidates.filter(
      (candidate) => candidate.scopeAvailable
    );
    const regimeCounts = countCandidateRegimes(scopedCandidates);
    const availableTargetRegimes = targetRegimes.filter(
      (regime) => regimeCounts[regime] > 0
    );

    return {
      roleWindow: assessment.roleWindow,
      structuralWindows: enumeration.candidates,
      artifact: {
        splitId: assessment.roleWindow.splitId,
        splitIndex: assessment.roleWindow.splitIndex,
        splitRole: assessment.roleWindow.splitRole,
        roleStart: assessment.roleWindow.roleStart,
        roleEnd: assessment.roleWindow.roleEnd,
        effectiveRoleEnd: assessment.roleWindow.effectiveRoleEnd,
        structuralCapacityCount: assessment.structuralCapacityCount,
        candidateCount: candidates.length,
        regimeCounts,
        availableTargetRegimes,
        unavailableTargetRegimes: targetRegimes.filter(
          (regime) => !availableTargetRegimes.includes(regime)
        ),
        candidates,
        maximumPairwiseOverlapRatio:
          assessment.maximumPairwiseOverlapRatio,
        calendarRejectedCandidateCount:
          assessment.calendarRejectedCandidateCount,
        scopeUnavailableCandidateCount:
          assessment.scopeUnavailableCandidateCount,
        warnings: assessment.warnings
      }
    };
  });
  const artifactAssignments = assessedAssignments.map(
    (assignment) => assignment.artifact
  );
  const roles = validationSplitRoleSchema.options.flatMap((splitRole) => {
    const roleAssignments = assessedAssignments.filter(
      (assignment) => assignment.roleWindow.splitRole === splitRole
    );
    if (roleAssignments.length === 0) {
      return [];
    }
    const candidates = deduplicateCandidates(
      roleAssignments.flatMap((assignment) =>
        assignment.artifact.candidates.filter(
          (candidate) => candidate.scopeAvailable
        )
      )
    );
    const regimeCounts = countCandidateRegimes(candidates.values());
    const availableTargetRegimes = targetRegimes.filter(
      (regime) =>
        regimeCounts[regime] >= options.minimumCandidatesPerRoleRegime
    );
    const structuralWindows = deduplicateReplayWindows(
      roleAssignments.flatMap((assignment) => assignment.structuralWindows)
    );
    const overlapCandidates = deduplicateReplayWindows(
      roleAssignments.flatMap((assignment) =>
        assignment.artifact.candidates.map((candidate) =>
          replayCandidateFromArtifact(candidate)
        )
      )
    );
    const structuralCapacityCount = structuralWindows.length;
    const requiredCapacity =
      targetRegimes.length * options.minimumCandidatesPerRoleRegime;

    return [
      {
        splitRole,
        assignmentCount: roleAssignments.length,
        structuralCapacityCount,
        uniqueCandidateCount: candidates.size,
        regimeCounts,
        availableTargetRegimes,
        unavailableTargetRegimes: targetRegimes.filter(
          (regime) => !availableTargetRegimes.includes(regime)
        ),
        minimumCandidatesPerRoleRegime:
          options.minimumCandidatesPerRoleRegime,
        capacityStatus:
          structuralCapacityCount >= requiredCapacity
            ? ("sufficient" as const)
            : ("insufficient" as const),
        maximumPairwiseOverlapRatio:
          maximumPairwiseTradingDateOverlapRatio({
            candidates: overlapCandidates,
            snapshots,
            timezoneOffsetMinutes: options.timezoneOffsetMinutes
          }),
        warnings: roleAssignments.flatMap(
          (assignment) => assignment.artifact.warnings
        )
      }
    ];
  });
  const roleCounts = countAssignmentRoles(artifactAssignments);
  const roleCapacityCounts = emptyRoleCounts();
  for (const role of roles) {
    roleCapacityCounts[role.splitRole] = role.structuralCapacityCount;
  }
  const uniqueCandidates = deduplicateCandidates(
    artifactAssignments.flatMap((assignment) =>
      assignment.candidates.filter((candidate) => candidate.scopeAvailable)
    )
  );
  const unavailableRoleRegimeCount = roles.reduce(
    (total, role) => total + role.unavailableTargetRegimes.length,
    0
  );
  const hasAllRoles = validationSplitRoleSchema.options.every(
    (splitRole) => roleCounts[splitRole] > 0
  );
  const status =
    assignments.length > 0 &&
    uniqueCandidates.size > 0 &&
    hasAllRoles &&
    roles.every(
      (role) =>
        role.capacityStatus === "sufficient" &&
        role.unavailableTargetRegimes.length === 0
    )
      ? "available"
      : "insufficient";
  const warnings = artifactAssignments.flatMap(
    (assignment) => assignment.warnings
  );

  return parseWithSchema(
    validationSplitRegimeFeasibilityArtifactSchema,
    {
      schemaVersion: VALIDATION_SPLIT_REGIME_FEASIBILITY_SCHEMA_VERSION,
      mode: "paper_only",
      status,
      generatedAt,
      config: {
        windowMonths: options.windowMonths,
        timezoneOffsetMinutes: options.timezoneOffsetMinutes,
        targetRegimes,
        candidateStrategyBucket: options.candidateStrategyBucket,
        minimumCandidatesPerRoleRegime:
          options.minimumCandidatesPerRoleRegime,
        calendarValidation: { rules: calendarRules },
        marketRegimeClassifier: classifierConfig
      },
      provenance,
      summary: {
        assignmentCount: artifactAssignments.length,
        roleCounts,
        candidateCount: artifactAssignments.reduce(
          (total, assignment) => total + assignment.candidateCount,
          0
        ),
        uniqueCandidateCount: uniqueCandidates.size,
        roleCapacityCounts,
        boundaryViolationCount: 0,
        embargoViolationCount: 0,
        unavailableRoleRegimeCount
      },
      roles,
      assignments: artifactAssignments,
      warnings
    },
    "validation split regime feasibility artifact"
  );
}

export function createValidationFeasibilityCalendarHash(
  input: HistoricalDataAvailabilityCalendarOptions
): Sha256Hash {
  const rules = normalizeCalendarRules(input.rules);

  const fixtures = parseMarketCalendarFixtures(input.fixtures);
  new MarketCalendarFixtureIndex(fixtures);
  return createReplayResearchHash({
    rules,
    fixtures: fixtures
      .map(normalizeCalendarFixtureForHash)
      .sort(compareCalendarFixtures)
  });
}

export function createValidationFeasibilityClassifierHash(
  input: z.infer<typeof marketRegimeClassifierConfigSchema>
): Sha256Hash {
  return createReplayResearchHash(
    marketRegimeClassifierConfigSchema.parse(input)
  );
}

export function createValidationFeasibilityCandidateHash(
  input: z.infer<typeof feasibilityCandidateHashInputSchema>
): Sha256Hash {
  return createReplayResearchHash(
    feasibilityCandidateHashInputSchema.parse(input)
  );
}

function normalizeCalendarFixtureForHash(
  fixture: MarketCalendarFixture
) {
  return {
    calendarId: fixture.calendarId,
    exchange: fixture.exchange,
    market: fixture.market,
    timezone: fixture.timezone,
    sessionDate: fixture.sessionDate,
    marketOpen: fixture.marketOpen,
    marketClose: fixture.marketClose,
    isHoliday: fixture.isHoliday,
    holidayName: fixture.holidayName ?? null,
    sourceRefs: [...fixture.sourceRefs].sort(compareCanonicalStrings),
    createdAt: fixture.createdAt
  };
}

function compareCalendarFixtures(
  left: ReturnType<typeof normalizeCalendarFixtureForHash>,
  right: ReturnType<typeof normalizeCalendarFixtureForHash>
): number {
  return (
    compareCanonicalStrings(left.market, right.market) ||
    compareCanonicalStrings(left.exchange, right.exchange) ||
    compareCanonicalStrings(left.sessionDate, right.sessionDate) ||
    compareCanonicalStrings(left.calendarId, right.calendarId)
  );
}

function normalizeCalendarRules(
  input: HistoricalDataAvailabilityCalendarOptions["rules"]
): Array<z.infer<typeof calendarRuleSchema>> {
  const rules = input.map((rule) => calendarRuleSchema.parse(rule));
  const markets = new Set<string>();
  for (const rule of rules) {
    if (markets.has(rule.market)) {
      throw new Error(
        `duplicate calendarValidation rule for market: ${rule.market}`
      );
    }
    markets.add(rule.market);
  }
  return [...rules].sort(compareCalendarRules);
}

function normalizeTargetRegimes(
  input: BuildValidationSplitRegimeFeasibilityArtifactOptions["targetRegimes"]
): Array<z.infer<typeof feasibilityTargetRegimeSchema>> {
  const regimes = input.map((regime) =>
    feasibilityTargetRegimeSchema.parse(regime)
  );
  if (regimes.length === 0) {
    throw new Error("targetRegimes must not be empty");
  }
  if (new Set(regimes).size !== regimes.length) {
    throw new Error("targetRegimes must not contain duplicates");
  }
  const requested = new Set(regimes);
  return feasibilityTargetRegimeSchema.options.filter((regime) =>
    requested.has(regime)
  );
}

function normalizeGeneratedAt(value: Date | string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new Error("generatedAt must be a valid date");
    }
    return value.toISOString();
  }
  return isoDateTimeSchema.parse(value);
}

function compareValidationAssignments(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): number {
  return (
    left.splitIndex - right.splitIndex ||
    validationSplitRoleSchema.options.indexOf(left.splitRole) -
      validationSplitRoleSchema.options.indexOf(right.splitRole) ||
    compareCanonicalStrings(left.splitId, right.splitId)
  );
}

function assertUniqueValidationAssignments(
  assignments: ValidationSplitAssignment[]
): void {
  const identities = new Set<string>();
  const splitIdsByIndex = new Map<number, string>();
  const splitIndexesById = new Map<string, number>();
  for (const assignment of assignments) {
    const identity = `${assignment.splitIndex}:${assignment.splitId}:${assignment.splitRole}`;
    if (identities.has(identity)) {
      throw new Error(`duplicate validation assignment: ${identity}`);
    }
    const splitId = splitIdsByIndex.get(assignment.splitIndex);
    if (splitId !== undefined && splitId !== assignment.splitId) {
      throw new Error(
        `validation splitIndex maps to multiple splitIds: ${assignment.splitIndex}`
      );
    }
    const splitIndex = splitIndexesById.get(assignment.splitId);
    if (splitIndex !== undefined && splitIndex !== assignment.splitIndex) {
      throw new Error(
        `validation splitId maps to multiple splitIndexes: ${assignment.splitId}`
      );
    }
    identities.add(identity);
    splitIdsByIndex.set(assignment.splitIndex, assignment.splitId);
    splitIndexesById.set(assignment.splitId, assignment.splitIndex);
  }
}

function assertUniqueSnapshotIds(
  snapshots: HistoricalMarketSnapshot[]
): void {
  const snapshotIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshotIds.has(snapshot.snapshotId)) {
      throw new Error(`duplicate historical snapshotId: ${snapshot.snapshotId}`);
    }
    snapshotIds.add(snapshot.snapshotId);
  }
}

function countAssignmentRoles(
  assignments: FeasibilityAssignment[]
): Record<z.infer<typeof validationSplitRoleSchema>, number> {
  const counts = emptyRoleCounts();
  for (const assignment of assignments) {
    counts[assignment.splitRole] += 1;
  }
  return counts;
}

function emptyRoleCounts(): Record<
  z.infer<typeof validationSplitRoleSchema>,
  number
> {
  return { train: 0, validation: 0, test: 0 };
}

function deduplicateCandidates(
  candidates: FeasibilityCandidate[]
): Map<string, FeasibilityCandidate> {
  const unique = new Map<string, FeasibilityCandidate>();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.candidateHash);
    if (existing !== undefined && !sameCandidate(existing, candidate)) {
      throw new Error(
        `candidateHash payload mismatch: ${candidate.candidateHash}`
      );
    }
    unique.set(candidate.candidateHash, candidate);
  }
  return unique;
}

function deduplicateReplayWindows(
  candidates: ReplayWindowCandidate[]
): ReplayWindowCandidate[] {
  const unique = new Map<string, ReplayWindowCandidate>();
  for (const candidate of candidates) {
    unique.set(`${candidate.startMs}:${candidate.endMs}`, candidate);
  }
  return Array.from(unique.values()).sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs
  );
}

function replayCandidateFromArtifact(
  candidate: FeasibilityCandidate
): ReplayWindowCandidate {
  return {
    selectedMonth: candidate.startAt.slice(0, 7),
    localStartDate: candidate.startAt.slice(0, 10),
    localEndDate: candidate.endAt.slice(0, 10),
    startMs: Date.parse(candidate.startAt),
    endMs: Date.parse(candidate.endAt)
  };
}

function candidateTradingDates(input: {
  candidate: ReplayWindowCandidate;
  snapshots: HistoricalMarketSnapshot[];
  timezoneOffsetMinutes: number;
}): Set<string> {
  const dates = new Set<string>();
  for (const snapshot of input.snapshots) {
    const observedAt = Date.parse(snapshot.observedAt);
    if (
      observedAt < input.candidate.startMs ||
      observedAt > input.candidate.endMs
    ) {
      continue;
    }
    dates.add(
      new Date(observedAt + input.timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 10)
    );
  }
  return dates;
}

function roundOverlapRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function defaultMarketRegimeClassifierConfig(): z.infer<
  typeof marketRegimeClassifierConfigSchema
> {
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

function compareCalendarRules(
  left: z.infer<typeof calendarRuleSchema>,
  right: z.infer<typeof calendarRuleSchema>
): number {
  return (
    compareCanonicalStrings(left.market, right.market) ||
    compareCanonicalStrings(left.exchange, right.exchange) ||
    compareCanonicalStrings(left.timezone, right.timezone)
  );
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateAssignmentDiagnostics(
  value: FeasibilityArtifactValue,
  context: z.RefinementCtx
): void {
  for (const assignment of value.assignments) {
    const scopedCandidates = assignment.candidates.filter(
      (candidate) => candidate.scopeAvailable
    );
    const regimeCounts = countCandidateRegimes(scopedCandidates);
    if (!sameRegimeCounts(assignment.regimeCounts, regimeCounts)) {
      addAggregateIssue(
        context,
        `assignment regimeCounts mismatch: ${assignment.splitId}/${assignment.splitRole}`
      );
    }

    const availableTargetRegimes = value.config.targetRegimes.filter(
      (regime) => regimeCounts[regime] > 0
    );
    const unavailableTargetRegimes = value.config.targetRegimes.filter(
      (regime) => !availableTargetRegimes.includes(regime)
    );
    if (
      !sameRegimeSet(
        assignment.availableTargetRegimes,
        availableTargetRegimes
      )
    ) {
      addAggregateIssue(
        context,
        `assignment availableTargetRegimes mismatch: ${assignment.splitId}/${assignment.splitRole}`
      );
    }
    if (
      !sameRegimeSet(
        assignment.unavailableTargetRegimes,
        unavailableTargetRegimes
      )
    ) {
      addAggregateIssue(
        context,
        `assignment unavailableTargetRegimes mismatch: ${assignment.splitId}/${assignment.splitRole}`
      );
    }
  }
}

function validateSummaryCandidateCounts(
  value: FeasibilityArtifactValue,
  context: z.RefinementCtx
): void {
  const candidateCount = value.assignments.reduce(
    (total, assignment) => total + assignment.candidates.length,
    0
  );
  if (value.summary.candidateCount !== candidateCount) {
    addAggregateIssue(
      context,
      "summary candidateCount must match assignment candidates"
    );
  }

  const uniqueCandidates = deduplicatedRoleCandidates(
    value.assignments,
    context
  );
  if (value.summary.uniqueCandidateCount !== uniqueCandidates.size) {
    addAggregateIssue(
      context,
      "summary uniqueCandidateCount must match scoped assignment candidates"
    );
  }
}

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
    if (role.structuralCapacityCount < candidates.size) {
      addAggregateIssue(
        context,
        `role structuralCapacityCount is below unique candidates: ${splitRole}`
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
    if (value.status === "available" && role.capacityStatus !== "sufficient") {
      addAggregateIssue(
        context,
        `available artifact requires sufficient role capacity: ${splitRole}`
      );
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
  const hashesByPayload = new Map<string, string>();
  for (const assignment of assignments) {
    for (const candidate of assignment.candidates) {
      if (!candidate.scopeAvailable) {
        continue;
      }
      const payloadKey = candidatePayloadKey(candidate);
      const payloadHash = hashesByPayload.get(payloadKey);
      if (
        payloadHash !== undefined &&
        payloadHash !== candidate.candidateHash
      ) {
        addAggregateIssue(
          context,
          `candidate payload has multiple hashes: ${candidate.startAt}/${candidate.endAt}`
        );
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
      hashesByPayload.set(payloadKey, candidate.candidateHash);
      candidates.set(candidate.candidateHash, candidate);
    }
  }
  return candidates;
}

function candidatePayloadKey(candidate: FeasibilityCandidate): string {
  return JSON.stringify([
    candidate.startAt,
    candidate.endAt,
    candidate.regime,
    candidate.scopeAvailable
  ]);
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
