import { verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties } from "./officialMarketCalendarKrxLegacyWordDirectParagraphProperties.js";
import { verifyOfficialMarketCalendarKrxLegacyWordMainDocument } from "./officialMarketCalendarKrxLegacyWordMainDocument.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARKS_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_table_text_marks.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark {
  index: number;
  cpStart: number;
  cpEnd: number;
  markCp: number;
  markCodeUnit: 0x0007 | 0x000c | 0x000d;
  tableDepth: number;
  resolvedRole:
    | "non_table_paragraph"
    | "non_table_section"
    | "table_paragraph"
    | "depth_1_cell_mark"
    | "depth_1_ttp_mark"
    | "nested_cell_mark"
    | "nested_ttp_mark";
  tableBoundaryRole: "none" | "cell_end" | "row_end";
  precedingCellMarkStatus: "not_applicable" | "verified";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMarks {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARKS_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  paragraphs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark[];
  depthOneCellAndTtpMarksVerified: true;
  nestedCellAndTtpMarksVerified: true;
  ttpPrecedingCellMarkVerified: true;
  tableRowCellBoundaryStatus: "marks_classified_not_grouped";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordTableTextMarksErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARK_INVALID";

export class OfficialMarketCalendarKrxLegacyWordTableTextMarksError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordTableTextMarksErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordTableTextMarksError";
  }
}

export function verifyOfficialMarketCalendarKrxLegacyWordTableTextMarks(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMarks {
  const directProperties =
    verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties(input);
  const mainDocument =
    verifyOfficialMarketCalendarKrxLegacyWordMainDocument(input);
  if (
    directProperties.nFib !== mainDocument.nFib ||
    directProperties.tableStreamName !== mainDocument.tableStreamName
  ) {
    throw invalidTableTextMark();
  }

  const paragraphs: VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark[] = [];
  for (const paragraph of directProperties.paragraphs) {
    const classification = classifyTableTextMark(
      paragraph,
      mainDocument.mainDocumentText,
      paragraphs.at(-1)
    );
    paragraphs.push(Object.freeze({
      index: paragraph.index,
      cpStart: paragraph.cpStart,
      cpEnd: paragraph.cpEnd,
      markCp: paragraph.markCp,
      markCodeUnit: paragraph.markCodeUnit,
      tableDepth: paragraph.tableDepth,
      ...classification
    }));
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARKS_SCHEMA_VERSION,
    nFib: directProperties.nFib,
    tableStreamName: directProperties.tableStreamName,
    paragraphs: Object.freeze(paragraphs),
    depthOneCellAndTtpMarksVerified: true,
    nestedCellAndTtpMarksVerified: true,
    ttpPrecedingCellMarkVerified: true,
    tableRowCellBoundaryStatus: "marks_classified_not_grouped",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function classifyTableTextMark(
  paragraph: (ReturnType<
    typeof verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties
  >)["paragraphs"][number],
  text: string,
  previousParagraph:
    | VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark
    | undefined
): Pick<
  VerifiedOfficialMarketCalendarKrxLegacyWordTableTextMark,
  "resolvedRole" | "tableBoundaryRole" | "precedingCellMarkStatus"
> {
  if (!paragraph.inTable) {
    if (paragraph.markCodeUnit === 0x0007) {
      throw invalidTableTextMark();
    }
    return {
      resolvedRole:
        paragraph.markCodeUnit === 0x000c
          ? "non_table_section"
          : "non_table_paragraph",
      tableBoundaryRole: "none",
      precedingCellMarkStatus: "not_applicable"
    };
  }

  switch (paragraph.tableRole) {
    case "table_paragraph":
      if (paragraph.markCodeUnit === 0x000d) {
        return {
          resolvedRole: "table_paragraph",
          tableBoundaryRole: "none",
          precedingCellMarkStatus: "not_applicable"
        };
      }
      if (paragraph.markCodeUnit === 0x0007 && paragraph.tableDepth === 1) {
        return {
          resolvedRole: "depth_1_cell_mark",
          tableBoundaryRole: "cell_end",
          precedingCellMarkStatus: "not_applicable"
        };
      }
      throw invalidTableTextMark();
    case "depth_1_ttp_candidate":
      if (
        paragraph.markCodeUnit !== 0x0007 ||
        paragraph.markCp <= 0 ||
        text.charCodeAt(paragraph.markCp - 1) !== 0x0007 ||
        previousParagraph?.resolvedRole !== "depth_1_cell_mark" ||
        previousParagraph.markCp !== paragraph.markCp - 1
      ) {
        throw invalidTableTextMark();
      }
      return {
        resolvedRole: "depth_1_ttp_mark",
        tableBoundaryRole: "row_end",
        precedingCellMarkStatus: "verified"
      };
    case "nested_cell_mark_candidate":
      if (paragraph.markCodeUnit !== 0x000d) {
        throw invalidTableTextMark();
      }
      return {
        resolvedRole: "nested_cell_mark",
        tableBoundaryRole: "cell_end",
        precedingCellMarkStatus: "not_applicable"
      };
    case "nested_ttp_candidate":
      if (paragraph.markCodeUnit !== 0x000d) {
        throw invalidTableTextMark();
      }
      return {
        resolvedRole: "nested_ttp_mark",
        tableBoundaryRole: "row_end",
        precedingCellMarkStatus: "not_applicable"
      };
    case "not_in_table":
      throw invalidTableTextMark();
  }
}

function invalidTableTextMark(): OfficialMarketCalendarKrxLegacyWordTableTextMarksError {
  return new OfficialMarketCalendarKrxLegacyWordTableTextMarksError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_TEXT_MARK_INVALID",
    "Official calendar KRX legacy Word table text mark is invalid."
  );
}
