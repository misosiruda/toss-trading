import type {
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  consolidateEvidenceExpansionEvidenceGroups,
  type EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  buildEvidenceExpansionEligibilityExclusions
} from "./validationRoleRegimeEvidenceExpansionEligibilityExclusions.js";
import type {
  EvidenceExpansionExclusion
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export interface EvidenceExpansionEligibilityPartition {
  consolidation: EvidenceExpansionEvidenceGroupConsolidationResult;
  exclusions: EvidenceExpansionExclusion[];
}

export function buildEvidenceExpansionEligibilityPartition(input: {
  eligibility: EvidenceExpansionCandidateEligibilityResult;
}): EvidenceExpansionEligibilityPartition {
  assertExactInputKeys(input);
  const consolidation = consolidateEvidenceExpansionEvidenceGroups(
    input.eligibility
  );
  const exclusions = buildEvidenceExpansionEligibilityExclusions(
    input.eligibility
  );
  assertSourceVariantPartition(
    input.eligibility,
    consolidation,
    exclusions
  );

  return {
    consolidation,
    exclusions
  };
}

function assertSourceVariantPartition(
  eligibility: EvidenceExpansionCandidateEligibilityResult,
  consolidation: EvidenceExpansionEvidenceGroupConsolidationResult,
  exclusions: readonly EvidenceExpansionExclusion[]
): void {
  const expectedAccepted = new Set<string>();
  const expectedExcluded = new Set<string>();
  for (const row of eligibility.candidates) {
    const hash = row.candidate.variant.sourceVariant.sourceVariantHash;
    if (row.status === "accepted") {
      expectedAccepted.add(hash);
    } else {
      expectedExcluded.add(hash);
    }
  }
  if (
    [...expectedAccepted].some((hash) => expectedExcluded.has(hash))
  ) {
    throw new Error(
      "eligibility source variant has conflicting partition status"
    );
  }

  const actualAccepted = new Set(
    consolidation.evidenceGroups.flatMap((group) =>
      group.sourceVariants.map(
        (variant) => variant.sourceVariant.sourceVariantHash
      )
    )
  );
  const actualExcluded = new Set(
    exclusions.flatMap((exclusion) =>
      exclusion.sourceVariants.map(
        (variant) => variant.sourceVariantHash
      )
    )
  );
  if (
    !sameSet(expectedAccepted, actualAccepted) ||
    !sameSet(expectedExcluded, actualExcluded)
  ) {
    throw new Error(
      "eligibility source variants do not match accepted and excluded outputs"
    );
  }
}

function assertExactInputKeys(input: {
  eligibility: EvidenceExpansionCandidateEligibilityResult;
}): void {
  const actual = Object.keys(input);
  if (actual.length !== 1 || actual[0] !== "eligibility") {
    throw new Error(
      "eligibility partition input contains unknown fields"
    );
  }
}

function sameSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}
