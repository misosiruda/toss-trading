import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  parseOfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";

test("official calendar source collection preserves multi-document regimes", () => {
  const parsed = parseOfficialMarketCalendarSourceCollection(signedCollection());

  assert.equal(parsed.documents.length, 4);
  assert.deepEqual(
    parsed.regularSessionRegimes.map((regime) => regime.regimeId),
    ["krx.regular.1500", "krx.regular.1530"]
  );
  assert.equal(
    parsed.regularSessionSupersessions[0]?.derivedSupersededEndDate,
    "2016-07-31"
  );
});

test("official calendar source collection rejects unknown fields", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceCollection({
        ...signedCollection(),
        unverified: true
      }),
    /Unrecognized key/
  );
});

test("official calendar source collection rejects hash mismatch", () => {
  assert.throws(
    () =>
      parseOfficialMarketCalendarSourceCollection({
        ...signedCollection(),
        collectionHash: hash("f")
      }),
    /source collection hash mismatch/
  );
});

test("official calendar source collection rejects unknown document references", () => {
  const payload = collectionPayload();
  payload.exceptionScheduleIntervals[0]!.documentIds = ["missing"];
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /exception interval document must exist/
  );
});

test("official calendar source collection rejects role substitution", () => {
  const payload = collectionPayload();
  payload.exceptionScheduleIntervals[0]!.documentIds = ["krx.special"];
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /declare its coverage role/
  );
});

test("official calendar source collection rejects reduced exchange coverage contract", () => {
  const payload = collectionPayload();
  payload.requiredExceptionCoverageRoles.roles = ["holiday_schedule"];
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /coverage contract does not match exchange registry/
  );
});

test("official calendar source collection rejects unregistered coverage contract version", () => {
  const payload = collectionPayload();
  payload.requiredExceptionCoverageRoles.contractVersion =
    "krx_exception_coverage.v2";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /coverage contract does not match exchange registry/
  );
});

test("official calendar source collection binds intervals to document role coverage", () => {
  const payload = collectionPayload();
  payload.documents[0]!.scheduleCoverageIntervals[0]!.endDate = "2016-06-30";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /exceeds referenced document role coverage/
  );
});

test("official calendar source collection binds regime hours to source documents", () => {
  const payload = collectionPayload();
  payload.regularSessionRegimes[0]!.closeLocalTime = "15:10";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /regime hours must match every referenced session_hours document/
  );
});

test("official calendar source collection rejects non-ASCII identifiers", () => {
  const payload = collectionPayload();
  payload.documents[0]!.documentId = "krx.휴일";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /identifier must use the registered ASCII grammar/
  );
});

test("official calendar source collection rejects coverage gaps", () => {
  const payload = collectionPayload();
  payload.exceptionScheduleIntervals[0]!.startDate = "2016-01-02";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /required exception role has a coverage gap/
  );
});

test("official calendar source collection rejects internal role coverage gaps", () => {
  const payload = collectionPayload();
  payload.exceptionScheduleIntervals.splice(
    0,
    1,
    {
      coverageRole: "holiday_schedule",
      startDate: "2016-01-01",
      endDate: "2016-06-30",
      documentIds: ["krx.holidays"]
    },
    {
      coverageRole: "holiday_schedule",
      startDate: "2016-07-02",
      endDate: "2016-12-31",
      documentIds: ["krx.holidays"]
    }
  );
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /coverage gap/
  );
});

test("official calendar source collection rejects regime applicability gaps", () => {
  const payload = collectionPayload();
  payload.documents[2]!.applicabilityStartDate = "2016-08-02";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /applicability union must cover the regime without gaps/
  );
});

test("official calendar source collection accepts contiguous multi-document regime applicability", () => {
  const payload = collectionPayload();
  const replacement = payload.documents[2]!;
  replacement.applicabilityEndDate = "2016-09-30";
  payload.documents.splice(
    3,
    0,
    document("krx.hours.1530.continued", ["session_hours"], "2016-10-01", null)
  );
  payload.regularSessionRegimes[1]!.documentIds = [
    "krx.hours.1530",
    "krx.hours.1530.continued"
  ];

  assert.doesNotThrow(() => createOfficialMarketCalendarSourceCollectionHash(payload));
});

test("official calendar source collection accepts overlapping corroborating regime evidence", () => {
  const payload = collectionPayload();
  payload.documents.splice(
    3,
    0,
    document(
      "krx.hours.1530.corroborating",
      ["session_hours"],
      "2016-08-01",
      null
    )
  );
  payload.regularSessionRegimes[1]!.documentIds = [
    "krx.hours.1530",
    "krx.hours.1530.corroborating"
  ];
  payload.regularSessionSupersessions[0]!.replacementDocumentIds = [
    "krx.hours.1530",
    "krx.hours.1530.corroborating"
  ];

  assert.doesNotThrow(() =>
    createOfficialMarketCalendarSourceCollectionHash(payload)
  );
});

test("official calendar source collection rejects unresolved open-ended regime overlap", () => {
  const payload = collectionPayload();
  payload.regularSessionSupersessions = [];
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /extends outside regime without supersession/
  );
});

test("official calendar source collection rejects ambiguous regime boundaries", () => {
  const payload = collectionPayload();
  payload.regularSessionRegimes[0]!.effectiveEndDate = "2016-08-01";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /without gaps or overlap|supersession boundary/
  );
});

test("official calendar source collection derives supersession boundary exactly", () => {
  const payload = collectionPayload();
  payload.regularSessionSupersessions[0]!.derivedSupersededEndDate =
    "2016-07-30";
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /immediately precede replacement start/
  );
});

test("official calendar source collection binds supersession documents to regimes", () => {
  const payload = collectionPayload();
  payload.regularSessionSupersessions[0]!.replacementDocumentIds = [
    "krx.hours.1500"
  ];
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /supersession documents must belong to their referenced regimes/
  );
});

test("official calendar source collection requires supersession documents at boundary", () => {
  const payload = collectionPayload();
  payload.documents[1]!.applicabilityEndDate = "2016-06-30";
  payload.documents.splice(
    2,
    0,
    document(
      "krx.hours.1500.continued",
      ["session_hours"],
      "2016-07-01",
      "2016-07-31"
    )
  );
  payload.regularSessionRegimes[0]!.documentIds = [
    "krx.hours.1500",
    "krx.hours.1500.continued"
  ];
  assert.throws(
    () => createOfficialMarketCalendarSourceCollectionHash(payload),
    /superseded documents must cover the derived boundary date/
  );
});

function signedCollection() {
  const payload = collectionPayload();
  return {
    ...payload,
    collectionHash: createOfficialMarketCalendarSourceCollectionHash(payload)
  };
}

function collectionPayload(): OfficialMarketCalendarSourceCollectionPayload {
  return {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId: "krx.synthetic.2016",
    exchange: "KRX",
    coverageStartDate: "2016-01-01",
    coverageEndDate: "2016-12-31",
    documents: [
      document("krx.holidays", ["holiday_rows", "holiday_schedule"], null, null),
      document("krx.hours.1500", ["session_hours"], "2016-01-01", null),
      document("krx.hours.1530", ["session_hours"], "2016-08-01", null),
      document(
        "krx.special",
        [
          "session_hours_exception_schedule",
          "special_closure",
          "special_closure_schedule"
        ],
        null,
        null
      )
    ],
    requiredExceptionCoverageRoles: {
      contractVersion: "krx_exception_coverage.v1",
      roles: [
        "holiday_schedule",
        "session_hours_exception_schedule",
        "special_closure_schedule"
      ]
    },
    exceptionScheduleIntervals: [
      {
        coverageRole: "holiday_schedule",
        startDate: "2016-01-01",
        endDate: "2016-12-31",
        documentIds: ["krx.holidays"]
      },
      {
        coverageRole: "session_hours_exception_schedule",
        startDate: "2016-01-01",
        endDate: "2016-12-31",
        documentIds: ["krx.special"]
      },
      {
        coverageRole: "special_closure_schedule",
        startDate: "2016-01-01",
        endDate: "2016-12-31",
        documentIds: ["krx.special"]
      }
    ],
    regularSessionRegimes: [
      {
        regimeId: "krx.regular.1500",
        effectiveStartDate: "2016-01-01",
        effectiveEndDate: "2016-07-31",
        openLocalTime: "09:00",
        closeLocalTime: "15:00",
        documentIds: ["krx.hours.1500"]
      },
      {
        regimeId: "krx.regular.1530",
        effectiveStartDate: "2016-08-01",
        effectiveEndDate: null,
        openLocalTime: "09:00",
        closeLocalTime: "15:30",
        documentIds: ["krx.hours.1530"]
      }
    ],
    regularSessionSupersessions: [
      {
        supersessionId: "krx.2016-08-01",
        supersededRegimeId: "krx.regular.1500",
        replacementRegimeId: "krx.regular.1530",
        supersededDocumentIds: ["krx.hours.1500"],
        replacementDocumentIds: ["krx.hours.1530"],
        replacementEffectiveStartDate: "2016-08-01",
        derivedSupersededEndDate: "2016-07-31"
      }
    ]
  };
}

function document(
  documentId: string,
  evidenceRoles: OfficialMarketCalendarSourceCollectionPayload["documents"][number]["evidenceRoles"],
  applicabilityStartDate: string | null,
  applicabilityEndDate: string | null
): OfficialMarketCalendarSourceCollectionPayload["documents"][number] {
  const seed = documentId.length.toString(16).slice(-1);
  return {
    documentId,
    metadataHash: hash(seed),
    sourceDocumentHash: hash(seed === "f" ? "e" : "f"),
    evidenceRoles,
    regularSessionHours: evidenceRoles.includes("session_hours")
      ? {
          openLocalTime: "09:00",
          closeLocalTime: documentId.includes("1530") ? "15:30" : "15:00"
        }
      : null,
    scheduleCoverageIntervals: evidenceRoles
      .filter(isExceptionCoverageRole)
      .map((coverageRole) => ({
        coverageRole,
        startDate: "2016-01-01",
        endDate: "2016-12-31"
      })),
    applicabilityStartDate,
    applicabilityEndDate
  };
}

function isExceptionCoverageRole(
  role: OfficialMarketCalendarSourceCollectionPayload["documents"][number]["evidenceRoles"][number]
): role is OfficialMarketCalendarSourceCollectionPayload["documents"][number]["scheduleCoverageIntervals"][number]["coverageRole"] {
  return (
    role === "holiday_schedule" ||
    role === "session_hours_exception_schedule" ||
    role === "special_closure_schedule"
  );
}

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
