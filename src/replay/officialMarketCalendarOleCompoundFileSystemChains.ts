import { verifyOfficialMarketCalendarOleCompoundFileFat } from "./officialMarketCalendarOleCompoundFileFat.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_SYSTEM_CHAINS_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_system_chains.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileSystemChains {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_SYSTEM_CHAINS_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  fileSectorCount: number;
  directorySectorLocations: readonly number[];
  miniFatSectorLocations: readonly number[];
  systemChainsVerified: true;
  directoryEntryStatus: "not_verified";
  miniFatEntryStatus: "not_verified";
}

export type OfficialMarketCalendarOleCompoundFileSystemChainsErrorCode =
  | "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_INPUT"
  | "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN"
  | "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_LENGTH_MISMATCH"
  | "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_SECTOR_REUSE";

export class OfficialMarketCalendarOleCompoundFileSystemChainsError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileSystemChainsErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileSystemChainsError";
  }
}

const ENDOFCHAIN = 0xfffffffe;
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

export function verifyOfficialMarketCalendarOleCompoundFileSystemChains(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileSystemChains {
  const fat = verifyOfficialMarketCalendarOleCompoundFileFat(input);
  const view = readIntrinsicDataView(input);
  const directorySectorCount = view.getUint32(40, true);
  const firstDirectorySector = view.getUint32(48, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const occupied = new Set<number>();
  const directorySectorLocations = readChain(
    firstDirectorySector,
    fat.majorVersion === 4 ? directorySectorCount : undefined,
    fat.fatEntries,
    occupied
  );
  const miniFatSectorLocations = readChain(
    firstMiniFatSector,
    miniFatSectorCount,
    fat.fatEntries,
    occupied
  );

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_SYSTEM_CHAINS_SCHEMA_VERSION,
    majorVersion: fat.majorVersion,
    sectorSize: fat.sectorSize,
    fileSectorCount: fat.fileSectorCount,
    directorySectorLocations: Object.freeze([...directorySectorLocations]),
    miniFatSectorLocations: Object.freeze([...miniFatSectorLocations]),
    systemChainsVerified: true,
    directoryEntryStatus: "not_verified",
    miniFatEntryStatus: "not_verified"
  });
}

function readChain(
  firstSector: number,
  expectedSectorCount: number | undefined,
  fatEntries: readonly number[],
  occupied: Set<number>
): readonly number[] {
  const locations: number[] = [];
  const seen = new Set<number>();
  let current = firstSector;

  while (current !== ENDOFCHAIN) {
    if (!isFileSector(current, fatEntries.length)) {
      throw chainError(
        "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN",
        "Official calendar OLE system chain sector is invalid."
      );
    }
    if (seen.has(current)) {
      throw chainError(
        "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN",
        "Official calendar OLE system chain contains a cycle."
      );
    }
    if (occupied.has(current)) {
      throw chainError(
        "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_SECTOR_REUSE",
        "Official calendar OLE system chains reuse a sector."
      );
    }
    seen.add(current);
    occupied.add(current);
    locations.push(current);
    const next = fatEntries[current];
    if (next === undefined) {
      throw chainError(
        "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN",
        "Official calendar OLE system chain FAT entry is missing."
      );
    }
    if (next !== ENDOFCHAIN && !isFileSector(next, fatEntries.length)) {
      throw chainError(
        "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_CHAIN",
        "Official calendar OLE system chain termination is invalid."
      );
    }
    current = next;
  }

  if (
    (expectedSectorCount === undefined && locations.length === 0) ||
    (expectedSectorCount !== undefined &&
      locations.length !== expectedSectorCount)
  ) {
    throw chainError(
      "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_LENGTH_MISMATCH",
      "Official calendar OLE system chain length is invalid."
    );
  }
  return Object.freeze(locations);
}

function isFileSector(value: number, fileSectorCount: number): boolean {
  return value <= MAXREGSECT && value < fileSectorCount;
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
    throw chainError(
      "OFFICIAL_CALENDAR_OLE_SYSTEM_CHAINS_INVALID_INPUT",
      "Official calendar OLE system chain input is invalid."
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

function chainError(
  code: OfficialMarketCalendarOleCompoundFileSystemChainsErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileSystemChainsError {
  return new OfficialMarketCalendarOleCompoundFileSystemChainsError(
    code,
    message
  );
}
