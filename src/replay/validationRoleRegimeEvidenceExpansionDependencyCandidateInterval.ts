import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionCombinedUniverseMembership
} from "./validationRoleRegimeEvidenceExpansionCombinedUniverseMembership.js";
import type {
  EvidenceExpansionCanonicalTradingDates
} from "./validationRoleRegimeEvidenceExpansionCanonicalTradingDates.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
  type EvidenceExpansionObservedTradingDate
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import {
  evidenceExpansionDependencyCandidateIntervalSchema,
  type EvidenceExpansionDependencyCandidateInterval,
  type EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";

export function buildEvidenceExpansionDependencyCandidateInterval(input: {
  group: EvidenceExpansionAcceptedEvidenceGroup;
  canonicalTradingDates: EvidenceExpansionCanonicalTradingDates;
}): EvidenceExpansionDependencyCandidateInterval {
  assertCanonicalTradingDates(input.canonicalTradingDates);
  for (const variant of input.group.sourceVariants) {
    const observedTradingDatesHash = createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: variant.observedTradingDates
    });
    if (
      variant.sourceVariant.observedTradingDatesHash !==
        observedTradingDatesHash ||
      observedTradingDatesHash !==
        input.canonicalTradingDates.canonicalTradingDatesHash
    ) {
      throw new Error(
        "dependency candidate interval trading-date set conflict"
      );
    }
  }

  const combinedUniverseMembership =
    buildEvidenceExpansionCombinedUniverseMembership(input.group);
  return evidenceExpansionDependencyCandidateIntervalSchema.parse({
    evidenceGroupHash: input.group.evidenceGroupHash,
    sourceVariants: input.group.sourceVariants
      .map((variant) => variant.sourceVariant)
      .sort(compareSourceVariants),
    splitRoles: input.group.splitRoles,
    targetRegime: input.group.targetRegime,
    startAt: input.group.startAt,
    endAt: input.group.endAt,
    canonicalTradingDatesHash:
      input.canonicalTradingDates.canonicalTradingDatesHash,
    combinedUniverseMembershipHash:
      combinedUniverseMembership.combinedUniverseMembershipHash
  });
}

function assertCanonicalTradingDates(
  value: EvidenceExpansionCanonicalTradingDates
): void {
  for (let index = 1; index < value.sessions.length; index += 1) {
    if (
      compareTradingDates(
        value.sessions[index - 1]!,
        value.sessions[index]!
      ) >= 0
    ) {
      throw new Error(
        "dependency canonical trading dates must use canonical order"
      );
    }
  }
  const computedHash = createReplayResearchHash({
    version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
    sessions: value.sessions
  });
  if (computedHash !== value.canonicalTradingDatesHash) {
    throw new Error(
      "dependency canonical trading-date hash mismatch"
    );
  }
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

function compareTradingDates(
  left: EvidenceExpansionObservedTradingDate,
  right: EvidenceExpansionObservedTradingDate
): number {
  return (
    marketOrder(left.market) - marketOrder(right.market) ||
    compareStrings(left.sessionDate, right.sessionDate)
  );
}

function marketOrder(
  market: EvidenceExpansionObservedTradingDate["market"]
): number {
  return market === "KR" ? 0 : 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
