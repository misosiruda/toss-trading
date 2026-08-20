import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_MINI_FAT_ENTRIES_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileMiniFatEntriesError,
  verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries
} from "./officialMarketCalendarOleCompoundFileMiniFatEntries.js";

const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

test("official calendar OLE mini FAT entries verify allocator values", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(
    compoundFileWithMiniFat(3)
  );

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_MINI_FAT_ENTRIES_SCHEMA_VERSION
  );
  assert.equal(result.majorVersion, 3);
  assert.equal(result.sectorSize, 512);
  assert.equal(result.miniSectorSize, 64);
  assert.deepEqual(result.miniFatSectorLocations, [2]);
  assert.equal(result.miniFatEntries.length, 128);
  assert.deepEqual(result.miniFatEntries.slice(0, 4), [
    1,
    ENDOFCHAIN,
    FREESECT,
    FREESECT
  ]);
  assert.equal(result.miniFatEntriesVerified, true);
  assert.equal(result.streamChainStatus, "not_verified");
  assert.equal(result.miniStreamStatus, "not_verified");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.miniFatSectorLocations), true);
  assert.equal(Object.isFrozen(result.miniFatEntries), true);
});

test("official calendar OLE mini FAT entries use sector-size capacity", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(
    compoundFileWithMiniFat(4)
  );

  assert.equal(result.majorVersion, 4);
  assert.equal(result.sectorSize, 4096);
  assert.equal(result.miniFatEntries.length, 1024);
});

test("official calendar OLE mini FAT entries allow an absent allocator", () => {
  const bytes = compoundFileWithMiniFat(3);
  const view = new DataView(bytes.buffer);
  view.setUint32(60, ENDOFCHAIN, true);
  view.setUint32(64, 0, true);
  writeFatEntry(bytes, 2, FREESECT);

  const result = verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(
    bytes
  );
  assert.deepEqual(result.miniFatSectorLocations, []);
  assert.deepEqual(result.miniFatEntries, []);
});

test("official calendar OLE mini FAT entries reject reserved markers", () => {
  for (const value of [0xfffffffb, DIFSECT, FATSECT]) {
    const bytes = compoundFileWithMiniFat(3);
    writeMiniFatEntry(bytes, 0, value);
    assertCode(
      bytes,
      "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_ENTRY"
    );
  }
});

test("official calendar OLE mini FAT entries reject pointers outside capacity", () => {
  const version3 = compoundFileWithMiniFat(3);
  writeMiniFatEntry(version3, 0, 128);
  assertCode(
    version3,
    "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_ENTRY"
  );

  const version4 = compoundFileWithMiniFat(4);
  writeMiniFatEntry(version4, 0, 1024);
  assertCode(
    version4,
    "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_ENTRY"
  );
});

test("official calendar OLE mini FAT entries use intrinsic byte-view properties", () => {
  const bytes = compoundFileWithMiniFat(3);
  const alternate = bytes.slice();
  writeMiniFatEntry(alternate, 0, FATSECT);
  Object.defineProperties(bytes, {
    buffer: { value: alternate.buffer },
    byteOffset: { value: alternate.byteOffset },
    byteLength: { value: alternate.byteLength }
  });

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(bytes)
      .miniFatEntriesVerified,
    true
  );
});

function compoundFileWithMiniFat(majorVersion: 3 | 4): Uint8Array {
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  const bytes = new Uint8Array(sectorSize * 4);
  const view = new DataView(bytes.buffer);
  bytes.set(
    Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    0
  );
  view.setUint16(24, 62, true);
  view.setUint16(26, majorVersion, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, majorVersion === 3 ? 9 : 12, true);
  view.setUint16(32, 6, true);
  view.setUint32(40, majorVersion === 3 ? 0 : 1, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 2, true);
  view.setUint32(64, 1, true);
  view.setUint32(68, ENDOFCHAIN, true);
  view.setUint32(72, 0, true);
  view.setUint32(76, 0, true);
  for (let index = 1; index < 109; index += 1) {
    view.setUint32(76 + index * 4, FREESECT, true);
  }

  bytes.fill(0xff, sectorSize, sectorSize * 2);
  writeFatEntry(bytes, 0, FATSECT);
  writeFatEntry(bytes, 1, ENDOFCHAIN);
  writeFatEntry(bytes, 2, ENDOFCHAIN);
  bytes.fill(0xff, sectorSize * 3, sectorSize * 4);
  writeMiniFatEntry(bytes, 0, 1);
  writeMiniFatEntry(bytes, 1, ENDOFCHAIN);
  return bytes;
}

function writeFatEntry(
  bytes: Uint8Array,
  sector: number,
  value: number
): void {
  const sectorSize = readSectorSize(bytes);
  new DataView(bytes.buffer).setUint32(
    sectorSize + sector * 4,
    value,
    true
  );
}

function writeMiniFatEntry(
  bytes: Uint8Array,
  index: number,
  value: number
): void {
  const sectorSize = readSectorSize(bytes);
  new DataView(bytes.buffer).setUint32(
    sectorSize * 3 + index * 4,
    value,
    true
  );
}

function readSectorSize(bytes: Uint8Array): number {
  return new DataView(bytes.buffer).getUint16(26, true) === 3 ? 512 : 4096;
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileMiniFatEntriesError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileMiniFatEntriesError &&
      error.code === code
  );
}
