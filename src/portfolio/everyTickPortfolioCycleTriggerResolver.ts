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

const canonicalMarketPacketHistories =
  new WeakSet<CanonicalMarketPacketHistory>();
const MAXIMUM_MARKET_PACKET_JSON_NESTING_DEPTH = 32;

export interface CanonicalMarketPacketHistory {
  records: readonly MarketPacket[];
  corruptLineCount: number;
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
    !canonicalMarketPacketHistories.has(input.marketPacketHistory) ||
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
    return createCanonicalMarketPacketHistory({
      records: [],
      corruptLineCount: 0
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
      assertNoDuplicateJsonMemberNames(line);
      const value: unknown = JSON.parse(line);
      if (JSON.stringify(value) !== line) {
        corruptLineCount += 1;
        continue;
      }
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

  return createCanonicalMarketPacketHistory({
    records,
    corruptLineCount
  });
}

function createCanonicalMarketPacketHistory(input: {
  records: readonly MarketPacket[];
  corruptLineCount: number;
}): CanonicalMarketPacketHistory {
  const history = deepFreeze({
    records: [...input.records],
    corruptLineCount: input.corruptLineCount
  });
  canonicalMarketPacketHistories.add(history);
  return history;
}

function assertNoDuplicateJsonMemberNames(text: string): void {
  const finalIndex = skipJsonWhitespace(text, scanJsonValue(text, 0, 0));
  if (finalIndex !== text.length) {
    throw new Error("market packet history line must be valid JSON");
  }
}

function scanJsonValue(text: string, startIndex: number, depth: number): number {
  if (depth > MAXIMUM_MARKET_PACKET_JSON_NESTING_DEPTH) {
    throw new Error("market packet history line exceeds JSON nesting boundary");
  }
  const index = skipJsonWhitespace(text, startIndex);
  const character = text[index];
  if (character === "{") {
    return scanJsonObject(text, index, depth);
  }
  if (character === "[") {
    return scanJsonArray(text, index, depth);
  }
  if (character === '"') {
    return scanJsonString(text, index).nextIndex;
  }
  for (const literal of ["true", "false", "null"] as const) {
    if (text.startsWith(literal, index)) {
      return index + literal.length;
    }
  }
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  numberPattern.lastIndex = index;
  const number = numberPattern.exec(text);
  if (number !== null) {
    return numberPattern.lastIndex;
  }
  throw new Error("market packet history line must be valid JSON");
}

function scanJsonObject(text: string, startIndex: number, depth: number): number {
  let index = skipJsonWhitespace(text, startIndex + 1);
  if (text[index] === "}") {
    return index + 1;
  }

  const memberNames = new Set<string>();
  while (index < text.length) {
    if (text[index] !== '"') {
      throw new Error("market packet history line must be valid JSON");
    }
    const key = scanJsonString(text, index);
    if (memberNames.has(key.value)) {
      throw new Error(
        "market packet history line contains duplicate JSON member names"
      );
    }
    memberNames.add(key.value);

    index = skipJsonWhitespace(text, key.nextIndex);
    if (text[index] !== ":") {
      throw new Error("market packet history line must be valid JSON");
    }
    index = skipJsonWhitespace(
      text,
      scanJsonValue(text, index + 1, depth + 1)
    );
    if (text[index] === "}") {
      return index + 1;
    }
    if (text[index] !== ",") {
      throw new Error("market packet history line must be valid JSON");
    }
    index = skipJsonWhitespace(text, index + 1);
  }
  throw new Error("market packet history line must be valid JSON");
}

function scanJsonArray(text: string, startIndex: number, depth: number): number {
  let index = skipJsonWhitespace(text, startIndex + 1);
  if (text[index] === "]") {
    return index + 1;
  }
  while (index < text.length) {
    index = skipJsonWhitespace(text, scanJsonValue(text, index, depth + 1));
    if (text[index] === "]") {
      return index + 1;
    }
    if (text[index] !== ",") {
      throw new Error("market packet history line must be valid JSON");
    }
    index = skipJsonWhitespace(text, index + 1);
  }
  throw new Error("market packet history line must be valid JSON");
}

function scanJsonString(
  text: string,
  startIndex: number
): { value: string; nextIndex: number } {
  let index = startIndex + 1;
  while (index < text.length) {
    if (text[index] === '"') {
      const nextIndex = index + 1;
      let value: unknown;
      try {
        value = JSON.parse(text.slice(startIndex, nextIndex)) as unknown;
      } catch {
        throw new Error("market packet history line must be valid JSON");
      }
      if (typeof value !== "string") {
        throw new Error("market packet history line must be valid JSON");
      }
      return { value, nextIndex };
    }
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    index += 1;
  }
  throw new Error("market packet history line must be valid JSON");
}

function skipJsonWhitespace(text: string, startIndex: number): number {
  let index = startIndex;
  while (
    text[index] === " " ||
    text[index] === "\t" ||
    text[index] === "\r" ||
    text[index] === "\n"
  ) {
    index += 1;
  }
  return index;
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
