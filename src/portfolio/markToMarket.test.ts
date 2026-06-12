import assert from "node:assert/strict";
import test from "node:test";

import type { VirtualPortfolio } from "../domain/schemas.js";
import { markPortfolioToMarket } from "./markToMarket.js";

test("markPortfolioToMarket updates market price, value, and unrealized pnl", () => {
  const result = markPortfolioToMarket({
    portfolio: portfolio(),
    prices: [
      {
        market: "KR",
        symbol: "005930",
        priceKrw: 80_000,
        priceUpdatedAt: "2026-06-12T09:00:00+09:00",
        priceStaleAfter: "2026-06-12T09:05:00+09:00",
        sourceRefs: ["historical_snapshot:005930_0900"]
      }
    ],
    asOf: new Date("2026-06-12T09:01:00+09:00")
  });

  const position = result.positions[0];

  assert.equal(position?.marketPriceKrw, 80_000);
  assert.equal(position?.marketValueKrw, 160_000);
  assert.equal(position?.unrealizedPnlKrw, 20_000);
  assert.equal(position?.priceUpdatedAt, "2026-06-12T09:00:00+09:00");
  assert.equal(position?.priceStaleAfter, "2026-06-12T09:05:00+09:00");
  assert.deepEqual(position?.priceSourceRefs, [
    "historical_snapshot:005930_0900"
  ]);
  assert.equal(position?.isPriceStale, false);
});

test("markPortfolioToMarket preserves fallback market value when price is missing", () => {
  const result = markPortfolioToMarket({
    portfolio: portfolio(),
    prices: [],
    asOf: new Date("2026-06-12T09:01:00+09:00")
  });

  const position = result.positions[0];

  assert.equal(position?.marketPriceKrw, undefined);
  assert.equal(position?.marketValueKrw, 140_000);
  assert.equal(position?.unrealizedPnlKrw, 0);
});

function portfolio(): VirtualPortfolio {
  return {
    portfolioId: "virtual_default",
    cashKrw: 100_000,
    positions: [
      {
        market: "KR",
        symbol: "005930",
        quantity: 2,
        averagePriceKrw: 70_000,
        marketValueKrw: 140_000,
        updatedAt: "2026-06-12T08:59:00+09:00"
      }
    ],
    updatedAt: "2026-06-12T08:59:00+09:00"
  };
}
