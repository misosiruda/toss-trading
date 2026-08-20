import { verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts } from "./officialMarketCalendarKrxLegacyWordDocumentCounts.js";
import { decodeOfficialMarketCalendarKrxLegacyWordText } from "./officialMarketCalendarKrxLegacyWordTextDecoding.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_main_document.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordMainDocument {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  mainDocumentCpStart: 0;
  mainDocumentCpEnd: number;
  mainDocumentCharacterCount: number;
  mainDocumentText: string;
  mainDocumentParagraphMarkVerified: true;
  hasSubdocuments: boolean;
  finalCp: number;
  terminalGuardCp: number | null;
  terminalGuardStatus: "verified_paragraph_mark" | "not_applicable";
  mainDocumentVerified: true;
  subdocumentProjectionStatus: "not_projected";
  tableSemanticsStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordMainDocumentErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_INVALID";

export class OfficialMarketCalendarKrxLegacyWordMainDocumentError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordMainDocumentErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordMainDocumentError";
  }
}

const PARAGRAPH_MARK = 0x000d;

export function verifyOfficialMarketCalendarKrxLegacyWordMainDocument(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordMainDocument {
  const counts = verifyOfficialMarketCalendarKrxLegacyWordDocumentCounts(input);
  const decoded = decodeOfficialMarketCalendarKrxLegacyWordText(input);
  if (
    counts.ccpText < 1 ||
    decoded.finalCp !== counts.finalCp ||
    decoded.text.length !== counts.finalCp
  ) {
    throw invalidMainDocument();
  }
  const mainDocumentText = decoded.text.slice(0, counts.ccpText);
  if (
    mainDocumentText.length !== counts.ccpText ||
    mainDocumentText.charCodeAt(mainDocumentText.length - 1) !== PARAGRAPH_MARK
  ) {
    throw invalidMainDocument();
  }
  const terminalGuardCp = counts.hasSubdocuments ? counts.finalCp - 1 : null;
  if (
    terminalGuardCp !== null &&
    decoded.text.charCodeAt(terminalGuardCp) !== PARAGRAPH_MARK
  ) {
    throw invalidMainDocument();
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_SCHEMA_VERSION,
    nFib: decoded.nFib,
    tableStreamName: decoded.tableStreamName,
    mainDocumentCpStart: 0,
    mainDocumentCpEnd: counts.ccpText,
    mainDocumentCharacterCount: counts.ccpText,
    mainDocumentText,
    mainDocumentParagraphMarkVerified: true,
    hasSubdocuments: counts.hasSubdocuments,
    finalCp: counts.finalCp,
    terminalGuardCp,
    terminalGuardStatus: counts.hasSubdocuments
      ? "verified_paragraph_mark"
      : "not_applicable",
    mainDocumentVerified: true,
    subdocumentProjectionStatus: "not_projected",
    tableSemanticsStatus: "not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function invalidMainDocument(): OfficialMarketCalendarKrxLegacyWordMainDocumentError {
  return new OfficialMarketCalendarKrxLegacyWordMainDocumentError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_MAIN_DOCUMENT_INVALID",
    "Official calendar KRX legacy Word main document is invalid."
  );
}
