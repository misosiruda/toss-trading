import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfficialMarketCalendarSourceCollectionHash,
  type OfficialMarketCalendarSourceCollection,
  type OfficialMarketCalendarSourceCollectionPayload
} from "./officialMarketCalendarSourceCollection.js";
import { resolveOfficialMarketCalendarSourceArchiveBindings } from "./officialMarketCalendarSourceArchiveBinding.js";

test("calendar archive bindings cover collection documents by composite ref", () => {
  const collections = [collection("KRX", "a", "b"), collection("NYSE", "c", "d")];
  const resolved = resolveOfficialMarketCalendarSourceArchiveBindings(
    bindings(collections),
    { collections }
  );

  assert.deepEqual(
    resolved.map(({ binding }) => binding.sourceDocumentRef.exchange),
    ["KRX", "NYSE"]
  );
  assert.deepEqual(
    resolved.map(({ metadataHash }) => metadataHash),
    collections.map(({ documents }) => documents[0]!.metadataHash)
  );
});

test("calendar archive bindings allow identical bytes to share a sidecar", () => {
  const collections = [collection("KRX", "a", "b"), collection("NYSE", "c", "b")];
  const values = bindings(collections);
  values[1]!.contentLength = values[0]!.contentLength;

  assert.doesNotThrow(() =>
    resolveOfficialMarketCalendarSourceArchiveBindings(values, { collections })
  );
  assert.equal(values[0]!.archivePath, values[1]!.archivePath);
});

test("calendar archive bindings reject missing collection documents", () => {
  const collections = [collection("KRX", "a", "b"), collection("NYSE", "c", "d")];

  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(
        bindings(collections).slice(0, 1),
        { collections }
      ),
    /must cover every collection document/
  );
});

test("calendar archive bindings reject unknown refs and document hash mismatch", () => {
  const collections = [collection("KRX", "a", "b")];
  const unknown = bindings(collections);
  unknown[0]!.sourceDocumentRef.documentId = "missing.document";
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(unknown, {
        collections
      }),
    /document ref is unknown/
  );

  const hashMismatch = bindings(collections);
  hashMismatch[0]!.sourceDocumentHash = hash("f");
  hashMismatch[0]!.archivePath = archivePath(hash("f"));
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(hashMismatch, {
        collections
      }),
    /hash must match collection document/
  );
});

test("calendar archive bindings reject path format and hash mismatch", () => {
  const collections = [collection("KRX", "a", "b")];
  const invalidFormat = bindings(collections);
  invalidFormat[0]!.archivePath = "../source.bin";
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(invalidFormat, {
        collections
      }),
    /hash-addressed package namespace/
  );

  const hashMismatch = bindings(collections);
  hashMismatch[0]!.archivePath = archivePath(hash("e"));
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(hashMismatch, {
        collections
      }),
    /path must match source document hash/
  );
});

test("calendar archive bindings reject duplicate and non-canonical refs", () => {
  const krx = collection("KRX", "a", "b");
  const nyse = collection("NYSE", "c", "d");
  const duplicateCollections = [krx, krx];
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(
        bindings(duplicateCollections),
        { collections: duplicateCollections }
      ),
    /unique and canonical|identity is duplicated/
  );

  const collections = [krx, nyse];
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(
        bindings(collections).reverse(),
        { collections }
      ),
    /unique and canonical/
  );
});

test("calendar archive bindings reject conflicting shared path length", () => {
  const collections = [collection("KRX", "a", "b"), collection("NYSE", "c", "b")];
  const values = bindings(collections);
  values[1]!.contentLength += 1;

  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(values, {
        collections
      }),
    /shared source archive path must use one content length/
  );
});

test("calendar archive bindings reject unknown fields and invalid lengths", () => {
  const collections = [collection("KRX", "a", "b")];
  const value = bindings(collections)[0]!;
  assert.throws(
    () =>
      resolveOfficialMarketCalendarSourceArchiveBindings(
        [{ ...value, absolutePath: "C:/source.bin" }],
        { collections }
      ),
    /Unrecognized key/
  );
  for (const contentLength of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() =>
      resolveOfficialMarketCalendarSourceArchiveBindings(
        [{ ...value, contentLength }],
        { collections }
      )
    );
  }
});

function bindings(
  collections: readonly OfficialMarketCalendarSourceCollection[]
) {
  return collections.map((sourceCollection, index) => {
    const document = sourceCollection.documents[0]!;
    return {
      sourceDocumentRef: {
        exchange: sourceCollection.exchange,
        collectionId: sourceCollection.collectionId,
        documentId: document.documentId
      },
      archivePath: archivePath(document.sourceDocumentHash),
      sourceDocumentHash: document.sourceDocumentHash,
      contentLength: 100 + index
    };
  });
}

function archivePath(sourceDocumentHash: string): string {
  return `sources/sha256/${sourceDocumentHash.slice("sha256:".length)}.bin`;
}

function collection(
  exchange: "KRX" | "NYSE",
  metadataSeed: string,
  sourceSeed: string
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
        metadataHash: hash(metadataSeed),
        sourceDocumentHash: hash(sourceSeed),
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

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
