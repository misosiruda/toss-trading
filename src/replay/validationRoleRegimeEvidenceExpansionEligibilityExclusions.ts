import {
  evidenceExpansionExclusionSchema,
  type EvidenceExpansionExclusion,
  type EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  EvidenceExpansionCandidateEligibility,
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import {
  buildEvidenceExpansionEligibilityExclusion
} from "./validationRoleRegimeEvidenceExpansionEligibilityExclusion.js";
import {
  compareEvidenceExpansionPreflightExclusions
} from "./validationRoleRegimeEvidenceExpansionPreflightExclusionOrder.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";

interface CandidateClassificationIdentity {
  scopeAvailable: boolean;
  regime: EvidenceExpansionCandidateEligibility["candidate"]["regime"];
  status: EvidenceExpansionCandidateEligibility["status"];
  exclusionReason:
    EvidenceExpansionCandidateEligibility["exclusionReason"];
}

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
  const sourceVariantsByHash = new Map<
    string,
    EvidenceExpansionSourceCandidateVariant
  >();
  const classificationsBySourceVariantHash = new Map<
    string,
    CandidateClassificationIdentity
  >();
  for (const row of eligibility.candidates) {
    assertEvidenceGroupIntervalIdentity(
      row.candidate.variant.evidenceGroupHash,
      row.candidate.startAt,
      row.candidate.endAt,
      intervalsByGroupHash,
      groupHashesByInterval
    );
    assertSourceVariantIdentity(
      row.candidate.variant,
      sourceVariantOwners,
      sourceVariantsByHash
    );
    assertCandidateClassificationIdentity(
      row,
      classificationsBySourceVariantHash
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
        .sort(compareEvidenceExpansionPreflightExclusions)
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

function assertSourceVariantIdentity(
  variant: EvidenceExpansionSourceCandidateVariant,
  sourceVariantOwners: Map<string, string>,
  sourceVariantsByHash: Map<
    string,
    EvidenceExpansionSourceCandidateVariant
  >
): void {
  const { sourceVariant } = variant;
  const owner = sourceVariantOwners.get(
    sourceVariant.sourceVariantHash
  );
  if (
    owner !== undefined &&
    owner !== variant.evidenceGroupHash
  ) {
    throw new Error(
      "eligibility source variant belongs to multiple evidence groups"
    );
  }
  sourceVariantOwners.set(
    sourceVariant.sourceVariantHash,
    variant.evidenceGroupHash
  );

  const existing = sourceVariantsByHash.get(
    sourceVariant.sourceVariantHash
  );
  if (
    existing !== undefined &&
    !sameSourceCandidateVariant(existing, variant)
  ) {
    throw new Error(
      "eligibility source variant payload conflicts"
    );
  }
  sourceVariantsByHash.set(
    sourceVariant.sourceVariantHash,
    variant
  );
}

function assertCandidateClassificationIdentity(
  row: EvidenceExpansionCandidateEligibility,
  classificationsBySourceVariantHash: Map<
    string,
    CandidateClassificationIdentity
  >
): void {
  const sourceVariantHash =
    row.candidate.variant.sourceVariant.sourceVariantHash;
  const classification = {
    scopeAvailable: row.candidate.scopeAvailable,
    regime: row.candidate.regime,
    status: row.status,
    exclusionReason: row.exclusionReason
  };
  const existing = classificationsBySourceVariantHash.get(
    sourceVariantHash
  );
  if (
    existing !== undefined &&
    (existing.scopeAvailable !== classification.scopeAvailable ||
      existing.regime !== classification.regime ||
      existing.status !== classification.status ||
      existing.exclusionReason !== classification.exclusionReason)
  ) {
    throw new Error(
      "eligibility source variant has conflicting classification payload"
    );
  }
  classificationsBySourceVariantHash.set(
    sourceVariantHash,
    classification
  );
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
        !sameSourceVariantReference(existing, sourceVariant)
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

function sameSourceCandidateVariant(
  left: EvidenceExpansionSourceCandidateVariant,
  right: EvidenceExpansionSourceCandidateVariant
): boolean {
  return (
    left.evidenceGroupHash === right.evidenceGroupHash &&
    sameSourceVariantReference(
      left.sourceVariant,
      right.sourceVariant
    ) &&
    left.observedTradingDates.length ===
      right.observedTradingDates.length &&
    left.observedTradingDates.every(
      (entry, index) =>
        entry.market === right.observedTradingDates[index]?.market &&
        entry.sessionDate ===
          right.observedTradingDates[index]?.sessionDate
    ) &&
    left.universeMembership.length ===
      right.universeMembership.length &&
    left.universeMembership.every(
      (entry, index) =>
        entry.market === right.universeMembership[index]?.market &&
        entry.symbol === right.universeMembership[index]?.symbol
    )
  );
}

function sameSourceVariantReference(
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

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
