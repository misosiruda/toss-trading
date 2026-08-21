import {
  verifyOfficialMarketCalendarKrxLegacyWordFib,
  type OfficialMarketCalendarKrxLegacyWordFibVersion,
  type VerifiedOfficialMarketCalendarKrxLegacyWordFib
} from "./officialMarketCalendarKrxLegacyWordFib.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_stshf_reference.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordStshfReference {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_SCHEMA_VERSION;
  nFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib["nFib"];
  version: OfficialMarketCalendarKrxLegacyWordFibVersion;
  tableStreamName: "0Table" | "1Table";
  fcStshf: number;
  lcbStshf: number;
  stshfBytes: Uint8Array;
  stshfReferenceVerified: true;
  stshfParserStatus: "reference_only_not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordStshfReferenceErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordStshfReferenceError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordStshfReferenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordStshfReferenceError";
  }
}

const FIB_RG_FC_LCB_OFFSET = 154;
const STSHF_FC_LCB_PAIR_INDEX = 1;
const STSHF_FC_OFFSET =
  FIB_RG_FC_LCB_OFFSET + STSHF_FC_LCB_PAIR_INDEX * 8;

export function verifyOfficialMarketCalendarKrxLegacyWordStshfReference(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordStshfReference {
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  try {
    const fcStshf = readUint32(fib.wordDocumentBytes, STSHF_FC_OFFSET);
    const lcbStshf = readUint32(fib.wordDocumentBytes, STSHF_FC_OFFSET + 4);
    const stshfEnd = fcStshf + lcbStshf;
    if (
      lcbStshf === 0 ||
      !Number.isSafeInteger(stshfEnd) ||
      stshfEnd > fib.tableStreamBytes.length
    ) {
      throw invalidStshfReference();
    }
    const stshfBytes = new Uint8Array(lcbStshf);
    for (let index = 0; index < lcbStshf; index += 1) {
      stshfBytes[index] = fib.tableStreamBytes[fcStshf + index]!;
    }

    return Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_SCHEMA_VERSION,
      nFib: fib.nFib,
      version: fib.version,
      tableStreamName: fib.tableStreamName,
      fcStshf,
      lcbStshf,
      stshfBytes,
      stshfReferenceVerified: true,
      stshfParserStatus: "reference_only_not_parsed",
      sourceRoleStatus: "candidate_not_accepted"
    });
  } finally {
    zeroizeBytes(fib.wordDocumentBytes);
    zeroizeBytes(fib.tableStreamBytes);
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidStshfReference();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function invalidStshfReference(): OfficialMarketCalendarKrxLegacyWordStshfReferenceError {
  return new OfficialMarketCalendarKrxLegacyWordStshfReferenceError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_STSHF_REFERENCE_INVALID",
    "Official calendar KRX legacy Word Stshf reference is invalid."
  );
}
