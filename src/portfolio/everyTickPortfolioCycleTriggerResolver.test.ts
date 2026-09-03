import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket } from "../domain/schemas.js";
import { createMockMarketPacket } from "../market/packetBuilder.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import {
  parseCanonicalMarketPacketHistoryText,
  resolveEveryTickPortfolioCycleTrigger
} from "./everyTickPortfolioCycleTriggerResolver.js";

const AS_OF = "2026-09-02T00:00:00.000Z";

test("every-tick trigger resolves one canonical packet by rehashed payload", () => {
  const packet = marketPacket();
  const resolved = resolveEveryTickPortfolioCycleTrigger({
    value: trigger(packet),
    marketPacketHistory: history(packet)
  });

  assert.deepEqual(resolved.marketPacket, packet);
  assert.equal(resolved.triggerRef, createMarketPacketHash(packet));
  assert.equal(resolved.evidenceCutoffAt, packet.generatedAt);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.marketPacket), true);
});

test("every-tick trigger rejects a missing or duplicate packet hash", () => {
  const packet = marketPacket();
  const value = trigger(packet);

  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value,
        marketPacketHistory: history()
      }),
    /resolved 0/
  );
  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value,
        marketPacketHistory: history(packet, packet)
      }),
    /resolved 2/
  );
});

test("every-tick trigger rejects packet hash and cutoff drift", () => {
  const packet = marketPacket();
  const tamperedPacket = {
    ...packet,
    packetId: "packet-tampered"
  };

  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value: trigger(packet),
        marketPacketHistory: history(tamperedPacket)
      }),
    /resolved 0/
  );
  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value: {
          ...trigger(packet),
          packetAsOf: "2026-09-02T00:00:01.000Z"
        },
        marketPacketHistory: history(packet)
      }),
    /cutoff does not match/
  );
});

test("every-tick trigger rejects malformed unrelated records and other variants", () => {
  const packet = marketPacket();
  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value: trigger(packet),
        marketPacketHistory: history(packet, { ...packet, extra: true })
      }),
    /history is corrupt/
  );
  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value: {
          triggerKind: "scheduled",
          scheduleBoundaryHash: createMarketPacketHash(packet),
          scheduleSlotId: "KR:2026-09-02:daily:15:30",
          slotEndsAt: AS_OF
        },
        marketPacketHistory: history(packet)
      }),
    /requires an every_tick trigger/
  );
});

test("every-tick trigger rejects a corrupt packet history before lookup", () => {
  const packet = marketPacket();
  assert.throws(
    () =>
      resolveEveryTickPortfolioCycleTrigger({
        value: trigger(packet),
        marketPacketHistory: parseCanonicalMarketPacketHistoryText(
          `${JSON.stringify(packet)}\nnot-json\n`
        )
      }),
    /history is corrupt/
  );
});

test("raw history parsing exposes schema normalization instead of hiding it", () => {
  const packet = marketPacket();
  const normalizedBySchema = {
    ...packet,
    virtualPortfolio: {
      ...packet.virtualPortfolio,
      portfolioId: ` ${packet.virtualPortfolio.portfolioId} `
    }
  };
  const parsed = parseCanonicalMarketPacketHistoryText(
    `${JSON.stringify(normalizedBySchema)}\n`
  );

  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.corruptLineCount, 1);
});

test("raw history parsing rejects blank and unterminated JSONL records", () => {
  const packet = marketPacket();
  const blank = parseCanonicalMarketPacketHistoryText(
    `${JSON.stringify(packet)}\n\n`
  );
  const unterminated = parseCanonicalMarketPacketHistoryText(
    JSON.stringify(packet)
  );

  assert.equal(blank.corruptLineCount, 1);
  assert.equal(unterminated.corruptLineCount, 1);
  assert.equal(unterminated.records.length, 0);
});

test("raw history parsing rejects negative zero before packet hashing", () => {
  const packet = marketPacket();
  const negativeZeroCash = JSON.stringify(packet).replace(
    '"cashKrw":1000000',
    '"cashKrw":-0'
  );
  const parsed = parseCanonicalMarketPacketHistoryText(
    `${negativeZeroCash}\n`
  );

  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.corruptLineCount, 1);
});

function marketPacket(): MarketPacket {
  return createMockMarketPacket({
    now: new Date(AS_OF),
    portfolio: {
      portfolioId: "paper-portfolio",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: AS_OF
    }
  }).packet;
}

function trigger(packet: MarketPacket): {
  triggerKind: "every_tick";
  packetHash: string;
  packetAsOf: string;
} {
  return {
    triggerKind: "every_tick",
    packetHash: createMarketPacketHash(packet),
    packetAsOf: packet.generatedAt
  };
}

function history(...records: readonly unknown[]) {
  return parseCanonicalMarketPacketHistoryText(
    records.map((record) => JSON.stringify(record)).join("\n") +
      (records.length === 0 ? "" : "\n")
  );
}
