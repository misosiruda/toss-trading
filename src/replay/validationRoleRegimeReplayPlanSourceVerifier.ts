import {
  buildValidationSplitRegimeFeasibilityArtifact,
  validationSplitRegimeFeasibilityArtifactSchema,
  type BuildValidationSplitRegimeFeasibilityArtifactOptions,
  type ValidationSplitRegimeFeasibilityArtifact
} from "./validationSplitRegimeFeasibility.js";
import { createValidationRoleRegimeFeasibilityArtifactHash } from "./validationRoleRegimeReplayPlan.js";

export interface VerifyValidationRoleRegimeReplayPlanSourcesOptions {
  feasibilityArtifact: unknown;
  assignments: BuildValidationSplitRegimeFeasibilityArtifactOptions[
    "assignments"
  ];
  snapshots: BuildValidationSplitRegimeFeasibilityArtifactOptions["snapshots"];
  universe: BuildValidationSplitRegimeFeasibilityArtifactOptions["universe"];
  coverage: BuildValidationSplitRegimeFeasibilityArtifactOptions["coverage"];
  validationSplit: BuildValidationSplitRegimeFeasibilityArtifactOptions[
    "validationSplit"
  ];
  calendarFixtures: BuildValidationSplitRegimeFeasibilityArtifactOptions[
    "calendarValidation"
  ]["fixtures"];
}

export function verifyValidationRoleRegimeReplayPlanSources(
  options: VerifyValidationRoleRegimeReplayPlanSourcesOptions
): ValidationSplitRegimeFeasibilityArtifact {
  const feasibility = validationSplitRegimeFeasibilityArtifactSchema.parse(
    options.feasibilityArtifact
  );
  const regenerated = buildValidationSplitRegimeFeasibilityArtifact({
    generatedAt: feasibility.generatedAt,
    assignments: options.assignments,
    snapshots: options.snapshots,
    universe: options.universe,
    coverage: options.coverage,
    validationSplit: options.validationSplit,
    calendarValidation: {
      rules: feasibility.config.calendarValidation.rules,
      fixtures: options.calendarFixtures
    },
    windowMonths: feasibility.config.windowMonths,
    timezoneOffsetMinutes: feasibility.config.timezoneOffsetMinutes,
    targetRegimes: feasibility.config.targetRegimes,
    candidateStrategyBucket: feasibility.config.candidateStrategyBucket,
    minimumCandidatesPerRoleRegime:
      feasibility.config.minimumCandidatesPerRoleRegime
  });

  if (
    createValidationRoleRegimeFeasibilityArtifactHash(feasibility) !==
    createValidationRoleRegimeFeasibilityArtifactHash(regenerated)
  ) {
    throw new Error(
      "feasibility artifact does not match regenerated source inputs"
    );
  }
  return feasibility;
}
