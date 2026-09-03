import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import {
  marketPacketSchema,
  type MarketPacket
} from "../domain/schemas.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  resolvePortfolioCycleTrigger,
  type ResolvedPortfolioCycleTrigger
} from "./portfolioCycleTrigger.js";

export interface ResolvedEveryTickPortfolioCycleTrigger
  extends ResolvedPortfolioCycleTrigger {
  trigger: Extract<
    ResolvedPortfolioCycleTrigger["trigger"],
    { triggerKind: "every_tick" }
  >;
  marketPacket: MarketPacket;
}

const canonicalMarketPacketHistoryBrand = Symbol(
  "canonicalMarketPacketHistory"
);

export interface CanonicalMarketPacketHistory {
  records: readonly MarketPacket[];
  corruptLineCount: number;
  readonly [canonicalMarketPacketHistoryBrand]: true;
}

/**
 * Resolves an every-tick trigger against a complete immutable packet history.
 *
 * Every stored packet is parsed and independently rehashed before lookup so a
 * malformed unrelated record cannot be ignored. The trigger must resolve to
 * exactly one packet and its cutoff must be the packet's stored generation
 * instant, not the time at which the trigger is processed.
 */
export function resolveEveryTickPortfolioCycleTrigger(input: {
  value: unknown;
  marketPacketHistory: CanonicalMarketPacketHistory;
}): ResolvedEveryTickPortfolioCycleTrigger {
  const resolved = resolvePortfolioCycleTrigger(input.value);
  if (resolved.trigger.triggerKind !== "every_tick") {
    throw new Error("every-tick trigger resolver requires an every_tick trigger");
  }
  const trigger = resolved.trigger;

  if (
    input.marketPacketHistory[canonicalMarketPacketHistoryBrand] !== true ||
    !Number.isSafeInteger(input.marketPacketHistory.corruptLineCount) ||
    input.marketPacketHistory.corruptLineCount !== 0
  ) {
    throw new Error("every-tick trigger packet history is corrupt");
  }

  const matches = input.marketPacketHistory.records.filter(
    (packet) => createMarketPacketHash(packet) === trigger.packetHash
  );
  if (matches.length !== 1) {
    throw new Error(
      `every-tick trigger packet must resolve exactly once; resolved ${matches.length}`
    );
  }

  const marketPacket = matches[0] as MarketPacket;
  if (marketPacket.generatedAt !== trigger.packetAsOf) {
    throw new Error("every-tick trigger cutoff does not match packet generatedAt");
  }

  return deepFreeze({
    ...resolved,
    trigger,
    marketPacket
  });
}

/** Reads packet JSONL without schema normalization hiding stored byte drift. */
export async function readCanonicalMarketPacketHistory(
  filePath: string
): Promise<CanonicalMarketPacketHistory> {
  try {
    return parseCanonicalMarketPacketHistoryText(
      await readFile(filePath, "utf8")
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return parseCanonicalMarketPacketHistoryText("");
    }
    throw error;
  }
}

export function parseCanonicalMarketPacketHistoryText(
  raw: string
): CanonicalMarketPacketHistory {
  if (raw.length === 0) {
    return deepFreeze({
      records: [],
      corruptLineCount: 0,
      [canonicalMarketPacketHistoryBrand]: true as const
    });
  }
  const lines = raw.split("\n");
  let corruptLineCount = 0;
  if (raw.endsWith("\n")) {
    lines.pop();
  } else if (raw.length > 0) {
    lines.pop();
    corruptLineCount += 1;
  }

  const records: MarketPacket[] = [];
  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      corruptLineCount += 1;
      continue;
    }
    try {
      const value: unknown = JSON.parse(line);
      if (containsNegativeZero(value)) {
        corruptLineCount += 1;
        continue;
      }
      const packet = marketPacketSchema.parse(value);
      if (!isDeepStrictEqual(value, packet)) {
        corruptLineCount += 1;
        continue;
      }
      records.push(packet);
    } catch {
      corruptLineCount += 1;
    }
  }

  return deepFreeze({
    records,
    corruptLineCount,
    [canonicalMarketPacketHistoryBrand]: true as const
  });
}

function containsNegativeZero(value: unknown): boolean {
  if (typeof value === "number") {
    return Object.is(value, -0);
  }
  if (Array.isArray(value)) {
    return value.some(containsNegativeZero);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(containsNegativeZero);
  }
  return false;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
