import { verifyOfficialMarketCalendarKrxLegacyWordPapxFkp } from "./officialMarketCalendarKrxLegacyWordPapxFkp.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_grpprl.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPrl {
  index: number;
  byteOffset: number;
  sprm: number;
  ispmd: number;
  fSpec: boolean;
  sgc: 1 | 2 | 3 | 4 | 5;
  spra: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  operandByteOffset: number;
  operandByteLength: number;
  operandBytes: Uint8Array;
  operandLengthKind:
    | "fixed"
    | "one_byte_prefix"
    | "t_def_table_two_byte_prefix";
  bytesOwnership: "caller_owned_copy";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrl {
  pageIndex: number;
  paragraphIndex: number;
  fcStart: number;
  fcEnd: number;
  istd: number | null;
  prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  propertiesStatus: "default" | "framing_verified";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrls {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  groups: readonly VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrl[];
  grpprlAndIstdFramingVerified: true;
  sprmFramingVerified: true;
  tDefTableLengthStatus: "supported";
  pChgTabs255Status: "rejected_unsupported";
  sprmSemanticsStatus: "not_verified";
  tableSemanticsStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordGrpPrlErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_GRPPRL_INVALID";

export class OfficialMarketCalendarKrxLegacyWordGrpPrlError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordGrpPrlErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordGrpPrlError";
  }
}

const SPRM_BYTE_LENGTH = 2;
const ISTD_BYTE_LENGTH = 2;
const SPRM_T_DEF_TABLE = 0xd608;
const SPRM_P_CHG_TABS = 0xc615;
const FIXED_OPERAND_BYTE_LENGTHS = [1, 1, 2, 4, 2, 2, null, 3] as const;

export function verifyOfficialMarketCalendarKrxLegacyWordGrpPrls(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrls {
  const papxFkp = verifyOfficialMarketCalendarKrxLegacyWordPapxFkp(input);
  const groups: VerifiedOfficialMarketCalendarKrxLegacyWordGrpPrl[] = [];
  for (const page of papxFkp.pages) {
    for (const paragraph of page.paragraphs) {
      if (paragraph.propertiesStatus === "default") {
        groups.push(
          Object.freeze({
            pageIndex: page.index,
            paragraphIndex: paragraph.paragraphIndex,
            fcStart: paragraph.fcStart,
            fcEnd: paragraph.fcEnd,
            istd: null,
            prls: Object.freeze([]),
            propertiesStatus: "default"
          })
        );
        continue;
      }
      const bytes = paragraph.grpprlAndIstdBytes;
      if (bytes.length < ISTD_BYTE_LENGTH) {
        throw invalidGrpPrl();
      }
      const istd = readUint16(bytes, 0);
      const prls: VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] = [];
      let byteOffset = ISTD_BYTE_LENGTH;
      while (byteOffset < bytes.length) {
        const parsed = parsePrl(bytes, byteOffset, prls.length);
        prls.push(parsed.prl);
        byteOffset = parsed.byteEnd;
      }
      if (byteOffset !== bytes.length) {
        throw invalidGrpPrl();
      }
      groups.push(
        Object.freeze({
          pageIndex: page.index,
          paragraphIndex: paragraph.paragraphIndex,
          fcStart: paragraph.fcStart,
          fcEnd: paragraph.fcEnd,
          istd,
          prls: Object.freeze(prls),
          propertiesStatus: "framing_verified"
        })
      );
    }
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_GRPPRL_SCHEMA_VERSION,
    nFib: papxFkp.nFib,
    tableStreamName: papxFkp.tableStreamName,
    groups: Object.freeze(groups),
    grpprlAndIstdFramingVerified: true,
    sprmFramingVerified: true,
    tDefTableLengthStatus: "supported",
    pChgTabs255Status: "rejected_unsupported",
    sprmSemanticsStatus: "not_verified",
    tableSemanticsStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function parsePrl(
  bytes: Uint8Array,
  byteOffset: number,
  index: number
): { prl: VerifiedOfficialMarketCalendarKrxLegacyWordPrl; byteEnd: number } {
  const sprm = readUint16(bytes, byteOffset);
  const ispmd = sprm & 0x01ff;
  const fSpec = (sprm & 0x0200) !== 0;
  const sgc = (sprm >>> 10) & 0x07;
  const spra = (sprm >>> 13) & 0x07;
  if (sgc < 1 || sgc > 5) {
    throw invalidGrpPrl();
  }
  const operandByteOffset = byteOffset + SPRM_BYTE_LENGTH;
  const variableLength = resolveVariableOperandByteLength(
    bytes,
    operandByteOffset,
    sprm,
    spra
  );
  const fixedLength = FIXED_OPERAND_BYTE_LENGTHS[spra];
  const operandByteLength = fixedLength ?? variableLength.byteLength;
  const byteEnd = operandByteOffset + operandByteLength;
  if (byteEnd > bytes.length) {
    throw invalidGrpPrl();
  }
  const operandBytes = new Uint8Array(operandByteLength);
  for (let operandIndex = 0; operandIndex < operandByteLength; operandIndex += 1) {
    operandBytes[operandIndex] = bytes[operandByteOffset + operandIndex]!;
  }
  return {
    prl: Object.freeze({
      index,
      byteOffset,
      sprm,
      ispmd,
      fSpec,
      sgc: sgc as 1 | 2 | 3 | 4 | 5,
      spra: spra as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
      operandByteOffset,
      operandByteLength,
      operandBytes,
      operandLengthKind:
        fixedLength === null ? variableLength.kind : "fixed",
      bytesOwnership: "caller_owned_copy"
    }),
    byteEnd
  };
}

function resolveVariableOperandByteLength(
  bytes: Uint8Array,
  operandByteOffset: number,
  sprm: number,
  spra: number
): {
  byteLength: number;
  kind: "one_byte_prefix" | "t_def_table_two_byte_prefix";
} {
  if (spra !== 6) {
    return { byteLength: 0, kind: "one_byte_prefix" };
  }
  if (sprm === SPRM_T_DEF_TABLE) {
    const cb = readUint16(bytes, operandByteOffset);
    if (cb < 2) {
      throw invalidGrpPrl();
    }
    return {
      byteLength: cb + 1,
      kind: "t_def_table_two_byte_prefix"
    };
  }
  if (operandByteOffset >= bytes.length) {
    throw invalidGrpPrl();
  }
  const cb = bytes[operandByteOffset]!;
  if (sprm === SPRM_P_CHG_TABS && (cb < 2 || cb === 0xff)) {
    throw invalidGrpPrl();
  }
  return { byteLength: cb + 1, kind: "one_byte_prefix" };
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidGrpPrl();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function invalidGrpPrl(): OfficialMarketCalendarKrxLegacyWordGrpPrlError {
  return new OfficialMarketCalendarKrxLegacyWordGrpPrlError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_GRPPRL_INVALID",
    "Official calendar KRX legacy Word GrpPrlAndIstd is invalid."
  );
}
