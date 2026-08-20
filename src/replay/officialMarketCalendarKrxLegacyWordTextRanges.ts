import { verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts } from "./officialMarketCalendarKrxLegacyWordDocumentCounts.js";
import { verifyOfficialMarketCalendarKrxLegacyWordFib } from "./officialMarketCalendarKrxLegacyWordFib.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPlcPcd } from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_text_ranges.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTextRange {
  index: number;
  cpStart: number;
  cpEnd: number;
  characterCount: number;
  encoding: "compressed_8bit" | "unicode_16le";
  byteStart: number;
  byteLength: number;
  byteEnd: number;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTextRanges {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  cbMac: number;
  ranges: readonly VerifiedOfficialMarketCalendarKrxLegacyWordTextRange[];
  textRangesVerified: true;
  textProjectionStatus: "not_projected";
  textDecodingStatus: "not_decoded";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordTextRangesErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordTextRangesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordTextRangesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordTextRangesError";
  }
}

const CB_MAC_OFFSET = 64;

export function verifyOfficialMarketCalendarKrxLegacyWordTextRanges(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordTextRanges {
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(input);
  const plcPcd = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(input);
  const cbMac = readUint32(fib.wordDocumentBytes, CB_MAC_OFFSET);
  if (cbMac < fib.fibByteLength || cbMac > fib.wordDocumentBytes.length) {
    throw invalidTextRange();
  }

  const ranges = plcPcd.pieces.map((piece) => {
    if (piece.fCompressed && piece.fc % 2 !== 0) {
      throw invalidTextRange();
    }
    const byteStart = piece.fCompressed ? piece.fc / 2 : piece.fc;
    const byteLength = piece.characterCount * (piece.fCompressed ? 1 : 2);
    const byteEnd = byteStart + byteLength;
    if (
      !Number.isSafeInteger(byteStart) ||
      !Number.isSafeInteger(byteLength) ||
      !Number.isSafeInteger(byteEnd) ||
      byteStart < fib.fibByteLength ||
      byteEnd > cbMac
    ) {
      throw invalidTextRange();
    }
    return Object.freeze({
      index: piece.index,
      cpStart: piece.cpStart,
      cpEnd: piece.cpEnd,
      characterCount: piece.characterCount,
      encoding: piece.fCompressed ? "compressed_8bit" : "unicode_16le",
      byteStart,
      byteLength,
      byteEnd
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGES_SCHEMA_VERSION,
    nFib: fib.nFib,
    tableStreamName: fib.tableStreamName,
    cbMac,
    ranges: Object.freeze(ranges),
    textRangesVerified: true,
    textProjectionStatus: "not_projected",
    textDecodingStatus: "not_decoded",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidTextRange();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidTextRange(): OfficialMarketCalendarKrxLegacyWordTextRangesError {
  return new OfficialMarketCalendarKrxLegacyWordTextRangesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_RANGE_INVALID",
    "Official calendar KRX legacy Word text range is invalid."
  );
}
