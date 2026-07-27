import type { MarketRegimeLabel } from "../analytics/marketRegimeClassifier.js";
import type { Sha256Hash } from "../domain/schemas.js";
import type {
  EvidenceExpansionCandidateEligibilityResult
} from "./validationRoleRegimeEvidenceExpansionCandidateEligibility.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";
import type { ValidationSplitRole } from "./validationProtocol.js";

type EvidenceExpansionTargetRegime = Exclude<
  MarketRegimeLabel,
  "insufficient_data"
>;

export interface EvidenceExpansionAcceptedEvidenceGroup {
  evidenceGroupHash: Sha256Hash;
  startAt: string;
  endAt: string;
  targetRegime: EvidenceExpansionTargetRegime;
  splitRoles: ValidationSplitRole[];
  sourceVariants: EvidenceExpansionSourceCandidateVariant[];
}

export interface EvidenceExpansionEvidenceGroupConsolidationResult {
  evidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[];
  acceptedCandidateCount: number;
  uniqueEvidenceGroupCount: number;
}

interface MutableEvidenceGroup {
  evidenceGroupHash: Sha256Hash;
  startAt: string;
  endAt: string;
  targetRegime: EvidenceExpansionTargetRegime;
  splitRoles: Set<ValidationSplitRole>;
  sourceVariants: Map<string, EvidenceExpansionSourceCandidateVariant>;
}

export function consolidateEvidenceExpansionEvidenceGroups(
  eligibility: EvidenceExpansionCandidateEligibilityResult
): EvidenceExpansionEvidenceGroupConsolidationResult {
  const accepted = eligibility.candidates.filter(
    (candidate) => candidate.status === "accepted"
  );
  if (accepted.length !== eligibility.acceptedCandidateCount) {
    throw new Error(
      "accepted candidate rows do not match eligibility count"
    );
  }

  const groups = new Map<Sha256Hash, MutableEvidenceGroup>();
  const evidenceGroupHashesByInterval = new Map<
    string,
    Map<string, Sha256Hash>
  >();
  const sourceVariantOwners = new Map<string, Sha256Hash>();
  for (const entry of accepted) {
    if (
      entry.exclusionReason !== null ||
      !entry.candidate.scopeAvailable
    ) {
      throw new Error(
        "accepted candidate does not satisfy eligibility contract"
      );
    }

    const { candidate } = entry;
    const targetRegime = requireTargetRegime(candidate.regime);
    const evidenceGroupHash = candidate.variant.evidenceGroupHash;
    let hashesByEnd = evidenceGroupHashesByInterval.get(
      candidate.startAt
    );
    if (hashesByEnd === undefined) {
      hashesByEnd = new Map();
      evidenceGroupHashesByInterval.set(
        candidate.startAt,
        hashesByEnd
      );
    }
    const existingIntervalHash = hashesByEnd.get(candidate.endAt);
    if (
      existingIntervalHash !== undefined &&
      existingIntervalHash !== evidenceGroupHash
    ) {
      throw new Error(
        "evidence group interval payload maps to conflicting hashes"
      );
    }
    hashesByEnd.set(candidate.endAt, evidenceGroupHash);

    const existingGroup = groups.get(evidenceGroupHash);
    let group: MutableEvidenceGroup;
    if (existingGroup === undefined) {
      group = {
        evidenceGroupHash,
        startAt: candidate.startAt,
        endAt: candidate.endAt,
        targetRegime,
        splitRoles: new Set(),
        sourceVariants: new Map()
      };
      groups.set(evidenceGroupHash, group);
    } else {
      assertSameEvidenceGroupPayload(
        existingGroup,
        candidate.startAt,
        candidate.endAt,
        targetRegime
      );
      group = existingGroup;
    }

    group.splitRoles.add(entry.assignment.splitRole);
    const sourceVariant = candidate.variant;
    const existingOwner = sourceVariantOwners.get(
      sourceVariant.sourceVariant.sourceVariantHash
    );
    if (
      existingOwner !== undefined &&
      existingOwner !== evidenceGroupHash
    ) {
      throw new Error(
        "source variant hash is reused across evidence groups"
      );
    }
    sourceVariantOwners.set(
      sourceVariant.sourceVariant.sourceVariantHash,
      evidenceGroupHash
    );

    const existingVariant = group.sourceVariants.get(
      sourceVariant.sourceVariant.sourceVariantHash
    );
    if (
      existingVariant !== undefined &&
      !sameSourceVariant(existingVariant, sourceVariant)
    ) {
      throw new Error(
        "source variant hash has conflicting canonical payload"
      );
    }
    group.sourceVariants.set(
      sourceVariant.sourceVariant.sourceVariantHash,
      sourceVariant
    );
  }

  const evidenceGroups = [...groups.values()]
    .map((group) => ({
      evidenceGroupHash: group.evidenceGroupHash,
      startAt: group.startAt,
      endAt: group.endAt,
      targetRegime: group.targetRegime,
      splitRoles: [...group.splitRoles].sort(compareRoles),
      sourceVariants: [...group.sourceVariants.values()].sort(
        compareSourceVariants
      )
    }))
    .sort(compareEvidenceGroups);

  return {
    evidenceGroups,
    acceptedCandidateCount: accepted.length,
    uniqueEvidenceGroupCount: evidenceGroups.length
  };
}

function assertSameEvidenceGroupPayload(
  group: MutableEvidenceGroup,
  startAt: string,
  endAt: string,
  targetRegime: EvidenceExpansionTargetRegime
): void {
  if (
    group.startAt !== startAt ||
    group.endAt !== endAt
  ) {
    throw new Error(
      "evidence group hash has conflicting interval payload"
    );
  }
  if (group.targetRegime !== targetRegime) {
    throw new Error(
      "evidence group hash has conflicting regime labels"
    );
  }
}

function requireTargetRegime(
  regime: MarketRegimeLabel
): EvidenceExpansionTargetRegime {
  if (regime === "insufficient_data") {
    throw new Error(
      "accepted candidate does not satisfy eligibility contract"
    );
  }
  return regime;
}

function sameSourceVariant(
  left: EvidenceExpansionSourceCandidateVariant,
  right: EvidenceExpansionSourceCandidateVariant
): boolean {
  return (
    left.evidenceGroupHash === right.evidenceGroupHash &&
    sameSourceVariantReference(left.sourceVariant, right.sourceVariant) &&
    sameObservedTradingDates(
      left.observedTradingDates,
      right.observedTradingDates
    ) &&
    sameUniverseMembership(
      left.universeMembership,
      right.universeMembership
    )
  );
}

function sameSourceVariantReference(
  left: EvidenceExpansionSourceCandidateVariant["sourceVariant"],
  right: EvidenceExpansionSourceCandidateVariant["sourceVariant"]
): boolean {
  return (
    left.feasibilityCandidateHash === right.feasibilityCandidateHash &&
    left.legacyReplayPlanEvidenceGroupHash ===
      right.legacyReplayPlanEvidenceGroupHash &&
    left.sourceVariantHashVersion === right.sourceVariantHashVersion &&
    left.sourceVariantHash === right.sourceVariantHash &&
    left.observedTradingDatesHash === right.observedTradingDatesHash &&
    left.universeMembershipHash === right.universeMembershipHash
  );
}

function sameObservedTradingDates(
  left: EvidenceExpansionSourceCandidateVariant["observedTradingDates"],
  right: EvidenceExpansionSourceCandidateVariant["observedTradingDates"]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.market === right[index]?.market &&
        entry.sessionDate === right[index]?.sessionDate
    )
  );
}

function sameUniverseMembership(
  left: EvidenceExpansionSourceCandidateVariant["universeMembership"],
  right: EvidenceExpansionSourceCandidateVariant["universeMembership"]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.market === right[index]?.market &&
        entry.symbol === right[index]?.symbol
    )
  );
}

function compareEvidenceGroups(
  left: EvidenceExpansionAcceptedEvidenceGroup,
  right: EvidenceExpansionAcceptedEvidenceGroup
): number {
  return (
    compareRoleLists(left.splitRoles, right.splitRoles) ||
    VALIDATION_TARGET_REGIME_ORDER.indexOf(left.targetRegime) -
      VALIDATION_TARGET_REGIME_ORDER.indexOf(right.targetRegime) ||
    compareStrings(left.startAt, right.startAt) ||
    compareStrings(left.endAt, right.endAt) ||
    compareStrings(left.evidenceGroupHash, right.evidenceGroupHash)
  );
}

function compareRoleLists(
  left: readonly ValidationSplitRole[],
  right: readonly ValidationSplitRole[]
): number {
  const comparableLength = Math.min(left.length, right.length);
  for (let index = 0; index < comparableLength; index += 1) {
    const difference = compareRoles(left[index]!, right[index]!);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

function compareRoles(
  left: ValidationSplitRole,
  right: ValidationSplitRole
): number {
  return (
    VALIDATION_ROLE_ORDER.indexOf(left) -
    VALIDATION_ROLE_ORDER.indexOf(right)
  );
}

function compareSourceVariants(
  left: EvidenceExpansionSourceCandidateVariant,
  right: EvidenceExpansionSourceCandidateVariant
): number {
  return (
    compareStrings(
      left.sourceVariant.sourceVariantHash,
      right.sourceVariant.sourceVariantHash
    ) ||
    compareStrings(
      left.sourceVariant.feasibilityCandidateHash,
      right.sourceVariant.feasibilityCandidateHash
    )
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
