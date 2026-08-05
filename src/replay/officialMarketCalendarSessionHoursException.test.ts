import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import {
  resolveOfficialMarketCalendarSessionHoursException,
  resolveOfficialMarketCalendarSessionHoursExceptions
} from "./officialMarketCalendarSessionHoursException.js";

test("calendar early close preserves regular open and overrides close", () => {
  const resolved = resolveOfficialMarketCalendarSessionHoursException(
    exception("early_close"),
    { collections: [collection()] }
  );

  assert.equal(resolved.regularOpenLocalTime, "09:00");
  assert.equal(resolved.regularCloseLocalTime, "16:00");
  assert.equal(resolved.effectiveOpenLocalTime, "09:00");
  assert.equal(resolved.effectiveCloseLocalTime, "13:00");
});

test("calendar delayed open uses explicit open and close overrides", () => {
  const resolved = resolveOfficialMarketCalendarSessionHoursException(
    exception("delayed_open"),
    { collections: [collection()] }
  );

  assert.equal(resolved.effectiveOpenLocalTime, "11:00");
  assert.equal(resolved.effectiveCloseLocalTime, "16:00");
});

test("calendar exception rejects unknown fields", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        { ...exception("early_close"), inferred: true },
        { collections: [collection()] }
      ),
    /Unrecognized key/
  );
});

test("calendar exception rejects incomplete override shape", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("early_close"),
          openLocalTimeOverride: "10:00"
        },
        { collections: [collection()] }
      ),
    /preserve the regular session open/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("delayed_open"),
          openLocalTimeOverride: null
        },
        { collections: [collection()] }
      ),
    /must declare an open override/
  );
});

test("calendar exception rejects invalid early close boundary", () => {
  for (const closeLocalTimeOverride of ["09:00", "16:00", "17:00"]) {
    assert.throws(
      () =>
        resolveOfficialMarketCalendarSessionHoursException(
          { ...exception("early_close"), closeLocalTimeOverride },
          { collections: [collection()] }
        ),
      /after regular open and before regular close/
    );
  }
});

test("calendar exception rejects invalid delayed open boundary", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("delayed_open"),
          openLocalTimeOverride: "09:00"
        },
        { collections: [collection()] }
      ),
    /must begin after regular open/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("delayed_open"),
          openLocalTimeOverride: "16:00",
          closeLocalTimeOverride: "16:00"
        },
        { collections: [collection()] }
      ),
    /open must be before close/
  );
});

test("calendar exception binds exact date-effective schedule documents", () => {
  const source = collection();
  const payload = withoutHash(source);
  payload.documents.splice(
    1,
    0,
    exceptionDocument("nyse.exception.secondary", "d")
  );
  payload.exceptionScheduleIntervals.find(
    ({ coverageRole }) =>
      coverageRole === "session_hours_exception_schedule"
  )!.documentIds.push("nyse.exception.secondary");
  const expanded = sign(payload);

  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        exception("early_close"),
        { collections: [expanded] }
      ),
    /must match effective schedule provenance/
  );
  assert.doesNotThrow(() =>
    resolveOfficialMarketCalendarSessionHoursException(
      {
        ...exception("early_close"),
        sourceDocumentRefs: [
          ref("nyse.exception.primary"),
          ref("nyse.exception.secondary")
        ]
      },
      { collections: [expanded] }
    )
  );
});

test("calendar exception binds only date-applicable schedule documents", () => {
  const payload = withoutHash(collection());
  const primaryCoverage = payload.documents[0]!.scheduleCoverageIntervals.find(
    ({ coverageRole }) =>
      coverageRole === "session_hours_exception_schedule"
  )!;
  primaryCoverage.endDate = "2025-06-30";
  const secondary = exceptionDocument("nyse.exception.secondary", "d");
  secondary.scheduleCoverageIntervals.find(
    ({ coverageRole }) =>
      coverageRole === "session_hours_exception_schedule"
  )!.startDate = "2025-07-01";
  payload.documents.splice(1, 0, secondary);
  payload.exceptionScheduleIntervals.find(
    ({ coverageRole }) =>
      coverageRole === "session_hours_exception_schedule"
  )!.documentIds.push("nyse.exception.secondary");
  const expanded = sign(payload);

  assert.doesNotThrow(() =>
    resolveOfficialMarketCalendarSessionHoursException(
      {
        ...exception("early_close"),
        sourceDocumentRefs: [ref("nyse.exception.secondary")]
      },
      { collections: [expanded] }
    )
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        exception("early_close"),
        { collections: [expanded] }
      ),
    /must match effective schedule provenance/
  );
});

test("calendar exception rejects regular-session document substitution", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("early_close"),
          sourceDocumentRefs: [ref("nyse.hours")]
        },
        { collections: [collection()] }
      ),
    /must match effective schedule provenance/
  );
});

test("calendar exception rejects cross-exchange and multi-collection refs", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("early_close"),
          sourceDocumentRefs: [
            {
              exchange: "KRX",
              collectionId: "krx.collection",
              documentId: "krx.exception"
            }
          ]
        },
        { collections: [collection(), krxCollection()] }
      ),
    /must not cross exchange boundary/
  );

  const other = collection("nyse.other");
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("early_close"),
          sourceDocumentRefs: [
            ref("nyse.exception.primary"),
            {
              exchange: "NYSE",
              collectionId: "nyse.other",
              documentId: "nyse.exception.primary"
            }
          ]
        },
        { collections: [collection(), other] }
      ),
    /must use one source collection/
  );
});

test("calendar exception rejects date and regime mismatch", () => {
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        { ...exception("early_close"), sessionDate: "2026-01-02" },
        { collections: [collection()] }
      ),
    /outside source collection coverage/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        {
          ...exception("early_close"),
          regularSessionRegimeId: "nyse.missing"
        },
        { collections: [collection()] }
      ),
    /regime is unknown/
  );

  const source = collection();
  const payload = withoutHash(source);
  payload.documents[1]!.applicabilityEndDate = "2025-06-30";
  payload.documents.push({
    ...regularDocument(),
    documentId: "nyse.hours.second",
    metadataHash: hash("e"),
    sourceDocumentHash: hash("f"),
    applicabilityStartDate: "2025-07-01"
  });
  payload.regularSessionRegimes[0]!.effectiveEndDate = "2025-06-30";
  payload.regularSessionRegimes.push({
    ...payload.regularSessionRegimes[0]!,
    regimeId: "nyse.regular.2025.second",
    effectiveStartDate: "2025-07-01",
    effectiveEndDate: null,
    documentIds: ["nyse.hours.second"]
  });
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursException(
        exception("early_close"),
        { collections: [sign(payload)] }
      ),
    /date does not match effective regime/
  );
});

test("calendar exception list rejects non-canonical and conflicting rows", () => {
  const later = {
    ...exception("early_close"),
    exceptionId: "nyse.2025-11-28",
    sessionDate: "2025-11-28"
  };
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursExceptions(
        [later, exception("early_close")],
        { collections: [collection()] }
      ),
    /must use canonical order/
  );
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSessionHoursExceptions(
        [
          exception("early_close"),
          { ...exception("delayed_open"), exceptionId: "nyse.2025-07-03.z" }
        ],
        { collections: [collection()] }
      ),
    /must be unique per exchange date/
  );
});

function exception(exceptionType: "early_close" | "delayed_open") {
  return {
    schemaVersion: "official_market_calendar_session_hours_exception.v1",
    exceptionId: "nyse.2025-07-03",
    exchange: "NYSE",
    sessionDate: "2025-07-03",
    exceptionType,
    openLocalTimeOverride: exceptionType === "delayed_open" ? "11:00" : null,
    closeLocalTimeOverride: exceptionType === "early_close" ? "13:00" : "16:00",
    sourceDocumentRefs: [ref("nyse.exception.primary")],
    regularSessionRegimeId: "nyse.regular.2025"
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
  const payload: OfficialMarketCalendarSourceCollectionPayload = {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId,
    exchange: "NYSE",
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [
      exceptionDocument("nyse.exception.primary", "a"),
      regularDocument()
    ],
    requiredExceptionCoverageRoles: {
      contractVersion: "nyse_exception_coverage.v1",
      roles: [
        "holiday_schedule",
        "session_hours_exception_schedule",
        "special_closure_schedule"
      ]
    },
    exceptionScheduleIntervals: scheduleIntervals("nyse.exception.primary"),
    regularSessionRegimes: [
      {
        regimeId: "nyse.regular.2025",
        effectiveStartDate: "2025-01-01",
        effectiveEndDate: null,
        openLocalTime: "09:00",
        closeLocalTime: "16:00",
        documentIds: ["nyse.hours"]
      }
    ],
    regularSessionSupersessions: []
  };
  return sign(payload);
}

function krxCollection(): OfficialMarketCalendarSourceCollection {
  const payload = withoutHash(collection());
  payload.collectionId = "krx.collection";
  payload.exchange = "KRX";
  payload.requiredExceptionCoverageRoles.contractVersion =
    "krx_exception_coverage.v1";
  payload.documents[0]!.documentId = "krx.exception";
  for (const interval of payload.exceptionScheduleIntervals) {
    interval.documentIds = ["krx.exception"];
  }
  payload.regularSessionRegimes[0]!.regimeId = "krx.regular.2025";
  return sign(payload);
}

function exceptionDocument(
  documentId: string,
  seed: string
): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId,
    metadataHash: hash(seed),
    sourceDocumentHash: hash(seed === "a" ? "b" : "e"),
    evidenceRoles: [
      "holiday_schedule",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ],
    regularSessionHours: null,
    scheduleCoverageIntervals: scheduleIntervals(documentId).map(
      ({ documentIds: _, ...interval }) => interval
    ),
    applicabilityStartDate: null,
    applicabilityEndDate: null
  };
}

function regularDocument(): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
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

function scheduleIntervals(documentId: string) {
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
    documentIds: [documentId]
  }));
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

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
