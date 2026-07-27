import assert from "node:assert/strict";
import test from "node:test";

import { createReplayResearchHash } from "./replayRunManifest.js";
import {
  createOfficialMarketCalendarEvidenceHash,
  parseOfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";
import {
  buildEvidenceExpansionCanonicalTradingDates
} from "./validationRoleRegimeEvidenceExpansionCanonicalTradingDates.js";
import {
  EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION
} from "./validationRoleRegimeEvidenceExpansionObservedTradingDates.js";

test("canonical trading dates use official open sessions and observed payload", () => {
  const result = buildEvidenceExpansionCanonicalTradingDates({
    officialCalendarArtifact: artifact(),
    requiredMarkets: ["US", "KR"],
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T14:30:00.000Z"
  });
  const reorderedMarkets = buildEvidenceExpansionCanonicalTradingDates({
    officialCalendarArtifact: artifact(),
    requiredMarkets: ["KR", "US"],
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T14:30:00.000Z"
  });

  assert.deepEqual(result.sessions, [
    { market: "KR", sessionDate: "2025-01-02" },
    { market: "US", sessionDate: "2025-01-02" },
    { market: "US", sessionDate: "2025-01-03" }
  ]);
  assert.equal(
    result.canonicalTradingDatesHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: result.sessions
    })
  );
  assert.deepEqual(reorderedMarkets, result);
});

test("canonical trading dates include only required markets", () => {
  const result = buildEvidenceExpansionCanonicalTradingDates({
    officialCalendarArtifact: artifact(),
    requiredMarkets: ["KR"],
    startAt: "2025-01-02T00:00:00.000Z",
    endAt: "2025-01-03T14:30:00.000Z"
  });

  assert.deepEqual(result.sessions, [
    { market: "KR", sessionDate: "2025-01-02" }
  ]);
});

test("canonical trading dates use inclusive market-open boundaries", () => {
  const result = buildEvidenceExpansionCanonicalTradingDates({
    officialCalendarArtifact: artifact(),
    requiredMarkets: ["US"],
    startAt: "2025-01-02T14:30:00.001Z",
    endAt: "2025-01-03T14:30:00.000Z"
  });

  assert.deepEqual(result.sessions, [
    { market: "US", sessionDate: "2025-01-03" }
  ]);
});

test("canonical trading dates hash an empty verified interval deterministically", () => {
  const result = buildEvidenceExpansionCanonicalTradingDates({
    officialCalendarArtifact: artifact(),
    requiredMarkets: ["KR"],
    startAt: "2025-01-03T00:00:00.000Z",
    endAt: "2025-01-03T06:30:00.000Z"
  });

  assert.deepEqual(result.sessions, []);
  assert.equal(
    result.canonicalTradingDatesHash,
    createReplayResearchHash({
      version: EVIDENCE_EXPANSION_OBSERVED_TRADING_DATES_VERSION,
      sessions: []
    })
  );
});

test("canonical trading dates reject incomplete official coverage", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionCanonicalTradingDates({
        officialCalendarArtifact: artifact(),
        requiredMarkets: ["US"],
        startAt: "2025-01-01T00:00:00.000Z",
        endAt: "2025-01-02T00:00:00.000Z"
      }),
    /coverage does not contain candidate interval: US/
  );
});

test("canonical trading dates reject empty required markets", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionCanonicalTradingDates({
        officialCalendarArtifact: artifact(),
        requiredMarkets: [],
        startAt: "2025-01-02T00:00:00.000Z",
        endAt: "2025-01-03T14:30:00.000Z"
      }),
    /requiredMarkets must not be empty/
  );
});

test("canonical trading dates reject invalid candidate boundaries", () => {
  assert.throws(
    () =>
      buildEvidenceExpansionCanonicalTradingDates({
        officialCalendarArtifact: artifact(),
        requiredMarkets: ["KR"],
        startAt: "2025-01-03T00:00:00.000Z",
        endAt: "2025-01-02T00:00:00.000Z"
      }),
    /startAt must be before endAt/
  );
});

function artifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload: OfficialMarketCalendarEvidencePayload = {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-01-01T12:00:00.000Z",
    coverage: {
      startDate: "2025-01-01",
      endDate: "2025-01-03",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      {
        sourceId: "official.krx",
        evidenceClass: "official_exchange",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        publisher: "KRX",
        sourceUrl: "https://example.com/krx",
        sourceDocumentHash: `sha256:${"a".repeat(64)}`,
        retrievedAt: "2025-01-01T00:00:00.000Z",
        staleAfter: "2025-02-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:00",
          closeLocalTime: "15:30"
        }
      },
      {
        sourceId: "official.nyse",
        evidenceClass: "official_exchange",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        publisher: "NYSE",
        sourceUrl: "https://example.com/nyse",
        sourceDocumentHash: `sha256:${"b".repeat(64)}`,
        retrievedAt: "2025-01-01T00:00:00.000Z",
        staleAfter: "2025-02-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:30",
          closeLocalTime: "16:00"
        }
      }
    ],
    sessions: [
      {
        sessionId: "krx.2025-01-01",
        sourceId: "official.krx",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-01",
        sessionType: "regular",
        marketOpen: "2025-01-01T09:00:00+09:00",
        marketClose: "2025-01-01T15:30:00+09:00",
        exceptionName: null
      },
      {
        sessionId: "krx.2025-01-02",
        sourceId: "official.krx",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-02",
        sessionType: "regular",
        marketOpen: "2025-01-02T09:00:00+09:00",
        marketClose: "2025-01-02T15:30:00+09:00",
        exceptionName: null
      },
      {
        sessionId: "krx.2025-01-03",
        sourceId: "official.krx",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: "2025-01-03",
        sessionType: "holiday",
        marketOpen: null,
        marketClose: null,
        exceptionName: "fixture holiday"
      },
      {
        sessionId: "nyse.2025-01-01",
        sourceId: "official.nyse",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-01-01",
        sessionType: "regular",
        marketOpen: "2025-01-01T09:30:00-05:00",
        marketClose: "2025-01-01T16:00:00-05:00",
        exceptionName: null
      },
      {
        sessionId: "nyse.2025-01-02",
        sourceId: "official.nyse",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-01-02",
        sessionType: "regular",
        marketOpen: "2025-01-02T09:30:00-05:00",
        marketClose: "2025-01-02T16:00:00-05:00",
        exceptionName: null
      },
      {
        sessionId: "nyse.2025-01-03",
        sourceId: "official.nyse",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: "2025-01-03",
        sessionType: "early_close",
        marketOpen: "2025-01-03T09:30:00-05:00",
        marketClose: "2025-01-03T13:00:00-05:00",
        exceptionName: "fixture early close"
      }
    ]
  };
  return parseOfficialMarketCalendarEvidenceArtifact(
    {
      ...payload,
      artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
    },
    { asOf: "2025-01-02T00:00:00.000Z" }
  );
}
