import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_ALLOCATION_SCHEMA_VERSION,
  OfficialMarketCalendarOleCompoundFileUserStreamAllocationError,
  verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation
} from "./officialMarketCalendarOleCompoundFileUserStreamAllocation.js";
import {
  OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_BYTES_SCHEMA_VERSION,
  projectOfficialMarketCalendarOleCompoundFileUserStreamBytes
} from "./officialMarketCalendarOleCompoundFileUserStreamBytes.js";

const FATSECT = 0xfffffffd;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

test("official calendar OLE user streams verify mini FAT and FAT allocation", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(
    compoundFileWithUserStreams(3)
  );
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_ALLOCATION_SCHEMA_VERSION
  );
  assert.deepEqual(result.streams, [
    {
      streamId: 1,
      name: "Large",
      streamSize: "4096",
      allocation: "fat",
      sectorLocations: [4, 5, 6, 7, 8, 9, 10, 11]
    },
    {
      streamId: 2,
      name: "Small",
      streamSize: "64",
      allocation: "mini_fat",
      sectorLocations: [0]
    }
  ]);
  assert.equal(result.userStreamAllocationVerified, true);
  assert.equal(result.miniFatOwnershipVerified, true);
  assert.equal(result.streamBytesStatus, "not_verified");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.streams), true);
  assert.equal(Object.isFrozen(result.streams[0]?.sectorLocations), true);
});

test("official calendar OLE user streams use version 4 sector capacity", () => {
  const result = verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(
    compoundFileWithUserStreams(4)
  );
  assert.equal(result.majorVersion, 4);
  assert.equal(result.sectorSize, 4096);
  assert.deepEqual(result.streams[0]?.sectorLocations, [4]);
  assert.deepEqual(result.streams[1]?.sectorLocations, [0]);
});

test("official calendar OLE user streams ignore empty stream starting sectors", () => {
  const bytes = compoundFileWithUserStreams(3);
  setStreamUint32(bytes, 2, 116, 0xfffffffb);
  setStreamUint32(bytes, 2, 120, 0);
  writeMiniFatEntry(bytes, 0, FREESECT);

  const result = verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(
    bytes
  );
  assert.equal(result.streams[1]?.allocation, "empty");
  assert.deepEqual(result.streams[1]?.sectorLocations, []);
  const projected =
    projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(bytes);
  assert.equal(projected.streams[1]?.bytes.length, 0);
});

test("official calendar OLE user streams allow overallocated valid chains", () => {
  const bytes = compoundFileWithUserStreams(3);
  setRootUint32(bytes, 120, 192);
  setStreamUint32(bytes, 2, 120, 65);
  writeMiniFatEntry(bytes, 0, 1);
  writeMiniFatEntry(bytes, 1, 2);
  writeMiniFatEntry(bytes, 2, ENDOFCHAIN);

  const result = verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(
    bytes
  );
  assert.deepEqual(result.streams[1]?.sectorLocations, [0, 1, 2]);
});

test("official calendar OLE user streams reject invalid nonempty starts", () => {
  const mini = compoundFileWithUserStreams(3);
  setStreamUint32(mini, 2, 116, ENDOFCHAIN);
  assertCode(mini, "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_START");

  const fat = compoundFileWithUserStreams(3);
  setStreamUint32(fat, 1, 116, 0xfffffffb);
  assertCode(fat, "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_START");
});

test("official calendar OLE user streams reject insufficient chains", () => {
  const mini = compoundFileWithUserStreams(3);
  setStreamUint32(mini, 2, 120, 65);
  assertCode(
    mini,
    "OFFICIAL_CALENDAR_OLE_USER_STREAM_INSUFFICIENT_CAPACITY"
  );

  const fat = compoundFileWithUserStreams(3);
  setStreamUint32(fat, 1, 120, 4097);
  assertCode(
    fat,
    "OFFICIAL_CALENDAR_OLE_USER_STREAM_INSUFFICIENT_CAPACITY"
  );
});

test("official calendar OLE user streams reject cycles", () => {
  const mini = compoundFileWithUserStreams(3);
  writeMiniFatEntry(mini, 0, 0);
  assertCode(mini, "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_CHAIN");

  const fat = compoundFileWithUserStreams(3);
  writeFatEntry(fat, 4, 4);
  assertCode(fat, "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_CHAIN");
});

test("official calendar OLE user streams reject cross-stream reuse", () => {
  const bytes = compoundFileWithUserStreams(3);
  setStreamUint32(bytes, 1, 116, 0);
  setStreamUint32(bytes, 1, 120, 64);
  for (let sector = 4; sector <= 12; sector += 1) {
    writeFatEntry(bytes, sector, FREESECT);
  }

  assertCode(bytes, "OFFICIAL_CALENDAR_OLE_USER_STREAM_SECTOR_REUSE");
});

test("official calendar OLE user streams reject root and system sector reuse", () => {
  for (const sector of [0, 1, 2, 3]) {
    const bytes = compoundFileWithUserStreams(3);
    setStreamUint32(bytes, 1, 116, sector);
    assertCode(bytes, "OFFICIAL_CALENDAR_OLE_USER_STREAM_SECTOR_REUSE");
  }
});

test("official calendar OLE user streams reject unowned mini FAT entries", () => {
  const bytes = compoundFileWithUserStreams(3);
  setRootUint32(bytes, 120, 128);
  writeMiniFatEntry(bytes, 1, ENDOFCHAIN);

  assertCode(
    bytes,
    "OFFICIAL_CALENDAR_OLE_USER_STREAM_UNOWNED_MINI_FAT_ENTRY"
  );
});

test("official calendar OLE user stream bytes project owned v3 and v4 copies", () => {
  for (const majorVersion of [3, 4] as const) {
    const bytes = compoundFileWithUserStreams(majorVersion);
    const sectorSize = readSectorSize(bytes);
    const largeSectorCount = 4096 / sectorSize;
    for (let index = 0; index < largeSectorCount; index += 1) {
      fillFileSector(bytes, 4 + index, 0x31 + index);
    }
    fillFileSectorRange(bytes, 3, 0, 64, 0x42);

    const result = projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(
      bytes
    );
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_BYTES_SCHEMA_VERSION
    );
    assert.equal(result.sectorSize, sectorSize);
    assert.equal(result.streamBytesProjected, true);
    assert.equal(result.trailingAllocationBytesStatus, "excluded");
    assert.equal(result.wordDocumentStatus, "not_parsed");
    assert.equal(result.streams[0]?.bytes.length, 4096);
    assert.equal(result.streams[0]?.bytes[0], 0x31);
    assert.equal(
      result.streams[0]?.bytes[4095],
      0x31 + largeSectorCount - 1
    );
    if (largeSectorCount > 1) {
      assert.equal(result.streams[0]?.bytes[sectorSize], 0x32);
    }
    assert.equal(result.streams[1]?.bytes.length, 64);
    assert.equal(result.streams[1]?.bytes.every((byte) => byte === 0x42), true);
    assert.equal(result.streams[0]?.bytesOwnership, "caller_owned_copy");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.streams), true);
    assert.equal(Object.isFrozen(result.streams[0]), true);

    bytes[(4 + 1) * sectorSize] = 0x99;
    assert.equal(result.streams[0]?.bytes[0], 0x31);
    result.streams[0]!.bytes[0] = 0x77;
    assert.equal(bytes[(4 + 1) * sectorSize], 0x99);
  }
});

test("official calendar OLE user stream bytes map fragmented root mini stream sectors", () => {
  const bytes = compoundFileWithUserStreams(3);
  setRootUint32(bytes, 120, 576);
  setStreamUint32(bytes, 2, 116, 7);
  setStreamUint32(bytes, 2, 120, 80);
  writeFatEntry(bytes, 3, 12);
  writeFatEntry(bytes, 12, ENDOFCHAIN);
  writeMiniFatEntry(bytes, 0, FREESECT);
  writeMiniFatEntry(bytes, 7, 8);
  writeMiniFatEntry(bytes, 8, ENDOFCHAIN);
  fillFileSectorRange(bytes, 3, 448, 64, 0x51);
  fillFileSectorRange(bytes, 12, 0, 16, 0x62);

  const result = projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(
    bytes
  );
  assert.deepEqual(Array.from(result.streams[1]!.bytes), [
    ...new Array<number>(64).fill(0x51),
    ...new Array<number>(16).fill(0x62)
  ]);
});

test("official calendar OLE user stream bytes exclude trailing allocation bytes", () => {
  const bytes = compoundFileWithUserStreams(3);
  setRootUint32(bytes, 120, 192);
  setStreamUint32(bytes, 2, 120, 65);
  writeMiniFatEntry(bytes, 0, 1);
  writeMiniFatEntry(bytes, 1, 2);
  writeMiniFatEntry(bytes, 2, ENDOFCHAIN);
  fillFileSectorRange(bytes, 3, 0, 64, 0x71);
  fillFileSectorRange(bytes, 3, 64, 64, 0x72);
  fillFileSectorRange(bytes, 3, 128, 64, 0x73);
  Object.defineProperty(bytes, "byteLength", { value: 1 });

  const result = projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(
    bytes
  );
  assert.equal(result.streams[1]?.bytes.length, 65);
  assert.equal(result.streams[1]?.bytes[0], 0x71);
  assert.equal(result.streams[1]?.bytes[63], 0x71);
  assert.equal(result.streams[1]?.bytes[64], 0x72);
  assert.equal(result.streams[1]?.bytes.includes(0x73), false);
});

function compoundFileWithUserStreams(majorVersion: 3 | 4): Uint8Array {
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  const bytes = new Uint8Array(sectorSize * 14);
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
  const largeStreamSectorCount = 4096 / sectorSize;
  for (let index = 0; index < largeStreamSectorCount; index += 1) {
    const sector = 4 + index;
    writeFatEntry(
      bytes,
      sector,
      index === largeStreamSectorCount - 1 ? ENDOFCHAIN : sector + 1
    );
  }
  for (let sector = 4 + largeStreamSectorCount; sector <= 12; sector += 1) {
    writeFatEntry(bytes, sector, FREESECT);
  }

  initializeRootEntry(bytes);
  initializeStreamEntry(bytes, 1, "Large", 4096, 4);
  initializeStreamEntry(bytes, 2, "Small", 64, 0);
  setStreamUint32(bytes, 1, 72, 2);
  const entriesPerDirectorySector = sectorSize / 128;
  for (let streamId = 3; streamId < entriesPerDirectorySector; streamId += 1) {
    initializeUnallocatedEntry(bytes, streamId);
  }
  bytes.fill(0xff, sectorSize * 3, sectorSize * 4);
  writeMiniFatEntry(bytes, 0, ENDOFCHAIN);
  return bytes;
}

function initializeRootEntry(bytes: Uint8Array): void {
  initializeAllocatedEntry(bytes, 0, "Root Entry", 5);
  setRootUint32(bytes, 68, NOSTREAM);
  setRootUint32(bytes, 72, NOSTREAM);
  setRootUint32(bytes, 76, 1);
  setRootUint32(bytes, 116, 3);
  setRootUint32(bytes, 120, 64);
}

function initializeStreamEntry(
  bytes: Uint8Array,
  streamId: number,
  name: string,
  size: number,
  startingSector: number
): void {
  initializeAllocatedEntry(bytes, streamId, name, 2);
  setStreamUint32(bytes, streamId, 68, NOSTREAM);
  setStreamUint32(bytes, streamId, 72, NOSTREAM);
  setStreamUint32(bytes, streamId, 76, NOSTREAM);
  setStreamUint32(bytes, streamId, 116, startingSector);
  setStreamUint32(bytes, streamId, 120, size);
}

function initializeAllocatedEntry(
  bytes: Uint8Array,
  streamId: number,
  name: string,
  type: number
): void {
  const offset = directoryEntryOffset(bytes, streamId);
  bytes.fill(0, offset, offset + 128);
  writeEntryName(bytes, streamId, name);
  const view = new DataView(bytes.buffer);
  view.setUint8(offset + 66, type);
  view.setUint8(offset + 67, 1);
}

function initializeUnallocatedEntry(bytes: Uint8Array, streamId: number): void {
  const offset = directoryEntryOffset(bytes, streamId);
  bytes.fill(0, offset, offset + 128);
  for (const fieldOffset of [68, 72, 76]) {
    setStreamUint32(bytes, streamId, fieldOffset, NOSTREAM);
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
  setStreamUint32(bytes, 0, fieldOffset, value);
}

function setStreamUint32(
  bytes: Uint8Array,
  streamId: number,
  fieldOffset: number,
  value: number
): void {
  new DataView(bytes.buffer).setUint32(
    directoryEntryOffset(bytes, streamId) + fieldOffset,
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

function fillFileSector(
  bytes: Uint8Array,
  sector: number,
  value: number
): void {
  fillFileSectorRange(bytes, sector, 0, readSectorSize(bytes), value);
}

function fillFileSectorRange(
  bytes: Uint8Array,
  sector: number,
  withinSectorOffset: number,
  byteLength: number,
  value: number
): void {
  const sectorSize = readSectorSize(bytes);
  bytes.fill(
    value,
    (sector + 1) * sectorSize + withinSectorOffset,
    (sector + 1) * sectorSize + withinSectorOffset + byteLength
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
  code: OfficialMarketCalendarOleCompoundFileUserStreamAllocationError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileUserStreamAllocationError &&
      error.code === code
  );
}
