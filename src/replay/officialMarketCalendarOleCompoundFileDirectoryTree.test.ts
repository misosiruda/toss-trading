import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_TREE_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileDirectoryTreeError,
  verifyOfficialMarketCalendarOleCompoundFileDirectoryTree
} from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";

const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

test("official calendar OLE directory tree verifies nested child trees", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(
    compoundFileWithDirectoryTree()
  );

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_TREE_SCHEMA_VERSION
  );
  assert.equal(result.majorVersion, 3);
  assert.equal(result.sectorSize, 512);
  assert.deepEqual(result.directorySectorLocations, [1]);
  assert.equal(result.entries[1]?.name, "Storage");
  assert.equal(result.entries[2]?.name, "WordDocument");
  assert.equal(result.directoryEntriesVerified, true);
  assert.equal(result.directoryTreeVerified, true);
  assert.equal(result.treeStatus, "verified");
  assert.equal(result.streamAllocationStatus, "not_verified");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.entries), true);
});

test("official calendar OLE directory tree allows an empty root hierarchy", () => {
  const bytes = compoundFileWithDirectoryTree();
  setEntryUint32(bytes, 0, 76, NOSTREAM);
  initializeUnallocatedEntry(bytes, 1);
  initializeUnallocatedEntry(bytes, 2);

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(bytes)
      .directoryTreeVerified,
    true
  );
});

test("official calendar OLE directory tree requires black child-tree roots", () => {
  const rootChildRed = compoundFileWithDirectoryTree();
  setEntryColor(rootChildRed, 1, 0);
  assertCode(
    rootChildRed,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_COLOR"
  );

  const nestedChildRed = compoundFileWithDirectoryTree();
  setEntryColor(nestedChildRed, 2, 0);
  assertCode(
    nestedChildRed,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_COLOR"
  );
});

test("official calendar OLE directory tree rejects consecutive red nodes", () => {
  const bytes = compoundFileWithDirectoryTree();
  configureThreeNodeSiblingTree(bytes, "C", "B", "A");
  setEntryUint32(bytes, 1, 68, 2);
  setEntryUint32(bytes, 2, 68, 3);
  setEntryColor(bytes, 2, 0);
  setEntryColor(bytes, 3, 0);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_COLOR"
  );
});

test("official calendar OLE directory tree enforces global name bounds", () => {
  const bytes = compoundFileWithDirectoryTree();
  configureThreeNodeSiblingTree(bytes, "B", "A", "C");
  setEntryUint32(bytes, 1, 68, 2);
  setEntryUint32(bytes, 2, 72, 3);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_ORDER"
  );
});

test("official calendar OLE directory tree compares equal-length names case-insensitively", () => {
  const bytes = compoundFileWithDirectoryTree();
  writeEntryName(bytes, 1, "Data");
  writeEntryName(bytes, 2, "dATA");
  setEntryUint32(bytes, 1, 76, NOSTREAM);
  setEntryUint32(bytes, 1, 72, 2);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_ORDER"
  );
});

test("official calendar OLE directory tree uses pinned Unicode simple uppercase", () => {
  const bytes = compoundFileWithDirectoryTree();
  writeEntryName(bytes, 1, "\u1f80");
  writeEntryName(bytes, 2, "\u1f88");
  setEntryUint32(bytes, 1, 76, NOSTREAM);
  setEntryUint32(bytes, 1, 72, 2);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_ORDER"
  );
});

test("official calendar OLE directory tree uses name length before code units", () => {
  const bytes = compoundFileWithDirectoryTree();
  writeEntryName(bytes, 1, "Z");
  writeEntryName(bytes, 2, "aa");
  setEntryUint32(bytes, 1, 76, NOSTREAM);
  setEntryUint32(bytes, 1, 72, 2);

  assert.equal(
    verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(bytes)
      .directoryTreeVerified,
    true
  );
});

test("official calendar OLE directory tree rejects cycles", () => {
  const bytes = compoundFileWithDirectoryTree();
  setEntryUint32(bytes, 1, 76, NOSTREAM);
  setEntryUint32(bytes, 1, 68, 1);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_OWNERSHIP"
  );
});

test("official calendar OLE directory tree rejects cross-parent reuse", () => {
  const bytes = compoundFileWithDirectoryTree();
  writeEntryName(bytes, 1, "A");
  initializeStorageEntry(bytes, 3, "B");
  setEntryUint32(bytes, 1, 72, 3);
  setEntryUint32(bytes, 3, 76, 2);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_OWNERSHIP"
  );
});

test("official calendar OLE directory tree rejects root and unallocated references", () => {
  const rootReference = compoundFileWithDirectoryTree();
  setEntryUint32(rootReference, 1, 76, NOSTREAM);
  setEntryUint32(rootReference, 1, 68, 0);
  assertCode(
    rootReference,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_NODE"
  );

  const unallocatedReference = compoundFileWithDirectoryTree();
  setEntryUint32(unallocatedReference, 0, 76, 3);
  assertCode(
    unallocatedReference,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_NODE"
  );
});

test("official calendar OLE directory tree rejects unreachable allocated entries", () => {
  const bytes = compoundFileWithDirectoryTree();
  initializeStreamEntry(bytes, 3, "Orphan");

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_UNREACHABLE_ENTRY"
  );
});

function compoundFileWithDirectoryTree(): Uint8Array {
  const sectorSize = 512;
  const bytes = new Uint8Array(sectorSize * 3);
  const view = new DataView(bytes.buffer);
  bytes.set(
    Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    0
  );
  view.setUint16(24, 62, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(40, 0, true);
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
  initializeStorageEntry(bytes, 1, "Storage");
  initializeStreamEntry(bytes, 2, "WordDocument");
  initializeUnallocatedEntry(bytes, 3);
  return bytes;
}

function configureThreeNodeSiblingTree(
  bytes: Uint8Array,
  firstName: string,
  secondName: string,
  thirdName: string
): void {
  writeEntryName(bytes, 1, firstName);
  setEntryUint32(bytes, 1, 76, NOSTREAM);
  writeEntryName(bytes, 2, secondName);
  initializeStreamEntry(bytes, 3, thirdName);
}

function initializeRootEntry(bytes: Uint8Array): void {
  initializeAllocatedEntry(bytes, 0, "Root Entry", 5);
  setEntryUint32(bytes, 0, 68, NOSTREAM);
  setEntryUint32(bytes, 0, 72, NOSTREAM);
  setEntryUint32(bytes, 0, 76, 1);
  setEntryUint32(bytes, 0, 116, ENDOFCHAIN);
}

function initializeStorageEntry(
  bytes: Uint8Array,
  streamId: number,
  name: string
): void {
  initializeAllocatedEntry(bytes, streamId, name, 1);
  setEntryUint32(bytes, streamId, 68, NOSTREAM);
  setEntryUint32(bytes, streamId, 72, NOSTREAM);
  setEntryUint32(bytes, streamId, 76, streamId === 1 ? 2 : NOSTREAM);
}

function initializeStreamEntry(
  bytes: Uint8Array,
  streamId: number,
  name: string
): void {
  initializeAllocatedEntry(bytes, streamId, name, 2);
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
  const offset = entryOffset(streamId);
  bytes.fill(0, offset, offset + 128);
  writeEntryName(bytes, streamId, name);
  const view = new DataView(bytes.buffer);
  view.setUint8(offset + 66, objectType);
  view.setUint8(offset + 67, 1);
}

function initializeUnallocatedEntry(bytes: Uint8Array, streamId: number): void {
  const offset = entryOffset(streamId);
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
  const offset = entryOffset(streamId);
  bytes.fill(0, offset, offset + 64);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < name.length; index += 1) {
    view.setUint16(offset + index * 2, name.charCodeAt(index), true);
  }
  view.setUint16(offset + name.length * 2, 0, true);
  view.setUint16(offset + 64, (name.length + 1) * 2, true);
}

function setEntryColor(
  bytes: Uint8Array,
  streamId: number,
  color: 0 | 1
): void {
  new DataView(bytes.buffer).setUint8(entryOffset(streamId) + 67, color);
}

function setEntryUint32(
  bytes: Uint8Array,
  streamId: number,
  fieldOffset: number,
  value: number
): void {
  new DataView(bytes.buffer).setUint32(
    entryOffset(streamId) + fieldOffset,
    value,
    true
  );
}

function entryOffset(streamId: number): number {
  return 1024 + streamId * 128;
}

function assertCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarOleCompoundFileDirectoryTreeError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileDirectoryTreeError &&
      error.code === code
  );
}
