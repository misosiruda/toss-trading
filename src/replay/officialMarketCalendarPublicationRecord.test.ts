import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_PUBLICATION_RECORD_SCHEMA_VERSION,
  createOfficialMarketCalendarPackagePath,
  createOfficialMarketCalendarPublicationRecord,
  createOfficialMarketCalendarPublicationRecordHash,
  createOfficialMarketCalendarPublicationRecordPath,
  parseOfficialMarketCalendarPublicationRecord
} from "./officialMarketCalendarPublicationRecord.js";

const artifactHash = `sha256:${"a".repeat(64)}` as const;

test("calendar publication record binds one artifact hash to fixed package paths", () => {
  const record = createOfficialMarketCalendarPublicationRecord(artifactHash);
  const expectedPackagePath = `sha256/${"a".repeat(64)}`;
  const expectedRecordPath = `published/sha256/${"a".repeat(64)}.json`;

  assert.equal(
    record.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_PUBLICATION_RECORD_SCHEMA_VERSION
  );
  assert.equal(record.artifactHash, artifactHash);
  assert.equal(record.packagePath, expectedPackagePath);
  assert.equal(
    createOfficialMarketCalendarPackagePath(artifactHash),
    expectedPackagePath
  );
  assert.equal(
    createOfficialMarketCalendarPublicationRecordPath(artifactHash),
    expectedRecordPath
  );
  assert.equal(
    record.publicationRecordHash,
    createOfficialMarketCalendarPublicationRecordHash({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_PUBLICATION_RECORD_SCHEMA_VERSION,
      artifactHash,
      packagePath: expectedPackagePath
    })
  );
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(parseOfficialMarketCalendarPublicationRecord(record), record);
});

test("calendar publication record is deterministic for the same artifact", () => {
  const first = createOfficialMarketCalendarPublicationRecord(artifactHash);
  const second = createOfficialMarketCalendarPublicationRecord(artifactHash);

  assert.deepEqual(first, second);
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(parseOfficialMarketCalendarPublicationRecord(second))
  );
});

test("calendar publication record rejects hash and package path tampering", () => {
  const record = createOfficialMarketCalendarPublicationRecord(artifactHash);

  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationRecord({
        ...record,
        publicationRecordHash: `sha256:${"b".repeat(64)}`
      }),
    /record hash mismatch/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationRecord({
        ...record,
        packagePath: `sha256/${"b".repeat(64)}`
      }),
    /package path must match the artifact hash/
  );
});

test("calendar publication record rejects traversal and mutable aliases", () => {
  const record = createOfficialMarketCalendarPublicationRecord(artifactHash);

  for (const packagePath of [
    `../sha256/${"a".repeat(64)}`,
    `sha256/${"a".repeat(64)}/artifact.json`,
    `sha256\\${"a".repeat(64)}`,
    `SHA256/${"a".repeat(64)}`,
    "latest"
  ]) {
    assert.throws(
      () =>
        parseOfficialMarketCalendarPublicationRecord({
          ...record,
          packagePath
        }),
      /package path/
    );
  }
});

test("calendar publication record rejects malformed and shape-loose values", () => {
  const record = createOfficialMarketCalendarPublicationRecord(artifactHash);

  assert.throws(
    () => createOfficialMarketCalendarPublicationRecord("not-a-hash"),
    /sha256 hash/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationRecord({
        ...record,
        extra: true
      }),
    /Unrecognized key/
  );
  assert.throws(
    () =>
      parseOfficialMarketCalendarPublicationRecord({
        ...record,
        schemaVersion: "official_market_calendar_publication_record.v2"
      }),
    /Invalid input/
  );
});
