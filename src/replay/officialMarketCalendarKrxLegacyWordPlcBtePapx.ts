import { verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference } from "./officialMarketCalendarKrxLegacyWordPlcBtePapxReference.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_plc_bte_papx.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPnFkpPapx {
  index: number;
  fcStart: number;
  fcEnd: number;
  pn: number;
  fkpByteOffset: number;
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPlcBtePapx {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  fcPlcfBtePapx: number;
  lcbPlcfBtePapx: number;
  fileOffsets: readonly number[];
  entries: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPnFkpPapx[];
  plcBtePapxFramingVerified: true;
  pnFkpPapxDescriptorsVerified: true;
  fkpReferencesStatus: "not_verified";
  papxFkpStatus: "not_parsed";
  paragraphPropertiesStatus: "not_parsed";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPlcBtePapxErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPlcBtePapxError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPlcBtePapxErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPlcBtePapxError";
  }
}

const FC_SIZE = 4;
const PN_FKP_PAPX_SIZE = 4;
const PN_MASK = 0x003fffff;
const FKP_BYTE_LENGTH = 512;

export function verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapx(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPlcBtePapx {
  const reference =
    verifyOfficialMarketCalendarKrxLegacyWordPlcBtePapxReference(input);
  const bytes = reference.plcBtePapxBytes;
  if (
    bytes.length < FC_SIZE ||
    (bytes.length - FC_SIZE) % (FC_SIZE + PN_FKP_PAPX_SIZE) !== 0
  ) {
    throw invalidPlcBtePapx();
  }
  const entryCount =
    (bytes.length - FC_SIZE) / (FC_SIZE + PN_FKP_PAPX_SIZE);
  const fcCount = entryCount + 1;
  const entriesOffset = fcCount * FC_SIZE;
  const fileOffsets: number[] = [];
  for (let index = 0; index < fcCount; index += 1) {
    const fc = readUint32(bytes, index * FC_SIZE);
    if (index > 0 && fc <= fileOffsets[index - 1]!) {
      throw invalidPlcBtePapx();
    }
    fileOffsets.push(fc);
  }
  const entries: VerifiedOfficialMarketCalendarKrxLegacyWordPnFkpPapx[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const pn =
      readUint32(bytes, entriesOffset + index * PN_FKP_PAPX_SIZE) & PN_MASK;
    entries.push(
      Object.freeze({
        index,
        fcStart: fileOffsets[index]!,
        fcEnd: fileOffsets[index + 1]!,
        pn,
        fkpByteOffset: pn * FKP_BYTE_LENGTH
      })
    );
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_SCHEMA_VERSION,
    nFib: reference.nFib,
    tableStreamName: reference.tableStreamName,
    fcPlcfBtePapx: reference.fcPlcfBtePapx,
    lcbPlcfBtePapx: reference.lcbPlcfBtePapx,
    fileOffsets: Object.freeze(fileOffsets),
    entries: Object.freeze(entries),
    plcBtePapxFramingVerified: true,
    pnFkpPapxDescriptorsVerified: true,
    fkpReferencesStatus: "not_verified",
    papxFkpStatus: "not_parsed",
    paragraphPropertiesStatus: "not_parsed",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidPlcBtePapx();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidPlcBtePapx(): OfficialMarketCalendarKrxLegacyWordPlcBtePapxError {
  return new OfficialMarketCalendarKrxLegacyWordPlcBtePapxError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PLC_BTE_PAPX_INVALID",
    "Official calendar KRX legacy Word PlcBtePapx is invalid."
  );
}
