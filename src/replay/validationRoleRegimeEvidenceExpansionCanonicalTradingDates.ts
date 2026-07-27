import type { Market, Sha256Hash } from "../domain/schemas.js";
import { localDatePart } from "./marketCalendar.js";
import type {
  OfficialMarketCalendarEvidenceArtifact
} from "./officialMarketCalendarEvidence.js";
import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
  type EvidenceExpansionObservedTradingDate
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";

export interface EvidenceExpansionCanonicalTradingDates {
  sessions: EvidenceExpansionObservedTradingDate[];
  canonicalTradingDatesHash: Sha256Hash;
}

export function buildEvidenceExpansionCanonicalTradingDates(input: {
  officialCalendarArtifact: OfficialMarketCalendarEvidenceArtifact;
  requiredMarkets: readonly Market[];
  startAt: Date | string;
  endAt: Date | string;
}): EvidenceExpansionCanonicalTradingDates {
  const startMs = parseBoundary(input.startAt, "startAt");
  const endMs = parseBoundary(input.endAt, "endAt");
  if (startMs >= endMs) {
    throw new Error("canonical trading-date startAt must be before endAt");
  }

  const requiredMarkets = normalizeRequiredMarkets(input.requiredMarkets);
  assertOfficialCoverageContainsInterval({
    artifact: input.officialCalendarArtifact,
    requiredMarkets,
    startMs,
    endMs
  });

  const requiredMarketSet = new Set(requiredMarkets);
  const sessions = input.officialCalendarArtifact.sessions
    .filter((session) => {
      if (
        !requiredMarketSet.has(session.market) ||
        (session.sessionType !== "regular" &&
          session.sessionType !== "early_close")
      ) {
        return false;
      }
      if (session.marketOpen === null) {
        throw new Error(
          `official open session is missing marketOpen: ${session.sessionId}`
        );
      }
      const marketOpenMs = Date.parse(session.marketOpen);
      if (!Number.isFinite(marketOpenMs)) {
        throw new Error(
          `official session marketOpen is invalid: ${session.sessionId}`
        );
      }
      return marketOpenMs >= startMs && marketOpenMs <= endMs;
    })
    .map((session) => ({
      market: session.market,
      sessionDate: session.sessionDate
    }))
    .sort(compareSessions);

  return {
    sessions,
    canonicalTradingDatesHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions
    })
  };
}

function assertOfficialCoverageContainsInterval(input: {
  artifact: OfficialMarketCalendarEvidenceArtifact;
  requiredMarkets: readonly Market[];
  startMs: number;
  endMs: number;
}): void {
  const sourcesByMarket = new Map(
    input.artifact.sources.map((source) => [source.market, source])
  );
  for (const market of input.requiredMarkets) {
    const source = sourcesByMarket.get(market);
    if (source === undefined) {
      throw new Error(
        `official calendar source is missing required market: ${market}`
      );
    }
    const startDate = localDatePart(new Date(input.startMs), source.timezone);
    const endDate = localDatePart(new Date(input.endMs), source.timezone);
    if (
      startDate < input.artifact.coverage.startDate ||
      endDate > input.artifact.coverage.endDate
    ) {
      throw new Error(
        `official calendar coverage does not contain candidate interval: ${market}`
      );
    }
  }
}

function normalizeRequiredMarkets(markets: readonly Market[]): Market[] {
  if (markets.length === 0) {
    throw new Error(
      "canonical trading-date requiredMarkets must not be empty"
    );
  }
  const normalized = new Set<Market>();
  for (const market of markets) {
    if (market !== "KR" && market !== "US") {
      throw new Error(
        "canonical trading-date requiredMarkets must contain KR or US"
      );
    }
    normalized.add(market);
  }
  return [...normalized].sort(
    (left, right) => marketOrder(left) - marketOrder(right)
  );
}

function parseBoundary(value: Date | string, field: string): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid date`);
  }
  return parsed;
}

function compareSessions(
  left: EvidenceExpansionObservedTradingDate,
  right: EvidenceExpansionObservedTradingDate
): number {
  return (
    marketOrder(left.market) - marketOrder(right.market) ||
    compareStrings(left.sessionDate, right.sessionDate)
  );
}

function marketOrder(market: Market): number {
  return market === "KR" ? 0 : 1;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
