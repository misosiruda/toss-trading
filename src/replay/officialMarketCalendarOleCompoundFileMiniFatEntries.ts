import { verifyOfficialMarketCalendarOleCompoundFileSystemChains } from "./officialMarketCalendarOleCompoundFileSystemChains.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_MINI_FAT_ENTRIES_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_mini_fat_entries.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_MINI_FAT_ENTRIES_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  miniSectorSize: 64;
  miniFatSectorLocations: readonly number[];
  miniFatEntries: readonly number[];
  miniFatEntriesVerified: true;
  streamChainStatus: "not_verified";
  miniStreamStatus: "not_verified";
}

export type OfficialMarketCalendarOleCompoundFileMiniFatEntriesErrorCode =
  | "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_INPUT"
  | "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_ENTRY";

export class OfficialMarketCalendarOleCompoundFileMiniFatEntriesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileMiniFatEntriesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileMiniFatEntriesError";
  }
}

const MINI_SECTOR_SIZE = 64;
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

export function verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileMiniFatEntries {
  const systemChains =
    verifyOfficialMarketCalendarOleCompoundFileSystemChains(input);
  const view = readIntrinsicDataView(input);
  const entriesPerSector = systemChains.sectorSize / 4;
  const entryCapacity =
    systemChains.miniFatSectorLocations.length * entriesPerSector;
  const miniFatEntries: number[] = [];

  for (
    let chainIndex = 0;
    chainIndex < systemChains.miniFatSectorLocations.length;
    chainIndex += 1
  ) {
    const sector = systemChains.miniFatSectorLocations[chainIndex];
    if (sector === undefined) {
      throw invalidEntry();
    }
    const sectorOffset = (sector + 1) * systemChains.sectorSize;
    for (let index = 0; index < entriesPerSector; index += 1) {
      const value = view.getUint32(sectorOffset + index * 4, true);
      if (!isValidMiniFatEntry(value, entryCapacity)) {
        throw invalidEntry();
      }
      miniFatEntries.push(value);
    }
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_MINI_FAT_ENTRIES_SCHEMA_VERSION,
    majorVersion: systemChains.majorVersion,
    sectorSize: systemChains.sectorSize,
    miniSectorSize: MINI_SECTOR_SIZE,
    miniFatSectorLocations: systemChains.miniFatSectorLocations,
    miniFatEntries: Object.freeze([...miniFatEntries]),
    miniFatEntriesVerified: true,
    streamChainStatus: "not_verified",
    miniStreamStatus: "not_verified"
  });
}

function isValidMiniFatEntry(value: number, entryCapacity: number): boolean {
  return (
    (value <= MAXREGSECT && value < entryCapacity) ||
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
    throw miniFatError(
      "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_INPUT",
      "Official calendar OLE mini FAT entry input is invalid."
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

function invalidEntry(): OfficialMarketCalendarOleCompoundFileMiniFatEntriesError {
  return miniFatError(
    "OFFICIAL_CALENDAR_OLE_MINI_FAT_ENTRIES_INVALID_ENTRY",
    "Official calendar OLE mini FAT entry is invalid."
  );
}

function miniFatError(
  code: OfficialMarketCalendarOleCompoundFileMiniFatEntriesErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileMiniFatEntriesError {
  return new OfficialMarketCalendarOleCompoundFileMiniFatEntriesError(
    code,
    message
  );
}
