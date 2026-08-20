import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_HEADER_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileHeaderError,
  verifyOfficialMarketCalendarOleCompoundFileHeader
} from "./officialMarketCalendarOleCompoundFileHeader.js";

test("official calendar OLE header verifies canonical version 3 fields", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileHeader(
    canonicalCompoundFile(3)
  );

  assert.deepEqual(result, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_HEADER_SCHEMA_VERSION,
    majorVersion: 3,
    minorVersion: 62,
    sectorSize: 512,
    miniSectorSize: 64,
    miniStreamCutoffSize: 4096,
    fileSectorCount: 3,
    fatSectorCount: 1,
    directorySectorCount: 0,
    miniFatSectorCount: 0,
    difatSectorCount: 0,
    headerVerified: true,
    structureStatus: "header_only_not_verified"
  });
  assert.equal(Object.isFrozen(result), true);
});

test("official calendar OLE header verifies canonical version 4 fields", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileHeader(
    canonicalCompoundFile(4)
  );
  assert.equal(result.majorVersion, 4);
  assert.equal(result.sectorSize, 4096);
  assert.equal(result.fileSectorCount, 3);
  assert.equal(result.directorySectorCount, 1);
});

test("official calendar OLE header rejects signature and fixed-field mutations", () => {
  const signature = canonicalCompoundFile(3);
  signature[0] = 0;
  assertCode(signature, "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_SIGNATURE");

  for (const mutate of [
    (bytes: Uint8Array) => (bytes[8] = 1),
    (bytes: Uint8Array) => writeUint16(bytes, 24, 61),
    (bytes: Uint8Array) => writeUint16(bytes, 26, 2),
    (bytes: Uint8Array) => writeUint16(bytes, 28, 0xfeff),
    (bytes: Uint8Array) => writeUint16(bytes, 30, 12),
    (bytes: Uint8Array) => writeUint16(bytes, 32, 5),
    (bytes: Uint8Array) => (bytes[34] = 1),
    (bytes: Uint8Array) => writeUint32(bytes, 40, 1),
    (bytes: Uint8Array) => writeUint32(bytes, 44, 0),
    (bytes: Uint8Array) => writeUint32(bytes, 56, 2048)
  ]) {
    const bytes = canonicalCompoundFile(3);
    mutate(bytes);
    assertCode(bytes, "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_FIELDS");
  }
});

test("official calendar OLE header rejects inconsistent sector layout", () => {
  const difatCollision = canonicalCompoundFile(3, 120, 110);
  writeUint32(difatCollision, 68, 0);
  const cases = [
    canonicalCompoundFile(3).slice(0, -1),
    mutated((bytes) => writeUint32(bytes, 48, 9)),
    mutated((bytes) => writeUint32(bytes, 60, 0)),
    mutated((bytes) => writeUint32(bytes, 68, 0)),
    mutated((bytes) => writeUint32(bytes, 76, 9)),
    mutated((bytes) => writeUint32(bytes, 80, 0)),
    mutated((bytes) => writeUint32(bytes, 48, 0)),
    mutated((bytes) => {
      writeUint32(bytes, 60, 2);
      writeUint32(bytes, 64, 0xffffffff);
    }),
    mutated((bytes) => {
      writeUint32(bytes, 68, 2);
      writeUint32(bytes, 72, 0xffffffff);
    }),
    mutated((bytes) => {
      writeUint32(bytes, 60, 0);
      writeUint32(bytes, 64, 1);
    }),
    mutated((bytes) => {
      writeUint32(bytes, 60, 1);
      writeUint32(bytes, 64, 1);
    }),
    difatCollision
  ];
  for (const bytes of cases) {
    assertCode(bytes, "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_SECTOR_LAYOUT");
  }
});

test("official calendar OLE header rejects unsafe byte views", () => {
  const detached = new Uint8Array(512);
  structuredClone(null, { transfer: [detached.buffer] });
  for (const value of [
    null,
    Buffer.alloc(512),
    new Uint8Array(511),
    detached,
    ...(typeof SharedArrayBuffer === "undefined"
      ? []
      : [new Uint8Array(new SharedArrayBuffer(512))])
  ]) {
    assert.throws(
      () => verifyOfficialMarketCalendarOleCompoundFileHeader(value as never),
      (error: unknown) =>
        hasCode(error, "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_INPUT")
    );
  }
});

test("official calendar OLE header ignores shadowed byte-view properties", () => {
  const alternate = canonicalCompoundFile(3);
  const shadowed = new Uint8Array(alternate.byteLength);
  shadowed.set(alternate.subarray(0, 8), 0);
  Object.defineProperties(shadowed, {
    buffer: { value: alternate.buffer },
    byteOffset: { value: alternate.byteOffset },
    byteLength: { value: alternate.byteLength }
  });

  assertCode(shadowed, "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_FIELDS");
});

function canonicalCompoundFile(
  majorVersion: 3 | 4,
  fileSectorCount = 3,
  fatSectorCount = 1
): Uint8Array {
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  const bytes = new Uint8Array(sectorSize * (fileSectorCount + 1));
  const difatSectorCount = Math.ceil(
    Math.max(0, fatSectorCount - 109) / (sectorSize / 4 - 1)
  );
  bytes.set(
    Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    0
  );
  writeUint16(bytes, 24, 62);
  writeUint16(bytes, 26, majorVersion);
  writeUint16(bytes, 28, 0xfffe);
  writeUint16(bytes, 30, majorVersion === 3 ? 9 : 12);
  writeUint16(bytes, 32, 6);
  writeUint32(bytes, 40, majorVersion === 3 ? 0 : 1);
  writeUint32(bytes, 44, fatSectorCount);
  writeUint32(bytes, 48, difatSectorCount === 0 ? 1 : 110);
  writeUint32(bytes, 56, 4096);
  writeUint32(bytes, 60, 0xfffffffe);
  writeUint32(bytes, 64, 0);
  writeUint32(bytes, 68, difatSectorCount === 0 ? 0xfffffffe : 109);
  writeUint32(bytes, 72, difatSectorCount);
  for (let index = 0; index < 109; index += 1) {
    writeUint32(
      bytes,
      76 + index * 4,
      index < Math.min(fatSectorCount, 109) ? index : 0xffffffff
    );
  }
  return bytes;
}

function mutated(change: (bytes: Uint8Array) => void): Uint8Array {
  const bytes = canonicalCompoundFile(3);
  change(bytes);
  return bytes;
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer).setUint16(offset, value, true);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileHeaderError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileHeader(bytes),
    (error: unknown) => hasCode(error, code)
  );
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarOleCompoundFileHeaderError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarOleCompoundFileHeaderError &&
    error.code === code
  );
}
