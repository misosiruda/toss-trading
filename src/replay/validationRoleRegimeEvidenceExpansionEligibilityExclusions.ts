import {
  evidenceExpansionExclusionSchema,
  type EvidenceExpansionExclusion,
  type EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionEligibilityExclusion
} from "./validationRoleRegimeEvidenceExpansionEligibilityExclusion.js";

export function buildEvidenceExpansionEligibilityExclusions(
  eligibility: EvidenceExpansionCandidateEligibilityResult
): EvidenceExpansionExclusion[] {
  assertEligibilityCounts(eligibility);

  const grouped = new Map<string, EvidenceExpansionExclusion[]>();
  const sourceVariantOwners = new Map<string, string>();
  for (const row of eligibility.candidates) {
    if (row.status === "accepted") {
      continue;
    }
    const exclusion =
      buildEvidenceExpansionEligibilityExclusion(row);
    for (const sourceVariant of exclusion.sourceVariants) {
      const owner = sourceVariantOwners.get(
        sourceVariant.sourceVariantHash
      );
      if (
        owner !== undefined &&
        owner !== exclusion.evidenceGroupHash
      ) {
        throw new Error(
          "exclusion source variant belongs to multiple evidence groups"
        );
      }
      sourceVariantOwners.set(
        sourceVariant.sourceVariantHash,
        exclusion.evidenceGroupHash
      );
    }
    const group = grouped.get(exclusion.evidenceGroupHash) ?? [];
    group.push(exclusion);
    grouped.set(exclusion.evidenceGroupHash, group);
  }

  return evidenceExpansionExclusionSchema
    .array()
    .parse(
      [...grouped.values()]
        .map(mergeExclusionGroup)
        .sort(compareExclusions)
    );
}

function assertEligibilityCounts(
  eligibility: EvidenceExpansionCandidateEligibilityResult
): void {
  const acceptedCandidateCount = eligibility.candidates.filter(
    (candidate) => candidate.status === "accepted"
  ).length;
  const scopeUnavailableCandidateCount =
    eligibility.candidates.filter(
      (candidate) =>
        candidate.exclusionReason === "SCOPE_UNAVAILABLE"
    ).length;
  const insufficientRegimeDataCandidateCount =
    eligibility.candidates.filter(
      (candidate) =>
        candidate.exclusionReason === "INSUFFICIENT_REGIME_DATA"
    ).length;
  if (
    acceptedCandidateCount !== eligibility.acceptedCandidateCount ||
    scopeUnavailableCandidateCount !==
      eligibility.scopeUnavailableCandidateCount ||
    insufficientRegimeDataCandidateCount !==
      eligibility.insufficientRegimeDataCandidateCount ||
    acceptedCandidateCount +
      scopeUnavailableCandidateCount +
      insufficientRegimeDataCandidateCount !==
      eligibility.candidates.length
  ) {
    throw new Error(
      "eligibility exclusion counts do not match candidate rows"
    );
  }
}

function mergeExclusionGroup(
  group: EvidenceExpansionExclusion[]
): EvidenceExpansionExclusion {
  const first = group[0]!;
  if (group.some((exclusion) => exclusion.reason !== first.reason)) {
    throw new Error(
      "evidence group eligibility exclusions have conflicting reasons"
    );
  }
  if (
    group.some(
      (exclusion) =>
        exclusion.targetRegime !== first.targetRegime
    )
  ) {
    throw new Error(
      "evidence group eligibility exclusions have conflicting regimes"
    );
  }

  const sourceVariants = mergeSourceVariants(group);
  const splitRoles = new Set(
    group.map((exclusion) => exclusion.splitRole)
  );
  const splitRole =
    splitRoles.size === 1 ? first.splitRole : null;
  const message =
    first.reason === "SCOPE_UNAVAILABLE"
      ? `${splitRole ?? "cross-role"} candidate scope is unavailable`
      : `${splitRole ?? "cross-role"} candidate regime data is insufficient`;

  return evidenceExpansionExclusionSchema.parse({
    sourceVariants,
    evidenceGroupHash: first.evidenceGroupHash,
    splitRole,
    targetRegime: first.targetRegime,
    reason: first.reason,
    message
  });
}

function mergeSourceVariants(
  group: EvidenceExpansionExclusion[]
): EvidenceExpansionSourceVariantReference[] {
  const sourceVariants = new Map<
    string,
    EvidenceExpansionSourceVariantReference
  >();
  for (const exclusion of group) {
    for (const sourceVariant of exclusion.sourceVariants) {
      const existing = sourceVariants.get(
        sourceVariant.sourceVariantHash
      );
      if (
        existing !== undefined &&
        !sameSourceVariant(existing, sourceVariant)
      ) {
        throw new Error(
          "duplicate exclusion source variant payload conflicts"
        );
      }
      sourceVariants.set(
        sourceVariant.sourceVariantHash,
        sourceVariant
      );
    }
  }
  return [...sourceVariants.values()].sort(compareSourceVariants);
}

function sameSourceVariant(
  left: EvidenceExpansionSourceVariantReference,
  right: EvidenceExpansionSourceVariantReference
): boolean {
  return (
    left.feasibilityCandidateHash ===
      right.feasibilityCandidateHash &&
    left.legacyReplayPlanEvidenceGroupHash ===
      right.legacyReplayPlanEvidenceGroupHash &&
    left.sourceVariantHashVersion === right.sourceVariantHashVersion &&
    left.sourceVariantHash === right.sourceVariantHash &&
    left.observedTradingDatesHash ===
      right.observedTradingDatesHash &&
    left.universeMembershipHash === right.universeMembershipHash
  );
}

function compareSourceVariants(
  left: EvidenceExpansionSourceVariantReference,
  right: EvidenceExpansionSourceVariantReference
): number {
  return (
    compareStrings(left.sourceVariantHash, right.sourceVariantHash) ||
    compareStrings(
      left.feasibilityCandidateHash,
      right.feasibilityCandidateHash
    )
  );
}

function compareExclusions(
  left: EvidenceExpansionExclusion,
  right: EvidenceExpansionExclusion
): number {
  return compareStrings(exclusionKey(left), exclusionKey(right));
}

function exclusionKey(exclusion: EvidenceExpansionExclusion): string {
  return [
    exclusion.reason,
    exclusion.splitRole ?? "*",
    exclusion.targetRegime ?? "*",
    exclusion.evidenceGroupHash,
    ...exclusion.sourceVariants.map(sourceVariantKey)
  ].join(":");
}

function sourceVariantKey(
  sourceVariant: EvidenceExpansionSourceVariantReference
): string {
  return (
    `${sourceVariant.sourceVariantHash}:` +
    sourceVariant.feasibilityCandidateHash
  );
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
