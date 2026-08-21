import {
  verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks,
  type VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark
} from "./officialMarketCalendarKrxLegacyWordTableTextMarks.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_table_row_grouping.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableCell {
  index: number;
  cpStart: number;
  cpEnd: number;
  paragraphIndices: readonly number[];
  terminalParagraphIndex: number;
  terminalRole:
    | "depth_1_cell_mark"
    | "nested_cell_mark"
    | "nested_ttp_mark";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableRow {
  index: number;
  tableDepth: number;
  cpStart: number;
  cpEnd: number;
  cells: readonly VerifiedOfficialMarketCalendarKrxLegacyWordTableCell[];
  rowTerminatorParagraphIndex: number;
  rowTerminatorRole: "depth_1_ttp_mark" | "nested_ttp_mark";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableRowGrouping {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  rows: readonly VerifiedOfficialMarketCalendarKrxLegacyWordTableRow[];
  tableRowCellBoundaryStatus: "grouped";
  nestedRowBoundaryStatus: "grouped";
  sourceRowProjectionStatus: "not_projected";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordTableRowGroupingErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_INVALID";

export class OfficialMarketCalendarKrxLegacyWordTableRowGroupingError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordTableRowGroupingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordTableRowGroupingError";
  }
}

interface MutableCell {
  cpStart: number;
  cpEnd: number;
  paragraphIndices: readonly number[];
  terminalParagraphIndex: number;
  terminalRole: VerifiedOfficialMarketCalendarKrxLegacyWordTableCell["terminalRole"];
}

interface MutableRow {
  tableDepth: number;
  cpStart: number;
  cellStartCp: number;
  cells: MutableCell[];
}

export function verifyOfficialMarketCalendarKrxLegacyWordTableRowGrouping(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordTableRowGrouping {
  const marks = verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks(input);
  const openRows = new Map<number, MutableRow>();
  const completedRows: Omit<
    VerifiedOfficialMarketCalendarKrxLegacyWordTableRow,
    "index"
  >[] = [];

  for (const paragraph of marks.paragraphs) {
    if (paragraph.tableDepth === 0) {
      if (openRows.size !== 0) {
        throw invalidTableRowGrouping();
      }
      continue;
    }

    if (paragraph.tableDepth > marks.paragraphs.length) {
      throw invalidTableRowGrouping();
    }

    for (const depth of openRows.keys()) {
      if (depth > paragraph.tableDepth) {
        throw invalidTableRowGrouping();
      }
    }
    for (let depth = 1; depth <= paragraph.tableDepth; depth += 1) {
      if (!openRows.has(depth)) {
        openRows.set(depth, {
          tableDepth: depth,
          cpStart: paragraph.cpStart,
          cellStartCp: paragraph.cpStart,
          cells: []
        });
      }
    }

    switch (paragraph.resolvedRole) {
      case "table_paragraph":
        break;
      case "depth_1_cell_mark":
        assertNoOpenDeeperRow(openRows, 1);
        closeCell(openRows, marks.paragraphs, paragraph);
        break;
      case "depth_1_ttp_mark":
        assertNoOpenDeeperRow(openRows, 1);
        closeDepthOneRow(openRows, completedRows, paragraph);
        break;
      case "nested_cell_mark":
        assertNoOpenDeeperRow(openRows, paragraph.tableDepth);
        closeCell(openRows, marks.paragraphs, paragraph);
        break;
      case "nested_ttp_mark":
        assertNoOpenDeeperRow(openRows, paragraph.tableDepth);
        closeCell(openRows, marks.paragraphs, paragraph);
        closeRow(openRows, completedRows, paragraph);
        break;
      case "non_table_paragraph":
      case "non_table_section":
        throw invalidTableRowGrouping();
    }
  }

  if (openRows.size !== 0) {
    throw invalidTableRowGrouping();
  }

  completedRows.sort(
    (left, right) => left.cpStart - right.cpStart || left.tableDepth - right.tableDepth
  );
  const rows = completedRows.map((row, index) =>
    Object.freeze({ ...row, index })
  );
  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_SCHEMA_VERSION,
    nFib: marks.nFib,
    tableStreamName: marks.tableStreamName,
    rows: Object.freeze(rows),
    tableRowCellBoundaryStatus: "grouped",
    nestedRowBoundaryStatus: "grouped",
    sourceRowProjectionStatus: "not_projected",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function closeCell(
  openRows: Map<number, MutableRow>,
  paragraphs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark[],
  terminal: VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark
): void {
  const row = openRows.get(terminal.tableDepth);
  if (
    row === undefined ||
    terminal.cpEnd <= row.cellStartCp ||
    (terminal.resolvedRole !== "depth_1_cell_mark" &&
      terminal.resolvedRole !== "nested_cell_mark" &&
      terminal.resolvedRole !== "nested_ttp_mark")
  ) {
    throw invalidTableRowGrouping();
  }
  const paragraphIndices = paragraphs
    .filter(
      (paragraph) =>
        paragraph.cpStart >= row.cellStartCp && paragraph.cpEnd <= terminal.cpEnd
    )
    .map((paragraph) => paragraph.index);
  if (paragraphIndices.length === 0) {
    throw invalidTableRowGrouping();
  }
  row.cells.push({
    cpStart: row.cellStartCp,
    cpEnd: terminal.cpEnd,
    paragraphIndices: Object.freeze(paragraphIndices),
    terminalParagraphIndex: terminal.index,
    terminalRole: terminal.resolvedRole
  });
  row.cellStartCp = terminal.cpEnd;
}

function closeDepthOneRow(
  openRows: Map<number, MutableRow>,
  completedRows: Omit<
    VerifiedOfficialMarketCalendarKrxLegacyWordTableRow,
    "index"
  >[],
  terminal: VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark
): void {
  const row = openRows.get(1);
  if (
    row === undefined ||
    row.cells.length === 0 ||
    row.cellStartCp !== terminal.cpStart
  ) {
    throw invalidTableRowGrouping();
  }
  closeRow(openRows, completedRows, terminal);
}

function closeRow(
  openRows: Map<number, MutableRow>,
  completedRows: Omit<
    VerifiedOfficialMarketCalendarKrxLegacyWordTableRow,
    "index"
  >[],
  terminal: VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark
): void {
  const row = openRows.get(terminal.tableDepth);
  if (
    row === undefined ||
    row.cells.length === 0 ||
    (terminal.resolvedRole !== "depth_1_ttp_mark" &&
      terminal.resolvedRole !== "nested_ttp_mark")
  ) {
    throw invalidTableRowGrouping();
  }
  completedRows.push(
    Object.freeze({
      tableDepth: row.tableDepth,
      cpStart: row.cpStart,
      cpEnd: terminal.cpEnd,
      cells: Object.freeze(
        row.cells.map((cell, index) => Object.freeze({ ...cell, index }))
      ),
      rowTerminatorParagraphIndex: terminal.index,
      rowTerminatorRole: terminal.resolvedRole
    })
  );
  openRows.delete(terminal.tableDepth);
}

function assertNoOpenDeeperRow(
  openRows: ReadonlyMap<number, MutableRow>,
  tableDepth: number
): void {
  for (const depth of openRows.keys()) {
    if (depth > tableDepth) {
      throw invalidTableRowGrouping();
    }
  }
}

function invalidTableRowGrouping(): OfficialMarketCalendarKrxLegacyWordTableRowGroupingError {
  return new OfficialMarketCalendarKrxLegacyWordTableRowGroupingError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_ROW_GROUPING_INVALID",
    "Official calendar KRX legacy Word table row grouping is invalid."
  );
}
