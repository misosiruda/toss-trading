import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_ENTRIES_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileDirectoryEntriesError,
  verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries
} from "./officialMarketCalendarOleCompoundFileDirectoryEntries.js";

const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

test("official calendar OLE directory entries verify fixed entry fields", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(
    compoundFileWithDirectory(3)
  );

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_ENTRIES_SCHEMA_VERSION
  );
  assert.equal(result.majorVersion, 3);
  assert.deepEqual(result.directorySectorLocations, [1]);
  assert.deepEqual(result.entries.slice(0, 4), [
    {
      streamId: 0,
      name: "Root Entry",
      objectType: "root",
      color: "black",
      leftSiblingId: null,
      rightSiblingId: null,
      childId: 1,
      startingSector: ENDOFCHAIN,
      streamSize: "0"
    },
    {
      streamId: 1,
      name: "Storage",
      objectType: "storage",
      color: "black",
      leftSiblingId: null,
      rightSiblingId: null,
      childId: 2,
      startingSector: 0,
      streamSize: "0"
    },
    {
      streamId: 2,
      name: "WordDocument",
      objectType: "stream",
      color: "black",
      leftSiblingId: null,
      rightSiblingId: null,
      childId: null,
      startingSector: ENDOFCHAIN,
      streamSize: "0"
    },
    {
      streamId: 3,
      name: null,
      objectType: "unallocated",
      color: null,
      leftSiblingId: null,
      rightSiblingId: null,
      childId: null,
      startingSector: 0,
      streamSize: "0"
    }
  ]);
  assert.equal(result.directoryEntriesVerified, true);
  assert.equal(result.treeStatus, "not_verified");
  assert.equal(result.streamAllocationStatus, "not_verified");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.entries), true);
  assert.equal(Object.isFrozen(result.entries[0]), true);
});

test("official calendar OLE directory entries use version-aware stream size", () => {
  const version3 = compoundFileWithDirectory(3);
  setEntryUint32(version3, 2, 120, 12);
  setEntryUint32(version3, 2, 124, 7);
  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(version3)
      .entries[2]?.streamSize,
    "12"
  );

  const version4 = compoundFileWithDirectory(4);
  setEntryUint32(version4, 2, 120, 1);
  setEntryUint32(version4, 2, 124, 1);
  const result = verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(
    version4
  );
  assert.equal(result.entries.length, 32);
  assert.equal(result.entries[2]?.streamSize, "4294967297");

  const oversizedVersion3 = compoundFileWithDirectory(3);
  setEntryUint32(oversizedVersion3, 2, 120, 0x80000001);
  assertCode(
    oversizedVersion3,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );

  const oversizedRootMiniStream = compoundFileWithDirectory(3);
  setEntryUint32(oversizedRootMiniStream, 0, 120, 0x80000001);
  assertCode(
    oversizedRootMiniStream,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );
});

test("official calendar OLE directory entries preserve parser compatibility", () => {
  const bytes = compoundFileWithDirectory(3);
  setEntryUint32(bytes, 2, 96, 7);
  const storageOffset = entryOffset(bytes, 1);
  new DataView(bytes.buffer).setUint16(storageOffset + 62, 0x1234, true);

  const result = verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(
    bytes
  );
  assert.equal(result.entries[1]?.name, "Storage");
  assert.equal(result.entries[2]?.objectType, "stream");
});

test("official calendar OLE directory entries reject invalid root", () => {
  const wrongName = compoundFileWithDirectory(3);
  writeEntryName(wrongName, 0, "Not Root");
  assertCode(
    wrongName,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT"
  );

  const nonzeroCreationTime = compoundFileWithDirectory(3);
  setEntryUint32(nonzeroCreationTime, 0, 100, 1);
  assertCode(
    nonzeroCreationTime,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT"
  );
});

test("official calendar OLE directory entries reject invalid names", () => {
  const illegalCharacter = compoundFileWithDirectory(3);
  writeEntryName(illegalCharacter, 1, "Bad/Name");
  assertCode(
    illegalCharacter,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_NAME"
  );

  const unpairedSurrogate = compoundFileWithDirectory(3);
  const offset = entryOffset(unpairedSurrogate, 1);
  const view = new DataView(unpairedSurrogate.buffer);
  view.setUint16(offset, 0xd800, true);
  view.setUint16(offset + 2, 0, true);
  view.setUint16(offset + 64, 4, true);
  assertCode(
    unpairedSurrogate,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_NAME"
  );
});

test("official calendar OLE directory entries reject invalid pointers", () => {
  const bytes = compoundFileWithDirectory(3);
  setEntryUint32(bytes, 1, 68, 4);
  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_POINTER"
  );
});

test("official calendar OLE directory entries enforce type-specific fields", () => {
  const invalidObjectType = compoundFileWithDirectory(3);
  new DataView(invalidObjectType.buffer).setUint8(
    entryOffset(invalidObjectType, 1) + 66,
    3
  );
  assertCode(
    invalidObjectType,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );

  const invalidColor = compoundFileWithDirectory(3);
  new DataView(invalidColor.buffer).setUint8(
    entryOffset(invalidColor, 1) + 67,
    2
  );
  assertCode(
    invalidColor,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );

  const dirtyUnallocated = compoundFileWithDirectory(3);
  new DataView(dirtyUnallocated.buffer).setUint8(
    entryOffset(dirtyUnallocated, 3),
    1
  );
  assertCode(
    dirtyUnallocated,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );

  const streamWithChild = compoundFileWithDirectory(3);
  setEntryUint32(streamWithChild, 2, 76, 1);
  assertCode(
    streamWithChild,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );

  const streamWithClsid = compoundFileWithDirectory(3);
  new DataView(streamWithClsid.buffer).setUint8(
    entryOffset(streamWithClsid, 2) + 80,
    1
  );
  assertCode(
    streamWithClsid,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );

  const storageWithStream = compoundFileWithDirectory(3);
  setEntryUint32(storageWithStream, 1, 116, ENDOFCHAIN);
  assertCode(
    storageWithStream,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  );
});

test("official calendar OLE directory entries use intrinsic byte-view properties", () => {
  const bytes = compoundFileWithDirectory(3);
  const alternate = bytes.slice();
  writeEntryName(alternate, 0, "Not Root");
  Object.defineProperties(bytes, {
    buffer: { value: alternate.buffer },
    byteOffset: { value: alternate.byteOffset },
    byteLength: { value: alternate.byteLength }
  });

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(bytes)
      .directoryEntriesVerified,
    true
  );
});

function compoundFileWithDirectory(majorVersion: 3 | 4): Uint8Array {
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
  view.setUint32(60, ENDOFCHAIN, true);
  view.setUint32(64, 0, true);
  view.setUint32(68, ENDOFCHAIN, true);
  view.setUint32(72, 0, true);
  view.setUint32(76, 0, true);
  for (let index = 1; index < 109; index += 1) {
    view.setUint32(76 + index * 4, FREESECT, true);
  }
  bytes.fill(0xff, sectorSize, sectorSize * 2);
  view.setUint32(sectorSize, FATSECT, true);
  view.setUint32(sectorSize + 4, ENDOFCHAIN, true);
  initializeRootEntry(bytes);
  initializeStorageEntry(bytes, 1);
  initializeStreamEntry(bytes, 2);
  const entriesPerSector = sectorSize / 128;
  for (let streamId = 3; streamId < entriesPerSector; streamId += 1) {
    initializeUnallocatedEntry(bytes, streamId);
  }
  return bytes;
}

function initializeRootEntry(bytes: Uint8Array): void {
  initializeAllocatedEntry(bytes, 0, "Root Entry", 5);
  setEntryUint32(bytes, 0, 68, NOSTREAM);
  setEntryUint32(bytes, 0, 72, NOSTREAM);
  setEntryUint32(bytes, 0, 76, 1);
  setEntryUint32(bytes, 0, 116, ENDOFCHAIN);
}

function initializeStorageEntry(bytes: Uint8Array, streamId: number): void {
  initializeAllocatedEntry(bytes, streamId, "Storage", 1);
  setEntryUint32(bytes, streamId, 68, NOSTREAM);
  setEntryUint32(bytes, streamId, 72, NOSTREAM);
  setEntryUint32(bytes, streamId, 76, 2);
}

function initializeStreamEntry(bytes: Uint8Array, streamId: number): void {
  initializeAllocatedEntry(bytes, streamId, "WordDocument", 2);
  setEntryUint32(bytes, streamId, 68, NOSTREAM);
  setEntryUint32(bytes, streamId, 72, NOSTREAM);
  setEntryUint32(bytes, streamId, 76, NOSTREAM);
  setEntryUint32(bytes, streamId, 116, ENDOFCHAIN);
}

function initializeAllocatedEntry(
  bytes: Uint8Array,
  streamId: number,
  name: string,
  objectType: number
): void {
  writeEntryName(bytes, streamId, name);
  const view = new DataView(bytes.buffer);
  const offset = entryOffset(bytes, streamId);
  view.setUint8(offset + 66, objectType);
  view.setUint8(offset + 67, 1);
}

function initializeUnallocatedEntry(
  bytes: Uint8Array,
  streamId: number
): void {
  const offset = entryOffset(bytes, streamId);
  bytes.fill(0, offset, offset + 128);
  setEntryUint32(bytes, streamId, 68, NOSTREAM);
  setEntryUint32(bytes, streamId, 72, NOSTREAM);
  setEntryUint32(bytes, streamId, 76, NOSTREAM);
}

function writeEntryName(
  bytes: Uint8Array,
  streamId: number,
  name: string
): void {
  const offset = entryOffset(bytes, streamId);
  bytes.fill(0, offset, offset + 64);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(offset + index * 2, name.charCodeAt(index), true);
  }
  view.setUint16(offset + name.length * 2, 0, true);
  view.setUint16(offset + 64, (name.length + 1) * 2, true);
}

function setEntryUint32(
  bytes: Uint8Array,
  streamId: number,
  fieldOffset: number,
  value: number
): void {
  new DataView(bytes.buffer).setUint32(
    entryOffset(bytes, streamId) + fieldOffset,
    value,
    true
  );
}

function entryOffset(bytes: Uint8Array, streamId: number): number {
  const sectorSize =
    new DataView(bytes.buffer).getUint16(26, true) === 3 ? 512 : 4096;
  return sectorSize * 2 + streamId * 128;
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileDirectoryEntriesError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileDirectoryEntriesError &&
      error.code === code
  );
}
