import { verifyOfficialMarketCalendarKrxLegacyWordGrpPrls } from "./officialMarketCalendarKrxLegacyWordGrpPrl.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_table_paragraph_properties.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableParagraphProperty {
  pageIndex: number;
  paragraphIndex: number;
  fcStart: number;
  fcEnd: number;
  istd: number | null;
  inTable: boolean;
  tableDepth: number;
  isTtp: boolean;
  isInnerTableCell: boolean;
  isInnerTtp: boolean;
  tableRole:
    | "not_in_table"
    | "table_paragraph"
    | "depth_1_ttp_candidate"
    | "nested_cell_mark_candidate"
    | "nested_ttp_candidate";
  interpretedPrlCount: number;
  uninterpretedPrlCount: number;
  propertiesStatus: "default" | "supported_table_properties_verified";
  textMarkValidationStatus: "not_applicable" | "pending_text_binding";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordTableParagraphProperties {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  paragraphs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordTableParagraphProperty[];
  supportedSprms: readonly [0x2416, 0x2417, 0x6649, 0x664a, 0x244b, 0x244c];
  supportedTablePropertySemanticsStatus: "verified";
  tableTextMarkSemanticsStatus: "not_verified";
  tableRowCellBoundaryStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_INVALID";

export class OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesErrorCode,
    message: string
  ) {
    super(message);
    this.name =
      "OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError";
  }
}

const SPRM_PF_IN_TABLE = 0x2416;
const SPRM_PF_TTP = 0x2417;
const SPRM_P_ITAP = 0x6649;
const SPRM_P_DTAP = 0x664a;
const SPRM_PF_INNER_TABLE_CELL = 0x244b;
const SPRM_PF_INNER_TTP = 0x244c;
const SUPPORTED_SPRMS = Object.freeze([
  SPRM_PF_IN_TABLE,
  SPRM_PF_TTP,
  SPRM_P_ITAP,
  SPRM_P_DTAP,
  SPRM_PF_INNER_TABLE_CELL,
  SPRM_PF_INNER_TTP
] as const);

export function verifyOfficialMarketCalendarKrxLegacyWordTableParagraphProperties(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordTableParagraphProperties {
  const grpPrls = verifyOfficialMarketCalendarKrxLegacyWordGrpPrls(input);
  const paragraphs = grpPrls.groups.map((group) => {
    let inTable = false;
    let tableDepth = 0;
    let isTtp = false;
    let isInnerTableCell = false;
    let isInnerTtp = false;
    let interpretedPrlCount = 0;
    let hasExplicitTableDepth = false;

    for (const prl of group.prls) {
      if (
        grpPrls.nFib === 0x00c1 &&
        (prl.sprm === SPRM_P_ITAP ||
          prl.sprm === SPRM_P_DTAP ||
          prl.sprm === SPRM_PF_INNER_TABLE_CELL ||
          prl.sprm === SPRM_PF_INNER_TTP)
      ) {
        throw invalidTableParagraphProperties();
      }
      switch (prl.sprm) {
        case SPRM_PF_IN_TABLE:
          inTable = readBool8(prl.operandBytes);
          interpretedPrlCount += 1;
          break;
        case SPRM_PF_TTP:
          isTtp = readBool8(prl.operandBytes);
          interpretedPrlCount += 1;
          break;
        case SPRM_P_ITAP:
          tableDepth = readInt32(prl.operandBytes);
          if (tableDepth < 0) {
            throw invalidTableParagraphProperties();
          }
          hasExplicitTableDepth = true;
          interpretedPrlCount += 1;
          break;
        case SPRM_P_DTAP:
          tableDepth += readInt32(prl.operandBytes);
          if (tableDepth < 0 || !Number.isSafeInteger(tableDepth)) {
            throw invalidTableParagraphProperties();
          }
          hasExplicitTableDepth = true;
          interpretedPrlCount += 1;
          break;
        case SPRM_PF_INNER_TABLE_CELL:
          isInnerTableCell = readBool8(prl.operandBytes);
          interpretedPrlCount += 1;
          break;
        case SPRM_PF_INNER_TTP:
          isInnerTtp = readBool8(prl.operandBytes);
          interpretedPrlCount += 1;
          break;
      }
    }

    if (grpPrls.nFib === 0x00c1 && !hasExplicitTableDepth && inTable) {
      tableDepth = 1;
    }

    const markerCount =
      Number(isTtp) + Number(isInnerTableCell) + Number(isInnerTtp);
    if (
      inTable !== (tableDepth > 0) ||
      markerCount > 1 ||
      (isTtp && tableDepth !== 1) ||
      ((isInnerTableCell || isInnerTtp) && tableDepth <= 1)
    ) {
      throw invalidTableParagraphProperties();
    }

    const tableRole = resolveTableRole({
      tableDepth,
      isTtp,
      isInnerTableCell,
      isInnerTtp
    });
    return Object.freeze({
      pageIndex: group.pageIndex,
      paragraphIndex: group.paragraphIndex,
      fcStart: group.fcStart,
      fcEnd: group.fcEnd,
      istd: group.istd,
      inTable,
      tableDepth,
      isTtp,
      isInnerTableCell,
      isInnerTtp,
      tableRole,
      interpretedPrlCount,
      uninterpretedPrlCount: group.prls.length - interpretedPrlCount,
      propertiesStatus:
        group.propertiesStatus === "default"
          ? "default"
          : "supported_table_properties_verified",
      textMarkValidationStatus:
        tableRole === "not_in_table" || tableRole === "table_paragraph"
          ? "not_applicable"
          : "pending_text_binding"
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_SCHEMA_VERSION,
    nFib: grpPrls.nFib,
    tableStreamName: grpPrls.tableStreamName,
    paragraphs: Object.freeze(paragraphs),
    supportedSprms: SUPPORTED_SPRMS,
    supportedTablePropertySemanticsStatus: "verified",
    tableTextMarkSemanticsStatus: "not_verified",
    tableRowCellBoundaryStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function resolveTableRole(input: {
  tableDepth: number;
  isTtp: boolean;
  isInnerTableCell: boolean;
  isInnerTtp: boolean;
}): VerifiedOfficialMarketCalendarKrxLegacyWordTableParagraphProperty["tableRole"] {
  if (input.isTtp) {
    return "depth_1_ttp_candidate";
  }
  if (input.isInnerTableCell) {
    return "nested_cell_mark_candidate";
  }
  if (input.isInnerTtp) {
    return "nested_ttp_candidate";
  }
  return input.tableDepth === 0 ? "not_in_table" : "table_paragraph";
}

function readBool8(bytes: Uint8Array): boolean {
  if (bytes.length !== 1 || (bytes[0] !== 0 && bytes[0] !== 1)) {
    throw invalidTableParagraphProperties();
  }
  return bytes[0] === 1;
}

function readInt32(bytes: Uint8Array): number {
  if (bytes.length !== 4) {
    throw invalidTableParagraphProperties();
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(
    0,
    true
  );
}

function invalidTableParagraphProperties(): OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError {
  return new OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TABLE_PARAGRAPH_PROPERTIES_INVALID",
    "Official calendar KRX legacy Word table paragraph properties are invalid."
  );
}
