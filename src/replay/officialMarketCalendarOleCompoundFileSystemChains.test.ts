import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_SYSTEM_CHAINS_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileSystemChainsError,
  verifyOfficialMarketCalendarOleCompoundFileSystemChains
} from "./officialMarketCalendarOleCompoundFileSystemChains.js";

const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

test("official calendar OLE system chains verify directory and mini FAT", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileSystemChains(
    compoundFileWithSystemChains(3)
  );

  assert.deepEqual(result, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_SYSTEM_CHAINS_SCHEMA_VERSION,
    majorVersion: 3,
    sectorSize: 512,
    fileSectorCount: 6,
    directorySectorLocations: [1, 3],
    miniFatSectorLocations: [2, 4],
    systemChainsVerified: true,
    directoryEntryStatus: "not_verified",
    miniFatEntryStatus: "not_verified"
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.directorySectorLocations), true);
  assert.equal(Object.isFrozen(result.miniFatSectorLocations), true);
});

test("official calendar OLE system chains enforce version 4 directory count", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileSystemChains(
    compoundFileWithSystemChains(4)
  );

  assert.equal(result.majorVersion, 4);
  assert.equal(result.sectorSize, 4096);
  assert.deepEqual(result.directorySectorLocations, [1, 3]);
});

test("official calendar OLE system chains allow absent mini FAT", () => {
  const bytes = compoundFileWithSystemChains(3);
  const view = new DataView(bytes.buffer);
  view.setUint32(60, ENDOFCHAIN, true);
  view.setUint32(64, 0, true);
  writeFatEntry(bytes, 1, ENDOFCHAIN);

  const result = verifyOfficialMarketCalendarOleCompoundFileSystemChains(bytes);
  assert.deepEqual(result.directorySectorLocations, [1]);
  assert.deepEqual(result.miniFatSectorLocations, []);
});

test("official calendar OLE system chains reject cycles and invalid termination", () => {
  const cyclic = compoundFileWithSystemChains(3);
  writeFatEntry(cyclic, 3, 1);
  assertCode(
    cyclic,
    "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN"
  );

  const freeTermination = compoundFileWithSystemChains(3);
  writeFatEntry(freeTermination, 3, FREESECT);
  assertCode(
    freeTermination,
    "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN"
  );
});

test("official calendar OLE system chains reject declared length mismatch", () => {
  const directoryMismatch = compoundFileWithSystemChains(4);
  new DataView(directoryMismatch.buffer).setUint32(40, 1, true);
  assertCode(
    directoryMismatch,
    "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_LENGTH_MISMATCH"
  );

  const miniFatMismatch = compoundFileWithSystemChains(3);
  new DataView(miniFatMismatch.buffer).setUint32(64, 1, true);
  assertCode(
    miniFatMismatch,
    "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_LENGTH_MISMATCH"
  );
});

test("official calendar OLE system chains reject sector reuse", () => {
  const bytes = compoundFileWithSystemChains(3);
  new DataView(bytes.buffer).setUint32(60, 3, true);
  new DataView(bytes.buffer).setUint32(64, 1, true);

  assertCode(bytes, "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_SECTOR_REUSE");
});

test("official calendar OLE system chains use intrinsic byte-view properties", () => {
  const bytes = compoundFileWithSystemChains(3);
  const alternate = bytes.slice();
  writeFatEntry(alternate, 3, 1);
  Object.defineProperties(bytes, {
    buffer: { value: alternate.buffer },
    byteOffset: { value: alternate.byteOffset },
    byteLength: { value: alternate.byteLength }
  });

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileSystemChains(bytes)
      .systemChainsVerified,
    true
  );
});

function compoundFileWithSystemChains(
  majorVersion: 3 | 4
): Uint8Array {
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  const bytes = new Uint8Array(sectorSize * 7);
  bytes.set(
    Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    0
  );
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 62, true);
  view.setUint16(26, majorVersion, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, majorVersion === 3 ? 9 : 12, true);
  view.setUint16(32, 6, true);
  view.setUint32(40, majorVersion === 3 ? 0 : 2, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 2, true);
  view.setUint32(64, 2, true);
  view.setUint32(68, ENDOFCHAIN, true);
  view.setUint32(72, 0, true);
  view.setUint32(76, 0, true);
  for (let index = 1; index < 109; index += 1) {
    view.setUint32(76 + index * 4, FREESECT, true);
  }
  bytes.fill(0xff, sectorSize, sectorSize * 2);
  writeFatEntry(bytes, 0, FATSECT);
  writeFatEntry(bytes, 1, 3);
  writeFatEntry(bytes, 2, 4);
  writeFatEntry(bytes, 3, ENDOFCHAIN);
  writeFatEntry(bytes, 4, ENDOFCHAIN);
  return bytes;
}

function writeFatEntry(
  bytes: Uint8Array,
  sector: number,
  value: number
): void {
  const sectorSize =
    new DataView(bytes.buffer).getUint16(26, true) === 3 ? 512 : 4096;
  new DataView(bytes.buffer).setUint32(
    sectorSize + sector * 4,
    value,
    true
  );
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileSystemChainsError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileSystemChains(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileSystemChainsError &&
      error.code === code
  );
}
