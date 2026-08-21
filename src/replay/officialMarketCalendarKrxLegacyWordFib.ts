import { verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams } from "./officialMarketCalendarKrxLegacyWordBinaryFileStreams.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_FIB_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_fib.v1";

export type OfficialMarketCalendarKrxLegacyWordFibVersion =
  | "Word97"
  | "Word2000"
  | "Word2002"
  | "Word2003"
  | "Word2007";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordFib {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_FIB_SCHEMA_VERSION;
  nFibBase: number;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  version: OfficialMarketCalendarKrxLegacyWordFibVersion;
  csw: 0x000e;
  cslw: 0x0016;
  cbRgFcLcb: 0x005d | 0x006c | 0x0088 | 0x00a4 | 0x00b7;
  cswNew: 0 | 2 | 5;
  fibByteLength: number;
  tableStreamName: "0Table" | "1Table";
  wordDocumentBytes: Uint8Array;
  tableStreamBytes: Uint8Array;
  fibStructureVerified: true;
  fibFieldStatus: "count_sections_only_not_parsed";
  clxStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordFibErrorCode =
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_STRUCTURE_INVALID"
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_VERSION_INVALID";

export class OfficialMarketCalendarKrxLegacyWordFibError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordFibErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordFibError";
  }
}

interface VersionDefinition {
  nFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib["nFib"];
  version: OfficialMarketCalendarKrxLegacyWordFibVersion;
  cbRgFcLcb: VerifiedOfficialMarketCalendarKrxLegacyWordFib["cbRgFcLcb"];
  cswNew: VerifiedOfficialMarketCalendarKrxLegacyWordFib["cswNew"];
}

const VERSION_DEFINITIONS: readonly VersionDefinition[] = Object.freeze([
  Object.freeze({ nFib: 0x00c1, version: "Word97", cbRgFcLcb: 0x005d, cswNew: 0 }),
  Object.freeze({ nFib: 0x00d9, version: "Word2000", cbRgFcLcb: 0x006c, cswNew: 2 }),
  Object.freeze({ nFib: 0x0101, version: "Word2002", cbRgFcLcb: 0x0088, cswNew: 2 }),
  Object.freeze({ nFib: 0x010c, version: "Word2003", cbRgFcLcb: 0x00a4, cswNew: 2 }),
  Object.freeze({ nFib: 0x0112, version: "Word2007", cbRgFcLcb: 0x00b7, cswNew: 5 })
]);

const FIB_BASE_SIZE = 32;
const FIB_RG_W_WORD_COUNT = 0x000e;
const FIB_RG_LW_DWORD_COUNT = 0x0016;

export function verifyOfficialMarketCalendarKrxLegacyWordFib(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordFib {
  const streams =
    verifyOfficialMarketCalendarKrxLegacyWordBinaryFileStreams(input);
  let returned = false;
  try {
    const bytes = streams.wordDocumentBytes;
    let offset = FIB_BASE_SIZE;

    const csw = readUint16(bytes, offset);
    if (csw !== FIB_RG_W_WORD_COUNT) {
      throw invalidStructure();
    }
    offset = advance(offset + 2, csw, 2, bytes.length);

    const cslw = readUint16(bytes, offset);
    if (cslw !== FIB_RG_LW_DWORD_COUNT) {
      throw invalidStructure();
    }
    offset = advance(offset + 2, cslw, 4, bytes.length);

    const cbRgFcLcb = readUint16(bytes, offset);
    offset = advance(offset + 2, cbRgFcLcb, 8, bytes.length);

    const cswNew = readUint16(bytes, offset);
    const fibRgCswNewOffset = offset + 2;
    offset = advance(fibRgCswNewOffset, cswNew, 2, bytes.length);

    const nFib =
      cswNew === 0
        ? streams.nFibBase
        : readUint16(bytes, fibRgCswNewOffset);
    const definition = VERSION_DEFINITIONS.find(
      (candidate) => candidate.nFib === nFib
    );
    if (
      definition === undefined ||
      definition.cbRgFcLcb !== cbRgFcLcb ||
      definition.cswNew !== cswNew
    ) {
      throw invalidVersion();
    }
    const flags = readUint16(bytes, 10);
    const cQuickSaves = (flags >>> 4) & 0x0f;
    if (definition.nFib >= 0x00d9 && cQuickSaves !== 0x0f) {
      throw invalidVersion();
    }

    const result = Object.freeze({
      schemaVersion: OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_FIB_SCHEMA_VERSION,
      nFibBase: streams.nFibBase,
      nFib: definition.nFib,
      version: definition.version,
      csw: FIB_RG_W_WORD_COUNT,
      cslw: FIB_RG_LW_DWORD_COUNT,
      cbRgFcLcb: definition.cbRgFcLcb,
      cswNew: definition.cswNew,
      fibByteLength: offset,
      tableStreamName: streams.tableStreamName,
      wordDocumentBytes: streams.wordDocumentBytes,
      tableStreamBytes: streams.tableStreamBytes,
      fibStructureVerified: true as const,
      fibFieldStatus: "count_sections_only_not_parsed" as const,
      clxStatus: "not_parsed" as const,
      sourceRoleStatus: "candidate_not_accepted" as const
    });
    returned = true;
    return result;
  } finally {
    if (!returned) {
      zeroizeBytes(streams.wordDocumentBytes);
      zeroizeBytes(streams.tableStreamBytes);
    }
  }
}

function advance(
  offset: number,
  count: number,
  elementSize: number,
  byteLength: number
): number {
  const next = offset + count * elementSize;
  if (!Number.isSafeInteger(next) || offset < 0 || next > byteLength) {
    throw invalidStructure();
  }
  return next;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 > bytes.length) {
    throw invalidStructure();
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

function invalidStructure(): OfficialMarketCalendarKrxLegacyWordFibError {
  return fibError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_STRUCTURE_INVALID",
    "Official calendar KRX legacy Word FIB structure is invalid."
  );
}

function invalidVersion(): OfficialMarketCalendarKrxLegacyWordFibError {
  return fibError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_FIB_VERSION_INVALID",
    "Official calendar KRX legacy Word FIB version is invalid."
  );
}

function fibError(
  code: OfficialMarketCalendarKrxLegacyWordFibErrorCode,
  message: string
): OfficialMarketCalendarKrxLegacyWordFibError {
  return new OfficialMarketCalendarKrxLegacyWordFibError(code, message);
}
