import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_FAT_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileFatError,
  verifyOfficialMarketCalendarOleCompoundFileFat
} from "./officialMarketCalendarOleCompoundFileFat.js";

const DIFSECT = 0xfffffffc;
const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

test("official calendar OLE FAT verifies marker-only allocation table", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileFat(
    compoundFileWithoutDifat(3)
  );

  assert.deepEqual(result, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_FAT_SCHEMA_VERSION,
    majorVersion: 3,
    sectorSize: 512,
    fileSectorCount: 3,
    fatSectorCount: 1,
    difatSectorCount: 0,
    fatSectorLocations: [0],
    difatSectorLocations: [],
    fatEntries: [FATSECT, ENDOFCHAIN, FREESECT],
    fatVerified: true,
    chainStatus: "markers_only_chains_not_verified"
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.fatEntries), true);
  assert.equal(Object.isFrozen(result.fatSectorLocations), true);
  assert.equal(Object.isFrozen(result.difatSectorLocations), true);
});

test("official calendar OLE FAT verifies version 4 sector addressing", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileFat(
    compoundFileWithoutDifat(4)
  );

  assert.equal(result.majorVersion, 4);
  assert.equal(result.sectorSize, 4096);
  assert.deepEqual(result.fatEntries, [FATSECT, ENDOFCHAIN, FREESECT]);
});

test("official calendar OLE FAT verifies extended DIFAT markers", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileFat(
    compoundFileWithOneDifat()
  );

  assert.equal(result.fatEntries.length, 120);
  assert.equal(result.fatEntries[0], FATSECT);
  assert.equal(result.fatEntries[108], FATSECT);
  assert.equal(result.fatEntries[109], DIFSECT);
  assert.equal(result.fatEntries[110], ENDOFCHAIN);
  assert.equal(result.fatEntries[111], FATSECT);
  assert.equal(result.fatEntries[119], FREESECT);
});

test("official calendar OLE FAT rejects invalid entry values", () => {
  const reservedValue = compoundFileWithoutDifat(3);
  writeFatEntry(reservedValue, [0], 2, 0xfffffffb);
  assertCode(reservedValue, "OFFICIAL_CALENDAR_OLE_FAT_INVALID_ENTRY");

  const outOfRangeSector = compoundFileWithoutDifat(3);
  writeFatEntry(outOfRangeSector, [0], 2, 3);
  assertCode(outOfRangeSector, "OFFICIAL_CALENDAR_OLE_FAT_INVALID_ENTRY");
});

test("official calendar OLE FAT rejects missing and stray markers", () => {
  const missingFatMarker = compoundFileWithoutDifat(3);
  writeFatEntry(missingFatMarker, [0], 0, FREESECT);
  assertCode(
    missingFatMarker,
    "OFFICIAL_CALENDAR_OLE_FAT_INVALID_SECTOR_MARKER"
  );

  const strayFatMarker = compoundFileWithoutDifat(3);
  writeFatEntry(strayFatMarker, [0], 2, FATSECT);
  assertCode(
    strayFatMarker,
    "OFFICIAL_CALENDAR_OLE_FAT_INVALID_SECTOR_MARKER"
  );

  const missingDifatMarker = compoundFileWithOneDifat();
  writeFatEntry(
    missingDifatMarker,
    extendedFatLocations(),
    109,
    FREESECT
  );
  assertCode(
    missingDifatMarker,
    "OFFICIAL_CALENDAR_OLE_FAT_INVALID_SECTOR_MARKER"
  );
});

test("official calendar OLE FAT rejects non-free entries past EOF", () => {
  const bytes = compoundFileWithoutDifat(3);
  writeFatEntry(bytes, [0], 3, ENDOFCHAIN);
  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_FAT_INVALID_TRAILING_ENTRY"
  );
});

test("official calendar OLE FAT uses intrinsic byte-view properties", () => {
  const bytes = compoundFileWithoutDifat(3);
  const alternate = bytes.slice();
  writeFatEntry(alternate, [0], 0, FREESECT);
  Object.defineProperties(bytes, {
    buffer: { value: alternate.buffer },
    byteOffset: { value: alternate.byteOffset },
    byteLength: { value: alternate.byteLength }
  });

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileFat(bytes).fatVerified,
    true
  );
});

function compoundFileWithoutDifat(majorVersion: 3 | 4): Uint8Array {
  const bytes = createHeader({
    majorVersion,
    fileSectorCount: 3,
    fatSectorCount: 1,
    directorySector: 1,
    difatSectors: []
  });
  fillSector(bytes, 0, 0xff);
  writeFatEntry(bytes, [0], 0, FATSECT);
  writeFatEntry(bytes, [0], 1, ENDOFCHAIN);
  return bytes;
}

function compoundFileWithOneDifat(): Uint8Array {
  const fatLocations = extendedFatLocations();
  const bytes = createHeader({
    majorVersion: 3,
    fileSectorCount: 120,
    fatSectorCount: fatLocations.length,
    directorySector: 110,
    difatSectors: [109]
  });
  for (const sector of fatLocations) {
    fillSector(bytes, sector, 0xff);
  }
  writeSectorUint32(bytes, 109, 0, 111);
  for (let index = 1; index < 127; index += 1) {
    writeSectorUint32(bytes, 109, index, FREESECT);
  }
  writeSectorUint32(bytes, 109, 127, ENDOFCHAIN);
  for (let sector = 0; sector <= 108; sector += 1) {
    writeFatEntry(bytes, fatLocations, sector, FATSECT);
  }
  writeFatEntry(bytes, fatLocations, 109, DIFSECT);
  writeFatEntry(bytes, fatLocations, 110, ENDOFCHAIN);
  writeFatEntry(bytes, fatLocations, 111, FATSECT);
  return bytes;
}

function extendedFatLocations(): readonly number[] {
  return Object.freeze([
    ...Array.from({ length: 109 }, (_, index) => index),
    111
  ]);
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

function fillSector(
  bytes: Uint8Array,
  sector: number,
  value: number
): void {
  const sectorSize = readSectorSize(bytes);
  bytes.fill(
    value,
    (sector + 1) * sectorSize,
    (sector + 2) * sectorSize
  );
}

function writeFatEntry(
  bytes: Uint8Array,
  fatLocations: readonly number[],
  globalEntryIndex: number,
  value: number
): void {
  const sectorSize = readSectorSize(bytes);
  const entriesPerSector = sectorSize / 4;
  const fatSectorIndex = Math.floor(globalEntryIndex / entriesPerSector);
  const fatSectorLocation = fatLocations[fatSectorIndex];
  assert.notEqual(fatSectorLocation, undefined);
  writeSectorUint32(
    bytes,
    fatSectorLocation as number,
    globalEntryIndex % entriesPerSector,
    value
  );
}

function writeSectorUint32(
  bytes: Uint8Array,
  sector: number,
  entryIndex: number,
  value: number
): void {
  const sectorSize = readSectorSize(bytes);
  new DataView(bytes.buffer).setUint32(
    (sector + 1) * sectorSize + entryIndex * 4,
    value,
    true
  );
}

function readSectorSize(bytes: Uint8Array): number {
  return new DataView(bytes.buffer).getUint16(26, true) === 3 ? 512 : 4096;
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileFatError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileFat(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileFatError &&
      error.code === code
  );
}
