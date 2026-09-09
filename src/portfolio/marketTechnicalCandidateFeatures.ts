import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { historicalMarketSnapshotSchema, marketSchema } from "../domain/schemas.js";
import { compareText, hashCanonicalPayload, hashDerivedId, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const MARKET_TECHNICAL_FEATURE_MODEL_VERSION = "market_technical_features.v1";
export const MARKET_TECHNICAL_FEATURE_DEFINITIONS = Object.freeze({
  windowReturnRatio: "market_technical.window_return_ratio.v1",
  returnVolatility: "market_technical.observation_return_population_stddev.v1",
  maximumDrawdownRatio: "market_technical.maximum_last_price_drawdown_ratio.v1",
  positiveReturnRatio: "market_technical.positive_observation_return_ratio.v1",
  averageBarVolume: "market_technical.average_bar_volume.v1",
  averageBarNotionalKrw: "market_technical.average_bar_last_price_notional_krw.v1"
});

const identifier = z.string().min(1).max(240).refine((value) => value.trim() === value &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value));
const inputSchema = z.object({
  market: marketSchema, symbol: identifier, interval: z.enum(["1m", "5m", "15m", "1h", "1d"]),
  windowStart: offsetQualifiedIsoDateTimeSchema, asOf: offsetQualifiedIsoDateTimeSchema,
  minimumObservationCount: z.number().int().min(2).max(4096),
  maximumAgeSeconds: z.number().int().positive().max(2_147_483_647),
  snapshots: z.array(historicalMarketSnapshotSchema).min(2).max(4096)
}).strict();
export type MarketTechnicalCandidateFeatureInput = z.input<typeof inputSchema>;

/** Pure calculation over supplied history. Does not authenticate a file/provider, grant eligibility, or calculate a ranking score. */
export function calculateMarketTechnicalCandidateFeatures(value: MarketTechnicalCandidateFeatureInput) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("market technical feature input must already be canonical");
  const start = Date.parse(input.windowStart), asOf = Date.parse(input.asOf);
  if (start > asOf) throw new Error("market technical feature window is reversed");
  if (input.snapshots.length < input.minimumObservationCount) throw new Error("market technical feature history is insufficient");
  const ids = new Set<string>(), times = new Set<number>();
  const snapshots = input.snapshots.map((snapshot) => {
    identifier.parse(snapshot.snapshotId);
    const observedAt = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(snapshot.observedAt));
    const createdAt = Date.parse(offsetQualifiedIsoDateTimeSchema.parse(snapshot.createdAt));
    if (snapshot.market !== input.market || snapshot.symbol !== input.symbol || snapshot.interval !== input.interval) {
      throw new Error("market technical feature history scope or interval mismatch");
    }
    if (observedAt < start || observedAt > asOf || createdAt < observedAt) throw new Error("market technical feature history chronology mismatch");
    if (ids.has(snapshot.snapshotId) || times.has(observedAt)) throw new Error("market technical feature history has duplicate identity or instant");
    ids.add(snapshot.snapshotId); times.add(observedAt);
    for (const price of [snapshot.lastPriceKrw, snapshot.openPriceKrw, snapshot.highPriceKrw, snapshot.lowPriceKrw, snapshot.closePriceKrw]) {
      if (price !== undefined && (!Number.isSafeInteger(price) || price < 0 || Object.is(price, -0))) {
        throw new Error("market technical feature prices must be nonnegative safe integers");
      }
    }
    if (snapshot.lastPriceKrw === 0 || snapshot.volume === undefined || !Number.isSafeInteger(snapshot.volume) ||
      snapshot.volume < 0 || Object.is(snapshot.volume, -0)) throw new Error("market technical features require positive last price and complete safe volume");
    if (!Number.isSafeInteger(snapshot.lastPriceKrw * snapshot.volume)) throw new Error("market technical bar notional is unsafe");
    const sourceRefs = canonicalRefs(snapshot.sourceRefs);
    const riskTags = snapshot.riskTags === undefined ? undefined : [...snapshot.riskTags].sort(compareText);
    if (riskTags && new Set(riskTags).size !== riskTags.length) throw new Error("market technical history has duplicate risk tags");
    return { ...snapshot, sourceRefs, ...(riskTags === undefined ? {} : { riskTags }) };
  }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  if (asOf - Date.parse(snapshots.at(-1)!.observedAt) > input.maximumAgeSeconds * 1000) {
    throw new Error("market technical feature history is stale");
  }
  const prices = snapshots.map((snapshot) => snapshot.lastPriceKrw);
  const returns = prices.slice(1).map((price, index) => (price - prices[index]!) / prices[index]!);
  const mean = returns.reduce((sum, item) => sum + item, 0) / returns.length;
  const variance = returns.reduce((sum, item) => sum + (item - mean) ** 2, 0) / returns.length;
  let peak = prices[0]!, maximumDrawdownRatio = 0;
  for (const price of prices) {
    peak = Math.max(peak, price);
    maximumDrawdownRatio = Math.max(maximumDrawdownRatio, (peak - price) / peak);
  }
  const values = {
    windowReturnRatio: (prices.at(-1)! - prices[0]!) / prices[0]!,
    returnVolatility: Math.sqrt(variance),
    maximumDrawdownRatio,
    positiveReturnRatio: returns.filter((item) => item > 0).length / returns.length,
    averageBarVolume: integerMean(snapshots.map((snapshot) => snapshot.volume!)),
    averageBarNotionalKrw: integerMean(snapshots.map((snapshot) => snapshot.lastPriceKrw * snapshot.volume!))
  };
  for (const result of Object.values(values)) if (!Number.isFinite(result) || Object.is(result, -0)) throw new Error("market technical feature result is not finite or canonical");
  const inputHash = hashCanonicalPayload({ modelVersion: MARKET_TECHNICAL_FEATURE_MODEL_VERSION, ...input, snapshots });
  const evidenceRef = hashDerivedId("market_technical_feature_input", inputHash);
  const featureInputs = Object.entries(MARKET_TECHNICAL_FEATURE_DEFINITIONS).map(([key, featureDefinitionRef]) => ({
    featureDefinitionRef, value: values[key as keyof typeof values], evidenceRefs: [evidenceRef]
  })).sort((left, right) => compareText(left.featureDefinitionRef, right.featureDefinitionRef));
  const payload = { modelVersion: MARKET_TECHNICAL_FEATURE_MODEL_VERSION, market: input.market, symbol: input.symbol,
    interval: input.interval, windowStart: input.windowStart, asOf: input.asOf, inputHash, evidenceRef,
    observationCount: snapshots.length,
    sourceSnapshotRefs: snapshots.map((snapshot) => ({ snapshotId: snapshot.snapshotId, snapshotHash: hashCanonicalPayload(snapshot) })),
    featureInputs };
  return deepFreeze({ ...payload, outputHash: hashCanonicalPayload(payload) });
}

function canonicalRefs(values: string[]) {
  for (const value of values) identifier.parse(value);
  if (new Set(values).size !== values.length) throw new Error("market technical history has duplicate source refs");
  return [...values].sort(compareText);
}
function integerMean(values: number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n), count = BigInt(values.length);
  return Number(sum / count) + Number(sum % count) / values.length;
}
function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
