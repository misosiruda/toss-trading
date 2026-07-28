import {
  evidenceExpansionExclusionSchema,
  type EvidenceExpansionExclusion
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  EvidenceExpansionCandidateEligibility
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";

export function buildEvidenceExpansionEligibilityExclusion(
  eligibility: EvidenceExpansionCandidateEligibility
): EvidenceExpansionExclusion {
  if (
    eligibility.status !== "excluded" ||
    eligibility.exclusionReason === null
  ) {
    throw new Error(
      "eligibility exclusion requires an excluded candidate"
    );
  }

  const { candidate, assignment, exclusionReason } = eligibility;
  if (
    exclusionReason === "SCOPE_UNAVAILABLE" &&
    candidate.scopeAvailable
  ) {
    throw new Error(
      "scope exclusion requires unavailable candidate scope"
    );
  }
  if (
    exclusionReason === "INSUFFICIENT_REGIME_DATA" &&
    (!candidate.scopeAvailable ||
      candidate.regime !== "insufficient_data")
  ) {
    throw new Error(
      "regime-data exclusion requires scoped insufficient data"
    );
  }

  const targetRegime =
    candidate.regime === "insufficient_data"
      ? null
      : candidate.regime;
  const message =
    exclusionReason === "SCOPE_UNAVAILABLE"
      ? `${assignment.splitRole} candidate scope is unavailable`
      : `${assignment.splitRole} candidate regime data is insufficient`;

  return evidenceExpansionExclusionSchema.parse({
    sourceVariants: [candidate.variant.sourceVariant],
    evidenceGroupHash: candidate.variant.evidenceGroupHash,
    splitRole: assignment.splitRole,
    targetRegime,
    reason: exclusionReason,
    message
  });
}
