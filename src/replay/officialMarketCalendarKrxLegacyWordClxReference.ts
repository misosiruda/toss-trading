import {
  verifyOfficialMarketCalendarKrxLegacyWordFib,
  type OfficialMarketCalendarKrxLegacyWordFibVersion,
  type VerifiedOfficialMarketCalendarKrxLegacyWordFib
} from "./officialMarketCalendarKrxLegacyWordFib.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_clx_reference.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordClxReference {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_SCHEMA_VERSION;
  nFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib["nFib"];
  version: OfficialMarketCalendarKrxLegacyWordFibVersion;
  tableStreamName: "0Table" | "1Table";
  fcClx: number;
  lcbClx: number;
  clxBytes: Uint8Array;
  clxReferenceVerified: true;
  clxParserStatus: "reference_only_not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordClxReferenceErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordClxReferenceError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordClxReferenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordClxReferenceError";
  }
}

const FIB_RG_FC_LCB_OFFSET = 154;
const CLX_FC_LCB_PAIR_INDEX = 33;
const CLX_FC_OFFSET = FIB_RG_FC_LCB_OFFSET + CLX_FC_LCB_PAIR_INDEX * 8;

export function verifyOfficialMarketCalendarKrxLegacyWordClxReference(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordClxReference {
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  const fcClx = readUint32(fib.wordDocumentBytes, CLX_FC_OFFSET);
  const lcbClx = readUint32(fib.wordDocumentBytes, CLX_FC_OFFSET + 4);
  const clxEnd = fcClx + lcbClx;
  if (
    lcbClx === 0 ||
    !Number.isSafeInteger(clxEnd) ||
    clxEnd > fib.tableStreamBytes.length
  ) {
    throw invalidClxReference();
  }
  const clxBytes = new Uint8Array(lcbClx);
  for (let index = 0; index < lcbClx; index += 1) {
    clxBytes[index] = fib.tableStreamBytes[fcClx + index]!;
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_SCHEMA_VERSION,
    nFib: fib.nFib,
    version: fib.version,
    tableStreamName: fib.tableStreamName,
    fcClx,
    lcbClx,
    clxBytes,
    clxReferenceVerified: true,
    clxParserStatus: "reference_only_not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidClxReference();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidClxReference(): OfficialMarketCalendarKrxLegacyWordClxReferenceError {
  return new OfficialMarketCalendarKrxLegacyWordClxReferenceError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_CLX_REFERENCE_INVALID",
    "Official calendar KRX legacy Word CLX reference is invalid."
  );
}
