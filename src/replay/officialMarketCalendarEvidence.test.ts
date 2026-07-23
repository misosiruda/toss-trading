import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarEvidenceHash,
  officialMarketCalendarEvidenceArtifactSchema,
  parseOfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidenceArtifact,
  type OfficialMarketCalendarEvidencePayload
} from "./officialMarketCalendarEvidence.js";

test("official calendar evidence validates KRX and NYSE post-DST sessions", () => {
  const artifact = signedArtifact(postDstPayload());
  const parsed = parseOfficialMarketCalendarEvidenceArtifact(artifact, {
    asOf: "2025-03-11T00:00:00.000Z"
  });

  assert.equal(parsed.schemaVersion, "official_market_calendar_evidence.v1");
  assert.equal(parsed.mode, "paper_only");
  assert.deepEqual(parsed.coverage.exchanges, ["KRX", "NYSE"]);
  assert.equal(parsed.sessions[0]?.marketOpen, "2025-03-10T00:00:00.000Z");
  assert.equal(parsed.sessions[1]?.marketOpen, "2025-03-10T13:30:00.000Z");
});

test("official calendar evidence accepts source-backed NYSE early close", () => {
  const payload = oneDayPayload({
    sessionDate: "2025-11-28",
    generatedAt: "2025-11-28T22:00:00.000Z",
    krxOpen: "2025-11-28T00:00:00.000Z",
    krxClose: "2025-11-28T06:30:00.000Z",
    nyseOpen: "2025-11-28T14:30:00.000Z",
    nyseClose: "2025-11-28T18:00:00.000Z",
    nyseSessionType: "early_close",
    nyseExceptionName: "synthetic fixture early close"
  });
  const parsed = parseOfficialMarketCalendarEvidenceArtifact(
    signedArtifact(payload),
    { asOf: "2025-11-29T00:00:00.000Z" }
  );

  assert.equal(parsed.sessions[1]?.sessionType, "early_close");
  assert.equal(
    parsed.sessions[1]?.exceptionName,
    "synthetic fixture early close"
  );
});

test("official calendar evidence accepts explicit holiday closures", () => {
  const payload = closedDayPayload("2025-01-01", "holiday");
  const parsed = parseOfficialMarketCalendarEvidenceArtifact(
    signedArtifact(payload),
    { asOf: "2025-01-02T00:00:00.000Z" }
  );

  assert.deepEqual(
    parsed.sessions.map((session) => session.sessionType),
    ["holiday", "holiday"]
  );
  assert.equal(parsed.sessions.every((session) => session.marketOpen === null), true);
});

test("official calendar evidence rejects missing exchange-date coverage", () => {
  const payload = postDstPayload();
  assert.throws(
    () =>
      officialMarketCalendarEvidenceArtifactSchema.parse({
        ...payload,
        sessions: payload.sessions.slice(0, 1),
        artifactHash: hash("f")
      }),
    /calendar coverage is missing NYSE:2025-03-10/
  );
});

test("official calendar evidence rejects regular and early-close weekend sessions", () => {
  const regularPayload = oneDayPayload({
    sessionDate: "2025-03-08",
    generatedAt: "2025-03-08T23:00:00.000Z",
    krxOpen: "2025-03-08T00:00:00.000Z",
    krxClose: "2025-03-08T06:30:00.000Z",
    nyseOpen: "2025-03-08T14:30:00.000Z",
    nyseClose: "2025-03-08T21:00:00.000Z",
    nyseSessionType: "regular",
    nyseExceptionName: null
  });
  const earlyClosePayload = {
    ...regularPayload,
    sessions: [
      {
        ...regularPayload.sessions[0],
        sessionType: "weekend",
        marketOpen: null,
        marketClose: null,
        exceptionName: null
      },
      {
        ...regularPayload.sessions[1],
        sessionType: "early_close",
        marketClose: "2025-03-08T18:00:00.000Z",
        exceptionName: "synthetic fixture early close"
      }
    ]
  };
  const regularOnlyPayload = {
    ...regularPayload,
    sessions: [
      regularPayload.sessions[0],
      {
        ...regularPayload.sessions[1],
        sessionType: "weekend",
        marketOpen: null,
        marketClose: null,
        exceptionName: null
      }
    ]
  };

  for (const payload of [regularOnlyPayload, earlyClosePayload]) {
    assert.throws(
      () =>
        officialMarketCalendarEvidenceArtifactSchema.parse({
          ...payload,
          artifactHash: hash("f")
        }),
      /weekend date must use weekend session type/
    );
  }
});

test("official calendar evidence rejects stale sources at read time", () => {
  const artifact = signedArtifact(postDstPayload());

  assert.throws(
    () =>
      parseOfficialMarketCalendarEvidenceArtifact(artifact, {
        asOf: "2026-01-01T00:00:00.000Z"
      }),
    /calendar evidence is stale/
  );
});

test("official calendar evidence rejects offsetless read-time asOf", () => {
  const artifact = signedArtifact(postDstPayload());

  assert.throws(
    () =>
      parseOfficialMarketCalendarEvidenceArtifact(artifact, {
        asOf: "2025-03-11T00:00:00"
      }),
    /explicit timezone offset/
  );
});

test("official calendar evidence rejects offsetless artifact timestamps", () => {
  const artifact = signedArtifact(postDstPayload());
  const invalidArtifacts: unknown[] = [
    {
      ...artifact,
      generatedAt: "2025-03-10T23:00:00"
    },
    {
      ...artifact,
      sources: [
        {
          ...artifact.sources[0],
          retrievedAt: "2024-12-01T00:00:00"
        },
        artifact.sources[1]
      ]
    },
    {
      ...artifact,
      sources: [
        artifact.sources[0],
        {
          ...artifact.sources[1],
          staleAfter: "2026-01-01T00:00:00"
        }
      ]
    },
    {
      ...artifact,
      sessions: [
        {
          ...artifact.sessions[0],
          marketOpen: "2025-03-10T09:00:00"
        },
        artifact.sessions[1]
      ]
    },
    {
      ...artifact,
      sessions: [
        artifact.sessions[0],
        {
          ...artifact.sessions[1],
          marketClose: "2025-03-10T16:00:00"
        }
      ]
    }
  ];

  for (const invalidArtifact of invalidArtifacts) {
    assert.throws(
      () => officialMarketCalendarEvidenceArtifactSchema.parse(invalidArtifact),
      /explicit timezone offset/
    );
  }
});

test("official calendar evidence rejects artifact hash mismatch", () => {
  const artifact = signedArtifact(postDstPayload());

  assert.throws(
    () =>
      parseOfficialMarketCalendarEvidenceArtifact(
        {
          ...artifact,
          artifactHash: hash("f")
        },
        { asOf: "2025-03-11T00:00:00.000Z" }
      ),
    /artifact hash mismatch/
  );
});

test("official calendar evidence rejects duplicate session IDs", () => {
  const payload = postDstPayload();

  assert.throws(
    () =>
      officialMarketCalendarEvidenceArtifactSchema.parse({
        ...payload,
        sessions: [
          payload.sessions[0]!,
          {
            ...payload.sessions[1]!,
            sessionId: payload.sessions[0]!.sessionId
          }
        ],
        artifactHash: hash("f")
      }),
    /sessionId values must be unique/
  );
});

test("official calendar evidence rejects timezone and DST timestamp mismatch", () => {
  const payload = postDstPayload();

  assert.throws(
    () =>
      createOfficialMarketCalendarEvidenceHash({
        ...payload,
        sessions: [
          payload.sessions[0]!,
          {
            ...payload.sessions[1]!,
            marketOpen: "2025-03-10T14:30:00.000Z"
          }
        ]
      }),
    /marketOpen must match the source regular local open time/
  );
});

test("official calendar evidence rejects invalid early close metadata", () => {
  const payload = oneDayPayload({
    sessionDate: "2025-11-28",
    generatedAt: "2025-11-28T22:00:00.000Z",
    krxOpen: "2025-11-28T00:00:00.000Z",
    krxClose: "2025-11-28T06:30:00.000Z",
    nyseOpen: "2025-11-28T14:30:00.000Z",
    nyseClose: "2025-11-28T21:00:00.000Z",
    nyseSessionType: "early_close",
    nyseExceptionName: "synthetic fixture invalid early close"
  });

  assert.throws(
    () => createOfficialMarketCalendarEvidenceHash(payload),
    /early close must close before regular time/
  );
});

test("official calendar evidence rejects observed-session source class", () => {
  const payload = postDstPayload();

  assert.equal(
    officialMarketCalendarEvidenceArtifactSchema.safeParse({
      ...payload,
      sources: [
        {
          ...payload.sources[0],
          evidenceClass: "observed_session_only"
        },
        payload.sources[1]
      ],
      artifactHash: hash("f")
    }).success,
    false
  );
});

function postDstPayload(): OfficialMarketCalendarEvidencePayload {
  return oneDayPayload({
    sessionDate: "2025-03-10",
    generatedAt: "2025-03-10T22:00:00.000Z",
    krxOpen: "2025-03-10T00:00:00.000Z",
    krxClose: "2025-03-10T06:30:00.000Z",
    nyseOpen: "2025-03-10T13:30:00.000Z",
    nyseClose: "2025-03-10T20:00:00.000Z",
    nyseSessionType: "regular",
    nyseExceptionName: null
  });
}

function oneDayPayload(input: {
  sessionDate: string;
  generatedAt: string;
  krxOpen: string;
  krxClose: string;
  nyseOpen: string;
  nyseClose: string;
  nyseSessionType: "regular" | "early_close";
  nyseExceptionName: string | null;
}): OfficialMarketCalendarEvidencePayload {
  return {
    schemaVersion: "official_market_calendar_evidence.v1",
    mode: "paper_only",
    purpose: "official_exchange_calendar_evidence",
    generatedAt: input.generatedAt,
    coverage: {
      startDate: input.sessionDate,
      endDate: input.sessionDate,
      exchanges: ["KRX", "NYSE"]
    },
    sources: [
      source({
        sourceId: "fixture.krx.source",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        openLocalTime: "09:00",
        closeLocalTime: "15:30",
        hashCharacter: "a"
      }),
      source({
        sourceId: "fixture.nyse.source",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        openLocalTime: "09:30",
        closeLocalTime: "16:00",
        hashCharacter: "b"
      })
    ],
    sessions: [
      {
        sessionId: `fixture.krx.${input.sessionDate}`,
        sourceId: "fixture.krx.source",
        exchange: "KRX",
        market: "KR",
        timezone: "Asia/Seoul",
        sessionDate: input.sessionDate,
        sessionType: "regular",
        marketOpen: input.krxOpen,
        marketClose: input.krxClose,
        exceptionName: null
      },
      {
        sessionId: `fixture.nyse.${input.sessionDate}`,
        sourceId: "fixture.nyse.source",
        exchange: "NYSE",
        market: "US",
        timezone: "America/New_York",
        sessionDate: input.sessionDate,
        sessionType: input.nyseSessionType,
        marketOpen: input.nyseOpen,
        marketClose: input.nyseClose,
        exceptionName: input.nyseExceptionName
      }
    ]
  };
}

function closedDayPayload(
  sessionDate: string,
  sessionType: "holiday" | "special_closure"
): OfficialMarketCalendarEvidencePayload {
  const payload = oneDayPayload({
    sessionDate,
    generatedAt: `${sessionDate}T23:00:00.000Z`,
    krxOpen: `${sessionDate}T00:00:00.000Z`,
    krxClose: `${sessionDate}T06:30:00.000Z`,
    nyseOpen: `${sessionDate}T14:30:00.000Z`,
    nyseClose: `${sessionDate}T21:00:00.000Z`,
    nyseSessionType: "regular",
    nyseExceptionName: null
  });
  return {
    ...payload,
    sessions: payload.sessions.map((session) => ({
      ...session,
      sessionType,
      marketOpen: null,
      marketClose: null,
      exceptionName: `synthetic fixture ${sessionType}`
    }))
  };
}

function source(input: {
  sourceId: string;
  exchange: "KRX" | "NYSE";
  market: "KR" | "US";
  timezone: "Asia/Seoul" | "America/New_York";
  openLocalTime: string;
  closeLocalTime: string;
  hashCharacter: string;
}) {
  return {
    sourceId: input.sourceId,
    evidenceClass: "official_exchange" as const,
    exchange: input.exchange,
    market: input.market,
    timezone: input.timezone,
    publisher: `synthetic fixture ${input.exchange} publisher`,
    sourceUrl: `https://example.invalid/${input.exchange.toLowerCase()}-calendar`,
    sourceDocumentHash: hash(input.hashCharacter),
    retrievedAt: "2024-12-01T00:00:00.000Z",
    staleAfter: "2026-01-01T00:00:00.000Z",
    regularSession: {
      openLocalTime: input.openLocalTime,
      closeLocalTime: input.closeLocalTime
    }
  };
}

function signedArtifact(
  payload: OfficialMarketCalendarEvidencePayload
): OfficialMarketCalendarEvidenceArtifact {
  return {
    ...payload,
    artifactHash: createOfficialMarketCalendarEvidenceHash(payload)
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
