import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  classifyEvidenceExpansionCrossSourceGroups,
  type EvidenceExpansionCrossSourceGroupClassification,
  type EvidenceExpansionGroupWindowPolicy
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupClassification.js";
import {
  mergeEvidenceExpansionOverlappingGroup
} from "./validationRoleRegimeEvidenceExpansionCrossSourceGroupMerge.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup,
  EvidenceExpansionEvidenceGroupConsolidationResult
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  EvidenceExpansionSourceCandidateVariant
} from "./validationRoleRegimeEvidenceExpansionSourceCandidateVariant.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";
import {
  VALIDATION_ROLE_ORDER,
  VALIDATION_TARGET_REGIME_ORDER
} from "./validationRoleRegimeReplayPlan.js";

export interface EvidenceExpansionCrossSourceGroupUnion {
  baselineUniqueEvidenceGroupCount: number;
  expansionUniqueEvidenceGroupCount: number;
  baselineOverlapEvidenceGroupCount: number;
  incrementalUniqueEvidenceGroupCount: number;
  combinedUniqueEvidenceGroupCount: number;
  combinedEvidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[];
  incrementalEvidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[];
}

export function buildEvidenceExpansionCrossSourceGroupUnion(input: {
  baseline: EvidenceExpansionEvidenceGroupConsolidationResult;
  expansion: EvidenceExpansionEvidenceGroupConsolidationResult;
  classification: EvidenceExpansionCrossSourceGroupClassification;
  baselineWindowPolicy: EvidenceExpansionGroupWindowPolicy;
  expansionWindowPolicy: EvidenceExpansionGroupWindowPolicy;
}): EvidenceExpansionCrossSourceGroupUnion {
  validateCollection(
    input.baseline,
    "baseline",
    input.baselineWindowPolicy
  );
  validateCollection(
    input.expansion,
    "expansion",
    input.expansionWindowPolicy
  );

  const classification = classifyEvidenceExpansionCrossSourceGroups({
    baseline: input.baseline,
    expansion: input.expansion,
    baselineWindowPolicy: input.baselineWindowPolicy,
    expansionWindowPolicy: input.expansionWindowPolicy
  });
  if (
    createReplayResearchHash(input.classification) !==
    createReplayResearchHash(classification)
  ) {
    throw new Error(
      "cross-source group union classification does not match source collections"
    );
  }

  const baselineByHash = indexGroups(input.baseline.evidenceGroups);
  const expansionByHash = indexGroups(input.expansion.evidenceGroups);
  const overlapHashes = new Set(
    classification.overlapEvidenceGroupHashes
  );
  const combinedEvidenceGroups: EvidenceExpansionAcceptedEvidenceGroup[] =
    [];

  for (const baselineGroup of input.baseline.evidenceGroups) {
    if (!overlapHashes.has(baselineGroup.evidenceGroupHash)) {
      combinedEvidenceGroups.push(baselineGroup);
      continue;
    }
    const expansionGroup = expansionByHash.get(
      baselineGroup.evidenceGroupHash
    );
    if (expansionGroup === undefined) {
      throw new Error(
        "cross-source overlap group is missing from expansion collection"
      );
    }
    combinedEvidenceGroups.push(
      mergeEvidenceExpansionOverlappingGroup({
        baseline: baselineGroup,
        expansion: expansionGroup
      })
    );
  }

  for (const incrementalGroup of classification.incrementalEvidenceGroups) {
    const expansionGroup = expansionByHash.get(
      incrementalGroup.evidenceGroupHash
    );
    if (
      expansionGroup === undefined ||
      createReplayResearchHash(expansionGroup) !==
        createReplayResearchHash(incrementalGroup)
    ) {
      throw new Error(
        "incremental evidence group does not match expansion collection"
      );
    }
    if (baselineByHash.has(incrementalGroup.evidenceGroupHash)) {
      throw new Error(
        "incremental evidence group overlaps baseline collection"
      );
    }
    combinedEvidenceGroups.push(incrementalGroup);
  }

  combinedEvidenceGroups.sort(compareGroups);
  assertCombinedOwnership(combinedEvidenceGroups);
  const expectedCombinedCount =
    classification.baselineUniqueEvidenceGroupCount +
    classification.incrementalUniqueEvidenceGroupCount;
  if (combinedEvidenceGroups.length !== expectedCombinedCount) {
    throw new Error(
      "combined evidence group count does not match baseline and incremental union"
    );
  }

  return {
    baselineUniqueEvidenceGroupCount:
      classification.baselineUniqueEvidenceGroupCount,
    expansionUniqueEvidenceGroupCount:
      classification.expansionUniqueEvidenceGroupCount,
    baselineOverlapEvidenceGroupCount:
      classification.baselineOverlapEvidenceGroupCount,
    incrementalUniqueEvidenceGroupCount:
      classification.incrementalUniqueEvidenceGroupCount,
    combinedUniqueEvidenceGroupCount: combinedEvidenceGroups.length,
    combinedEvidenceGroups,
    incrementalEvidenceGroups:
      classification.incrementalEvidenceGroups
  };
}

function validateCollection(
  consolidation: EvidenceExpansionEvidenceGroupConsolidationResult,
  sourceIdentity: "baseline" | "expansion",
  windowPolicy: EvidenceExpansionGroupWindowPolicy
): void {
  if (
    consolidation.evidenceGroups.length !==
    consolidation.uniqueEvidenceGroupCount
  ) {
    throw new Error(
      `${sourceIdentity} union groups do not match unique count`
    );
  }
  for (const group of consolidation.evidenceGroups) {
    validateGroup(group, sourceIdentity, windowPolicy);
  }
}

function validateGroup(
  group: EvidenceExpansionAcceptedEvidenceGroup,
  sourceIdentity: "baseline" | "expansion",
  windowPolicy: EvidenceExpansionGroupWindowPolicy
): void {
  const startMs = Date.parse(group.startAt);
  const endMs = Date.parse(group.endAt);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    new Date(startMs).toISOString() !== group.startAt ||
    new Date(endMs).toISOString() !== group.endAt ||
    startMs >= endMs
  ) {
    throw new Error(
      `${sourceIdentity} union group requires a canonical interval`
    );
  }
  const expectedGroupHash = createReplayResearchHash({
    startAt: group.startAt,
    endAt: group.endAt,
    candidateStrategyBucket: windowPolicy.candidateStrategyBucket,
    windowMonths: windowPolicy.windowMonths,
    timezoneOffsetMinutes: windowPolicy.timezoneOffsetMinutes
  });
  if (group.evidenceGroupHash !== expectedGroupHash) {
    throw new Error(
      `${sourceIdentity} union group hash does not match window policy payload`
    );
  }
  if (
    group.splitRoles.length === 0 ||
    !VALIDATION_TARGET_REGIME_ORDER.includes(group.targetRegime)
  ) {
    throw new Error(
      `${sourceIdentity} union group has invalid role or regime payload`
    );
  }
  for (let index = 0; index < group.splitRoles.length; index += 1) {
    const role = group.splitRoles[index]!;
    const roleIndex = VALIDATION_ROLE_ORDER.indexOf(role);
    if (
      roleIndex < 0 ||
      (index > 0 &&
        VALIDATION_ROLE_ORDER.indexOf(group.splitRoles[index - 1]!) >=
          roleIndex)
    ) {
      throw new Error(
        `${sourceIdentity} union group roles must use canonical order`
      );
    }
  }
  if (
    (sourceIdentity === "baseline" &&
      group.sourceVariants.length !== 1) ||
    (sourceIdentity === "expansion" &&
      group.sourceVariants.length === 0)
  ) {
    throw new Error(
      `${sourceIdentity} union group has invalid source variant cardinality`
    );
  }
  for (let index = 0; index < group.sourceVariants.length; index += 1) {
    const variant = group.sourceVariants[index]!;
    validateVariant(variant, group.evidenceGroupHash, sourceIdentity);
    if (
      index > 0 &&
      compareVariants(group.sourceVariants[index - 1]!, variant) >= 0
    ) {
      throw new Error(
        `${sourceIdentity} union source variants must use canonical order`
      );
    }
  }
}

function validateVariant(
  variant: EvidenceExpansionSourceCandidateVariant,
  evidenceGroupHash: Sha256Hash,
  sourceIdentity: "baseline" | "expansion"
): void {
  if (variant.evidenceGroupHash !== evidenceGroupHash) {
    throw new Error(
      `${sourceIdentity} union source variant does not match group hash`
    );
  }
  const reference = variant.sourceVariant;
  if (
    sourceIdentity === "baseline" &&
    (reference.legacyReplayPlanEvidenceGroupHash === null ||
      reference.legacyReplayPlanEvidenceGroupHash !==
        reference.feasibilityCandidateHash)
  ) {
    throw new Error(
      "baseline union source variant must preserve legacy identity"
    );
  }
  if (
    sourceIdentity === "expansion" &&
    reference.legacyReplayPlanEvidenceGroupHash !== null
  ) {
    throw new Error(
      "expansion union source variant must not carry legacy identity"
    );
  }
  if (
    variant.observedTradingDates.length === 0 ||
    variant.universeMembership.length === 0
  ) {
    throw new Error(
      `${sourceIdentity} union source variant requires observed evidence`
    );
  }
  assertCanonicalEntries(
    variant.observedTradingDates,
    compareObservedTradingDates,
    `${sourceIdentity} union observed trading dates`
  );
  assertCanonicalEntries(
    variant.universeMembership,
    compareUniverseMembers,
    `${sourceIdentity} union universe membership`
  );
  if (
    reference.observedTradingDatesHash !==
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: variant.observedTradingDates
    }) ||
    reference.universeMembershipHash !==
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members: variant.universeMembership
    })
  ) {
    throw new Error(
      `${sourceIdentity} union source variant evidence hash mismatch`
    );
  }
}

function assertCanonicalEntries<T>(
  entries: readonly T[],
  compare: (left: T, right: T) => number,
  field: string
): void {
  for (let index = 1; index < entries.length; index += 1) {
    if (compare(entries[index - 1]!, entries[index]!) >= 0) {
      throw new Error(`${field} must use canonical order`);
    }
  }
}

function indexGroups(
  groups: readonly EvidenceExpansionAcceptedEvidenceGroup[]
): Map<Sha256Hash, EvidenceExpansionAcceptedEvidenceGroup> {
  return new Map(groups.map((group) => [group.evidenceGroupHash, group]));
}

function assertCombinedOwnership(
  groups: readonly EvidenceExpansionAcceptedEvidenceGroup[]
): void {
  const groupHashes = new Set<Sha256Hash>();
  const sourceVariantOwners = new Map<string, Sha256Hash>();
  for (const group of groups) {
    if (groupHashes.has(group.evidenceGroupHash)) {
      throw new Error(
        "combined evidence groups contain duplicate evidenceGroupHash"
      );
    }
    groupHashes.add(group.evidenceGroupHash);
    for (const variant of group.sourceVariants) {
      const sourceVariantHash = variant.sourceVariant.sourceVariantHash;
      const owner = sourceVariantOwners.get(sourceVariantHash);
      if (owner !== undefined && owner !== group.evidenceGroupHash) {
        throw new Error(
          "combined source variant hash is reused across evidence groups"
        );
      }
      sourceVariantOwners.set(sourceVariantHash, group.evidenceGroupHash);
    }
  }
}

function compareGroups(
  left: EvidenceExpansionAcceptedEvidenceGroup,
  right: EvidenceExpansionAcceptedEvidenceGroup
): number {
  return compareStrings(left.evidenceGroupHash, right.evidenceGroupHash);
}

function compareVariants(
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

function compareObservedTradingDates(
  left: EvidenceExpansionSourceCandidateVariant["observedTradingDates"][number],
  right: EvidenceExpansionSourceCandidateVariant["observedTradingDates"][number]
): number {
  return (
    marketOrder(left.market) - marketOrder(right.market) ||
    compareStrings(left.sessionDate, right.sessionDate)
  );
}

function compareUniverseMembers(
  left: EvidenceExpansionSourceCandidateVariant["universeMembership"][number],
  right: EvidenceExpansionSourceCandidateVariant["universeMembership"][number]
): number {
  return (
    marketOrder(left.market) - marketOrder(right.market) ||
    compareStrings(left.symbol, right.symbol)
  );
}

function marketOrder(market: "KR" | "US"): number {
  return market === "KR" ? 0 : 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
