import { verifyOfficialMarketCalendarOleCompoundFileRootMiniStream } from "./officialMarketCalendarOleCompoundFileRootMiniStream.js";
import {
  verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation,
  type VerifiedOfficialMarketCalendarOleUserStreamAllocation
} from "./officialMarketCalendarOleCompoundFileUserStreamAllocation.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_BYTES_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_user_stream_bytes.v1";

export interface ProjectedOfficialMarketCalendarOleUserStreamBytes {
  streamId: number;
  name: string;
  streamSize: string;
  allocation: "empty" | "mini_fat" | "fat";
  bytes: Uint8Array;
  bytesOwnership: "caller_owned_copy";
}

export interface ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_BYTES_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  miniSectorSize: 64;
  streams: readonly ProjectedOfficialMarketCalendarOleUserStreamBytes[];
  streamBytesProjected: true;
  trailingAllocationBytesStatus: "excluded";
  wordDocumentStatus: "not_parsed";
}

export type OfficialMarketCalendarOleCompoundFileUserStreamBytesErrorCode =
  "OFFICIAL_CALENDAR_OLE_USER_STREAM_BYTES_INVALID_PROJECTION";

export class OfficialMarketCalendarOleCompoundFileUserStreamBytesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileUserStreamBytesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileUserStreamBytesError";
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

export function projectOfficialMarketCalendarOleCompoundFileUserStreamBytes(
  input: Uint8Array
): ProjectedOfficialMarketCalendarOleCompoundFileUserStreamBytes {
  const allocation =
    verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(input);
  const rootMiniStream =
    verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(input);
  const streams = allocation.streams.map((stream) =>
    projectStream(
      input,
      stream,
      allocation.sectorSize,
      rootMiniStream.rootMiniStreamSectorLocations
    )
  );

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_BYTES_SCHEMA_VERSION,
    majorVersion: allocation.majorVersion,
    sectorSize: allocation.sectorSize,
    miniSectorSize: allocation.miniSectorSize,
    streams: Object.freeze([...streams]),
    streamBytesProjected: true,
    trailingAllocationBytesStatus: "excluded",
    wordDocumentStatus: "not_parsed"
  });
}

function projectStream(
  input: Uint8Array,
  stream: VerifiedOfficialMarketCalendarOleUserStreamAllocation,
  sectorSize: number,
  rootMiniStreamSectorLocations: readonly number[]
): ProjectedOfficialMarketCalendarOleUserStreamBytes {
  const streamSize = safeStreamSize(stream.streamSize);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(streamSize);
  } catch {
    throw projectionError();
  }
  let targetOffset = 0;

  for (const sectorLocation of stream.sectorLocations) {
    if (targetOffset === streamSize) {
      break;
    }
    const sourceOffset =
      stream.allocation === "mini_fat"
        ? miniSectorFileOffset(
            sectorLocation,
            sectorSize,
            rootMiniStreamSectorLocations
          )
        : fileSectorOffset(sectorLocation, sectorSize);
    const allocationByteLength =
      stream.allocation === "mini_fat" ? 64 : sectorSize;
    const copyByteLength = Math.min(
      allocationByteLength,
      streamSize - targetOffset
    );
    copyRange(input, sourceOffset, bytes, targetOffset, copyByteLength);
    targetOffset += copyByteLength;
  }

  if (targetOffset !== streamSize) {
    throw projectionError();
  }

  return Object.freeze({
    streamId: stream.streamId,
    name: stream.name,
    streamSize: stream.streamSize,
    allocation: stream.allocation,
    bytes,
    bytesOwnership: "caller_owned_copy"
  });
}

function miniSectorFileOffset(
  miniSectorLocation: number,
  sectorSize: number,
  rootMiniStreamSectorLocations: readonly number[]
): number {
  const logicalOffset = miniSectorLocation * 64;
  const rootSectorIndex = Math.floor(logicalOffset / sectorSize);
  const rootSectorLocation = rootMiniStreamSectorLocations[rootSectorIndex];
  if (rootSectorLocation === undefined) {
    throw projectionError();
  }
  return fileSectorOffset(rootSectorLocation, sectorSize) +
    (logicalOffset % sectorSize);
}

function fileSectorOffset(sectorLocation: number, sectorSize: number): number {
  return (sectorLocation + 1) * sectorSize;
}

function copyRange(
  source: Uint8Array,
  sourceOffset: number,
  target: Uint8Array,
  targetOffset: number,
  byteLength: number
): void {
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
    const sourceRange = new Uint8Array(
      sourceView.buffer,
      sourceView.byteOffset + sourceOffset,
      byteLength
    );
    uint8ArraySet.call(target, sourceRange, targetOffset);
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

function safeStreamSize(value: string): number {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw projectionError();
  }
  return Number(parsed);
}

function projectionError(): OfficialMarketCalendarOleCompoundFileUserStreamBytesError {
  return new OfficialMarketCalendarOleCompoundFileUserStreamBytesError(
    "OFFICIAL_CALENDAR_OLE_USER_STREAM_BYTES_INVALID_PROJECTION",
    "Official calendar OLE user stream bytes cannot be projected safely."
  );
}
