import type {
  HistoricalMarketSnapshot,
  Market,
  Sha256Hash
} from "../domain/schemas.js";
import type {
  HistoricalDataAvailabilityCalendarOptions,
  HistoricalDataAvailabilityCalendarRule
} from "./historicalDataAvailability.js";
import {
  classifyMarketCalendarTimestamp,
  localDatePart,
  MarketCalendarFixtureIndex
} from "./marketCalendar.js";
import { createReplayResearchHash } from "./replayRunManifest.js";

export const EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION =
  "evidence_expansion_observed_trading_dates.v1";

export interface EvidenceExpansionObservedTradingDate {
  market: Market;
  sessionDate: string;
}

export interface EvidenceExpansionObservedTradingDates {
  sessions: EvidenceExpansionObservedTradingDate[];
  observedTradingDatesHash: Sha256Hash;
}

export function buildEvidenceExpansionObservedTradingDates(input: {
  snapshots: readonly HistoricalMarketSnapshot[];
  startAt: Date | string;
  endAt: Date | string;
  calendarValidation: HistoricalDataAvailabilityCalendarOptions;
}): EvidenceExpansionObservedTradingDates {
  const startMs = parseBoundary(input.startAt, "startAt");
  const endMs = parseBoundary(input.endAt, "endAt");
  if (startMs >= endMs) {
    throw new Error("observed trading-date startAt must be before endAt");
  }

  const rulesByMarket = indexCalendarRules(input.calendarValidation.rules);
  const fixtures = new MarketCalendarFixtureIndex(
    input.calendarValidation.fixtures
  );
  const sessionsByKey = new Map<
    string,
    EvidenceExpansionObservedTradingDate
  >();

  for (const snapshot of input.snapshots) {
    const observedAtMs = Date.parse(snapshot.observedAt);
    if (!Number.isFinite(observedAtMs)) {
      throw new Error(
        `historical snapshot observedAt is invalid: ${snapshot.snapshotId}`
      );
    }
    if (observedAtMs < startMs || observedAtMs > endMs) {
      continue;
    }
    if (snapshot.interval !== "1d") {
      throw new Error(
        `observed trading-date snapshot must use 1d interval: ${snapshot.snapshotId}`
      );
    }

    const rule = rulesByMarket.get(snapshot.market);
    if (rule === undefined) {
      throw new Error(
        `observed trading-date calendar rule is missing: ${snapshot.market}`
      );
    }
    const sessionDate = localDatePart(
      new Date(observedAtMs),
      rule.timezone
    );
    const fixture = fixtures.get({
      exchange: rule.exchange,
      sessionDate
    });
    if (fixture === undefined) {
      throw new Error(
        `observed trading-date calendar fixture is missing: ${rule.exchange}:${sessionDate}`
      );
    }
    if (
      fixture.market !== snapshot.market ||
      fixture.exchange !== rule.exchange ||
      fixture.timezone !== rule.timezone
    ) {
      throw new Error(
        `observed trading-date calendar identity mismatch: ${snapshot.snapshotId}`
      );
    }

    const classification = classifyMarketCalendarTimestamp({
      observedAt: snapshot.observedAt,
      fixture
    });
    if (
      classification.status !== "session_open" ||
      classification.warningCodes.length > 0
    ) {
      throw new Error(
        `observed trading-date snapshot failed calendar validation: ${snapshot.snapshotId}`
      );
    }
    if (
      fixture.marketOpen === null ||
      observedAtMs !== Date.parse(fixture.marketOpen)
    ) {
      throw new Error(
        `observed trading-date snapshot must match marketOpen: ${snapshot.snapshotId}`
      );
    }

    sessionsByKey.set(`${snapshot.market}:${sessionDate}`, {
      market: snapshot.market,
      sessionDate
    });
  }

  const sessions = [...sessionsByKey.values()].sort(compareSessions);
  return {
    sessions,
    observedTradingDatesHash: createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions
    })
  };
}

function indexCalendarRules(
  rules: readonly HistoricalDataAvailabilityCalendarRule[]
): Map<Market, HistoricalDataAvailabilityCalendarRule> {
  const rulesByMarket = new Map<
    Market,
    HistoricalDataAvailabilityCalendarRule
  >();
  for (const rule of rules) {
    if (rulesByMarket.has(rule.market)) {
      throw new Error(
        `duplicate observed trading-date calendar rule: ${rule.market}`
      );
    }
    rulesByMarket.set(rule.market, rule);
  }
  return rulesByMarket;
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
