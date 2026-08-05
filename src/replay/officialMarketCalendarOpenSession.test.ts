import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import {
  resolveOfficialMarketCalendarOpenSession,
  resolveOfficialMarketCalendarOpenSessions
} from "./officialMarketCalendarOpenSession.js";

test("calendar regular session binds regime hours and provenance", () => {
  const resolved = resolveOfficialMarketCalendarOpenSession(
    session("regular"),
    options()
  );

  assert.equal(resolved.session.openLocalTime, "09:00");
  assert.equal(resolved.session.closeLocalTime, "16:00");
  assert.equal(resolved.sessionHoursException, null);
});

test("calendar early close binds exception ID, hours, and ref union", () => {
  const resolved = resolveOfficialMarketCalendarOpenSession(
    session("early_close"),
    options("early_close")
  );

  assert.equal(
    resolved.sessionHoursException?.exception.exceptionId,
    "nyse.exception.2025-07-03"
  );
  assert.deepEqual(resolved.session.sourceDocumentRefs, [
    ref("nyse.exception"),
    ref("nyse.hours")
  ]);
});

test("calendar delayed open preserves explicit effective hours", () => {
  const resolved = resolveOfficialMarketCalendarOpenSession(
    session("delayed_open"),
    options("delayed_open")
  );

  assert.equal(resolved.session.openLocalTime, "11:00");
  assert.equal(resolved.session.closeLocalTime, "16:00");
});

test("calendar session rejects unknown fields and invalid exception shape", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        { ...session("regular"), inferred: true },
        options()
      ),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        {
          ...session("regular"),
          sessionHoursExceptionId: "nyse.exception.2025-07-03"
        },
        options()
      ),
    /only non-regular open sessions/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        { ...session("early_close"), sessionHoursExceptionId: null },
        options("early_close")
      ),
    /only non-regular open sessions/
  );
});

test("calendar regular session rejects available date exception", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        session("regular"),
        options("early_close")
      ),
    /regular session must not have a session hours exception/
  );
});

test("calendar non-regular session rejects missing or wrong exception", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        session("early_close"),
        options()
      ),
    /exception must resolve exactly once/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        {
          ...session("early_close"),
          sessionHoursExceptionId: "nyse.exception.missing"
        },
        options("early_close")
      ),
    /exception must resolve exactly once/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        session("early_close"),
        options("delayed_open")
      ),
    /must match exception type and regime/
  );
});

test("calendar session rejects incomplete, extra, and non-canonical ref union", () => {
  for (const sourceDocumentRefs of [
    [ref("nyse.hours")],
    [ref("nyse.exception"), ref("nyse.hours"), ref("nyse.unrelated")],
    [ref("nyse.hours"), ref("nyse.exception")]
  ]) {
    const fixture = options("early_close");
    if (sourceDocumentRefs.some(({ documentId }) => documentId === "nyse.unrelated")) {
      fixture.collections = [collection(true)];
    }
    assert.throws(
      () =>
        resolveOfficialMarketCalendarOpenSession(
          { ...session("early_close"), sourceDocumentRefs },
          fixture
        ),
      /canonical evidence union|unique and canonical/
    );
  }
});

test("calendar session rejects regime and exception from different collections", () => {
  const otherPayload = withoutHash(collection());
  otherPayload.collectionId = "nyse.other";
  const fixture = options();
  fixture.collections.push(sign(otherPayload));
  fixture.sessionHoursExceptions = [
    {
      ...exception("early_close"),
      sourceDocumentRefs: [ref("nyse.exception", "nyse.other")]
    }
  ];

  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        {
          ...session("early_close"),
          sourceDocumentRefs: [
            ref("nyse.hours"),
            ref("nyse.exception", "nyse.other")
          ]
        },
        fixture
      ),
    /evidence must use one source collection/
  );
});

test("calendar session rejects provenance identity and regime mismatch", () => {
  const missing = options();
  missing.sessionProvenances = [];
  assert.throws(
    () => resolveOfficialMarketCalendarOpenSession(session("regular"), missing),
    /provenance must resolve exactly once/
  );

  const duplicate = options();
  duplicate.sessionProvenances = [provenance(), provenance()];
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(session("regular"), duplicate),
    /provenance must resolve exactly once/
  );

  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        {
          ...session("regular"),
          regularSessionRegimeId: "nyse.regime.other"
        },
        options()
      ),
    /regime must match session provenance/
  );
});

test("calendar session rejects hours that differ from effective evidence", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        { ...session("regular"), closeLocalTime: "15:00" },
        options()
      ),
    /hours must match effective source evidence/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSession(
        { ...session("early_close"), closeLocalTime: "14:00" },
        options("early_close")
      ),
    /hours must match effective source evidence/
  );
});

test("calendar session list rejects non-canonical and duplicate exchange dates", () => {
  const next = {
    ...session("regular"),
    sessionId: "nyse.session.2025-07-04",
    sessionDate: "2025-07-04"
  };
  const fixture = options();
  fixture.sessionProvenances.push({
    ...provenance(),
    sessionId: "nyse.session.2025-07-04",
    sessionDate: "2025-07-04"
  });
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSessions(
        [next, session("regular")],
        fixture
      ),
    /must use canonical order/
  );

  const duplicate = {
    ...session("regular"),
    sessionId: "nyse.session.2025-07-03.z"
  };
  const duplicateFixture = options();
  duplicateFixture.sessionProvenances.push({
    ...provenance(),
    sessionId: "nyse.session.2025-07-03.z"
  });
  assert.throws(
    () =>
      resolveOfficialMarketCalendarOpenSessions(
        [session("regular"), duplicate],
        duplicateFixture
      ),
    /must be unique per exchange date/
  );
});

function session(
  sessionType: "regular" | "early_close" | "delayed_open"
) {
  const nonRegular = sessionType !== "regular";
  return {
    schemaVersion: "official_market_calendar_open_session.v1",
    sessionId: "nyse.session.2025-07-03",
    exchange: "NYSE",
    sessionDate: "2025-07-03",
    sessionType,
    openLocalTime: sessionType === "delayed_open" ? "11:00" : "09:00",
    closeLocalTime: sessionType === "early_close" ? "13:00" : "16:00",
    sourceDocumentRefs: nonRegular
      ? [ref("nyse.exception"), ref("nyse.hours")]
      : [ref("nyse.hours")],
    regularSessionRegimeId: "nyse.regime.2025",
    sessionHoursExceptionId: nonRegular
      ? "nyse.exception.2025-07-03"
      : null
  } as const;
}

function provenance() {
  return {
    schemaVersion: "official_market_calendar_session_provenance.v1",
    sessionId: "nyse.session.2025-07-03",
    exchange: "NYSE",
    sessionDate: "2025-07-03",
    sourceDocumentRefs: [ref("nyse.hours")],
    regularSessionRegimeId: "nyse.regime.2025"
  } as const;
}

function exception(exceptionType: "early_close" | "delayed_open") {
  return {
    schemaVersion: "official_market_calendar_session_hours_exception.v1",
    exceptionId: "nyse.exception.2025-07-03",
    exchange: "NYSE",
    sessionDate: "2025-07-03",
    exceptionType,
    openLocalTimeOverride: exceptionType === "delayed_open" ? "11:00" : null,
    closeLocalTimeOverride: exceptionType === "early_close" ? "13:00" : "16:00",
    sourceDocumentRefs: [ref("nyse.exception")],
    regularSessionRegimeId: "nyse.regime.2025"
  } as const;
}

function options(
  exceptionType?: "early_close" | "delayed_open"
): {
  collections: unknown[];
  sessionProvenances: unknown[];
  sessionHoursExceptions: unknown[];
} {
  return {
    collections: [collection()],
    sessionProvenances: [provenance()],
    sessionHoursExceptions:
      exceptionType === undefined ? [] : [exception(exceptionType)]
  };
}

function ref(documentId: string, collectionId = "nyse.collection") {
  return {
    exchange: "NYSE" as const,
    collectionId,
    documentId
  };
}

function collection(
  includeUnrelated = false
): OfficialMarketCalendarSourceCollection {
  const payload: OfficialMarketCalendarSourceCollectionPayload = {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId: "nyse.collection",
    exchange: "NYSE",
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [
      scheduleDocument(),
      hoursDocument(),
      ...(includeUnrelated ? [unrelatedDocument()] : [])
    ],
    requiredExceptionCoverageRoles: {
      contractVersion: "nyse_exception_coverage.v1",
      roles: [
        "holiday_schedule",
        "session_hours_exception_schedule",
        "special_closure_schedule"
      ]
    },
    exceptionScheduleIntervals: scheduleIntervals(),
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

function withoutHash(
  value: OfficialMarketCalendarSourceCollection
): OfficialMarketCalendarSourceCollectionPayload {
  const { collectionHash: _, ...payload } = value;
  return structuredClone(payload);
}

function sign(
  payload: OfficialMarketCalendarSourceCollectionPayload
): OfficialMarketCalendarSourceCollection {
  return {
    ...payload,
    collectionHash: createOfficialMarketCalendarSourceCollectionHash(payload)
  };
}

function scheduleDocument(): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId: "nyse.exception",
    metadataHash: hash("a"),
    sourceDocumentHash: hash("b"),
    evidenceRoles: [
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ],
    regularSessionHours: null,
    scheduleCoverageIntervals: scheduleIntervals().map(
      ({ documentIds: _, ...interval }) => interval
    ),
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

function unrelatedDocument(): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    ...hoursDocument(),
    documentId: "nyse.unrelated",
    metadataHash: hash("e"),
    sourceDocumentHash: hash("f")
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
    endDate: "2025-12-31",
    documentIds: ["nyse.exception"]
  }));
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
