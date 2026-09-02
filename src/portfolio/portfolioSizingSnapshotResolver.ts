import { isDeepStrictEqual } from "node:util";

import {
  marketSchema,
  strategyBucketSchema,
  type Market,
  type StrategyBucket,
  type VirtualPosition
} from "../domain/schemas.js";
import {
  createPortfolioExposureSnapshot,
  type VerifiedPortfolioExposureSnapshot
} from "./portfolioExposureSnapshot.js";
import type {
  PortfolioValuationInput
} from "./portfolioSizingInputs.js";
import {
  parsePortfolioSizingSnapshot,
  type PortfolioSizingSnapshot
} from "./portfolioSizingSnapshot.js";

type MarkPriceInput = Extract<
  PortfolioValuationInput,
  { kind: "mark_price" }
>;

const MARKET_CURRENCY: Readonly<Record<Market, "KRW" | "USD">> = {
  KR: "KRW",
  US: "USD"
};

export interface ResolvedPortfolioSizingSnapshot {
  snapshot: PortfolioSizingSnapshot;
  verifiedExposure: VerifiedPortfolioExposureSnapshot;
}

/**
 * Replays the valuation inputs needed by a sizing snapshot and independently
 * reconstructs every exposure dimension before the snapshot can be consumed.
 */
export function resolvePortfolioSizingSnapshot(
  value: unknown
): ResolvedPortfolioSizingSnapshot {
  const snapshot = parsePortfolioSizingSnapshot(value);
  const marks = resolveExactMarks(snapshot);
  assertExactFxCoverage(snapshot);
  const verifiedExposure = reconstructExposure(snapshot, marks);
  const storedExposure = {
    exposureSnapshot: snapshot.exposureSnapshot,
    exposureSnapshotHash: snapshot.exposureSnapshotHash
  };
  if (!isDeepStrictEqual(verifiedExposure, storedExposure)) {
    throw new Error(
      "portfolio sizing exposure does not match valuation replay"
    );
  }
  return deepFreeze({ snapshot, verifiedExposure });
}

function resolveExactMarks(
  snapshot: PortfolioSizingSnapshot
): ReadonlyMap<string, MarkPriceInput> {
  const positionKeys = new Set(
    snapshot.virtualPortfolio.positions.map((position) =>
      instrumentKey(position.market, position.symbol)
    )
  );
  const marks = new Map<string, MarkPriceInput>();
  for (const valuation of snapshot.valuationInputs) {
    if (valuation.kind !== "mark_price") {
      continue;
    }
    const key = instrumentKey(valuation.market, valuation.symbol);
    if (!positionKeys.has(key)) {
      throw new Error("portfolio sizing valuation contains an unheld mark");
    }
    marks.set(key, valuation);
  }
  for (const key of positionKeys) {
    if (!marks.has(key)) {
      throw new Error("portfolio sizing valuation is missing a position mark");
    }
  }
  return marks;
}

function assertExactFxCoverage(snapshot: PortfolioSizingSnapshot): void {
  const requiredBaseCurrencies = new Set<string>(
    snapshot.virtualPortfolio.positions
      .map((position) => MARKET_CURRENCY[position.market])
      .filter((currency) => currency !== "KRW")
  );
  const observedBaseCurrencies = new Set<string>();
  for (const valuation of snapshot.valuationInputs) {
    if (valuation.kind !== "fx_rate") {
      continue;
    }
    if (!requiredBaseCurrencies.has(valuation.baseCurrency)) {
      throw new Error("portfolio sizing valuation contains an unused FX pair");
    }
    observedBaseCurrencies.add(valuation.baseCurrency);
  }
  for (const currency of requiredBaseCurrencies) {
    if (!observedBaseCurrencies.has(currency)) {
      throw new Error("portfolio sizing valuation is missing a required FX pair");
    }
  }
}

function reconstructExposure(
  snapshot: PortfolioSizingSnapshot,
  marks: ReadonlyMap<string, MarkPriceInput>
): VerifiedPortfolioExposureSnapshot {
  const bucketExposureKrw = zeroRecord(strategyBucketSchema.options);
  const marketExposureKrw = zeroRecord(marketSchema.options);
  const symbolExposure = new Map<
    string,
    { market: Market; symbol: string; exposureKrw: number }
  >();
  const sectorExposureKrw: Record<string, number> = {};
  const countryExposureKrw: Record<string, number> = {};
  const currencyExposureKrw: Record<string, number> = {};
  let totalPositionExposureKrw = 0;

  for (const position of snapshot.virtualPortfolio.positions) {
    const bucket = requireBucket(position);
    const sector = requireClassification(position.sector, "sector");
    const country = requireClassification(position.region, "country");
    const currency = MARKET_CURRENCY[position.market];
    const mark = marks.get(instrumentKey(position.market, position.symbol));
    if (mark === undefined) {
      throw new Error("portfolio sizing valuation is missing a position mark");
    }
    const exposureKrw = markedPositionValue(position, mark);
    assertEmbeddedMarkConsistency(position, mark, exposureKrw);
    totalPositionExposureKrw = safeAdd(
      totalPositionExposureKrw,
      exposureKrw,
      "position exposure"
    );
    bucketExposureKrw[bucket] = safeAdd(
      bucketExposureKrw[bucket],
      exposureKrw,
      "bucket exposure"
    );
    marketExposureKrw[position.market] = safeAdd(
      marketExposureKrw[position.market],
      exposureKrw,
      "market exposure"
    );
    addClassification(sectorExposureKrw, sector, exposureKrw, "sector exposure");
    addClassification(countryExposureKrw, country, exposureKrw, "country exposure");
    addClassification(
      currencyExposureKrw,
      currency,
      exposureKrw,
      "currency exposure"
    );
    const key = instrumentKey(position.market, position.symbol);
    const current = symbolExposure.get(key);
    symbolExposure.set(key, {
      market: position.market,
      symbol: position.symbol,
      exposureKrw: safeAdd(
        current?.exposureKrw ?? 0,
        exposureKrw,
        "symbol exposure"
      )
    });
  }

  const virtualNetWorthKrw = safeAdd(
    snapshot.virtualPortfolio.cashKrw,
    totalPositionExposureKrw,
    "virtual net worth"
  );
  return createPortfolioExposureSnapshot({
    virtualNetWorthKrw,
    cashKrw: snapshot.virtualPortfolio.cashKrw,
    bucketExposureKrw,
    symbolExposureKrw: [...symbolExposure.values()],
    marketExposureKrw,
    sectorExposureKrw,
    countryExposureKrw,
    currencyExposureKrw,
    pendingBuyExposureKrw: snapshot.exposureSnapshot.pendingBuyExposureKrw,
    pendingSellExposureKrw: snapshot.exposureSnapshot.pendingSellExposureKrw
  });
}

function requireBucket(position: VirtualPosition): StrategyBucket {
  if (position.strategyBucket === undefined) {
    throw new Error("portfolio sizing position is missing strategy bucket");
  }
  return position.strategyBucket;
}

function requireClassification(
  value: string | undefined,
  label: string
): string {
  if (value === undefined) {
    throw new Error(`portfolio sizing position is missing ${label}`);
  }
  return value;
}

function markedPositionValue(
  position: VirtualPosition,
  mark: MarkPriceInput
): number {
  if (position.quantity <= 0) {
    throw new Error("portfolio sizing position quantity must be positive");
  }
  const exposureKrw = Math.round(position.quantity * mark.priceKrw);
  if (!Number.isSafeInteger(exposureKrw) || exposureKrw <= 0) {
    throw new Error("portfolio sizing marked position value must be positive and safe");
  }
  return exposureKrw;
}

function assertEmbeddedMarkConsistency(
  position: VirtualPosition,
  mark: MarkPriceInput,
  exposureKrw: number
): void {
  if (
    position.marketPriceKrw !== undefined &&
    position.marketPriceKrw !== mark.priceKrw
  ) {
    throw new Error("portfolio sizing position market price does not match mark");
  }
  if (
    position.marketValueKrw !== undefined &&
    position.marketValueKrw !== exposureKrw
  ) {
    throw new Error("portfolio sizing position market value does not match mark");
  }
  if (position.unrealizedPnlKrw !== undefined) {
    const costBasisKrw = Math.round(
      position.quantity * position.averagePriceKrw
    );
    if (
      !Number.isSafeInteger(costBasisKrw) ||
      position.unrealizedPnlKrw !== exposureKrw - costBasisKrw
    ) {
      throw new Error("portfolio sizing position unrealized PnL does not match mark");
    }
  }
}

function addClassification(
  target: Record<string, number>,
  key: string,
  amount: number,
  label: string
): void {
  target[key] = safeAdd(target[key] ?? 0, amount, label);
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0 || Object.is(total, -0)) {
    throw new Error(`${label} must remain a non-negative safe integer`);
  }
  return total;
}

function zeroRecord<Key extends string>(
  keys: readonly Key[]
): Record<Key, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>;
}

function instrumentKey(market: Market, symbol: string): string {
  return `${market}\u0000${symbol}`;
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
