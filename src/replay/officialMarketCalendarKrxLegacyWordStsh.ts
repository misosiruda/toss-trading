import { verifyOfficialMarketCalendarKrxLegacyWordStshfReference } from "./officialMarketCalendarKrxLegacyWordStshfReference.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSH_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_stsh.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordStyleDefinition {
  istd: number;
  cbStd: number;
  stdOffset: number;
  stdBytes: Uint8Array;
  styleDefinitionStatus: "empty" | "framing_only_not_parsed";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordStsh {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSH_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  fcStshf: number;
  lcbStshf: number;
  cbStshi: number;
  cstd: number;
  cbSTDBaseInFile: 0x000a | 0x0012;
  styleDefinitions: readonly VerifiedOfficialMarketCalendarKrxLegacyWordStyleDefinition[];
  stshFramingVerified: true;
  stshiStatus: "fixed_header_verified_optional_fields_not_parsed";
  styleDefinitionsStatus: "length_framed_std_not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordStshErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSH_INVALID";

export class OfficialMarketCalendarKrxLegacyWordStshError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordStshErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordStshError";
  }
}

const LP_STSHI_HEADER_BYTE_LENGTH = 2;
const STSHIF_BYTE_LENGTH = 18;
const LP_STD_HEADER_BYTE_LENGTH = 2;
const MINIMUM_STYLE_DEFINITION_COUNT = 0x000f;
const MAXIMUM_STYLE_DEFINITION_COUNT_EXCLUSIVE = 0x0ffe;
const EMPTY_FIXED_STYLE_INDICES = new Set([13, 14]);

export function verifyOfficialMarketCalendarKrxLegacyWordStsh(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordStsh {
  const reference =
    verifyOfficialMarketCalendarKrxLegacyWordStshfReference(input);
  const ownedStdBytes: Uint8Array[] = [];
  let completed = false;
  try {
    const bytes = reference.stshfBytes;
    const cbStshi = readUint16(bytes, 0);
    const styleDefinitionsOffset = advance(
      LP_STSHI_HEADER_BYTE_LENGTH,
      cbStshi,
      bytes.length
    );
    if (
      cbStshi < STSHIF_BYTE_LENGTH ||
      (reference.fcStshf + styleDefinitionsOffset) % 2 !== 0
    ) {
      throw invalidStsh();
    }

    const cstd = readUint16(bytes, LP_STSHI_HEADER_BYTE_LENGTH);
    const cbSTDBaseInFile = readUint16(
      bytes,
      LP_STSHI_HEADER_BYTE_LENGTH + 2
    );
    const stshifFlags = readUint16(
      bytes,
      LP_STSHI_HEADER_BYTE_LENGTH + 4
    );
    const istdMaxFixedWhenSaved = readUint16(
      bytes,
      LP_STSHI_HEADER_BYTE_LENGTH + 8
    );
    if (
      cstd < MINIMUM_STYLE_DEFINITION_COUNT ||
      cstd >= MAXIMUM_STYLE_DEFINITION_COUNT_EXCLUSIVE ||
      (cbSTDBaseInFile !== 0x000a && cbSTDBaseInFile !== 0x0012) ||
      stshifFlags !== 0x0001 ||
      istdMaxFixedWhenSaved !== MINIMUM_STYLE_DEFINITION_COUNT
    ) {
      throw invalidStsh();
    }

    const styleDefinitions: VerifiedOfficialMarketCalendarKrxLegacyWordStyleDefinition[] =
      [];
    let offset = styleDefinitionsOffset;
    for (let istd = 0; istd < cstd; istd += 1) {
      const cbStd = readInt16(bytes, offset);
      if (cbStd < 0) {
        throw invalidStsh();
      }
      const stdOffset = advance(
        offset,
        LP_STD_HEADER_BYTE_LENGTH,
        bytes.length
      );
      const stdEnd = advance(stdOffset, cbStd, bytes.length);
      if (EMPTY_FIXED_STYLE_INDICES.has(istd) && cbStd !== 0) {
        throw invalidStsh();
      }
      const stdBytes = new Uint8Array(cbStd);
      for (let index = 0; index < cbStd; index += 1) {
        stdBytes[index] = bytes[stdOffset + index]!;
      }
      ownedStdBytes.push(stdBytes);
      styleDefinitions.push(
        Object.freeze({
          istd,
          cbStd,
          stdOffset,
          stdBytes,
          styleDefinitionStatus:
            cbStd === 0 ? "empty" : "framing_only_not_parsed"
        })
      );
      offset = advance(stdEnd, cbStd % 2, bytes.length);
    }
    if (offset !== bytes.length) {
      throw invalidStsh();
    }

    const result = Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSH_SCHEMA_VERSION,
      nFib: reference.nFib,
      tableStreamName: reference.tableStreamName,
      fcStshf: reference.fcStshf,
      lcbStshf: reference.lcbStshf,
      cbStshi,
      cstd,
      cbSTDBaseInFile,
      styleDefinitions: Object.freeze(styleDefinitions),
      stshFramingVerified: true,
      stshiStatus: "fixed_header_verified_optional_fields_not_parsed",
      styleDefinitionsStatus: "length_framed_std_not_parsed",
      sourceRoleStatus: "candidate_not_accepted"
    });
    completed = true;
    return result;
  } finally {
    if (!completed) {
      for (const stdBytes of ownedStdBytes) {
        zeroizeBytes(stdBytes);
      }
    }
    zeroizeBytes(reference.stshfBytes);
  }
}

function advance(offset: number, byteLength: number, limit: number): number {
  const next = offset + byteLength;
  if (!Number.isSafeInteger(next) || offset < 0 || next > limit) {
    throw invalidStsh();
  }
  return next;
}

function readInt16(bytes: Uint8Array, offset: number): number {
  const unsigned = readUint16(bytes, offset);
  return unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidStsh();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function invalidStsh(): OfficialMarketCalendarKrxLegacyWordStshError {
  return new OfficialMarketCalendarKrxLegacyWordStshError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSH_INVALID",
    "Official calendar KRX legacy Word STSH framing is invalid."
  );
}
