import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  createOfficialMarketCalendarEvidenceHash
} from "./officialMarketCalendarEvidence.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  buildEvidenceExpansionCanonicalTradingDates,
  type EvidenceExpansionCanonicalTradingDates
} from "./validationRoleRegimeEvidenceExpansionCanonicalTradingDates.js";
import {
  buildEvidenceExpansionCombinedUniverseMembership,
  type EvidenceExpansionCombinedUniverseMembership
} from "./validationRoleRegimeEvidenceExpansionCombinedUniverseMembership.js";
import type {
  EvidenceExpansionAcceptedEvidenceGroup
} from "./validationRoleRegimeEvidenceExpansionEvidenceGroupConsolidation.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import {
  evidenceExpansionDependencyCandidateIntervalSchema,
  type EvidenceExpansionDependencyCandidateInterval,
  type EvidenceExpansionSourceVariantReference
} from "./validationRoleRegimeEvidenceExpansionPreflight.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";

export interface EvidenceExpansionDependencyCandidateIntervalInput {
  group: EvidenceExpansionAcceptedEvidenceGroup;
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "coverage" | "hashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "officialCalendarArtifact" | "hashes"
  >;
}

export interface EvidenceExpansionDependencyCandidateEvidence {
  interval: EvidenceExpansionDependencyCandidateInterval;
  canonicalTradingDates: EvidenceExpansionCanonicalTradingDates;
  combinedUniverseMembership: EvidenceExpansionCombinedUniverseMembership;
}

export function buildEvidenceExpansionDependencyCandidateInterval(
  input: EvidenceExpansionDependencyCandidateIntervalInput
): EvidenceExpansionDependencyCandidateInterval {
  return buildEvidenceExpansionDependencyCandidateEvidence(input).interval;
}

export function buildEvidenceExpansionDependencyCandidateEvidence(
  input: EvidenceExpansionDependencyCandidateIntervalInput
): EvidenceExpansionDependencyCandidateEvidence {
  const officialCalendarArtifact =
    input.calendarClassifier.officialCalendarArtifact;
  if (officialCalendarArtifact === null) {
    throw new Error(
      "dependency candidate interval requires official calendar evidence"
    );
  }
  const { artifactHash, ...officialCalendarPayload } =
    officialCalendarArtifact;
  if (
    createOfficialMarketCalendarEvidenceHash(officialCalendarPayload) !==
      artifactHash ||
    artifactHash !==
      input.calendarClassifier.hashes.officialCalendarArtifactHash
  ) {
    throw new Error(
      "dependency candidate interval official calendar hash mismatch"
    );
  }
  if (
    createReplayResearchHash(input.source.coverage) !==
    input.source.hashes.expansionCoverageHash
  ) {
    throw new Error(
      "dependency candidate interval coverage hash mismatch"
    );
  }

  const canonicalTradingDates =
    buildEvidenceExpansionCanonicalTradingDates({
      officialCalendarArtifact,
      requiredMarkets: input.source.coverage.requiredMarkets,
      startAt: input.group.startAt,
      endAt: input.group.endAt
    });
  for (const variant of input.group.sourceVariants) {
    const observedTradingDatesHash = createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: variant.observedTradingDates
    });
    if (
      variant.sourceVariant.observedTradingDatesHash !==
        observedTradingDatesHash ||
      observedTradingDatesHash !==
        canonicalTradingDates.canonicalTradingDatesHash
    ) {
      throw new Error(
        "dependency candidate interval trading-date set conflict"
      );
    }
  }

  const combinedUniverseMembership =
    buildEvidenceExpansionCombinedUniverseMembership(input.group);
  const interval =
    evidenceExpansionDependencyCandidateIntervalSchema.parse({
      evidenceGroupHash: input.group.evidenceGroupHash,
      sourceVariants: input.group.sourceVariants
        .map((variant) => variant.sourceVariant)
        .sort(compareSourceVariants),
      splitRoles: input.group.splitRoles,
      targetRegime: input.group.targetRegime,
      startAt: input.group.startAt,
      endAt: input.group.endAt,
      canonicalTradingDatesHash:
        canonicalTradingDates.canonicalTradingDatesHash,
      combinedUniverseMembershipHash:
        combinedUniverseMembership.combinedUniverseMembershipHash
    });
  return {
    interval,
    canonicalTradingDates,
    combinedUniverseMembership
  };
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
  return left < right ? -1 : left > right ? 1 : 0;
}
