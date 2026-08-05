import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import {
  resolveOfficialMarketCalendarWeekendSession,
  resolveOfficialMarketCalendarWeekendSessions
} from "./officialMarketCalendarWeekendSession.js";

test("calendar weekend session accepts Gregorian Saturday and Sunday", () => {
  const source = collection();
  for (const sessionDate of ["2025-07-05", "2025-07-06"]) {
    const resolved = resolveOfficialMarketCalendarWeekendSession(
      weekendSession(sessionDate, source),
      { collections: [source] }
    );

    assert.equal(resolved.session.sessionType, "weekend");
    assert.deepEqual(resolved.session.sourceDocumentRefs, []);
    assert.equal(resolved.collection.collectionHash, source.collectionHash);
  }
});

test("calendar weekend session rejects weekday dates", () => {
  const source = collection();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        weekendSession("2025-07-04", source),
        { collections: [source] }
      ),
    /must be Saturday or Sunday/
  );
});

test("calendar weekend session rejects unknown fields and exception names", () => {
  const source = collection();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        { ...weekendSession("2025-07-05", source), inferred: true },
        { collections: [source] }
      ),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        {
          ...weekendSession("2025-07-05", source),
          exceptionName: "Weekend"
        },
        { collections: [source] }
      ),
    /expected null|Invalid input/
  );
});

test("calendar weekend session rejects source document provenance", () => {
  const source = collection();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        {
          ...weekendSession("2025-07-05", source),
          sourceDocumentRefs: [
            {
              exchange: "NYSE",
              collectionId: "nyse.collection",
              documentId: "nyse.completeness"
            }
          ]
        },
        { collections: [source] }
      ),
    /Too big|expected at most 0|Invalid input/
  );
});

test("calendar weekend session rejects collection exchange mismatch", () => {
  const source = collection();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        {
          ...weekendSession("2025-07-05", source),
          sourceCollection: {
            ...weekendSession("2025-07-05", source).sourceCollection,
            exchange: "KRX"
          }
        },
        { collections: [source] }
      ),
    /collection must match exchange/
  );
});

test("calendar weekend session rejects unknown collection and hash mismatch", () => {
  const source = collection();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        {
          ...weekendSession("2025-07-05", source),
          sourceCollection: {
            ...weekendSession("2025-07-05", source).sourceCollection,
            collectionId: "nyse.missing"
          }
        },
        { collections: [source] }
      ),
    /must resolve exactly once/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        {
          ...weekendSession("2025-07-05", source),
          sourceCollection: {
            ...weekendSession("2025-07-05", source).sourceCollection,
            collectionHash: hash("f")
          }
        },
        { collections: [source] }
      ),
    /collection hash mismatch/
  );
});

test("calendar weekend session rejects dates outside collection coverage", () => {
  const source = collection();
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSession(
        weekendSession("2026-01-03", source),
        { collections: [source] }
      ),
    /outside collection coverage/
  );
});

test("calendar weekend session list rejects order and date conflicts", () => {
  const source = collection();
  const saturday = weekendSession("2025-07-05", source);
  const sunday = weekendSession("2025-07-06", source);
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSessions(
        [sunday, saturday],
        { collections: [source] }
      ),
    /must use canonical order/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSessions(
        [
          saturday,
          { ...saturday, sessionId: "nyse.weekend.2025-07-05.z" }
        ],
        { collections: [source] }
      ),
    /must be unique per exchange date/
  );
});

test("calendar weekend session list rejects duplicate session IDs", () => {
  const source = collection();
  const saturday = weekendSession("2025-07-05", source);
  const sunday = {
    ...weekendSession("2025-07-06", source),
    sessionId: saturday.sessionId
  };
  assert.throws(
    () =>
      resolveOfficialMarketCalendarWeekendSessions(
        [saturday, sunday],
        { collections: [source] }
      ),
    /must use unique session IDs/
  );
});

function weekendSession(
  sessionDate: string,
  source: OfficialMarketCalendarSourceCollection
) {
  return {
    schemaVersion: "official_market_calendar_weekend_session.v1",
    sessionId: `nyse.weekend.${sessionDate}`,
    exchange: "NYSE",
    sessionDate,
    sessionType: "weekend",
    exceptionName: null,
    sourceCollection: {
      exchange: "NYSE",
      collectionId: source.collectionId,
      collectionHash: source.collectionHash
    },
    sourceDocumentRefs: []
  } as const;
}

function collection(): OfficialMarketCalendarSourceCollection {
  const payload: OfficialMarketCalendarSourceCollectionPayload = {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId: "nyse.collection",
    exchange: "NYSE",
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [completenessDocument(), hoursDocument()],
    requiredExceptionCoverageRoles: {
      contractVersion: "nyse_exception_coverage.v1",
      roles: [
        "holiday_schedule",
        "session_hours_exception_schedule",
        "special_closure_schedule"
      ]
    },
    exceptionScheduleIntervals: scheduleIntervals().map((interval) => ({
      ...interval,
      documentIds: ["nyse.completeness"]
    })),
    regularSessionRegimes: [
      {
        regimeId: "nyse.regime.2025",
        effectiveStartDate: "2025-01-01",
        effectiveEndDate: null,
        openLocalTime: "09:00",
        closeLocalTime: "16:00",
        documentIds: ["nyse.hours"]
      }
    ],
    regularSessionSupersessions: []
  };
  return {
    ...payload,
    collectionHash: createOfficialMarketCalendarSourceCollectionHash(payload)
  };
}

function completenessDocument(): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId: "nyse.completeness",
    metadataHash: hash("a"),
    sourceDocumentHash: hash("b"),
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

function hoursDocument(): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId: "nyse.hours",
    metadataHash: hash("c"),
    sourceDocumentHash: hash("d"),
    evidenceRoles: ["session_hours"],
    regularSessionHours: {
      openLocalTime: "09:00",
      closeLocalTime: "16:00"
    },
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
