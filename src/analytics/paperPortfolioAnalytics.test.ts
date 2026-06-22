import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualDecision, VirtualPortfolio, VirtualTrade } from "../domain/schemas.js";
import { buildPaperPortfolioAnalytics } from "./paperPortfolioAnalytics.js";

test("paper analytics calculates exposure and allocation totals", () => {
  const analytics = buildPaperPortfolioAnalytics({
    portfolio: portfolio(),
    decisions: [],
    trades: []
  });

  assert.equal(analytics.mode, "paper_only");
  assert.equal(analytics.virtualNetWorthKrw, 1_000_000);
  assert.equal(analytics.positionMarketValueKrw, 300_000);
  assert.equal(analytics.cashAllocationRatio, 0.7);
  assert.equal(analytics.positionAllocationRatio, 0.3);
  assert.equal(analytics.exposureByMarket.KR, 100_000);
  assert.equal(analytics.exposureByMarket.US, 200_000);
  assert.equal(analytics.exposureByAssetType.STOCK, 100_000);
  assert.equal(analytics.exposureByAssetType.ETF, 200_000);
  assert.equal(analytics.exposureByAssetType.UNKNOWN, 0);
  assert.equal(analytics.exposureByAssetClass.equity, 300_000);
  assert.equal(analytics.exposureByStrategyBucket.long_term, 100_000);
  assert.equal(analytics.exposureByStrategyBucket.hedge, 200_000);
  assert.equal(analytics.unknownMetadataExposureKrw, 0);
  assert.equal(analytics.unknownMetadataExposureRatio, 0);
  assert.deepEqual(
    analytics.symbolExposures.map((exposure) => [
      exposure.key,
      exposure.grossExposureKrw,
      exposure.exposureRatio
    ]),
    [
      ["US:AAPL", 200_000, 0.2],
      ["KR:005930", 100_000, 0.1]
    ]
  );
  assert.deepEqual(
    analytics.symbolAllocations.map((allocation) => [
      allocation.symbol,
      allocation.assetType
    ]),
    [
      ["AAPL", "ETF"],
      ["005930", "STOCK"]
    ]
  );
  assert.match(analytics.disclaimer, /not investment performance/);
});

test("paper analytics exposes aggregated symbol exposure for split buckets", () => {
  const analytics = buildPaperPortfolioAnalytics({
    portfolio: {
      portfolioId: "virtual_split_bucket",
      cashKrw: 750_000,
      positions: [
        {
          market: "KR",
          symbol: "005930",
          assetType: "STOCK",
          assetClass: "equity",
          strategyBucket: "long_term",
          quantity: 1,
          averagePriceKrw: 100_000,
          marketValueKrw: 100_000,
          updatedAt: "2026-06-11T09:00:00+09:00"
        },
        {
          market: "KR",
          symbol: "005930",
          assetType: "STOCK",
          assetClass: "equity",
          strategyBucket: "swing",
          quantity: 1,
          averagePriceKrw: 150_000,
          marketValueKrw: 150_000,
          updatedAt: "2026-06-11T09:00:00+09:00"
        }
      ],
      updatedAt: "2026-06-11T09:00:00+09:00"
    },
    decisions: [],
    trades: []
  });

  assert.equal(analytics.symbolAllocations.length, 2);
  assert.equal(analytics.symbolExposures.length, 1);
  assert.deepEqual(analytics.symbolExposures[0], {
    key: "KR:005930",
    market: "KR",
    symbol: "005930",
    grossExposureKrw: 250_000,
    netExposureKrw: 250_000,
    exposureRatio: 0.25,
    positionCount: 2,
    strategyBuckets: ["long_term", "swing"],
    assetTypes: ["STOCK"],
    assetClasses: ["equity"]
  });
});

test("paper analytics keeps realized pnl null without sell fill metadata", () => {
  const analytics = buildPaperPortfolioAnalytics({
    portfolio: portfolio(),
    decisions: [],
    trades: []
  });

  assert.equal(analytics.virtualPnl.realizedPnlKrw, null);
  assert.equal(analytics.virtualPnl.unrealizedPnlKrw, 10_000);
  assert.match(analytics.virtualPnl.note, /Paper-only PnL/);
});

test("paper analytics sums realized pnl from virtual sell fills", () => {
  const analytics = buildPaperPortfolioAnalytics({
    portfolio: portfolio(),
    decisions: [],
    trades: [
      {
        ...trade("packet_001", "KR", "005930", "VIRTUAL_SELL"),
        realizedPnlKrw: 9_790
      },
      {
        ...trade("packet_002", "KR", "005930", "VIRTUAL_SELL"),
        realizedPnlKrw: -1_000
      }
    ]
  });

  assert.equal(analytics.virtualPnl.realizedPnlKrw, 8_790);
});

test("paper analytics links decisions to filled virtual trades", () => {
  const analytics = buildPaperPortfolioAnalytics({
    portfolio: portfolio(),
    decisions: [decision()],
    trades: [
      trade("packet_001", "KR", "005930", "VIRTUAL_BUY"),
      trade("packet_999", "KR", "000000", "VIRTUAL_BUY")
    ]
  });

  assert.deepEqual(analytics.decisionTradeLinkage, {
    decisionItemCount: 2,
    filledTradeCount: 2,
    linkedDecisionItemCount: 1,
    unlinkedDecisionItemCount: 1,
    tradeWithoutDecisionCount: 1
  });
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 700_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        assetType: "STOCK",
        assetClass: "equity",
        strategyBucket: "long_term",
        quantity: 1,
        averagePriceKrw: 90_000,
        marketValueKrw: 100_000,
        unrealizedPnlKrw: 10_000,
        updatedAt: "2026-06-11T09:00:00+09:00"
      },
      {
        market: "US",
        symbol: "AAPL",
        assetType: "ETF",
        assetClass: "equity",
        strategyBucket: "hedge",
        quantity: 2,
        averagePriceKrw: 100_000,
        marketValueKrw: 200_000,
        unrealizedPnlKrw: 0,
        updatedAt: "2026-06-11T09:00:00+09:00"
      }
    ],
    updatedAt: "2026-06-11T09:00:00+09:00"
  };
}

function decision(): VirtualDecision {
  return {
    packetId: "packet_001",
    summary: "Paper decisions",
    decisions: [
      {
        market: "KR",
        symbol: "005930",
        action: "VIRTUAL_BUY",
        confidence: 0.7,
        budgetKrw: 100_000,
        thesis: "Fixture thesis",
        riskFactors: ["Fixture risk"],
        dataRefs: ["source_001"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      },
      {
        market: "US",
        symbol: "AAPL",
        action: "VIRTUAL_HOLD",
        confidence: 0.5,
        budgetKrw: 0,
        thesis: "Hold fixture",
        riskFactors: [],
        dataRefs: ["source_002"],
        expiresAt: "2026-06-11T09:05:00+09:00"
      }
    ]
  };
}

function trade(
  packetId: string,
  market: "KR" | "US",
  symbol: string,
  action: "VIRTUAL_BUY" | "VIRTUAL_SELL"
): VirtualTrade {
  return {
    tradeId: `trade_${packetId}_${symbol}`,
    packetId,
    decisionId: `risk_${packetId}_${symbol}`,
    market,
    symbol,
    action,
    quantity: 1,
    priceKrw: 100_000,
    amountKrw: 100_000,
    status: "VIRTUAL_FILLED",
    executedAt: "2026-06-11T09:01:00+09:00"
  };
}
