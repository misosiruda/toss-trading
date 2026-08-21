import { verifyOfficialMarketCalendarKrxLegacyWordFib } from "./officialMarketCalendarKrxLegacyWordFib.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPlcPcd } from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_document_counts.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordDocumentCounts {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_SCHEMA_VERSION;
  ccpText: number;
  ccpFtn: number;
  ccpHdd: number;
  ccpAtn: number;
  ccpEdn: number;
  ccpTxbx: number;
  ccpHdrTxbx: number;
  hasSubdocuments: boolean;
  finalCp: number;
  documentCountsVerified: true;
  textRangeStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordDocumentCountsErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_INVALID";

export class OfficialMarketCalendarKrxLegacyWordDocumentCountsError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordDocumentCountsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordDocumentCountsError";
  }
}

const COUNT_OFFSETS = [76, 80, 84, 92, 96, 100, 104] as const;
const RESERVED3_OFFSET = 88;
const MAXIMUM_CP = 0x7ffffffe;

export function verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordDocumentCounts {
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  try {
    const plcPcd = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(input);
    const counts = COUNT_OFFSETS.map((offset) =>
      readInt32(fib.wordDocumentBytes, offset)
    );
    if (
      counts.some((count) => count < 0) ||
      readUint32(fib.wordDocumentBytes, RESERVED3_OFFSET) !== 0
    ) {
      throw invalidCounts();
    }
    const [
      ccpText,
      ccpFtn,
      ccpHdd,
      ccpAtn,
      ccpEdn,
      ccpTxbx,
      ccpHdrTxbx
    ] = counts as [number, number, number, number, number, number, number];
    const subdocumentTotal =
      ccpFtn + ccpHdd + ccpAtn + ccpEdn + ccpTxbx + ccpHdrTxbx;
    const hasSubdocuments = subdocumentTotal !== 0;
    const expectedFinalCp =
      ccpText + subdocumentTotal + (hasSubdocuments ? 1 : 0);
    const finalCp = plcPcd.characterPositions.at(-1)!;
    if (
      !Number.isSafeInteger(expectedFinalCp) ||
      expectedFinalCp > MAXIMUM_CP ||
      finalCp !== expectedFinalCp
    ) {
      throw invalidCounts();
    }

    return Object.freeze({
      schemaVersion:
        OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_SCHEMA_VERSION,
      ccpText,
      ccpFtn,
      ccpHdd,
      ccpAtn,
      ccpEdn,
      ccpTxbx,
      ccpHdrTxbx,
      hasSubdocuments,
      finalCp,
      documentCountsVerified: true,
      textRangeStatus: "not_verified",
      sourceRoleStatus: "candidate_not_accepted"
    });
  } finally {
    zeroizeBytes(fib.wordDocumentBytes);
    zeroizeBytes(fib.tableStreamBytes);
  }
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return readUint32(bytes, offset) | 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidCounts();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidCounts(): OfficialMarketCalendarKrxLegacyWordDocumentCountsError {
  return new OfficialMarketCalendarKrxLegacyWordDocumentCountsError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_COUNTS_INVALID",
    "Official calendar KRX legacy Word document counts are invalid."
  );
}
