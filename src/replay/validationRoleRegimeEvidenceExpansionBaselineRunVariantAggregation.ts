import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionBaselineRunVariant
} from "./validationRoleRegimeEvidenceExpansionBaselineRunVariant.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import type {
  ValidationRoleRegimeReplayPlan,
  ValidationRoleRegimeReplayPlanRun
} from "./validationRoleRegimeReplayPlan.js";

export interface EvidenceExpansionBaselineRunVariantEntry {
  run: ValidationRoleRegimeReplayPlanRun;
  variant: EvidenceExpansionSourceCandidateVariant;
}

export interface EvidenceExpansionBaselineRunVariantAggregation {
  runVariants: EvidenceExpansionBaselineRunVariantEntry[];
  plannedRunCount: number;
}

export function aggregateEvidenceExpansionBaselineRunVariants(input: {
  plan: Pick<
    ValidationRoleRegimeReplayPlan,
    "status" | "source" | "config" | "runs"
  >;
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "snapshots" | "hashes" | "baselineProvenanceHashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "calendarValidation" | "marketRegimeClassifier" | "hashes"
  >;
}): EvidenceExpansionBaselineRunVariantAggregation {
  if (input.plan.status !== "ready_for_paper_diagnostic") {
    throw new Error(
      "baseline run aggregation requires a ready baseline plan"
    );
  }
  if (input.plan.runs.length === 0) {
    throw new Error(
      "baseline run aggregation requires planned runs"
    );
  }

  const runKeys = new Set<string>();
  const runVariants = input.plan.runs.map((run, index) => {
    if (run.planIndex !== index) {
      throw new Error(
        "baseline run aggregation requires contiguous planIndex order"
      );
    }
    if (runKeys.has(run.runKey)) {
      throw new Error(
        `baseline run aggregation contains duplicate runKey: ${run.runKey}`
      );
    }
    runKeys.add(run.runKey);

    return {
      run,
      variant: buildEvidenceExpansionBaselineRunVariant({
        run,
        plan: input.plan,
        source: input.source,
        calendarClassifier: input.calendarClassifier
      })
    };
  });

  return {
    runVariants,
    plannedRunCount: input.plan.runs.length
  };
}
