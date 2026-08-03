import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import {
  parseOfficialMarketCalendarSessionProvenance,
  resolveOfficialCalendarSourceDocumentRefs
} from "./officialMarketCalendarSessionProvenance.js";

test("calendar source refs resolve same local document ID by composite scope", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  const nyse = collection("NYSE", "nyse.collection", "shared.document");
  const resolved = resolveOfficialCalendarSourceDocumentRefs(
    [
      ref("KRX", "krx.collection", "shared.document"),
      ref("NYSE", "nyse.collection", "shared.document")
    ],
    [krx, nyse]
  );

  assert.equal(resolved[0]?.metadataHash, krx.documents[0]?.metadataHash);
  assert.equal(resolved[1]?.metadataHash, nyse.documents[0]?.metadataHash);
  assert.notEqual(resolved[0]?.sourceDocumentHash, resolved[1]?.sourceDocumentHash);
});

test("calendar source refs reject unqualified document IDs", () => {
  assert.throws(
    () =>
      resolveOfficialCalendarSourceDocumentRefs(
        ["shared.document"],
        [collection("KRX", "krx.collection", "shared.document")]
      ),
    /expected object|Invalid input/
  );
});

test("calendar source refs reject empty provenance", () => {
  assert.throws(
    () =>
      resolveOfficialCalendarSourceDocumentRefs([], [
        collection("KRX", "krx.collection", "shared.document")
      ]),
    /must not be empty/
  );
});

test("calendar source refs reject duplicate and non-canonical refs", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  for (const refs of [
    [
      ref("KRX", "krx.collection", "shared.document"),
      ref("KRX", "krx.collection", "shared.document")
    ],
    [
      ref("NYSE", "nyse.collection", "shared.document"),
      ref("KRX", "krx.collection", "shared.document")
    ]
  ]) {
    assert.throws(
      () =>
        resolveOfficialCalendarSourceDocumentRefs(refs, [
          krx,
          collection("NYSE", "nyse.collection", "shared.document")
        ]),
      /unique and canonical/
    );
  }
});

test("calendar source refs preserve identifier field boundaries", () => {
  const first = collection("KRX", "alpha", "beta:gamma");
  const second = collection("KRX", "alpha:beta", "gamma");
  const resolved = resolveOfficialCalendarSourceDocumentRefs(
    [
      ref("KRX", "alpha", "beta:gamma"),
      ref("KRX", "alpha:beta", "gamma")
    ],
    [first, second]
  );

  assert.deepEqual(
    resolved.map(({ ref: resolvedRef }) => resolvedRef),
    [
      ref("KRX", "alpha", "beta:gamma"),
      ref("KRX", "alpha:beta", "gamma")
    ]
  );
});

test("calendar source refs reject unknown collection and document", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  assert.throws(
    () =>
      resolveOfficialCalendarSourceDocumentRefs(
        [ref("KRX", "missing", "shared.document")],
        [krx]
      ),
    /collection is unknown/
  );
  assert.throws(
    () =>
      resolveOfficialCalendarSourceDocumentRefs(
        [ref("KRX", "krx.collection", "missing")],
        [krx]
      ),
    /document ref is unknown/
  );
});

test("calendar source refs reject duplicate collection identity", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  assert.throws(
    () =>
      resolveOfficialCalendarSourceDocumentRefs(
        [ref("KRX", "krx.collection", "shared.document")],
        [krx, krx]
      ),
    /collection identity is duplicated/
  );
});

test("calendar session provenance binds effective regime documents", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  const parsed = parseOfficialMarketCalendarSessionProvenance(
    sessionProvenance(),
    { collections: [krx] }
  );

  assert.equal(parsed.regularSessionRegimeId, "krx.regular.2025");
  assert.deepEqual(parsed.sourceDocumentRefs, [
    ref("KRX", "krx.collection", "shared.document")
  ]);
});

test("calendar session provenance binds only date-applicable regime documents", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  const payload = withoutHash(krx);
  payload.documents[0]!.applicabilityEndDate = "2025-09-30";
  payload.documents.push(document("zz.document", "b", "15:30"));
  payload.documents[1]!.applicabilityStartDate = "2025-10-01";
  payload.regularSessionRegimes[0]!.documentIds.push("zz.document");
  const expanded = sign(payload);

  assert.doesNotThrow(() =>
    parseOfficialMarketCalendarSessionProvenance(sessionProvenance(), {
      collections: [expanded]
    })
  );
  assert.doesNotThrow(() =>
    parseOfficialMarketCalendarSessionProvenance(
      {
        ...sessionProvenance(),
        sessionId: "krx.2025-10-02",
        sessionDate: "2025-10-02",
        sourceDocumentRefs: [
          ref("KRX", "krx.collection", "zz.document")
        ]
      },
      { collections: [expanded] }
    )
  );
});

test("calendar session provenance applies supersession-derived document end", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  const payload = withoutHash(krx);
  payload.documents[0]!.regularSessionHours!.closeLocalTime = "15:00";
  payload.documents.push(document("zz.document", "b", "15:30"));
  payload.documents[1]!.applicabilityStartDate = "2025-07-01";
  payload.regularSessionRegimes = [
    {
      regimeId: "krx.regular.1500",
      effectiveStartDate: "2025-01-01",
      effectiveEndDate: "2025-06-30",
      openLocalTime: "09:00",
      closeLocalTime: "15:00",
      documentIds: ["shared.document"]
    },
    {
      regimeId: "krx.regular.1530",
      effectiveStartDate: "2025-07-01",
      effectiveEndDate: null,
      openLocalTime: "09:00",
      closeLocalTime: "15:30",
      documentIds: ["zz.document"]
    }
  ];
  payload.regularSessionSupersessions = [
    {
      supersessionId: "krx.2025-07-01",
      supersededRegimeId: "krx.regular.1500",
      replacementRegimeId: "krx.regular.1530",
      supersededDocumentIds: ["shared.document"],
      replacementDocumentIds: ["zz.document"],
      replacementEffectiveStartDate: "2025-07-01",
      derivedSupersededEndDate: "2025-06-30"
    }
  ];
  const transitioned = sign(payload);

  assert.doesNotThrow(() =>
    parseOfficialMarketCalendarSessionProvenance(
      {
        ...sessionProvenance(),
        sessionId: "krx.2025-06-30",
        sessionDate: "2025-06-30",
        regularSessionRegimeId: "krx.regular.1500"
      },
      { collections: [transitioned] }
    )
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarSessionProvenance(
        {
          ...sessionProvenance(),
          sessionId: "krx.2025-07-01-old",
          sessionDate: "2025-07-01",
          regularSessionRegimeId: "krx.regular.1500"
        },
        { collections: [transitioned] }
      ),
    /does not match effective regime/
  );
});

test("calendar session provenance rejects cross-exchange refs", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  const nyse = collection("NYSE", "nyse.collection", "shared.document");
  assert.throws(
    () =>
      parseOfficialMarketCalendarSessionProvenance(
        {
          ...sessionProvenance(),
          sourceDocumentRefs: [
            ref("NYSE", "nyse.collection", "shared.document")
          ]
        },
        { collections: [krx, nyse] }
      ),
    /must not cross exchange boundary/
  );
});

test("calendar session provenance rejects ineffective regime", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  assert.throws(
    () =>
      parseOfficialMarketCalendarSessionProvenance(
        { ...sessionProvenance(), sessionDate: "2026-01-01" },
        { collections: [krx] }
      ),
    /outside source collection coverage|does not match effective regime/
  );
});

test("calendar session provenance rejects incomplete regime provenance", () => {
  const krx = collection("KRX", "krx.collection", "shared.document");
  const extra = document("zz.document", "b", "15:30");
  const payload = withoutHash(krx);
  payload.documents.push(extra);
  payload.regularSessionRegimes[0]!.documentIds.push(extra.documentId);
  const expanded = sign(payload);

  assert.throws(
    () =>
      parseOfficialMarketCalendarSessionProvenance(sessionProvenance(), {
        collections: [expanded]
      }),
    /must match effective regime provenance/
  );
});

function sessionProvenance() {
  return {
    schemaVersion: "official_market_calendar_session_provenance.v1",
    sessionId: "krx.2025-01-02",
    exchange: "KRX",
    sessionDate: "2025-01-02",
    sourceDocumentRefs: [
      ref("KRX", "krx.collection", "shared.document")
    ],
    regularSessionRegimeId: "krx.regular.2025"
  } as const;
}

function ref(exchange: "KRX" | "NYSE", collectionId: string, documentId: string) {
  return { exchange, collectionId, documentId };
}

function collection(
  exchange: "KRX" | "NYSE",
  collectionId: string,
  documentId: string
): OfficialMarketCalendarSourceCollection {
  const marketClose = exchange === "KRX" ? "15:30" : "16:00";
  const payload: OfficialMarketCalendarSourceCollectionPayload = {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId,
    exchange,
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [document(documentId, exchange === "KRX" ? "a" : "c", marketClose)],
    requiredExceptionCoverageRoles: {
      contractVersion:
        exchange === "KRX"
          ? "krx_exception_coverage.v1"
          : "nyse_exception_coverage.v1",
      roles: [
        "holiday_schedule",
        "session_hours_exception_schedule",
        "special_closure_schedule"
      ]
    },
    exceptionScheduleIntervals: [
      ...scheduleIntervals(documentId)
    ],
    regularSessionRegimes: [
      {
        regimeId:
          exchange === "KRX" ? "krx.regular.2025" : "nyse.regular.2025",
        effectiveStartDate: "2025-01-01",
        effectiveEndDate: null,
        openLocalTime: "09:00",
        closeLocalTime: marketClose,
        documentIds: [documentId]
      }
    ],
    regularSessionSupersessions: []
  };
  return sign(payload);
}

function document(
  documentId: string,
  seed: string,
  closeLocalTime: string
): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  return {
    documentId,
    metadataHash: hash(seed),
    sourceDocumentHash: hash(seed === "a" ? "b" : "d"),
    evidenceRoles: [
      "holiday_schedule",
      "session_hours",
      "session_hours_exception_schedule",
      "special_closure_schedule"
    ],
    regularSessionHours: {
      openLocalTime: "09:00",
      closeLocalTime
    },
    scheduleCoverageIntervals: [
      ...scheduleIntervals(documentId).map(({ documentIds: _, ...interval }) =>
        interval
      )
    ],
    applicabilityStartDate: "2025-01-01",
    applicabilityEndDate: null
  };
}

function scheduleIntervals(documentId: string) {
  return [
    {
      coverageRole: "holiday_schedule" as const,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      documentIds: [documentId]
    },
    {
      coverageRole: "session_hours_exception_schedule" as const,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      documentIds: [documentId]
    },
    {
      coverageRole: "special_closure_schedule" as const,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      documentIds: [documentId]
    }
  ];
}

function withoutHash(
  collection: OfficialMarketCalendarSourceCollection
): OfficialMarketCalendarSourceCollectionPayload {
  const { collectionHash: _, ...payload } = collection;
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
