import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualPortfolio } from "../domain/schemas.js";
import {
  createMockMarketPacket,
  MarketPacketBuilder,
  type MarketCandidateDraft
} from "./packetBuilder.js";

const generatedAt = new Date("2026-06-11T09:00:00+09:00");

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T08:59:00+09:00"
  };
}

function builder(maxCandidates = 2): MarketPacketBuilder {
  return new MarketPacketBuilder({
    packetId: "packet_test_001",
    generatedAt,
    expiresInSeconds: 300,
    maxCandidates,
    constraints: {
      maxNewPositions: 3,
      maxBudgetPerSymbolKrw: 100_000,
      allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
    }
  });
}

function candidate(symbol: string, ranking: number): MarketCandidateDraft {
  return {
    market: "KR",
    symbol,
    name: `Sample ${symbol}`,
    lastPriceKrw: 10_000,
    ranking,
    reasonCodes: ["MOCK"],
    sourceRefs: [`source_${symbol}`]
  };
}

test("MarketPacketBuilder trims candidates to maxCandidates", () => {
  const result = builder(2).build({
    portfolio: portfolio(),
    candidates: [candidate("000003", 3), candidate("000001", 1), candidate("000002", 2)]
  });

  assert.deepEqual(
    result.packet.candidates.map((item) => item.symbol),
    ["000001", "000002"]
  );
});

test("MarketPacketBuilder sets packet expiry from ttl", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [candidate("005930", 1)]
  });

  assert.equal(result.packet.generatedAt, "2026-06-11T00:00:00.000Z");
  assert.equal(result.packet.expiresAt, "2026-06-11T00:05:00.000Z");
  assert.equal(result.packet.candidates[0]?.staleAfter, result.packet.expiresAt);
});

test("MarketPacketBuilder excludes candidates missing source refs with warning", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [
      candidate("005930", 1),
      {
        market: "KR",
        symbol: "000000",
        ranking: 2
      }
    ]
  });

  assert.equal(result.packet.candidates.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /missing sourceRefs/);
});

test("MarketPacketBuilder includes virtual portfolio snapshot", () => {
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [candidate("005930", 1)]
  });

  assert.equal(result.packet.virtualPortfolio.cashKrw, 1_000_000);
  assert.equal(result.packet.virtualPortfolio.portfolioId, "virtual_default");
});

test("MarketPacketBuilder drops sensitive extra fields from raw candidate drafts", () => {
  const rawCandidate = {
    ...candidate("005930", 1),
    accountNumber: "1234-5678-901234",
    token: "secret-token"
  };
  const result = builder().build({
    portfolio: portfolio(),
    candidates: [rawCandidate]
  });

  assert.equal("accountNumber" in result.packet.candidates[0]!, false);
  assert.equal("token" in result.packet.candidates[0]!, false);
});

test("createMockMarketPacket creates a valid compact fixture", () => {
  const result = createMockMarketPacket({
    portfolio: portfolio(),
    now: generatedAt
  });

  assert.equal(result.packet.packetId, "packet_mock_001");
  assert.equal(result.packet.candidates.length, 1);
  assert.equal(result.warnings.length, 0);
});
