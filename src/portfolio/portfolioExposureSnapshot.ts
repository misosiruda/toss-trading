import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  marketSchema,
  sha256HashSchema,
  type Market,
  type Sha256Hash
} from "../domain/schemas.js";
import {
  compareText,
  hashCanonicalPayload
} from "./runtimePolicyContracts.js";

const canonicalKeySchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), "key must already be canonical");
const nonNegativeAmountSchema = z
  .number()
  .int()
  .finite()
  .nonnegative()
  .refine(Number.isSafeInteger, "amount must be a safe integer")
  .refine((value) => !Object.is(value, -0), "amount must not be negative zero");
const positiveAmountSchema = z
  .number()
  .int()
  .finite()
  .positive()
  .refine(Number.isSafeInteger, "amount must be a safe integer");
const exposureMapSchema = z.record(canonicalKeySchema, positiveAmountSchema);

const bucketExposureSchema = z
  .object({
    hedge: nonNegativeAmountSchema,
    intraday: nonNegativeAmountSchema,
    long_term: nonNegativeAmountSchema,
    short_term: nonNegativeAmountSchema,
    swing: nonNegativeAmountSchema
  })
  .strict();

const marketExposureSchema = z
  .object({
    KR: nonNegativeAmountSchema,
    US: nonNegativeAmountSchema
  })
  .strict();

export const portfolioSymbolExposureSchema = z
  .object({
    market: marketSchema,
    symbol: canonicalKeySchema,
    exposureKrw: positiveAmountSchema
  })
  .strict();

export const portfolioExposureSnapshotSchema = z
  .object({
    virtualNetWorthKrw: nonNegativeAmountSchema,
    cashKrw: nonNegativeAmountSchema,
    bucketExposureKrw: bucketExposureSchema,
    symbolExposureKrw: z.array(portfolioSymbolExposureSchema).max(10_000),
    marketExposureKrw: marketExposureSchema,
    sectorExposureKrw: exposureMapSchema,
    countryExposureKrw: exposureMapSchema,
    currencyExposureKrw: exposureMapSchema,
    pendingBuyExposureKrw: nonNegativeAmountSchema,
    pendingSellExposureKrw: nonNegativeAmountSchema
  })
  .strict();

export const verifiedPortfolioExposureSnapshotSchema = z
  .object({
    exposureSnapshot: portfolioExposureSnapshotSchema,
    exposureSnapshotHash: sha256HashSchema
  })
  .strict();

export type PortfolioSymbolExposure = z.infer<
  typeof portfolioSymbolExposureSchema
>;
export type PortfolioExposureSnapshot = z.infer<
  typeof portfolioExposureSnapshotSchema
>;
export type VerifiedPortfolioExposureSnapshot = z.infer<
  typeof verifiedPortfolioExposureSnapshotSchema
>;

export function createPortfolioExposureSnapshot(
  input: z.input<typeof portfolioExposureSnapshotSchema>
): VerifiedPortfolioExposureSnapshot {
  const exposureSnapshot = portfolioExposureSnapshotSchema.parse(
    canonicalizeExposureSnapshot(input)
  );
  assertPortfolioExposureSnapshot(exposureSnapshot);
  return deepFreeze({
    exposureSnapshot,
    exposureSnapshotHash: hashCanonicalPayload(exposureSnapshot)
  });
}

export function parseVerifiedPortfolioExposureSnapshot(
  value: unknown
): VerifiedPortfolioExposureSnapshot {
  assertRawCanonicalMapOrder(value);
  const verified = verifiedPortfolioExposureSnapshotSchema.parse(value);
  if (!isDeepStrictEqual(value, verified)) {
    throw new Error("portfolio exposure snapshot must already be canonical");
  }
  assertPortfolioExposureSnapshot(verified.exposureSnapshot);
  const expectedHash = hashCanonicalPayload(verified.exposureSnapshot);
  if (verified.exposureSnapshotHash !== expectedHash) {
    throw new Error("portfolio exposure snapshot hash mismatch");
  }
  return deepFreeze(verified);
}

export function hashPortfolioExposureSnapshot(
  value: PortfolioExposureSnapshot
): Sha256Hash {
  const verified = parseVerifiedPortfolioExposureSnapshot({
    exposureSnapshot: value,
    exposureSnapshotHash: hashCanonicalPayload(value)
  });
  return verified.exposureSnapshotHash;
}

function canonicalizeExposureSnapshot(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  return {
    ...candidate,
    bucketExposureKrw: canonicalFixedExposureMap(candidate.bucketExposureKrw, [
      "hedge",
      "intraday",
      "long_term",
      "short_term",
      "swing"
    ]),
    marketExposureKrw: canonicalFixedExposureMap(candidate.marketExposureKrw, [
      "KR",
      "US"
    ]),
    symbolExposureKrw: canonicalSymbols(candidate.symbolExposureKrw),
    sectorExposureKrw: canonicalExposureMap(candidate.sectorExposureKrw),
    countryExposureKrw: canonicalExposureMap(candidate.countryExposureKrw),
    currencyExposureKrw: canonicalExposureMap(candidate.currencyExposureKrw)
  };
}

function canonicalSymbols(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  const symbols = value.map((item) => portfolioSymbolExposureSchema.parse(item));
  symbols.sort(compareSymbolExposure);
  assertUniqueSymbols(symbols);
  return symbols;
}

function canonicalExposureMap(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const entries = Object.entries(value)
    .map(([key, amount]) => [
      canonicalKeySchema.parse(key),
      nonNegativeAmountSchema.parse(amount)
    ] as const)
    .filter(([, amount]) => amount > 0)
    .sort(([left], [right]) => compareText(left, right));
  return Object.fromEntries(entries);
}

function canonicalFixedExposureMap(
  value: unknown,
  keys: readonly string[]
): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const candidate = value as Record<string, unknown>;
  const expected = new Set(keys);
  const extraKeys = Object.keys(candidate)
    .filter((key) => !expected.has(key))
    .sort(compareText);
  return Object.fromEntries(
    [...keys, ...extraKeys].map((key) => [key, candidate[key]])
  );
}

function assertPortfolioExposureSnapshot(
  snapshot: PortfolioExposureSnapshot
): void {
  if (snapshot.cashKrw > snapshot.virtualNetWorthKrw) {
    throw new Error("portfolio cash cannot exceed virtual net worth");
  }
  const positionExposureKrw = snapshot.virtualNetWorthKrw - snapshot.cashKrw;
  assertCanonicalSymbols(snapshot.symbolExposureKrw);
  assertCanonicalExposureMap(snapshot.sectorExposureKrw, "sector exposure");
  assertCanonicalExposureMap(snapshot.countryExposureKrw, "country exposure");
  assertCanonicalExposureMap(snapshot.currencyExposureKrw, "currency exposure");
  assertTotal(
    Object.values(snapshot.bucketExposureKrw),
    positionExposureKrw,
    "bucket exposure"
  );
  assertTotal(
    snapshot.symbolExposureKrw.map(({ exposureKrw }) => exposureKrw),
    positionExposureKrw,
    "symbol exposure"
  );
  assertTotal(
    Object.values(snapshot.marketExposureKrw),
    positionExposureKrw,
    "market exposure"
  );
  assertTotal(
    Object.values(snapshot.sectorExposureKrw),
    positionExposureKrw,
    "sector exposure"
  );
  assertTotal(
    Object.values(snapshot.countryExposureKrw),
    positionExposureKrw,
    "country exposure"
  );
  assertTotal(
    Object.values(snapshot.currencyExposureKrw),
    positionExposureKrw,
    "currency exposure"
  );
  const marketFromSymbols: Record<Market, number> = { KR: 0, US: 0 };
  for (const symbol of snapshot.symbolExposureKrw) {
    marketFromSymbols[symbol.market] += symbol.exposureKrw;
  }
  if (!isDeepStrictEqual(snapshot.marketExposureKrw, marketFromSymbols)) {
    throw new Error("market exposure does not match symbol exposure");
  }
  if (snapshot.pendingSellExposureKrw > positionExposureKrw) {
    throw new Error("pending sell exposure exceeds current position exposure");
  }
}

function assertCanonicalSymbols(symbols: readonly PortfolioSymbolExposure[]): void {
  const canonical = [...symbols].sort(compareSymbolExposure);
  if (!isDeepStrictEqual(symbols, canonical)) {
    throw new Error("symbol exposure must use canonical market and symbol order");
  }
  assertUniqueSymbols(symbols);
}

function assertUniqueSymbols(symbols: readonly PortfolioSymbolExposure[]): void {
  const identities = new Set<string>();
  for (const symbol of symbols) {
    const identity = `${symbol.market}\u0000${symbol.symbol}`;
    if (identities.has(identity)) {
      throw new Error("symbol exposure must not contain duplicate instruments");
    }
    identities.add(identity);
  }
}

function assertCanonicalExposureMap(
  value: Readonly<Record<string, number>>,
  label: string
): void {
  const keys = Object.keys(value);
  const canonicalKeys = [...keys].sort(compareText);
  if (!isDeepStrictEqual(keys, canonicalKeys)) {
    throw new Error(`${label} keys must use canonical order`);
  }
  if (Object.values(value).some((amount) => amount === 0)) {
    throw new Error(`${label} must omit zero entries`);
  }
}

function assertTotal(
  values: readonly number[],
  expected: number,
  label: string
): void {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total !== expected) {
    throw new Error(`${label} total does not match portfolio position exposure`);
  }
}

function assertRawCanonicalMapOrder(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const root = value as Record<string, unknown>;
  const exposure = root.exposureSnapshot;
  if (
    exposure === null ||
    typeof exposure !== "object" ||
    Array.isArray(exposure)
  ) {
    return;
  }
  const candidate = exposure as Record<string, unknown>;
  assertRawKeyOrder(candidate.bucketExposureKrw, [
    "hedge",
    "intraday",
    "long_term",
    "short_term",
    "swing"
  ], "bucket exposure");
  assertRawKeyOrder(
    candidate.marketExposureKrw,
    ["KR", "US"],
    "market exposure"
  );
  for (const [key, label] of [
    ["sectorExposureKrw", "sector exposure"],
    ["countryExposureKrw", "country exposure"],
    ["currencyExposureKrw", "currency exposure"]
  ] as const) {
    const mapValue = candidate[key];
    if (mapValue !== null && typeof mapValue === "object" && !Array.isArray(mapValue)) {
      const keys = Object.keys(mapValue);
      assertRawKeyOrder(mapValue, [...keys].sort(compareText), label);
    }
  }
}

function assertRawKeyOrder(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  if (!isDeepStrictEqual(Object.keys(value), expectedKeys)) {
    throw new Error(`${label} keys must use canonical order`);
  }
}

function compareSymbolExposure(
  left: PortfolioSymbolExposure,
  right: PortfolioSymbolExposure
): number {
  return (
    compareText(left.market, right.market) ||
    compareText(left.symbol, right.symbol)
  );
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
