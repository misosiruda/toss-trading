import { z } from "zod";

import {
  isoDateTimeSchema,
  sha256HashSchema
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

export const VALIDATION_ROLE_REGIME_REPLAY_PLAN_SCHEMA_VERSION =
  "validation_role_regime_replay_plan.v1";
export const VALIDATION_ROLE_REGIME_SELECTION_POLICY_VERSION =
  "exhaustive_role_regime_candidates.v1";

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

function buildRunKey(candidate: SelectedCandidate): string {
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
