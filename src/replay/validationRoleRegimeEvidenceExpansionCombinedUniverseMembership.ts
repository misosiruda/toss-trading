import type { Sha256Hash } from "../domain/schemas.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
  type EvidenceExpansionUniverseMember
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

export interface EvidenceExpansionCombinedUniverseMembership {
  members: EvidenceExpansionUniverseMember[];
  combinedUniverseMembershipHash: Sha256Hash;
}

export function buildEvidenceExpansionCombinedUniverseMembership(
  group: EvidenceExpansionAcceptedEvidenceGroup
): EvidenceExpansionCombinedUniverseMembership {
  if (group.sourceVariants.length === 0) {
    throw new Error(
      "combined universe membership requires source variants"
    );
  }

  const membersByKey = new Map<
    string,
    EvidenceExpansionUniverseMember
  >();
  for (const variant of group.sourceVariants) {
    if (variant.evidenceGroupHash !== group.evidenceGroupHash) {
      throw new Error(
        "combined universe membership source variant does not match evidence group"
      );
    }
    assertSourceMembership(variant);
    for (const member of variant.universeMembership) {
      membersByKey.set(memberKey(member), member);
    }
  }

  const members = [...membersByKey.values()].sort(compareMembers);
  return {
    members,
    combinedUniverseMembershipHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members
    })
  };
}

function assertSourceMembership(
  variant: EvidenceExpansionAcceptedEvidenceGroup["sourceVariants"][number]
): void {
  if (variant.universeMembership.length === 0) {
    throw new Error(
      "combined universe membership requires non-empty source membership"
    );
  }
  for (
    let index = 1;
    index < variant.universeMembership.length;
    index += 1
  ) {
    if (
      compareMembers(
        variant.universeMembership[index - 1]!,
        variant.universeMembership[index]!
      ) >= 0
    ) {
      throw new Error(
        "combined universe source membership must use canonical order"
      );
    }
  }
  const computedHash = createReplayResearchHash({
    version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
    members: variant.universeMembership
  });
  if (
    variant.sourceVariant.universeMembershipHash !== computedHash
  ) {
    throw new Error(
      "combined universe source membership hash mismatch"
    );
  }
}

function memberKey(member: EvidenceExpansionUniverseMember): string {
  return `${member.market}:${member.symbol}`;
}

function compareMembers(
  left: EvidenceExpansionUniverseMember,
  right: EvidenceExpansionUniverseMember
): number {
  return (
    marketOrder(left.market) - marketOrder(right.market) ||
    compareStrings(left.symbol, right.symbol)
  );
}

function marketOrder(market: EvidenceExpansionUniverseMember["market"]): number {
  return market === "KR" ? 0 : 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
