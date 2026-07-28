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
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";

export function buildEvidenceExpansionEligibilityExclusions(
  eligibility: EvidenceExpansionCandidateEligibilityResult
): EvidenceExpansionExclusion[] {
  assertEligibilityCounts(eligibility);

  const grouped = new Map<string, EvidenceExpansionExclusion[]>();
  const intervalsByGroupHash = new Map<
    string,
    { startAt: string; endAt: string }
  >();
  const groupHashesByInterval = new Map<
    string,
    Map<string, string>
  >();
  const sourceVariantOwners = new Map<string, string>();
  for (const row of eligibility.candidates) {
    assertEvidenceGroupIntervalIdentity(
      row.candidate.variant.evidenceGroupHash,
      row.candidate.startAt,
      row.candidate.endAt,
      intervalsByGroupHash,
      groupHashesByInterval
    );
    assertSourceVariantOwner(
      row.candidate.variant.sourceVariant.sourceVariantHash,
      row.candidate.variant.evidenceGroupHash,
      sourceVariantOwners
    );
    if (row.status === "accepted") {
      continue;
    }
    const exclusion =
      buildEvidenceExpansionEligibilityExclusion(row);
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

function assertEvidenceGroupIntervalIdentity(
  evidenceGroupHash: string,
  startAt: string,
  endAt: string,
  intervalsByGroupHash: Map<
    string,
    { startAt: string; endAt: string }
  >,
  groupHashesByInterval: Map<string, Map<string, string>>
): void {
  const existingInterval = intervalsByGroupHash.get(
    evidenceGroupHash
  );
  if (
    existingInterval !== undefined &&
    (existingInterval.startAt !== startAt ||
      existingInterval.endAt !== endAt)
  ) {
    throw new Error(
      "exclusion evidence group hash has conflicting interval payload"
    );
  }
  intervalsByGroupHash.set(evidenceGroupHash, { startAt, endAt });

  let hashesByEnd = groupHashesByInterval.get(startAt);
  if (hashesByEnd === undefined) {
    hashesByEnd = new Map();
    groupHashesByInterval.set(startAt, hashesByEnd);
  }
  const existingHash = hashesByEnd.get(endAt);
  if (
    existingHash !== undefined &&
    existingHash !== evidenceGroupHash
  ) {
    throw new Error(
      "exclusion interval payload maps to conflicting evidence group hashes"
    );
  }
  hashesByEnd.set(endAt, evidenceGroupHash);
}

function assertSourceVariantOwner(
  sourceVariantHash: string,
  evidenceGroupHash: string,
  sourceVariantOwners: Map<string, string>
): void {
  const owner = sourceVariantOwners.get(sourceVariantHash);
  if (
    owner !== undefined &&
    owner !== evidenceGroupHash
  ) {
    throw new Error(
      "eligibility source variant belongs to multiple evidence groups"
    );
  }
  sourceVariantOwners.set(sourceVariantHash, evidenceGroupHash);
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
  return (
    compareStrings(left.reason, right.reason) ||
    roleIndex(left.splitRole) - roleIndex(right.splitRole) ||
    regimeIndex(left.targetRegime) - regimeIndex(right.targetRegime) ||
    compareStrings(left.evidenceGroupHash, right.evidenceGroupHash) ||
    compareSourceVariantLists(
      left.sourceVariants,
      right.sourceVariants
    )
  );
}

function compareSourceVariantLists(
  left: readonly EvidenceExpansionSourceVariantReference[],
  right: readonly EvidenceExpansionSourceVariantReference[]
): number {
  const comparableLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const difference = compareSourceVariants(
      left[index]!,
      right[index]!
    );
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function roleIndex(
  role: EvidenceExpansionExclusion["splitRole"]
): number {
  return role === null
    ? VALIDATION_ROLE_ORDER.length
    : VALIDATION_ROLE_ORDER.indexOf(role);
}

function regimeIndex(
  regime: EvidenceExpansionExclusion["targetRegime"]
): number {
  return regime === null
    ? VALIDATION_TARGET_REGIME_ORDER.length
    : VALIDATION_TARGET_REGIME_ORDER.indexOf(regime);
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
