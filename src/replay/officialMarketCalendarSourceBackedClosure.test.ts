import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import {
  resolveOfficialMarketCalendarSourceBackedClosure,
  resolveOfficialMarketCalendarSourceBackedClosures
} from "./officialMarketCalendarSourceBackedClosure.js";

test("calendar holiday binds holiday row evidence and schedule coverage", () => {
  const resolved = resolveOfficialMarketCalendarSourceBackedClosure(
    closure("holiday"),
    { collections: [collection()] }
  );

  assert.equal(resolved.closure.sessionType, "holiday");
  assert.equal(resolved.closure.sourceDocumentRefs[0]?.documentId, "nyse.holiday.rows");
  assert.equal(resolved.collectionHash, collection().collectionHash);
});

test("calendar special closure binds closure row evidence and schedule coverage", () => {
  const resolved = resolveOfficialMarketCalendarSourceBackedClosure(
    closure("special_closure"),
    { collections: [collection()] }
  );

  assert.equal(resolved.closure.sessionType, "special_closure");
  assert.equal(
    resolved.closure.sourceDocumentRefs[0]?.documentId,
    "nyse.closure.rows"
  );
});

test("calendar source-backed closure rejects unknown fields and empty name", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        { ...closure("holiday"), inferred: true },
        { collections: [collection()] }
      ),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        { ...closure("holiday"), exceptionName: " " },
        { collections: [collection()] }
      ),
    /Too small|too small/
  );
});

test("calendar source-backed closure rejects row role substitution", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        {
          ...closure("holiday"),
          sourceDocumentRefs: [ref("nyse.closure.rows")]
        },
        { collections: [collection()] }
      ),
    /matching row evidence role/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        {
          ...closure("special_closure"),
          sourceDocumentRefs: [ref("nyse.holiday.rows")]
        },
        { collections: [collection()] }
      ),
    /matching row evidence role/
  );
});

test("calendar source-backed closure rejects completeness document as row evidence", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        {
          ...closure("holiday"),
          sourceDocumentRefs: [ref("nyse.completeness")]
        },
        { collections: [collection()] }
      ),
    /matching row evidence role/
  );
});

test("calendar source-backed closure rejects cross-exchange refs", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        {
          ...closure("holiday"),
          sourceDocumentRefs: [
            {
              exchange: "KRX",
              collectionId: "krx.collection",
              documentId: "nyse.holiday.rows"
            }
          ]
        },
        { collections: [collection(), krxCollection()] }
      ),
    /must not cross exchange boundary/
  );
});

test("calendar source-backed closure rejects refs from multiple collections", () => {
  const other = collection("nyse.other");
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        {
          ...closure("holiday"),
          sourceDocumentRefs: [
            ref("nyse.holiday.rows"),
            {
              exchange: "NYSE",
              collectionId: "nyse.other",
              documentId: "nyse.holiday.rows"
            }
          ]
        },
        { collections: [collection(), other] }
      ),
    /must use one source collection/
  );
});

test("calendar source-backed closure rejects dates outside collection", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosure(
        { ...closure("holiday"), sessionDate: "2026-01-01" },
        { collections: [collection()] }
      ),
    /outside collection coverage/
  );
});

test("calendar source-backed closure rejects weekend dates", () => {
  for (const sessionType of ["holiday", "special_closure"] as const) {
    assert.throws(
      () =>
        resolveOfficialMarketCalendarSourceBackedClosure(
          { ...closure(sessionType), sessionDate: "2025-07-05" },
          { collections: [collection()] }
        ),
      /must not replace a weekend session/
    );
  }
});

test("calendar source-backed closure list rejects order and date conflicts", () => {
  const later = {
    ...closure("holiday"),
    sessionId: "nyse.closed.2025-12-25",
    sessionDate: "2025-12-25"
  };
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosures(
        [later, closure("holiday")],
        { collections: [collection()] }
      ),
    /must use canonical order/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceBackedClosures(
        [
          closure("holiday"),
          {
            ...closure("special_closure"),
            sessionId: "nyse.closed.2025-07-04.z"
          }
        ],
        { collections: [collection()] }
      ),
    /must be unique per exchange date/
  );
});

function closure(sessionType: "holiday" | "special_closure") {
  return {
    schemaVersion: "official_market_calendar_source_backed_closure.v1",
    sessionId: "nyse.closed.2025-07-04",
    exchange: "NYSE",
    sessionDate: "2025-07-04",
    sessionType,
    exceptionName: sessionType === "holiday" ? "Independence Day" : "Official closure",
    sourceDocumentRefs: [
      ref(
        sessionType === "holiday"
          ? "nyse.holiday.rows"
          : "nyse.closure.rows"
      )
    ]
  } as const;
}

function ref(documentId: string) {
  return {
    exchange: "NYSE" as const,
    collectionId: "nyse.collection",
    documentId
  };
}

function collection(
  collectionId = "nyse.collection"
): OfficialMarketCalendarSourceCollection {
  const payload = collectionPayload();
  payload.collectionId = collectionId;
  return sign(payload);
}

function krxCollection(): OfficialMarketCalendarSourceCollection {
  const payload = collectionPayload();
  payload.collectionId = "krx.collection";
  payload.exchange = "KRX";
  payload.requiredExceptionCoverageRoles.contractVersion =
    "krx_exception_coverage.v1";
  return sign(payload);
}

function collectionPayload(): OfficialMarketCalendarSourceCollectionPayload {
  return {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId: "nyse.collection",
    exchange: "NYSE",
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [
      rowDocument("nyse.closure.rows", "special_closure", "a"),
      completenessDocument(),
      rowDocument("nyse.holiday.rows", "holiday_rows", "d"),
      hoursDocument()
    ],
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
}

function rowDocument(
  documentId: string,
  role: "holiday_rows" | "special_closure",
  seed: string
): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId,
    metadataHash: hash(seed),
    sourceDocumentHash: hash(seed === "a" ? "b" : "e"),
    evidenceRoles: [role],
    regularSessionHours: null,
    scheduleCoverageIntervals: [],
    applicabilityStartDate: null,
    applicabilityEndDate: null
  };
}

function completenessDocument(): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId: "nyse.completeness",
    metadataHash: hash("b"),
    sourceDocumentHash: hash("c"),
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
    metadataHash: hash("f"),
    sourceDocumentHash: hash("0"),
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

function sign(
  payload: OfficialMarketCalendarSourceCollectionPayload
): OfficialMarketCalendarSourceCollection {
  return {
    ...payload,
    collectionHash: createOfficialMarketCalendarSourceCollectionHash(payload)
  };
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
