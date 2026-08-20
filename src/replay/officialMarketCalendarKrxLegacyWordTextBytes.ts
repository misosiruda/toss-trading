import { verifyOfficialMarketCalendarKrxLegacyWordFib } from "./officialMarketCalendarKrxLegacyWordFib.js";
import { verifyOfficialMarketCalendarKrxLegacyWordTextRanges } from "./officialMarketCalendarKrxLegacyWordTextRanges.js";

export const OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_SCHEMA_VERSION =
  "official_market_calendar_krx_legacy_word_text_bytes.v1";

export interface ProjectedOfficialMarketCalendarKrxLegacyWordTextPieceBytes {
  index: number;
  cpStart: number;
  cpEnd: number;
  characterCount: number;
  encoding: "compressed_8bit" | "unicode_16le";
  byteStart: number;
  byteLength: number;
  byteEnd: number;
  bytes: Uint8Array;
  bytesOwnership: "caller_owned_copy";
}

export interface ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_SCHEMA_VERSION;
  nFib: 0x00c1 | 0x00d9 | 0x0101 | 0x010c | 0x0112;
  tableStreamName: "0Table" | "1Table";
  cbMac: number;
  pieces: readonly ProjectedOfficialMarketCalendarKrxLegacyWordTextPieceBytes[];
  textBytesProjected: true;
  textDecodingStatus: "not_decoded";
  sourceRoleStatus: "candidate_not_accepted";
}

export type OfficialMarketCalendarKrxLegacyWordTextBytesErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_INVALID_PROJECTION";

export class OfficialMarketCalendarKrxLegacyWordTextBytesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordTextBytesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordTextBytesError";
  }
}

const uint8ArraySet = Uint8Array.prototype.set;
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength"
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer"
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset"
)?.get;

export function projectOfficialMarketCalendarKrxLegacyWordTextBytes(
  input: Uint8Array
): ProjectedOfficialMarketCalendarKrxLegacyWordTextBytes {
  const ranges = verifyOfficialMarketCalendarKrxLegacyWordTextRanges(input);
  const fib = verifyOfficialMarketCalendarKrxLegacyWordFib(input);
  if (
    ranges.nFib !== fib.nFib ||
    ranges.tableStreamName !== fib.tableStreamName
  ) {
    throw projectionError();
  }
  const pieces = ranges.ranges.map((range) =>
    Object.freeze({
      ...range,
      bytes: copyRange(fib.wordDocumentBytes, range.byteStart, range.byteLength),
      bytesOwnership: "caller_owned_copy" as const
    })
  );

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_SCHEMA_VERSION,
    nFib: ranges.nFib,
    tableStreamName: ranges.tableStreamName,
    cbMac: ranges.cbMac,
    pieces: Object.freeze(pieces),
    textBytesProjected: true,
    textDecodingStatus: "not_decoded",
    sourceRoleStatus: "candidate_not_accepted"
  });
}

function copyRange(
  source: Uint8Array,
  sourceOffset: number,
  byteLength: number
): Uint8Array {
  const sourceView = intrinsicByteView(source);
  if (
    !Number.isSafeInteger(sourceOffset) ||
    !Number.isSafeInteger(byteLength) ||
    !Number.isSafeInteger(sourceOffset + byteLength) ||
    sourceOffset < 0 ||
    byteLength < 0 ||
    sourceOffset + byteLength > sourceView.byteLength
  ) {
    throw projectionError();
  }
  try {
    const target = new Uint8Array(byteLength);
    const sourceRange = new Uint8Array(
      sourceView.buffer,
      sourceView.byteOffset + sourceOffset,
      byteLength
    );
    uint8ArraySet.call(target, sourceRange);
    return target;
  } catch {
    throw projectionError();
  }
}

function intrinsicByteView(source: Uint8Array): {
  buffer: ArrayBuffer;
  byteLength: number;
  byteOffset: number;
} {
  if (
    typedArrayByteLengthGetter === undefined ||
    typedArrayBufferGetter === undefined ||
    typedArrayByteOffsetGetter === undefined
  ) {
    throw projectionError();
  }
  try {
    return {
      buffer: typedArrayBufferGetter.call(source) as ArrayBuffer,
      byteLength: typedArrayByteLengthGetter.call(source) as number,
      byteOffset: typedArrayByteOffsetGetter.call(source) as number
    };
  } catch {
    throw projectionError();
  }
}

function projectionError(): OfficialMarketCalendarKrxLegacyWordTextBytesError {
  return new OfficialMarketCalendarKrxLegacyWordTextBytesError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_TEXT_BYTES_INVALID_PROJECTION",
    "Official calendar KRX legacy Word text bytes cannot be projected safely."
  );
}
