import { verifyOfficialMarketCalendarOleCompoundFileDirectoryTree } from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";
import type { VerifiedOfficialMarketCalendarOleDirectoryEntry } from "./officialMarketCalendarOleCompoundFileDirectoryEntries.js";
import { verifyOfficialMarketCalendarOleCompoundFileFat } from "./officialMarketCalendarOleCompoundFileFat.js";
import { verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries } from "./officialMarketCalendarOleCompoundFileMiniFatEntries.js";
import { verifyOfficialMarketCalendarOleCompoundFileRootMiniStream } from "./officialMarketCalendarOleCompoundFileRootMiniStream.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_ALLOCATION_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_user_stream_allocation.v1";

export interface VerifiedOfficialMarketCalendarOleUserStreamAllocation {
  streamId: number;
  name: string;
  streamSize: string;
  allocation: "empty" | "mini_fat" | "fat";
  sectorLocations: readonly number[];
}

export interface VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_ALLOCATION_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  miniSectorSize: 64;
  streams: readonly VerifiedOfficialMarketCalendarOleUserStreamAllocation[];
  userStreamAllocationVerified: true;
  miniFatOwnershipVerified: true;
  streamBytesStatus: "not_verified";
}

export type OfficialMarketCalendarOleCompoundFileUserStreamAllocationErrorCode =
  | "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_START"
  | "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_CHAIN"
  | "OFFICIAL_CALENDAR_OLE_USER_STREAM_INSUFFICIENT_CAPACITY"
  | "OFFICIAL_CALENDAR_OLE_USER_STREAM_SECTOR_REUSE"
  | "OFFICIAL_CALENDAR_OLE_USER_STREAM_UNOWNED_MINI_FAT_ENTRY";

export class OfficialMarketCalendarOleCompoundFileUserStreamAllocationError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileUserStreamAllocationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileUserStreamAllocationError";
  }
}

const MINI_STREAM_CUTOFF = 4096n;
const MINI_SECTOR_SIZE = 64n;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;

export function verifyOfficialMarketCalendarOleCompoundFileUserStreamAllocation(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileUserStreamAllocation {
  const directoryTree =
    verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(input);
  const rootMiniStream =
    verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(input);
  const miniFat =
    verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(input);
  const fat = verifyOfficialMarketCalendarOleCompoundFileFat(input);
  const occupiedFileSectors = new Set<number>([
    ...fat.fatSectorLocations,
    ...fat.difatSectorLocations,
    ...directoryTree.directorySectorLocations,
    ...miniFat.miniFatSectorLocations,
    ...rootMiniStream.rootMiniStreamSectorLocations
  ]);
  const occupiedMiniSectors = new Set<number>();
  const streams: VerifiedOfficialMarketCalendarOleUserStreamAllocation[] = [];

  for (const entry of directoryTree.entries) {
    if (entry.objectType !== "stream") {
      continue;
    }
    streams.push(
      verifyStream(
        entry,
        fat.sectorSize,
        fat.fatEntries,
        miniFat.miniFatEntries,
        rootMiniStream.rootMiniSectorCount,
        occupiedFileSectors,
        occupiedMiniSectors
      )
    );
  }

  for (let index = 0; index < rootMiniStream.rootMiniSectorCount; index += 1) {
    if (miniFat.miniFatEntries[index] !== FREESECT && !occupiedMiniSectors.has(index)) {
      throw allocationError(
        "OFFICIAL_CALENDAR_OLE_USER_STREAM_UNOWNED_MINI_FAT_ENTRY",
        "Official calendar OLE mini FAT entry is not owned by a user stream."
      );
    }
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_USER_STREAM_ALLOCATION_SCHEMA_VERSION,
    majorVersion: fat.majorVersion,
    sectorSize: fat.sectorSize,
    miniSectorSize: 64,
    streams: Object.freeze([...streams]),
    userStreamAllocationVerified: true,
    miniFatOwnershipVerified: true,
    streamBytesStatus: "not_verified"
  });
}

function verifyStream(
  entry: VerifiedOfficialMarketCalendarOleDirectoryEntry,
  sectorSize: number,
  fatEntries: readonly number[],
  miniFatEntries: readonly number[],
  rootMiniSectorCount: number,
  occupiedFileSectors: Set<number>,
  occupiedMiniSectors: Set<number>
): VerifiedOfficialMarketCalendarOleUserStreamAllocation {
  const name = entry.name;
  if (name === null) {
    throw invalidStart();
  }
  const size = BigInt(entry.streamSize);
  if (size === 0n) {
    return freezeStream(entry, name, "empty", []);
  }
  if (size < MINI_STREAM_CUTOFF) {
    const minimumCount = divideRoundUp(size, MINI_SECTOR_SIZE);
    const locations = readChain(
      entry.startingSector,
      minimumCount,
      miniFatEntries,
      rootMiniSectorCount,
      occupiedMiniSectors
    );
    return freezeStream(entry, name, "mini_fat", locations);
  }
  const minimumCount = divideRoundUp(size, BigInt(sectorSize));
  const locations = readChain(
    entry.startingSector,
    minimumCount,
    fatEntries,
    fatEntries.length,
    occupiedFileSectors
  );
  return freezeStream(entry, name, "fat", locations);
}

function readChain(
  firstSector: number,
  minimumCount: bigint,
  entries: readonly number[],
  sectorLimit: number,
  occupied: Set<number>
): readonly number[] {
  if (!isSector(firstSector, sectorLimit)) {
    throw invalidStart();
  }
  const locations: number[] = [];
  const local = new Set<number>();
  let current = firstSector;
  while (current !== ENDOFCHAIN) {
    if (!isSector(current, sectorLimit) || local.has(current)) {
      throw allocationError(
        "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_CHAIN",
        "Official calendar OLE user stream chain is invalid."
      );
    }
    if (occupied.has(current)) {
      throw allocationError(
        "OFFICIAL_CALENDAR_OLE_USER_STREAM_SECTOR_REUSE",
        "Official calendar OLE user stream reuses an allocated sector."
      );
    }
    local.add(current);
    occupied.add(current);
    locations.push(current);
    const next = entries[current];
    if (next === undefined || (next !== ENDOFCHAIN && !isSector(next, sectorLimit))) {
      throw allocationError(
        "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_CHAIN",
        "Official calendar OLE user stream chain termination is invalid."
      );
    }
    current = next;
  }
  if (BigInt(locations.length) < minimumCount) {
    throw allocationError(
      "OFFICIAL_CALENDAR_OLE_USER_STREAM_INSUFFICIENT_CAPACITY",
      "Official calendar OLE user stream chain is shorter than its stream size."
    );
  }
  return Object.freeze([...locations]);
}

function freezeStream(
  entry: VerifiedOfficialMarketCalendarOleDirectoryEntry,
  name: string,
  allocation: VerifiedOfficialMarketCalendarOleUserStreamAllocation["allocation"],
  sectorLocations: readonly number[]
): VerifiedOfficialMarketCalendarOleUserStreamAllocation {
  return Object.freeze({
    streamId: entry.streamId,
    name,
    streamSize: entry.streamSize,
    allocation,
    sectorLocations: Object.freeze([...sectorLocations])
  });
}

function divideRoundUp(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function isSector(value: number, limit: number): boolean {
  return value <= MAXREGSECT && value < limit;
}

function invalidStart(): OfficialMarketCalendarOleCompoundFileUserStreamAllocationError {
  return allocationError(
    "OFFICIAL_CALENDAR_OLE_USER_STREAM_INVALID_START",
    "Official calendar OLE user stream starting sector is invalid."
  );
}

function allocationError(
  code: OfficialMarketCalendarOleCompoundFileUserStreamAllocationErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileUserStreamAllocationError {
  return new OfficialMarketCalendarOleCompoundFileUserStreamAllocationError(
    code,
    message
  );
}
