import {
  OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION,
  resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy
} from "./officialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy.js";
import type { VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity } from "./officialMarketCalendarKrxLegacyDocumentIdentity.js";
import { verifyOfficialMarketCalendarKrxLegacyWordMainDocument } from "./officialMarketCalendarKrxLegacyWordMainDocument.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_document_title.v1";

export interface OfficialMarketCalendarKrxLegacyWordDocumentTitleInput {
  fileName: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity["fileName"];
  rawDocumentBytes: Uint8Array;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordDocumentTitle {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_SCHEMA_VERSION;
  fileName: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity["fileName"];
  targetYear: VerifiedOfficialMarketCalendarKrxLegacyDocumentIdentity["targetYear"];
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  expectedDocumentTitle: string;
  titleCpStart: number;
  titleCpEnd: number;
  titleOccurrenceCount: 1;
  titleBindingVerified: true;
  columnSemanticsStatus: "not_interpreted";
  holidaySemanticsStatus: "not_interpreted";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordDocumentTitleErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_INVALID";

export class OfficialMarketCalendarKrxLegacyWordDocumentTitleError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordDocumentTitleErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordDocumentTitleError";
  }
}

export function verifyOfficialMarketCalendarKrxLegacyWordDocumentTitle(
  input: OfficialMarketCalendarKrxLegacyWordDocumentTitleInput
): VerifiedOfficialMarketCalendarKrxLegacyWordDocumentTitle {
  const policy =
    resolveRegisteredOfficialMarketCalendarKrxLegacyDerivativesCalendarSourcePolicy(
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_DERIVATIVES_CALENDAR_SOURCE_POLICY_VERSION
    );
  const registeredDocument = policy.documents.find(
    (document) => document.fileName === input.fileName
  );
  if (registeredDocument === undefined) {
    throw invalidDocumentTitle();
  }

  const mainDocument =
    verifyOfficialMarketCalendarKrxLegacyWordMainDocument(
      input.rawDocumentBytes
    );
  const titleRanges = findExactParagraphRanges(
    mainDocument.mainDocumentText,
    registeredDocument.observedDocumentTitle
  );
  if (titleRanges.length !== 1) {
    throw invalidDocumentTitle();
  }
  const titleRange = titleRanges[0]!;

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_SCHEMA_VERSION,
    fileName: registeredDocument.fileName,
    targetYear: registeredDocument.targetYear,
    nFib: mainDocument.nFib,
    tableStreamName: mainDocument.tableStreamName,
    expectedDocumentTitle: registeredDocument.observedDocumentTitle,
    titleCpStart: titleRange.cpStart,
    titleCpEnd: titleRange.cpEnd,
    titleOccurrenceCount: 1,
    titleBindingVerified: true,
    columnSemanticsStatus: "not_interpreted",
    holidaySemanticsStatus: "not_interpreted",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function findExactParagraphRanges(
  text: string,
  expectedParagraph: string
): readonly { cpStart: number; cpEnd: number }[] {
  const ranges: { cpStart: number; cpEnd: number }[] = [];
  let searchStart = 0;
  while (searchStart <= text.length - expectedParagraph.length) {
    const cpStart = text.indexOf(expectedParagraph, searchStart);
    if (cpStart < 0) break;
    const cpEnd = cpStart + expectedParagraph.length;
    if (
      (cpStart === 0 || text.charCodeAt(cpStart - 1) === 0x000d) &&
      text.charCodeAt(cpEnd) === 0x000d
    ) {
      ranges.push({ cpStart, cpEnd });
    }
    searchStart = cpStart + 1;
  }
  return ranges;
}

function invalidDocumentTitle(): OfficialMarketCalendarKrxLegacyWordDocumentTitleError {
  return new OfficialMarketCalendarKrxLegacyWordDocumentTitleError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DOCUMENT_TITLE_INVALID",
    "Official calendar KRX legacy Word document title is invalid."
  );
}
