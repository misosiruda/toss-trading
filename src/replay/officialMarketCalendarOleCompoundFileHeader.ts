export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_HEADER_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_header.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileHeader {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_HEADER_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  minorVersion: 62;
  sectorSize: 512 | 4096;
  miniSectorSize: 64;
  miniStreamCutoffSize: 4096;
  fileSectorCount: number;
  fatSectorCount: number;
  directorySectorCount: number;
  miniFatSectorCount: number;
  difatSectorCount: number;
  headerVerified: true;
  structureStatus: "header_only_not_verified";
}

export type OfficialMarketCalendarOleCompoundFileHeaderErrorCode =
  | "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_INPUT"
  | "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_SIGNATURE"
  | "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_FIELDS"
  | "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_SECTOR_LAYOUT";

export class OfficialMarketCalendarOleCompoundFileHeaderError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileHeaderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileHeaderError";
  }
}

const HEADER_BYTE_LENGTH = 512;
const HEADER_SIGNATURE = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1
]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;
const HEADER_DIFAT_ENTRY_COUNT = 109;
const HEADER_DIFAT_OFFSET = 76;

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
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength"
      )?.get;

export function verifyOfficialMarketCalendarOleCompoundFileHeader(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileHeader {
  const byteView = readByteView(input);
  const { byteLength, view } = byteView;
  if (!hasBytes(input, 0, HEADER_SIGNATURE)) {
    throw headerError(
      "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_SIGNATURE",
      "Official calendar OLE compound file signature is invalid."
    );
  }
  const majorVersion = view.getUint16(26, true);
  const minorVersion = view.getUint16(24, true);
  const sectorShift = view.getUint16(30, true);
  const sectorSize = 2 ** sectorShift;
  const miniSectorShift = view.getUint16(32, true);
  const miniStreamCutoffSize = view.getUint32(56, true);
  const directorySectorCount = view.getUint32(40, true);
  const fatSectorCount = view.getUint32(44, true);
  const firstDirectorySector = view.getUint32(48, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const difatSectorCount = view.getUint32(72, true);

  if (
    !hasZeroBytes(input, 8, 16) ||
    minorVersion !== 62 ||
    (majorVersion !== 3 && majorVersion !== 4) ||
    view.getUint16(28, true) !== 0xfffe ||
    (majorVersion === 3 ? sectorShift !== 9 : sectorShift !== 12) ||
    miniSectorShift !== 6 ||
    !hasZeroBytes(input, 34, 6) ||
    (majorVersion === 3 && directorySectorCount !== 0) ||
    (majorVersion === 4 && !hasZeroBytes(input, 512, 4096 - 512)) ||
    miniStreamCutoffSize !== 4096 ||
    fatSectorCount < 1
  ) {
    throw headerError(
      "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_FIELDS",
      "Official calendar OLE compound file header fields are invalid."
    );
  }
  if (byteLength % sectorSize !== 0 || byteLength < sectorSize * 2) {
    throw layoutError();
  }
  const fileSectorCount = byteLength / sectorSize - 1;
  const expectedDifatSectorCount = Math.ceil(
    Math.max(0, fatSectorCount - HEADER_DIFAT_ENTRY_COUNT) /
      (sectorSize / 4 - 1)
  );
  const declaredDirectorySectorCount =
    majorVersion === 3 ? 1 : directorySectorCount;
  if (
    fatSectorCount > fileSectorCount ||
    fatSectorCount * (sectorSize / 4) < fileSectorCount ||
    declaredDirectorySectorCount < 1 ||
    declaredDirectorySectorCount > fileSectorCount ||
    miniFatSectorCount > fileSectorCount ||
    difatSectorCount > fileSectorCount ||
    fatSectorCount +
      declaredDirectorySectorCount +
      miniFatSectorCount +
      difatSectorCount >
      fileSectorCount ||
    difatSectorCount !== expectedDifatSectorCount ||
    !isFileSector(firstDirectorySector, fileSectorCount) ||
    !hasConsistentChainStart(
      firstMiniFatSector,
      miniFatSectorCount,
      fileSectorCount
    ) ||
    !hasConsistentChainStart(firstDifatSector, difatSectorCount, fileSectorCount) ||
    (fatSectorCount > HEADER_DIFAT_ENTRY_COUNT && difatSectorCount === 0)
  ) {
    throw layoutError();
  }
  const headerFatSectors = verifyHeaderDifat(
    view,
    fatSectorCount,
    fileSectorCount
  );
  const declaredChainStarts = [firstDirectorySector];
  if (miniFatSectorCount > 0) {
    declaredChainStarts.push(firstMiniFatSector);
  }
  if (difatSectorCount > 0) {
    declaredChainStarts.push(firstDifatSector);
  }
  if (
    new Set(declaredChainStarts).size !== declaredChainStarts.length ||
    declaredChainStarts.some((sector) => headerFatSectors.has(sector))
  ) {
    throw layoutError();
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_HEADER_SCHEMA_VERSION,
    majorVersion,
    minorVersion: 62,
    sectorSize: sectorSize as 512 | 4096,
    miniSectorSize: 64,
    miniStreamCutoffSize: 4096,
    fileSectorCount,
    fatSectorCount,
    directorySectorCount,
    miniFatSectorCount,
    difatSectorCount,
    headerVerified: true,
    structureStatus: "header_only_not_verified"
  });
}

function verifyHeaderDifat(
  view: DataView,
  fatSectorCount: number,
  fileSectorCount: number
): ReadonlySet<number> {
  const headerFatCount = Math.min(fatSectorCount, HEADER_DIFAT_ENTRY_COUNT);
  const seen = new Set<number>();
  for (let index = 0; index < HEADER_DIFAT_ENTRY_COUNT; index += 1) {
    const sector = view.getUint32(HEADER_DIFAT_OFFSET + index * 4, true);
    if (index < headerFatCount) {
      if (!isFileSector(sector, fileSectorCount) || seen.has(sector)) {
        throw layoutError();
      }
      seen.add(sector);
    } else if (sector !== FREESECT) {
      throw layoutError();
    }
  }
  return seen;
}

function readByteView(value: unknown): Readonly<{
  byteLength: number;
  view: DataView;
}> {
  try {
    if (
      Object.getPrototypeOf(value) !== Uint8Array.prototype ||
      typedArrayByteLengthGetter === undefined ||
      typedArrayBufferGetter === undefined ||
      typedArrayByteOffsetGetter === undefined
    ) {
      throw new Error("invalid byte view");
    }
    const byteLength = typedArrayByteLengthGetter.call(value) as number;
    const buffer = typedArrayBufferGetter.call(value) as ArrayBufferLike;
    const byteOffset = typedArrayByteOffsetGetter.call(value) as number;
    if (
      byteLength < HEADER_BYTE_LENGTH ||
      hasSharedArrayBufferBacking(buffer)
    ) {
      throw new Error("invalid byte view backing");
    }
    return Object.freeze({
      byteLength,
      view: new DataView(buffer as ArrayBuffer, byteOffset, byteLength)
    });
  } catch {
    throw headerError(
      "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_INPUT",
      "Official calendar OLE compound file input is invalid."
    );
  }
}

function hasConsistentChainStart(
  firstSector: number,
  sectorCount: number,
  fileSectorCount: number
): boolean {
  return sectorCount === 0
    ? firstSector === ENDOFCHAIN
    : isFileSector(firstSector, fileSectorCount);
}

function isFileSector(value: number, fileSectorCount: number): boolean {
  return value <= MAXREGSECT && value < fileSectorCount;
}

function hasBytes(
  value: Uint8Array,
  offset: number,
  expected: Uint8Array
): boolean {
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (value[offset + index] !== expected[index]) {
      return false;
    }
  }
  return true;
}

function hasZeroBytes(
  value: Uint8Array,
  offset: number,
  length: number
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (value[offset + index] !== 0) {
      return false;
    }
  }
  return true;
}

function hasSharedArrayBufferBacking(buffer: ArrayBufferLike): boolean {
  if (sharedArrayBufferByteLengthGetter === undefined) {
    return false;
  }
  try {
    sharedArrayBufferByteLengthGetter.call(buffer);
    return true;
  } catch {
    return false;
  }
}

function layoutError(): OfficialMarketCalendarOleCompoundFileHeaderError {
  return headerError(
    "OFFICIAL_CALENDAR_OLE_HEADER_INVALID_SECTOR_LAYOUT",
    "Official calendar OLE compound file sector layout is invalid."
  );
}

function headerError(
  code: OfficialMarketCalendarOleCompoundFileHeaderErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileHeaderError {
  return new OfficialMarketCalendarOleCompoundFileHeaderError(code, message);
}
