import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import { verifyOfficialMarketCalendarSourceArchiveSidecars } from "./officialMarketCalendarSourceArchiveSidecar.js";

test("calendar source archive verifies exact bound sidecar bytes", () => {
  const fixture = fixtures([Buffer.from("krx-source"), Buffer.from("nyse-source")]);
  const verified = verifyOfficialMarketCalendarSourceArchiveSidecars(fixture);

  assert.deepEqual(
    verified.map(({ archivePath: path }) => path),
    fixture.sidecars.map(({ archivePath: path }) => path)
  );
  assert.deepEqual(
    verified.map(({ sourceDocumentHash }) => sourceDocumentHash).sort(),
    fixture.collections
      .map(({ documents }) => documents[0]!.sourceDocumentHash)
      .sort()
  );
});

test("calendar source archive accepts one sidecar for shared exact bytes", () => {
  const shared = Buffer.from("shared-source");
  const fixture = fixtures([shared, shared]);
  fixture.sidecars = fixture.sidecars.slice(0, 1);

  const verified = verifyOfficialMarketCalendarSourceArchiveSidecars(fixture);

  assert.equal(verified.length, 1);
  assert.equal(verified[0]!.contentLength, shared.byteLength);
});

test("calendar source archive rejects missing and unreferenced sidecars", () => {
  const fixture = fixtures([Buffer.from("krx-source")]);
  assert.throws(
    () =>
      verifyOfficialMarketCalendarSourceArchiveSidecars({
        ...fixture,
        sidecars: []
      }),
    /missing a referenced sidecar/
  );

  const extraBytes = Buffer.from("extra-source");
  const sidecars = [
    ...fixture.sidecars,
    { archivePath: archivePath(hashBytes(extraBytes)), bytes: extraBytes }
  ].sort((left, right) =>
    left.archivePath < right.archivePath ? -1 : 1
  );
  assert.throws(
    () =>
      verifyOfficialMarketCalendarSourceArchiveSidecars({
        ...fixture,
        sidecars
      }),
    /unreferenced sidecar/
  );
});

test("calendar source archive rejects duplicate and non-canonical paths", () => {
  const duplicate = fixtures([Buffer.from("krx-source")]);
  duplicate.sidecars.push(duplicate.sidecars[0]!);
  assert.throws(
    () => verifyOfficialMarketCalendarSourceArchiveSidecars(duplicate),
    /unique canonical paths/
  );

  const nonCanonical = fixtures([
    Buffer.from("first-source"),
    Buffer.from("second-source")
  ]);
  nonCanonical.sidecars.reverse();
  assert.throws(
    () => verifyOfficialMarketCalendarSourceArchiveSidecars(nonCanonical),
    /unique canonical paths/
  );
});

test("calendar source archive rejects mutated sidecar bytes", () => {
  const fixture = fixtures([Buffer.from("krx-source")]);
  fixture.sidecars[0]!.bytes = Buffer.from("KRX-source");

  assert.throws(
    () => verifyOfficialMarketCalendarSourceArchiveSidecars(fixture),
    /sidecar hash mismatch/
  );
});

test("calendar source archive rejects sidecar length mismatch", () => {
  const fixture = fixtures([Buffer.from("krx-source")]);
  fixture.sidecars[0]!.bytes = Buffer.from("longer-krx-source");

  assert.throws(
    () => verifyOfficialMarketCalendarSourceArchiveSidecars(fixture),
    /sidecar length mismatch/
  );
});

test("calendar source archive rejects unknown fields and invalid byte values", () => {
  const fixture = fixtures([Buffer.from("krx-source")]);
  assert.throws(
    () =>
      verifyOfficialMarketCalendarSourceArchiveSidecars({
        ...fixture,
        sidecars: [{ ...fixture.sidecars[0]!, absolutePath: "C:/source.bin" }]
      }),
    /Unrecognized key/
  );
  assert.throws(() =>
    verifyOfficialMarketCalendarSourceArchiveSidecars({
      ...fixture,
      sidecars: [
        { archivePath: fixture.sidecars[0]!.archivePath, bytes: "not-bytes" }
      ]
    })
  );
});

function fixtures(bytesByExchange: readonly Uint8Array[]) {
  const exchanges = ["KRX", "NYSE"] as const;
  const collections = bytesByExchange.map((bytes, index) =>
    collection(exchanges[index]!, bytes, index)
  );
  const bindings = collections.map((sourceCollection, index) => {
    const document = sourceCollection.documents[0]!;
    return {
      sourceDocumentRef: {
        exchange: sourceCollection.exchange,
        collectionId: sourceCollection.collectionId,
        documentId: document.documentId
      },
      archivePath: archivePath(document.sourceDocumentHash),
      sourceDocumentHash: document.sourceDocumentHash,
      contentLength: bytesByExchange[index]!.byteLength
    };
  });
  const sidecars = [...new Map(
    bindings.map((binding, index) => [
      binding.archivePath,
      { archivePath: binding.archivePath, bytes: bytesByExchange[index]! }
    ])
  ).values()].sort((left, right) =>
    left.archivePath < right.archivePath ? -1 : 1
  );
  return { collections, bindings, sidecars };
}

function collection(
  exchange: "KRX" | "NYSE",
  bytes: Uint8Array,
  index: number
): OfficialMarketCalendarSourceCollection {
  const prefix = exchange.toLowerCase();
  const payload: OfficialMarketCalendarSourceCollectionPayload = {
    schemaVersion: "official_market_calendar_source_collection.v1",
    collectionId: `${prefix}.collection`,
    exchange,
    coverageStartDate: "2025-01-01",
    coverageEndDate: "2025-12-31",
    documents: [
      {
        documentId: "shared.document",
        metadataHash: hashCharacter(index === 0 ? "a" : "b"),
        sourceDocumentHash: hashBytes(bytes),
        evidenceRoles: [
          "holiday_schedule",
          "session_hours",
          "session_hours_exception_schedule",
          "special_closure_schedule"
        ],
        regularSessionHours: {
          openLocalTime: "09:00",
          closeLocalTime: exchange === "KRX" ? "15:30" : "16:00"
        },
        scheduleCoverageIntervals: scheduleIntervals(),
        applicabilityStartDate: "2025-01-01",
        applicabilityEndDate: null
      }
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
      documentIds: ["shared.document"]
    })),
    regularSessionRegimes: [
      {
        regimeId: `${prefix}.regime.2025`,
        effectiveStartDate: "2025-01-01",
        effectiveEndDate: null,
        openLocalTime: "09:00",
        closeLocalTime: exchange === "KRX" ? "15:30" : "16:00",
        documentIds: ["shared.document"]
      }
    ],
    regularSessionSupersessions: []
  };
  return {
    ...payload,
    collectionHash: createOfficialMarketCalendarSourceCollectionHash(payload)
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

function hashBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashCharacter(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function archivePath(sourceDocumentHash: string): string {
  return `sources/sha256/${sourceDocumentHash.slice("sha256:".length)}.bin`;
}
