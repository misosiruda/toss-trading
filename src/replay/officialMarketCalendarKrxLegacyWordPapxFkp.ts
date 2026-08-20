import { verifyOfficialMarketCalendarKrxLegacyWordPapxFkpReferences } from "./officialMarketCalendarKrxLegacyWordPapxFkpReferences.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_papx_fkp.v1";

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPapxInFkp {
  paragraphIndex: number;
  fcStart: number;
  fcEnd: number;
  bOffset: number;
  papxByteOffset: number | null;
  cb: number | null;
  cbPrime: number | null;
  grpprlAndIstdByteOffset: number | null;
  grpprlAndIstdByteLength: number;
  grpprlAndIstdBytes: Uint8Array;
  propertiesStatus: "default" | "framing_verified";
  reservedBytesStatus: "ignored";
  bytesOwnership: "caller_owned_copy";
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkpPage {
  index: number;
  pn: number;
  fkpByteOffset: number;
  cpara: number;
  rgfc: readonly number[];
  bxPapByteOffset: number;
  bxPapByteLength: number;
  paragraphs: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPapxInFkp[];
}

export interface VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkp {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  cbMac: number;
  pages: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkpPage[];
  papxFkpFramingVerified: true;
  papxInFkpFramingVerified: true;
  grpprlAndIstdStatus: "not_parsed";
  paragraphPropertiesStatus: "not_parsed";
  tableSemanticsStatus: "not_verified";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordPapxFkpErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPapxFkpError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPapxFkpErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPapxFkpError";
  }
}

const FKP_BYTE_LENGTH = 512;
const CPARA_OFFSET = FKP_BYTE_LENGTH - 1;
const FC_BYTE_LENGTH = 4;
const BX_PAP_BYTE_LENGTH = 13;
const MIN_CPARA = 0x01;
const MAX_CPARA = 0x1d;

export function verifyOfficialMarketCalendarKrxLegacyWordPapxFkp(
  input: Uint8Array
): VerifiedOfficialMarketCalendarKrxLegacyWordPapxFkp {
  const references =
    verifyOfficialMarketCalendarKrxLegacyWordPapxFkpReferences(input);
  const pages = references.references.map((reference) => {
    const bytes = reference.fkpBytes;
    const cpara = bytes[CPARA_OFFSET]!;
    if (cpara < MIN_CPARA || cpara > MAX_CPARA) {
      throw invalidPapxFkp();
    }
    const rgfcCount = cpara + 1;
    const bxPapByteOffset = rgfcCount * FC_BYTE_LENGTH;
    const bxPapByteLength = cpara * BX_PAP_BYTE_LENGTH;
    const bxPapByteEnd = bxPapByteOffset + bxPapByteLength;
    if (bxPapByteEnd > CPARA_OFFSET) {
      throw invalidPapxFkp();
    }
    const rgfc: number[] = [];
    for (let index = 0; index < rgfcCount; index += 1) {
      const fc = readUint32(bytes, index * FC_BYTE_LENGTH);
      if (
        fc > references.cbMac ||
        (index > 0 && fc <= rgfc[index - 1]!)
      ) {
        throw invalidPapxFkp();
      }
      rgfc.push(fc);
    }
    const paragraphs: VerifiedOfficialMarketCalendarKrxLegacyWordPapxInFkp[] = [];
    for (let index = 0; index < cpara; index += 1) {
      const bOffset = bytes[bxPapByteOffset + index * BX_PAP_BYTE_LENGTH]!;
      paragraphs.push(
        parsePapxInFkp(bytes, {
          paragraphIndex: index,
          fcStart: rgfc[index]!,
          fcEnd: rgfc[index + 1]!,
          bOffset,
          minimumPapxByteOffset: bxPapByteEnd
        })
      );
    }
    return Object.freeze({
      index: reference.index,
      pn: reference.pn,
      fkpByteOffset: reference.fkpByteOffset,
      cpara,
      rgfc: Object.freeze(rgfc),
      bxPapByteOffset,
      bxPapByteLength,
      paragraphs: Object.freeze(paragraphs)
    });
  });

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_SCHEMA_VERSION,
    nFib: references.nFib,
    tableStreamName: references.tableStreamName,
    cbMac: references.cbMac,
    pages: Object.freeze(pages),
    papxFkpFramingVerified: true,
    papxInFkpFramingVerified: true,
    grpprlAndIstdStatus: "not_parsed",
    paragraphPropertiesStatus: "not_parsed",
    tableSemanticsStatus: "not_verified",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function parsePapxInFkp(
  bytes: Uint8Array,
  context: {
    paragraphIndex: number;
    fcStart: number;
    fcEnd: number;
    bOffset: number;
    minimumPapxByteOffset: number;
  }
): VerifiedOfficialMarketCalendarKrxLegacyWordPapxInFkp {
  if (context.bOffset === 0) {
    return Object.freeze({
      paragraphIndex: context.paragraphIndex,
      fcStart: context.fcStart,
      fcEnd: context.fcEnd,
      bOffset: 0,
      papxByteOffset: null,
      cb: null,
      cbPrime: null,
      grpprlAndIstdByteOffset: null,
      grpprlAndIstdByteLength: 0,
      grpprlAndIstdBytes: new Uint8Array(0),
      propertiesStatus: "default",
      reservedBytesStatus: "ignored",
      bytesOwnership: "caller_owned_copy"
    });
  }
  const papxByteOffset = context.bOffset * 2;
  if (
    papxByteOffset < context.minimumPapxByteOffset ||
    papxByteOffset >= CPARA_OFFSET
  ) {
    throw invalidPapxFkp();
  }
  const cb = bytes[papxByteOffset]!;
  let cbPrime: number | null = null;
  let grpprlAndIstdByteOffset: number;
  let grpprlAndIstdByteLength: number;
  if (cb === 0) {
    if (papxByteOffset + 2 > CPARA_OFFSET) {
      throw invalidPapxFkp();
    }
    cbPrime = bytes[papxByteOffset + 1]!;
    if (cbPrime < 1) {
      throw invalidPapxFkp();
    }
    grpprlAndIstdByteOffset = papxByteOffset + 2;
    grpprlAndIstdByteLength = cbPrime * 2;
  } else {
    grpprlAndIstdByteOffset = papxByteOffset + 1;
    grpprlAndIstdByteLength = cb * 2 - 1;
  }
  const grpprlAndIstdByteEnd =
    grpprlAndIstdByteOffset + grpprlAndIstdByteLength;
  if (
    grpprlAndIstdByteLength < 2 ||
    grpprlAndIstdByteEnd > CPARA_OFFSET
  ) {
    throw invalidPapxFkp();
  }
  const grpprlAndIstdBytes = new Uint8Array(grpprlAndIstdByteLength);
  for (let index = 0; index < grpprlAndIstdByteLength; index += 1) {
    grpprlAndIstdBytes[index] = bytes[grpprlAndIstdByteOffset + index]!;
  }
  return Object.freeze({
    paragraphIndex: context.paragraphIndex,
    fcStart: context.fcStart,
    fcEnd: context.fcEnd,
    bOffset: context.bOffset,
    papxByteOffset,
    cb,
    cbPrime,
    grpprlAndIstdByteOffset,
    grpprlAndIstdByteLength,
    grpprlAndIstdBytes,
    propertiesStatus: "framing_verified",
    reservedBytesStatus: "ignored",
    bytesOwnership: "caller_owned_copy"
  });
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw invalidPapxFkp();
  }
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function invalidPapxFkp(): OfficialMarketCalendarKrxLegacyWordPapxFkpError {
  return new OfficialMarketCalendarKrxLegacyWordPapxFkpError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PAPX_FKP_INVALID",
    "Official calendar KRX legacy Word PapxFkp is invalid."
  );
}
