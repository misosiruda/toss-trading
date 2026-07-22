import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  feasibilityTargetRegimeSchema,
  validationSplitRegimeFeasibilityArtifactSchema,
  validationSplitRegimeFeasibilityStatusSchema,
  type ValidationSplitRegimeFeasibilityArtifact
} from "./validationSplitRegimeFeasibility.js";
import {
  validationSplitAssignmentSchema,
  validationSplitRoleSchema,
  type ValidationSplitAssignment,
  type ValidationSplitRole
} from "./validationProtocol.js";
import { validationRoleWindow } from "./validationRoleWindow.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const VALIDATION_ROLE_REGIME_REPLAY_PLAN_SCHEMA_VERSION =
  "validation_role_regime_replay_plan.v1";
export const VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION =
  "exhaustive_role_regime_candidates.v1";
export const VALIDATION_ROLE_REGIME_STATISTICAL_MINIMUM = 30;

export const VALIDATION_ROLE_ORDER = [
  "train",
  "validation",
  "test"
] as const;
export const VALIDATION_TARGET_REGIME_ORDER = [
  "bull",
  "bear",
  "sideways",
  "mixed"
] as const;

export const validationRoleRegimeReplayPlanStatusSchema = z.enum([
  "ready_for_paper_diagnostic",
  "insufficient",
  "invalid"
]);

export const validationRoleRegimeReplayPlanWarningCodeSchema = z.enum([
  "CROSS_ROLE_EVIDENCE_SHARED",
  "ROLE_REGIME_SINGLE_CANDIDATE",
  "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
  "CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY",
  "NON_TARGET_CANDIDATE_EXCLUDED"
]);

export const validationRoleRegimeReplayPlanWarningSchema = z
  .object({
    code: validationRoleRegimeReplayPlanWarningCodeSchema,
    message: z.string().trim().min(1),
    splitRole: validationSplitRoleSchema.nullable(),
    targetRegime: feasibilityTargetRegimeSchema.nullable(),
    candidateHash: sha256HashSchema.nullable()
  })
  .strict();

export const validationRoleRegimeReplayPlanAssignmentSchema =
  validationSplitAssignmentSchema;

const runKeySchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9_-]+$/, "runKey must be output-path safe");

const selectionRowFields = {
  planIndex: z.number().int().nonnegative(),
  runKey: runKeySchema,
  splitRole: validationSplitRoleSchema,
  targetRegime: feasibilityTargetRegimeSchema,
  candidateOrdinalWithinRoleRegime: z.number().int().nonnegative(),
  candidateHash: sha256HashSchema,
  startAt: isoDateTimeSchema,
  endAt: isoDateTimeSchema,
  sourceAssignments: z
    .array(validationRoleRegimeReplayPlanAssignmentSchema)
    .min(1),
  executionAssignment: validationRoleRegimeReplayPlanAssignmentSchema
} as const;

export const validationRoleRegimeReplaySelectionRowSchema = z
  .object(selectionRowFields)
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) > Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        message: "selection startAt must be before or equal to endAt"
      });
    }
  });

export const validationRoleRegimeReplayPlanRunSchema = z
  .object({
    ...selectionRowFields,
    evidenceGroupHash: sha256HashSchema,
    sharedAcrossRoles: z.boolean(),
    sharedRoles: z.array(validationSplitRoleSchema).min(1)
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.startAt) > Date.parse(value.endAt)) {
      context.addIssue({
        code: "custom",
        message: "plan run startAt must be before or equal to endAt"
      });
    }
  });

const roleRunCountsSchema = z
  .object({
    train: z.number().int().nonnegative(),
    validation: z.number().int().nonnegative(),
    test: z.number().int().nonnegative()
  })
  .strict();

export const validationRoleRegimeReplayPlanSchema = z
  .object({
    schemaVersion: z.literal(
      VALIDATION_ROLE_REGIME_REPLAY_PLAN_SCHEMA_VERSION
    ),
    mode: z.literal("paper_only"),
    purpose: z.literal("role_local_regime_diagnostic"),
    status: validationRoleRegimeReplayPlanStatusSchema,
    generatedAt: isoDateTimeSchema,
    source: z
      .object({
        feasibilitySchemaVersion: z.literal(
          "validation_split_regime_feasibility.v1"
        ),
        feasibilityArtifactHash: sha256HashSchema,
        feasibilityStatus: validationSplitRegimeFeasibilityStatusSchema,
        dataSnapshotHash: sha256HashSchema,
        universeHash: sha256HashSchema,
        coverageHash: sha256HashSchema,
        validationSplitHash: sha256HashSchema,
        calendarHash: sha256HashSchema,
        marketRegimeClassifierHash: sha256HashSchema
      })
      .strict(),
    config: z
      .object({
        selectionPolicyVersion: z.literal(
          VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION
        ),
        candidateStrategyBucket: z.literal("short_term"),
        targetRegimes: z.array(feasibilityTargetRegimeSchema).min(1),
        windowMonths: z.number().int().positive(),
        timezoneOffsetMinutes: z.number().int(),
        roleOrder: z.tuple([
          z.literal("train"),
          z.literal("validation"),
          z.literal("test")
        ]),
        regimeOrder: z.tuple([
          z.literal("bull"),
          z.literal("bear"),
          z.literal("sideways"),
          z.literal("mixed")
        ])
      })
      .strict(),
    summary: z
      .object({
        requiredRoleRegimeCellCount: z.number().int().nonnegative(),
        coveredRoleRegimeCellCount: z.number().int().nonnegative(),
        plannedRunCount: z.number().int().nonnegative(),
        globalUniqueEvidenceGroupCount: z.number().int().nonnegative(),
        crossRoleSharedEvidenceGroupCount: z.number().int().nonnegative(),
        nonTargetCandidateCount: z.number().int().nonnegative(),
        roleRunCounts: roleRunCountsSchema,
        roleRegimeRunCounts: z.record(
          z.string().trim().min(1),
          z.number().int().nonnegative()
        )
      })
      .strict(),
    runs: z.array(validationRoleRegimeReplayPlanRunSchema),
    warnings: z.array(validationRoleRegimeReplayPlanWarningSchema),
    planHash: sha256HashSchema
  })
  .strict();

export interface BuildExhaustiveValidationRoleRegimeSelectionOptions {
  feasibilityArtifact: ValidationSplitRegimeFeasibilityArtifact;
  validationAssignments: readonly ValidationSplitAssignment[];
}

export interface BuildValidationRoleRegimeReplayPlanOptions
  extends BuildExhaustiveValidationRoleRegimeSelectionOptions {
  generatedAt?: Date | string;
  calendarEvidenceClass: "observed_session_only";
}

export function buildExhaustiveValidationRoleRegimeSelection(
  options: BuildExhaustiveValidationRoleRegimeSelectionOptions
): ValidationRoleRegimeReplaySelectionRow[] {
  const feasibility = validationSplitRegimeFeasibilityArtifactSchema.parse(
    options.feasibilityArtifact
  );
  if (feasibility.status !== "available") {
    throw new Error("feasibility artifact must be available");
  }

  const targetRegimes = normalizeTargetRegimes(
    feasibility.config.targetRegimes
  );
  const sourceAssignments = indexSourceAssignments(
    options.validationAssignments
  );
  const selectedCandidates = new Map<string, SelectedCandidate>();
  const candidatePayloads = new Map<string, CandidatePayload>();

  for (const assignment of feasibility.assignments) {
    const sourceAssignment = sourceAssignments.get(
      assignmentKey(assignment)
    );
    if (sourceAssignment === undefined) {
      throw new Error(
        `validation assignment missing: ${assignment.splitId}/${assignment.splitRole}`
      );
    }
    assertAssignmentWindow(assignment, sourceAssignment);

    for (const candidate of assignment.candidates) {
      if (
        !candidate.scopeAvailable ||
        !isTargetRegime(candidate.regime, targetRegimes)
      ) {
        continue;
      }

      assertCandidatePayload(candidatePayloads, candidate);
      const selectedKey = `${assignment.splitRole}\u0000${candidate.candidateHash}`;
      const existing = selectedCandidates.get(selectedKey);
      if (existing !== undefined) {
        assertSameCandidate(existing, candidate);
        existing.sourceAssignments.set(
          assignmentKey(sourceAssignment),
          sourceAssignment
        );
        continue;
      }

      selectedCandidates.set(selectedKey, {
        splitRole: assignment.splitRole,
        targetRegime: candidate.regime,
        candidateHash: candidate.candidateHash,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        sourceAssignments: new Map([
          [assignmentKey(sourceAssignment), sourceAssignment]
        ])
      });
    }
  }

  const ordered = Array.from(selectedCandidates.values()).sort(
    compareSelectedCandidates
  );
  assertRequiredRoleRegimeCells(ordered, targetRegimes);

  const ordinals = new Map<string, number>();
  return ordered.map((candidate, planIndex) => {
    const ordinalKey = `${candidate.splitRole}\u0000${candidate.targetRegime}`;
    const candidateOrdinalWithinRoleRegime = ordinals.get(ordinalKey) ?? 0;
    ordinals.set(ordinalKey, candidateOrdinalWithinRoleRegime + 1);
    const assignments = Array.from(
      candidate.sourceAssignments.values()
    ).sort(compareValidationAssignments);

    return validationRoleRegimeReplaySelectionRowSchema.parse({
      planIndex,
      runKey: buildRunKey(candidate),
      splitRole: candidate.splitRole,
      targetRegime: candidate.targetRegime,
      candidateOrdinalWithinRoleRegime,
      candidateHash: candidate.candidateHash,
      startAt: candidate.startAt,
      endAt: candidate.endAt,
      sourceAssignments: assignments,
      executionAssignment: assignments[0]
    });
  });
}

export function buildValidationRoleRegimeReplayPlan(
  options: BuildValidationRoleRegimeReplayPlanOptions
): ValidationRoleRegimeReplayPlan {
  if (options.calendarEvidenceClass !== "observed_session_only") {
    throw new Error("calendar evidence class must be observed_session_only");
  }
  const feasibility = validationSplitRegimeFeasibilityArtifactSchema.parse(
    options.feasibilityArtifact
  );
  const selectionRows = buildExhaustiveValidationRoleRegimeSelection({
    feasibilityArtifact: feasibility,
    validationAssignments: options.validationAssignments
  });
  const sharedRolesByCandidate = candidateRoles(selectionRows);
  const runs = selectionRows.map((row) => {
    const sharedRoles = sharedRolesByCandidate.get(row.candidateHash)!;
    return validationRoleRegimeReplayPlanRunSchema.parse({
      ...row,
      evidenceGroupHash: row.candidateHash,
      sharedAcrossRoles: sharedRoles.length > 1,
      sharedRoles
    });
  });
  const targetRegimes = normalizeTargetRegimes(
    feasibility.config.targetRegimes
  );
  const summary = buildPlanSummary({
    runs,
    targetRegimes,
    nonTargetCandidateCount: countRoleLocalNonTargetCandidates(
      feasibility,
      targetRegimes
    )
  });
  const warnings = buildPlanWarnings(summary, runs);
  const planWithoutHash: Omit<ValidationRoleRegimeReplayPlan, "planHash"> = {
    schemaVersion: VALIDATION_ROLE_REGIME_REPLAY_PLAN_SCHEMA_VERSION,
    mode: "paper_only",
    purpose: "role_local_regime_diagnostic",
    status: "ready_for_paper_diagnostic",
    generatedAt: normalizeGeneratedAt(options.generatedAt),
    source: {
      feasibilitySchemaVersion: feasibility.schemaVersion,
      feasibilityArtifactHash:
        createValidationRoleRegimeFeasibilityArtifactHash(feasibility),
      feasibilityStatus: feasibility.status,
      ...feasibility.provenance
    },
    config: {
      selectionPolicyVersion:
        VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION,
      candidateStrategyBucket:
        feasibility.config.candidateStrategyBucket,
      targetRegimes,
      windowMonths: feasibility.config.windowMonths,
      timezoneOffsetMinutes: feasibility.config.timezoneOffsetMinutes,
      roleOrder: [...VALIDATION_ROLE_ORDER],
      regimeOrder: [...VALIDATION_TARGET_REGIME_ORDER]
    },
    summary,
    runs,
    warnings
  };
  const plan = {
    ...planWithoutHash,
    planHash: createValidationRoleRegimeReplayPlanHash(planWithoutHash)
  };
  return parseValidationRoleRegimeReplayPlan(plan);
}

export function createValidationRoleRegimeFeasibilityArtifactHash(
  value: unknown
): Sha256Hash {
  const artifact = validationSplitRegimeFeasibilityArtifactSchema.parse(value);
  return createReplayResearchHash(normalizeFeasibilityArtifact(artifact));
}

export function createValidationRoleRegimeReplayPlanHash(
  value:
    | ValidationRoleRegimeReplayPlan
    | Omit<ValidationRoleRegimeReplayPlan, "planHash">
): Sha256Hash {
  if ("planHash" in value) {
    const {
      generatedAt: _generatedAt,
      planHash: _planHash,
      ...payload
    } = value;
    return createReplayResearchHash(payload);
  }
  const { generatedAt: _generatedAt, ...payload } = value;
  return createReplayResearchHash(payload);
}

export function parseValidationRoleRegimeReplayPlan(
  value: unknown
): ValidationRoleRegimeReplayPlan {
  const plan = validationRoleRegimeReplayPlanSchema.parse(value);
  assertPlanContract(plan);
  if (plan.planHash !== createValidationRoleRegimeReplayPlanHash(plan)) {
    throw new Error("validation role-regime replay plan hash mismatch");
  }
  return plan;
}

export type ValidationRoleRegimeReplayPlan = z.infer<
  typeof validationRoleRegimeReplayPlanSchema
>;
export type ValidationRoleRegimeReplayPlanRun = z.infer<
  typeof validationRoleRegimeReplayPlanRunSchema
>;
export type ValidationRoleRegimeReplaySelectionRow = z.infer<
  typeof validationRoleRegimeReplaySelectionRowSchema
>;

type TargetRegime = z.infer<typeof feasibilityTargetRegimeSchema>;
type PlanSummary = ValidationRoleRegimeReplayPlan["summary"];
type PlanWarning = ValidationRoleRegimeReplayPlan["warnings"][number];
type FeasibilityWarning =
  ValidationSplitRegimeFeasibilityArtifact["warnings"][number];
type FeasibilityCandidate =
  ValidationSplitRegimeFeasibilityArtifact["assignments"][number]["candidates"][number];

interface CandidatePayload {
  startAt: string;
  endAt: string;
  regime: string;
  scopeAvailable: boolean;
}

interface SelectedCandidate {
  splitRole: ValidationSplitRole;
  targetRegime: TargetRegime;
  candidateHash: string;
  startAt: string;
  endAt: string;
  sourceAssignments: Map<string, ValidationSplitAssignment>;
}

function candidateRoles(
  rows: readonly ValidationRoleRegimeReplaySelectionRow[]
): Map<string, ValidationSplitRole[]> {
  const rolesByCandidate = new Map<string, Set<ValidationSplitRole>>();
  for (const row of rows) {
    const roles = rolesByCandidate.get(row.candidateHash) ?? new Set();
    roles.add(row.splitRole);
    rolesByCandidate.set(row.candidateHash, roles);
  }
  return new Map(
    Array.from(rolesByCandidate, ([candidateHash, roles]) => [
      candidateHash,
      Array.from(roles).sort((left, right) => roleIndex(left) - roleIndex(right))
    ])
  );
}

function buildPlanSummary(input: {
  runs: readonly ValidationRoleRegimeReplayPlanRun[];
  targetRegimes: readonly TargetRegime[];
  nonTargetCandidateCount: number;
}): PlanSummary {
  const roleRunCounts = { train: 0, validation: 0, test: 0 };
  const roleRegimeRunCounts: Record<string, number> = {};
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    for (const targetRegime of input.targetRegimes) {
      roleRegimeRunCounts[roleRegimeKey(splitRole, targetRegime)] = 0;
    }
  }
  for (const run of input.runs) {
    roleRunCounts[run.splitRole] += 1;
    const key = roleRegimeKey(run.splitRole, run.targetRegime);
    roleRegimeRunCounts[key] = (roleRegimeRunCounts[key] ?? 0) + 1;
  }

  const rolesByEvidenceGroup = new Map<string, Set<ValidationSplitRole>>();
  for (const run of input.runs) {
    const roles = rolesByEvidenceGroup.get(run.evidenceGroupHash) ?? new Set();
    roles.add(run.splitRole);
    rolesByEvidenceGroup.set(run.evidenceGroupHash, roles);
  }

  return {
    requiredRoleRegimeCellCount:
      VALIDATION_ROLE_ORDER.length * input.targetRegimes.length,
    coveredRoleRegimeCellCount: Object.values(roleRegimeRunCounts).filter(
      (count) => count > 0
    ).length,
    plannedRunCount: input.runs.length,
    globalUniqueEvidenceGroupCount: rolesByEvidenceGroup.size,
    crossRoleSharedEvidenceGroupCount: Array.from(
      rolesByEvidenceGroup.values()
    ).filter((roles) => roles.size > 1).length,
    nonTargetCandidateCount: input.nonTargetCandidateCount,
    roleRunCounts,
    roleRegimeRunCounts
  };
}

function buildPlanWarnings(
  summary: PlanSummary,
  runs: readonly ValidationRoleRegimeReplayPlanRun[]
): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const runsByCandidate = new Map<string, ValidationRoleRegimeReplayPlanRun[]>();
  for (const run of runs) {
    const grouped = runsByCandidate.get(run.candidateHash) ?? [];
    grouped.push(run);
    runsByCandidate.set(run.candidateHash, grouped);
  }
  for (const [candidateHash, grouped] of runsByCandidate) {
    if (new Set(grouped.map((run) => run.splitRole)).size > 1) {
      warnings.push({
        code: "CROSS_ROLE_EVIDENCE_SHARED",
        message: "candidate evidence is shared across validation roles",
        splitRole: null,
        targetRegime: grouped[0]!.targetRegime,
        candidateHash
      });
    }
  }

  for (const splitRole of VALIDATION_ROLE_ORDER) {
    for (const targetRegime of VALIDATION_TARGET_REGIME_ORDER) {
      const grouped = runs.filter(
        (run) =>
          run.splitRole === splitRole && run.targetRegime === targetRegime
      );
      if (grouped.length === 1) {
        warnings.push({
          code: "ROLE_REGIME_SINGLE_CANDIDATE",
          message: "role-regime cell has only one candidate",
          splitRole,
          targetRegime,
          candidateHash: grouped[0]!.candidateHash
        });
      }
    }
    if (
      summary.roleRunCounts[splitRole] <
      VALIDATION_ROLE_REGIME_STATISTICAL_MINIMUM
    ) {
      warnings.push({
        code: "ROLE_SAMPLE_BELOW_STATISTICAL_MINIMUM",
        message: "role-local sample count is below the statistical minimum",
        splitRole,
        targetRegime: null,
        candidateHash: null
      });
    }
  }

  warnings.push({
    code: "CALENDAR_EVIDENCE_OBSERVED_SESSION_ONLY",
    message: "calendar evidence is limited to observed sessions",
    splitRole: null,
    targetRegime: null,
    candidateHash: null
  });
  if (summary.nonTargetCandidateCount > 0) {
    warnings.push({
      code: "NON_TARGET_CANDIDATE_EXCLUDED",
      message: "non-target candidates were excluded from the replay plan",
      splitRole: null,
      targetRegime: null,
      candidateHash: null
    });
  }
  return warnings.sort(comparePlanWarnings);
}

function countRoleLocalNonTargetCandidates(
  feasibility: ValidationSplitRegimeFeasibilityArtifact,
  targetRegimes: readonly TargetRegime[]
): number {
  const candidates = new Set<string>();
  for (const assignment of feasibility.assignments) {
    for (const candidate of assignment.candidates) {
      if (
        candidate.scopeAvailable &&
        !isTargetRegime(candidate.regime, targetRegimes)
      ) {
        candidates.add(`${assignment.splitRole}\u0000${candidate.candidateHash}`);
      }
    }
  }
  return candidates.size;
}

function normalizeFeasibilityArtifact(
  artifact: ValidationSplitRegimeFeasibilityArtifact
): ValidationSplitRegimeFeasibilityArtifact {
  return {
    ...artifact,
    config: {
      ...artifact.config,
      targetRegimes: normalizeTargetRegimes(artifact.config.targetRegimes),
      calendarValidation: {
        rules: [...artifact.config.calendarValidation.rules].sort(
          compareCalendarRules
        )
      }
    },
    roles: artifact.roles
      .map((role) => ({
        ...role,
        availableTargetRegimes: normalizeTargetRegimes(
          role.availableTargetRegimes
        ),
        unavailableTargetRegimes: normalizeTargetRegimes(
          role.unavailableTargetRegimes
        ),
        warnings: [...role.warnings].sort(compareFeasibilityWarnings)
      }))
      .sort((left, right) => roleIndex(left.splitRole) - roleIndex(right.splitRole)),
    assignments: artifact.assignments
      .map((assignment) => ({
        ...assignment,
        availableTargetRegimes: normalizeTargetRegimes(
          assignment.availableTargetRegimes
        ),
        unavailableTargetRegimes: normalizeTargetRegimes(
          assignment.unavailableTargetRegimes
        ),
        candidates: [...assignment.candidates].sort(compareFeasibilityCandidates),
        warnings: [...assignment.warnings].sort(compareFeasibilityWarnings)
      }))
      .sort(compareFeasibilityAssignments),
    warnings: [...artifact.warnings].sort(compareFeasibilityWarnings)
  };
}

function assertPlanContract(plan: ValidationRoleRegimeReplayPlan): void {
  const targetRegimes = normalizeTargetRegimes(plan.config.targetRegimes);
  if (!sameStringArray(plan.config.targetRegimes, targetRegimes)) {
    throw new Error("plan targetRegimes must use canonical order");
  }
  if (plan.status !== "ready_for_paper_diagnostic") {
    if (plan.runs.length !== 0 || plan.summary.plannedRunCount !== 0) {
      throw new Error("non-ready plan must not contain replay runs");
    }
    return;
  }
  if (plan.source.feasibilityStatus !== "available") {
    throw new Error("ready plan requires available feasibility source");
  }

  const runKeys = new Set<string>();
  const ordinalByCell = new Map<string, number>();
  const candidatePayloads = new Map<string, CandidatePayload>();
  const rolesByCandidate = new Map<string, Set<ValidationSplitRole>>();
  const expectedOrder = [...plan.runs].sort(comparePlanRuns);
  if (!sameHash(plan.runs, expectedOrder)) {
    throw new Error("plan runs must use canonical order");
  }

  for (const [index, run] of plan.runs.entries()) {
    if (run.planIndex !== index) {
      throw new Error("planIndex must be zero-based and contiguous");
    }
    if (runKeys.has(run.runKey)) {
      throw new Error(`duplicate runKey: ${run.runKey}`);
    }
    runKeys.add(run.runKey);
    if (run.runKey !== buildRunKey(run)) {
      throw new Error(`runKey mismatch: ${run.runKey}`);
    }
    const cellKey = roleRegimeKey(run.splitRole, run.targetRegime);
    const expectedOrdinal = ordinalByCell.get(cellKey) ?? 0;
    if (run.candidateOrdinalWithinRoleRegime !== expectedOrdinal) {
      throw new Error(`candidate ordinal mismatch: ${run.runKey}`);
    }
    ordinalByCell.set(cellKey, expectedOrdinal + 1);
    if (run.evidenceGroupHash !== run.candidateHash) {
      throw new Error(`evidenceGroupHash mismatch: ${run.runKey}`);
    }
    assertCanonicalRunAssignments(run);
    assertPlanRunPayload(candidatePayloads, run);
    const roles = rolesByCandidate.get(run.candidateHash) ?? new Set();
    roles.add(run.splitRole);
    rolesByCandidate.set(run.candidateHash, roles);
  }

  for (const run of plan.runs) {
    const expectedRoles = Array.from(rolesByCandidate.get(run.candidateHash)!)
      .sort((left, right) => roleIndex(left) - roleIndex(right));
    if (!sameStringArray(run.sharedRoles, expectedRoles)) {
      throw new Error(`sharedRoles mismatch: ${run.runKey}`);
    }
    if (run.sharedAcrossRoles !== (expectedRoles.length > 1)) {
      throw new Error(`sharedAcrossRoles mismatch: ${run.runKey}`);
    }
  }

  const expectedSummary = buildPlanSummary({
    runs: plan.runs,
    targetRegimes,
    nonTargetCandidateCount: plan.summary.nonTargetCandidateCount
  });
  if (!sameHash(plan.summary, expectedSummary)) {
    throw new Error("plan summary does not match replay runs");
  }
  if (
    plan.summary.coveredRoleRegimeCellCount !==
    plan.summary.requiredRoleRegimeCellCount
  ) {
    throw new Error("ready plan must cover every required role-regime cell");
  }
  const expectedWarnings = buildPlanWarnings(expectedSummary, plan.runs);
  if (!sameHash(plan.warnings, expectedWarnings)) {
    throw new Error("plan warnings do not match replay runs and summary");
  }
}

function assertCanonicalRunAssignments(
  run: ValidationRoleRegimeReplayPlanRun
): void {
  const ordered = [...run.sourceAssignments].sort(compareValidationAssignments);
  if (!sameHash(run.sourceAssignments, ordered)) {
    throw new Error(`sourceAssignments must use canonical order: ${run.runKey}`);
  }
  const keys = new Set<string>();
  for (const assignment of run.sourceAssignments) {
    if (assignment.splitRole !== run.splitRole) {
      throw new Error(`source assignment role mismatch: ${run.runKey}`);
    }
    const key = assignmentKey(assignment);
    if (keys.has(key)) {
      throw new Error(`duplicate source assignment: ${run.runKey}`);
    }
    keys.add(key);
  }
  if (!sameHash(run.executionAssignment, run.sourceAssignments[0])) {
    throw new Error(`executionAssignment mismatch: ${run.runKey}`);
  }
}

function normalizeGeneratedAt(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("generatedAt must be a valid date");
  }
  return date.toISOString();
}

function normalizeTargetRegimes(regimes: readonly TargetRegime[]): TargetRegime[] {
  if (new Set(regimes).size !== regimes.length) {
    throw new Error("targetRegimes must not contain duplicates");
  }
  return VALIDATION_TARGET_REGIME_ORDER.filter((regime) =>
    regimes.includes(regime)
  );
}

function indexSourceAssignments(
  assignments: readonly ValidationSplitAssignment[]
): Map<string, ValidationSplitAssignment> {
  const indexed = new Map<string, ValidationSplitAssignment>();
  for (const value of assignments) {
    const assignment = validationSplitAssignmentSchema.parse(value);
    const key = assignmentKey(assignment);
    if (indexed.has(key)) {
      throw new Error(
        `duplicate validation assignment: ${assignment.splitId}/${assignment.splitRole}`
      );
    }
    indexed.set(key, assignment);
  }
  return indexed;
}

function assignmentKey(assignment: {
  splitId: string;
  splitIndex: number;
  splitRole: ValidationSplitRole;
}): string {
  return `${assignment.splitIndex}\u0000${assignment.splitId}\u0000${assignment.splitRole}`;
}

function assertAssignmentWindow(
  feasibilityAssignment: ValidationSplitRegimeFeasibilityArtifact["assignments"][number],
  sourceAssignment: ValidationSplitAssignment
): void {
  const sourceWindow = validationRoleWindow(sourceAssignment);
  if (
    feasibilityAssignment.roleStart !== sourceWindow.roleStart ||
    feasibilityAssignment.roleEnd !== sourceWindow.roleEnd ||
    feasibilityAssignment.effectiveRoleEnd !== sourceWindow.effectiveRoleEnd
  ) {
    throw new Error(
      `validation assignment boundary mismatch: ${feasibilityAssignment.splitId}/${feasibilityAssignment.splitRole}`
    );
  }
}

function isTargetRegime(
  regime: string,
  targetRegimes: readonly TargetRegime[]
): regime is TargetRegime {
  return targetRegimes.some((target) => target === regime);
}

function assertCandidatePayload(
  payloads: Map<string, CandidatePayload>,
  candidate: FeasibilityCandidate
): void {
  const payload = {
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    regime: candidate.regime,
    scopeAvailable: candidate.scopeAvailable
  };
  const existing = payloads.get(candidate.candidateHash);
  if (existing !== undefined && !samePayload(existing, payload)) {
    throw new Error(`candidateHash payload mismatch: ${candidate.candidateHash}`);
  }
  payloads.set(candidate.candidateHash, payload);
}

function assertPlanRunPayload(
  payloads: Map<string, CandidatePayload>,
  run: ValidationRoleRegimeReplayPlanRun
): void {
  const payload = {
    startAt: run.startAt,
    endAt: run.endAt,
    regime: run.targetRegime,
    scopeAvailable: true
  };
  const existing = payloads.get(run.candidateHash);
  if (existing !== undefined && !samePayload(existing, payload)) {
    throw new Error(`candidateHash payload mismatch: ${run.candidateHash}`);
  }
  payloads.set(run.candidateHash, payload);
}

function assertSameCandidate(
  existing: SelectedCandidate,
  candidate: FeasibilityCandidate
): void {
  if (
    existing.startAt !== candidate.startAt ||
    existing.endAt !== candidate.endAt ||
    existing.targetRegime !== candidate.regime
  ) {
    throw new Error(`candidateHash payload mismatch: ${candidate.candidateHash}`);
  }
}

function samePayload(left: CandidatePayload, right: CandidatePayload): boolean {
  return (
    left.startAt === right.startAt &&
    left.endAt === right.endAt &&
    left.regime === right.regime &&
    left.scopeAvailable === right.scopeAvailable
  );
}

function assertRequiredRoleRegimeCells(
  candidates: readonly SelectedCandidate[],
  targetRegimes: readonly TargetRegime[]
): void {
  for (const splitRole of VALIDATION_ROLE_ORDER) {
    for (const targetRegime of targetRegimes) {
      if (
        !candidates.some(
          (candidate) =>
            candidate.splitRole === splitRole &&
            candidate.targetRegime === targetRegime
        )
      ) {
        throw new Error(
          `required role-regime candidate missing: ${splitRole}/${targetRegime}`
        );
      }
    }
  }
}

function compareSelectedCandidates(
  left: SelectedCandidate,
  right: SelectedCandidate
): number {
  return (
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    regimeIndex(left.targetRegime) - regimeIndex(right.targetRegime) ||
    compareStrings(left.startAt, right.startAt) ||
    compareStrings(left.endAt, right.endAt) ||
    compareStrings(left.candidateHash, right.candidateHash)
  );
}

function compareValidationAssignments(
  left: ValidationSplitAssignment,
  right: ValidationSplitAssignment
): number {
  return (
    left.splitIndex - right.splitIndex ||
    compareStrings(left.splitId, right.splitId) ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole)
  );
}

function roleRegimeKey(
  splitRole: ValidationSplitRole,
  targetRegime: TargetRegime
): string {
  return `${splitRole}.${targetRegime}`;
}

function comparePlanRuns(
  left: ValidationRoleRegimeReplayPlanRun,
  right: ValidationRoleRegimeReplayPlanRun
): number {
  return (
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    regimeIndex(left.targetRegime) - regimeIndex(right.targetRegime) ||
    compareStrings(left.startAt, right.startAt) ||
    compareStrings(left.endAt, right.endAt) ||
    compareStrings(left.candidateHash, right.candidateHash)
  );
}

function comparePlanWarnings(left: PlanWarning, right: PlanWarning): number {
  return (
    compareStrings(left.code, right.code) ||
    compareNullableRoles(left.splitRole, right.splitRole) ||
    compareNullableRegimes(left.targetRegime, right.targetRegime) ||
    compareNullableStrings(left.candidateHash, right.candidateHash) ||
    compareStrings(left.message, right.message)
  );
}

function compareCalendarRules(
  left: ValidationSplitRegimeFeasibilityArtifact["config"]["calendarValidation"]["rules"][number],
  right: ValidationSplitRegimeFeasibilityArtifact["config"]["calendarValidation"]["rules"][number]
): number {
  return (
    compareStrings(left.market, right.market) ||
    compareStrings(left.exchange, right.exchange) ||
    compareStrings(left.timezone, right.timezone)
  );
}

function compareFeasibilityWarnings(
  left: FeasibilityWarning,
  right: FeasibilityWarning
): number {
  return (
    compareStrings(left.code, right.code) ||
    compareNullableRoles(left.splitRole, right.splitRole) ||
    compareNullableStrings(left.splitId, right.splitId) ||
    compareStrings(left.message, right.message)
  );
}

function compareFeasibilityCandidates(
  left: FeasibilityCandidate,
  right: FeasibilityCandidate
): number {
  return (
    compareStrings(left.startAt, right.startAt) ||
    compareStrings(left.endAt, right.endAt) ||
    feasibilityRegimeIndex(left.regime) - feasibilityRegimeIndex(right.regime) ||
    Number(left.scopeAvailable) - Number(right.scopeAvailable) ||
    compareStrings(left.candidateHash, right.candidateHash)
  );
}

function compareFeasibilityAssignments(
  left: ValidationSplitRegimeFeasibilityArtifact["assignments"][number],
  right: ValidationSplitRegimeFeasibilityArtifact["assignments"][number]
): number {
  return (
    left.splitIndex - right.splitIndex ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    compareStrings(left.splitId, right.splitId)
  );
}

function compareNullableRoles(
  left: ValidationSplitRole | null,
  right: ValidationSplitRole | null
): number {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? -1 : 1;
  }
  return roleIndex(left) - roleIndex(right);
}

function compareNullableRegimes(
  left: TargetRegime | null,
  right: TargetRegime | null
): number {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? -1 : 1;
  }
  return regimeIndex(left) - regimeIndex(right);
}

function compareNullableStrings(
  left: string | null,
  right: string | null
): number {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? -1 : 1;
  }
  return compareStrings(left, right);
}

function feasibilityRegimeIndex(
  regime: FeasibilityCandidate["regime"]
): number {
  return regime === "insufficient_data"
    ? VALIDATION_TARGET_REGIME_ORDER.length
    : regimeIndex(regime);
}

function sameHash(left: unknown, right: unknown): boolean {
  return createReplayResearchHash(left) === createReplayResearchHash(right);
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function buildRunKey(candidate: {
  splitRole: ValidationSplitRole;
  targetRegime: TargetRegime;
  candidateHash: string;
}): string {
  return [
    candidate.splitRole,
    candidate.targetRegime,
    candidate.candidateHash.replace(/^sha256:/, "")
  ].join("_");
}

function roleIndex(role: ValidationSplitRole): number {
  return VALIDATION_ROLE_ORDER.indexOf(role);
}

function regimeIndex(regime: TargetRegime): number {
  return VALIDATION_TARGET_REGIME_ORDER.indexOf(regime);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
