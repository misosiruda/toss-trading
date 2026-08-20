import {
  type VerifiedOfficialMarketCalendarOleDirectoryEntry,
  verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries
} from "./officialMarketCalendarOleCompoundFileDirectoryEntries.js";
import { toOfficialMarketCalendarOleSimpleUppercaseCodeUnit } from "./officialMarketCalendarOleUnicodeSimpleUppercase.js";

export const OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_TREE_SCHEMA_VERSION =
  "official_market_calendar_ole_compound_file_directory_tree.v1";

export interface VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree {
  schemaVersion: typeof OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_TREE_SCHEMA_VERSION;
  majorVersion: 3 | 4;
  sectorSize: 512 | 4096;
  directorySectorLocations: readonly number[];
  entries: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[];
  directoryEntriesVerified: true;
  directoryTreeVerified: true;
  treeStatus: "verified";
  streamAllocationStatus: "not_verified";
}

export type OfficialMarketCalendarOleCompoundFileDirectoryTreeErrorCode =
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_NODE"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_COLOR"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_ORDER"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_OWNERSHIP"
  | "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_UNREACHABLE_ENTRY";

export class OfficialMarketCalendarOleCompoundFileDirectoryTreeError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarOleCompoundFileDirectoryTreeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarOleCompoundFileDirectoryTreeError";
  }
}

interface PendingChildTree {
  rootStreamId: number;
}

interface PendingSiblingNode {
  streamId: number;
  lowerName: string | null;
  upperName: string | null;
  parentColor: "red" | "black" | null;
}

export function verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleCompoundFileDirectoryTree {
  const directoryEntries =
    verifyOfficialMarketCalendarOleCompoundFileDirectoryEntries(input);
  const root = directoryEntries.entries[0];
  if (root === undefined || root.objectType !== "root") {
    throw treeError(
      "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_NODE",
      "Official calendar OLE directory tree root entry is invalid."
    );
  }

  const ownedStreamIds = new Set<number>([root.streamId]);
  const pendingChildTrees: PendingChildTree[] = [];
  if (root.childId !== null) {
    pendingChildTrees.push({
      rootStreamId: root.childId
    });
  }

  while (pendingChildTrees.length > 0) {
    const childTree = pendingChildTrees.pop();
    if (childTree === undefined) {
      throw invalidNode();
    }
    verifyChildTree(
      childTree,
      directoryEntries.entries,
      ownedStreamIds,
      pendingChildTrees
    );
  }

  for (const entry of directoryEntries.entries) {
    if (entry.objectType !== "unallocated" && !ownedStreamIds.has(entry.streamId)) {
      throw treeError(
        "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_UNREACHABLE_ENTRY",
        "Official calendar OLE directory entry is not reachable from the root hierarchy."
      );
    }
  }

  return Object.freeze({
    schemaVersion:
      OFFICIAL_MARKET_CALENDAR_OLE_COMPOUND_FILE_DIRECTORY_TREE_SCHEMA_VERSION,
    majorVersion: directoryEntries.majorVersion,
    sectorSize: directoryEntries.sectorSize,
    directorySectorLocations: directoryEntries.directorySectorLocations,
    entries: directoryEntries.entries,
    directoryEntriesVerified: true,
    directoryTreeVerified: true,
    treeStatus: "verified",
    streamAllocationStatus: "not_verified"
  });
}

function verifyChildTree(
  childTree: PendingChildTree,
  entries: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[],
  ownedStreamIds: Set<number>,
  pendingChildTrees: PendingChildTree[]
): void {
  const treeRoot = readTreeNode(entries, childTree.rootStreamId);
  if (treeRoot.color !== "black") {
    throw treeError(
      "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_COLOR",
      "Official calendar OLE child sibling tree root is not black."
    );
  }

  const pendingNodes: PendingSiblingNode[] = [
    {
      streamId: treeRoot.streamId,
      lowerName: null,
      upperName: null,
      parentColor: null
    }
  ];

  while (pendingNodes.length > 0) {
    const pendingNode = pendingNodes.pop();
    if (pendingNode === undefined) {
      throw invalidNode();
    }
    const entry = readTreeNode(entries, pendingNode.streamId);
    if (ownedStreamIds.has(entry.streamId)) {
      throw treeError(
        "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_OWNERSHIP",
        "Official calendar OLE directory entry is referenced more than once."
      );
    }
    ownedStreamIds.add(entry.streamId);

    const name = entry.name;
    if (name === null) {
      throw invalidNode();
    }
    if (
      (pendingNode.lowerName !== null &&
        compareDirectoryNames(name, pendingNode.lowerName) <= 0) ||
      (pendingNode.upperName !== null &&
        compareDirectoryNames(name, pendingNode.upperName) >= 0)
    ) {
      throw treeError(
        "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_ORDER",
        "Official calendar OLE sibling names are not strictly ordered."
      );
    }
    if (pendingNode.parentColor === "red" && entry.color === "red") {
      throw treeError(
        "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_COLOR",
        "Official calendar OLE directory tree has consecutive red nodes."
      );
    }

    if (entry.objectType === "storage" && entry.childId !== null) {
      pendingChildTrees.push({
        rootStreamId: entry.childId
      });
    }
    if (entry.rightSiblingId !== null) {
      pendingNodes.push({
        streamId: entry.rightSiblingId,
        lowerName: name,
        upperName: pendingNode.upperName,
        parentColor: entry.color
      });
    }
    if (entry.leftSiblingId !== null) {
      pendingNodes.push({
        streamId: entry.leftSiblingId,
        lowerName: pendingNode.lowerName,
        upperName: name,
        parentColor: entry.color
      });
    }
  }
}

function readTreeNode(
  entries: readonly VerifiedOfficialMarketCalendarOleDirectoryEntry[],
  streamId: number
): VerifiedOfficialMarketCalendarOleDirectoryEntry {
  const entry = entries[streamId];
  if (
    entry === undefined ||
    entry.streamId !== streamId ||
    entry.objectType === "unallocated" ||
    entry.objectType === "root" ||
    entry.name === null ||
    entry.color === null
  ) {
    throw invalidNode();
  }
  return entry;
}

function compareDirectoryNames(left: string, right: string): number {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftCodeUnit = toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(
      left.charCodeAt(index)
    );
    const rightCodeUnit = toOfficialMarketCalendarOleSimpleUppercaseCodeUnit(
      right.charCodeAt(index)
    );
    if (leftCodeUnit !== rightCodeUnit) {
      return leftCodeUnit < rightCodeUnit ? -1 : 1;
    }
  }
  return 0;
}

function invalidNode(): OfficialMarketCalendarOleCompoundFileDirectoryTreeError {
  return treeError(
    "OFFICIAL_CALENDAR_OLE_DIRECTORY_TREE_INVALID_NODE",
    "Official calendar OLE directory tree node is invalid."
  );
}

function treeError(
  code: OfficialMarketCalendarOleCompoundFileDirectoryTreeErrorCode,
  message: string
): OfficialMarketCalendarOleCompoundFileDirectoryTreeError {
  return new OfficialMarketCalendarOleCompoundFileDirectoryTreeError(
    code,
    message
  );
}
