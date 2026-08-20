import { verifyOfficialMarketCalendarKrxLegacyWordClxReference } from "./officialMarketCalendarKrxLegacyWordClxReference.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_clx.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordClx {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  fcClx: number;
  lcbClx: number;
  prcCount: number;
  prcByteLength: number;
  pcdtOffset: number;
  plcPcdByteLength: number;
  pieceDescriptorCount: number;
  plcPcdBytes: Uint8Array;
  clxFramingVerified: true;
  plcPcdStatus: "framing_only_entries_not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordClxErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_INVALID";

export class OfficialMarketCalendarKrxLegacyWordClxError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordClxErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordClxError";
  }
}

const PRC_MARKER = 0x01;
const PCDT_MARKER = 0x02;
const PRC_HEADER_SIZE = 3;
const MAXIMUM_GRPPRL_SIZE = 0x3fa2;
const PCDT_HEADER_SIZE = 5;
const CP_SIZE = 4;
const PCD_SIZE = 8;

export function verifyOfficialMarketCalendarKrxLegacyWordClx(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordClx {
  const reference =
    verifyOfficialMarketCalendarKrxLegacyWordClxReference(input);
  const bytes = reference.clxBytes;
  let offset = 0;
  let prcCount = 0;

  while (bytes[offset] === PRC_MARKER) {
    const grpprlSize = readInt16(bytes, offset + 1);
    if (grpprlSize < 0 || grpprlSize > MAXIMUM_GRPPRL_SIZE) {
      throw invalidClx();
    }
    offset = advance(offset, PRC_HEADER_SIZE + grpprlSize, bytes.length);
    prcCount += 1;
  }

  const pcdtOffset = offset;
  if (bytes[offset] !== PCDT_MARKER) {
    throw invalidClx();
  }
  const plcPcdByteLength = readUint32(bytes, offset + 1);
  offset = advance(offset, PCDT_HEADER_SIZE, bytes.length);
  const plcPcdEnd = advance(offset, plcPcdByteLength, bytes.length);
  if (
    plcPcdEnd !== bytes.length ||
    plcPcdByteLength < CP_SIZE ||
    (plcPcdByteLength - CP_SIZE) % (CP_SIZE + PCD_SIZE) !== 0
  ) {
    throw invalidClx();
  }
  const pieceDescriptorCount =
    (plcPcdByteLength - CP_SIZE) / (CP_SIZE + PCD_SIZE);
  const plcPcdBytes = new Uint8Array(plcPcdByteLength);
  for (let index = 0; index < plcPcdByteLength; index += 1) {
    plcPcdBytes[index] = bytes[offset + index]!;
  }

  return Object.freeze({
    schemaVersion: OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_SCHEMA_VERSION,
    nFib: reference.nFib,
    tableStreamName: reference.tableStreamName,
    fcClx: reference.fcClx,
    lcbClx: reference.lcbClx,
    prcCount,
    prcByteLength: pcdtOffset,
    pcdtOffset,
    plcPcdByteLength,
    pieceDescriptorCount,
    plcPcdBytes,
    clxFramingVerified: true,
    plcPcdStatus: "framing_only_entries_not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function advance(offset: number, byteLength: number, limit: number): number {
  const next = offset + byteLength;
  if (!Number.isSafeInteger(next) || offset < 0 || next > limit) {
    throw invalidClx();
  }
  return next;
}

function readInt16(bytes: Uint8Array, offset: number): number {
  const unsigned = readUint16(bytes, offset);
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidClx();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidClx();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidClx(): OfficialMarketCalendarKrxLegacyWordClxError {
  return new OfficialMarketCalendarKrxLegacyWordClxError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_INVALID",
    "Official calendar KRX legacy Word CLX framing is invalid."
  );
}
