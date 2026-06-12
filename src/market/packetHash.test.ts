import assert from "node:assert/strict";
import test from "node:test";

import type { MarketPacket } from "../domain/schemas.js";
import { createMarketPacketHash } from "./packetHash.js";

test("market packet hash is deterministic across object key order", () => {
  const original = packet();
  const reordered: MarketPacket = {
    constraints: original.constraints,
    candidates: original.candidates,
    virtualPortfolio: original.virtualPortfolio,
    expiresAt: original.expiresAt,
    generatedAt: original.generatedAt,
    mode: original.mode,
    packetId: original.packetId
  };

  assert.match(createMarketPacketHash(original), /^sha256:[a-f0-9]{64}$/);
  assert.equal(createMarketPacketHash(original), createMarketPacketHash(reordered));
});

test("market packet hash changes when packet content changes", () => {
  const original = packet();
  const changed: MarketPacket = {
    ...original,
    candidates: [
      {
        ...original.candidates[0]!,
        score: 95
      }
    ]
  };

  assert.notEqual(
    createMarketPacketHash(original),
    createMarketPacketHash(changed)
  );
});

function packet(): MarketPacket {
  return {
    packetId: "packet_hash_001",
    mode: "paper_only",
    generatedAt: "2026-06-11T08:59:00+09:00",
    expiresAt: "2026-06-11T09:05:00+09:00",
    virtualPortfolio: {
      portfolioId: "virtual_default",
      cashKrw: 1_000_000,
      positions: [],
      updatedAt: "2026-06-11T08:59:00+09:00"
    },
    candidates: [
      {
        market: "KR",
        symbol: "005930",
        name: "Samsung",
        lastPriceKrw: 70_000,
        ranking: 1,
        score: 90,
        reasonCodes: ["ranking"],
        sourceRefs: ["source_005930"],
        collectedAt: "2026-06-11T08:59:00+09:00",
        staleAfter: "2026-06-11T09:05:00+09:00"
      }
    ],
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  };
}
