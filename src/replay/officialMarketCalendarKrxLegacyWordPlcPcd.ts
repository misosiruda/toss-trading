import { verifyOfficialMarketCalendarKrxLegacyWordClx } from "./officialMarketCalendarKrxLegacyWordClx.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_plc_pcd.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPieceDescriptor {
  index: number;
  cpStart: number;
  cpEnd: number;
  characterCount: number;
  fNoParaLast: boolean;
  fc: number;
  fCompressed: boolean;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  characterPositions: readonly number[];
  pieces: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPieceDescriptor[];
  plcPcdVerified: true;
  documentTotalStatus: "not_verified_against_fib_rg_lw";
  textRangeStatus: "not_verified";
  prmStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPlcPcdErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPlcPcdError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPlcPcdErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPlcPcdError";
  }
}

const CP_SIZE = 4;
const PCD_SIZE = 8;
const PCD_F_DIRTY_MASK = 0x0004;
const FC_MASK = 0x3fffffff;
const FC_COMPRESSED_MASK = 0x40000000;
const FC_RESERVED_MASK = 0x80000000;

export function verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPlcPcd {
  const clx = verifyOfficialMarketCalendarKrxLegacyWordClx(input);
  try {
    const bytes = clx.plcPcdBytes;
    const cpCount = clx.pieceDescriptorCount + 1;
    const pcdOffset = cpCount * CP_SIZE;
    const characterPositions: number[] = [];

    for (let index = 0; index < cpCount; index += 1) {
      const cp = readInt32(bytes, index * CP_SIZE);
      if (
        cp < 0 ||
        (index === 0 && cp !== 0) ||
        (index > 0 && cp <= characterPositions[index - 1]!)
      ) {
        throw invalidPlcPcd();
      }
      characterPositions.push(cp);
    }

    const pieces: VerifiedOfficialMarketCalendarKrxLegacyWordPieceDescriptor[] = [];
    for (let index = 0; index < clx.pieceDescriptorCount; index += 1) {
      const offset = pcdOffset + index * PCD_SIZE;
      const flags = readUint16(bytes, offset);
      const fcCompressed = readUint32(bytes, offset + 2);
      if (
        (flags & PCD_F_DIRTY_MASK) !== 0 ||
        (fcCompressed & FC_RESERVED_MASK) !== 0
      ) {
        throw invalidPlcPcd();
      }
      const cpStart = characterPositions[index]!;
      const cpEnd = characterPositions[index + 1]!;
      pieces.push(
        Object.freeze({
          index,
          cpStart,
          cpEnd,
          characterCount: cpEnd - cpStart,
          fNoParaLast: (flags & 0x0001) !== 0,
          fc: fcCompressed & FC_MASK,
          fCompressed: (fcCompressed & FC_COMPRESSED_MASK) !== 0
        })
      );
    }

    return Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_SCHEMA_VERSION,
      nFib: clx.nFib,
      tableStreamName: clx.tableStreamName,
      characterPositions: Object.freeze(characterPositions),
      pieces: Object.freeze(pieces),
      plcPcdVerified: true,
      documentTotalStatus: "not_verified_against_fib_rg_lw",
      textRangeStatus: "not_verified",
      prmStatus: "not_parsed",
      sourceRoleStatus: "candidate_not_accepted"
    });
  } finally {
    try {
      Uint8Array.prototype.fill.call(clx.plcPcdBytes, 0);
    } catch {
      // A detached caller-owned projection has no remaining bytes to clear.
    }
  }
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return readUint32(bytes, offset) | 0;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidPlcPcd();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidPlcPcd();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidPlcPcd(): OfficialMarketCalendarKrxLegacyWordPlcPcdError {
  return new OfficialMarketCalendarKrxLegacyWordPlcPcdError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_PCD_INVALID",
    "Official calendar KRX legacy Word PlcPcd is invalid."
  );
}
