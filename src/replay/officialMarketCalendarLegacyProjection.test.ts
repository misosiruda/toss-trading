import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarEvidenceHash,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";
import { projectOfficialMarketCalendarEvidenceToLegacyCalendar } from "./officialMarketCalendarLegacyProjection.js";

test("official calendar evidence projects every source and session to legacy calendar input", () => {
  const artifact = signedArtifact();
  const projection = projectOfficialMarketCalendarEvidenceToLegacyCalendar(
    artifact,
    { asOf: "2025-07-03T00:00:00.000Z" }
  );

  assert.deepEqual(projection.rules, [
    {
      market: "KR",
      exchange: "KRX",
      timezone: "Asia/Seoul"
    },
    {
      market: "US",
      exchange: "NYSE",
      timezone: "America/New_York"
    }
  ]);
  assert.equal(projection.fixtures.length, artifact.sessions.length);
  assert.deepEqual(
    projection.fixtures.map((fixture) => [
      fixture.exchange,
      fixture.sessionDate
    ]),
    artifact.sessions.map((session) => [
      session.exchange,
      session.sessionDate
    ])
  );
  for (const [index, fixture] of projection.fixtures.entries()) {
    const session = artifact.sessions[index]!;
    assert.equal(
      fixture.calendarId,
      `calendar.official.${session.exchange.toLowerCase()}.${session.sessionDate}`
    );
    assert.equal(fixture.createdAt, artifact.generatedAt);
    assert.deepEqual(fixture.sourceRefs, [
      `official_market_calendar_evidence:${artifact.artifactHash}:${session.sourceId}:${session.sessionId}`
    ]);
  }
});

test("official calendar evidence preserves open and closed session semantics", () => {
  const artifact = signedArtifact();
  const projection = projectOfficialMarketCalendarEvidenceToLegacyCalendar(
    artifact,
    { asOf: "2025-07-03T00:00:00.000Z" }
  );
  const fixture = (exchange: string, sessionDate: string) =>
    projection.fixtures.find(
      (candidate) =>
        candidate.exchange === exchange &&
        candidate.sessionDate === sessionDate
    );

  assert.deepEqual(fixture("KRX", "2025-07-04"), {
    calendarId: "calendar.official.krx.2025-07-04",
    exchange: "KRX",
    market: "KR",
    timezone: "Asia/Seoul",
    sessionDate: "2025-07-04",
    marketOpen: "2025-07-04T00:00:00.000Z",
    marketClose: "2025-07-04T06:30:00.000Z",
    isHoliday: false,
    sourceRefs: [
      `official_market_calendar_evidence:${artifact.artifactHash}:fixture.krx.source:fixture.krx.2025-07-04`
    ],
    createdAt: "2025-07-02T22:00:00.000Z"
  });

  const earlyClose = fixture("NYSE", "2025-07-03");
  assert.equal(earlyClose?.isHoliday, false);
  assert.equal(earlyClose?.marketOpen, "2025-07-03T13:30:00.000Z");
  assert.equal(earlyClose?.marketClose, "2025-07-03T17:00:00.000Z");
  assert.equal(earlyClose?.holidayName, "Independence Day early close");

  const specialClosure = fixture("KRX", "2025-07-03");
  assert.equal(specialClosure?.isHoliday, true);
  assert.equal(specialClosure?.marketOpen, null);
  assert.equal(specialClosure?.marketClose, null);
  assert.equal(specialClosure?.holidayName, "Synthetic special closure");

  const holiday = fixture("NYSE", "2025-07-04");
  assert.equal(holiday?.isHoliday, true);
  assert.equal(holiday?.holidayName, "Independence Day");

  const weekend = fixture("KRX", "2025-07-05");
  assert.equal(weekend?.isHoliday, true);
  assert.equal("holidayName" in (weekend ?? {}), false);
});

test("official calendar legacy projection fails closed on hash mismatch", () => {
  const artifact = signedArtifact();

  assert.throws(
    () =>
      projectOfficialMarketCalendarEvidenceToLegacyCalendar(
        {
          ...artifact,
          generatedAt: "2025-07-02T23:00:00.000Z"
        },
        { asOf: "2025-07-03T00:00:00.000Z" }
      ),
    /artifact hash mismatch/
  );
});

test("official calendar legacy projection fails closed on unavailable or stale evidence", () => {
  const artifact = signedArtifact();

  assert.throws(
    () =>
      projectOfficialMarketCalendarEvidenceToLegacyCalendar(artifact, {
        asOf: "2025-06-30T23:59:59.999Z"
      }),
    /not yet available/
  );
  assert.throws(
    () =>
      projectOfficialMarketCalendarEvidenceToLegacyCalendar(artifact, {
        asOf: "2026-01-01T00:00:00.000Z"
      }),
    /is stale/
  );
});

function signedArtifact(): OfficialMarketCalendarEvidenceArtifact {
  const payload = evidencePayload();
  return {
    ...payload,
    artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
  };
}

function evidencePayload(): OfficialMarketCalendarEvidencePayload {
  return {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: "2025-07-02T22:00:00.000Z",
    coverage: {
      startDate: "2025-07-03",
      endDate: "2025-07-06",
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      {
        sourceId: "fixture.krx.source",
        evidenceClass: "official_exchange",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        publisher: "synthetic fixture KRX publisher",
        sourceUrl: "https://example.invalid/krx-calendar",
        sourceDocumentHash: hash("a"),
        retrievedAt: "2025-07-01T00:00:00.000Z",
        staleAfter: "2026-01-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:00",
          closeLocalTime: "15:30"
        }
      },
      {
        sourceId: "fixture.nyse.source",
        evidenceClass: "official_exchange",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        publisher: "synthetic fixture NYSE publisher",
        sourceUrl: "https://example.invalid/nyse-calendar",
        sourceDocumentHash: hash("b"),
        retrievedAt: "2025-07-01T00:00:00.000Z",
        staleAfter: "2026-01-01T00:00:00.000Z",
        regularSession: {
          openLocalTime: "09:30",
          closeLocalTime: "16:00"
        }
      }
    ],
    sessions: [
      session("KRX", "2025-07-03", "special_closure"),
      session("KRX", "2025-07-04", "regular"),
      session("KRX", "2025-07-05", "weekend"),
      session("KRX", "2025-07-06", "weekend"),
      session("NYSE", "2025-07-03", "early_close"),
      session("NYSE", "2025-07-04", "holiday"),
      session("NYSE", "2025-07-05", "weekend"),
      session("NYSE", "2025-07-06", "weekend")
    ]
  };
}

function session(
  exchange: "KRX" | "NYSE",
  sessionDate: string,
  sessionType:
    | "regular"
    | "early_close"
    | "holiday"
    | "special_closure"
    | "weekend"
): OfficialMarketCalendarEvidencePayload["sessions"][number] {
  const sourceId =
    exchange === "KRX" ? "fixture.krx.source" : "fixture.nyse.source";
  const market = exchange === "KRX" ? "KR" : "US";
  const timezone =
    exchange === "KRX" ? "Asia/Seoul" : "America/New_York";
  const closed =
    sessionType === "holiday" ||
    sessionType === "special_closure" ||
    sessionType === "weekend";
  const marketOpen =
    closed
      ? null
      : exchange === "KRX"
        ? `${sessionDate}T00:00:00.000Z`
        : `${sessionDate}T13:30:00.000Z`;
  const marketClose =
    closed
      ? null
      : exchange === "KRX"
        ? `${sessionDate}T06:30:00.000Z`
        : sessionType === "early_close"
          ? `${sessionDate}T17:00:00.000Z`
          : `${sessionDate}T20:00:00.000Z`;
  const exceptionName =
    sessionType === "special_closure"
      ? "Synthetic special closure"
      : sessionType === "early_close"
        ? "Independence Day early close"
        : sessionType === "holiday"
          ? "Independence Day"
          : null;

  return {
    sessionId: `fixture.${exchange.toLowerCase()}.${sessionDate}`,
    sourceId,
    exchange,
    market,
    timezone,
    sessionDate,
    sessionType,
    marketOpen,
    marketClose,
    exceptionName
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
