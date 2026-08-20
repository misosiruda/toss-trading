import { verifyOfficialMarketCalendarOleCompoundFileSystemChains } from "./officialMarketCalendarOleCompoundFileSystemChains.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_ENTRIES_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_directory_entries.v1";

export type OfficialMarketCalendarOleDirectoryObjectType =
  | "unallocated"
  | "storage"
  | "stream"
  | "root";

export interface VerifiedOfficialMarketCalendarOleDirectoryEntry {
  streamId: number;
  name: string | null;
  objectType: OfficialMarketCalendarOleDirectoryObjectType;
  color: "red" | "black" | null;
  leftSiblingId: number | null;
  rightSiblingId: number | null;
  childId: number | null;
  startingSector: number;
  streamSize: string;
}

export interface VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_ENTRIES_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  directorySectorLocations: readonly number[];
  entries: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[];
  directoryEntriesVerified: true;
  treeStatus: "not_verified";
  streamAllocationStatus: "not_verified";
}

export type OfficialMarketCalendarOleCompoundFileDirectoryEntriesErrorCode =
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_INPUT"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_NAME"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_POINTER"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT";

export class OfficialMarketCalendarOleCompoundFileDirectoryEntriesError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileDirectoryEntriesErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileDirectoryEntriesError";
  }
}

const DIRECTORY_ENTRY_SIZE = 128;
const NOSTREAM = 0xffffffff;
const MAXREGSID = 0xfffffffa;
const ROOT_ENTRY_NAME = "Root Entry";

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

export function verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileDirectoryEntries {
  const systemChains =
    verifyOfficialMarketCalendarOleCompoundFileSystemChains(input);
  const view = readIntrinsicDataView(input);
  const entriesPerSector = systemChains.sectorSize / DIRECTORY_ENTRY_SIZE;
  const entryCount =
    systemChains.directorySectorLocations.length * entriesPerSector;
  const entries: VerifiedOfficialMarketCalendarOleDirectoryEntry[] = [];

  for (
    let chainIndex = 0;
    chainIndex < systemChains.directorySectorLocations.length;
    chainIndex += 1
  ) {
    const sector = systemChains.directorySectorLocations[chainIndex];
    if (sector === undefined) {
      throw directoryError(
        "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY",
        "Official calendar OLE directory sector location is missing."
      );
    }
    const sectorOffset = (sector + 1) * systemChains.sectorSize;
    for (let index = 0; index < entriesPerSector; index += 1) {
      const streamId = chainIndex * entriesPerSector + index;
      entries.push(
        readEntry(
          view,
          sectorOffset + index * DIRECTORY_ENTRY_SIZE,
          streamId,
          entryCount,
          systemChains.majorVersion
        )
      );
    }
  }

  const root = entries[0];
  if (
    root === undefined ||
    root.objectType !== "root" ||
    root.name !== ROOT_ENTRY_NAME
  ) {
    throw directoryError(
      "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT",
      "Official calendar OLE root directory entry is invalid."
    );
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_ENTRIES_SCHEMA_VERSION,
    majorVersion: systemChains.majorVersion,
    sectorSize: systemChains.sectorSize,
    directorySectorLocations: Object.freeze([
      ...systemChains.directorySectorLocations
    ]),
    entries: Object.freeze([...entries]),
    directoryEntriesVerified: true,
    treeStatus: "not_verified",
    streamAllocationStatus: "not_verified"
  });
}

function readEntry(
  view: DataView,
  offset: number,
  streamId: number,
  entryCount: number,
  majorVersion: 3 | 4
): VerifiedOfficialMarketCalendarOleDirectoryEntry {
  const objectTypeValue = view.getUint8(offset + 66);
  if (objectTypeValue === 0) {
    verifyUnallocatedEntry(view, offset);
    return Object.freeze({
      streamId,
      name: null,
      objectType: "unallocated",
      color: null,
      leftSiblingId: null,
      rightSiblingId: null,
      childId: null,
      startingSector: 0,
      streamSize: "0"
    });
  }

  const objectType = readObjectType(objectTypeValue, streamId);
  const name = readName(view, offset);
  const colorValue = view.getUint8(offset + 67);
  if (colorValue !== 0 && colorValue !== 1) {
    throw invalidEntry();
  }
  const leftSiblingId = readPointer(view, offset + 68, entryCount);
  const rightSiblingId = readPointer(view, offset + 72, entryCount);
  const childId = readPointer(view, offset + 76, entryCount);
  const startingSector = view.getUint32(offset + 116, true);
  const streamSizeLow = view.getUint32(offset + 120, true);
  const streamSizeHigh = view.getUint32(offset + 124, true);

  if (objectType === "root") {
    if (
      streamId !== 0 ||
      name !== ROOT_ENTRY_NAME ||
      leftSiblingId !== null ||
      rightSiblingId !== null ||
      !hasZeroBytes(view, offset + 100, 8)
    ) {
      throw directoryError(
        "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT",
        "Official calendar OLE root directory entry fields are invalid."
      );
    }
  } else if (streamId === 0) {
    throw directoryError(
      "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ROOT",
      "Official calendar OLE stream ID zero is not the root entry."
    );
  }

  if (
    objectType === "stream" &&
    (childId !== null ||
      !hasZeroBytes(view, offset + 80, 16) ||
      !hasZeroBytes(view, offset + 100, 16))
  ) {
    throw invalidEntry();
  }
  if (
    objectType === "storage" &&
    (startingSector !== 0 || streamSizeLow !== 0 || streamSizeHigh !== 0)
  ) {
    throw invalidEntry();
  }
  if (
    objectType !== "storage" &&
    majorVersion === 3 &&
    streamSizeLow > 0x80000000
  ) {
    throw invalidEntry();
  }

  const streamSize =
    objectType === "storage"
      ? "0"
      : majorVersion === 3
        ? String(streamSizeLow)
        : ((BigInt(streamSizeHigh) << 32n) | BigInt(streamSizeLow)).toString();

  return Object.freeze({
    streamId,
    name,
    objectType,
    color: colorValue === 0 ? "red" : "black",
    leftSiblingId,
    rightSiblingId,
    childId,
    startingSector,
    streamSize
  });
}

function readObjectType(
  value: number,
  streamId: number
): Exclude<OfficialMarketCalendarOleDirectoryObjectType, "unallocated"> {
  if (value === 1) {
    return "storage";
  }
  if (value === 2) {
    return "stream";
  }
  if (value === 5 && streamId === 0) {
    return "root";
  }
  throw invalidEntry();
}

function readName(view: DataView, offset: number): string {
  const byteLength = view.getUint16(offset + 64, true);
  if (byteLength < 2 || byteLength > 64 || byteLength % 2 !== 0) {
    throw invalidName();
  }
  const codeUnits: number[] = [];
  for (let byteOffset = 0; byteOffset < byteLength; byteOffset += 2) {
    codeUnits.push(view.getUint16(offset + byteOffset, true));
  }
  if (codeUnits.at(-1) !== 0 || codeUnits.slice(0, -1).includes(0)) {
    throw invalidName();
  }
  codeUnits.pop();
  let name = "";
  for (let index = 0; index < codeUnits.length; index += 1) {
    const first = codeUnits[index];
    if (first === undefined) {
      throw invalidName();
    }
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = codeUnits[index + 1];
      if (second === undefined || second < 0xdc00 || second > 0xdfff) {
        throw invalidName();
      }
      name += String.fromCodePoint(
        0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
      );
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      throw invalidName();
    } else {
      name += String.fromCodePoint(first);
    }
  }
  if (name.length === 0 || /[\\/:!]/u.test(name)) {
    throw invalidName();
  }
  return name;
}

function readPointer(
  view: DataView,
  offset: number,
  entryCount: number
): number | null {
  const value = view.getUint32(offset, true);
  if (value === NOSTREAM) {
    return null;
  }
  if (value > MAXREGSID || value >= entryCount) {
    throw directoryError(
      "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_POINTER",
      "Official calendar OLE directory stream ID pointer is invalid."
    );
  }
  return value;
}

function verifyUnallocatedEntry(view: DataView, offset: number): void {
  for (let index = 0; index < DIRECTORY_ENTRY_SIZE; index += 1) {
    const expected = index >= 68 && index < 80 ? 0xff : 0;
    if (view.getUint8(offset + index) !== expected) {
      throw invalidEntry();
    }
  }
}

function hasZeroBytes(view: DataView, offset: number, length: number): boolean {
  for (let index = 0; index < length; index += 1) {
    if (view.getUint8(offset + index) !== 0) {
      return false;
    }
  }
  return true;
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
    throw directoryError(
      "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_INPUT",
      "Official calendar OLE directory entry input is invalid."
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

function invalidEntry(): OfficialMarketCalendarOleCompoundFileDirectoryEntriesError {
  return directoryError(
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_ENTRY",
    "Official calendar OLE directory entry is invalid."
  );
}

function invalidName(): OfficialMarketCalendarOleCompoundFileDirectoryEntriesError {
  return directoryError(
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_ENTRIES_INVALID_NAME",
    "Official calendar OLE directory entry name is invalid."
  );
}

function directoryError(
  code: OfficialMarketCalendarOleCompoundFileDirectoryEntriesErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileDirectoryEntriesError {
  return new OfficialMarketCalendarOleCompoundFileDirectoryEntriesError(
    code,
    message
  );
}
