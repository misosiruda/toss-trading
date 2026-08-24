import { verifyOfficialMarketCalendarKrxLegacyWordGrpPrls } from "./officialMarketCalendarKrxLegacyWordGrpPrl.js";
import { verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries } from "./officialMarketCalendarKrxLegacyWordParagraphBoundaries.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls } from "./officialMarketCalendarKrxLegacyWordPrcGrpPrl.js";
import type { VerifiedOfficialMarketCalendarKrxLegacyWordPrl } from "./officialMarketCalendarKrxLegacyWordPrl.js";
import { verifyOfficialMarketCalendarKrxLegacyWordParagraphStyleProperties } from "./officialMarketCalendarKrxLegacyWordParagraphStyleProperties.js";
import {
  OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError,
  interpretOfficialMarketCalendarKrxLegacyWordTableParagraphProperties
} from "./officialMarketCalendarKrxLegacyWordTableParagraphProperties.js";
import type { InterpretedOfficialMarketCalendarKrxLegacyWordTableParagraphProperties } from "./officialMarketCalendarKrxLegacyWordTableParagraphProperties.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_direct_paragraph_properties.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordDirectParagraphProperty
  extends InterpretedOfficialMarketCalendarKrxLegacyWordTableParagraphProperties {
  index: number;
  cpStart: number;
  cpEnd: number;
  markCp: number;
  markCodeUnit: 0x0007 | 0x000c | 0x000d;
  markKind: "cell_or_ttp_mark" | "section_mark" | "paragraph_mark";
  terminalPapxPageIndex: number;
  terminalPapxParagraphIndex: number;
  terminalPcdPieceIndex: number;
  terminalPcdPrmKind: "prm0" | "prm1";
  terminalPcdRawPrm: number;
  papxPrlCount: number;
  styleParagraphPrlCount: number;
  styleInheritanceDepth: number;
  appendedPcdParagraphPrlCount: number;
  ignoredPcdNonParagraphPrlCount: number;
  directParagraphPrlCount: number;
  propertiesStatus:
    | "papx_only"
    | "papx_and_terminal_pcd_applied"
    | "style_and_papx_applied"
    | "style_papx_and_terminal_pcd_applied";
  textMarkValidationStatus: "not_applicable" | "pending_text_binding";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  paragraphs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordDirectParagraphProperty[];
  directParagraphFormattingAlgorithm: "ms_doc_2_4_6_1_terminal_pcd";
  papxThenTerminalPcdOrderVerified: true;
  prm0ParagraphSelectionVerified: true;
  prm1ParagraphSelectionVerified: true;
  paragraphStyleBindingStatus: "default_and_non_default_resolved";
  tableTextMarkSemanticsStatus: "not_verified";
  tableRowCellBoundaryStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesErrorCode =
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_INVALID"
  | "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_STYLE_UNSUPPORTED";

export class OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesErrorCode,
    message: string
  ) {
    super(message);
    this.name =
      "OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError";
  }
}

export function verifyOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordDirectParagraphProperties {
  const boundaries =
    verifyOfficialMarketCalendarKrxLegacyWordParagraphBoundaries(input);
  const grpPrls = verifyOfficialMarketCalendarKrxLegacyWordGrpPrls(input);
  const prcGrpPrls =
    verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls(input);
  if (
    boundaries.nFib !== grpPrls.nFib ||
    boundaries.nFib !== prcGrpPrls.nFib ||
    boundaries.tableStreamName !== grpPrls.tableStreamName ||
    boundaries.tableStreamName !== prcGrpPrls.tableStreamName
  ) {
    throw invalidDirectParagraphProperties();
  }
  const needsParagraphStyleResolution = grpPrls.groups.some(
    (group) => group.istd !== null && group.istd !== 0
  );
  const paragraphStyles = needsParagraphStyleResolution
    ? verifyOfficialMarketCalendarKrxLegacyWordParagraphStyleProperties(input)
    : null;
  if (
    paragraphStyles !== null &&
    (paragraphStyles.nFib !== boundaries.nFib ||
      paragraphStyles.tableStreamName !== boundaries.tableStreamName)
  ) {
    throw invalidDirectParagraphProperties();
  }

  const paragraphs = boundaries.paragraphs.map((boundary) => {
    const group = grpPrls.groups.find(
      (candidate) =>
        candidate.pageIndex === boundary.terminalPapxPageIndex &&
        candidate.paragraphIndex === boundary.terminalPapxParagraphIndex &&
        candidate.fcStart === boundary.terminalPapxFcStart &&
        candidate.fcEnd === boundary.terminalPapxFcEnd
    );
    const terminalPiece = prcGrpPrls.pieces[boundary.endPieceIndex];
    if (
      group === undefined ||
      terminalPiece === undefined ||
      terminalPiece.index !== boundary.endPieceIndex ||
      terminalPiece.cpStart > boundary.markCp ||
      boundary.markCp >= terminalPiece.cpEnd
    ) {
      throw invalidDirectParagraphProperties();
    }
    const paragraphStyle =
      group.istd !== null && paragraphStyles !== null
        ? paragraphStyles?.styles.find((style) => style.istd === group.istd)
        : undefined;
    if (
      group.istd !== null &&
      group.istd !== 0 &&
      paragraphStyle === undefined
    ) {
      throw unsupportedDirectParagraphStyle();
    }
    const stylePrls = paragraphStyle?.resolvedParagraphPrls ?? [];

    const pcdModifiers = resolveTerminalPcdParagraphModifiers(
      terminalPiece,
      prcGrpPrls.prcs
    );
    let interpreted: InterpretedOfficialMarketCalendarKrxLegacyWordTableParagraphProperties;
    try {
      interpreted =
        interpretOfficialMarketCalendarKrxLegacyWordTableParagraphProperties(
          boundaries.nFib,
          group.istd,
          [...stylePrls, ...group.prls, ...pcdModifiers.prls],
          pcdModifiers.additionalUninterpretedParagraphPrlCount,
          paragraphStyle !== undefined
        );
    } catch (error) {
      if (
        error instanceof
        OfficialMarketCalendarKrxLegacyWordTableParagraphPropertiesError
      ) {
        throw invalidDirectParagraphProperties();
      }
      throw error;
    }

    return Object.freeze({
      index: boundary.index,
      cpStart: boundary.cpStart,
      cpEnd: boundary.cpEnd,
      markCp: boundary.markCp,
      markCodeUnit: boundary.markCodeUnit,
      markKind: boundary.markKind,
      terminalPapxPageIndex: boundary.terminalPapxPageIndex,
      terminalPapxParagraphIndex: boundary.terminalPapxParagraphIndex,
      terminalPcdPieceIndex: terminalPiece.index,
      terminalPcdPrmKind: terminalPiece.kind,
      terminalPcdRawPrm: terminalPiece.rawPrm,
      papxPrlCount: group.prls.length,
      styleParagraphPrlCount: stylePrls.length,
      styleInheritanceDepth: paragraphStyle?.inheritanceChain.length ?? 0,
      appendedPcdParagraphPrlCount: pcdModifiers.appendedParagraphPrlCount,
      ignoredPcdNonParagraphPrlCount:
        pcdModifiers.ignoredNonParagraphPrlCount,
      directParagraphPrlCount:
        group.prls.length + pcdModifiers.appendedParagraphPrlCount,
      ...interpreted,
      propertiesStatus: resolvePropertiesStatus(
        stylePrls.length,
        pcdModifiers.appendedParagraphPrlCount
      ),
      textMarkValidationStatus:
        interpreted.tableRole === "not_in_table" ||
        interpreted.tableRole === "table_paragraph"
          ? "not_applicable"
          : "pending_text_binding"
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_SCHEMA_VERSION,
    nFib: boundaries.nFib,
    tableStreamName: boundaries.tableStreamName,
    paragraphs: Object.freeze(paragraphs),
    directParagraphFormattingAlgorithm: "ms_doc_2_4_6_1_terminal_pcd",
    papxThenTerminalPcdOrderVerified: true,
    prm0ParagraphSelectionVerified: true,
    prm1ParagraphSelectionVerified: true,
    paragraphStyleBindingStatus: "default_and_non_default_resolved",
    tableTextMarkSemanticsStatus: "not_verified",
    tableRowCellBoundaryStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function resolvePropertiesStatus(
  stylePrlCount: number,
  terminalPcdPrlCount: number
): VerifiedOfficialMarketCalendarKrxLegacyWordDirectParagraphProperty["propertiesStatus"] {
  if (stylePrlCount === 0) {
    return terminalPcdPrlCount === 0
      ? "papx_only"
      : "papx_and_terminal_pcd_applied";
  }
  return terminalPcdPrlCount === 0
    ? "style_and_papx_applied"
    : "style_papx_and_terminal_pcd_applied";
}

function resolveTerminalPcdParagraphModifiers(
  piece: (ReturnType<
    typeof verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
  >)["pieces"][number],
  prcs: ReturnType<
    typeof verifyOfficialMarketCalendarKrxLegacyWordPrcGrpPrls
  >["prcs"]
): {
  prls: readonly Pick<
    VerifiedOfficialMarketCalendarKrxLegacyWordPrl,
    "sprm" | "operandBytes"
  >[];
  appendedParagraphPrlCount: number;
  additionalUninterpretedParagraphPrlCount: number;
  ignoredNonParagraphPrlCount: number;
} {
  if (piece.kind === "prm0") {
    if (!piece.hasEffect) {
      return noPcdParagraphModifiers();
    }
    if (piece.simplePropertyGroup !== "paragraph") {
      return {
        ...noPcdParagraphModifiers(),
        ignoredNonParagraphPrlCount: 1
      };
    }
    if (piece.val === null) {
      throw invalidDirectParagraphProperties();
    }
    if (piece.simpleTableSprm === null) {
      return {
        prls: Object.freeze([]),
        appendedParagraphPrlCount: 1,
        additionalUninterpretedParagraphPrlCount: 1,
        ignoredNonParagraphPrlCount: 0
      };
    }
    return {
      prls: Object.freeze([
        Object.freeze({
          sprm: piece.simpleTableSprm,
          operandBytes: Uint8Array.of(piece.val)
        })
      ]),
      appendedParagraphPrlCount: 1,
      additionalUninterpretedParagraphPrlCount: 0,
      ignoredNonParagraphPrlCount: 0
    };
  }

  if (piece.prcIndex === null) {
    throw invalidDirectParagraphProperties();
  }
  const prc = prcs[piece.prcIndex];
  if (prc === undefined) {
    throw invalidDirectParagraphProperties();
  }
  const paragraphPrls = Object.freeze(prc.prls.filter((prl) => prl.sgc === 1));
  return {
    prls: paragraphPrls,
    appendedParagraphPrlCount: paragraphPrls.length,
    additionalUninterpretedParagraphPrlCount: 0,
    ignoredNonParagraphPrlCount: prc.prls.length - paragraphPrls.length
  };
}

function noPcdParagraphModifiers(): {
  prls: readonly never[];
  appendedParagraphPrlCount: 0;
  additionalUninterpretedParagraphPrlCount: 0;
  ignoredNonParagraphPrlCount: 0;
} {
  return {
    prls: Object.freeze([]),
    appendedParagraphPrlCount: 0,
    additionalUninterpretedParagraphPrlCount: 0,
    ignoredNonParagraphPrlCount: 0
  };
}

function invalidDirectParagraphProperties(): OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError {
  return new OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_PROPERTIES_INVALID",
    "Official calendar KRX legacy Word direct paragraph properties are invalid."
  );
}

function unsupportedDirectParagraphStyle(): OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError {
  return new OfficialMarketCalendarKrxLegacyWordDirectParagraphPropertiesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_DIRECT_PARAGRAPH_STYLE_UNSUPPORTED",
    "Official calendar KRX legacy Word direct paragraph style is unsupported."
  );
}
