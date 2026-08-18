import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOfficialBrokerObservedCalendarEvidence } from "./officialBrokerObservedCalendarEvidence.js";
import { createOfficialBrokerObservedCalendarEvidenceV2 } from "./officialBrokerObservedCalendarEvidenceV2.js";
import { verifyOfficialTossOpenApiCalendarCompatibility } from "./officialBrokerObservedCalendarOpenApiCompatibility.js";
import {
  OFFICIAL_BROKER_OBSERVED_CALENDAR_REPLAY_INPUT_SCHEMA_VERSION,
  buildOfficialBrokerObservedCalendarReplayInput,
  officialBrokerObservedCalendarReplayInputSchema,
  verifyOfficialBrokerObservedCalendarReplayInput
} from "./officialBrokerObservedCalendarReplayAdapter.js";
import { classifyMarketCalendarTimestamp } from "./marketCalendar.js";

test("maps verified KR evidence to paper-only regular-session fixtures", () => {
  const rawResponseBytes = krResponseBytes();
  const evidence = createEvidence("KR", rawResponseBytes);
  const input = buildOfficialBrokerObservedCalendarReplayInput({
    evidence,
    asOf: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });

  assert.equal(
    input.schemaVersion,
    OFFICIAL_BROKER_OBSERVED_CALENDAR_REPLAY_INPUT_SCHEMA_VERSION
  );
  assert.equal(input.mode, "paper_only");
  assert.equal(input.sourceEvidenceClass, "official_broker_observed");
  assert.equal(input.replayEvidenceClass, "observed_session_only");
  assert.equal(input.transition.status, "eligible");
  assert.equal(input.transition.historicalCompletenessClaim, "not_claimed");
  assert.deepEqual(input.calendarValidation.rules, [
    { market: "KR", exchange: "KRX", timezone: "Asia/Seoul" }
  ]);
  assert.deepEqual(
    input.calendarValidation.fixtures.map(
      ({ sessionDate, marketOpen, marketClose, isHoliday }) => ({
        sessionDate,
        marketOpen,
        marketClose,
        isHoliday
      })
    ),
    [
      {
        sessionDate: "2026-03-24",
        marketOpen: "2026-03-24T00:00:00.000Z",
        marketClose: "2026-03-24T06:30:00.000Z",
        isHoliday: false
      },
      {
        sessionDate: "2026-03-25",
        marketOpen: "2026-03-25T00:00:00.000Z",
        marketClose: "2026-03-25T06:30:00.000Z",
        isHoliday: false
      },
      {
        sessionDate: "2026-03-26",
        marketOpen: "2026-03-26T00:00:00.000Z",
        marketClose: "2026-03-26T06:30:00.000Z",
        isHoliday: false
      }
    ]
  );
  const fixture = input.calendarValidation.fixtures[1];
  assert.match(fixture.calendarId, /^toss-open-api-observed:KRX:2026-03-25:/);
  assert.deepEqual(fixture.sourceRefs, [
    `official_broker_observed_calendar_evidence:${evidence.artifactHash}`,
    `toss_open_api_market_calendar_response:${evidence.source.responseHash}`
  ]);
  assert.equal(
    classifyMarketCalendarTimestamp({
      observedAt: "2026-03-25T05:00:00.000Z",
      fixture
    }).status,
    "session_open"
  );
});

test("dispatches v2 evidence through replay fixtures and exact-byte verification", () => {
  const rawResponseBytes = krResponseBytes();
  const evidence = createV2Evidence(rawResponseBytes);
  const input = buildOfficialBrokerObservedCalendarReplayInput({
    evidence,
    asOf: "2026-03-25T01:00:30.000Z",
    rawResponseBytes
  });

  assert.equal(
    input.evidence.schemaVersion,
    "official_broker_observed_calendar_evidence.v2"
  );
  assert.equal(input.calendarValidation.fixtures[1].sessionDate, "2026-03-25");
  assert.equal(input.replayEvidenceClass, "observed_session_only");
  assert.equal(input.transition.historicalCompletenessClaim, "not_claimed");
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarReplayInput(input, {
        asOf: "2026-03-25T01:00:30.000Z",
        rawResponseBytes: Buffer.from(`${rawResponseBytes.toString("utf8")} `)
      }),
    /byte length mismatch|response hash mismatch/
  );
});

test("maps US regular sessions through the existing New York timezone boundary", () => {
  const rawResponseBytes = usResponseBytes();
  const evidence = createEvidence("US", rawResponseBytes);
  const input = buildOfficialBrokerObservedCalendarReplayInput({
    evidence,
    asOf: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });

  assert.deepEqual(input.calendarValidation.rules, [
    { market: "US", exchange: "NYSE", timezone: "America/New_York" }
  ]);
  const fixture = input.calendarValidation.fixtures[1];
  assert.equal(fixture.sessionDate, "2026-03-25");
  assert.equal(fixture.marketOpen, "2026-03-25T13:30:00.000Z");
  assert.equal(fixture.marketClose, "2026-03-25T20:00:00.000Z");
  assert.equal(fixture.isHoliday, false);
});

test("keeps a broker-observed closure fail-closed without an official holiday claim", () => {
  const response = krResponse();
  response.result.today.integrated = null;
  const rawResponseBytes = Buffer.from(JSON.stringify(response), "utf8");
  const evidence = createEvidence("KR", rawResponseBytes);
  const input = buildOfficialBrokerObservedCalendarReplayInput({
    evidence,
    asOf: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });
  const fixture = input.calendarValidation.fixtures[1];

  assert.deepEqual(fixture, {
    calendarId: fixture.calendarId,
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate: "2026-03-25",
    marketOpen: null,
    marketClose: null,
    isHoliday: true,
    holidayName: "Toss broker-observed market closure",
    sourceRefs: fixture.sourceRefs,
    createdAt: "2026-03-25T01:00:00.000Z"
  });
  assert.equal(input.transition.historicalCompletenessClaim, "not_claimed");
  assert.equal(
    classifyMarketCalendarTimestamp({
      observedAt: "2026-03-25T05:00:00.000Z",
      fixture
    }).status,
    "holiday"
  );
});

test("rejects open returned days without one regular session", () => {
  const response = krResponse();
  response.result.today.integrated!.regularMarket = null;
  const rawResponseBytes = Buffer.from(JSON.stringify(response), "utf8");
  const evidence = createEvidence("KR", rawResponseBytes);

  assert.throws(
    () =>
      buildOfficialBrokerObservedCalendarReplayInput({
        evidence,
        asOf: "2026-03-25T12:00:00.000Z",
        rawResponseBytes
      }),
    /must contain one regular session/
  );
});

test("rejects rule, fixture, evidence hash, and transition promotion tampering", () => {
  const rawResponseBytes = krResponseBytes();
  const evidence = createEvidence("KR", rawResponseBytes);
  const input = buildOfficialBrokerObservedCalendarReplayInput({
    evidence,
    asOf: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });

  const wrongRule = structuredClone(input);
  wrongRule.calendarValidation.rules[0].exchange = "NYSE";
  assert.throws(
    () => verifyReplayInput(wrongRule, rawResponseBytes),
    /does not match verified evidence/
  );

  const wrongFixture = structuredClone(input);
  const firstFixture = wrongFixture.calendarValidation.fixtures[0];
  if (!firstFixture.isHoliday) {
    firstFixture.marketClose = "2026-03-24T06:20:00.000Z";
  }
  assert.throws(
    () => verifyReplayInput(wrongFixture, rawResponseBytes),
    /does not match verified evidence/
  );

  const wrongEvidenceHash = structuredClone(input);
  wrongEvidenceHash.evidenceArtifactHash =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  assert.throws(
    () => verifyReplayInput(wrongEvidenceHash, rawResponseBytes),
    /evidence artifact hash mismatch/
  );

  assert.equal(
    officialBrokerObservedCalendarReplayInputSchema.safeParse({
      ...input,
      transition: {
        ...input.transition,
        replayEvidenceClass: "official_exchange"
      }
    }).success,
    false
  );
});

test("revalidates exact response bytes and freshness at the replay boundary", () => {
  const rawResponseBytes = krResponseBytes();
  const evidence = createEvidence("KR", rawResponseBytes);
  const input = buildOfficialBrokerObservedCalendarReplayInput({
    evidence,
    asOf: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });

  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarReplayInput(input, {
        asOf: "2026-03-25T12:00:00.000Z",
        rawResponseBytes: Buffer.from("{}", "utf8")
      }),
    /response byte length mismatch/
  );
  assert.throws(
    () =>
      verifyOfficialBrokerObservedCalendarReplayInput(input, {
        asOf: input.evidence.source.staleAfter,
        rawResponseBytes
      }),
    /source is stale/
  );
});

function verifyReplayInput(
  value: unknown,
  rawResponseBytes: Uint8Array
) {
  return verifyOfficialBrokerObservedCalendarReplayInput(value, {
    asOf: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });
}

function createEvidence(
  market: "KR" | "US",
  rawResponseBytes: Uint8Array
) {
  return createOfficialBrokerObservedCalendarEvidence({
    market,
    requestedDate: "2026-03-25",
    retrievedAt: "2026-03-25T01:00:00.000Z",
    evaluatedAt: "2026-03-25T12:00:00.000Z",
    rawResponseBytes
  });
}

function createV2Evidence(rawResponseBytes: Uint8Array) {
  const pinnedOpenApiBytes = Buffer.from(
    readFileSync("src/replay/officialTossCalendarOpenApi-1.2.14.json", "utf8").replaceAll("\r\n", "\n"),
    "utf8"
  );
  const document = JSON.parse(pinnedOpenApiBytes.toString("utf8")) as {
    paths: Record<string, { get: { responses: { "200": { content: { "application/json": { examples: Record<string, { value: unknown }> } } } } } }>;
  };
  const pinnedExampleBytes = Buffer.from(
    JSON.stringify(document.paths["/api/v1/market-calendar/KR"]!.get.responses["200"].content["application/json"].examples.businessDay!.value),
    "utf8"
  );
  return createOfficialBrokerObservedCalendarEvidenceV2({
    compatibilityResult: verifyOfficialTossOpenApiCalendarCompatibility({
      market: "KR",
      requestedDate: "2026-03-25",
      rawOpenApiDocumentBytes: pinnedOpenApiBytes,
      rawResponseBytes: pinnedExampleBytes
    }),
    requestedDate: "2026-03-25",
    completedAt: "2026-03-25T01:00:10.000Z",
    responseDelayMilliseconds: 250,
    responseCacheHeaders: {
      dateHeaderValues: ["Wed, 25 Mar 2026 01:00:00 GMT"],
      ageHeaderValues: ["5"],
      expiresHeaderValues: []
    },
    responseCacheControl: { cacheControlHeaderValues: ["public, max-age=60"] },
    rawResponseBytes
  });
}

function krResponseBytes(): Buffer {
  return Buffer.from(JSON.stringify(krResponse()), "utf8");
}

interface KrMarketDayFixture {
  date: string;
  integrated: KrIntegratedFixture | null;
}

interface KrResponseFixture {
  result: {
    today: KrMarketDayFixture;
    previousBusinessDay: KrMarketDayFixture;
    nextBusinessDay: KrMarketDayFixture;
  };
}

function krResponse(): KrResponseFixture {
  return {
    result: {
      today: { date: "2026-03-25", integrated: krIntegrated("2026-03-25") },
      previousBusinessDay: {
        date: "2026-03-24",
        integrated: krIntegrated("2026-03-24")
      },
      nextBusinessDay: {
        date: "2026-03-26",
        integrated: krIntegrated("2026-03-26")
      }
    }
  };
}

interface KrIntegratedFixture {
  preMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  } | null;
  regularMarket: {
    startTime: string;
    singlePriceAuctionStartTime: string;
    endTime: string;
  } | null;
  afterMarket: {
    startTime: string;
    singlePriceAuctionEndTime: string;
    endTime: string;
  } | null;
}

function krIntegrated(date: string): KrIntegratedFixture {
  return {
    preMarket: {
      startTime: `${date}T08:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T08:50:00+09:00`,
      endTime: `${date}T09:00:00+09:00`
    },
    regularMarket: {
      startTime: `${date}T09:00:00+09:00`,
      singlePriceAuctionStartTime: `${date}T15:20:00+09:00`,
      endTime: `${date}T15:30:00+09:00`
    },
    afterMarket: {
      startTime: `${date}T15:30:00+09:00`,
      singlePriceAuctionEndTime: `${date}T15:40:00+09:00`,
      endTime: `${date}T20:00:00+09:00`
    }
  };
}

function usResponseBytes(): Buffer {
  return Buffer.from(
    JSON.stringify({
      result: {
        today: usDay("2026-03-25"),
        previousBusinessDay: usDay("2026-03-24"),
        nextBusinessDay: usDay("2026-03-26")
      }
    }),
    "utf8"
  );
}

function usDay(date: string) {
  const nextDate = nextCalendarDate(date);
  return {
    date,
    dayMarket: session(date, "09:00:00", date, "16:50:00"),
    preMarket: session(date, "17:00:00", date, "22:30:00"),
    regularMarket: session(date, "22:30:00", nextDate, "05:00:00"),
    afterMarket: session(nextDate, "05:00:00", nextDate, "07:00:00")
  };
}

function session(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
) {
  return {
    startTime: `${startDate}T${startTime}+09:00`,
    endTime: `${endDate}T${endTime}+09:00`
  };
}

function nextCalendarDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
