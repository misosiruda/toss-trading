import assert from "node:assert/strict";
import test from "node:test";

import type {
  MarketCandidate,
  VirtualPortfolio
} from "../domain/schemas.js";
import { evaluateHedgePolicy } from "./hedgePolicy.js";

test("hedge policy allows inverse hedge that reduces net downside exposure", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
        positions: [
          {
            market: "KR",
            symbol: "005930",
            assetType: "STOCK",
            assetClass: "equity",
            strategyBucket: "long_term",
            quantity: 4,
            averagePriceKrw: 100_000,
            marketValueKrw: 400_000,
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate(),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 600_000 }
    }),
    []
  );
});

test("hedge policy rejects hedge proposal without downside exposure to reduce", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio(),
      candidate: hedgeCandidate(),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 600_000 }
    }),
    ["VIRTUAL_HEDGE_NOT_REDUCE_RISK"]
  );
});

test("hedge policy rejects inverse ETF outside the hedge bucket", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
        positions: [
          {
            market: "KR",
            symbol: "005930",
            assetType: "STOCK",
            assetClass: "equity",
            strategyBucket: "long_term",
            quantity: 4,
            averagePriceKrw: 100_000,
            marketValueKrw: 400_000,
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate({ strategyBucket: "intraday" }),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 600_000 }
    }),
    ["VIRTUAL_HEDGE_NOT_REDUCE_RISK"]
  );
});

test("hedge policy rejects missing hedge metadata", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
        positions: [
          {
            market: "KR",
            symbol: "005930",
            assetType: "STOCK",
            assetClass: "equity",
            strategyBucket: "long_term",
            quantity: 4,
            averagePriceKrw: 100_000,
            marketValueKrw: 400_000,
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate({ assetType: undefined }),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 600_000 }
    }),
    ["VIRTUAL_HEDGE_METADATA_MISSING"]
  );
});

test("hedge policy rejects gross exposure cap breaches", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
        positions: [
          {
            market: "KR",
            symbol: "005930",
            assetType: "STOCK",
            assetClass: "equity",
            strategyBucket: "long_term",
            quantity: 4,
            averagePriceKrw: 100_000,
            marketValueKrw: 400_000,
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate(),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 450_000 }
    }),
    ["VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED"]
  );
});

test("hedge policy rejects hedge sizing that flips net downside short", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
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
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate(),
      notionalKrw: 150_000,
      policy: { maxGrossExposureKrw: 400_000 }
    }),
    ["VIRTUAL_HEDGE_NOT_REDUCE_RISK"]
  );
});

test("hedge policy treats leveraged inverse hedge as effective exposure", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
        positions: [
          {
            market: "KR",
            symbol: "005930",
            assetType: "STOCK",
            assetClass: "equity",
            strategyBucket: "long_term",
            quantity: 1.5,
            averagePriceKrw: 100_000,
            marketValueKrw: 150_000,
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate({ riskTags: ["inverse", "leveraged"] }),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 1_000_000 }
    }),
    ["VIRTUAL_HEDGE_NOT_REDUCE_RISK"]
  );
});

test("hedge policy applies leveraged exposure to gross exposure caps", () => {
  assert.deepEqual(
    evaluateHedgePolicy({
      portfolio: portfolio({
        positions: [
          {
            market: "KR",
            symbol: "005930",
            assetType: "STOCK",
            assetClass: "equity",
            strategyBucket: "long_term",
            quantity: 4,
            averagePriceKrw: 100_000,
            marketValueKrw: 400_000,
            updatedAt: "2026-06-14T08:59:00+09:00"
          }
        ]
      }),
      candidate: hedgeCandidate({ riskTags: ["inverse", "leveraged"] }),
      notionalKrw: 100_000,
      policy: { maxGrossExposureKrw: 650_000 }
    }),
    ["VIRTUAL_HEDGE_GROSS_EXPOSURE_EXCEEDED"]
  );
});

function portfolio(
  overrides: Partial<VirtualPortfolio> = {}
): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 1_000_000,
    positions: [],
    updatedAt: "2026-06-14T08:59:00+09:00",
    ...overrides
  };
}

function hedgeCandidate(
  overrides: Partial<MarketCandidate> = {}
): MarketCandidate {
  return {
    market: "KR",
    symbol: "251340",
    name: "Inverse Hedge ETF",
    assetType: "ETF",
    assetClass: "inverse",
    riskTags: ["inverse"],
    strategyBucket: "hedge",
    lastPriceKrw: 10_000,
    ranking: 1,
    reasonCodes: ["HEDGE_POLICY"],
    sourceRefs: ["fixture:hedge-policy"],
    collectedAt: "2026-06-14T08:59:00+09:00",
    staleAfter: "2026-06-14T09:05:00+09:00",
    ...overrides
  };
}
