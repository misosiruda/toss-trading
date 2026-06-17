import type {
  TossOpenApiReadOnlyQueryValue,
  TossOpenApiReadOnlyRequestInput
} from "./tossOpenApiReadOnlyHttpClient.js";

export type TossOpenApiMarketDataAdapterErrorCode =
  | "TOSS_OPEN_API_MARKET_DATA_INVALID_SYMBOL"
  | "TOSS_OPEN_API_MARKET_DATA_INVALID_SYMBOLS"
  | "TOSS_OPEN_API_MARKET_DATA_INVALID_COUNT"
  | "TOSS_OPEN_API_MARKET_DATA_INVALID_INTERVAL"
  | "TOSS_OPEN_API_MARKET_DATA_INVALID_MARKET";

export type TossOpenApiMarketCalendarRegion = "KR" | "US";
export type TossOpenApiCandleInterval = "1m" | "1d";

export interface TossOpenApiReadOnlyJsonClient {
  getJson(
    path: string,
    query?: TossOpenApiReadOnlyRequestInput["query"]
  ): Promise<unknown>;
}

export interface TossOpenApiPricesInput {
  symbols: readonly string[];
}

export interface TossOpenApiSymbolInput {
  symbol: string;
}

export interface TossOpenApiTradesInput extends TossOpenApiSymbolInput {
  count?: number;
}

export interface TossOpenApiCandlesInput extends TossOpenApiSymbolInput {
  interval: TossOpenApiCandleInterval;
  count?: number;
  before?: string;
  adjusted?: boolean;
}

export interface TossOpenApiMarketCalendarInput {
  market: TossOpenApiMarketCalendarRegion;
  date?: string;
}

export class TossOpenApiMarketDataAdapterError extends Error {
  constructor(
    readonly code: TossOpenApiMarketDataAdapterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TossOpenApiMarketDataAdapterError";
  }
}

export class TossOpenApiMarketDataAdapter {
  constructor(private readonly client: TossOpenApiReadOnlyJsonClient) {}

  async getPrices(input: TossOpenApiPricesInput): Promise<unknown> {
    return this.client.getJson("/api/v1/prices", [
      ["symbols", normalizeSymbols(input.symbols).join(",")]
    ]);
  }

  async getOrderbook(input: TossOpenApiSymbolInput): Promise<unknown> {
    return this.client.getJson("/api/v1/orderbook", [
      ["symbol", normalizeSymbol(input.symbol)]
    ]);
  }

  async getTrades(input: TossOpenApiTradesInput): Promise<unknown> {
    return this.client.getJson("/api/v1/trades", [
      ["symbol", normalizeSymbol(input.symbol)],
      ["count", normalizeCount(input.count, 50)]
    ]);
  }

  async getCandles(input: TossOpenApiCandlesInput): Promise<unknown> {
    return this.client.getJson("/api/v1/candles", [
      ["symbol", normalizeSymbol(input.symbol)],
      ["interval", normalizeCandleInterval(input.interval)],
      ["count", normalizeCount(input.count, 200)],
      ["before", normalizeOptionalText(input.before)],
      ["adjusted", input.adjusted]
    ]);
  }

  async getStockWarnings(input: TossOpenApiSymbolInput): Promise<unknown> {
    const symbol = normalizeSymbol(input.symbol);
    return this.client.getJson(
      `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`
    );
  }

  async getMarketCalendar(
    input: TossOpenApiMarketCalendarInput
  ): Promise<unknown> {
    const market = normalizeMarketCalendarRegion(input.market);
    return this.client.getJson(`/api/v1/market-calendar/${market}`, [
      ["date", normalizeOptionalText(input.date)]
    ]);
  }
}

function normalizeSymbols(symbols: readonly string[]): string[] {
  if (symbols.length === 0) {
    throw new TossOpenApiMarketDataAdapterError(
      "TOSS_OPEN_API_MARKET_DATA_INVALID_SYMBOLS",
      "Toss Open API prices request requires at least one symbol."
    );
  }

  return symbols.map(normalizeSymbol);
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.-]+$/.test(normalized)) {
    throw new TossOpenApiMarketDataAdapterError(
      "TOSS_OPEN_API_MARKET_DATA_INVALID_SYMBOL",
      "Toss Open API market symbol must contain only letters, numbers, dot, or dash."
    );
  }

  return normalized;
}

function normalizeCount(
  count: number | undefined,
  max: number
): TossOpenApiReadOnlyQueryValue | undefined {
  if (count === undefined) {
    return undefined;
  }
  if (!Number.isInteger(count) || count < 1 || count > max) {
    throw new TossOpenApiMarketDataAdapterError(
      "TOSS_OPEN_API_MARKET_DATA_INVALID_COUNT",
      `Toss Open API market data count must be between 1 and ${max}.`
    );
  }

  return count;
}

function normalizeCandleInterval(
  interval: TossOpenApiCandleInterval
): TossOpenApiCandleInterval {
  if (interval !== "1m" && interval !== "1d") {
    throw new TossOpenApiMarketDataAdapterError(
      "TOSS_OPEN_API_MARKET_DATA_INVALID_INTERVAL",
      "Toss Open API candle interval must be 1m or 1d."
    );
  }

  return interval;
}

function normalizeMarketCalendarRegion(
  market: TossOpenApiMarketCalendarRegion
): TossOpenApiMarketCalendarRegion {
  if (market !== "KR" && market !== "US") {
    throw new TossOpenApiMarketDataAdapterError(
      "TOSS_OPEN_API_MARKET_DATA_INVALID_MARKET",
      "Toss Open API market calendar region must be KR or US."
    );
  }

  return market;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
