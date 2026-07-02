import assert from "node:assert/strict";
import test from "node:test";

import { collectYahooHistoricalDailySnapshots } from "./yahooHistoricalDailyCollector.js";
import { parseHistoricalUniverseManifest } from "../replay/historicalUniverseCoverage.js";

test("Yahoo historical collector converts USD prices to KRW and keeps asset metadata", async () => {
  const result = await collectYahooHistoricalDailySnapshots({
    universe: parseHistoricalUniverseManifest({
      mode: "paper_only_historical_universe",
      universeId: "global-fixture",
      snapshotDate: "2025-01-01",
      symbols: [
        {
          market: "KR",
          symbol: "005930",
          sourceSymbol: "005930.KS",
          assetType: "STOCK",
          assetClass: "equity",
          region: "KR",
          sector: "Technology",
          required: true
        },
        {
          market: "US",
          symbol: "SPY",
          sourceSymbol: "SPY",
          assetType: "ETF",
          assetClass: "equity",
          region: "US",
          riskTags: ["currency_exposed"],
          sector: "Broad Market",
          required: true
        }
      ],
      disclaimer: "Paper-only fixture."
    }),
    rangeStart: new Date("2025-01-01T00:00:00.000Z"),
    rangeEnd: new Date("2025-01-02T23:59:59.999Z"),
    fetcher: fakeFetch,
    now: () => new Date("2026-06-15T00:00:00.000Z")
  });

  const samsung = result.snapshots.find((item) => item.symbol === "005930");
  const spy = result.snapshots.find((item) => item.symbol === "SPY");

  assert.equal(result.status, "completed");
  assert.equal(result.snapshotCount, 4);
  assert.equal(samsung?.lastPriceKrw, 70_000);
  assert.equal(samsung?.assetType, "STOCK");
  assert.equal(samsung?.sector, "Technology");
  assert.equal(spy?.lastPriceKrw, 780_000);
  assert.equal(spy?.assetType, "ETF");
  assert.equal(spy?.assetClass, "equity");
  assert.equal(spy?.sector, "Broad Market");
  assert.deepEqual(spy?.riskTags, ["currency_exposed"]);
  assert.deepEqual(spy?.sourceRefs, [
    "yahoo_chart:SPY:2025-01-01",
    "yahoo_fx:KRW=X:2025-01-01"
  ]);
});

test("Yahoo historical collector records per-symbol failures without throwing the batch", async () => {
  const result = await collectYahooHistoricalDailySnapshots({
    universe: parseHistoricalUniverseManifest({
      mode: "paper_only_historical_universe",
      universeId: "failure-fixture",
      snapshotDate: "2025-01-01",
      symbols: [
        {
          market: "US",
          symbol: "BAD",
          sourceSymbol: "BAD",
          assetType: "STOCK",
          required: true
        }
      ],
      disclaimer: "Paper-only fixture."
    }),
    rangeStart: new Date("2025-01-01T00:00:00.000Z"),
    rangeEnd: new Date("2025-01-02T23:59:59.999Z"),
    fetcher: fakeFetch,
    now: () => new Date("2026-06-15T00:00:00.000Z")
  });

  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.snapshotCount, 0);
  assert.equal(result.symbolReports[0]?.status, "failed");
  assert.match(result.symbolReports[0]?.error ?? "", /BAD/);
});

async function fakeFetch(input: string | URL) {
  const url = new URL(String(input));
  const sourceSymbol = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  if (sourceSymbol === "KRW=X") {
    return response(chart("KRW=X", "KRW", [1300, 1310]));
  }
  if (sourceSymbol === "005930.KS") {
    return response(chart("005930.KS", "KRW", [70_000, 71_000]));
  }
  if (sourceSymbol === "SPY") {
    return response(chart("SPY", "USD", [600, 610]));
  }
  return response(
    {
      chart: {
        result: null,
        error: { code: "Not Found", description: `${sourceSymbol} missing` }
      }
    },
    true
  );
}

function response(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? "OK" : "Not Found",
    json: () => Promise.resolve(body)
  });
}

function chart(symbol: string, currency: string, close: number[]) {
  return {
    chart: {
      result: [
        {
          meta: { symbol, currency },
          timestamp: [1735689600, 1735776000],
          indicators: {
            quote: [
              {
                open: close,
                high: close,
                low: close,
                close,
                volume: [100, 200]
              }
            ]
          }
        }
      ],
      error: null
    }
  };
}
