import { projectOfficialMarketCalendarKrxLegacyWordTextBytes } from "./officialMarketCalendarKrxLegacyWordTextBytes.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_text_decoding.v1";

export interface DecodedOfficialMarketCalendarKrxLegacyWordTextPiece {
  index: number;
  cpStart: number;
  cpEnd: number;
  characterCount: number;
  encoding: "compressed_8bit" | "unicode_16le";
  byteStart: number;
  byteLength: number;
  byteEnd: number;
  text: string;
  decodedCodeUnitCount: number;
}

export interface DecodedOfficialMarketCalendarKrxLegacyWordText {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  cbMac: number;
  finalCp: number;
  pieces: readonly DecodedOfficialMarketCalendarKrxLegacyWordTextPiece[];
  text: string;
  decodedCodeUnitCount: number;
  textDecoded: true;
  tableSemanticsStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordTextDecodingErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_INVALID";

export class OfficialMarketCalendarKrxLegacyWordTextDecodingError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordTextDecodingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordTextDecodingError";
  }
}

const CODE_UNIT_CHUNK_SIZE = 8192;
const stringFromCharCode = String.fromCharCode;

export function decodeOfficialMarketCalendarKrxLegacyWordText(
  input: Uint8Array
): DecodedOfficialMarketCalendarKrxLegacyWordText {
  const projected = projectOfficialMarketCalendarKrxLegacyWordTextBytes(input);
  try {
    const pieces = projected.pieces.map((piece) => {
      const text =
        piece.encoding === "unicode_16le"
          ? decodeUnicode16Le(piece.bytes, piece.characterCount)
          : decodeCompressed8Bit(piece.bytes, piece.characterCount);
      if (text.length !== piece.characterCount) {
        throw invalidDecoding();
      }
      return Object.freeze({
        index: piece.index,
        cpStart: piece.cpStart,
        cpEnd: piece.cpEnd,
        characterCount: piece.characterCount,
        encoding: piece.encoding,
        byteStart: piece.byteStart,
        byteLength: piece.byteLength,
        byteEnd: piece.byteEnd,
        text,
        decodedCodeUnitCount: text.length
      });
    });
    const text = pieces.map((piece) => piece.text).join("");
    const finalCp = pieces.at(-1)?.cpEnd ?? 0;
    if (text.length !== finalCp) {
      throw invalidDecoding();
    }
    return Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_SCHEMA_VERSION,
      nFib: projected.nFib,
      tableStreamName: projected.tableStreamName,
      cbMac: projected.cbMac,
      finalCp,
      pieces: Object.freeze(pieces),
      text,
      decodedCodeUnitCount: text.length,
      textDecoded: true,
      tableSemanticsStatus: "not_parsed",
      sourceRoleStatus: "candidate_not_accepted"
    });
  } catch (error) {
    if (error instanceof OfficialMarketCalendarKrxLegacyWordTextDecodingError) {
      throw error;
    }
    throw invalidDecoding();
  }
}

function decodeUnicode16Le(bytes: Uint8Array, characterCount: number): string {
  if (bytes.byteLength !== characterCount * 2) {
    throw invalidDecoding();
  }
  return decodeCodeUnits(characterCount, (index) =>
    bytes[index * 2]! | (bytes[index * 2 + 1]! << 8)
  );
}

function decodeCompressed8Bit(
  bytes: Uint8Array,
  characterCount: number
): string {
  if (bytes.byteLength !== characterCount) {
    throw invalidDecoding();
  }
  return decodeCodeUnits(characterCount, (index) =>
    mapCompressedCodeUnit(bytes[index]!)
  );
}

function decodeCodeUnits(
  count: number,
  readCodeUnit: (index: number) => number
): string {
  const chunks: string[] = [];
  const codeUnits: number[] = [];
  for (let index = 0; index < count; index += 1) {
    codeUnits.push(readCodeUnit(index));
    if (codeUnits.length === CODE_UNIT_CHUNK_SIZE) {
      chunks.push(stringFromCharCode(...codeUnits));
      codeUnits.length = 0;
    }
  }
  if (codeUnits.length !== 0) {
    chunks.push(stringFromCharCode(...codeUnits));
  }
  return chunks.join("");
}

function mapCompressedCodeUnit(value: number): number {
  switch (value) {
    case 0x82:
      return 0x201a;
    case 0x83:
      return 0x0192;
    case 0x84:
      return 0x201e;
    case 0x85:
      return 0x2026;
    case 0x86:
      return 0x2020;
    case 0x87:
      return 0x2021;
    case 0x88:
      return 0x02c6;
    case 0x89:
      return 0x2030;
    case 0x8a:
      return 0x0160;
    case 0x8b:
      return 0x2039;
    case 0x8c:
      return 0x0152;
    case 0x91:
      return 0x2018;
    case 0x92:
      return 0x2019;
    case 0x93:
      return 0x201c;
    case 0x94:
      return 0x201d;
    case 0x95:
      return 0x2022;
    case 0x96:
      return 0x2013;
    case 0x97:
      return 0x2014;
    case 0x98:
      return 0x02dc;
    case 0x99:
      return 0x2122;
    case 0x9a:
      return 0x0161;
    case 0x9b:
      return 0x203a;
    case 0x9c:
      return 0x0153;
    case 0x9f:
      return 0x0178;
    default:
      return value;
  }
}

function invalidDecoding(): OfficialMarketCalendarKrxLegacyWordTextDecodingError {
  return new OfficialMarketCalendarKrxLegacyWordTextDecodingError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_DECODING_INVALID",
    "Official calendar KRX legacy Word text cannot be decoded safely."
  );
}
