import { verifyOfficialMarketCalendarKrxLegacyWordMainDocument } from "./officialMarketCalendarKrxLegacyWordMainDocument.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPapxFkp } from "./officialMarketCalendarKrxLegacyWordPapxFkp.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPlcPcd } from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";
import { verifyOfficialMarketCalendarKrxLegacyWordTextRanges } from "./officialMarketCalendarKrxLegacyWordTextRanges.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARIES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_paragraph_boundaries.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordParagraphBoundary {
  index: number;
  cpStart: number;
  cpEnd: number;
  characterCount: number;
  markCp: number;
  markCodeUnit: 0x0007 | 0x000c | 0x000d;
  markKind: "cell_or_ttp_mark" | "section_mark" | "paragraph_mark";
  startPieceIndex: number;
  endPieceIndex: number;
  spansMultiplePieces: boolean;
  terminalPapxPageIndex: number;
  terminalPapxParagraphIndex: number;
  terminalPapxFcStart: number;
  terminalPapxFcEnd: number;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordParagraphBoundaries {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARIES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  mainDocumentCpStart: 0;
  mainDocumentCpEnd: number;
  paragraphs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordParagraphBoundary[];
  paragraphBoundaryAlgorithm: "ms_doc_2_4_2_piece_aware";
  paragraphBoundaryMarksVerified: true;
  pcdPrmStatus: "not_applied_not_required_for_boundaries";
  tablePropertyBindingStatus: "terminal_papx_identified_properties_not_applied";
  tableRowCellBoundaryStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordParagraphBoundariesErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARY_INVALID";

export class OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordParagraphBoundariesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError";
  }
}

const CELL_OR_TTP_MARK = 0x0007;
const SECTION_MARK = 0x000c;
const PARAGRAPH_MARK = 0x000d;

export function verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordParagraphBoundaries {
  const mainDocument =
    verifyOfficialMarketCalendarKrxLegacyWordMainDocument(input);
  const textRanges = verifyOfficialMarketCalendarKrxLegacyWordTextRanges(input);
  const plcPcd = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(input);
  const papxFkp = verifyOfficialMarketCalendarKrxLegacyWordPapxFkp(input);
  const papxParagraphs = papxFkp.pages.flatMap((page) =>
    page.paragraphs.map((paragraph) => ({
      pageIndex: page.index,
      paragraphIndex: paragraph.paragraphIndex,
      fcStart: paragraph.fcStart,
      fcEnd: paragraph.fcEnd
    }))
  );
  const paragraphs: VerifiedOfficialMarketCalendarKrxLegacyWordParagraphBoundary[] = [];
  let cpStart: number = mainDocument.mainDocumentCpStart;

  while (cpStart < mainDocument.mainDocumentCpEnd) {
    const startPieceIndex = findPieceIndex(textRanges.ranges, cpStart);
    if (startPieceIndex < 0) {
      throw invalidParagraphBoundary();
    }
    let pieceIndex = startPieceIndex;
    let searchCp: number = cpStart;
    let boundary:
      | {
          cpEnd: number;
          pageIndex: number;
          paragraphIndex: number;
          fcStart: number;
          fcEnd: number;
        }
      | undefined;

    while (pieceIndex < textRanges.ranges.length) {
      const range = textRanges.ranges[pieceIndex]!;
      const piece = plcPcd.pieces[pieceIndex]!;
      if (
        range.index !== piece.index ||
        searchCp < range.cpStart ||
        searchCp >= range.cpEnd
      ) {
        throw invalidParagraphBoundary();
      }
      const byteWidth = range.encoding === "compressed_8bit" ? 1 : 2;
      const fc = range.byteStart + (searchCp - range.cpStart) * byteWidth;
      const terminalPapx = papxParagraphs.find(
        (paragraph) => paragraph.fcStart <= fc && fc < paragraph.fcEnd
      );
      if (terminalPapx === undefined) {
        throw invalidParagraphBoundary();
      }
      if (terminalPapx.fcEnd <= range.byteEnd) {
        const byteDelta = terminalPapx.fcEnd - range.byteStart;
        if (byteDelta <= 0 || byteDelta % byteWidth !== 0) {
          throw invalidParagraphBoundary();
        }
        boundary = {
          cpEnd: range.cpStart + byteDelta / byteWidth,
          pageIndex: terminalPapx.pageIndex,
          paragraphIndex: terminalPapx.paragraphIndex,
          fcStart: terminalPapx.fcStart,
          fcEnd: terminalPapx.fcEnd
        };
        break;
      }
      pieceIndex += 1;
      if (pieceIndex >= textRanges.ranges.length) {
        break;
      }
      searchCp = textRanges.ranges[pieceIndex]!.cpStart;
    }

    if (
      boundary === undefined ||
      boundary.cpEnd <= cpStart ||
      boundary.cpEnd > mainDocument.mainDocumentCpEnd
    ) {
      throw invalidParagraphBoundary();
    }
    const markCp = boundary.cpEnd - 1;
    const markCodeUnit = mainDocument.mainDocumentText.charCodeAt(markCp);
    const markKind = resolveMarkKind(markCodeUnit);
    if (
      markKind === undefined ||
      (markCodeUnit === PARAGRAPH_MARK &&
        plcPcd.pieces[pieceIndex]!.fNoParaLast)
    ) {
      throw invalidParagraphBoundary();
    }
    paragraphs.push(
      Object.freeze({
        index: paragraphs.length,
        cpStart,
        cpEnd: boundary.cpEnd,
        characterCount: boundary.cpEnd - cpStart,
        markCp,
        markCodeUnit: markCodeUnit as 0x0007 | 0x000c | 0x000d,
        markKind,
        startPieceIndex,
        endPieceIndex: pieceIndex,
        spansMultiplePieces: startPieceIndex !== pieceIndex,
        terminalPapxPageIndex: boundary.pageIndex,
        terminalPapxParagraphIndex: boundary.paragraphIndex,
        terminalPapxFcStart: boundary.fcStart,
        terminalPapxFcEnd: boundary.fcEnd
      })
    );
    cpStart = boundary.cpEnd;
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARIES_SCHEMA_VERSION,
    nFib: mainDocument.nFib,
    tableStreamName: mainDocument.tableStreamName,
    mainDocumentCpStart: 0,
    mainDocumentCpEnd: mainDocument.mainDocumentCpEnd,
    paragraphs: Object.freeze(paragraphs),
    paragraphBoundaryAlgorithm: "ms_doc_2_4_2_piece_aware",
    paragraphBoundaryMarksVerified: true,
    pcdPrmStatus: "not_applied_not_required_for_boundaries",
    tablePropertyBindingStatus:
      "terminal_papx_identified_properties_not_applied",
    tableRowCellBoundaryStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function findPieceIndex(
  ranges: readonly { cpStart: number; cpEnd: number }[],
  cp: number
): number {
  return ranges.findIndex((range) => range.cpStart <= cp && cp < range.cpEnd);
}

function resolveMarkKind(
  codeUnit: number
): VerifiedOfficialMarketCalendarKrxLegacyWordParagraphBoundary["markKind"] | undefined {
  if (codeUnit === CELL_OR_TTP_MARK) {
    return "cell_or_ttp_mark";
  }
  if (codeUnit === SECTION_MARK) {
    return "section_mark";
  }
  if (codeUnit === PARAGRAPH_MARK) {
    return "paragraph_mark";
  }
  return undefined;
}

function invalidParagraphBoundary(): OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError {
  return new OfficialMarketCalendarKrxLegacyWordParagraphBoundariesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PARAGRAPH_BOUNDARY_INVALID",
    "Official calendar KRX legacy Word paragraph boundary is invalid."
  );
}
