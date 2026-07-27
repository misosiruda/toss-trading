import type {
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import type {
  EvidenceExpansionBaselineRunVariantAggregation
} from "./validationRoleRegimeEvidenceExpansionBaselineRunVariantAggregation.js";
import {
  consolidateEvidenceExpansionEvidenceGroups,
  type EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";

export function consolidateEvidenceExpansionBaselineEvidenceGroups(
  aggregation: EvidenceExpansionBaselineRunVariantAggregation
): EvidenceExpansionEvidenceGroupConsolidationResult {
  if (
    aggregation.plannedRunCount === 0 ||
    aggregation.runVariants.length !== aggregation.plannedRunCount
  ) {
    throw new Error(
      "baseline evidence group rows do not match planned run count"
    );
  }

  const candidates = aggregation.runVariants.map(
    ({ run, variant }, index) => {
      if (run.planIndex !== index) {
        throw new Error(
          "baseline evidence groups require contiguous planIndex order"
        );
      }
      if (run.executionAssignment.splitRole !== run.splitRole) {
        throw new Error(
          "baseline evidence group execution assignment role mismatch"
        );
      }
      if (
        run.candidateHash !== run.evidenceGroupHash ||
        variant.sourceVariant.feasibilityCandidateHash !==
          run.candidateHash ||
        variant.sourceVariant.legacyReplayPlanEvidenceGroupHash !==
          run.evidenceGroupHash
      ) {
        throw new Error(
          "baseline evidence group variant does not match run identity"
        );
      }

      return {
        assignment: run.executionAssignment,
        candidate: {
          startAt: run.startAt,
          endAt: run.endAt,
          regime: run.targetRegime,
          scopeAvailable: true,
          variant
        },
        status: "accepted" as const,
        exclusionReason: null
      };
    }
  );
  const eligibility: EvidenceExpansionCandidateEligibilityResult = {
    candidates,
    acceptedCandidateCount: candidates.length,
    scopeUnavailableCandidateCount: 0,
    insufficientRegimeDataCandidateCount: 0
  };

  return consolidateEvidenceExpansionEvidenceGroups(eligibility);
}
