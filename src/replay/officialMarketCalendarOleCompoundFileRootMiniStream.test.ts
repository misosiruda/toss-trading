import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_ROOT_MINI_STREAM_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileRootMiniStreamError,
  verifyOfficialMarketCalendarOleCompoundFileRootMiniStream
} from "./officialMarketCalendarOleCompoundFileRootMiniStream.js";

const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

test("official calendar OLE root mini stream verifies FAT allocation", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(
    compoundFileWithRootMiniStream(3)
  );
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_ROOT_MINI_STREAM_SCHEMA_VERSION
  );
  assert.equal(result.rootMiniStreamSize, "64");
  assert.equal(result.rootMiniSectorCount, 1);
  assert.equal(result.miniFatEntryCapacity, 128);
  assert.deepEqual(result.rootMiniStreamSectorLocations, [3]);
  assert.equal(result.rootMiniStreamVerified, true);
  assert.equal(result.miniFatCapacityVerified, true);
  assert.equal(result.userStreamAllocationStatus, "not_verified");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rootMiniStreamSectorLocations), true);
});

test("official calendar OLE root mini stream supports version 4 capacity", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(
    compoundFileWithRootMiniStream(4)
  );
  assert.equal(result.sectorSize, 4096);
  assert.equal(result.miniFatEntryCapacity, 1024);
});

test("official calendar OLE root mini stream allows zero size", () => {
  const bytes = compoundFileWithRootMiniStream(3);
  setRootUint32(bytes, 116, ENDOFCHAIN);
  setRootUint32(bytes, 120, 0);
  writeFatEntry(bytes, 3, FREESECT);

  const result = verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(
    bytes
  );
  assert.equal(result.rootMiniSectorCount, 0);
  assert.deepEqual(result.rootMiniStreamSectorLocations, []);
});

test("official calendar OLE root mini stream verifies multi-sector length", () => {
  const bytes = compoundFileWithRootMiniStream(3);
  setRootUint32(bytes, 120, 576);
  writeFatEntry(bytes, 3, 4);
  writeFatEntry(bytes, 4, ENDOFCHAIN);

  const result = verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(
    bytes
  );
  assert.equal(result.rootMiniSectorCount, 9);
  assert.deepEqual(result.rootMiniStreamSectorLocations, [3, 4]);
});

test("official calendar OLE root mini stream rejects length mismatch and cycles", () => {
  const shortChain = compoundFileWithRootMiniStream(3);
  setRootUint32(shortChain, 120, 513);
  assertCode(
    shortChain,
    "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_LENGTH_MISMATCH"
  );

  const cycle = compoundFileWithRootMiniStream(3);
  setRootUint32(cycle, 120, 513);
  writeFatEntry(cycle, 3, 3);
  assertCode(cycle, "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_CHAIN");
});

test("official calendar OLE root mini stream rejects system-sector reuse", () => {
  for (const sector of [0, 1, 2]) {
    const bytes = compoundFileWithRootMiniStream(3);
    setRootUint32(bytes, 116, sector);
    assertCode(
      bytes,
      "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_SECTOR_REUSE"
    );
  }
});

test("official calendar OLE root mini stream binds mini FAT to actual capacity", () => {
  const pointerOutsideRoot = compoundFileWithRootMiniStream(3);
  writeMiniFatEntry(pointerOutsideRoot, 0, 1);
  assertCode(
    pointerOutsideRoot,
    "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_MINI_FAT_CAPACITY"
  );

  const allocatedTrailingEntry = compoundFileWithRootMiniStream(3);
  writeMiniFatEntry(allocatedTrailingEntry, 1, ENDOFCHAIN);
  assertCode(
    allocatedTrailingEntry,
    "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_MINI_FAT_CAPACITY"
  );
});

function compoundFileWithRootMiniStream(
  majorVersion: 3 | 4
): Uint8Array {
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  const bytes = new Uint8Array(sectorSize * 6);
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
  writeFatEntry(bytes, 3, ENDOFCHAIN);
  writeFatEntry(bytes, 4, FREESECT);

  initializeRootEntry(bytes);
  const entriesPerDirectorySector = sectorSize / 128;
  for (let streamId = 1; streamId < entriesPerDirectorySector; streamId += 1) {
    initializeUnallocatedEntry(bytes, streamId);
  }
  bytes.fill(0xff, sectorSize * 3, sectorSize * 4);
  return bytes;
}

function initializeRootEntry(bytes: Uint8Array): void {
  const offset = directoryEntryOffset(bytes, 0);
  bytes.fill(0, offset, offset + 128);
  writeEntryName(bytes, 0, "Root Entry");
  const view = new DataView(bytes.buffer);
  view.setUint8(offset + 66, 5);
  view.setUint8(offset + 67, 1);
  setRootUint32(bytes, 68, NOSTREAM);
  setRootUint32(bytes, 72, NOSTREAM);
  setRootUint32(bytes, 76, NOSTREAM);
  setRootUint32(bytes, 116, 3);
  setRootUint32(bytes, 120, 64);
}

function initializeUnallocatedEntry(bytes: Uint8Array, streamId: number): void {
  const offset = directoryEntryOffset(bytes, streamId);
  bytes.fill(0, offset, offset + 128);
  for (const fieldOffset of [68, 72, 76]) {
    new DataView(bytes.buffer).setUint32(
      offset + fieldOffset,
      NOSTREAM,
      true
    );
  }
}

function writeEntryName(bytes: Uint8Array, streamId: number, name: string): void {
  const offset = directoryEntryOffset(bytes, streamId);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(offset + index * 2, name.charCodeAt(index), true);
  }
  view.setUint16(offset + name.length * 2, 0, true);
  view.setUint16(offset + 64, (name.length + 1) * 2, true);
}

function setRootUint32(bytes: Uint8Array, fieldOffset: number, value: number): void {
  new DataView(bytes.buffer).setUint32(
    directoryEntryOffset(bytes, 0) + fieldOffset,
    value,
    true
  );
}

function writeFatEntry(bytes: Uint8Array, sector: number, value: number): void {
  const sectorSize = readSectorSize(bytes);
  new DataView(bytes.buffer).setUint32(sectorSize + sector * 4, value, true);
}

function writeMiniFatEntry(bytes: Uint8Array, index: number, value: number): void {
  const sectorSize = readSectorSize(bytes);
  new DataView(bytes.buffer).setUint32(
    sectorSize * 3 + index * 4,
    value,
    true
  );
}

function directoryEntryOffset(bytes: Uint8Array, streamId: number): number {
  return readSectorSize(bytes) * 2 + streamId * 128;
}

function readSectorSize(bytes: Uint8Array): number {
  return new DataView(bytes.buffer).getUint16(26, true) === 3 ? 512 : 4096;
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileRootMiniStreamError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileRootMiniStreamError &&
      error.code === code
  );
}
