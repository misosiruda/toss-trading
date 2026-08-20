import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIFAT_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileDifatError,
  verifyOfficialMarketCalendarOleCompoundFileDifat
} from "./officialMarketCalendarOleCompoundFileDifat.js";

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

test("official calendar OLE DIFAT verifies header-only FAT locations", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileDifat(
    compoundFileWithoutDifat(3)
  );

  assert.deepEqual(result, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIFAT_SCHEMA_VERSION,
    majorVersion: 3,
    sectorSize: 512,
    fileSectorCount: 3,
    fatSectorCount: 1,
    difatSectorCount: 0,
    fatSectorLocations: [0],
    difatSectorLocations: [],
    difatVerified: true,
    fatStructureStatus: "locations_only_not_verified"
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.fatSectorLocations), true);
  assert.equal(Object.isFrozen(result.difatSectorLocations), true);
});

test("official calendar OLE DIFAT verifies version 4 sector addressing", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileDifat(
    compoundFileWithoutDifat(4)
  );
  assert.equal(result.majorVersion, 4);
  assert.equal(result.sectorSize, 4096);
  assert.deepEqual(result.fatSectorLocations, [0]);
});

test("official calendar OLE DIFAT resolves one extended DIFAT sector", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileDifat(
    compoundFileWithOneDifat()
  );

  assert.equal(result.fatSectorCount, 110);
  assert.equal(result.difatSectorCount, 1);
  assert.deepEqual(result.fatSectorLocations.slice(0, 4), [0, 1, 2, 3]);
  assert.deepEqual(result.fatSectorLocations.slice(-3), [107, 108, 111]);
  assert.deepEqual(result.difatSectorLocations, [109]);
});

test("official calendar OLE DIFAT follows multi-sector chain exactly", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileDifat(
    compoundFileWithTwoDifatSectors()
  );
  assert.equal(result.fatSectorCount, 237);
  assert.deepEqual(result.difatSectorLocations, [109, 110]);
  assert.deepEqual(result.fatSectorLocations.slice(-3), [237, 238, 239]);
});

test("official calendar OLE DIFAT rejects invalid entries and termination", () => {
  const duplicateFat = compoundFileWithOneDifat();
  writeSectorUint32(duplicateFat, 109, 0, 0);
  assertCode(
    duplicateFat,
    "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION"
  );

  const outOfRangeFat = compoundFileWithOneDifat();
  writeSectorUint32(outOfRangeFat, 109, 0, 120);
  assertCode(
    outOfRangeFat,
    "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION"
  );

  const dirtyUnusedEntry = compoundFileWithOneDifat();
  writeSectorUint32(dirtyUnusedEntry, 109, 1, 5);
  assertCode(
    dirtyUnusedEntry,
    "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION"
  );

  const cyclicTermination = compoundFileWithOneDifat();
  writeSectorUint32(cyclicTermination, 109, 127, 109);
  assertCode(
    cyclicTermination,
    "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_CHAIN"
  );

  const directoryCollision = compoundFileWithOneDifat();
  new DataView(directoryCollision.buffer).setUint32(48, 111, true);
  assertCode(
    directoryCollision,
    "OFFICIAL_CALENDAR_OLE_DIFAT_SECTOR_ROLE_COLLISION"
  );

  const difatFatCollision = compoundFileWithOneDifat();
  writeSectorUint32(difatFatCollision, 109, 0, 109);
  assertCode(
    difatFatCollision,
    "OFFICIAL_CALENDAR_OLE_DIFAT_SECTOR_ROLE_COLLISION"
  );
});

test("official calendar OLE DIFAT uses intrinsic byte-view properties", () => {
  const bytes = compoundFileWithOneDifat();
  const alternate = bytes.slice();
  writeSectorUint32(alternate, 109, 0, 0);
  Object.defineProperties(bytes, {
    buffer: { value: alternate.buffer },
    byteOffset: { value: alternate.byteOffset },
    byteLength: { value: alternate.byteLength }
  });

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileDifat(bytes).difatVerified,
    true
  );
});

function compoundFileWithoutDifat(majorVersion: 3 | 4): Uint8Array {
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  const bytes = createHeader({
    majorVersion,
    fileSectorCount: 3,
    fatSectorCount: 1,
    directorySector: 1,
    difatSectors: []
  });
  assert.equal(bytes.byteLength, sectorSize * 4);
  return bytes;
}

function compoundFileWithOneDifat(): Uint8Array {
  const bytes = createHeader({
    majorVersion: 3,
    fileSectorCount: 120,
    fatSectorCount: 110,
    directorySector: 110,
    difatSectors: [109]
  });
  writeSectorUint32(bytes, 109, 0, 111);
  for (let index = 1; index < 127; index += 1) {
    writeSectorUint32(bytes, 109, index, FREESECT);
  }
  writeSectorUint32(bytes, 109, 127, ENDOFCHAIN);
  return bytes;
}

function compoundFileWithTwoDifatSectors(): Uint8Array {
  const bytes = createHeader({
    majorVersion: 3,
    fileSectorCount: 250,
    fatSectorCount: 237,
    directorySector: 111,
    difatSectors: [109, 110]
  });
  for (let index = 0; index < 127; index += 1) {
    writeSectorUint32(bytes, 109, index, 112 + index);
  }
  writeSectorUint32(bytes, 109, 127, 110);
  writeSectorUint32(bytes, 110, 0, 239);
  for (let index = 1; index < 127; index += 1) {
    writeSectorUint32(bytes, 110, index, FREESECT);
  }
  writeSectorUint32(bytes, 110, 127, ENDOFCHAIN);
  return bytes;
}

function createHeader(options: {
  majorVersion: 3 | 4;
  fileSectorCount: number;
  fatSectorCount: number;
  directorySector: number;
  difatSectors: readonly number[];
}): Uint8Array {
  const sectorSize = options.majorVersion === 3 ? 512 : 4096;
  const bytes = new Uint8Array(sectorSize * (options.fileSectorCount + 1));
  bytes.set(
    Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    0
  );
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 62, true);
  view.setUint16(26, options.majorVersion, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, options.majorVersion === 3 ? 9 : 12, true);
  view.setUint16(32, 6, true);
  view.setUint32(40, options.majorVersion === 3 ? 0 : 1, true);
  view.setUint32(44, options.fatSectorCount, true);
  view.setUint32(48, options.directorySector, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, ENDOFCHAIN, true);
  view.setUint32(64, 0, true);
  view.setUint32(
    68,
    options.difatSectors[0] ?? ENDOFCHAIN,
    true
  );
  view.setUint32(72, options.difatSectors.length, true);
  for (let index = 0; index < 109; index += 1) {
    view.setUint32(
      76 + index * 4,
      index < Math.min(options.fatSectorCount, 109) ? index : FREESECT,
      true
    );
  }
  return bytes;
}

function writeSectorUint32(
  bytes: Uint8Array,
  sector: number,
  entryIndex: number,
  value: number
): void {
  const majorVersion = new DataView(bytes.buffer).getUint16(26, true);
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  new DataView(bytes.buffer).setUint32(
    (sector + 1) * sectorSize + entryIndex * 4,
    value,
    true
  );
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileDifatError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileDifat(bytes),
    (error: unknown) => hasCode(error, code)
  );
}

function hasCode(
  error: unknown,
  code: OfficialMarketCalendarOleCompoundFileDifatError["code"]
): boolean {
  return (
    error instanceof OfficialMarketCalendarOleCompoundFileDifatError &&
    error.code === code
  );
}
