import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  type OfficialMarketCalendarEvidenceArtifact
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

interface EvidenceExpansionDependencyCandidateContext {
  officialCalendarArtifactHash: string;
  officialCalendarSessions:
    OfficialMarketCalendarEvidenceArtifact["sessions"];
  requiredMarkets: Array<"KR" | "US">;
}

const verifiedDependencyCandidateContexts = new WeakMap<
  EvidenceExpansionDependencyCandidateEvidence,
  EvidenceExpansionDependencyCandidateContext
>();

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
  const evidence = {
    interval,
    canonicalTradingDates: {
      ...canonicalTradingDates,
      sessions: canonicalTradingDates.sessions.map((session) => ({
        ...session
      }))
    },
    combinedUniverseMembership: {
      ...combinedUniverseMembership,
      members: combinedUniverseMembership.members.map((member) => ({
        ...member
      }))
    }
  };
  freezeDependencyCandidateEvidence(evidence);
  verifiedDependencyCandidateContexts.set(
    evidence,
    createDependencyCandidateContext({
      officialCalendarArtifact,
      requiredMarkets: input.source.coverage.requiredMarkets
    })
  );
  return evidence;
}

export function getVerifiedEvidenceExpansionDependencyCandidateContext(
  value: EvidenceExpansionDependencyCandidateEvidence
): EvidenceExpansionDependencyCandidateContext {
  const context = verifiedDependencyCandidateContexts.get(value);
  if (context === undefined) {
    throw new Error(
      "dependency candidate evidence must come from the verified builder"
    );
  }
  return context;
}

function freezeDependencyCandidateEvidence(
  evidence: EvidenceExpansionDependencyCandidateEvidence
): void {
  for (const sourceVariant of evidence.interval.sourceVariants) {
    Object.freeze(sourceVariant);
  }
  Object.freeze(evidence.interval.sourceVariants);
  Object.freeze(evidence.interval.splitRoles);
  Object.freeze(evidence.interval);
  for (const session of evidence.canonicalTradingDates.sessions) {
    Object.freeze(session);
  }
  Object.freeze(evidence.canonicalTradingDates.sessions);
  Object.freeze(evidence.canonicalTradingDates);
  for (const member of evidence.combinedUniverseMembership.members) {
    Object.freeze(member);
  }
  Object.freeze(evidence.combinedUniverseMembership.members);
  Object.freeze(evidence.combinedUniverseMembership);
  Object.freeze(evidence);
}

function createDependencyCandidateContext(input: {
  officialCalendarArtifact: OfficialMarketCalendarEvidenceArtifact;
  requiredMarkets: readonly ("KR" | "US")[];
}): EvidenceExpansionDependencyCandidateContext {
  const context = {
    officialCalendarArtifactHash:
      input.officialCalendarArtifact.artifactHash,
    officialCalendarSessions:
      input.officialCalendarArtifact.sessions.map((session) => ({
        ...session
      })),
    requiredMarkets: [...new Set(input.requiredMarkets)].sort()
  };
  for (const session of context.officialCalendarSessions) {
    Object.freeze(session);
  }
  Object.freeze(context.officialCalendarSessions);
  Object.freeze(context.requiredMarkets);
  Object.freeze(context);
  return context;
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
