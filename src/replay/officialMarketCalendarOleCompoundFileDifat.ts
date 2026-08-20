import { verifyOfficialMarketCalendarOleCompoundFileHeader } from "./officialMarketCalendarOleCompoundFileHeader.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIFAT_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_difat.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileDifat {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIFAT_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  fileSectorCount: number;
  fatSectorCount: number;
  difatSectorCount: number;
  fatSectorLocations: readonly number[];
  difatSectorLocations: readonly number[];
  difatVerified: true;
  fatStructureStatus: "locations_only_not_verified";
}

export type OfficialMarketCalendarOleCompoundFileDifatErrorCode =
  | "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_INPUT"
  | "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_CHAIN"
  | "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION"
  | "OFFICIAL_CALENDAR_OLE_DIFAT_SECTOR_ROLE_COLLISION";

export class OfficialMarketCalendarOleCompoundFileDifatError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileDifatErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileDifatError";
  }
}

const HEADER_DIFAT_OFFSET = 76;
const HEADER_DIFAT_ENTRY_COUNT = 109;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;

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

export function verifyOfficialMarketCalendarOleCompoundFileDifat(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileDifat {
  const header = verifyOfficialMarketCalendarOleCompoundFileHeader(input);
  const view = readIntrinsicDataView(input);
  const fatSectorCount = view.getUint32(44, true);
  const firstDirectorySector = view.getUint32(48, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const difatSectorCount = view.getUint32(72, true);
  const fatSectorLocations: number[] = [];
  const fatLocationSet = new Set<number>();
  const headerFatLocationCount = Math.min(
    fatSectorCount,
    HEADER_DIFAT_ENTRY_COUNT
  );

  for (let index = 0; index < headerFatLocationCount; index += 1) {
    const sector = view.getUint32(HEADER_DIFAT_OFFSET + index * 4, true);
    addFatLocation(
      sector,
      header.fileSectorCount,
      fatSectorLocations,
      fatLocationSet
    );
  }

  const difatSectorLocations: number[] = [];
  const difatLocationSet = new Set<number>();
  const difatFatEntryCapacity = header.sectorSize / 4 - 1;
  let remainingFatLocations = fatSectorCount - headerFatLocationCount;
  let currentDifatSector = firstDifatSector;

  for (let chainIndex = 0; chainIndex < difatSectorCount; chainIndex += 1) {
    if (
      !isFileSector(currentDifatSector, header.fileSectorCount) ||
      difatLocationSet.has(currentDifatSector) ||
      fatLocationSet.has(currentDifatSector)
    ) {
      throw difatError(
        "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_CHAIN",
        "Official calendar OLE DIFAT chain is invalid."
      );
    }
    difatLocationSet.add(currentDifatSector);
    difatSectorLocations.push(currentDifatSector);
    const sectorOffset = sectorByteOffset(
      currentDifatSector,
      header.sectorSize
    );
    const usedEntryCount = Math.min(
      remainingFatLocations,
      difatFatEntryCapacity
    );
    for (let entryIndex = 0; entryIndex < difatFatEntryCapacity; entryIndex += 1) {
      const sector = view.getUint32(sectorOffset + entryIndex * 4, true);
      if (entryIndex < usedEntryCount) {
        addFatLocation(
          sector,
          header.fileSectorCount,
          fatSectorLocations,
          fatLocationSet
        );
      } else if (sector !== FREESECT) {
        throw difatError(
          "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION",
          "Official calendar OLE DIFAT unused FAT location is invalid."
        );
      }
    }
    remainingFatLocations -= usedEntryCount;
    const nextDifatSector = view.getUint32(
      sectorOffset + difatFatEntryCapacity * 4,
      true
    );
    const isLast = chainIndex === difatSectorCount - 1;
    if (
      (isLast && nextDifatSector !== ENDOFCHAIN) ||
      (!isLast && !isFileSector(nextDifatSector, header.fileSectorCount))
    ) {
      throw difatError(
        "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_CHAIN",
        "Official calendar OLE DIFAT chain termination is invalid."
      );
    }
    currentDifatSector = nextDifatSector;
  }

  if (
    remainingFatLocations !== 0 ||
    fatSectorLocations.length !== fatSectorCount ||
    difatSectorLocations.length !== difatSectorCount
  ) {
    throw difatError(
      "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_CHAIN",
      "Official calendar OLE DIFAT chain length is invalid."
    );
  }

  const fixedRoleLocations = [firstDirectorySector];
  if (miniFatSectorCount > 0) {
    fixedRoleLocations.push(firstMiniFatSector);
  }
  if (
    fixedRoleLocations.some(
      (sector) =>
        fatLocationSet.has(sector) || difatLocationSet.has(sector)
    ) ||
    difatSectorLocations.some((sector) => fatLocationSet.has(sector))
  ) {
    throw difatError(
      "OFFICIAL_CALENDAR_OLE_DIFAT_SECTOR_ROLE_COLLISION",
      "Official calendar OLE DIFAT sector roles collide."
    );
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIFAT_SCHEMA_VERSION,
    majorVersion: header.majorVersion,
    sectorSize: header.sectorSize,
    fileSectorCount: header.fileSectorCount,
    fatSectorCount,
    difatSectorCount,
    fatSectorLocations: Object.freeze([...fatSectorLocations]),
    difatSectorLocations: Object.freeze([...difatSectorLocations]),
    difatVerified: true,
    fatStructureStatus: "locations_only_not_verified"
  });
}

function addFatLocation(
  sector: number,
  fileSectorCount: number,
  locations: number[],
  seen: Set<number>
): void {
  if (!isFileSector(sector, fileSectorCount) || seen.has(sector)) {
    throw difatError(
      "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_FAT_LOCATION",
      "Official calendar OLE DIFAT FAT sector location is invalid."
    );
  }
  seen.add(sector);
  locations.push(sector);
}

function readIntrinsicDataView(value: unknown): DataView {
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
    if (hasSharedArrayBufferBacking(buffer)) {
      throw new Error("shared byte view");
    }
    return new DataView(buffer as ArrayBuffer, byteOffset, byteLength);
  } catch {
    throw difatError(
      "OFFICIAL_CALENDAR_OLE_DIFAT_INVALID_INPUT",
      "Official calendar OLE DIFAT input is invalid."
    );
  }
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

function sectorByteOffset(sector: number, sectorSize: number): number {
  return (sector + 1) * sectorSize;
}

function isFileSector(value: number, fileSectorCount: number): boolean {
  return value <= MAXREGSECT && value < fileSectorCount;
}

function difatError(
  code: OfficialMarketCalendarOleCompoundFileDifatErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileDifatError {
  return new OfficialMarketCalendarOleCompoundFileDifatError(code, message);
}
