import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import { resolveOfficialMarketCalendarSessionSet } from "./officialMarketCalendarSessionSet.js";

test("calendar session set requires one weekend session per exchange date", () => {
  const fixture = fixtures();
  const resolved = resolveOfficialMarketCalendarSessionSet(
    sessionSet(fixture.collections),
    fixture
  );

  assert.equal(resolved.sessionSet.weekendSessions.length, 4);
  assert.deepEqual(
    resolved.sourceCollections.map(({ exchange }) => exchange),
    ["KRX", "NYSE"]
  );
});

test("calendar session set rejects missing exchange-date coverage", () => {
  const fixture = fixtures();
  const value = sessionSet(fixture.collections);
  value.weekendSessions.pop();

  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(value, fixture),
    /is missing NYSE:2025-07-06/
  );
});

test("calendar session set rejects sessions outside root coverage", () => {
  const fixture = fixtures();
  const value = sessionSet(fixture.collections);
  value.weekendSessions.push(
    weekendSession("NYSE", "2025-07-12", fixture.collections[1]!)
  );

  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(value, fixture),
    /contains a date outside coverage/
  );
});

test("calendar session set rejects open session replacing a weekend", () => {
  const fixture = fixtures();
  const value = sessionSet(fixture.collections);
  value.weekendSessions = value.weekendSessions.filter(
    ({ exchange, sessionDate }) =>
      exchange !== "NYSE" || sessionDate !== "2025-07-05"
  );
  value.openSessions.push(openSession());
  fixture.sessionProvenances.push(provenance());

  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(value, fixture),
    /weekend dates must use weekend sessions/
  );
});

test("calendar session set rejects duplicate global session IDs", () => {
  const fixture = fixtures();
  const value = sessionSet(fixture.collections);
  value.weekendSessions = value.weekendSessions.filter(
    ({ exchange, sessionDate }) =>
      exchange !== "NYSE" || sessionDate !== "2025-07-05"
  );
  const duplicateId = value.weekendSessions[0]!.sessionId;
  value.openSessions.push({ ...openSession(), sessionId: duplicateId });
  fixture.sessionProvenances.push({
    ...provenance(),
    sessionId: duplicateId
  });

  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(value, fixture),
    /must use unique session IDs/
  );
});

test("calendar session set rejects collection hash and identity mismatch", () => {
  const fixture = fixtures();
  const hashMismatch = sessionSet(fixture.collections);
  hashMismatch.sourceCollections[1].collectionHash = hash("f");
  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(hashMismatch, fixture),
    /collection hash mismatch/
  );

  const missing = sessionSet(fixture.collections);
  missing.sourceCollections[1].collectionId = "nyse.missing";
  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(missing, fixture),
    /collection must resolve exactly once/
  );
});

test("calendar session set rejects duplicate selected collection identity", () => {
  const fixture = fixtures();
  fixture.collections.push(fixture.collections[1]!);

  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionSet(
        sessionSet(fixture.collections.slice(0, 2)),
        fixture
      ),
    /collection must resolve exactly once/
  );
});

test("calendar session set rejects coverage beyond source collection", () => {
  const fixture = fixtures();
  const value = sessionSet(fixture.collections);
  value.coverage.endDate = "2026-01-01";

  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(value, fixture),
    /coverage exceeds source collection/
  );
});

test("calendar session set rejects unknown fields and reversed coverage", () => {
  const fixture = fixtures();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionSet(
        { ...sessionSet(fixture.collections), inferred: true },
        fixture
      ),
    /Unrecognized key/
  );
  const reversed = sessionSet(fixture.collections);
  reversed.coverage.startDate = "2025-07-06";
  reversed.coverage.endDate = "2025-07-05";
  assert.throws(
    () => resolveOfficialMarketCalendarSessionSet(reversed, fixture),
    /coverage start must not follow end/
  );
});

function sessionSet(
  collections: readonly OfficialMarketCalendarSourceCollection[]
) {
  return {
    schemaVersion: "official_market_calendar_session_set.v1",
    coverage: {
      startDate: "2025-07-05",
      endDate: "2025-07-06",
      exchanges: ["KRX", "NYSE"] as ["KRX", "NYSE"]
    },
    sourceCollections: [
      collectionRef(collections[0]!),
      collectionRef(collections[1]!)
    ] as [ReturnType<typeof collectionRef>, ReturnType<typeof collectionRef>],
    openSessions: [] as ReturnType<typeof openSession>[],
    sourceBackedClosures: [],
    weekendSessions: [
      weekendSession("KRX", "2025-07-05", collections[0]!),
      weekendSession("KRX", "2025-07-06", collections[0]!),
      weekendSession("NYSE", "2025-07-05", collections[1]!),
      weekendSession("NYSE", "2025-07-06", collections[1]!)
    ]
  };
}

function collectionRef(collection: OfficialMarketCalendarSourceCollection) {
  return {
    exchange: collection.exchange,
    collectionId: collection.collectionId,
    collectionHash: collection.collectionHash
  };
}

function weekendSession(
  exchange: "KRX" | "NYSE",
  sessionDate: string,
  collection: OfficialMarketCalendarSourceCollection
) {
  return {
    schemaVersion: "official_market_calendar_weekend_session.v1" as const,
    sessionId: `${exchange.toLowerCase()}.weekend.${sessionDate}`,
    exchange,
    sessionDate,
    sessionType: "weekend" as const,
    exceptionName: null,
    sourceCollection: collectionRef(collection),
    sourceDocumentRefs: [] as []
  };
}

function openSession() {
  return {
    schemaVersion: "official_market_calendar_open_session.v1" as const,
    sessionId: "nyse.open.2025-07-05",
    exchange: "NYSE" as const,
    sessionDate: "2025-07-05",
    sessionType: "regular" as const,
    openLocalTime: "09:00",
    closeLocalTime: "16:00",
    sourceDocumentRefs: [ref("NYSE", "nyse.hours")],
    regularSessionRegimeId: "nyse.regime.2025",
    sessionHoursExceptionId: null
  };
}

function provenance() {
  return {
    schemaVersion: "official_market_calendar_session_provenance.v1",
    sessionId: "nyse.open.2025-07-05",
    exchange: "NYSE",
    sessionDate: "2025-07-05",
    sourceDocumentRefs: [ref("NYSE", "nyse.hours")],
    regularSessionRegimeId: "nyse.regime.2025"
  };
}

function ref(exchange: "KRX" | "NYSE", documentId: string) {
  return {
    exchange,
    collectionId: `${exchange.toLowerCase()}.collection`,
    documentId
  };
}

function fixtures(): {
  collections: OfficialMarketCalendarSourceCollection[];
  sessionProvenances: unknown[];
  sessionHoursExceptions: unknown[];
} {
  return {
    collections: [collection("KRX"), collection("NYSE")],
    sessionProvenances: [],
    sessionHoursExceptions: []
  };
}

function collection(
  exchange: "KRX" | "NYSE"
): OfficialMarketCalendarSourceCollection {
  const prefix = exchange.toLowerCase();
  const closeLocalTime = exchange === "KRX" ? "15:30" : "16:00";
  const payload: OfficialMarketCalendarSourceCollectionPayload = {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId: `${prefix}.collection`,
    exchange,
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [
      completenessDocument(prefix),
      hoursDocument(prefix, closeLocalTime)
    ],
    requiredExceptionCoverageRoles: {
      contractVersion: `${prefix}_exception_coverage.v1`,
      roles: [
        "holiday_schedule",
        "session_hours_exception_schedule",
        "special_closure_schedule"
      ]
    },
    exceptionScheduleIntervals: scheduleIntervals().map((interval) => ({
      ...interval,
      documentIds: [`${prefix}.completeness`]
    })),
    regularSessionRegimes: [
      {
        regimeId: `${prefix}.regime.2025`,
        effectiveStartDate: "2025-01-01",
        effectiveEndDate: null,
        openLocalTime: "09:00",
        closeLocalTime,
        documentIds: [`${prefix}.hours`]
      }
    ],
    regularSessionSupersessions: []
  };
  return {
    ...payload,
    collectionHash: createOfficialMarketCalendarSourceCollectionHash(payload)
  };
}

function completenessDocument(
  prefix: string
): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId: `${prefix}.completeness`,
    metadataHash: hash(prefix === "krx" ? "a" : "b"),
    sourceDocumentHash: hash(prefix === "krx" ? "c" : "d"),
    evidenceRoles: [
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ],
    regularSessionHours: null,
    scheduleCoverageIntervals: scheduleIntervals(),
    applicabilityStartDate: null,
    applicabilityEndDate: null
  };
}

function hoursDocument(
  prefix: string,
  closeLocalTime: string
): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId: `${prefix}.hours`,
    metadataHash: hash(prefix === "krx" ? "e" : "f"),
    sourceDocumentHash: hash(prefix === "krx" ? "0" : "1"),
    evidenceRoles: ["session_hours"],
    regularSessionHours: { openLocalTime: "09:00", closeLocalTime },
    scheduleCoverageIntervals: [],
    applicabilityStartDate: "2025-01-01",
    applicabilityEndDate: null
  };
}

function scheduleIntervals() {
  return [
    "holiday_schedule",
    "session_hours_exception_schedule",
    "special_closure_schedule"
  ].map((coverageRole) => ({
    coverageRole: coverageRole as
      | "holiday_schedule"
      | "session_hours_exception_schedule"
      | "special_closure_schedule",
    startDate: "2025-01-01",
    endDate: "2025-12-31"
  }));
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
