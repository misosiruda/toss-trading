import type {
  HistoricalMarketSnapshot,
  Market,
  Sha256Hash
} from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions
} from "./historicalDataAvailability.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  buildEvidenceExpansionObservedTradingDates
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";

export const EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION =
  "evidence_expansion_universe_membership.v1";

export interface EvidenceExpansionUniverseMember {
  market: Market;
  symbol: string;
}

export interface EvidenceExpansionUniverseMembership {
  members: EvidenceExpansionUniverseMember[];
  universeMembershipHash: Sha256Hash;
}

export function buildEvidenceExpansionUniverseMembership(input: {
  snapshots: readonly HistoricalMarketSnapshot[];
  startAt: Date | string;
  endAt: Date | string;
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
}): EvidenceExpansionUniverseMembership {
  const startMs = parseBoundary(input.startAt, "startAt");
  const endMs = parseBoundary(input.endAt, "endAt");
  if (startMs >= endMs) {
    throw new Error("universe membership startAt must be before endAt");
  }

  const scopedSnapshots = input.snapshots.filter((snapshot) => {
    if (snapshot.strategyBucket !== "short_term") {
      return false;
    }
    const observedAtMs = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(observedAtMs)) {
      throw new Error(
        `historical snapshot observedAt is invalid: ${snapshot.snapshotId}`
      );
    }
    return (
      observedAtMs >= startMs &&
      observedAtMs <= endMs
    );
  });

  buildEvidenceExpansionObservedTradingDates({
    snapshots: scopedSnapshots,
    startAt: input.startAt,
    endAt: input.endAt,
    calendarValidation: input.calendarValidation
  });

  const membersByKey = new Map<string, EvidenceExpansionUniverseMember>();
  for (const snapshot of scopedSnapshots) {
    membersByKey.set(`${snapshot.market}:${snapshot.symbol}`, {
      market: snapshot.market,
      symbol: snapshot.symbol
    });
  }
  const members = [...membersByKey.values()].sort(compareMembers);

  return {
    members,
    universeMembershipHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_UNIVERSE_MEMBERSHIP_VERSION,
      members
    })
  };
}

function parseBoundary(value: Date | string, field: string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid date`);
  }
  return parsed;
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

function marketOrder(market: Market): number {
  return market === "KR" ? 0 : 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
