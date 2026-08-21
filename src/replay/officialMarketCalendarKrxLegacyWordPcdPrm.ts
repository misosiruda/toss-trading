import { verifyOfficialMarketCalendarKrxLegacyWordClx } from "./officialMarketCalendarKrxLegacyWordClx.js";
import { verifyOfficialMarketCalendarKrxLegacyWordClxReference } from "./officialMarketCalendarKrxLegacyWordClxReference.js";
import { verifyOfficialMarketCalendarKrxLegacyWordPlcPcd } from "./officialMarketCalendarKrxLegacyWordPlcPcd.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_pcd_prm.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPrc {
  index: number;
  clxByteOffset: number;
  grpprlByteOffset: number;
  grpprlByteLength: number;
  grpprlBytes: Uint8Array;
  bytesOwnership: "caller_owned_copy";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrm {
  index: number;
  cpStart: number;
  cpEnd: number;
  rawPrm: number;
  kind: "prm0" | "prm1";
  hasEffect: boolean;
  isprm: number | null;
  val: number | null;
  simplePropertyGroup: "none" | "paragraph" | "character" | null;
  simpleTableSprm: 0x2416 | 0x2417 | null;
  prcIndex: number | null;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  prcs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrc[];
  pieces: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrm[];
  supportedSimpleIsprms: readonly number[];
  prm0AllowlistVerified: true;
  prm1PrcReferencesVerified: true;
  prcGrpprlFramingVerified: true;
  prcGrpprlSemanticsStatus: "not_parsed";
  tablePropertyApplicationStatus: "not_applied";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPcdPrmErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPcdPrmError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPcdPrmErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPcdPrmError";
  }
}

const PRC_MARKER = 0x01;
const PRC_HEADER_BYTE_LENGTH = 3;
const PCD_BYTE_LENGTH = 8;
const PCD_PRM_BYTE_OFFSET = 6;
const MAXIMUM_GRPPRL_BYTE_LENGTH = 0x3fa2;
const SPRM_PF_IN_TABLE = 0x2416;
const SPRM_PF_TTP = 0x2417;

const PARAGRAPH_ISPRMS = new Set([
  0x04, 0x05, 0x07, 0x08, 0x09, 0x0c, 0x0d, 0x0e, 0x0f, 0x18, 0x19,
  0x1d, 0x25, 0x2c, 0x32, 0x33, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x78,
  0x7e
]);
const CHARACTER_ISPRMS = new Set([
  0x00, 0x41, 0x42, 0x43, 0x47, 0x4b, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x53,
  0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5e, 0x62, 0x68, 0x73,
  0x74, 0x75, 0x76, 0x7b, 0x7c
]);
const SUPPORTED_SIMPLE_ISPRMS = Object.freeze(
  [...PARAGRAPH_ISPRMS, ...CHARACTER_ISPRMS].sort((left, right) => left - right)
);
const SUPPORTED_SIMPLE_ISPRM_SET = new Set(SUPPORTED_SIMPLE_ISPRMS);

export function verifyOfficialMarketCalendarKrxLegacyWordPcdPrms(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrms {
  const clx = verifyOfficialMarketCalendarKrxLegacyWordClx(input);
  const clxReference =
    verifyOfficialMarketCalendarKrxLegacyWordClxReference(input);
  const plcPcd = verifyOfficialMarketCalendarKrxLegacyWordPlcPcd(input);
  const prcs = parsePrcs(clxReference.clxBytes, clx.pcdtOffset);
  if (
    plcPcd.pieces.length !== clx.pieceDescriptorCount ||
    clx.plcPcdBytes.length !==
      (plcPcd.pieces.length + 1) * 4 +
        plcPcd.pieces.length * PCD_BYTE_LENGTH
  ) {
    throw invalidPcdPrm();
  }
  const pcdByteOffset = (plcPcd.pieces.length + 1) * 4;
  const pieces = plcPcd.pieces.map((piece) => {
    const rawPrm = readUint16(
      clx.plcPcdBytes,
      pcdByteOffset + piece.index * PCD_BYTE_LENGTH + PCD_PRM_BYTE_OFFSET
    );
    if ((rawPrm & 0x0001) === 0) {
      return parsePrm0(piece, rawPrm);
    }
    const prcIndex = rawPrm >>> 1;
    const prc = prcs[prcIndex];
    if (prc === undefined) {
      throw invalidPcdPrm();
    }
    return Object.freeze({
      index: piece.index,
      cpStart: piece.cpStart,
      cpEnd: piece.cpEnd,
      rawPrm,
      kind: "prm1" as const,
      hasEffect: prc.grpprlByteLength > 0,
      isprm: null,
      val: null,
      simplePropertyGroup: null,
      simpleTableSprm: null,
      prcIndex
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_SCHEMA_VERSION,
    nFib: plcPcd.nFib,
    tableStreamName: plcPcd.tableStreamName,
    prcs: Object.freeze(prcs),
    pieces: Object.freeze(pieces),
    supportedSimpleIsprms: SUPPORTED_SIMPLE_ISPRMS,
    prm0AllowlistVerified: true,
    prm1PrcReferencesVerified: true,
    prcGrpprlFramingVerified: true,
    prcGrpprlSemanticsStatus: "not_parsed",
    tablePropertyApplicationStatus: "not_applied",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function parsePrcs(
  bytes: Uint8Array,
  pcdtOffset: number
): VerifiedOfficialMarketCalendarKrxLegacyWordPrc[] {
  const prcs: VerifiedOfficialMarketCalendarKrxLegacyWordPrc[] = [];
  let clxByteOffset = 0;
  while (clxByteOffset < pcdtOffset) {
    if (bytes[clxByteOffset] !== PRC_MARKER) {
      throw invalidPcdPrm();
    }
    const grpprlByteLength = readInt16(bytes, clxByteOffset + 1);
    const grpprlByteOffset = clxByteOffset + PRC_HEADER_BYTE_LENGTH;
    const grpprlByteEnd = grpprlByteOffset + grpprlByteLength;
    if (
      grpprlByteLength < 0 ||
      grpprlByteLength > MAXIMUM_GRPPRL_BYTE_LENGTH ||
      !Number.isSafeInteger(grpprlByteEnd) ||
      grpprlByteEnd > pcdtOffset
    ) {
      throw invalidPcdPrm();
    }
    const grpprlBytes = new Uint8Array(grpprlByteLength);
    for (let index = 0; index < grpprlByteLength; index += 1) {
      grpprlBytes[index] = bytes[grpprlByteOffset + index]!;
    }
    prcs.push(
      Object.freeze({
        index: prcs.length,
        clxByteOffset,
        grpprlByteOffset,
        grpprlByteLength,
        grpprlBytes,
        bytesOwnership: "caller_owned_copy"
      })
    );
    clxByteOffset = grpprlByteEnd;
  }
  if (clxByteOffset !== pcdtOffset) {
    throw invalidPcdPrm();
  }
  return prcs;
}

function parsePrm0(
  piece: { index: number; cpStart: number; cpEnd: number },
  rawPrm: number
): VerifiedOfficialMarketCalendarKrxLegacyWordPcdPrm {
  const isprm = (rawPrm >>> 1) & 0x007f;
  const val = rawPrm >>> 8;
  if (!SUPPORTED_SIMPLE_ISPRM_SET.has(isprm)) {
    throw invalidPcdPrm();
  }
  const hasEffect = isprm !== 0 || val !== 0;
  const simplePropertyGroup = !hasEffect
    ? "none"
    : PARAGRAPH_ISPRMS.has(isprm)
      ? "paragraph"
      : "character";
  return Object.freeze({
    index: piece.index,
    cpStart: piece.cpStart,
    cpEnd: piece.cpEnd,
    rawPrm,
    kind: "prm0",
    hasEffect,
    isprm,
    val,
    simplePropertyGroup,
    simpleTableSprm:
      isprm === 0x18
        ? SPRM_PF_IN_TABLE
        : isprm === 0x19
          ? SPRM_PF_TTP
          : null,
    prcIndex: null
  });
}

function readInt16(bytes: Uint8Array, offset: number): number {
  const value = readUint16(bytes, offset);
  return value >= 0x8000 ? value - 0x10000 : value;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidPcdPrm();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function invalidPcdPrm(): OfficialMarketCalendarKrxLegacyWordPcdPrmError {
  return new OfficialMarketCalendarKrxLegacyWordPcdPrmError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PCD_PRM_INVALID",
    "Official calendar KRX legacy Word Pcd Prm is invalid."
  );
}
