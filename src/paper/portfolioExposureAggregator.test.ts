import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualPortfolio, VirtualPosition } from "../domain/schemas.js";
import {
  buildPortfolioExposureAggregate,
  positionExposureValueKrw
} from "./portfolioExposureAggregator.js";

test("portfolio exposure aggregator sums the same symbol across buckets", () => {
  const aggregate = buildPortfolioExposureAggregate(
    portfolio({
      positions: [
        position({
          symbol: "005930",
          strategyBucket: "long_term",
          marketValueKrw: 100_000
        }),
        position({
          symbol: "005930",
          strategyBucket: "short_term",
          marketValueKrw: 50_000
        }),
        position({
          market: "US",
          symbol: "SPY",
          assetType: "ETF",
          assetClass: "equity",
          strategyBucket: "hedge",
          marketValueKrw: 200_000
        })
      ]
    })
  );

  assert.equal(aggregate.virtualNetWorthKrw, 1_000_000);
  assert.equal(aggregate.totalGrossExposureKrw, 350_000);
  assert.equal(aggregate.totalGrossExposureRatio, 0.35);
  assert.equal(aggregate.exposureByMarketKrw.KR, 150_000);
  assert.equal(aggregate.exposureByMarketKrw.US, 200_000);
  assert.equal(aggregate.exposureByAssetTypeKrw.STOCK, 150_000);
  assert.equal(aggregate.exposureByAssetTypeKrw.ETF, 200_000);
  assert.equal(aggregate.exposureByAssetClassKrw.equity, 350_000);
  assert.equal(aggregate.exposureByStrategyBucketKrw.long_term, 100_000);
  assert.equal(aggregate.exposureByStrategyBucketKrw.short_term, 50_000);
  assert.equal(aggregate.exposureByStrategyBucketKrw.hedge, 200_000);

  const samsung = aggregate.symbolExposures.find(
    (item) => item.key === "KR:005930"
  );
  assert.equal(samsung?.grossExposureKrw, 150_000);
  assert.equal(samsung?.netExposureKrw, 150_000);
  assert.equal(samsung?.exposureRatio, 0.15);
  assert.equal(samsung?.positionCount, 2);
  assert.deepEqual(samsung?.strategyBuckets, ["long_term", "short_term"]);
});

test("portfolio exposure aggregator records unknown metadata conservatively", () => {
  const aggregate = buildPortfolioExposureAggregate(
    portfolio({
      cashKrw: 800_000,
      positions: [
        position({
          symbol: "UNKNOWN_META",
          assetType: undefined,
          assetClass: undefined,
          strategyBucket: undefined,
          marketValueKrw: 200_000
        })
      ]
    })
  );

  assert.equal(aggregate.exposureByAssetTypeKrw.UNKNOWN, 200_000);
  assert.equal(aggregate.exposureByAssetClassKrw.UNKNOWN, 200_000);
  assert.equal(aggregate.exposureByStrategyBucketKrw.unknown, 200_000);
  assert.equal(aggregate.unknownMetadataExposureKrw, 200_000);
  assert.equal(aggregate.unknownMetadataExposureRatio, 0.2);
  assert.deepEqual(aggregate.symbolExposures[0]?.assetTypes, ["UNKNOWN"]);
  assert.deepEqual(aggregate.symbolExposures[0]?.assetClasses, ["UNKNOWN"]);
  assert.deepEqual(aggregate.symbolExposures[0]?.strategyBuckets, ["unknown"]);
});

test("portfolio exposure aggregator keeps ratios finite when net worth is zero", () => {
  const aggregate = buildPortfolioExposureAggregate(
    portfolio({
      cashKrw: -100_000,
      positions: [
        position({
          marketValueKrw: 100_000
        })
      ]
    })
  );

  assert.equal(aggregate.virtualNetWorthKrw, 0);
  assert.equal(aggregate.totalGrossExposureKrw, 100_000);
  assert.equal(aggregate.totalGrossExposureRatio, 0);
  assert.equal(aggregate.exposureByMarketRatio.KR, 0);
  assert.equal(aggregate.symbolExposures[0]?.exposureRatio, 0);
});

test("position exposure value falls back to average cost when mark is absent", () => {
  assert.equal(
    positionExposureValueKrw({
      quantity: 1.5,
      averagePriceKrw: 10_000
    }),
    15_000
  );
});

function portfolio(input: Partial<VirtualPortfolio> = {}): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 650_000,
    positions: [],
    updatedAt: "2026-06-11T09:00:00+09:00",
    ...input
  };
}

type PositionInput = Omit<
  Partial<VirtualPosition>,
  "assetType" | "assetClass" | "strategyBucket"
> & {
  assetType?: VirtualPosition["assetType"] | undefined;
  assetClass?: VirtualPosition["assetClass"] | undefined;
  strategyBucket?: VirtualPosition["strategyBucket"] | undefined;
};

function position(input: PositionInput = {}): VirtualPosition {
  const output: VirtualPosition = {
    market: "KR",
    symbol: "005930",
    assetType: "STOCK",
    assetClass: "equity",
    strategyBucket: "long_term",
    quantity: 1,
    averagePriceKrw: 100_000,
    marketValueKrw: 100_000,
    updatedAt: "2026-06-11T09:00:00+09:00",
    ...input
  };

  if (Object.hasOwn(input, "assetType") && input.assetType === undefined) {
    delete output.assetType;
  }
  if (Object.hasOwn(input, "assetClass") && input.assetClass === undefined) {
    delete output.assetClass;
  }
  if (
    Object.hasOwn(input, "strategyBucket") &&
    input.strategyBucket === undefined
  ) {
    delete output.strategyBucket;
  }

  return output;
}
