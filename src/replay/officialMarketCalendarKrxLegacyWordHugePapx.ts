import { verifyOfficialMarketCalendarOleCompoundFileDirectoryTree } from "./officialMarketCalendarOleCompoundFileDirectoryTree.js";
import {
  projectOfficialMarketCalendarOleCompoundFileUserStreamBytesByStreamId
} from "./officialMarketCalendarOleCompoundFileUserStreamBytes.js";
import type { VerifiedOfficialMarketCalendarOleDirectoryEntry } from "./officialMarketCalendarOleCompoundFileDirectoryEntries.js";
import {
  OfficialMarketCalendarKrxLegacyWordPrlError,
  parseOfficialMarketCalendarKrxLegacyWordPrls
} from "./officialMarketCalendarKrxLegacyWordPrl.js";
import type { VerifiedOfficialMarketCalendarKrxLegacyWordPrl } from "./officialMarketCalendarKrxLegacyWordPrl.js";

export interface ResolvedOfficialMarketCalendarKrxLegacyWordHugePapx {
  prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
  status: "not_present" | "ignored_not_first" | "prc_data_resolved";
  resolutionDepth: number;
  ownedPrls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[];
}

export type OfficialMarketCalendarKrxLegacyWordHugePapxErrorCode =
  "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_HUGE_PAPX_INVALID";

export class OfficialMarketCalendarKrxLegacyWordHugePapxError extends Error {
  constructor(
    readonly code: OfficialMarketCalendarKrxLegacyWordHugePapxErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OfficialMarketCalendarKrxLegacyWordHugePapxError";
  }
}

const SPRM_P_HUGE_PAPX = 0x6646;
const SPRM_P_TABLE_PROPS = 0x646b;
const PRC_DATA_HEADER_BYTE_LENGTH = 2;
const PRC_DATA_MINIMUM_GRPPRL_BYTE_LENGTH = 10;
const PRC_DATA_MAXIMUM_GRPPRL_BYTE_LENGTH = 0x3fa2;

export function resolveOfficialMarketCalendarKrxLegacyWordHugePapx(
  input: Uint8Array,
  istd: number | null,
  prls: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[]
): ResolvedOfficialMarketCalendarKrxLegacyWordHugePapx {
  const hugePapxIndex = prls.findIndex((prl) => prl.sprm === SPRM_P_HUGE_PAPX);
  if (hugePapxIndex < 0) {
    return Object.freeze({
      prls,
      status: "not_present",
      resolutionDepth: 0,
      ownedPrls: Object.freeze([])
    });
  }
  if (hugePapxIndex > 0) {
    return Object.freeze({
      prls: Object.freeze(
        prls.filter((prl) => prl.sprm !== SPRM_P_HUGE_PAPX)
      ),
      status: "ignored_not_first",
      resolutionDepth: 0,
      ownedPrls: Object.freeze([])
    });
  }
  if (istd !== 0 || prls.length !== 1) {
    throw invalidHugePapx();
  }

  const dataEntry = findRootDataStream(input);
  if (dataEntry === undefined || BigInt(dataEntry.streamSize) > 0x7fffffffn) {
    throw invalidHugePapx();
  }
  const data =
    projectOfficialMarketCalendarOleCompoundFileUserStreamBytesByStreamId(
      input,
      dataEntry.streamId
    );
  const ownedPrls: VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] = [];
  let completed = false;
  try {
    const visitedOffsets = new Set<number>();
    let offset = readUint32(prls[0]!.operandBytes, 0);
    let resolved: readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] = [];
    const accumulated: VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] = [];
    let resolutionDepth = 0;
    while (true) {
      if (visitedOffsets.has(offset)) throw invalidHugePapx();
      visitedOffsets.add(offset);
      resolutionDepth += 1;
      const parsed = parsePrcData(data.bytes, offset);
      ownedPrls.push(...parsed);

      const hugeIndex = parsed.findIndex(
        (prl) => prl.sprm === SPRM_P_HUGE_PAPX
      );
      const tablePropsIndex = parsed.findIndex(
        (prl) => prl.sprm === SPRM_P_TABLE_PROPS
      );
      if (hugeIndex === 0) {
        offset = readUint32(parsed[0]!.operandBytes, 0);
        continue;
      }
      if (tablePropsIndex >= 0) {
        const prefix = parsed.slice(0, tablePropsIndex).filter(
          (prl) => prl.sprm !== SPRM_P_HUGE_PAPX
        );
        accumulated.push(...prefix);
        offset = readUint32(parsed[tablePropsIndex]!.operandBytes, 0);
        continue;
      }
      const terminal =
        hugeIndex > 0
          ? Object.freeze(
              parsed.filter((prl) => prl.sprm !== SPRM_P_HUGE_PAPX)
            )
          : parsed;
      resolved = Object.freeze([...accumulated, ...terminal]);
      const result = Object.freeze({
        prls: resolved,
        status: "prc_data_resolved" as const,
        resolutionDepth,
        ownedPrls: Object.freeze([...ownedPrls])
      });
      completed = true;
      return result;
    }
  } finally {
    zeroizeBytes(data.bytes);
    if (!completed) {
      for (const prl of ownedPrls) zeroizeBytes(prl.operandBytes);
    }
  }
}

export function disposeResolvedOfficialMarketCalendarKrxLegacyWordHugePapx(
  result: ResolvedOfficialMarketCalendarKrxLegacyWordHugePapx
): void {
  for (const prl of result.ownedPrls) zeroizeBytes(prl.operandBytes);
}

function parsePrcData(
  bytes: Uint8Array,
  offset: number
): readonly VerifiedOfficialMarketCalendarKrxLegacyWordPrl[] {
  const cbGrpprl = readInt16(bytes, offset);
  const grpprlOffset = offset + PRC_DATA_HEADER_BYTE_LENGTH;
  const grpprlEnd = grpprlOffset + cbGrpprl;
  if (
    cbGrpprl < PRC_DATA_MINIMUM_GRPPRL_BYTE_LENGTH ||
    cbGrpprl > PRC_DATA_MAXIMUM_GRPPRL_BYTE_LENGTH ||
    !Number.isSafeInteger(grpprlEnd) ||
    grpprlEnd > bytes.length
  ) {
    throw invalidHugePapx();
  }
  try {
    return parseOfficialMarketCalendarKrxLegacyWordPrls(
      bytes.subarray(grpprlOffset, grpprlEnd)
    );
  } catch (error) {
    if (error instanceof OfficialMarketCalendarKrxLegacyWordPrlError) {
      throw invalidHugePapx();
    }
    throw error;
  }
}

function findRootDataStream(
  input: Uint8Array
): VerifiedOfficialMarketCalendarOleDirectoryEntry | undefined {
  const tree = verifyOfficialMarketCalendarOleCompoundFileDirectoryTree(input);
  const root = tree.entries[0];
  if (root === undefined || root.objectType !== "root") {
    throw invalidHugePapx();
  }
  const pending = root.childId === null ? [] : [root.childId];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const streamId = pending.pop()!;
    if (visited.has(streamId)) throw invalidHugePapx();
    visited.add(streamId);
    const entry = tree.entries[streamId];
    if (entry === undefined) throw invalidHugePapx();
    if (entry.objectType === "stream" && entry.name === "Data") return entry;
    if (entry.leftSiblingId !== null) pending.push(entry.leftSiblingId);
    if (entry.rightSiblingId !== null) pending.push(entry.rightSiblingId);
  }
  return undefined;
}

function readInt16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw invalidHugePapx();
  const value = bytes[offset]! | (bytes[offset + 1]! << 8);
  return (value & 0x8000) === 0 ? value : value - 0x10000;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw invalidHugePapx();
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function zeroizeBytes(bytes: Uint8Array): void {
  try {
    Uint8Array.prototype.fill.call(bytes, 0);
  } catch {
    // A detached caller-owned projection has no remaining bytes to clear.
  }
}

function invalidHugePapx(): OfficialMarketCalendarKrxLegacyWordHugePapxError {
  return new OfficialMarketCalendarKrxLegacyWordHugePapxError(
    "OFFICIAL_CALENDAR_KRX_LEGACY_WORD_HUGE_PAPX_INVALID",
    "Official calendar KRX legacy Word HugePapx reference is invalid."
  );
}
