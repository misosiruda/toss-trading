import {
  verifyOfficialMarketCalendarKrxLegacyWordFib,
  type OfficialMarketCalendarKrxLegacyWordFibVersion,
  type VerifiedOfficialMarketCalendarKrxLegacyWordFib
} from "./officialMarketCalendarKrxLegacyWordFib.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_plc_bte_papx_reference.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_SCHEMA_VERSION;
  nFib: VerifiedOfficialMarketCalendarKrxLegacyWordFib["nFib"];
  version: OfficialMarketCalendarKrxLegacyWordFibVersion;
  tableStreamName: "0Table" | "1Table";
  fcPlcfBtePapx: number;
  lcbPlcfBtePapx: number;
  plcBtePapxBytes: Uint8Array;
  bytesOwnership: "caller_owned_copy";
  plcBtePapxReferenceVerified: true;
  plcBtePapxFramingStatus: "not_parsed";
  papxFkpStatus: "not_parsed";
  paragraphPropertiesStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError";
  }
}

const FIB_RG_FC_LCB_OFFSET = 154;
const PLC_BTE_PAPX_FC_LCB_PAIR_INDEX = 13;
const PLC_BTE_PAPX_FC_OFFSET =
  FIB_RG_FC_LCB_OFFSET + PLC_BTE_PAPX_FC_LCB_PAIR_INDEX * 8;

export function verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference {
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  const fcPlcfBtePapx = readUint32(
    fib.wordDocumentBytes,
    PLC_BTE_PAPX_FC_OFFSET
  );
  const lcbPlcfBtePapx = readUint32(
    fib.wordDocumentBytes,
    PLC_BTE_PAPX_FC_OFFSET + 4
  );
  const plcBtePapxEnd = fcPlcfBtePapx + lcbPlcfBtePapx;
  if (
    fcPlcfBtePapx === 0 ||
    lcbPlcfBtePapx === 0 ||
    !Number.isSafeInteger(plcBtePapxEnd) ||
    plcBtePapxEnd > fib.tableStreamBytes.length
  ) {
    throw invalidReference();
  }
  const plcBtePapxBytes = new Uint8Array(lcbPlcfBtePapx);
  for (let index = 0; index < lcbPlcfBtePapx; index += 1) {
    plcBtePapxBytes[index] = fib.tableStreamBytes[fcPlcfBtePapx + index]!;
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_SCHEMA_VERSION,
    nFib: fib.nFib,
    version: fib.version,
    tableStreamName: fib.tableStreamName,
    fcPlcfBtePapx,
    lcbPlcfBtePapx,
    plcBtePapxBytes,
    bytesOwnership: "caller_owned_copy",
    plcBtePapxReferenceVerified: true,
    plcBtePapxFramingStatus: "not_parsed",
    papxFkpStatus: "not_parsed",
    paragraphPropertiesStatus: "not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidReference();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidReference(): OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError {
  return new OfficialMarketCalendarKrxLegacyWordPlcBtePapxReferenceError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_REFERENCE_INVALID",
    "Official calendar KRX legacy Word PlcBtePapx reference is invalid."
  );
}
