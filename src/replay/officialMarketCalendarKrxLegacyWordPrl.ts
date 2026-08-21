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

export type OfficialMarketCalendarKrxLegacyWordPrlErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PRL_INVALID";

export class OfficialMarketCalendarKrxLegacyWordPrlError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordPrlErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordPrlError";
  }
}

const SPRM_BYTE_LENGTH = 2;
const SPRM_T_DEF_TABLE = 0xd608;
const SPRM_P_CHG_TABS = 0xc615;
const FIXED_OPERAND_BYTE_LENGTHS = [1, 1, 2, 4, 2, 2, null, 3] as const;

export function parseOfficialMarketCalendarKrxLegacyWordPrls(
  bytes: Uint8Array,
  startByteOffset = 0
): readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] {
  if (
    !Number.isSafeInteger(startByteOffset) ||
    startByteOffset < 0 ||
    startByteOffset > bytes.length
  ) {
    throw invalidPrl();
  }
  const prls: VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] = [];
  let byteOffset = startByteOffset;
  while (byteOffset < bytes.length) {
    const parsed = parsePrl(bytes, byteOffset, prls.length);
    prls.push(parsed.prl);
    byteOffset = parsed.byteEnd;
  }
  if (byteOffset !== bytes.length) {
    throw invalidPrl();
  }
  return Object.freeze(prls);
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
    throw invalidPrl();
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
    throw invalidPrl();
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
      throw invalidPrl();
    }
    return {
      byteLength: cb + 1,
      kind: "t_def_table_two_byte_prefix"
    };
  }
  if (operandByteOffset >= bytes.length) {
    throw invalidPrl();
  }
  const cb = bytes[operandByteOffset]!;
  if (sprm === SPRM_P_CHG_TABS && (cb < 2 || cb === 0xff)) {
    throw invalidPrl();
  }
  return { byteLength: cb + 1, kind: "one_byte_prefix" };
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw invalidPrl();
  }
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function invalidPrl(): OfficialMarketCalendarKrxLegacyWordPrlError {
  return new OfficialMarketCalendarKrxLegacyWordPrlError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_PRL_INVALID",
    "Official calendar KRX legacy Word Prl is invalid."
  );
}
