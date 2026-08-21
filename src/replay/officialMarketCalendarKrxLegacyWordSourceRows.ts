import { verifyOfficialMarketCalendarKrxLegacyWordMainDocument } from "./officialMarketCalendarKrxLegacyWordMainDocument.js";
import {
  verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping,
  type VerifiedOfficialMarketCalendarKrxLegacyWordTableCell
} from "./officialMarketCalendarKrxLegacyWordTableRowGrouping.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_source_rows.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordSourceCell {
  index: number;
  cpStart: number;
  cpEnd: number;
  contentCpEnd: number;
  paragraphIndices: readonly number[];
  terminalParagraphIndex: number;
  terminalRole: VerifiedOfficialMarketCalendarKrxLegacyWordTableCell["terminalRole"];
  rawText: string;
  contentText: string;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow {
  index: number;
  tableDepth: number;
  cpStart: number;
  cpEnd: number;
  cells: readonly VerifiedOfficialMarketCalendarKrxLegacyWordSourceCell[];
  rowTerminatorParagraphIndex: number;
  rowTerminatorRole: "depth_1_ttp_mark" | "nested_ttp_mark";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  rows: readonly VerifiedOfficialMarketCalendarKrxLegacyWordSourceRow[];
  sourceRowProjectionStatus: "structural_text_projected";
  terminalMarkHandling: "removed_from_content_preserved_in_raw";
  internalControlCodeHandling: "preserved";
  columnSemanticsStatus: "not_interpreted";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordSourceRowsErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_INVALID";

export class OfficialMarketCalendarKrxLegacyWordSourceRowsError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordSourceRowsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordSourceRowsError";
  }
}

export function verifyOfficialMarketCalendarKrxLegacyWordSourceRows(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordSourceRows {
  const grouping =
    verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping(input);
  const mainDocument =
    verifyOfficialMarketCalendarKrxLegacyWordMainDocument(input);
  if (
    grouping.nFib !== mainDocument.nFib ||
    grouping.tableStreamName !== mainDocument.tableStreamName
  ) {
    throw invalidSourceRows();
  }

  const rows = grouping.rows.map((row) => {
    const expectedRowTerminator =
      row.rowTerminatorRole === "depth_1_ttp_mark" ? 0x0007 : 0x000d;
    if (
      row.cpStart < 0 ||
      row.cpEnd <= row.cpStart ||
      row.cpEnd > mainDocument.mainDocumentText.length ||
      mainDocument.mainDocumentText.charCodeAt(row.cpEnd - 1) !==
        expectedRowTerminator
    ) {
      throw invalidSourceRows();
    }
    const cells = row.cells.map((cell) =>
      projectCell(mainDocument.mainDocumentText, row.cpStart, row.cpEnd, cell)
    );
    return Object.freeze({
      index: row.index,
      tableDepth: row.tableDepth,
      cpStart: row.cpStart,
      cpEnd: row.cpEnd,
      cells: Object.freeze(cells),
      rowTerminatorParagraphIndex: row.rowTerminatorParagraphIndex,
      rowTerminatorRole: row.rowTerminatorRole
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_SCHEMA_VERSION,
    nFib: grouping.nFib,
    tableStreamName: grouping.tableStreamName,
    rows: Object.freeze(rows),
    sourceRowProjectionStatus: "structural_text_projected",
    terminalMarkHandling: "removed_from_content_preserved_in_raw",
    internalControlCodeHandling: "preserved",
    columnSemanticsStatus: "not_interpreted",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function projectCell(
  text: string,
  rowCpStart: number,
  rowCpEnd: number,
  cell: VerifiedOfficialMarketCalendarKrxLegacyWordTableCell
): VerifiedOfficialMarketCalendarKrxLegacyWordSourceCell {
  const expectedTerminal =
    cell.terminalRole === "depth_1_cell_mark" ? 0x0007 : 0x000d;
  if (
    cell.cpStart < rowCpStart ||
    cell.cpEnd <= cell.cpStart ||
    cell.cpEnd > rowCpEnd ||
    cell.paragraphIndices.length === 0 ||
    text.charCodeAt(cell.cpEnd - 1) !== expectedTerminal
  ) {
    throw invalidSourceRows();
  }
  const rawText = text.slice(cell.cpStart, cell.cpEnd);
  const contentCpEnd = cell.cpEnd - 1;
  return Object.freeze({
    index: cell.index,
    cpStart: cell.cpStart,
    cpEnd: cell.cpEnd,
    contentCpEnd,
    paragraphIndices: cell.paragraphIndices,
    terminalParagraphIndex: cell.terminalParagraphIndex,
    terminalRole: cell.terminalRole,
    rawText,
    contentText: text.slice(cell.cpStart, contentCpEnd)
  });
}

function invalidSourceRows(): OfficialMarketCalendarKrxLegacyWordSourceRowsError {
  return new OfficialMarketCalendarKrxLegacyWordSourceRowsError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_SOURCE_ROWS_INVALID",
    "Official calendar KRX legacy Word source rows are invalid."
  );
}
