import type { HistoricalDataAvailabilityCalendarOptions } from "./historicalDataAvailability.js";
import {
  parseMarketCalendarFixture,
  type MarketCalendarFixture
} from "./marketCalendar.js";
import {
  parseOfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidenceArtifact
} from "./officialMarketCalendarEvidence.js";

export interface OfficialMarketCalendarLegacyProjectionOptions {
  asOf: Date | string;
}

export function projectOfficialMarketCalendarEvidenceToLegacyCalendar(
  value: unknown,
  options: OfficialMarketCalendarLegacyProjectionOptions
): HistoricalDataAvailabilityCalendarOptions {
  const artifact = parseOfficialMarketCalendarEvidenceArtifact(value, options);
  const rules = artifact.sources.map(({ market, exchange, timezone }) => ({
    market,
    exchange,
    timezone
  }));
  const fixtures = artifact.sessions.map((session) =>
    projectSession(artifact, session)
  );

  return { rules, fixtures };
}

function projectSession(
  artifact: OfficialMarketCalendarEvidenceArtifact,
  session: OfficialMarketCalendarEvidenceArtifact["sessions"][number]
): MarketCalendarFixture {
  const isHoliday =
    session.sessionType === "holiday" ||
    session.sessionType === "special_closure" ||
    session.sessionType === "weekend";

  return parseMarketCalendarFixture({
    calendarId: `calendar.official.${session.exchange.toLowerCase()}.${session.sessionDate}`,
    exchange: session.exchange,
    market: session.market,
    timezone: session.timezone,
    sessionDate: session.sessionDate,
    marketOpen: session.marketOpen,
    marketClose: session.marketClose,
    isHoliday,
    ...(session.exceptionName === null
      ? {}
      : { holidayName: session.exceptionName }),
    sourceRefs: [
      `official_market_calendar_evidence:${artifact.artifactHash}:${session.sourceId}:${session.sessionId}`
    ],
    createdAt: artifact.generatedAt
  });
}
