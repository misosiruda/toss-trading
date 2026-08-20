import { verifyOfficialMarketCalendarOleCompoundFileDifat } from "./officialMarketCalendarOleCompoundFileDifat.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_FAT_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_fat.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileFat {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_FAT_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  fileSectorCount: number;
  fatSectorCount: number;
  difatSectorCount: number;
  fatSectorLocations: readonly number[];
  difatSectorLocations: readonly number[];
  fatEntries: readonly number[];
  fatVerified: true;
  chainStatus: "markers_only_chains_not_verified";
}

export type OfficialMarketCalendarOleCompoundFileFatErrorCode =
  | "OFFICIAL_CALENDAR_OLE_FAT_INVALID_INPUT"
  | "OFFICIAL_CALENDAR_OLE_FAT_INVALID_ENTRY"
  | "OFFICIAL_CALENDAR_OLE_FAT_INVALID_SECTOR_MARKER"
  | "OFFICIAL_CALENDAR_OLE_FAT_INVALID_TRAILING_ENTRY";

export class OfficialMarketCalendarOleCompoundFileFatError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileFatErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileFatError";
  }
}

const DIFSECT = 0xfffffffc;
const FATSECT = 0xfffffffd;
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

export function verifyOfficialMarketCalendarOleCompoundFileFat(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileFat {
  const difat = verifyOfficialMarketCalendarOleCompoundFileDifat(input);
  const view = readIntrinsicDataView(input);
  const entriesPerFatSector = difat.sectorSize / 4;
  const fatEntries: number[] = [];

  for (
    let fatSectorIndex = 0;
    fatSectorIndex < difat.fatSectorLocations.length;
    fatSectorIndex += 1
  ) {
    const fatSectorLocation = difat.fatSectorLocations[fatSectorIndex];
    if (fatSectorLocation === undefined) {
      throw fatError(
        "OFFICIAL_CALENDAR_OLE_FAT_INVALID_ENTRY",
        "Official calendar OLE FAT sector location is missing."
      );
    }
    const sectorOffset = (fatSectorLocation + 1) * difat.sectorSize;
    for (let entryIndex = 0; entryIndex < entriesPerFatSector; entryIndex += 1) {
      const globalEntryIndex =
        fatSectorIndex * entriesPerFatSector + entryIndex;
      const value = view.getUint32(sectorOffset + entryIndex * 4, true);
      if (globalEntryIndex < difat.fileSectorCount) {
        if (!isValidFatEntry(value, difat.fileSectorCount)) {
          throw fatError(
            "OFFICIAL_CALENDAR_OLE_FAT_INVALID_ENTRY",
            "Official calendar OLE FAT entry is invalid."
          );
        }
        fatEntries.push(value);
      } else if (value !== FREESECT) {
        throw fatError(
          "OFFICIAL_CALENDAR_OLE_FAT_INVALID_TRAILING_ENTRY",
          "Official calendar OLE FAT trailing entry is invalid."
        );
      }
    }
  }

  if (fatEntries.length !== difat.fileSectorCount) {
    throw fatError(
      "OFFICIAL_CALENDAR_OLE_FAT_INVALID_ENTRY",
      "Official calendar OLE FAT coverage is invalid."
    );
  }

  const fatSectorSet = new Set(difat.fatSectorLocations);
  const difatSectorSet = new Set(difat.difatSectorLocations);
  for (let sector = 0; sector < fatEntries.length; sector += 1) {
    const entry = fatEntries[sector];
    const expectedMarker = fatSectorSet.has(sector)
      ? FATSECT
      : difatSectorSet.has(sector)
        ? DIFSECT
        : undefined;
    if (
      (expectedMarker !== undefined && entry !== expectedMarker) ||
      (expectedMarker === undefined &&
        (entry === FATSECT || entry === DIFSECT))
    ) {
      throw fatError(
        "OFFICIAL_CALENDAR_OLE_FAT_INVALID_SECTOR_MARKER",
        "Official calendar OLE FAT sector marker is invalid."
      );
    }
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_FAT_SCHEMA_VERSION,
    majorVersion: difat.majorVersion,
    sectorSize: difat.sectorSize,
    fileSectorCount: difat.fileSectorCount,
    fatSectorCount: difat.fatSectorCount,
    difatSectorCount: difat.difatSectorCount,
    fatSectorLocations: Object.freeze([...difat.fatSectorLocations]),
    difatSectorLocations: Object.freeze([...difat.difatSectorLocations]),
    fatEntries: Object.freeze([...fatEntries]),
    fatVerified: true,
    chainStatus: "markers_only_chains_not_verified"
  });
}

function isValidFatEntry(value: number, fileSectorCount: number): boolean {
  return (
    (value <= MAXREGSECT && value < fileSectorCount) ||
    value === DIFSECT ||
    value === FATSECT ||
    value === ENDOFCHAIN ||
    value === FREESECT
  );
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
    throw fatError(
      "OFFICIAL_CALENDAR_OLE_FAT_INVALID_INPUT",
      "Official calendar OLE FAT input is invalid."
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

function fatError(
  code: OfficialMarketCalendarOleCompoundFileFatErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileFatError {
  return new OfficialMarketCalendarOleCompoundFileFatError(code, message);
}
