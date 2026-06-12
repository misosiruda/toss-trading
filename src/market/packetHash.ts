import { createHash } from "node:crypto";

import type { MarketPacket } from "../domain/schemas.js";

export const MARKET_PACKET_HASH_ALGORITHM = "sha256";

export function createMarketPacketHash(packet: MarketPacket): string {
  return `${MARKET_PACKET_HASH_ALGORITHM}:${createHash(
    MARKET_PACKET_HASH_ALGORITHM
  )
    .update(stableStringify(packet))
    .digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }

  return value;
}
