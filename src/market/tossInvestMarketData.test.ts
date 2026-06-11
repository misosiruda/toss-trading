import assert from "node:assert/strict";
import test from "node:test";

import type { TossInvestCliCollectResult } from "../collectors/tossInvestCliCollector.js";
import type { VirtualPortfolio } from "../domain/schemas.js";
import {
  buildMarketPacketFromTossInvestData,
  normalizeTossInvestCollectorResults,
  type TossInvestNormalizationOptions
} from "./tossInvestMarketData.js";

const now = new Date("2026-06-11T09:00:00+09:00");

function normalizationOptions(
  overrides: Partial<TossInvestNormalizationOptions> = {}
): TossInvestNormalizationOptions {
  return {
    now,
    sourceMaxAgeSeconds: 300,
    candidateTtlSeconds: 180,
    defaultMarket: "KR",
    ...overrides
  };
}

function source(
  commandKey: string,
  data: unknown,
  collectedAt = "2026-06-11T08:59:00+09:00",
  status: TossInvestCliCollectResult["status"] = "ok"
): TossInvestCliCollectResult {
  return {
    status,
    commandKey,
    data,
    metadata: {
      source: "tossinvest_cli",
      sourceKind: "unofficial_read_only",
      official: false,
      commandKey,
      collectedAt
    },
    error: null
  };
}

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-11T08:59:00+09:00"
  };
}

test("sample tossctl ranking, signals, and quote JSON normalize into candidates", () => {
  const result = normalizeTossInvestCollectorResults(
    [
      source("market.ranking", {
        items: [
          {
            market: "kr",
            symbol: "005930",
            name: "Samsung Electronics",
            currentPrice: "71,000",
            rank: 1,
            score: 91,
            accountNumber: "1234-5678-901234"
          },
          {
            market: "kr",
            stockCode: "000660",
            stockName: "SK hynix",
            currentPrice: 120_000,
            rank: 2
          }
        ]
      }),
      source("market.signals", {
        signals: [
          {
            symbol: "005930",
            signal: "strong buy",
            keywords: ["earnings momentum", "ai signal"]
          }
        ]
      }),
      source("quote.get", {
        symbol: "005930",
        market: "kr",
        priceKrw: 72_000
      })
    ],
    normalizationOptions()
  );

  assert.equal(result.status, "ok");
  assert.equal(result.candidates.length, 2);

  const samsung = result.candidates.find((candidate) => candidate.symbol === "005930");
  assert.ok(samsung);
  assert.equal(samsung.lastPriceKrw, 72_000);
  assert.equal(samsung.ranking, 1);
  assert.equal(samsung.score, 91);
  assert.deepEqual(samsung.reasonCodes?.sort(), [
    "TOSS_AI_SIGNAL",
    "TOSS_EARNINGS_MOMENTUM",
    "TOSS_MARKET_RANKING",
    "TOSS_MARKET_SIGNAL",
    "TOSS_QUOTE",
    "TOSS_STRONG_BUY"
  ]);
  assert.equal(samsung.sourceRefs?.length, 3);
  assert.equal("accountNumber" in samsung, false);
});

test("malformed tossctl output returns degraded normalization", () => {
  const result = normalizeTossInvestCollectorResults(
    [source("market.ranking", { unexpected: { value: true } })],
    normalizationOptions()
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.candidates.length, 0);
  assert.match(result.warnings.join("\n"), /malformed ranking output/);
});

test("stale tossctl source is excluded from candidates", () => {
  const result = normalizeTossInvestCollectorResults(
    [
      source(
        "market.ranking",
        {
          items: [{ symbol: "005930", rank: 1, price: 71_000 }]
        },
        "2026-06-11T08:00:00+09:00"
      )
    ],
    normalizationOptions()
  );

  assert.equal(result.status, "degraded");
  assert.equal(result.candidates.length, 0);
  assert.match(result.warnings.join("\n"), /stale source/);
});

test("generated market packet from tossctl data remains compact", () => {
  const result = buildMarketPacketFromTossInvestData({
    portfolio: portfolio(),
    collectorResults: [
      source("market.ranking", {
        items: [
          {
            symbol: "000003",
            name: "Third",
            price: 30_000,
            rank: 3,
            token: "secret"
          },
          {
            symbol: "000001",
            name: "First",
            price: 10_000,
            rank: 1
          },
          {
            symbol: "000002",
            name: "Second",
            price: 20_000,
            rank: 2
          }
        ]
      })
    ],
    normalizationOptions: normalizationOptions(),
    builderOptions: {
      packetId: "packet_tossinvest_001",
      generatedAt: now,
      expiresInSeconds: 300,
      maxCandidates: 2,
      constraints: {
        maxNewPositions: 3,
        maxBudgetPerSymbolKrw: 100_000,
        allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL", "VIRTUAL_HOLD"]
      }
    }
  });

  assert.equal(result.normalizationStatus, "ok");
  assert.equal(result.packet.candidates.length, 2);
  assert.deepEqual(
    result.packet.candidates.map((candidate) => candidate.symbol),
    ["000001", "000002"]
  );
  assert.equal("token" in result.packet.candidates[0]!, false);
  assert.equal(result.warnings.length, 0);
});
