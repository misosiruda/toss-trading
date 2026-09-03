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

export interface MarketPacketHistory {
  records: readonly unknown[];
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
  marketPacketHistory: MarketPacketHistory;
}): ResolvedEveryTickPortfolioCycleTrigger {
  const resolved = resolvePortfolioCycleTrigger(input.value);
  if (resolved.trigger.triggerKind !== "every_tick") {
    throw new Error("every-tick trigger resolver requires an every_tick trigger");
  }
  const trigger = resolved.trigger;

  if (
    !Number.isSafeInteger(input.marketPacketHistory.corruptLineCount) ||
    input.marketPacketHistory.corruptLineCount !== 0
  ) {
    throw new Error("every-tick trigger packet history is corrupt");
  }

  const packets = input.marketPacketHistory.records.map(
    parseCanonicalMarketPacket
  );
  const matches = packets.filter(
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

function parseCanonicalMarketPacket(value: unknown): MarketPacket {
  const packet = marketPacketSchema.parse(value);
  if (!isDeepStrictEqual(value, packet)) {
    throw new Error("market packet must already be canonical");
  }
  return packet;
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
