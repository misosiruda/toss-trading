import { verifyOfficialMarketCalendarKrxLegacyWordFib } from "./officialMarketCalendarKrxLegacyWordFib.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx } from "./officialMarketCalendarKrxLegacyWordPlcBtePapx.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_papx_fkp_references.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkpReference {
  index: number;
  fcStart: number;
  fcEnd: number;
  pn: number;
  fkpByteOffset: number;
  fkpByteLength: 512;
  fkpBytes: Uint8Array;
  bytesOwnership: "caller_owned_copy";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkpReferences {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  cbMac: number;
  references: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkpReference[];
  papxFkpReferencesVerified: true;
  papxFkpFramingStatus: "not_parsed";
  papxStatus: "not_parsed";
  paragraphPropertiesStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError";
  }
}

const CB_MAC_OFFSET = 64;
const FKP_BYTE_LENGTH = 512;

export function verifyOfficialMarketCalendarKrxLegacyWordPapxFkpReferences(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkpReferences {
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  const plcBtePapx = verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx(input);
  const cbMac = readUint32(fib.wordDocumentBytes, CB_MAC_OFFSET);
  if (
    cbMac < fib.fibByteLength ||
    cbMac > fib.wordDocumentBytes.length ||
    plcBtePapx.entries.length === 0 ||
    plcBtePapx.fileOffsets.some((fc) => fc > cbMac)
  ) {
    throw invalidFkpReference();
  }
  const references = plcBtePapx.entries.map((entry) => {
    const fkpByteEnd = entry.fkpByteOffset + FKP_BYTE_LENGTH;
    if (
      !Number.isSafeInteger(fkpByteEnd) ||
      entry.fkpByteOffset < fib.fibByteLength ||
      fkpByteEnd > cbMac ||
      fkpByteEnd > fib.wordDocumentBytes.length
    ) {
      throw invalidFkpReference();
    }
    const fkpBytes = new Uint8Array(FKP_BYTE_LENGTH);
    for (let index = 0; index < FKP_BYTE_LENGTH; index += 1) {
      fkpBytes[index] = fib.wordDocumentBytes[entry.fkpByteOffset + index]!;
    }
    return Object.freeze({
      index: entry.index,
      fcStart: entry.fcStart,
      fcEnd: entry.fcEnd,
      pn: entry.pn,
      fkpByteOffset: entry.fkpByteOffset,
      fkpByteLength: FKP_BYTE_LENGTH as 512,
      fkpBytes,
      bytesOwnership: "caller_owned_copy" as const
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCES_SCHEMA_VERSION,
    nFib: fib.nFib,
    tableStreamName: fib.tableStreamName,
    cbMac,
    references: Object.freeze(references),
    papxFkpReferencesVerified: true,
    papxFkpFramingStatus: "not_parsed",
    papxStatus: "not_parsed",
    paragraphPropertiesStatus: "not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidFkpReference();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidFkpReference(): OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError {
  return new OfficialMarketCalendarKrxLegacyWordPapxFkpReferencesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_REFERENCE_INVALID",
    "Official calendar KRX legacy Word PapxFkp reference is invalid."
  );
}
