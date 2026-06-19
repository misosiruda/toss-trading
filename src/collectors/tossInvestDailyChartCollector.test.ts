import assert from "node:assert/strict";
import test from "node:test";

import { collectTossInvestDailyChartSnapshots } from "./tossInvestDailyChartCollector.js";

test("TossInvest daily chart collector paginates day:1 candles by from cursor", async () => {
  const requestedUrls: string[] = [];
  const result = await collectTossInvestDailyChartSnapshots({
    enabled: true,
    symbols: [
      {
        market: "KR",
        symbol: "005930",
        sourceSymbol: "005930.KS",
        assetType: "STOCK",
        assetClass: "equity",
        region: "KR"
      }
    ],
    rangeStart: new Date("2024-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2026-06-17T00:00:00+09:00"),
    pageSize: 2,
    fetcher: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.pathname === "/api/v2/search/stocks") {
        return response({
          result: {
            stocks: [
              {
                stockCode: "A005930",
                stockName: "Samsung Electronics",
                matchType: "EXACT"
              }
            ]
          }
        });
      }
      if (url.searchParams.get("from") === "2026-06-13T00:00:00+09:00") {
        return response({
          result: {
            nextDateTime: "2023-12-28T00:00:00+09:00",
            candles: [
              candle("2024-01-02T00:00:00+09:00", 70_000),
              candle("2023-12-29T00:00:00+09:00", 69_000)
            ]
          }
        });
      }
      return response({
        result: {
          nextDateTime: "2026-06-13T00:00:00+09:00",
          candles: [
            candle("2026-06-18T00:00:00+09:00", 80_000),
            candle("2026-06-17T00:00:00+09:00", 79_000)
          ]
        }
      });
    },
    now: () => new Date("2026-06-18T12:00:00+09:00")
  });

  assert.equal(result.status, "completed");
  assert.equal(result.snapshotCount, 2);
  assert.equal(result.symbolReports[0]?.pageCount, 2);
  assert.equal(result.symbolReports[0]?.name, "Samsung Electronics");
  assert.equal(result.symbolReports[0]?.productCode, "A005930");
  assert.equal(result.snapshots[0]?.name, "Samsung Electronics");
  assert.equal(result.snapshots[0]?.observedAt, "2024-01-01T15:00:00.000Z");
  assert.equal(result.snapshots[0]?.interval, "1d");
  assert.equal(result.snapshots[0]?.lastPriceKrw, 70_000);
  assert.equal(result.snapshots[1]?.observedAt, "2026-06-16T15:00:00.000Z");
  assert.equal(result.snapshots[1]?.lastPriceKrw, 79_000);
  assert.deepEqual(result.snapshots[0]?.sourceRefs, [
    "tossinvest_web:c-chart:day:1:A005930:2024-01-02"
  ]);
  assert.match(requestedUrls[1] ?? "", /\/kr-s\/A005930\/day:1/);
  assert.equal(
    new URL(requestedUrls[2] ?? "").searchParams.get("from"),
    "2026-06-13T00:00:00 09:00".replace(" ", "+")
  );
});

test("TossInvest daily chart collector resolves US ticker product codes before day:1 chart fetch", async () => {
  const requestedUrls: string[] = [];
  const result = await collectTossInvestDailyChartSnapshots({
    enabled: true,
    symbols: [
      {
        market: "US",
        symbol: "AAPL",
        sourceSymbol: "AAPL",
        assetType: "STOCK",
        assetClass: "equity",
        region: "US",
        riskTags: ["currency_exposed"]
      }
    ],
    rangeStart: new Date("2024-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2024-01-31T00:00:00+09:00"),
    pageSize: 10,
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.pathname === "/api/v2/search/stocks") {
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(init?.body ?? "{}"), { query: "AAPL" });
        return response({
          result: {
            stocks: [
              {
                stockCode: "US19801212001",
                stockName: "Apple",
                matchType: "EXACT"
              }
            ]
          }
        });
      }
      return response({
        result: {
          nextDateTime: null,
          candles: [candle("2024-01-03T00:00:00+09:00", 180_000)]
        }
      });
    },
    now: () => new Date("2026-06-18T12:00:00+09:00")
  });

  assert.equal(result.status, "completed");
  assert.equal(result.snapshotCount, 1);
  assert.equal(result.symbolReports[0]?.name, "Apple");
  assert.equal(result.symbolReports[0]?.productCode, "US19801212001");
  assert.match(requestedUrls[1] ?? "", /\/us-s\/US19801212001\/day:1/);
  assert.equal(result.snapshots[0]?.name, "Apple");
  assert.deepEqual(result.snapshots[0]?.sourceRefs, [
    "tossinvest_web:c-chart:day:1:US19801212001:2024-01-03"
  ]);
  assert.deepEqual(result.snapshots[0]?.riskTags, ["currency_exposed"]);
});

test("TossInvest daily chart collector prefers product codes for the requested market", async () => {
  const requestedUrls: string[] = [];
  const result = await collectTossInvestDailyChartSnapshots({
    enabled: true,
    symbols: [{ market: "US", symbol: "GS", sourceSymbol: "GS" }],
    rangeStart: new Date("2024-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2024-01-31T00:00:00+09:00"),
    pageSize: 10,
    fetcher: async (input) => {
      const url = new URL(String(input));
      requestedUrls.push(url.toString());
      if (url.pathname === "/api/v2/search/stocks") {
        return response({
          result: {
            stocks: [
              {
                stockCode: "A078930",
                stockName: "GS",
                matchType: "EXACT"
              },
              {
                stockCode: "US19990504001",
                stockName: "골드만삭스",
                matchType: "EXACT"
              }
            ]
          }
        });
      }
      return response({
        result: {
          nextDateTime: null,
          candles: [candle("2024-01-03T00:00:00+09:00", 180_000)]
        }
      });
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.symbolReports[0]?.name, "골드만삭스");
  assert.equal(result.symbolReports[0]?.productCode, "US19990504001");
  assert.match(requestedUrls[1] ?? "", /\/us-s\/US19990504001\/day:1/);
});

test("TossInvest daily chart collector keeps disabled default from fetching", async () => {
  let fetchCount = 0;
  const result = await collectTossInvestDailyChartSnapshots({
    enabled: false,
    symbols: [{ market: "KR", symbol: "005930" }],
    rangeStart: new Date("2024-01-01T00:00:00+09:00"),
    rangeEnd: new Date("2026-06-17T00:00:00+09:00"),
    fetcher: async () => {
      fetchCount += 1;
      return response({ result: { candles: [] } });
    }
  });

  assert.equal(fetchCount, 0);
  assert.equal(result.status, "completed_with_failures");
  assert.equal(result.snapshotCount, 0);
  assert.equal(result.symbolReports[0]?.name, null);
  assert.match(result.symbolReports[0]?.error ?? "", /COLLECTOR_DISABLED/);
});

function response(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body)
  });
}

function candle(dt: string, close: number) {
  return {
    dt,
    base: close,
    open: close - 100,
    high: close + 100,
    low: close - 200,
    close,
    volume: 1000
  };
}
