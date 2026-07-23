import type { Sha256Hash } from "../domain/schemas.js";
import {
  validationSplitRegimeFeasibilityArtifactSchema,
  type ValidationSplitRegimeFeasibilityArtifact
} from "./validationSplitRegimeFeasibility.js";
import {
  createValidationRoleRegimeFeasibilityArtifactHash,
  parseValidationRoleRegimeReplayPlan,
  type ValidationRoleRegimeReplayPlan
} from "./validationRoleRegimeReplayPlan.js";
import {
  validationRoleRegimeStatisticalReadinessArtifactSchema,
  type ValidationRoleRegimeStatisticalReadinessArtifact
} from "./validationRoleRegimeStatisticalReadiness.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

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
  return createReplayResearchHash(payload);
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
