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
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordStshfReferenceError,
  verifyOfficialMarketCalendarKrxLegacyWordStshfReference
} from "./officialMarketCalendarKrxLegacyWordStshfReference.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSH_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordStshError,
  verifyOfficialMarketCalendarKrxLegacyWordStsh
} from "./officialMarketCalendarKrxLegacyWordStsh.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordStdfBaseError,
  verifyOfficialMarketCalendarKrxLegacyWordStdfBases
} from "./officialMarketCalendarKrxLegacyWordStdfBase.js";
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
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPapxFkpError,
  verifyOfficialMarketCalendarKrxLegacyWordPapxFkp
} from "./officialMarketCalendarKrxLegacyWordPapxFkp.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordGrpPrlError,
  verifyOfficialMarketCalendarKrxLegacyWordGrpPrls
} from "./officialMarketCalendarKrxLegacyWordGrpPrl.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError,
  verifyOfficialMarketCalendarKrxLegacyWordTableParagraphProperties
} from "./officialMarketCalendarKrxLegacyWordTableParagraphProperties.js";
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
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPcdPrmError,
  verifyOfficialMarketCalendarKrxLegacyWordPcdPrms
} from "./officialMarketCalendarKrxLegacyWordPcdPrm.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError,
  verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
} from "./officialMarketCalendarKrxLegacyWordPrcGrpPrl.js";
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
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARIES_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError,
  verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries
} from "./officialMarketCalendarKrxLegacyWordParagraphBoundaries.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError,
  verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties
} from "./officialMarketCalendarKrxLegacyWordDirectParagraphProperties.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARKS_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordTableTextMarksError,
  verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks
} from "./officialMarketCalendarKrxLegacyWordTableTextMarks.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordTableRowGroupingError,
  verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping
} from "./officialMarketCalendarKrxLegacyWordTableRowGrouping.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_SCHEMA_VERSION,
  verifyOfficialMarketCalendarKrxLegacyWordSourceRows
} from "./officialMarketCalendarKrxLegacyWordSourceRows.js";
import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_SCHEMA_VERSION,
  OfficialMarketCalendarKrxLegacyWordDocumentTitleError,
  verifyOfficialMarketCalendarKrxLegacyWordDocumentTitle
} from "./officialMarketCalendarKrxLegacyWordDocumentTitle.js";
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

test("official calendar KRX legacy Word Stshf reference projects every supported version", () => {
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
    configureStshfReference(bytes, 8, 12, 0x6a);

    const result =
      verifyOfficialMarketCalendarKrxLegacyWordStshfReference(bytes);
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_SCHEMA_VERSION
    );
    assert.equal(result.nFib, definition.nFib);
    assert.equal(result.version, definition.version);
    assert.equal(result.tableStreamName, "1Table");
    assert.equal(result.fcStshf, 8);
    assert.equal(result.lcbStshf, 12);
    assert.deepEqual(result.stshfBytes, new Uint8Array(12).fill(0x6a));
    assert.equal(result.stshfReferenceVerified, true);
    assert.equal(result.stshfParserStatus, "reference_only_not_parsed");
    assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
    assert.equal(Object.isFrozen(result), true);

    fillFileSectorRange(bytes, 3, 8, 12, 0x7b);
    assert.deepEqual(result.stshfBytes, new Uint8Array(12).fill(0x6a));
    result.stshfBytes.fill(0x4c);
    assert.deepEqual(
      bytes.slice(
        (3 + 1) * readSectorSize(bytes) + 8,
        (3 + 1) * readSectorSize(bytes) + 20
      ),
      new Uint8Array(12).fill(0x7b)
    );
  }
});

test("official calendar KRX legacy Word Stshf reference rejects empty or out-of-bounds ranges", () => {
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
    configureStshfReference(bytes, reference.offset, reference.size, 0);

    assertStshfReferenceCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_INVALID"
    );
  }
});

test("official calendar KRX legacy Word STSH frames every supported version", () => {
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
    const cbSTDBaseInFile =
      definition.nFib === 0x00c1 ? 0x000a : 0x0012;
    const stshBytes = buildStshBytes({
      cbSTDBaseInFile,
      records: new Map([[0, new Uint8Array([0x31, 0x32, 0x33])]])
    });
    configureRawStsh(bytes, stshBytes, 4);

    const result = verifyOfficialMarketCalendarKrxLegacyWordStsh(bytes);
    assert.equal(
      result.schemaVersion,
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSH_SCHEMA_VERSION
    );
    assert.equal(result.nFib, definition.nFib);
    assert.equal(result.tableStreamName, "1Table");
    assert.equal(result.fcStshf, 4);
    assert.equal(result.lcbStshf, stshBytes.length);
    assert.equal(result.cbStshi, 18);
    assert.equal(result.cstd, 15);
    assert.equal(result.cbSTDBaseInFile, cbSTDBaseInFile);
    assert.equal(result.styleDefinitions.length, 15);
    assert.deepEqual(
      result.styleDefinitions[0],
      {
        istd: 0,
        cbStd: 3,
        stdOffset: 22,
        stdBytes: new Uint8Array([0x31, 0x32, 0x33]),
        styleDefinitionStatus: "framing_only_not_parsed"
      }
    );
    assert.equal(result.styleDefinitions[1]!.styleDefinitionStatus, "empty");
    assert.equal(result.styleDefinitions[13]!.cbStd, 0);
    assert.equal(result.styleDefinitions[14]!.cbStd, 0);
    assert.equal(result.stshFramingVerified, true);
    assert.equal(
      result.stshiStatus,
      "fixed_header_verified_optional_fields_not_parsed"
    );
    assert.equal(
      result.styleDefinitionsStatus,
      "length_framed_std_not_parsed"
    );
    assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.styleDefinitions), true);
    assert.equal(Object.isFrozen(result.styleDefinitions[0]), true);

    const tableStart = (3 + 1) * readSectorSize(bytes) + 4;
    bytes[tableStart + 22] = 0x7b;
    assert.deepEqual(
      result.styleDefinitions[0]!.stdBytes,
      new Uint8Array([0x31, 0x32, 0x33])
    );
    result.styleDefinitions[0]!.stdBytes[1] = 0x4c;
    assert.equal(bytes[tableStart + 23], 0x32);
  }
});

test("official calendar KRX legacy Word STSH rejects invalid headers and LPStd framing", () => {
  const mutations: Array<(bytes: Uint8Array) => Uint8Array> = [
    (bytes) => bytes.subarray(0, 19),
    (bytes) => setStshUint16(bytes, 0, 17),
    (bytes) => setStshUint16(bytes, 0, 19),
    (bytes) => setStshUint16(bytes, 2, 14),
    (bytes) => setStshUint16(bytes, 2, 0x0ffe),
    (bytes) => setStshUint16(bytes, 4, 9),
    (bytes) => setStshUint16(bytes, 6, 0),
    (bytes) => setStshUint16(bytes, 10, 14),
    (bytes) => setStshInt16(bytes, 20, -1),
    (bytes) => setStshUint16(bytes, 20, 100),
    (bytes) => {
      const withFixedStyle = buildStshBytes({
        records: new Map([[13, new Uint8Array([0x41, 0x42])]])
      });
      return withFixedStyle;
    },
    (bytes) => {
      const withTrailingByte = new Uint8Array(bytes.length + 1);
      withTrailingByte.set(bytes);
      return withTrailingByte;
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
    const stshBytes = mutate(buildStshBytes());
    configureRawStsh(bytes, stshBytes, 4);

    assertStshCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSH_INVALID"
    );
  }

  const oddTableOffset = compoundFileWithUserStreams(3);
  configureWordRootStreams(oddTableOffset, "1Table");
  configureVariableFib(oddTableOffset, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureRawStsh(oddTableOffset, buildStshBytes(), 3);
  assertStshCode(
    oddTableOffset,
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSH_INVALID"
  );
});

test("official calendar KRX legacy Word StdfBase verifies metadata and inheritance", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, { nFib: 0x00c1, version: "Word97", cbRgFcLcb: 0x005d, cswNew: 0 });
  const records = new Map<number, Uint8Array>([
    [0, buildStdfBaseRecord({ sti: 0, istdBase: 0x0fff, istdNext: 0, body: new Uint8Array([0x31, 0x32]) })]
  ]);
  configureRawStsh(bytes, buildStshBytes({ records }), 2);

  const result = verifyOfficialMarketCalendarKrxLegacyWordStdfBases(bytes);
  assert.equal(result.schemaVersion, OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_SCHEMA_VERSION);
  assert.equal(result.cbSTDBaseInFile, 10);
  assert.deepEqual(result.styles[0], {
    istd: 0, status: "base_verified_body_not_parsed", sti: 0, stk: 1,
    istdBase: null, cupx: 2, istdNext: 0, bchUpe: 12,
    styleBodyBytes: new Uint8Array([0x31, 0x32])
  });
  assert.equal(result.styles[1]!.status, "empty");
  assert.equal(result.stdfBaseVerified, true);
  assert.equal(result.inheritanceReferencesVerified, true);
  assert.equal(result.cupxStatus, "projected_semantics_not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result.styles), true);
});

test("official calendar KRX legacy Word StdfBase rejects invalid metadata and references", () => {
  const invalidRecords: readonly ReadonlyMap<number, Uint8Array>[] = [
    new Map([[0, new Uint8Array(9)]]),
    new Map([[0, buildStdfBaseRecord({ sti: 0x0fff })]]),
    new Map([[0, buildStdfBaseRecord({ stk: 0 })]]),
    new Map([[0, buildStdfBaseRecord({ bchUpe: 11 })]]),
    new Map([[0, buildStdfBaseRecord({ sti: 1 })]]),
    new Map([[0, buildStdfBaseRecord({ istdNext: 1 })]]),
    new Map([[0, buildStdfBaseRecord({ istdBase: 0 })]]),
    new Map([[0, buildStdfBaseRecord({ istdBase: 1 })]])
  ];
  for (const records of invalidRecords) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, { nFib: 0x00c1, version: "Word97", cbRgFcLcb: 0x005d, cswNew: 0 });
    configureRawStsh(bytes, buildStshBytes({ records }), 2);
    assertStdfBaseCode(bytes, "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STDF_BASE_INVALID");
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

test("official calendar KRX legacy Word PapxFkp verifies rgfc, BxPap, and PapxInFkp framing", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidPapxFkpFixture(bytes);

  const result = verifyOfficialMarketCalendarKrxLegacyWordPapxFkp(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_SCHEMA_VERSION
  );
  assert.equal(result.pages.length, 2);
  assert.deepEqual(
    result.pages.map((page) => ({
      index: page.index,
      pn: page.pn,
      fkpByteOffset: page.fkpByteOffset,
      cpara: page.cpara,
      rgfc: page.rgfc,
      bxPapByteOffset: page.bxPapByteOffset,
      bxPapByteLength: page.bxPapByteLength,
      paragraphs: page.paragraphs.map((paragraph) => ({
        paragraphIndex: paragraph.paragraphIndex,
        fcStart: paragraph.fcStart,
        fcEnd: paragraph.fcEnd,
        bOffset: paragraph.bOffset,
        papxByteOffset: paragraph.papxByteOffset,
        cb: paragraph.cb,
        cbPrime: paragraph.cbPrime,
        grpprlAndIstdByteOffset: paragraph.grpprlAndIstdByteOffset,
        grpprlAndIstdByteLength: paragraph.grpprlAndIstdByteLength,
        grpprlAndIstdBytes: [...paragraph.grpprlAndIstdBytes],
        propertiesStatus: paragraph.propertiesStatus,
        reservedBytesStatus: paragraph.reservedBytesStatus,
        bytesOwnership: paragraph.bytesOwnership
      }))
    })),
    [
      {
        index: 0,
        pn: 2,
        fkpByteOffset: 1024,
        cpara: 2,
        rgfc: [920, 950, 1000],
        bxPapByteOffset: 12,
        bxPapByteLength: 26,
        paragraphs: [
          {
            paragraphIndex: 0,
            fcStart: 920,
            fcEnd: 950,
            bOffset: 20,
            papxByteOffset: 40,
            cb: 3,
            cbPrime: null,
            grpprlAndIstdByteOffset: 41,
            grpprlAndIstdByteLength: 5,
            grpprlAndIstdBytes: [0x34, 0x12, 0x16, 0x24, 0x01],
            propertiesStatus: "framing_verified",
            reservedBytesStatus: "ignored",
            bytesOwnership: "caller_owned_copy"
          },
          {
            paragraphIndex: 1,
            fcStart: 950,
            fcEnd: 1000,
            bOffset: 0,
            papxByteOffset: null,
            cb: null,
            cbPrime: null,
            grpprlAndIstdByteOffset: null,
            grpprlAndIstdByteLength: 0,
            grpprlAndIstdBytes: [],
            propertiesStatus: "default",
            reservedBytesStatus: "ignored",
            bytesOwnership: "caller_owned_copy"
          }
        ]
      },
      {
        index: 1,
        pn: 3,
        fkpByteOffset: 1536,
        cpara: 1,
        rgfc: [1000, 1100],
        bxPapByteOffset: 8,
        bxPapByteLength: 13,
        paragraphs: [
          {
            paragraphIndex: 0,
            fcStart: 1000,
            fcEnd: 1100,
            bOffset: 20,
            papxByteOffset: 40,
            cb: 0,
            cbPrime: 1,
            grpprlAndIstdByteOffset: 42,
            grpprlAndIstdByteLength: 2,
            grpprlAndIstdBytes: [0x78, 0x56],
            propertiesStatus: "framing_verified",
            reservedBytesStatus: "ignored",
            bytesOwnership: "caller_owned_copy"
          }
        ]
      }
    ]
  );
  assert.equal(result.papxFkpFramingVerified, true);
  assert.equal(result.papxInFkpFramingVerified, true);
  assert.equal(result.grpprlAndIstdStatus, "not_parsed");
  assert.equal(result.paragraphPropertiesStatus, "not_parsed");
  assert.equal(result.tableSemanticsStatus, "not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pages), true);
  assert.equal(Object.isFrozen(result.pages[0]), true);
  assert.equal(Object.isFrozen(result.pages[0]!.paragraphs), true);
  assert.equal(Object.isFrozen(result.pages[0]!.paragraphs[0]), true);

  writeWordByte(bytes, 1024 + 41, 0xff);
  assert.equal(result.pages[0]!.paragraphs[0]!.grpprlAndIstdBytes[0], 0x34);
});

test("official calendar KRX legacy Word PapxFkp rejects invalid internal framing", () => {
  const invalidMutations: Array<(bytes: Uint8Array) => void> = [
    (bytes) => writeWordByte(bytes, 1024 + 511, 0),
    (bytes) => writeWordByte(bytes, 1024 + 511, 0x1e),
    (bytes) => writeWordUint32(bytes, 1024 + 4, 920),
    (bytes) => writeWordUint32(bytes, 1024 + 8, 2049),
    (bytes) => writeWordUint32(bytes, 1024, 919),
    (bytes) => writeWordUint32(bytes, 1024 + 8, 999),
    (bytes) => writeWordByte(bytes, 1024 + 12, 10),
    (bytes) => writeWordByte(bytes, 1024 + 12, 0xff),
    (bytes) => writeWordByte(bytes, 1024 + 40, 1),
    (bytes) => {
      writeWordByte(bytes, 1024 + 12, 250);
      writeWordByte(bytes, 1024 + 500, 6);
    },
    (bytes) => {
      writeWordByte(bytes, 1024 + 40, 0);
      writeWordByte(bytes, 1024 + 41, 0);
    },
    (bytes) => {
      writeWordByte(bytes, 1024 + 40, 0);
      writeWordByte(bytes, 1024 + 41, 0xec);
    }
  ];
  for (const mutate of invalidMutations) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidPapxFkpFixture(bytes);
    mutate(bytes);
    assertPapxFkpCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_INVALID"
    );
  }
});

test("official calendar KRX legacy Word GrpPrl verifies istd and Sprm operand framing", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidGrpPrlFixture(bytes);

  const result = verifyOfficialMarketCalendarKrxLegacyWordGrpPrls(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION
  );
  assert.equal(result.groups.length, 3);
  assert.deepEqual(
    result.groups.map((group) => ({
      pageIndex: group.pageIndex,
      paragraphIndex: group.paragraphIndex,
      istd: group.istd,
      propertiesStatus: group.propertiesStatus,
      prls: group.prls.map((prl) => ({
        sprm: prl.sprm,
        ispmd: prl.ispmd,
        fSpec: prl.fSpec,
        sgc: prl.sgc,
        spra: prl.spra,
        operandByteLength: prl.operandByteLength,
        operandBytes: [...prl.operandBytes],
        operandLengthKind: prl.operandLengthKind,
        bytesOwnership: prl.bytesOwnership
      }))
    })),
    [
      {
        pageIndex: 0,
        paragraphIndex: 0,
        istd: 0x1234,
        propertiesStatus: "framing_verified",
        prls: [
          prlSummary(0x0401, 0, 1, [0x10], "fixed"),
          prlSummary(0x2402, 1, 1, [0x11], "fixed"),
          prlSummary(0x4403, 2, 1, [0x12, 0x13], "fixed"),
          prlSummary(0x6404, 3, 1, [0x14, 0x15, 0x16, 0x17], "fixed"),
          prlSummary(0x8405, 4, 1, [0x18, 0x19], "fixed"),
          prlSummary(0xa406, 5, 1, [0x1a, 0x1b], "fixed"),
          prlSummary(0xe407, 7, 1, [0x1c, 0x1d, 0x1e], "fixed"),
          prlSummary(0xc408, 6, 1, [2, 0x20, 0x21], "one_byte_prefix"),
          prlSummary(
            0xd608,
            6,
            5,
            [2, 0, 0],
            "t_def_table_two_byte_prefix"
          ),
          prlSummary(0xc615, 6, 1, [2, 0, 0], "one_byte_prefix")
        ]
      },
      {
        pageIndex: 0,
        paragraphIndex: 1,
        istd: null,
        propertiesStatus: "default",
        prls: []
      },
      {
        pageIndex: 1,
        paragraphIndex: 0,
        istd: 0x5678,
        propertiesStatus: "framing_verified",
        prls: []
      }
    ]
  );
  assert.equal(result.grpprlAndIstdFramingVerified, true);
  assert.equal(result.sprmFramingVerified, true);
  assert.equal(result.tDefTableLengthStatus, "supported");
  assert.equal(result.pChgTabs255Status, "rejected_unsupported");
  assert.equal(result.sprmSemanticsStatus, "not_verified");
  assert.equal(result.tableSemanticsStatus, "not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.groups), true);
  assert.equal(Object.isFrozen(result.groups[0]!.prls), true);
  assert.equal(Object.isFrozen(result.groups[0]!.prls[0]), true);

  writeWordByte(bytes, 1024 + 46, 0xff);
  assert.equal(result.groups[0]!.prls[0]!.operandBytes[0], 0x10);
});

test("official calendar KRX legacy Word GrpPrl rejects incomplete Sprm framing", () => {
  const invalidGroups = [
    [0x34, 0x12, 0x01],
    [0x34, 0x12, 0x01, 0x20, 0x10],
    [0x34, 0x12, 0x04, 0x64, 0x10],
    [0x34, 0x12, 0x08, 0xc4, 5],
    [0x34, 0x12, 0x08, 0xd6, 1, 0, 0],
    [0x34, 0x12, 0x08, 0xd6, 10, 0, 0],
    [0x34, 0x12, 0x15, 0xc6, 1, 0],
    [0x34, 0x12, 0x15, 0xc6, 0xff, 0]
  ];
  for (const groupBytes of invalidGroups) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidPapxFkpFixture(bytes);
    setPapxGrpPrl(bytes, 1024 + 40, groupBytes);
    assertGrpPrlCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_GRPPRL_INVALID"
    );
  }
});

test("official calendar KRX legacy Word table paragraph properties verify membership and marks", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidTableParagraphPropertiesFixture(bytes);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordTableParagraphProperties(bytes);
  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_SCHEMA_VERSION
  );
  assert.deepEqual(result.supportedSprms, [
    0x2416, 0x2417, 0x6649, 0x664a, 0x244b, 0x244c
  ]);
  assert.deepEqual(
    result.paragraphs.map((paragraph) => ({
      pageIndex: paragraph.pageIndex,
      paragraphIndex: paragraph.paragraphIndex,
      istd: paragraph.istd,
      inTable: paragraph.inTable,
      tableDepth: paragraph.tableDepth,
      isTtp: paragraph.isTtp,
      isInnerTableCell: paragraph.isInnerTableCell,
      isInnerTtp: paragraph.isInnerTtp,
      tableRole: paragraph.tableRole,
      interpretedPrlCount: paragraph.interpretedPrlCount,
      uninterpretedPrlCount: paragraph.uninterpretedPrlCount,
      propertiesStatus: paragraph.propertiesStatus,
      textMarkValidationStatus: paragraph.textMarkValidationStatus
    })),
    [
      {
        pageIndex: 0,
        paragraphIndex: 0,
        istd: 0,
        inTable: true,
        tableDepth: 2,
        isTtp: false,
        isInnerTableCell: true,
        isInnerTtp: false,
        tableRole: "nested_cell_mark_candidate",
        interpretedPrlCount: 5,
        uninterpretedPrlCount: 1,
        propertiesStatus: "supported_table_properties_verified",
        textMarkValidationStatus: "pending_text_binding"
      },
      {
        pageIndex: 0,
        paragraphIndex: 1,
        istd: null,
        inTable: false,
        tableDepth: 0,
        isTtp: false,
        isInnerTableCell: false,
        isInnerTtp: false,
        tableRole: "not_in_table",
        interpretedPrlCount: 0,
        uninterpretedPrlCount: 0,
        propertiesStatus: "default",
        textMarkValidationStatus: "not_applicable"
      },
      {
        pageIndex: 1,
        paragraphIndex: 0,
        istd: 0,
        inTable: true,
        tableDepth: 1,
        isTtp: true,
        isInnerTableCell: false,
        isInnerTtp: false,
        tableRole: "depth_1_ttp_candidate",
        interpretedPrlCount: 3,
        uninterpretedPrlCount: 0,
        propertiesStatus: "supported_table_properties_verified",
        textMarkValidationStatus: "pending_text_binding"
      }
    ]
  );
  assert.equal(result.paragraphStyleBindingStatus, "default_style_only");
  assert.equal(result.supportedTablePropertySemanticsStatus, "verified");
  assert.equal(result.tableTextMarkSemanticsStatus, "not_verified");
  assert.equal(result.tableRowCellBoundaryStatus, "not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.paragraphs), true);
  assert.equal(Object.isFrozen(result.paragraphs[0]), true);
  assert.equal(Object.isFrozen(result.supportedSprms), true);
});

test("official calendar KRX legacy Word table paragraph properties infer Word97 depth one", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidPapxFkpFixture(bytes);
  configureDefaultStyleSecondPapxGroup(bytes);
  setPapxGrpPrl(
    bytes,
    1024 + 40,
    tablePropertyGroup([[0x2416, [1]]])
  );

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordTableParagraphProperties(bytes);
  assert.deepEqual(
    {
      nFib: result.nFib,
      inTable: result.paragraphs[0]!.inTable,
      tableDepth: result.paragraphs[0]!.tableDepth,
      tableRole: result.paragraphs[0]!.tableRole,
      interpretedPrlCount: result.paragraphs[0]!.interpretedPrlCount
    },
    {
      nFib: 0x00c1,
      inTable: true,
      tableDepth: 1,
      tableRole: "table_paragraph",
      interpretedPrlCount: 1
    }
  );
});

test("official calendar KRX legacy Word table paragraph properties reject unsupported Word97 depth Sprms", () => {
  const unsupportedPrls = [
    [0x6649, int32Bytes(1)],
    [0x664a, int32Bytes(1)],
    [0x244b, [1]],
    [0x244c, [1]]
  ] as const;
  for (const unsupportedPrl of unsupportedPrls) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidPapxFkpFixture(bytes);
    configureDefaultStyleSecondPapxGroup(bytes);
    setPapxGrpPrl(
      bytes,
      1024 + 40,
      tablePropertyGroup([
        [0x2416, [1]],
        unsupportedPrl
      ])
    );
    assertTableParagraphPropertiesCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_INVALID"
    );
  }
});

test("official calendar KRX legacy Word table paragraph properties reject invalid semantics", () => {
  const invalidGroups = [
    tablePropertyGroup([[0x2416, [2]]]),
    tablePropertyGroup([[0x6649, int32Bytes(1)]]),
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(-1)]
    ]),
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(0)],
      [0x664a, int32Bytes(-1)]
    ]),
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(2)],
      [0x2417, [1]]
    ]),
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(1)],
      [0x244b, [1]]
    ]),
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(2)],
      [0x244b, [1]],
      [0x244c, [1]]
    ])
  ];
  for (const groupBytes of invalidGroups) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidPapxFkpFixture(bytes);
    configureWord2000Fib(bytes);
    configureDefaultStyleSecondPapxGroup(bytes);
    setPapxGrpPrl(bytes, 1024 + 40, groupBytes);
    assertTableParagraphPropertiesCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_INVALID"
    );
  }
});

test("official calendar KRX legacy Word table paragraph properties reject unresolved style state", () => {
  const invalidGroups = [
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(1)]
      ],
      1
    ),
    tablePropertyGroup([
      [0x2416, [1]],
      [0x664a, int32Bytes(1)]
    ])
  ];
  for (const groupBytes of invalidGroups) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidPapxFkpFixture(bytes);
    configureWord2000Fib(bytes);
    configureDefaultStyleSecondPapxGroup(bytes);
    setPapxGrpPrl(bytes, 1024 + 40, groupBytes);
    assertTableParagraphPropertiesCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_INVALID"
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

test("official calendar KRX legacy Word Pcd Prm verifies no-op and simple modifiers", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 1, 2, 3], [
    { flags: 1, fcCompressed: 920, prm: 0 },
    { flags: 1, fcCompressed: 922, prm: 0x0130 },
    { flags: 0, fcCompressed: 924, prm: 0x0032 }
  ]);

  const result = verifyOfficialMarketCalendarKrxLegacyWordPcdPrms(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_SCHEMA_VERSION
  );
  assert.deepEqual(result.prcs, []);
  assert.deepEqual(result.pieces, [
    {
      index: 0,
      cpStart: 0,
      cpEnd: 1,
      rawPrm: 0,
      kind: "prm0",
      hasEffect: false,
      isprm: 0,
      val: 0,
      simplePropertyGroup: "none",
      simpleTableSprm: null,
      prcIndex: null
    },
    {
      index: 1,
      cpStart: 1,
      cpEnd: 2,
      rawPrm: 0x0130,
      kind: "prm0",
      hasEffect: true,
      isprm: 0x18,
      val: 1,
      simplePropertyGroup: "paragraph",
      simpleTableSprm: 0x2416,
      prcIndex: null
    },
    {
      index: 2,
      cpStart: 2,
      cpEnd: 3,
      rawPrm: 0x0032,
      kind: "prm0",
      hasEffect: true,
      isprm: 0x19,
      val: 0,
      simplePropertyGroup: "paragraph",
      simpleTableSprm: 0x2417,
      prcIndex: null
    }
  ]);
  assert.equal(result.supportedSimpleIsprms.includes(0x18), true);
  assert.equal(result.supportedSimpleIsprms.includes(0x19), true);
  assert.equal(result.prm0AllowlistVerified, true);
  assert.equal(result.prm1PrcReferencesVerified, true);
  assert.equal(result.prcGrpprlFramingVerified, true);
  assert.equal(result.prcGrpprlSemanticsStatus, "not_parsed");
  assert.equal(result.tablePropertyApplicationStatus, "not_applied");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pieces), true);
  assert.equal(Object.isFrozen(result.pieces[0]), true);
  assert.equal(Object.isFrozen(result.supportedSimpleIsprms), true);
});

test("official calendar KRX legacy Word Pcd Prm binds complex modifiers to Prc", () => {
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
    [0, 1],
    [{ flags: 0, fcCompressed: 920, prm: 3 }],
    [[0x16, 0x24, 0], [0x17, 0x24, 1]]
  );

  const result = verifyOfficialMarketCalendarKrxLegacyWordPcdPrms(bytes);

  assert.deepEqual(
    result.prcs.map((prc) => ({
      index: prc.index,
      clxByteOffset: prc.clxByteOffset,
      grpprlByteOffset: prc.grpprlByteOffset,
      grpprlByteLength: prc.grpprlByteLength,
      grpprlBytes: [...prc.grpprlBytes],
      bytesOwnership: prc.bytesOwnership
    })),
    [
      {
        index: 0,
        clxByteOffset: 0,
        grpprlByteOffset: 3,
        grpprlByteLength: 3,
        grpprlBytes: [0x16, 0x24, 0],
        bytesOwnership: "caller_owned_copy"
      },
      {
        index: 1,
        clxByteOffset: 6,
        grpprlByteOffset: 9,
        grpprlByteLength: 3,
        grpprlBytes: [0x17, 0x24, 1],
        bytesOwnership: "caller_owned_copy"
      }
    ]
  );
  assert.deepEqual(result.pieces[0], {
    index: 0,
    cpStart: 0,
    cpEnd: 1,
    rawPrm: 3,
    kind: "prm1",
    hasEffect: true,
    isprm: null,
    val: null,
    simplePropertyGroup: null,
    simpleTableSprm: null,
    prcIndex: 1
  });
  assert.equal(Object.isFrozen(result.prcs), true);
  assert.equal(Object.isFrozen(result.prcs[0]), true);

  configurePlcPcd(
    bytes,
    [0, 1],
    [{ flags: 0, fcCompressed: 920, prm: 3 }],
    [[0x16, 0x24, 1], [0x17, 0x24, 0]]
  );
  assert.deepEqual([...result.prcs[1]!.grpprlBytes], [0x17, 0x24, 1]);
});

test("official calendar KRX legacy Word Prc GrpPrl verifies shared Prl framing", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  const referencedGrpPrl: number[] = [];
  appendPrlBytes(referencedGrpPrl, 0x2416, [1]);
  appendPrlBytes(referencedGrpPrl, 0x0801, [0x7f]);
  appendPrlBytes(referencedGrpPrl, 0xd608, [2, 0, 0]);
  configurePlcPcd(
    bytes,
    [0, 1],
    [{ flags: 0, fcCompressed: 920, prm: 3 }],
    [[], referencedGrpPrl]
  );

  const result = verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_SCHEMA_VERSION
  );
  assert.deepEqual(
    result.prcs.map((prc) => ({
      index: prc.index,
      prlCount: prc.prlCount,
      paragraphPrlCount: prc.paragraphPrlCount,
      characterPrlCount: prc.characterPrlCount,
      otherPropertyGroupPrlCount: prc.otherPropertyGroupPrlCount,
      prls: prc.prls.map((prl) => ({
        index: prl.index,
        byteOffset: prl.byteOffset,
        sprm: prl.sprm,
        sgc: prl.sgc,
        operandByteOffset: prl.operandByteOffset,
        operandBytes: [...prl.operandBytes],
        operandLengthKind: prl.operandLengthKind
      }))
    })),
    [
      {
        index: 0,
        prlCount: 0,
        paragraphPrlCount: 0,
        characterPrlCount: 0,
        otherPropertyGroupPrlCount: 0,
        prls: []
      },
      {
        index: 1,
        prlCount: 3,
        paragraphPrlCount: 1,
        characterPrlCount: 1,
        otherPropertyGroupPrlCount: 1,
        prls: [
          {
            index: 0,
            byteOffset: 0,
            sprm: 0x2416,
            sgc: 1,
            operandByteOffset: 2,
            operandBytes: [1],
            operandLengthKind: "fixed"
          },
          {
            index: 1,
            byteOffset: 3,
            sprm: 0x0801,
            sgc: 2,
            operandByteOffset: 5,
            operandBytes: [0x7f],
            operandLengthKind: "fixed"
          },
          {
            index: 2,
            byteOffset: 6,
            sprm: 0xd608,
            sgc: 5,
            operandByteOffset: 8,
            operandBytes: [2, 0, 0],
            operandLengthKind: "t_def_table_two_byte_prefix"
          }
        ]
      }
    ]
  );
  assert.equal(result.pieces[0]!.prcIndex, 1);
  assert.equal(result.prcGrpprlFramingVerified, true);
  assert.equal(result.sprmFramingVerified, true);
  assert.equal(result.paragraphModifierSelectionStatus, "not_applied");
  assert.equal(result.tablePropertyApplicationStatus, "not_applied");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.prcs), true);
  assert.equal(Object.isFrozen(result.prcs[1]), true);
  assert.equal(Object.isFrozen(result.prcs[1]!.prls), true);

  result.prcs[1]!.grpprlBytes[2] = 0;
  assert.deepEqual([...result.prcs[1]!.prls[0]!.operandBytes], [1]);
});

test("official calendar KRX legacy Word Prc GrpPrl rejects invalid inner framing", () => {
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
    [0, 1],
    [{ flags: 0, fcCompressed: 920, prm: 1 }],
    [[0x16, 0x24]]
  );

  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordPrcGrpPrlError &&
      error.code === "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PRC_GRPPRL_INVALID"
  );
});

test("official calendar KRX legacy Word Pcd Prm rejects unknown simple and missing complex modifiers", () => {
  const invalidPrms = [2, 1];
  for (const prm of invalidPrms) {
    const bytes = compoundFileWithUserStreams(3);
    configureWordRootStreams(bytes, "1Table");
    configureVariableFib(bytes, {
      nFib: 0x00c1,
      version: "Word97",
      cbRgFcLcb: 0x005d,
      cswNew: 0
    });
    configurePlcPcd(bytes, [0, 1], [
      { flags: 0, fcCompressed: 920, prm }
    ]);
    assertPcdPrmCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_INVALID"
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

test("official calendar KRX legacy Word document title binds the registered title paragraph", () => {
  const bytes = compoundFileWithUserStreams(3);
  const title = "KRX Derivatives Trading Calendar 2013";
  configureDocumentTitleFixture(bytes, `${title}\r`);

  const result = verifyOfficialMarketCalendarKrxLegacyWordDocumentTitle({
    fileName: "E_Trading_Calendar2013.doc",
    rawDocumentBytes: bytes
  });

  assert.deepEqual(result, {
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_SCHEMA_VERSION,
    fileName: "E_Trading_Calendar2013.doc",
    targetYear: "2013",
    nFib: 0x00c1,
    tableStreamName: "1Table",
    expectedDocumentTitle: title,
    titleCpStart: 0,
    titleCpEnd: title.length,
    titleOccurrenceCount: 1,
    titleBindingVerified: true,
    columnSemanticsStatus: "not_interpreted",
    holidaySemanticsStatus: "not_interpreted",
    sourceRoleStatus: "candidate_not_accepted"
  });
  assert.equal(Object.isFrozen(result), true);
});

test("official calendar KRX legacy Word document title rejects missing, partial, and duplicate paragraphs", () => {
  const title = "KRX Derivatives Trading Calendar 2013";
  for (const text of [
    `prefix ${title}\r`,
    `${title} suffix\r`,
    `${title}\r${title}\r`,
    "KRX Derivatives Trading Calendar 2014\r"
  ]) {
    const bytes = compoundFileWithUserStreams(3);
    configureDocumentTitleFixture(bytes, text);

    assert.throws(
      () =>
        verifyOfficialMarketCalendarKrxLegacyWordDocumentTitle({
          fileName: "E_Trading_Calendar2013.doc",
          rawDocumentBytes: bytes
        }),
      (error: unknown) =>
        error instanceof OfficialMarketCalendarKrxLegacyWordDocumentTitleError &&
        error.code ===
          "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_INVALID"
    );
  }
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

test("official calendar KRX legacy Word paragraph boundaries map PAPX FCs across pieces", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidParagraphBoundariesFixture(bytes);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARIES_SCHEMA_VERSION
  );
  assert.equal(result.mainDocumentCpStart, 0);
  assert.equal(result.mainDocumentCpEnd, 5);
  assert.deepEqual(result.paragraphs, [
    {
      index: 0,
      cpStart: 0,
      cpEnd: 3,
      characterCount: 3,
      markCp: 2,
      markCodeUnit: 0x000d,
      markKind: "paragraph_mark",
      startPieceIndex: 0,
      endPieceIndex: 1,
      spansMultiplePieces: true,
      terminalPapxPageIndex: 0,
      terminalPapxParagraphIndex: 1,
      terminalPapxFcStart: 930,
      terminalPapxFcEnd: 951
    },
    {
      index: 1,
      cpStart: 3,
      cpEnd: 5,
      characterCount: 2,
      markCp: 4,
      markCodeUnit: 0x000d,
      markKind: "paragraph_mark",
      startPieceIndex: 1,
      endPieceIndex: 1,
      spansMultiplePieces: false,
      terminalPapxPageIndex: 0,
      terminalPapxParagraphIndex: 2,
      terminalPapxFcStart: 951,
      terminalPapxFcEnd: 953
    }
  ]);
  assert.equal(
    result.paragraphBoundaryAlgorithm,
    "ms_doc_2_4_2_piece_aware"
  );
  assert.equal(result.paragraphBoundaryMarksVerified, true);
  assert.equal(result.pcdPrmStatus, "not_applied_not_required_for_boundaries");
  assert.equal(
    result.tablePropertyBindingStatus,
    "terminal_papx_identified_properties_not_applied"
  );
  assert.equal(result.tableRowCellBoundaryStatus, "not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.paragraphs), true);
  assert.equal(Object.isFrozen(result.paragraphs[0]), true);
});

test("official calendar KRX legacy Word paragraph boundaries accept cell and section marks", () => {
  const expectedMarks = [
    { codeUnit: 0x0007, kind: "cell_or_ttp_mark" },
    { codeUnit: 0x000c, kind: "section_mark" }
  ] as const;
  for (const expected of expectedMarks) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidParagraphBoundariesFixture(bytes);
    writeWordByte(bytes, 950, expected.codeUnit);

    const result =
      verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries(bytes);
    assert.equal(result.paragraphs[0]!.markCodeUnit, expected.codeUnit);
    assert.equal(result.paragraphs[0]!.markKind, expected.kind);
  }
});

test("official calendar KRX legacy Word paragraph boundaries reject invalid FC and mark semantics", () => {
  const invalidFixtures = [
    (bytes: Uint8Array) => writeWordUint32(bytes, 2048 + 4, 923),
    (bytes: Uint8Array) => writeWordByte(bytes, 950, 0x41),
    (bytes: Uint8Array) =>
      configureValidParagraphBoundariesFixture(bytes, { secondPieceFlags: 1 })
  ];
  for (const mutate of invalidFixtures) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidParagraphBoundariesFixture(bytes);
    mutate(bytes);
    assertParagraphBoundariesCode(
      bytes,
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARY_INVALID"
    );
  }
});

test("official calendar KRX legacy Word direct paragraph properties use terminal Prm0", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidParagraphBoundariesFixture(bytes);
  configurePlcPcd(bytes, [0, 2, 5], [
    { flags: 1, fcCompressed: 920, prm: 0x0132 },
    { flags: 0, fcCompressed: 0x4000076c, prm: 0x0130 }
  ]);
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [920, 930, 951, 953],
    bxPap: [
      { bOffset: 0, reservedValue: 0 },
      { bOffset: 30, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
  setPapxGrpPrl(
    bytes,
    2048 + 60,
    tablePropertyGroup(
      [
        [0x2417, [1]],
        [0x2405, [1]]
      ],
      0
    )
  );
  const boundaries =
    verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries(bytes);
  assert.equal(boundaries.paragraphs[0]!.startPieceIndex, 0);
  assert.equal(boundaries.paragraphs[0]!.endPieceIndex, 1);

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_SCHEMA_VERSION
  );
  assert.deepEqual(
    result.paragraphs.map((paragraph) => ({
      index: paragraph.index,
      terminalPcdPieceIndex: paragraph.terminalPcdPieceIndex,
      terminalPcdPrmKind: paragraph.terminalPcdPrmKind,
      terminalPcdRawPrm: paragraph.terminalPcdRawPrm,
      papxPrlCount: paragraph.papxPrlCount,
      appendedPcdParagraphPrlCount:
        paragraph.appendedPcdParagraphPrlCount,
      directParagraphPrlCount: paragraph.directParagraphPrlCount,
      inTable: paragraph.inTable,
      tableDepth: paragraph.tableDepth,
      isTtp: paragraph.isTtp,
      tableRole: paragraph.tableRole,
      propertiesStatus: paragraph.propertiesStatus
    })),
    [
      {
        index: 0,
        terminalPcdPieceIndex: 1,
        terminalPcdPrmKind: "prm0",
        terminalPcdRawPrm: 0x0130,
        papxPrlCount: 2,
        appendedPcdParagraphPrlCount: 1,
        directParagraphPrlCount: 3,
        inTable: true,
        tableDepth: 1,
        isTtp: true,
        tableRole: "depth_1_ttp_candidate",
        propertiesStatus: "papx_and_terminal_pcd_applied"
      },
      {
        index: 1,
        terminalPcdPieceIndex: 1,
        terminalPcdPrmKind: "prm0",
        terminalPcdRawPrm: 0x0130,
        papxPrlCount: 0,
        appendedPcdParagraphPrlCount: 1,
        directParagraphPrlCount: 1,
        inTable: true,
        tableDepth: 1,
        isTtp: false,
        tableRole: "table_paragraph",
        propertiesStatus: "papx_and_terminal_pcd_applied"
      }
    ]
  );
  assert.equal(
    result.directParagraphFormattingAlgorithm,
    "ms_doc_2_4_6_1_terminal_pcd"
  );
  assert.equal(result.papxThenTerminalPcdOrderVerified, true);
  assert.equal(result.prm0ParagraphSelectionVerified, true);
  assert.equal(result.prm1ParagraphSelectionVerified, true);
  assert.equal(result.tableTextMarkSemanticsStatus, "not_verified");
  assert.equal(result.tableRowCellBoundaryStatus, "not_verified");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.paragraphs), true);
  assert.equal(Object.isFrozen(result.paragraphs[0]), true);
});

test("official calendar KRX legacy Word direct paragraph properties select Prm1 paragraph Sprms", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidParagraphBoundariesFixture(bytes);
  const grpprl: number[] = [];
  appendPrlBytes(grpprl, 0x2416, [1]);
  appendPrlBytes(grpprl, 0x2417, [1]);
  appendPrlBytes(grpprl, 0x0801, [1]);
  configurePlcPcd(
    bytes,
    [0, 2, 5],
    [
      { flags: 1, fcCompressed: 920 },
      { flags: 0, fcCompressed: 0x4000076c, prm: 1 }
    ],
    [grpprl]
  );
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([920, 953], [4]),
    52
  );

  const result =
    verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties(bytes);

  assert.deepEqual(
    result.paragraphs.map((paragraph) => ({
      terminalPcdPrmKind: paragraph.terminalPcdPrmKind,
      appendedPcdParagraphPrlCount:
        paragraph.appendedPcdParagraphPrlCount,
      ignoredPcdNonParagraphPrlCount:
        paragraph.ignoredPcdNonParagraphPrlCount,
      directParagraphPrlCount: paragraph.directParagraphPrlCount,
      interpretedPrlCount: paragraph.interpretedPrlCount,
      uninterpretedPrlCount: paragraph.uninterpretedPrlCount,
      tableRole: paragraph.tableRole,
      textMarkValidationStatus: paragraph.textMarkValidationStatus
    })),
    [
      {
        terminalPcdPrmKind: "prm1",
        appendedPcdParagraphPrlCount: 2,
        ignoredPcdNonParagraphPrlCount: 1,
        directParagraphPrlCount: 2,
        interpretedPrlCount: 2,
        uninterpretedPrlCount: 0,
        tableRole: "depth_1_ttp_candidate",
        textMarkValidationStatus: "pending_text_binding"
      },
      {
        terminalPcdPrmKind: "prm1",
        appendedPcdParagraphPrlCount: 2,
        ignoredPcdNonParagraphPrlCount: 1,
        directParagraphPrlCount: 2,
        interpretedPrlCount: 2,
        uninterpretedPrlCount: 0,
        tableRole: "depth_1_ttp_candidate",
        textMarkValidationStatus: "pending_text_binding"
      }
    ]
  );
});

test("official calendar KRX legacy Word direct paragraph properties reject invalid merged semantics", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidParagraphBoundariesFixture(bytes);
  configurePlcPcd(bytes, [0, 2, 5], [
    { flags: 1, fcCompressed: 920 },
    { flags: 0, fcCompressed: 0x4000076c, prm: 0x0132 }
  ]);

  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties(
        bytes
      ),
    (error: unknown) =>
      error instanceof
        OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError &&
      error.code ===
        "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_INVALID"
  );
});

test("official calendar KRX legacy Word direct paragraph properties identify unsupported non-default style", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidParagraphBoundariesFixture(bytes);
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [920, 930, 951, 953],
    bxPap: [
      { bOffset: 0, reservedValue: 0 },
      { bOffset: 30, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
  setPapxGrpPrl(
    bytes,
    2048 + 60,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x2417, [1]]
      ],
      1
    )
  );

  assert.throws(
    () =>
      verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties(
        bytes
      ),
    (error: unknown) =>
      error instanceof
        OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError &&
      error.code ===
        "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_STYLE_UNSUPPORTED"
  );
});

test("official calendar KRX legacy Word table text marks classify depth-one cells and TTP", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidDepthOneTableTextMarksFixture(bytes, 0x0007);

  const result = verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARKS_SCHEMA_VERSION
  );
  assert.deepEqual(result.paragraphs, [
    {
      index: 0,
      cpStart: 0,
      cpEnd: 2,
      markCp: 1,
      markCodeUnit: 0x0007,
      tableDepth: 1,
      resolvedRole: "depth_1_cell_mark",
      tableBoundaryRole: "cell_end",
      precedingCellMarkStatus: "not_applicable"
    },
    {
      index: 1,
      cpStart: 2,
      cpEnd: 3,
      markCp: 2,
      markCodeUnit: 0x0007,
      tableDepth: 1,
      resolvedRole: "depth_1_ttp_mark",
      tableBoundaryRole: "row_end",
      precedingCellMarkStatus: "verified"
    },
    {
      index: 2,
      cpStart: 3,
      cpEnd: 5,
      markCp: 4,
      markCodeUnit: 0x000d,
      tableDepth: 0,
      resolvedRole: "non_table_paragraph",
      tableBoundaryRole: "none",
      precedingCellMarkStatus: "not_applicable"
    }
  ]);
  assert.equal(result.depthOneCellAndTtpMarksVerified, true);
  assert.equal(result.nestedCellAndTtpMarksVerified, true);
  assert.equal(result.ttpPrecedingCellMarkVerified, true);
  assert.equal(result.tableRowCellBoundaryStatus, "marks_classified_not_grouped");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.paragraphs), true);
  assert.equal(Object.isFrozen(result.paragraphs[0]), true);
});

test("official calendar KRX legacy Word table text marks classify nested cell and TTP marks", () => {
  const expectedRoles = [
    { sprm: 0x244b, role: "nested_cell_mark", boundaryRole: "cell_end" },
    { sprm: 0x244c, role: "nested_ttp_mark", boundaryRole: "row_end" }
  ] as const;
  for (const expected of expectedRoles) {
    const bytes = compoundFileWithUserStreams(3);
    configureValidNestedTableTextMarkFixture(bytes, expected.sprm);

    const result = verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks(bytes);
    assert.equal(result.paragraphs[0]!.resolvedRole, expected.role);
    assert.equal(
      result.paragraphs[0]!.tableBoundaryRole,
      expected.boundaryRole
    );
  }
});

test("official calendar KRX legacy Word table text marks reject invalid role bindings", () => {
  const invalidFixtures = [
    (bytes: Uint8Array) => {
      configureValidParagraphBoundariesFixture(bytes);
      writeWordByte(bytes, 950, 0x0007);
    },
    (bytes: Uint8Array) =>
      configureValidDepthOneTableTextMarksFixture(bytes, 0x000d),
    configureConsecutiveDepthOneTtpMarksFixture
  ];
  for (const configure of invalidFixtures) {
    const bytes = compoundFileWithUserStreams(3);
    configure(bytes);
    assert.throws(
      () => verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks(bytes),
      (error: unknown) =>
        error instanceof OfficialMarketCalendarKrxLegacyWordTableTextMarksError &&
        error.code ===
          "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARK_INVALID"
    );
  }
});

test("official calendar KRX legacy Word table row grouping closes depth-one cells and rows", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidDepthOneTableTextMarksFixture(bytes, 0x0007);

  const result = verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_SCHEMA_VERSION
  );
  assert.deepEqual(result.rows, [
    {
      index: 0,
      tableDepth: 1,
      cpStart: 0,
      cpEnd: 3,
      cells: [
        {
          index: 0,
          cpStart: 0,
          cpEnd: 2,
          paragraphIndices: [0],
          terminalParagraphIndex: 0,
          terminalRole: "depth_1_cell_mark"
        }
      ],
      rowTerminatorParagraphIndex: 1,
      rowTerminatorRole: "depth_1_ttp_mark"
    }
  ]);
  assert.equal(result.tableRowCellBoundaryStatus, "grouped");
  assert.equal(result.nestedRowBoundaryStatus, "grouped");
  assert.equal(result.sourceRowProjectionStatus, "not_projected");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rows), true);
  assert.equal(Object.isFrozen(result.rows[0]!.cells), true);
});

test("official calendar KRX legacy Word table row grouping preserves nested rows inside outer cells", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidNestedAndOuterTableRowsFixture(bytes);

  const result = verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping(bytes);

  assert.deepEqual(
    result.rows.map((row) => ({
      index: row.index,
      tableDepth: row.tableDepth,
      cpStart: row.cpStart,
      cpEnd: row.cpEnd,
      cellRanges: row.cells.map((cell) => [cell.cpStart, cell.cpEnd]),
      paragraphIndices: row.cells.map((cell) => cell.paragraphIndices),
      terminator: row.rowTerminatorRole
    })),
    [
      {
        index: 0,
        tableDepth: 1,
        cpStart: 0,
        cpEnd: 7,
        cellRanges: [[0, 6]],
        paragraphIndices: [[0, 1, 2]],
        terminator: "depth_1_ttp_mark"
      },
      {
        index: 1,
        tableDepth: 2,
        cpStart: 0,
        cpEnd: 4,
        cellRanges: [
          [0, 2],
          [2, 4]
        ],
        paragraphIndices: [[0], [1]],
        terminator: "nested_ttp_mark"
      }
    ]
  );
});

test("official calendar KRX legacy Word table row grouping rejects an unclosed nested row", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidNestedTableTextMarkFixture(bytes, 0x244b);

  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordTableRowGroupingError &&
      error.code ===
        "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_INVALID"
  );
});

test("official calendar KRX legacy Word table row grouping bounds depth before allocating rows", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidNestedTableTextMarkFixture(bytes, 0x244c);
  setPapxGrpPrl(
    bytes,
    2048 + 40,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(0x7fffffff)],
        [0x244c, [1]]
      ],
      0
    )
  );

  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordTableRowGroupingError &&
      error.code ===
        "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_INVALID"
  );
});

test("official calendar KRX legacy Word source rows remove only the depth-one terminal mark", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidDepthOneTableTextMarksFixture(bytes, 0x0007);

  const result = verifyOfficialMarketCalendarKrxLegacyWordSourceRows(bytes);

  assert.equal(
    result.schemaVersion,
    OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_SCHEMA_VERSION
  );
  assert.deepEqual(result.rows[0]!.cells[0], {
    index: 0,
    cpStart: 0,
    cpEnd: 2,
    contentCpEnd: 1,
    paragraphIndices: [0],
    terminalParagraphIndex: 0,
    terminalRole: "depth_1_cell_mark",
    rawText: "A\u0007",
    contentText: "A"
  });
  assert.equal(result.sourceRowProjectionStatus, "structural_text_projected");
  assert.equal(
    result.terminalMarkHandling,
    "removed_from_content_preserved_in_raw"
  );
  assert.equal(result.internalControlCodeHandling, "preserved");
  assert.equal(result.columnSemanticsStatus, "not_interpreted");
  assert.equal(result.sourceRoleStatus, "candidate_not_accepted");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rows[0]!.cells[0]), true);
});

test("official calendar KRX legacy Word source rows preserve nested control codes and project nested cells", () => {
  const bytes = compoundFileWithUserStreams(3);
  configureValidNestedAndOuterTableRowsFixture(bytes);

  const result = verifyOfficialMarketCalendarKrxLegacyWordSourceRows(bytes);

  assert.deepEqual(
    result.rows.map((row) => ({
      tableDepth: row.tableDepth,
      cells: row.cells.map((cell) => ({
        rawText: cell.rawText,
        contentText: cell.contentText,
        terminalRole: cell.terminalRole
      }))
    })),
    [
      {
        tableDepth: 1,
        cells: [
          {
            rawText: "A\rB\rC\u0007",
            contentText: "A\rB\rC",
            terminalRole: "depth_1_cell_mark"
          }
        ]
      },
      {
        tableDepth: 2,
        cells: [
          {
            rawText: "A\r",
            contentText: "A",
            terminalRole: "nested_cell_mark"
          },
          {
            rawText: "B\r",
            contentText: "B",
            terminalRole: "nested_ttp_mark"
          }
        ]
      }
    ]
  );
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

function configureStshfReference(
  bytes: Uint8Array,
  offset: number,
  size: number,
  value: number
): void {
  writeWordUint32(bytes, 154 + 1 * 8, offset);
  writeWordUint32(bytes, 154 + 1 * 8 + 4, size);
  if (offset + size <= 64) {
    fillFileSectorRange(bytes, 3, offset, size, value);
  }
}

function configureRawStsh(
  bytes: Uint8Array,
  stshBytes: Uint8Array,
  tableOffset: number
): void {
  configureStshfReference(bytes, tableOffset, stshBytes.length, 0);
  bytes.set(
    stshBytes,
    (3 + 1) * readSectorSize(bytes) + tableOffset
  );
}

function buildStshBytes(
  options: {
    cbStshi?: number;
    cstd?: number;
    cbSTDBaseInFile?: number;
    stshifFlags?: number;
    istdMaxFixedWhenSaved?: number;
    records?: ReadonlyMap<number, Uint8Array>;
  } = {}
): Uint8Array {
  const cbStshi = options.cbStshi ?? 18;
  const cstd = options.cstd ?? 15;
  const records = options.records ?? new Map<number, Uint8Array>();
  let byteLength = 2 + cbStshi;
  for (let istd = 0; istd < cstd; istd += 1) {
    const record = records.get(istd) ?? new Uint8Array();
    byteLength += 2 + record.length + (record.length % 2);
  }
  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, cbStshi, true);
  view.setUint16(2, cstd, true);
  view.setUint16(4, options.cbSTDBaseInFile ?? 0x000a, true);
  view.setUint16(6, options.stshifFlags ?? 0x0001, true);
  view.setUint16(10, options.istdMaxFixedWhenSaved ?? 0x000f, true);
  let offset = 2 + cbStshi;
  for (let istd = 0; istd < cstd; istd += 1) {
    const record = records.get(istd) ?? new Uint8Array();
    view.setInt16(offset, record.length, true);
    bytes.set(record, offset + 2);
    offset += 2 + record.length + (record.length % 2);
  }
  return bytes;
}

function buildStdfBaseRecord(
  options: {
    baseSize?: 10 | 18;
    sti?: number;
    stk?: number;
    istdBase?: number;
    cupx?: number;
    istdNext?: number;
    bchUpe?: number;
    body?: Uint8Array;
  } = {}
): Uint8Array {
  const baseSize = options.baseSize ?? 10;
  const body = options.body ?? new Uint8Array();
  const bytes = new Uint8Array(baseSize + body.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, options.sti ?? 0, true);
  view.setUint16(2, (options.stk ?? 1) | ((options.istdBase ?? 0x0fff) << 4), true);
  view.setUint16(4, (options.cupx ?? 2) | ((options.istdNext ?? 0) << 4), true);
  view.setUint16(6, options.bchUpe ?? bytes.length, true);
  bytes.set(body, baseSize);
  return bytes;
}

function setStshUint16(
  bytes: Uint8Array,
  offset: number,
  value: number
): Uint8Array {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(
    offset,
    value,
    true
  );
  return bytes;
}

function setStshInt16(
  bytes: Uint8Array,
  offset: number,
  value: number
): Uint8Array {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt16(
    offset,
    value,
    true
  );
  return bytes;
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
  plcBtePapxBytes: Uint8Array,
  tableOffset = 20
): void {
  configurePlcBtePapxReference(bytes, tableOffset, plcBtePapxBytes.length, 0);
  bytes.set(plcBtePapxBytes, (3 + 1) * readSectorSize(bytes) + tableOffset);
}

function configureValidParagraphBoundariesFixture(
  bytes: Uint8Array,
  options: { secondPieceFlags?: number } = {}
): void {
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 2, 5], [
    { flags: 1, fcCompressed: 920 },
    {
      flags: options.secondPieceFlags ?? 0,
      fcCompressed: 0x4000076c
    }
  ]);
  configureDocumentCounts(bytes, [5, 0, 0, 0, 0, 0, 0]);
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([920, 953], [4]),
    40
  );
  writeWordUint32(bytes, 64, 2560);
  writeWordUint16(bytes, 920, 0x0041);
  writeWordUint16(bytes, 922, 0x0042);
  [0x0d, 0x43, 0x0d].forEach((value, index) => {
    writeWordByte(bytes, 950 + index, value);
  });
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [920, 930, 951, 953],
    bxPap: [
      { bOffset: 0, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
}

function configureConsecutiveDepthOneTtpMarksFixture(bytes: Uint8Array): void {
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 4, 6], [
    { flags: 0, fcCompressed: 920, prm: 0x0130 },
    { flags: 0, fcCompressed: 928 }
  ]);
  configureDocumentCounts(bytes, [6, 0, 0, 0, 0, 0, 0]);
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([920, 932], [4]),
    40
  );
  writeWordUint32(bytes, 64, 2560);
  [0x0041, 0x0007, 0x0007, 0x0007, 0x005a, 0x000d].forEach(
    (value, index) => writeWordUint16(bytes, 920 + index * 2, value)
  );
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [920, 924, 926, 928, 932],
    bxPap: [
      { bOffset: 0, reservedValue: 0 },
      { bOffset: 40, reservedValue: 0 },
      { bOffset: 50, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
  setPapxGrpPrl(
    bytes,
    2048 + 80,
    tablePropertyGroup(
      [
        [0x2417, [1]],
        [0x2405, [1]]
      ],
      0
    )
  );
  setPapxGrpPrl(
    bytes,
    2048 + 100,
    tablePropertyGroup(
      [
        [0x2417, [1]],
        [0x2405, [1]]
      ],
      0
    )
  );
}

function configureValidNestedAndOuterTableRowsFixture(bytes: Uint8Array): void {
  configureWordRootStreams(bytes, "1Table");
  configureWord2000Fib(bytes);
  configurePlcPcd(bytes, [0, 7, 9], [
    { flags: 0, fcCompressed: 1100, prm: 0x0130 },
    { flags: 0, fcCompressed: 1114 }
  ]);
  configureDocumentCounts(bytes, [9, 0, 0, 0, 0, 0, 0]);
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([1100, 1118], [4]),
    40
  );
  writeWordUint32(bytes, 64, 2560);
  [
    0x0041,
    0x000d,
    0x0042,
    0x000d,
    0x0043,
    0x0007,
    0x0007,
    0x005a,
    0x000d
  ].forEach((value, index) => writeWordUint16(bytes, 1100 + index * 2, value));
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [1100, 1104, 1108, 1112, 1114, 1118],
    bxPap: [
      { bOffset: 50, reservedValue: 0 },
      { bOffset: 60, reservedValue: 0 },
      { bOffset: 70, reservedValue: 0 },
      { bOffset: 80, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
  setPapxGrpPrl(
    bytes,
    2048 + 100,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(2)],
        [0x244b, [1]]
      ],
      0
    )
  );
  setPapxGrpPrl(
    bytes,
    2048 + 120,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(2)],
        [0x244c, [1]]
      ],
      0
    )
  );
  setPapxGrpPrl(
    bytes,
    2048 + 140,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(1)]
      ],
      0
    )
  );
  setPapxGrpPrl(
    bytes,
    2048 + 160,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(1)],
        [0x2417, [1]]
      ],
      0
    )
  );
}

function configureDocumentTitleFixture(
  bytes: Uint8Array,
  text: string
): void {
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, text.length], [
    { flags: 0, fcCompressed: 920 }
  ]);
  configureDocumentCounts(bytes, [text.length, 0, 0, 0, 0, 0, 0]);
  writeWordUint32(bytes, 64, 920 + text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    writeWordUint16(bytes, 920 + index * 2, text.charCodeAt(index));
  }
}

function configureValidDepthOneTableTextMarksFixture(
  bytes: Uint8Array,
  precedingTtpCodeUnit: number
): void {
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configurePlcPcd(bytes, [0, 3, 5], [
    { flags: 0, fcCompressed: 920, prm: 0x0130 },
    { flags: 0, fcCompressed: 926 }
  ]);
  configureDocumentCounts(bytes, [5, 0, 0, 0, 0, 0, 0]);
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([920, 930], [4]),
    40
  );
  writeWordUint32(bytes, 64, 2560);
  [0x0041, precedingTtpCodeUnit, 0x0007, 0x005a, 0x000d].forEach(
    (value, index) => writeWordUint16(bytes, 920 + index * 2, value)
  );
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [920, 924, 926, 930],
    bxPap: [
      { bOffset: 0, reservedValue: 0 },
      { bOffset: 30, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
  setPapxGrpPrl(
    bytes,
    2048 + 60,
    tablePropertyGroup(
      [
        [0x2417, [1]],
        [0x2405, [1]]
      ],
      0
    )
  );
}

function configureValidNestedTableTextMarkFixture(
  bytes: Uint8Array,
  nestedMarkSprm: 0x244b | 0x244c
): void {
  configureWordRootStreams(bytes, "1Table");
  configureWord2000Fib(bytes);
  configurePlcPcd(bytes, [0, 2, 4], [
    { flags: 0, fcCompressed: 1100 },
    { flags: 0, fcCompressed: 1104 }
  ]);
  configureDocumentCounts(bytes, [4, 0, 0, 0, 0, 0, 0]);
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([1100, 1108], [4]),
    40
  );
  writeWordUint32(bytes, 64, 2560);
  [0x0041, 0x000d, 0x005a, 0x000d].forEach((value, index) => {
    writeWordUint16(bytes, 1100 + index * 2, value);
  });
  configurePapxFkpPage(bytes, 2048, {
    rgfc: [1100, 1104, 1108],
    bxPap: [
      { bOffset: 20, reservedValue: 0 },
      { bOffset: 0, reservedValue: 0 }
    ],
    papx: []
  });
  setPapxGrpPrl(
    bytes,
    2048 + 40,
    tablePropertyGroup(
      [
        [0x2416, [1]],
        [0x6649, int32Bytes(2)],
        [nestedMarkSprm, [1]]
      ],
      0
    )
  );
}

function configureValidPapxFkpFixture(bytes: Uint8Array): void {
  configureWordRootStreams(bytes, "1Table");
  configureVariableFib(bytes, {
    nFib: 0x00c1,
    version: "Word97",
    cbRgFcLcb: 0x005d,
    cswNew: 0
  });
  configureRawPlcBtePapx(
    bytes,
    createPlcBtePapxBytes([920, 1000, 1100], [2, 3])
  );
  writeWordUint32(bytes, 64, 2048);
  configurePapxFkpPage(bytes, 1024, {
    rgfc: [920, 950, 1000],
    bxPap: [
      { bOffset: 20, reservedValue: 0x7a },
      { bOffset: 0, reservedValue: 0x6b }
    ],
    papx: [
      {
        offset: 40,
        bytes: [3, 0x34, 0x12, 0x16, 0x24, 0x01]
      }
    ]
  });
  configurePapxFkpPage(bytes, 1536, {
    rgfc: [1000, 1100],
    bxPap: [{ bOffset: 20, reservedValue: 0x5c }],
    papx: [{ offset: 40, bytes: [0, 1, 0x78, 0x56] }]
  });
}

function configureValidGrpPrlFixture(bytes: Uint8Array): void {
  configureValidPapxFkpFixture(bytes);
  const groupBytes = [0x34, 0x12];
  appendPrlBytes(groupBytes, 0x0401, [0x10]);
  appendPrlBytes(groupBytes, 0x2402, [0x11]);
  appendPrlBytes(groupBytes, 0x4403, [0x12, 0x13]);
  appendPrlBytes(groupBytes, 0x6404, [0x14, 0x15, 0x16, 0x17]);
  appendPrlBytes(groupBytes, 0x8405, [0x18, 0x19]);
  appendPrlBytes(groupBytes, 0xa406, [0x1a, 0x1b]);
  appendPrlBytes(groupBytes, 0xe407, [0x1c, 0x1d, 0x1e]);
  appendPrlBytes(groupBytes, 0xc408, [2, 0x20, 0x21]);
  appendPrlBytes(groupBytes, 0xd608, [2, 0, 0]);
  appendPrlBytes(groupBytes, 0xc615, [2, 0, 0]);
  assert.equal(groupBytes.length, 46);
  setPapxGrpPrl(bytes, 1024 + 40, groupBytes);
}

function configureValidTableParagraphPropertiesFixture(bytes: Uint8Array): void {
  configureValidPapxFkpFixture(bytes);
  configureWord2000Fib(bytes);
  setPapxGrpPrl(
    bytes,
    1024 + 40,
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(1)],
      [0x664a, int32Bytes(2)],
      [0x664a, int32Bytes(-1)],
      [0x244b, [1]],
      [0x2405, [1]]
    ], 0)
  );
  setPapxGrpPrl(
    bytes,
    1536 + 40,
    tablePropertyGroup([
      [0x2416, [1]],
      [0x6649, int32Bytes(1)],
      [0x2417, [1]]
    ], 0)
  );
}

function configureWord2000Fib(bytes: Uint8Array): void {
  configureVariableFib(bytes, {
    nFib: 0x00d9,
    version: "Word2000",
    cbRgFcLcb: 0x006c,
    cswNew: 2
  });
}

function configureDefaultStyleSecondPapxGroup(bytes: Uint8Array): void {
  setPapxGrpPrl(bytes, 1536 + 40, [0, 0]);
}

function tablePropertyGroup(
  prls: readonly (readonly [number, readonly number[]])[],
  istd = 0
): number[] {
  const groupBytes = [istd & 0xff, (istd >>> 8) & 0xff];
  for (const [sprm, operandBytes] of prls) {
    appendPrlBytes(groupBytes, sprm, operandBytes);
  }
  return groupBytes;
}

function int32Bytes(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return [...bytes];
}

function appendPrlBytes(
  destination: number[],
  sprm: number,
  operandBytes: readonly number[]
): void {
  destination.push(sprm & 0xff, (sprm >>> 8) & 0xff, ...operandBytes);
}

function setPapxGrpPrl(
  bytes: Uint8Array,
  papxWordOffset: number,
  groupBytes: readonly number[]
): void {
  assert.ok(groupBytes.length >= 2);
  const papxBytes =
    groupBytes.length % 2 === 0
      ? [0, groupBytes.length / 2, ...groupBytes]
      : [(groupBytes.length + 1) / 2, ...groupBytes];
  setWordRange(bytes, papxWordOffset, Uint8Array.from(papxBytes));
}

function prlSummary(
  sprm: number,
  spra: number,
  sgc: number,
  operandBytes: readonly number[],
  operandLengthKind:
    | "fixed"
    | "one_byte_prefix"
    | "t_def_table_two_byte_prefix"
): object {
  return {
    sprm,
    ispmd: sprm & 0x01ff,
    fSpec: (sprm & 0x0200) !== 0,
    sgc,
    spra,
    operandByteLength: operandBytes.length,
    operandBytes,
    operandLengthKind,
    bytesOwnership: "caller_owned_copy"
  };
}

function configurePapxFkpPage(
  bytes: Uint8Array,
  wordOffset: number,
  definition: {
    rgfc: readonly number[];
    bxPap: readonly { bOffset: number; reservedValue: number }[];
    papx: readonly { offset: number; bytes: readonly number[] }[];
  }
): void {
  assert.equal(definition.rgfc.length, definition.bxPap.length + 1);
  const page = new Uint8Array(512);
  const view = new DataView(page.buffer);
  definition.rgfc.forEach((fc, index) => {
    view.setUint32(index * 4, fc, true);
  });
  const bxPapByteOffset = definition.rgfc.length * 4;
  definition.bxPap.forEach((bxPap, index) => {
    const offset = bxPapByteOffset + index * 13;
    page[offset] = bxPap.bOffset;
    page.fill(bxPap.reservedValue, offset + 1, offset + 13);
  });
  definition.papx.forEach((papx) => {
    assert.ok(papx.offset + papx.bytes.length <= 511);
    page.set(papx.bytes, papx.offset);
  });
  page[511] = definition.bxPap.length;
  setWordRange(bytes, wordOffset, page);
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
  pieces: readonly { flags: number; fcCompressed: number; prm?: number }[],
  prcGrpprls: readonly (readonly number[])[] = []
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
    view.setUint16(offset + 6, piece.prm ?? 0, true);
  });
  const prcByteLength = prcGrpprls.reduce(
    (total, grpprl) => total + 3 + grpprl.length,
    0
  );
  const clxBytes = new Uint8Array(prcByteLength + 5 + plcPcdBytes.length);
  const clxView = new DataView(clxBytes.buffer);
  let clxOffset = 0;
  for (const grpprl of prcGrpprls) {
    assert.ok(grpprl.length <= 0x3fa2);
    clxView.setUint8(clxOffset, 1);
    clxView.setInt16(clxOffset + 1, grpprl.length, true);
    clxBytes.set(grpprl, clxOffset + 3);
    clxOffset += 3 + grpprl.length;
  }
  clxView.setUint8(clxOffset, 2);
  clxView.setUint32(clxOffset + 1, plcPcdBytes.length, true);
  clxBytes.set(plcPcdBytes, clxOffset + 5);
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

function setWordRange(
  bytes: Uint8Array,
  offset: number,
  values: Uint8Array
): void {
  const start = (4 + 1) * readSectorSize(bytes) + offset;
  bytes.set(values, start);
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

function assertStshfReferenceCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordStshfReferenceError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordStshfReference(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordStshfReferenceError &&
      error.code === code
  );
}

function assertStshCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordStshError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordStsh(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordStshError &&
      error.code === code
  );
}

function assertStdfBaseCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordStdfBaseError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordStdfBases(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordStdfBaseError &&
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

function assertPapxFkpCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordPapxFkpError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPapxFkp(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordPapxFkpError &&
      error.code === code
  );
}

function assertGrpPrlCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordGrpPrlError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordGrpPrls(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordGrpPrlError &&
      error.code === code
  );
}

function assertTableParagraphPropertiesCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordTableParagraphProperties(bytes),
    (error: unknown) =>
      error instanceof
        OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError &&
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

function assertPcdPrmCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordPcdPrmError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordPcdPrms(bytes),
    (error: unknown) =>
      error instanceof OfficialMarketCalendarKrxLegacyWordPcdPrmError &&
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

function assertParagraphBoundariesCode(
  bytes: Uint8Array,
  code: OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError["code"]
): void {
  assert.throws(
    () => verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries(bytes),
    (error: unknown) =>
      error instanceof
        OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError &&
      error.code === code
  );
}
