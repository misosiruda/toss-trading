import { verifyOfficialMarketCalendarOleCompoundFileDirectoryTree } from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";
import {
  projectOfficialMarketCalendarOleCompoundFileUserStreamBytes,
  type ProjectedOfficialMarketCalendarOleUserStreamBytes
} from "./officialMarketCalendarOleCompoundFileUserStreamBytes.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_BINARY_FILE_STREAMS_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_binary_file_streams.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_BINARY_FILE_STREAMS_SCHEMA_VERSION;
  wordDocumentStreamId: number;
  wordDocumentSize: string;
  wordDocumentBytes: Uint8Array;
  tableStreamId: number;
  tableStreamName: "0Table" | "1Table";
  tableStreamSize: string;
  tableStreamBytes: Uint8Array;
  ignoredTableStreamName: "0Table" | "1Table" | null;
  nFibBase: number;
  fWhichTblStm: 0 | 1;
  fibBaseVerified: true;
  fibStatus: "base_only_effective_version_not_resolved";
  protectionStatus: "unencrypted";
  wordTableParserStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsErrorCode =
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_MISSING"
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_SIZE"
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_BASE_INVALID"
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PROTECTION_UNSUPPORTED";

export class OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError";
  }
}

const WORD_STREAM_MAXIMUM_SIZE = 0x7fffffff;
const FIB_BASE_SIZE = 32;
const WORD_BINARY_FILE_IDENTIFIER = 0xa5ec;

export function verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordBinaryFileStreams {
  const directoryTree =
    verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(input);
  const projected =
    projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(input);
  const rootStreamIds = readRootStreamIds(directoryTree.entries);
  const rootStreams = projected.streams.filter((stream) =>
    rootStreamIds.has(stream.streamId)
  );
  const wordDocument = findRequiredStream(rootStreams, "WordDocument");
  verifyMaximumSize(wordDocument);
  const fibBase = verifyFibBase(wordDocument.bytes);
  const tableStreamName = fibBase.fWhichTblStm === 1 ? "1Table" : "0Table";
  const ignoredTableStreamName = tableStreamName === "1Table" ? "0Table" : "1Table";
  const tableStream = findRequiredStream(rootStreams, tableStreamName);
  verifyMaximumSize(tableStream);
  const ignoredTable = findOptionalStream(rootStreams, ignoredTableStreamName);

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_BINARY_FILE_STREAMS_SCHEMA_VERSION,
    wordDocumentStreamId: wordDocument.streamId,
    wordDocumentSize: wordDocument.streamSize,
    wordDocumentBytes: wordDocument.bytes,
    tableStreamId: tableStream.streamId,
    tableStreamName,
    tableStreamSize: tableStream.streamSize,
    tableStreamBytes: tableStream.bytes,
    ignoredTableStreamName: ignoredTable === undefined ? null : ignoredTableStreamName,
    nFibBase: fibBase.nFibBase,
    fWhichTblStm: fibBase.fWhichTblStm,
    fibBaseVerified: true,
    fibStatus: "base_only_effective_version_not_resolved",
    protectionStatus: "unencrypted",
    wordTableParserStatus: "not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readRootStreamIds(
  entries: ReturnType<
    typeof verifyOfficialMarketCalendarOleCompoundFileDirectoryTree
  >["entries"]
): ReadonlySet<number> {
  const root = entries[0];
  if (root === undefined || root.objectType !== "root") {
    throw missingStream();
  }
  const streamIds = new Set<number>();
  const pending = root.childId === null ? [] : [root.childId];
  while (pending.length > 0) {
    const streamId = pending.pop();
    const entry = streamId === undefined ? undefined : entries[streamId];
    if (entry === undefined || entry.streamId !== streamId) {
      throw missingStream();
    }
    if (entry.objectType === "stream") {
      streamIds.add(entry.streamId);
    }
    if (entry.leftSiblingId !== null) {
      pending.push(entry.leftSiblingId);
    }
    if (entry.rightSiblingId !== null) {
      pending.push(entry.rightSiblingId);
    }
  }
  return streamIds;
}

function findRequiredStream(
  streams: readonly ProjectedOfficialMarketCalendarOleUserStreamBytes[],
  name: string
): ProjectedOfficialMarketCalendarOleUserStreamBytes {
  const stream = findOptionalStream(streams, name);
  if (stream === undefined) {
    throw missingStream();
  }
  return stream;
}

function findOptionalStream(
  streams: readonly ProjectedOfficialMarketCalendarOleUserStreamBytes[],
  name: string
): ProjectedOfficialMarketCalendarOleUserStreamBytes | undefined {
  return streams.find((stream) => stream.name === name);
}

function verifyMaximumSize(
  stream: ProjectedOfficialMarketCalendarOleUserStreamBytes
): void {
  if (BigInt(stream.streamSize) > BigInt(WORD_STREAM_MAXIMUM_SIZE)) {
    throw wordError(
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_SIZE",
      "Official calendar KRX legacy Word stream exceeds the format limit."
    );
  }
}

function verifyFibBase(bytes: Uint8Array): {
  nFibBase: number;
  fWhichTblStm: 0 | 1;
} {
  if (bytes.length < FIB_BASE_SIZE) {
    throw invalidFibBase();
  }
  const wIdent = readUint16(bytes, 0);
  const nFibBase = readUint16(bytes, 2);
  const pnNext = readUint16(bytes, 8);
  const flags = readUint16(bytes, 10);
  const fDot = (flags & 0x0001) !== 0;
  const fGlsy = (flags & 0x0002) !== 0;
  const fEncrypted = (flags & 0x0100) !== 0;
  const fWhichTblStm = (flags & 0x0200) === 0 ? 0 : 1;
  const fExtChar = (flags & 0x1000) !== 0;
  const nFibBack = readUint16(bytes, 12);
  const lKey = readUint32(bytes, 14);
  const envr = bytes[18];
  const fMac = (bytes[19]! & 0x01) !== 0;
  const reserved3 = readUint16(bytes, 20);
  const reserved4 = readUint16(bytes, 22);

  if (
    wIdent !== WORD_BINARY_FILE_IDENTIFIER ||
    !fExtChar ||
    (nFibBack !== 0x00bf && nFibBack !== 0x00c1) ||
    envr !== 0 ||
    fMac ||
    reserved3 !== 0 ||
    reserved4 !== 0 ||
    ((!fDot || fGlsy) && pnNext !== 0) ||
    (pnNext !== 0 && pnNext * 512 + FIB_BASE_SIZE > bytes.length) ||
    (!fEncrypted && lKey !== 0)
  ) {
    throw invalidFibBase();
  }
  if (fEncrypted) {
    throw wordError(
      "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PROTECTION_UNSUPPORTED",
      "Official calendar KRX legacy encrypted Word document is unsupported."
    );
  }
  return { nFibBase, fWhichTblStm };
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function missingStream(): OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError {
  return wordError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STREAM_MISSING",
    "Official calendar KRX legacy Word root stream is missing."
  );
}

function invalidFibBase(): OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError {
  return wordError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_BASE_INVALID",
    "Official calendar KRX legacy Word FibBase is invalid."
  );
}

function wordError(
  code: OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsErrorCode,
  message: string
): OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError {
  return new OfficialMarketCalendarKrxLegacyWordBinaryFileStreamsError(
    code,
    message
  );
}
