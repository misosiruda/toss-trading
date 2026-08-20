import { verifyOfficialMarketCalendarOleCompoundFileDirectoryTree } from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";
import { verifyOfficialMarketCalendarOleCompoundFileFat } from "./officialMarketCalendarOleCompoundFileFat.js";
import { verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries } from "./officialMarketCalendarOleCompoundFileMiniFatEntries.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_ROOT_MINI_STREAM_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_root_mini_stream.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_ROOT_MINI_STREAM_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  miniSectorSize: 64;
  rootMiniStreamSize: string;
  rootMiniSectorCount: number;
  miniFatEntryCapacity: number;
  rootMiniStreamSectorLocations: readonly number[];
  rootMiniStreamVerified: true;
  miniFatCapacityVerified: true;
  userStreamAllocationStatus: "not_verified";
}

export type OfficialMarketCalendarOleCompoundFileRootMiniStreamErrorCode =
  | "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_SIZE"
  | "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_CHAIN"
  | "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_LENGTH_MISMATCH"
  | "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_SECTOR_REUSE"
  | "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_MINI_FAT_CAPACITY";

export class OfficialMarketCalendarOleCompoundFileRootMiniStreamError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileRootMiniStreamErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileRootMiniStreamError";
  }
}

const MINI_SECTOR_SIZE = 64;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const MAXREGSECT = 0xfffffffa;
const MAX_MINI_STREAM_SIZE = BigInt(MAXREGSECT) * BigInt(MINI_SECTOR_SIZE);

export function verifyOfficialMarketCalendarOleCompoundFileRootMiniStream(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileRootMiniStream {
  const directoryTree =
    verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(input);
  const miniFat =
    verifyOfficialMarketCalendarOleCompoundFileMiniFatEntries(input);
  const fat = verifyOfficialMarketCalendarOleCompoundFileFat(input);
  const root = directoryTree.entries[0];
  if (root === undefined || root.objectType !== "root") {
    throw rootMiniStreamError(
      "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_CHAIN",
      "Official calendar OLE root mini stream entry is invalid."
    );
  }

  const rootSize = BigInt(root.streamSize);
  if (rootSize > MAX_MINI_STREAM_SIZE) {
    throw rootMiniStreamError(
      "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_SIZE",
      "Official calendar OLE root mini stream size is invalid."
    );
  }
  const rootMiniSectorCount = Number(
    (rootSize + BigInt(MINI_SECTOR_SIZE - 1)) / BigInt(MINI_SECTOR_SIZE)
  );
  verifyMiniFatCapacity(miniFat.miniFatEntries, rootMiniSectorCount);

  const expectedFileSectorCount = Number(
    (rootSize + BigInt(fat.sectorSize - 1)) / BigInt(fat.sectorSize)
  );
  const occupied = new Set<number>([
    ...fat.fatSectorLocations,
    ...fat.difatSectorLocations,
    ...directoryTree.directorySectorLocations,
    ...miniFat.miniFatSectorLocations
  ]);
  const rootMiniStreamSectorLocations = readRootChain(
    root.startingSector,
    expectedFileSectorCount,
    fat.fatEntries,
    occupied
  );

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_ROOT_MINI_STREAM_SCHEMA_VERSION,
    majorVersion: fat.majorVersion,
    sectorSize: fat.sectorSize,
    miniSectorSize: MINI_SECTOR_SIZE,
    rootMiniStreamSize: root.streamSize,
    rootMiniSectorCount,
    miniFatEntryCapacity: miniFat.miniFatEntries.length,
    rootMiniStreamSectorLocations,
    rootMiniStreamVerified: true,
    miniFatCapacityVerified: true,
    userStreamAllocationStatus: "not_verified"
  });
}

function verifyMiniFatCapacity(
  entries: readonly number[],
  rootMiniSectorCount: number
): void {
  if (rootMiniSectorCount > entries.length) {
    throw miniFatCapacityError();
  }
  for (let index = 0; index < entries.length; index += 1) {
    const value = entries[index];
    if (value === undefined) {
      throw miniFatCapacityError();
    }
    if (
      (index >= rootMiniSectorCount && value !== FREESECT) ||
      (value <= MAXREGSECT && value >= rootMiniSectorCount)
    ) {
      throw miniFatCapacityError();
    }
  }
}

function readRootChain(
  firstSector: number,
  expectedSectorCount: number,
  fatEntries: readonly number[],
  occupied: ReadonlySet<number>
): readonly number[] {
  if (expectedSectorCount === 0) {
    if (firstSector !== ENDOFCHAIN) {
      throw lengthMismatch();
    }
    return Object.freeze([]);
  }

  const locations: number[] = [];
  const seen = new Set<number>();
  let current = firstSector;
  while (current !== ENDOFCHAIN) {
    if (!isFileSector(current, fatEntries.length) || seen.has(current)) {
      throw rootMiniStreamError(
        "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_CHAIN",
        "Official calendar OLE root mini stream FAT chain is invalid."
      );
    }
    if (occupied.has(current)) {
      throw rootMiniStreamError(
        "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_SECTOR_REUSE",
        "Official calendar OLE root mini stream reuses a system sector."
      );
    }
    seen.add(current);
    locations.push(current);
    const next = fatEntries[current];
    if (
      next === undefined ||
      (next !== ENDOFCHAIN && !isFileSector(next, fatEntries.length))
    ) {
      throw rootMiniStreamError(
        "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_INVALID_CHAIN",
        "Official calendar OLE root mini stream FAT termination is invalid."
      );
    }
    current = next;
  }
  if (locations.length !== expectedSectorCount) {
    throw lengthMismatch();
  }
  return Object.freeze([...locations]);
}

function isFileSector(value: number, fileSectorCount: number): boolean {
  return value <= MAXREGSECT && value < fileSectorCount;
}

function lengthMismatch(): OfficialMarketCalendarOleCompoundFileRootMiniStreamError {
  return rootMiniStreamError(
    "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_LENGTH_MISMATCH",
    "Official calendar OLE root mini stream FAT chain length is invalid."
  );
}

function miniFatCapacityError(): OfficialMarketCalendarOleCompoundFileRootMiniStreamError {
  return rootMiniStreamError(
    "OFFICIAL_CALENDAR_OLE_ROOT_MINI_STREAM_MINI_FAT_CAPACITY",
    "Official calendar OLE mini FAT exceeds root mini stream capacity."
  );
}

function rootMiniStreamError(
  code: OfficialMarketCalendarOleCompoundFileRootMiniStreamErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileRootMiniStreamError {
  return new OfficialMarketCalendarOleCompoundFileRootMiniStreamError(
    code,
    message
  );
}
