import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_BINARY_FILE_STREAMS_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError,
  verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams
} from "./officialMarketCalendarKrxLegacyWordBinaryFileStreams.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_FIB_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordFibError,
  verifyOfficialMarketCalendarKrxLegacyWordFib
} from "./officialMarketCalendarKrxLegacyWordFib.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordClxReferenceError,
  verifyOfficialMarketCalendarKrxLegacyWordClxReference
} from "./officialMarketCalendarKrxLegacyWordClxReference.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError,
  verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference
} from "./officialMarketCalendarKrxLegacyWordPlcBtePapxReference.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPlcBtePapxError,
  verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx
} from "./officialMarketCalendarKrxLegacyWordPlcBtePapx.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCES_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError,
  verifyOfficialMarketCalendarKrxLegacyWordPapxFkpReferences
} from "./officialMarketCalendarKrxLegacyWordPapxFkpReferences.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordClxError,
  verifyOfficialMarketCalendarKrxLegacyWordClx
} from "./officialMarketCalendarKrxLegacyWordClx.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPlcPcdError,
  verifyOfficialMarketCalendarKrxLegacyWordPlcPcd
} from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordDocumentCountsError,
  verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts
} from "./officialMarketCalendarKrxLegacyWordDocumentCounts.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGES_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordTextRangesError,
  verifyOfficialMarketCalendarKrxLegacyWordTextRanges
} from "./officialMarketCalendarKrxLegacyWordTextRanges.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_SCHEMA_VERSION,
  projectOfficialMarketCalendarKrxLegacyWordTextBytes
} from "./officialMarketCalendarKrxLegacyWordTextBytes.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_SCHEMA_VERSION,
  decodeOfficialMarketCalendarKrxLegacyWordText
} from "./officialMarketCalendarKrxLegacyWordTextDecoding.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordMainDocumentError,
  verifyOfficialMarketCalendarKrxLegacyWordMainDocument
} from "./officialMarketCalendarKrxLegacyWordMainDocument.js";
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
  class EmptySpecies extends Uint8Array {
    constructor() {
      super(0);
    }
  }
  Object.defineProperty(bytes, "byteLength", { value: 1 });
  Object.defineProperty(bytes, "byteOffset", { value: 999 });
  Object.defineProperty(bytes, "buffer", { value: new ArrayBuffer(0) });
  Object.defineProperty(bytes, "constructor", {
    value: { [Symbol.species]: EmptySpecies }
  });

  const result = projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(
    bytes
  );
  assert.equal(result.streams[1]?.bytes.length, 65);
  assert.equal(result.streams[1]?.bytes[0], 0x71);
  assert.equal(result.streams[1]?.bytes[63], 0x71);
  assert.equal(result.streams[1]?.bytes[64], 0x72);
  assert.equal(result.streams[1]?.bytes.includes(0x73), false);
});

test("official calendar KRX legacy Word streams verify FibBase and table selection", () => {
  for (const tableStreamName of ["0Table", "1Table"] as const) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, tableStreamName);
    fillFileSectorRange(bytes, 3, 0, 64, 0x52);

    const result =
      verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(bytes);
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_BINARY_FILE_STREAMS_SCHEMA_VERSION
    );
    assert.equal(result.wordDocumentStreamId, 1);
    assert.equal(result.tableStreamId, 2);
    assert.equal(result.tableStreamName, tableStreamName);
    assert.equal(result.fWhichTblStm, tableStreamName === "1Table" ? 1 : 0);
    assert.equal(result.nFibBase, 0x00c1);
    assert.equal(result.fibBaseVerified, true);
    assert.equal(result.protectionStatus, "unencrypted");
    assert.equal(result.wordTableParserStatus, "not_parsed");
    assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
    assert.equal(result.wordDocumentBytes[0], 0xec);
    assert.equal(result.tableStreamBytes.every((byte) => byte === 0x52), true);
    assert.equal(Object.isFrozen(result), true);
  }
});

test("official calendar KRX legacy Word streams ignore the unselected table", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  initializeStreamEntry(bytes, 3, "0Table", 64, 1);
  setRootUint32(bytes, 120, 128);
  setStreamUint32(bytes, 1, 68, 2);
  setStreamUint32(bytes, 1, 72, NOSTREAM);
  setStreamUint32(bytes, 2, 68, 3);
  setStreamUint32(bytes, 2, 72, NOSTREAM);
  writeMiniFatEntry(bytes, 1, ENDOFCHAIN);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(bytes);
  assert.equal(result.tableStreamName, "1Table");
  assert.equal(result.ignoredTableStreamName, "0Table");
  assert.equal(result.tableStreamId, 2);
});

test("official calendar KRX legacy Word streams require root-level roles", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  initializeAllocatedEntry(bytes, 2, "Box", 1);
  setStreamUint32(bytes, 2, 68, NOSTREAM);
  setStreamUint32(bytes, 2, 72, NOSTREAM);
  setStreamUint32(bytes, 2, 76, 3);
  initializeStreamEntry(bytes, 3, "1Table", 64, 0);
  setStreamUint32(bytes, 1, 68, 2);
  setStreamUint32(bytes, 1, 72, NOSTREAM);

  assertWordCode(
    bytes,
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_MISSING"
  );
});

test("official calendar KRX legacy Word streams reject invalid FibBase fields", () => {
  const mutations: Array<(bytes: Uint8Array) => void> = [
    (bytes) => writeWordUint16(bytes, 0, 0),
    (bytes) => writeWordUint16(bytes, 10, 0x0200),
    (bytes) => writeWordUint16(bytes, 12, 0),
    (bytes) => writeWordUint32(bytes, 14, 1),
    (bytes) => writeWordByte(bytes, 18, 1),
    (bytes) => writeWordByte(bytes, 19, 1),
    (bytes) => writeWordUint16(bytes, 20, 1),
    (bytes) => writeWordUint16(bytes, 22, 1),
    (bytes) => writeWordUint16(bytes, 8, 1)
  ];
  for (const mutate of mutations) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    mutate(bytes);
    assertWordCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_BASE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word streams ignore undefined FibBase fields", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  writeWordByte(bytes, 19, 0xfe);
  writeWordUint32(bytes, 24, 0x12345678);
  writeWordUint32(bytes, 28, 0x90abcdef);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(bytes);
  assert.equal(result.fibBaseVerified, true);
  assert.equal(result.tableStreamName, "1Table");
});

test("official calendar KRX legacy Word streams ignore fObfuscated when unencrypted", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  writeWordUint16(bytes, 10, 0x9200);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(bytes);
  assert.equal(result.protectionStatus, "unencrypted");
  assert.equal(result.tableStreamName, "1Table");
});

test("official calendar KRX legacy Word streams reject unsupported encryption", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  writeWordUint16(bytes, 10, 0x1300);
  writeWordUint32(bytes, 14, 16);

  assertWordCode(
    bytes,
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PROTECTION_UNSUPPORTED"
  );
});

test("official calendar KRX legacy Word streams reject size limits before projection", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  setStreamUint32(bytes, 1, 120, 0x80000000);
  assertWordCode(
    bytes,
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_SIZE"
  );
});

test("official calendar KRX legacy Word FIB resolves every supported version", () => {
  const definitions = [
    { nFib: 0x00c1, version: "Word97", cbRgFcLcb: 0x005d, cswNew: 0 },
    { nFib: 0x00d9, version: "Word2000", cbRgFcLcb: 0x006c, cswNew: 2 },
    { nFib: 0x0101, version: "Word2002", cbRgFcLcb: 0x0088, cswNew: 2 },
    { nFib: 0x010c, version: "Word2003", cbRgFcLcb: 0x00a4, cswNew: 2 },
    { nFib: 0x0112, version: "Word2007", cbRgFcLcb: 0x00b7, cswNew: 5 }
  ] as const;
  for (const definition of definitions) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, definition);

    const result = verifyOfficialMarketCalendarKrxLegacyWordFib(bytes);
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_FIB_SCHEMA_VERSION
    );
    assert.equal(result.nFib, definition.nFib);
    assert.equal(result.version, definition.version);
    assert.equal(result.csw, 0x000e);
    assert.equal(result.cslw, 0x0016);
    assert.equal(result.cbRgFcLcb, definition.cbRgFcLcb);
    assert.equal(result.cswNew, definition.cswNew);
    assert.equal(
      result.fibByteLength,
      156 + definition.cbRgFcLcb * 8 + definition.cswNew * 2
    );
    assert.equal(result.fibStructureVerified, true);
    assert.equal(result.fibFieldStatus, "count_sections_only_not_parsed");
    assert.equal(result.clxStatus, "not_parsed");
  }
});

test("official calendar KRX legacy Word FIB rejects invalid count structure", () => {
  const mutations: Array<(bytes: Uint8Array) => void> = [
    (bytes) => writeWordUint16(bytes, 32, 13),
    (bytes) => writeWordUint16(bytes, 62, 21),
    (bytes) => writeWordUint16(bytes, 152, 0xffff)
  ];
  for (const mutate of mutations) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    mutate(bytes);
    assertFibCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_STRUCTURE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word FIB rejects version/count drift", () => {
  const mutations: Array<(bytes: Uint8Array) => void> = [
    (bytes) => writeWordUint16(bytes, 152, 0x006c),
    (bytes) => writeWordUint16(bytes, 898, 2),
    (bytes) => {
      configureVariableFib(bytes, {
        nFib: 0x00d9,
        version: "Word2000",
        cbRgFcLcb: 0x006c,
        cswNew: 2
      });
      writeWordUint16(bytes, 1020, 0x9999);
    },
    (bytes) => {
      configureVariableFib(bytes, {
        nFib: 0x00d9,
        version: "Word2000",
        cbRgFcLcb: 0x006c,
        cswNew: 2
      });
      writeWordUint16(bytes, 10, 0x1200);
    }
  ];
  for (const mutate of mutations) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    mutate(bytes);
    assertFibCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_VERSION_INVALID"
    );
  }
});

test("official calendar KRX legacy Word CLX reference projects every supported version", () => {
  const definitions = [
    { nFib: 0x00c1, version: "Word97", cbRgFcLcb: 0x005d, cswNew: 0 },
    { nFib: 0x00d9, version: "Word2000", cbRgFcLcb: 0x006c, cswNew: 2 },
    { nFib: 0x0101, version: "Word2002", cbRgFcLcb: 0x0088, cswNew: 2 },
    { nFib: 0x010c, version: "Word2003", cbRgFcLcb: 0x00a4, cswNew: 2 },
    { nFib: 0x0112, version: "Word2007", cbRgFcLcb: 0x00b7, cswNew: 5 }
  ] as const;
  for (const definition of definitions) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, definition);
    configureClxReference(bytes, 7, 11, 0x6a);

    const result = verifyOfficialMarketCalendarKrxLegacyWordClxReference(bytes);
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_SCHEMA_VERSION
    );
    assert.equal(result.nFib, definition.nFib);
    assert.equal(result.version, definition.version);
    assert.equal(result.tableStreamName, "1Table");
    assert.equal(result.fcClx, 7);
    assert.equal(result.lcbClx, 11);
    assert.deepEqual(result.clxBytes, new Uint8Array(11).fill(0x6a));
    assert.equal(result.clxReferenceVerified, true);
    assert.equal(result.clxParserStatus, "reference_only_not_parsed");
    assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
    assert.equal(Object.isFrozen(result), true);

    fillFileSectorRange(bytes, 3, 7, 11, 0x7b);
    assert.deepEqual(result.clxBytes, new Uint8Array(11).fill(0x6a));
  }
});

test("official calendar KRX legacy Word CLX reference rejects empty or out-of-bounds ranges", () => {
  const invalidReferences = [
    { offset: 0, size: 0 },
    { offset: 64, size: 1 },
    { offset: 63, size: 2 },
    { offset: 0xffffffff, size: 1 }
  ];
  for (const reference of invalidReferences) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configureClxReference(bytes, reference.offset, reference.size, 0);

    assertClxReferenceCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word PlcBtePapx reference projects every supported version", () => {
  const definitions = [
    { nFib: 0x00c1, version: "Word97", cbRgFcLcb: 0x005d, cswNew: 0 },
    { nFib: 0x00d9, version: "Word2000", cbRgFcLcb: 0x006c, cswNew: 2 },
    { nFib: 0x0101, version: "Word2002", cbRgFcLcb: 0x0088, cswNew: 2 },
    { nFib: 0x010c, version: "Word2003", cbRgFcLcb: 0x00a4, cswNew: 2 },
    { nFib: 0x0112, version: "Word2007", cbRgFcLcb: 0x00b7, cswNew: 5 }
  ] as const;
  for (const definition of definitions) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, definition);
    configurePlcBtePapxReference(bytes, 20, 12, 0x4a);

    const result =
      verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference(bytes);
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_SCHEMA_VERSION
    );
    assert.equal(result.nFib, definition.nFib);
    assert.equal(result.version, definition.version);
    assert.equal(result.tableStreamName, "1Table");
    assert.equal(result.fcPlcfBtePapx, 20);
    assert.equal(result.lcbPlcfBtePapx, 12);
    assert.deepEqual(
      result.plcBtePapxBytes,
      new Uint8Array(12).fill(0x4a)
    );
    assert.equal(result.bytesOwnership, "caller_owned_copy");
    assert.equal(result.plcBtePapxReferenceVerified, true);
    assert.equal(result.plcBtePapxFramingStatus, "not_parsed");
    assert.equal(result.papxFkpStatus, "not_parsed");
    assert.equal(result.paragraphPropertiesStatus, "not_parsed");
    assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
    assert.equal(Object.isFrozen(result), true);

    fillFileSectorRange(bytes, 3, 20, 12, 0x7b);
    assert.deepEqual(
      result.plcBtePapxBytes,
      new Uint8Array(12).fill(0x4a)
    );
  }
});

test("official calendar KRX legacy Word PlcBtePapx reference rejects invalid ranges", () => {
  const invalidReferences = [
    { offset: 0, size: 8 },
    { offset: 20, size: 0 },
    { offset: 63, size: 2 },
    { offset: 0xffffffff, size: 1 }
  ];
  for (const reference of invalidReferences) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcBtePapxReference(
      bytes,
      reference.offset,
      reference.size,
      0
    );

    assertPlcBtePapxReferenceCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word PlcBtePapx verifies FC and PnFkpPapx framing", () => {
  const plcBtePapxBytes = new Uint8Array(20);
  const view = new DataView(plcBtePapxBytes.buffer);
  [920, 950, 1000].forEach((fc, index) => {
    view.setUint32(index * 4, fc, true);
  });
  view.setUint32(12, 0xffc00002, true);
  view.setUint32(16, 0xabc00003, true);
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureRawPlcBtePapx(bytes, plcBtePapxBytes);

  const result = verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_SCHEMA_VERSION
  );
  assert.equal(result.nFib, 0x00c1);
  assert.equal(result.tableStreamName, "1Table");
  assert.equal(result.fcPlcfBtePapx, 20);
  assert.equal(result.lcbPlcfBtePapx, 20);
  assert.deepEqual(result.fileOffsets, [920, 950, 1000]);
  assert.deepEqual(result.entries, [
    { index: 0, fcStart: 920, fcEnd: 950, pn: 2, fkpByteOffset: 1024 },
    { index: 1, fcStart: 950, fcEnd: 1000, pn: 3, fkpByteOffset: 1536 }
  ]);
  assert.equal(result.plcBtePapxFramingVerified, true);
  assert.equal(result.pnFkpPapxDescriptorsVerified, true);
  assert.equal(result.fkpReferencesStatus, "not_verified");
  assert.equal(result.papxFkpStatus, "not_parsed");
  assert.equal(result.paragraphPropertiesStatus, "not_parsed");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.fileOffsets), true);
  assert.equal(Object.isFrozen(result.entries), true);
  assert.equal(Object.isFrozen(result.entries[0]), true);
});

test("official calendar KRX legacy Word PlcBtePapx accepts one FC without descriptors", () => {
  const plcBtePapxBytes = new Uint8Array(4);
  new DataView(plcBtePapxBytes.buffer).setUint32(0, 920, true);
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureRawPlcBtePapx(bytes, plcBtePapxBytes);

  const result = verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx(bytes);
  assert.deepEqual(result.fileOffsets, [920]);
  assert.deepEqual(result.entries, []);
});

test("official calendar KRX legacy Word PlcBtePapx rejects invalid framing", () => {
  const duplicateFc = new Uint8Array(12);
  new DataView(duplicateFc.buffer).setUint32(0, 920, true);
  new DataView(duplicateFc.buffer).setUint32(4, 920, true);
  const descendingFc = new Uint8Array(12);
  new DataView(descendingFc.buffer).setUint32(0, 950, true);
  new DataView(descendingFc.buffer).setUint32(4, 920, true);
  const invalidValues = [
    new Uint8Array(3),
    new Uint8Array(5),
    duplicateFc,
    descendingFc
  ];
  for (const plcBtePapxBytes of invalidValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configureRawPlcBtePapx(bytes, plcBtePapxBytes);

    assertPlcBtePapxCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_INVALID"
    );
  }
});

test("official calendar KRX legacy Word PapxFkp references project 512-byte pages", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([920, 950, 1000], [2, 3])
  );
  writeWordUint32(bytes, 64, 2048);
  fillWordRange(bytes, 1024, 512, 0x2a);
  fillWordRange(bytes, 1536, 512, 0x3b);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordPapxFkpReferences(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCES_SCHEMA_VERSION
  );
  assert.equal(result.cbMac, 2048);
  assert.deepEqual(
    result.references.map((reference) => ({
      index: reference.index,
      fcStart: reference.fcStart,
      fcEnd: reference.fcEnd,
      pn: reference.pn,
      fkpByteOffset: reference.fkpByteOffset,
      fkpByteLength: reference.fkpByteLength,
      firstByte: reference.fkpBytes[0],
      lastByte: reference.fkpBytes[511],
      bytesOwnership: reference.bytesOwnership
    })),
    [
      {
        index: 0,
        fcStart: 920,
        fcEnd: 950,
        pn: 2,
        fkpByteOffset: 1024,
        fkpByteLength: 512,
        firstByte: 0x2a,
        lastByte: 0x2a,
        bytesOwnership: "caller_owned_copy"
      },
      {
        index: 1,
        fcStart: 950,
        fcEnd: 1000,
        pn: 3,
        fkpByteOffset: 1536,
        fkpByteLength: 512,
        firstByte: 0x3b,
        lastByte: 0x3b,
        bytesOwnership: "caller_owned_copy"
      }
    ]
  );
  assert.equal(result.papxFkpReferencesVerified, true);
  assert.equal(result.papxFkpFramingStatus, "not_parsed");
  assert.equal(result.papxStatus, "not_parsed");
  assert.equal(result.paragraphPropertiesStatus, "not_parsed");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.references), true);
  assert.equal(Object.isFrozen(result.references[0]), true);

  fillWordRange(bytes, 1024, 512, 0x7c);
  assert.equal(result.references[0]!.fkpBytes[0], 0x2a);
});

test("official calendar KRX legacy Word PapxFkp references reject invalid pages and FCs", () => {
  const invalidValues = [
    { fileOffsets: [920], pns: [], cbMac: 2048 },
    { fileOffsets: [920, 950], pns: [1], cbMac: 2048 },
    { fileOffsets: [920, 950], pns: [3], cbMac: 2047 },
    { fileOffsets: [920, 2100], pns: [2], cbMac: 2048 },
    { fileOffsets: [920, 950], pns: [2], cbMac: 4097 }
  ];
  for (const value of invalidValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configureRawPlcBtePapx(
      bytes,
      createPlcBtePapxBytes(value.fileOffsets, value.pns)
    );
    writeWordUint32(bytes, 64, value.cbMac);

    assertPapxFkpReferencesCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word CLX verifies Prc and Pcdt framing", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureClxFraming(bytes, [0, 3], 16);

  const result = verifyOfficialMarketCalendarKrxLegacyWordClx(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_SCHEMA_VERSION
  );
  assert.equal(result.nFib, 0x00c1);
  assert.equal(result.tableStreamName, "1Table");
  assert.equal(result.fcClx, 4);
  assert.equal(result.lcbClx, 30);
  assert.equal(result.prcCount, 2);
  assert.equal(result.prcByteLength, 9);
  assert.equal(result.pcdtOffset, 9);
  assert.equal(result.plcPcdByteLength, 16);
  assert.equal(result.pieceDescriptorCount, 1);
  assert.deepEqual(result.plcPcdBytes, new Uint8Array(16).fill(0x55));
  assert.equal(result.clxFramingVerified, true);
  assert.equal(result.plcPcdStatus, "framing_only_entries_not_parsed");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);

  fillFileSectorRange(bytes, 3, 4 + 14, 16, 0x77);
  assert.deepEqual(result.plcPcdBytes, new Uint8Array(16).fill(0x55));
});

test("official calendar KRX legacy Word CLX accepts empty Prc and empty piece array framing", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureClxFraming(bytes, [], 4);

  const result = verifyOfficialMarketCalendarKrxLegacyWordClx(bytes);
  assert.equal(result.prcCount, 0);
  assert.equal(result.pcdtOffset, 0);
  assert.equal(result.pieceDescriptorCount, 0);
});

test("official calendar KRX legacy Word CLX rejects invalid framing", () => {
  const invalidClxValues = [
    Uint8Array.from([0]),
    Uint8Array.from([1]),
    Uint8Array.from([1, 0xff, 0xff]),
    Uint8Array.from([1, 0xa3, 0x3f]),
    Uint8Array.from([1, 2, 0, 0x11]),
    Uint8Array.from([2]),
    Uint8Array.from([2, 5, 0, 0, 0, 0, 0, 0, 0, 0]),
    Uint8Array.from([2, 4, 0, 0, 0, 0, 0, 0, 0, 0]),
    Uint8Array.from([2, 16, 0, 0, 0, ...new Uint8Array(15)])
  ];
  for (const clxBytes of invalidClxValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configureRawClx(bytes, clxBytes);

    assertClxCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_INVALID"
    );
  }
});

test("official calendar KRX legacy Word PlcPcd verifies CP and fixed Pcd fields", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 3, 7], [
    { flags: 0x0001, fcCompressed: 100 },
    { flags: 0xfffa, fcCompressed: 0x400000c8 }
  ]);

  const result = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_SCHEMA_VERSION
  );
  assert.deepEqual(result.characterPositions, [0, 3, 7]);
  assert.deepEqual(result.pieces, [
    {
      index: 0,
      cpStart: 0,
      cpEnd: 3,
      characterCount: 3,
      fNoParaLast: true,
      fc: 100,
      fCompressed: false
    },
    {
      index: 1,
      cpStart: 3,
      cpEnd: 7,
      characterCount: 4,
      fNoParaLast: false,
      fc: 200,
      fCompressed: true
    }
  ]);
  assert.equal(result.plcPcdVerified, true);
  assert.equal(result.documentTotalStatus, "not_verified_against_fib_rg_lw");
  assert.equal(result.textRangeStatus, "not_verified");
  assert.equal(result.prmStatus, "not_parsed");
  assert.equal(Object.isFrozen(result.characterPositions), true);
  assert.equal(Object.isFrozen(result.pieces), true);
  assert.equal(Object.isFrozen(result.pieces[0]), true);
});

test("official calendar KRX legacy Word PlcPcd accepts one nonnegative CP without pieces", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0], []);

  const result = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(bytes);
  assert.deepEqual(result.characterPositions, [0]);
  assert.deepEqual(result.pieces, []);
});

test("official calendar KRX legacy Word PlcPcd rejects invalid CPs and fixed bits", () => {
  const invalidValues = [
    { cps: [-1], pieces: [] },
    { cps: [1], pieces: [] },
    { cps: [0, 0], pieces: [{ flags: 0, fcCompressed: 0 }] },
    { cps: [1, 0], pieces: [{ flags: 0, fcCompressed: 0 }] },
    { cps: [0, 1], pieces: [{ flags: 0x0004, fcCompressed: 0 }] },
    { cps: [0, 1], pieces: [{ flags: 0, fcCompressed: 0x80000000 }] }
  ];
  for (const value of invalidValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcPcd(bytes, value.cps, value.pieces);

    assertPlcPcdCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_INVALID"
    );
  }
});

test("official calendar KRX legacy Word document counts verify final CP without subdocuments", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 7], [{ flags: 0, fcCompressed: 0 }]);
  configureDocumentCounts(bytes, [7, 0, 0, 0, 0, 0, 0]);

  const result = verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_SCHEMA_VERSION
  );
  assert.deepEqual(
    {
      ccpText: result.ccpText,
      ccpFtn: result.ccpFtn,
      ccpHdd: result.ccpHdd,
      ccpAtn: result.ccpAtn,
      ccpEdn: result.ccpEdn,
      ccpTxbx: result.ccpTxbx,
      ccpHdrTxbx: result.ccpHdrTxbx
    },
    {
      ccpText: 7,
      ccpFtn: 0,
      ccpHdd: 0,
      ccpAtn: 0,
      ccpEdn: 0,
      ccpTxbx: 0,
      ccpHdrTxbx: 0
    }
  );
  assert.equal(result.hasSubdocuments, false);
  assert.equal(result.finalCp, 7);
  assert.equal(result.documentCountsVerified, true);
  assert.equal(result.textRangeStatus, "not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
});

test("official calendar KRX legacy Word document counts add the subdocument guard CP", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 8], [{ flags: 0, fcCompressed: 0 }]);
  configureDocumentCounts(bytes, [1, 1, 1, 1, 1, 1, 1]);

  const result = verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(bytes);
  assert.equal(result.hasSubdocuments, true);
  assert.equal(result.finalCp, 8);
});

test("official calendar KRX legacy Word document counts reject invalid totals", () => {
  const invalidValues = [
    { counts: [-1, 0, 0, 0, 0, 0, 0], reserved3: 0, finalCp: 1 },
    { counts: [1, 0, 0, 0, 0, 0, 0], reserved3: 1, finalCp: 1 },
    { counts: [6, 0, 0, 0, 0, 0, 0], reserved3: 0, finalCp: 7 },
    {
      counts: [0x7ffffffe, 1, 0, 0, 0, 0, 0],
      reserved3: 0,
      finalCp: 1
    }
  ];
  for (const value of invalidValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcPcd(
      bytes,
      [0, value.finalCp],
      [{ flags: 0, fcCompressed: 0 }]
    );
    configureDocumentCounts(bytes, value.counts, value.reserved3);

    assertDocumentCountsCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_INVALID"
    );
  }
});

test("official calendar KRX legacy Word text ranges verify compressed and uncompressed pieces", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 3, 7], [
    { flags: 0, fcCompressed: 920 },
    { flags: 0, fcCompressed: 0x4000076c }
  ]);
  configureDocumentCounts(bytes, [7, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 954);

  const result = verifyOfficialMarketCalendarKrxLegacyWordTextRanges(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGES_SCHEMA_VERSION
  );
  assert.equal(result.cbMac, 954);
  assert.deepEqual(result.ranges, [
    {
      index: 0,
      cpStart: 0,
      cpEnd: 3,
      characterCount: 3,
      encoding: "unicode_16le",
      byteStart: 920,
      byteLength: 6,
      byteEnd: 926
    },
    {
      index: 1,
      cpStart: 3,
      cpEnd: 7,
      characterCount: 4,
      encoding: "compressed_8bit",
      byteStart: 950,
      byteLength: 4,
      byteEnd: 954
    }
  ]);
  assert.equal(result.textRangesVerified, true);
  assert.equal(result.textProjectionStatus, "not_projected");
  assert.equal(result.textDecodingStatus, "not_decoded");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.ranges), true);
  assert.equal(Object.isFrozen(result.ranges[0]), true);
});

test("official calendar KRX legacy Word text ranges reject invalid cbMac", () => {
  for (const cbMac of [899, 4097]) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcPcd(bytes, [0, 1], [{ flags: 0, fcCompressed: 920 }]);
    configureDocumentCounts(bytes, [1, 0, 0, 0, 0, 0, 0]);
    writeWordUint32(bytes, 64, cbMac);

    assertTextRangeCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word text ranges reject out-of-bound piece bytes", () => {
  const invalidValues = [
    { characterCount: 1, fcCompressed: 899, cbMac: 1000 },
    { characterCount: 2, fcCompressed: 920, cbMac: 923 },
    { characterCount: 1, fcCompressed: 0x4000076d, cbMac: 1000 },
    { characterCount: 2, fcCompressed: 0x4000076c, cbMac: 951 }
  ];
  for (const value of invalidValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcPcd(
      bytes,
      [0, value.characterCount],
      [{ flags: 0, fcCompressed: value.fcCompressed }]
    );
    configureDocumentCounts(
      bytes,
      [value.characterCount, 0, 0, 0, 0, 0, 0]
    );
    writeWordUint32(bytes, 64, value.cbMac);

    assertTextRangeCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word text bytes project caller-owned piece copies", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 3, 7], [
    { flags: 0, fcCompressed: 920 },
    { flags: 0, fcCompressed: 0x4000076c }
  ]);
  configureDocumentCounts(bytes, [7, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 954);
  [0x41, 0, 0x42, 0, 0x43, 0].forEach((value, index) => {
    writeWordByte(bytes, 920 + index, value);
  });
  [0x44, 0x45, 0x46, 0x47].forEach((value, index) => {
    writeWordByte(bytes, 950 + index, value);
  });

  const result = projectOfficialMarketCalendarKrxLegacyWordTextBytes(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_SCHEMA_VERSION
  );
  assert.equal(result.cbMac, 954);
  assert.deepEqual(
    result.pieces.map((piece) => ({
      index: piece.index,
      encoding: piece.encoding,
      bytes: [...piece.bytes],
      bytesOwnership: piece.bytesOwnership
    })),
    [
      {
        index: 0,
        encoding: "unicode_16le",
        bytes: [0x41, 0, 0x42, 0, 0x43, 0],
        bytesOwnership: "caller_owned_copy"
      },
      {
        index: 1,
        encoding: "compressed_8bit",
        bytes: [0x44, 0x45, 0x46, 0x47],
        bytesOwnership: "caller_owned_copy"
      }
    ]
  );
  assert.equal(result.textBytesProjected, true);
  assert.equal(result.textDecodingStatus, "not_decoded");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pieces), true);
  assert.equal(Object.isFrozen(result.pieces[0]), true);

  writeWordByte(bytes, 920, 0xff);
  assert.equal(result.pieces[0]!.bytes[0], 0x41);
  result.pieces[0]!.bytes[0] = 0xee;
  const repeated = projectOfficialMarketCalendarKrxLegacyWordTextBytes(bytes);
  assert.equal(repeated.pieces[0]!.bytes[0], 0xff);
});

test("official calendar KRX legacy Word text bytes project an empty piece array", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0], []);
  configureDocumentCounts(bytes, [0, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 900);

  const result = projectOfficialMarketCalendarKrxLegacyWordTextBytes(bytes);
  assert.deepEqual(result.pieces, []);
});

test("official calendar KRX legacy Word text decodes UTF-16LE and compressed pieces", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 2, 5], [
    { flags: 0, fcCompressed: 920 },
    { flags: 0, fcCompressed: 0x4000076c }
  ]);
  configureDocumentCounts(bytes, [5, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 953);
  [0x3d, 0xd8, 0x00, 0xde].forEach((value, index) => {
    writeWordByte(bytes, 920 + index, value);
  });
  [0x41, 0x82, 0x9f].forEach((value, index) => {
    writeWordByte(bytes, 950 + index, value);
  });

  const result = decodeOfficialMarketCalendarKrxLegacyWordText(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_SCHEMA_VERSION
  );
  assert.equal(result.finalCp, 5);
  assert.equal(result.text, "\ud83d\ude00A\u201a\u0178");
  assert.equal(result.decodedCodeUnitCount, 5);
  assert.deepEqual(
    result.pieces.map((piece) => ({
      index: piece.index,
      text: piece.text,
      decodedCodeUnitCount: piece.decodedCodeUnitCount
    })),
    [
      { index: 0, text: "\ud83d\ude00", decodedCodeUnitCount: 2 },
      { index: 1, text: "A\u201a\u0178", decodedCodeUnitCount: 3 }
    ]
  );
  assert.equal(result.textDecoded, true);
  assert.equal(result.tableSemanticsStatus, "not_parsed");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pieces), true);
  assert.equal(Object.isFrozen(result.pieces[0]), true);
});

test("official calendar KRX legacy Word text applies every compressed Unicode mapping", () => {
  const compressedBytes = [
    0x80,
    0x82,
    0x83,
    0x84,
    0x85,
    0x86,
    0x87,
    0x88,
    0x89,
    0x8a,
    0x8b,
    0x8c,
    0x91,
    0x92,
    0x93,
    0x94,
    0x95,
    0x96,
    0x97,
    0x98,
    0x99,
    0x9a,
    0x9b,
    0x9c,
    0x9f
  ];
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(
    bytes,
    [0, compressedBytes.length],
    [{ flags: 0, fcCompressed: 0x4000076c }]
  );
  configureDocumentCounts(
    bytes,
    [compressedBytes.length, 0, 0, 0, 0, 0, 0]
  );
  writeWordUint32(bytes, 64, 950 + compressedBytes.length);
  compressedBytes.forEach((value, index) => {
    writeWordByte(bytes, 950 + index, value);
  });

  const result = decodeOfficialMarketCalendarKrxLegacyWordText(bytes);
  assert.equal(
    result.text,
    "\u0080\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152" +
      "\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u0178"
  );
  assert.equal(result.decodedCodeUnitCount, compressedBytes.length);
});

test("official calendar KRX legacy Word text decodes an empty document", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0], []);
  configureDocumentCounts(bytes, [0, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 900);

  const result = decodeOfficialMarketCalendarKrxLegacyWordText(bytes);
  assert.equal(result.finalCp, 0);
  assert.equal(result.text, "");
  assert.equal(result.decodedCodeUnitCount, 0);
  assert.deepEqual(result.pieces, []);
});

test("official calendar KRX legacy Word main document verifies its paragraph mark", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 2], [{ flags: 0, fcCompressed: 920 }]);
  configureDocumentCounts(bytes, [2, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 924);
  writeWordUint16(bytes, 920, 0x0041);
  writeWordUint16(bytes, 922, 0x000d);

  const result = verifyOfficialMarketCalendarKrxLegacyWordMainDocument(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_SCHEMA_VERSION
  );
  assert.equal(result.mainDocumentCpStart, 0);
  assert.equal(result.mainDocumentCpEnd, 2);
  assert.equal(result.mainDocumentCharacterCount, 2);
  assert.equal(result.mainDocumentText, "A\r");
  assert.equal(result.mainDocumentParagraphMarkVerified, true);
  assert.equal(result.hasSubdocuments, false);
  assert.equal(result.finalCp, 2);
  assert.equal(result.terminalGuardCp, null);
  assert.equal(result.terminalGuardStatus, "not_applicable");
  assert.equal(result.mainDocumentVerified, true);
  assert.equal(result.subdocumentProjectionStatus, "not_projected");
  assert.equal(result.tableSemanticsStatus, "not_parsed");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
});

test("official calendar KRX legacy Word main document verifies a subdocument terminal guard", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 4], [{ flags: 0, fcCompressed: 920 }]);
  configureDocumentCounts(bytes, [2, 1, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 928);
  [0x0041, 0x000d, 0x0042, 0x000d].forEach((value, index) => {
    writeWordUint16(bytes, 920 + index * 2, value);
  });

  const result = verifyOfficialMarketCalendarKrxLegacyWordMainDocument(bytes);
  assert.equal(result.mainDocumentText, "A\r");
  assert.equal(result.hasSubdocuments, true);
  assert.equal(result.finalCp, 4);
  assert.equal(result.terminalGuardCp, 3);
  assert.equal(result.terminalGuardStatus, "verified_paragraph_mark");
});

test("official calendar KRX legacy Word main document rejects missing paragraph boundaries", () => {
  const invalidValues = [
    { counts: [0, 0, 0, 0, 0, 0, 0], codeUnits: [] },
    { counts: [2, 0, 0, 0, 0, 0, 0], codeUnits: [0x0041, 0x0042] },
    {
      counts: [2, 1, 0, 0, 0, 0, 0],
      codeUnits: [0x0041, 0x000d, 0x0042, 0x0043]
    }
  ];
  for (const value of invalidValues) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcPcd(
      bytes,
      value.codeUnits.length === 0 ? [0] : [0, value.codeUnits.length],
      value.codeUnits.length === 0 ? [] : [{ flags: 0, fcCompressed: 920 }]
    );
    configureDocumentCounts(bytes, value.counts);
    writeWordUint32(bytes, 64, 920 + value.codeUnits.length * 2);
    value.codeUnits.forEach((codeUnit, index) => {
      writeWordUint16(bytes, 920 + index * 2, codeUnit);
    });

    assertMainDocumentCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_INVALID"
    );
  }
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

function configureWordRootStreams(
  bytes: Uint8Array,
  tableStreamName: "0Table" | "1Table"
): void {
  writeEntryName(bytes, 1, "WordDocument");
  writeEntryName(bytes, 2, tableStreamName);
  setStreamUint32(bytes, 1, 68, 2);
  setStreamUint32(bytes, 1, 72, NOSTREAM);
  writeWordUint16(bytes, 0, 0xa5ec);
  writeWordUint16(bytes, 2, 0x00c1);
  writeWordUint16(bytes, 8, 0);
  writeWordUint16(
    bytes,
    10,
    0x1000 | (tableStreamName === "1Table" ? 0x0200 : 0)
  );
  writeWordUint16(bytes, 12, 0x00bf);
  writeWordUint32(bytes, 14, 0);
  writeWordByte(bytes, 18, 0);
  writeWordByte(bytes, 19, 0);
  writeWordUint16(bytes, 20, 0);
  writeWordUint16(bytes, 22, 0);
}

function configureVariableFib(
  bytes: Uint8Array,
  definition: {
    nFib: number;
    version: string;
    cbRgFcLcb: number;
    cswNew: number;
  }
): void {
  writeWordUint16(bytes, 32, 0x000e);
  writeWordUint16(bytes, 62, 0x0016);
  writeWordUint16(bytes, 152, definition.cbRgFcLcb);
  const cswNewOffset = 154 + definition.cbRgFcLcb * 8;
  writeWordUint16(bytes, cswNewOffset, definition.cswNew);
  if (definition.cswNew !== 0) {
    writeWordUint16(bytes, cswNewOffset + 2, definition.nFib);
    writeWordUint16(bytes, 10, 0x12f0);
  }
}

function configureClxReference(
  bytes: Uint8Array,
  offset: number,
  size: number,
  value: number
): void {
  writeWordUint32(bytes, 154 + 33 * 8, offset);
  writeWordUint32(bytes, 154 + 33 * 8 + 4, size);
  if (offset + size <= 64) {
    fillFileSectorRange(bytes, 3, offset, size, value);
  }
}

function configurePlcBtePapxReference(
  bytes: Uint8Array,
  offset: number,
  size: number,
  value: number
): void {
  writeWordUint32(bytes, 154 + 13 * 8, offset);
  writeWordUint32(bytes, 154 + 13 * 8 + 4, size);
  if (offset + size <= 64) {
    fillFileSectorRange(bytes, 3, offset, size, value);
  }
}

function configureRawPlcBtePapx(
  bytes: Uint8Array,
  plcBtePapxBytes: Uint8Array
): void {
  configurePlcBtePapxReference(bytes, 20, plcBtePapxBytes.length, 0);
  bytes.set(plcBtePapxBytes, (3 + 1) * readSectorSize(bytes) + 20);
}

function createPlcBtePapxBytes(
  fileOffsets: readonly number[],
  pns: readonly number[]
): Uint8Array {
  assert.equal(fileOffsets.length, pns.length + 1);
  const bytes = new Uint8Array(fileOffsets.length * 4 + pns.length * 4);
  const view = new DataView(bytes.buffer);
  fileOffsets.forEach((fileOffset, index) => {
    view.setUint32(index * 4, fileOffset, true);
  });
  const pnOffset = fileOffsets.length * 4;
  pns.forEach((pn, index) => {
    view.setUint32(pnOffset + index * 4, pn, true);
  });
  return bytes;
}

function configureClxFraming(
  bytes: Uint8Array,
  prcSizes: readonly number[],
  plcPcdByteLength: number
): void {
  const values: number[] = [];
  for (const prcSize of prcSizes) {
    values.push(1, prcSize & 0xff, (prcSize >>> 8) & 0xff);
    values.push(...new Uint8Array(prcSize).fill(0x33));
  }
  values.push(
    2,
    plcPcdByteLength & 0xff,
    (plcPcdByteLength >>> 8) & 0xff,
    (plcPcdByteLength >>> 16) & 0xff,
    (plcPcdByteLength >>> 24) & 0xff
  );
  values.push(...new Uint8Array(plcPcdByteLength).fill(0x55));
  configureRawClx(bytes, Uint8Array.from(values));
}

function configureRawClx(bytes: Uint8Array, clxBytes: Uint8Array): void {
  const tableOffset = 4;
  configureClxReference(bytes, tableOffset, clxBytes.length, 0);
  bytes.set(
    clxBytes,
    (3 + 1) * readSectorSize(bytes) + tableOffset
  );
}

function configurePlcPcd(
  bytes: Uint8Array,
  characterPositions: readonly number[],
  pieces: readonly { flags: number; fcCompressed: number }[]
): void {
  assert.equal(characterPositions.length, pieces.length + 1);
  const plcPcdBytes = new Uint8Array(
    characterPositions.length * 4 + pieces.length * 8
  );
  const view = new DataView(plcPcdBytes.buffer);
  characterPositions.forEach((cp, index) => {
    view.setInt32(index * 4, cp, true);
  });
  const pcdOffset = characterPositions.length * 4;
  pieces.forEach((piece, index) => {
    const offset = pcdOffset + index * 8;
    view.setUint16(offset, piece.flags, true);
    view.setUint32(offset + 2, piece.fcCompressed, true);
    view.setUint16(offset + 6, 0x1234, true);
  });
  const clxBytes = new Uint8Array(5 + plcPcdBytes.length);
  const clxView = new DataView(clxBytes.buffer);
  clxView.setUint8(0, 2);
  clxView.setUint32(1, plcPcdBytes.length, true);
  clxBytes.set(plcPcdBytes, 5);
  configureRawClx(bytes, clxBytes);
}

function configureDocumentCounts(
  bytes: Uint8Array,
  counts: readonly number[],
  reserved3 = 0
): void {
  assert.equal(counts.length, 7);
  const offsets = [76, 80, 84, 92, 96, 100, 104];
  counts.forEach((count, index) => {
    writeWordUint32(bytes, offsets[index]!, count);
  });
  writeWordUint32(bytes, 88, reserved3);
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

function fillWordRange(
  bytes: Uint8Array,
  offset: number,
  byteLength: number,
  value: number
): void {
  const start = (4 + 1) * readSectorSize(bytes) + offset;
  bytes.fill(value, start, start + byteLength);
}

function writeWordByte(bytes: Uint8Array, offset: number, value: number): void {
  bytes[(4 + 1) * readSectorSize(bytes) + offset] = value;
}

function writeWordUint16(
  bytes: Uint8Array,
  offset: number,
  value: number
): void {
  new DataView(bytes.buffer).setUint16(
    (4 + 1) * readSectorSize(bytes) + offset,
    value,
    true
  );
}

function writeWordUint32(
  bytes: Uint8Array,
  offset: number,
  value: number
): void {
  new DataView(bytes.buffer).setUint32(
    (4 + 1) * readSectorSize(bytes) + offset,
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
  code: OfficialMarketCalendarOleCompoundFileUserStreamAllocationError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarOleCompoundFileUserStreamAllocationError &&
      error.code === code
  );
}

function assertWordCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError &&
      error.code === code
  );
}

function assertFibCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordFibError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordFib(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordFibError &&
      error.code === code
  );
}

function assertClxReferenceCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordClxReferenceError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordClxReference(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordClxReferenceError &&
      error.code === code
  );
}

function assertPlcBtePapxReferenceCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference(bytes),
    (error: unknown) =>
      error instanceof
        OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError &&
      error.code === code
  );
}

function assertPlcBtePapxCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordPlcBtePapxError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordPlcBtePapxError &&
      error.code === code
  );
}

function assertPapxFkpReferencesCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPapxFkpReferences(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError &&
      error.code === code
  );
}

function assertClxCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordClxError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordClx(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordClxError &&
      error.code === code
  );
}

function assertPlcPcdCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordPlcPcdError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordPlcPcdError &&
      error.code === code
  );
}

function assertDocumentCountsCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordDocumentCountsError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordDocumentCountsError &&
      error.code === code
  );
}

function assertTextRangeCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordTextRangesError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordTextRanges(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordTextRangesError &&
      error.code === code
  );
}

function assertMainDocumentCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordMainDocumentError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordMainDocument(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordMainDocumentError &&
      error.code === code
  );
}
