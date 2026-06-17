import assert from "node:assert/strict";
import test from "node:test";

import type { TossOpenApiReadOnlyRequestInput } from "./tossOpenApiReadOnlyHttpClient.js";
import {
  TossOpenApiMarketDataAdapter,
  TossOpenApiMarketDataAdapterError
} from "./tossOpenApiMarketDataAdapter.js";

class FakeReadOnlyJsonClient {
  readonly calls: Array<{
    path: string;
    query: TossOpenApiReadOnlyRequestInput["query"] | undefined;
  }> = [];
  private readonly responses: unknown[];

  constructor(responses: unknown[] = []) {
    this.responses = [...responses];
  }

  async getJson(
    path: string,
    query?: TossOpenApiReadOnlyRequestInput["query"]
  ): Promise<unknown> {
    this.calls.push({ path, query });
    return this.responses.shift() ?? { ok: true };
  }
}

test("market data adapter maps prices request to read-only endpoint", async () => {
  const client = new FakeReadOnlyJsonClient([{ prices: [] }]);
  const adapter = new TossOpenApiMarketDataAdapter(client);

  assert.deepEqual(await adapter.getPrices({ symbols: ["005930", "aapl"] }), {
    prices: []
  });
  assert.deepEqual(client.calls, [
    {
      path: "/api/v1/prices",
      query: [["symbols", "005930,AAPL"]]
    }
  ]);
});

test("market data adapter maps orderbook, trades, and candles queries", async () => {
  const client = new FakeReadOnlyJsonClient([
    { orderbook: [] },
    { trades: [] },
    { candles: [] }
  ]);
  const adapter = new TossOpenApiMarketDataAdapter(client);

  assert.deepEqual(await adapter.getOrderbook({ symbol: "brk.b" }), {
    orderbook: []
  });
  assert.deepEqual(await adapter.getTrades({ symbol: "005930", count: 25 }), {
    trades: []
  });
  assert.deepEqual(
    await adapter.getCandles({
      symbol: "005930",
      interval: "1d",
      count: 100,
      before: "2026-03-25T09:00:00+09:00",
      adjusted: false
    }),
    { candles: [] }
  );

  assert.deepEqual(client.calls, [
    {
      path: "/api/v1/orderbook",
      query: [["symbol", "BRK.B"]]
    },
    {
      path: "/api/v1/trades",
      query: [
        ["symbol", "005930"],
        ["count", 25]
      ]
    },
    {
      path: "/api/v1/candles",
      query: [
        ["symbol", "005930"],
        ["interval", "1d"],
        ["count", 100],
        ["before", "2026-03-25T09:00:00+09:00"],
        ["adjusted", false]
      ]
    }
  ]);
});

test("market data adapter maps stock warnings and market calendar endpoints", async () => {
  const client = new FakeReadOnlyJsonClient([{ warnings: [] }, { sessions: [] }]);
  const adapter = new TossOpenApiMarketDataAdapter(client);

  assert.deepEqual(await adapter.getStockWarnings({ symbol: "005930" }), {
    warnings: []
  });
  assert.deepEqual(
    await adapter.getMarketCalendar({ market: "KR", date: "2026-06-17" }),
    { sessions: [] }
  );

  assert.deepEqual(client.calls, [
    {
      path: "/api/v1/stocks/005930/warnings",
      query: undefined
    },
    {
      path: "/api/v1/market-calendar/KR",
      query: [["date", "2026-06-17"]]
    }
  ]);
});

test("market data adapter rejects invalid inputs before HTTP client", async () => {
  const client = new FakeReadOnlyJsonClient();
  const adapter = new TossOpenApiMarketDataAdapter(client);

  await assert.rejects(
    () => adapter.getPrices({ symbols: [] }),
    (error) =>
      error instanceof TossOpenApiMarketDataAdapterError &&
      error.code === "TOSS_OPEN_API_MARKET_DATA_INVALID_SYMBOLS"
  );
  await assert.rejects(
    () =>
      adapter.getPrices({
        symbols: Array.from({ length: 201 }, (_, index) =>
          String(index + 1).padStart(6, "0")
        )
      }),
    (error) =>
      error instanceof TossOpenApiMarketDataAdapterError &&
      error.code === "TOSS_OPEN_API_MARKET_DATA_TOO_MANY_SYMBOLS"
  );
  await assert.rejects(
    () => adapter.getOrderbook({ symbol: "../orders" }),
    (error) =>
      error instanceof TossOpenApiMarketDataAdapterError &&
      error.code === "TOSS_OPEN_API_MARKET_DATA_INVALID_SYMBOL"
  );
  await assert.rejects(
    () => adapter.getTrades({ symbol: "005930", count: 51 }),
    (error) =>
      error instanceof TossOpenApiMarketDataAdapterError &&
      error.code === "TOSS_OPEN_API_MARKET_DATA_INVALID_COUNT"
  );
  await assert.rejects(
    () =>
      adapter.getCandles({
        symbol: "005930",
        interval: "5m" as "1m",
        count: 1
      }),
    (error) =>
      error instanceof TossOpenApiMarketDataAdapterError &&
      error.code === "TOSS_OPEN_API_MARKET_DATA_INVALID_INTERVAL"
  );
  await assert.rejects(
    () => adapter.getMarketCalendar({ market: "JP" as "KR" }),
    (error) =>
      error instanceof TossOpenApiMarketDataAdapterError &&
      error.code === "TOSS_OPEN_API_MARKET_DATA_INVALID_MARKET"
  );

  assert.equal(client.calls.length, 0);
});

test("market data adapter exposes only read-only market endpoints", async () => {
  const client = new FakeReadOnlyJsonClient();
  const adapter = new TossOpenApiMarketDataAdapter(client);

  await adapter.getPrices({ symbols: ["005930"] });
  await adapter.getOrderbook({ symbol: "005930" });
  await adapter.getTrades({ symbol: "005930" });
  await adapter.getCandles({ symbol: "005930", interval: "1m" });
  await adapter.getStockWarnings({ symbol: "005930" });
  await adapter.getMarketCalendar({ market: "US" });

  assert.deepEqual(
    client.calls.map((call) => call.path),
    [
      "/api/v1/prices",
      "/api/v1/orderbook",
      "/api/v1/trades",
      "/api/v1/candles",
      "/api/v1/stocks/005930/warnings",
      "/api/v1/market-calendar/US"
    ]
  );
  assert.equal(
    client.calls.some((call) => call.path.includes("/api/v1/orders")),
    false
  );
});
