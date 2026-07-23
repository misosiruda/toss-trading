import type { Sha256Hash } from "../domain/schemas.js";
import {
  createValidationFeasibilityCandidateHash,
  validationSplitRegimeFeasibilityArtifactSchema,
  type ValidationSplitRegimeFeasibilityArtifact
} from "./validationSplitRegimeFeasibility.js";
import {
  createValidationRoleRegimeFeasibilityArtifactHash,
  parseValidationRoleRegimeReplayPlan,
  type ValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import {
  buildValidationRoleRegimeStatisticalReadinessArtifact,
  validationRoleRegimeStatisticalReadinessArtifactSchema,
  type ValidationRoleRegimeStatisticalReadinessBlocker,
  type ValidationRoleRegimeStatisticalReadinessArtifact
} from "./validationRoleRegimeStatisticalReadiness.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import { validationRoleWindow } from "./validationRoleWindow.js";

export interface VerifyValidationRoleRegimeEvidenceExpansionBaselineOptions {
  feasibilityArtifact: unknown;
  planArtifact: unknown;
  readinessArtifact: unknown;
}

export interface VerifiedValidationRoleRegimeEvidenceExpansionBaseline {
  feasibility: ValidationSplitRegimeFeasibilityArtifact;
  plan: ValidationRoleRegimeReplayPlan;
  readiness: ValidationRoleRegimeStatisticalReadinessArtifact;
  hashes: {
    baselineFeasibilityArtifactHash: Sha256Hash;
    baselinePlanHash: Sha256Hash;
    baselineReadinessArtifactHash: Sha256Hash;
  };
}

export function verifyValidationRoleRegimeEvidenceExpansionBaseline(
  options: VerifyValidationRoleRegimeEvidenceExpansionBaselineOptions
): VerifiedValidationRoleRegimeEvidenceExpansionBaseline {
  const feasibility = validationSplitRegimeFeasibilityArtifactSchema.parse(
    options.feasibilityArtifact
  );
  const plan = parseValidationRoleRegimeReplayPlan(options.planArtifact);
  const readiness =
    validationRoleRegimeStatisticalReadinessArtifactSchema.parse(
      options.readinessArtifact
    );
  assertBaselineStatusesAreUsable(feasibility, plan, readiness);
  assertFeasibilityCandidateHashes(feasibility);
  const feasibilityArtifactHash =
    createValidationRoleRegimeFeasibilityArtifactHash(feasibility);

  assertPlanMatchesFeasibility(plan, feasibility, feasibilityArtifactHash);
  assertReadinessMatchesPlan(readiness, plan);

  return {
    feasibility,
    plan,
    readiness,
    hashes: {
      baselineFeasibilityArtifactHash: feasibilityArtifactHash,
      baselinePlanHash: plan.planHash,
      baselineReadinessArtifactHash:
        createValidationRoleRegimeStatisticalReadinessArtifactHash(readiness)
    }
  };
}

export function createValidationRoleRegimeStatisticalReadinessArtifactHash(
  value: ValidationRoleRegimeStatisticalReadinessArtifact
): Sha256Hash {
  const artifact =
    validationRoleRegimeStatisticalReadinessArtifactSchema.parse(value);
  const { generatedAt: _generatedAt, ...payload } = artifact;
  return createReplayResearchHash({
    ...payload,
    blockers: [...payload.blockers].sort(compareReadinessBlockers)
  });
}

function assertBaselineStatusesAreUsable(
  feasibility: ValidationSplitRegimeFeasibilityArtifact,
  plan: ValidationRoleRegimeReplayPlan,
  readiness: ValidationRoleRegimeStatisticalReadinessArtifact
): void {
  if (feasibility.status === "invalid") {
    throw new Error("baseline feasibility status must not be invalid");
  }
  if (plan.status === "invalid") {
    throw new Error("baseline plan status must not be invalid");
  }
  if (readiness.status === "invalid") {
    throw new Error("baseline readiness status must not be invalid");
  }
}

function assertPlanMatchesFeasibility(
  plan: ValidationRoleRegimeReplayPlan,
  feasibility: ValidationSplitRegimeFeasibilityArtifact,
  feasibilityArtifactHash: Sha256Hash
): void {
  if (
    plan.source.feasibilitySchemaVersion !== feasibility.schemaVersion ||
    plan.source.feasibilityArtifactHash !== feasibilityArtifactHash ||
    plan.source.feasibilityStatus !== feasibility.status
  ) {
    throw new Error("baseline plan does not match feasibility identity");
  }

  for (const key of [
    "dataSnapshotHash",
    "universeHash",
    "coverageHash",
    "validationSplitHash",
    "calendarHash",
    "marketRegimeClassifierHash"
  ] as const) {
    if (plan.source[key] !== feasibility.provenance[key]) {
      throw new Error(`baseline plan provenance mismatch: ${key}`);
    }
  }

  if (
    plan.config.candidateStrategyBucket !==
      feasibility.config.candidateStrategyBucket ||
    plan.config.windowMonths !== feasibility.config.windowMonths ||
    plan.config.timezoneOffsetMinutes !==
      feasibility.config.timezoneOffsetMinutes ||
    !sameStrings(plan.config.targetRegimes, feasibility.config.targetRegimes)
  ) {
    throw new Error("baseline plan config does not match feasibility config");
  }

  assertPlanRunsMatchFeasibility(plan, feasibility);
}

function assertReadinessMatchesPlan(
  readiness: ValidationRoleRegimeStatisticalReadinessArtifact,
  plan: ValidationRoleRegimeReplayPlan
): void {
  if (readiness.source.planHash !== plan.planHash) {
    throw new Error("baseline readiness does not match plan identity");
  }

  const expectedCounts = readiness.provenance.expectedCounts;
  if (
    expectedCounts.plannedRunCount !== plan.summary.plannedRunCount ||
    expectedCounts.globalUniqueEvidenceGroupCount !==
      plan.summary.globalUniqueEvidenceGroupCount ||
    expectedCounts.crossRoleSharedEvidenceGroupCount !==
      plan.summary.crossRoleSharedEvidenceGroupCount
  ) {
    throw new Error("baseline readiness expected counts do not match plan");
  }

  const expectedReadiness =
    buildValidationRoleRegimeStatisticalReadinessArtifact({
      generatedAt: readiness.generatedAt,
      planHash: plan.planHash,
      expectedCounts: {
        plannedRunCount: plan.summary.plannedRunCount,
        globalUniqueEvidenceGroupCount:
          plan.summary.globalUniqueEvidenceGroupCount,
        crossRoleSharedEvidenceGroupCount:
          plan.summary.crossRoleSharedEvidenceGroupCount
      },
      evidenceRows: plan.runs.map((run) => ({
        splitRole: run.splitRole,
        targetRegime: run.targetRegime,
        evidenceGroupHash: run.evidenceGroupHash
      })),
      roleRegimeSampleMinimum: readiness.config.roleRegimeSampleMinimum
    });
  if (
    createReplayResearchHash(readiness.evidence) !==
    createReplayResearchHash(expectedReadiness.evidence)
  ) {
    throw new Error("baseline readiness evidence does not match plan runs");
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function compareReadinessBlockers(
  left: ValidationRoleRegimeStatisticalReadinessBlocker,
  right: ValidationRoleRegimeStatisticalReadinessBlocker
): number {
  return compareStrings(readinessBlockerKey(left), readinessBlockerKey(right));
}

function readinessBlockerKey(
  blocker: ValidationRoleRegimeStatisticalReadinessBlocker
): string {
  return `${blocker.code}:${blocker.splitRole ?? "*"}:${blocker.targetRegime ?? "*"}`;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function assertFeasibilityCandidateHashes(
  feasibility: ValidationSplitRegimeFeasibilityArtifact
): void {
  for (const assignment of feasibility.assignments) {
    for (const candidate of assignment.candidates) {
      const expectedHash = createValidationFeasibilityCandidateHash({
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        timezoneOffsetMinutes: feasibility.config.timezoneOffsetMinutes,
        windowMonths: feasibility.config.windowMonths,
        calendarHash: feasibility.provenance.calendarHash,
        marketRegimeClassifierHash:
          feasibility.provenance.marketRegimeClassifierHash,
        candidateStrategyBucket: feasibility.config.candidateStrategyBucket,
        scopeAvailable: candidate.scopeAvailable,
        dataSnapshotHash: feasibility.provenance.dataSnapshotHash,
        universeHash: feasibility.provenance.universeHash,
        coverageHash: feasibility.provenance.coverageHash
      });
      if (candidate.candidateHash !== expectedHash) {
        throw new Error(
          `baseline feasibility candidate hash mismatch: ${assignment.splitId}/${assignment.splitRole}`
        );
      }
    }
  }
}

function assertPlanRunsMatchFeasibility(
  plan: ValidationRoleRegimeReplayPlan,
  feasibility: ValidationSplitRegimeFeasibilityArtifact
): void {
  for (const run of plan.runs) {
    const matchingAssignments = feasibility.assignments.filter(
      (assignment) =>
        assignment.splitRole === run.splitRole &&
        assignment.candidates.some(
          (candidate) =>
            candidate.scopeAvailable &&
            candidate.candidateHash === run.candidateHash &&
            candidate.startAt === run.startAt &&
            candidate.endAt === run.endAt &&
            candidate.regime === run.targetRegime
        )
    );
    const expectedAssignmentKeys = matchingAssignments
      .map(feasibilityAssignmentKey)
      .sort(compareStrings);
    if (expectedAssignmentKeys.length === 0) {
      throw new Error(
        `baseline plan run does not match feasibility candidates: ${run.runKey}`
      );
    }
    const actualAssignmentKeys = run.sourceAssignments
      .map((assignment) => {
        const key = feasibilityAssignmentKey(assignment);
        const feasibilityAssignment = matchingAssignments.find(
          (candidate) => feasibilityAssignmentKey(candidate) === key
        );
        if (
          feasibilityAssignment === undefined ||
          !sameAssignmentWindow(feasibilityAssignment, assignment)
        ) {
          throw new Error(
            `baseline plan source assignment does not match feasibility: ${run.runKey}`
          );
        }
        return key;
      })
      .sort(compareStrings);

    if (
      !sameStrings(actualAssignmentKeys, expectedAssignmentKeys)
    ) {
      throw new Error(
        `baseline plan run does not match feasibility candidates: ${run.runKey}`
      );
    }
  }
}

function sameAssignmentWindow(
  feasibilityAssignment: ValidationSplitRegimeFeasibilityArtifact["assignments"][number],
  sourceAssignment: ValidationRoleRegimeReplayPlan["runs"][number]["sourceAssignments"][number]
): boolean {
  const sourceWindow = validationRoleWindow(sourceAssignment);
  return (
    feasibilityAssignment.roleStart === sourceWindow.roleStart &&
    feasibilityAssignment.roleEnd === sourceWindow.roleEnd &&
    feasibilityAssignment.effectiveRoleEnd === sourceWindow.effectiveRoleEnd
  );
}

function feasibilityAssignmentKey(assignment: {
  splitId: string;
  splitIndex: number;
  splitRole: string;
}): string {
  return `${assignment.splitIndex}\u0000${assignment.splitId}\u0000${assignment.splitRole}`;
}
