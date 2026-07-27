import type { Sha256Hash } from "../domain/schemas.js";
import type {
  VerifiedEvidenceExpansionCalendarClassifier
} from "./validationRoleRegimeEvidenceExpansionCalendarClassifierVerifier.js";
import {
  createEvidenceExpansionCandidateIdentity,
  type EvidenceExpansionCandidateIdentity
} from "./validationRoleRegimeEvidenceExpansionCandidateIdentity.js";
import {
  buildEvidenceExpansionObservedTradingDates,
  type EvidenceExpansionObservedTradingDate
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";
import type {
  VerifiedValidationRoleRegimeEvidenceExpansionSource
} from "./validationRoleRegimeEvidenceExpansionSourceVerifier.js";
import {
  buildEvidenceExpansionUniverseMembership,
  type EvidenceExpansionUniverseMember
} from "./validationRoleRegimeEvidenceExpansionUniverseMembership.js";

export interface EvidenceExpansionSourceCandidate {
  startAt: string;
  endAt: string;
  scopeAvailable: boolean;
  legacyReplayPlanEvidenceGroupHash: Sha256Hash | null;
}

export interface EvidenceExpansionSourceCandidateVariant
  extends EvidenceExpansionCandidateIdentity {
  observedTradingDates: EvidenceExpansionObservedTradingDate[];
  universeMembership: EvidenceExpansionUniverseMember[];
}

export function buildEvidenceExpansionSourceCandidateVariant(input: {
  candidate: EvidenceExpansionSourceCandidate;
  source: Pick<
    VerifiedValidationRoleRegimeEvidenceExpansionSource,
    "snapshots" | "hashes"
  >;
  calendarClassifier: Pick<
    VerifiedEvidenceExpansionCalendarClassifier,
    "calendarValidation" | "hashes"
  >;
  windowMonths: number;
  timezoneOffsetMinutes: number;
}): EvidenceExpansionSourceCandidateVariant {
  const observedTradingDates = buildEvidenceExpansionObservedTradingDates({
    snapshots: input.source.snapshots,
    startAt: input.candidate.startAt,
    endAt: input.candidate.endAt,
    calendarValidation: input.calendarClassifier.calendarValidation
  });
  const universeMembership = buildEvidenceExpansionUniverseMembership({
    snapshots: input.source.snapshots,
    startAt: input.candidate.startAt,
    endAt: input.candidate.endAt,
    calendarValidation: input.calendarClassifier.calendarValidation
  });
  const computedScopeAvailable = universeMembership.members.length > 0;
  if (input.candidate.scopeAvailable !== computedScopeAvailable) {
    throw new Error(
      "source candidate scopeAvailable does not match observed short-term membership"
    );
  }

  const identity = createEvidenceExpansionCandidateIdentity({
    startAt: input.candidate.startAt,
    endAt: input.candidate.endAt,
    candidateStrategyBucket: "short_term",
    windowMonths: input.windowMonths,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    scopeAvailable: input.candidate.scopeAvailable,
    calendarHash: input.calendarClassifier.hashes.calendarHash,
    marketRegimeClassifierHash:
      input.calendarClassifier.hashes.marketRegimeClassifierHash,
    dataSnapshotHash:
      input.source.hashes.expansionDataSnapshotHash,
    universeHash: input.source.hashes.expansionUniverseHash,
    coverageHash: input.source.hashes.expansionCoverageHash,
    validationSplitHash: input.source.hashes.validationSplitHash,
    observedTradingDatesHash:
      observedTradingDates.observedTradingDatesHash,
    universeMembershipHash:
      universeMembership.universeMembershipHash,
    legacyReplayPlanEvidenceGroupHash:
      input.candidate.legacyReplayPlanEvidenceGroupHash
  });

  return {
    ...identity,
    observedTradingDates: observedTradingDates.sessions,
    universeMembership: universeMembership.members
  };
}
