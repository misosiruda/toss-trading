import {
  buildEvidenceExpansionCapacityView
} from "./validationRoleRegimeEvidenceExpansionCapacityView.js";
import type {
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import type {
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export type EvidenceExpansionBaselineCapacityView =
  ValidationRoleRegimeEvidenceExpansionPreflightArtifact["capacity"]["baseline"];

export function buildEvidenceExpansionBaselineCapacityView(
  consolidation: EvidenceExpansionEvidenceGroupConsolidationResult
): EvidenceExpansionBaselineCapacityView {
  if (
    consolidation.acceptedCandidateCount === 0 ||
    consolidation.evidenceGroups.length === 0
  ) {
    throw new Error(
      "baseline capacity requires consolidated evidence groups"
    );
  }

  const roleMembershipCount = consolidation.evidenceGroups.reduce(
    (total, group) => total + group.splitRoles.length,
    0
  );
  if (roleMembershipCount !== consolidation.acceptedCandidateCount) {
    throw new Error(
      "baseline capacity role memberships do not match accepted runs"
    );
  }

  for (const group of consolidation.evidenceGroups) {
    if (group.sourceVariants.length !== 1) {
      throw new Error(
        "baseline capacity evidence group requires one source variant"
      );
    }
    const sourceVariant = group.sourceVariants[0]!.sourceVariant;
    if (
      sourceVariant.legacyReplayPlanEvidenceGroupHash === null ||
      sourceVariant.feasibilityCandidateHash !==
        sourceVariant.legacyReplayPlanEvidenceGroupHash
    ) {
      throw new Error(
        "baseline capacity source variant must preserve legacy identity"
      );
    }
  }

  return buildEvidenceExpansionCapacityView(consolidation);
}
