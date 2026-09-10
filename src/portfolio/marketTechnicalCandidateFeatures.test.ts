import assert from "node:assert/strict";
import test from "node:test";
import { calculateMarketTechnicalCandidateFeatures, MARKET_TECHNICAL_FEATURE_DEFINITIONS as DEFS,
  MARKET_TECHNICAL_FEATURE_MODEL_VERSION, type MarketTechnicalCandidateFeatureInput } from "./marketTechnicalCandidateFeatures.js";
import { compareText, hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

test("market technical features independently calculate the six versioned quantities", () => {
  const result = calculateMarketTechnicalCandidateFeatures(fixture());
  close(feature(result, DEFS.windowReturnRatio), 0.08);
  close(feature(result, DEFS.returnVolatility), Math.sqrt(0.045));
  close(feature(result, DEFS.maximumDrawdownRatio), 0.25);
  close(feature(result, DEFS.positiveReturnRatio), 2 / 3);
  assert.equal(feature(result, DEFS.averageBarVolume), 25);
  assert.equal(feature(result, DEFS.averageBarNotionalKrw), 2605);
  assert.equal(result.observationCount, 4);
  assert.equal(result.modelVersion, MARKET_TECHNICAL_FEATURE_MODEL_VERSION);
  assert.equal(result.featureInputs.length, 6);
  assert.equal("selectionScore" in result, false);
  assert.equal("eligibility" in result, false);
});

test("market technical calculation canonicalizes source ordering without mutating input", () => {
  const input = fixture();
  input.snapshots[0]!.sourceRefs = ["source-b", "source-a"];
  const original = structuredClone(input);
  const result = calculateMarketTechnicalCandidateFeatures(input);
  const reordered = structuredClone(input);
  reordered.snapshots.reverse();
  reordered.snapshots.at(-1)!.sourceRefs.reverse();
  assert.deepEqual(calculateMarketTechnicalCandidateFeatures(reordered), result);
  assert.deepEqual(input, original);
  assert.deepEqual(result.featureInputs.map((item) => item.featureDefinitionRef), Object.values(DEFS).sort(compareText));
  frozen(result);
  assert.deepEqual(calculateMarketTechnicalCandidateFeatures(JSON.parse(JSON.stringify(input))), result);
});

test("market technical input and output hashes independently bind complete supplied snapshots and settings", () => {
  const input = fixture();
  const result = calculateMarketTechnicalCandidateFeatures(input);
  assert.equal(result.inputHash, hashCanonicalPayload({ modelVersion: MARKET_TECHNICAL_FEATURE_MODEL_VERSION, ...input }));
  assert.equal(result.evidenceRef, hashDerivedId("market_technical_feature_input", result.inputHash));
  assert.deepEqual(result.sourceSnapshotRefs, input.snapshots.map((snapshot) => ({ snapshotId: snapshot.snapshotId, snapshotHash: hashCanonicalPayload(snapshot) })));
  const { outputHash, ...payload } = result;
  assert.equal(outputHash, hashCanonicalPayload(payload));
  for (const item of result.featureInputs) assert.deepEqual(item.evidenceRefs, [result.evidenceRef]);
  for (const changed of [
    { ...input, minimumObservationCount: 3 }, { ...input, maximumAgeSeconds: 61 },
    { ...input, windowStart: "2026-08-31T23:59:00.000Z" },
    { ...input, asOf: "2026-09-04T00:00:00.001Z" }
  ]) assert.notEqual(calculateMarketTechnicalCandidateFeatures(changed).inputHash, result.inputHash);
  const metadata = structuredClone(input);
  metadata.snapshots[0]!.name = "synthetic metadata change";
  const changed = calculateMarketTechnicalCandidateFeatures(metadata);
  assert.notEqual(changed.inputHash, result.inputHash);
  assert.notEqual(changed.outputHash, result.outputHash);
  assert.deepEqual(changed.featureInputs.map((item) => item.value), result.featureInputs.map((item) => item.value));
});

test("market technical flat rising and falling histories use positive steps and last-price drawdowns", () => {
  for (const [prices, expectedReturn, expectedDrawdown, positive] of [
    [[100, 100], 0, 0, 0], [[100, 200, 400], 3, 0, 1], [[100, 50, 25], -0.75, 0.75, 0]
  ] as const) {
    const input = fixture([...prices], prices.map(() => 0));
    // Optional close/OHLC fields are not substituted for the explicit last-price series.
    for (const snapshot of input.snapshots) snapshot.closePriceKrw = 1;
    const result = calculateMarketTechnicalCandidateFeatures(input);
    assert.equal(feature(result, DEFS.windowReturnRatio), expectedReturn);
    assert.equal(feature(result, DEFS.maximumDrawdownRatio), expectedDrawdown);
    assert.equal(feature(result, DEFS.positiveReturnRatio), positive);
    assert.equal(feature(result, DEFS.returnVolatility), 0);
    assert.equal(feature(result, DEFS.averageBarNotionalKrw), 0);
    for (const item of result.featureInputs) assert.equal(Object.is(item.value, -0), false);
  }
});

test("market technical means avoid unsafe integer sums and retain fractional means", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const result = calculateMarketTechnicalCandidateFeatures(fixture([1, 1, 1], [maximum, maximum - 3, maximum - 6]));
  assert.equal(feature(result, DEFS.averageBarVolume), maximum - 3);
  assert.equal(feature(result, DEFS.averageBarNotionalKrw), maximum - 3);
  const fractional = calculateMarketTechnicalCandidateFeatures(fixture([1, 2, 3], [1, 2, 2]));
  close(feature(fractional, DEFS.averageBarVolume), 5 / 3);
  close(feature(fractional, DEFS.averageBarNotionalKrw), 11 / 3);
});

test("market technical history fails closed for missing volume zero price and unsafe numeric values", () => {
  for (const value of [0, -0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture(); input.snapshots[0]!.lastPriceKrw = value;
    assert.throws(() => calculateMarketTechnicalCandidateFeatures(input));
  }
  for (const value of [undefined, -0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture();
    if (value === undefined) delete input.snapshots[0]!.volume;
    else input.snapshots[0]!.volume = value;
    assert.throws(() => calculateMarketTechnicalCandidateFeatures(input));
  }
  const product = fixture(); product.snapshots[0]!.volume = Number.MAX_SAFE_INTEGER;
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(product), /notional is unsafe/);
});

test("market technical calculation rejects scope mismatch duplicate ID and duplicate offset-equivalent instants", () => {
  for (const patch of [{ market: "US" as const }, { symbol: "OTHER" }, { interval: "1m" as const }]) {
    const input = fixture(); input.snapshots[0] = { ...input.snapshots[0]!, ...patch };
    assert.throws(() => calculateMarketTechnicalCandidateFeatures(input), /scope or interval/);
  }
  const duplicateId = fixture(); duplicateId.snapshots[1]!.snapshotId = duplicateId.snapshots[0]!.snapshotId;
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(duplicateId), /duplicate/);
  const duplicateTime = fixture(); duplicateTime.snapshots[1]!.observedAt = "2026-09-01T09:00:00.000+09:00";
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(duplicateTime), /duplicate/);
  const duplicateSource = fixture(); duplicateSource.snapshots[0]!.sourceRefs.push("synthetic-source");
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(duplicateSource), /duplicate source refs/);
});

test("market technical calculation rejects malformed timestamps reversed windows and future or out-of-window observations", () => {
  for (const patch of [{ asOf: "2026-02-30T00:00:00.000Z" }, { asOf: "2026-09-04T00:00:00" },
    { windowStart: "2026-09-05T00:00:00.000Z" }, { windowStart: "2026-09-01T00:00:00.001Z" }]) {
    assert.throws(() => calculateMarketTechnicalCandidateFeatures({ ...fixture(), ...patch }));
  }
  const future = fixture(); future.snapshots.at(-1)!.observedAt = "2026-09-05T00:00:00.000Z";
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(future), /chronology/);
  const earlyCreation = fixture(); earlyCreation.snapshots[0]!.createdAt = "2026-08-31T23:59:59.999Z";
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(earlyCreation), /chronology/);
  const unqualified = fixture(); unqualified.snapshots[0]!.observedAt = "2026-09-01T00:00:00";
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(unqualified));
});

test("market technical history uses explicit count and freshness limits with inclusive maximum age", () => {
  assert.throws(() => calculateMarketTechnicalCandidateFeatures({ ...fixture(), minimumObservationCount: 5 }), /insufficient/);
  for (const patch of [{ minimumObservationCount: 1 }, { minimumObservationCount: 4097 },
    { maximumAgeSeconds: 0 }, { maximumAgeSeconds: -0 }, { maximumAgeSeconds: 0.5 }, { maximumAgeSeconds: Infinity }]) {
    assert.throws(() => calculateMarketTechnicalCandidateFeatures({ ...fixture(), ...patch }));
  }
  const boundary = { ...fixture(), asOf: "2026-09-04T00:01:00.000Z" };
  assert.ok(calculateMarketTechnicalCandidateFeatures(boundary));
  assert.throws(() => calculateMarketTechnicalCandidateFeatures({ ...boundary, asOf: "2026-09-04T00:01:00.001Z" }), /stale/);
  assert.throws(() => calculateMarketTechnicalCandidateFeatures({ ...fixture(), snapshots: [fixture().snapshots[0]!] }));
});

test("market technical feature identity includes interval without asserting daily or point-in-time completeness", () => {
  const daily = fixture();
  const intraday = structuredClone(daily); intraday.interval = "1m";
  for (const snapshot of intraday.snapshots) snapshot.interval = "1m";
  const one = calculateMarketTechnicalCandidateFeatures(daily), two = calculateMarketTechnicalCandidateFeatures(intraday);
  assert.deepEqual(one.featureInputs.map((item) => item.value), two.featureInputs.map((item) => item.value));
  assert.notEqual(one.inputHash, two.inputHash);
  // createdAt records later materialization, not what was knowable at the historical asOf.
  assert.ok(daily.snapshots.every((snapshot) => Date.parse(snapshot.createdAt) > Date.parse(daily.asOf)));
  assert.equal("sourceVerified" in one, false);
});

test("market technical input rejects unknown fields noncanonical text and malformed source identities", () => {
  assert.throws(() => calculateMarketTechnicalCandidateFeatures({ ...fixture(), extra: true } as MarketTechnicalCandidateFeatureInput));
  for (const value of ["", " padded", "bad\ud800"]) {
    const input = fixture(); input.snapshots[0]!.sourceRefs = [value];
    assert.throws(() => calculateMarketTechnicalCandidateFeatures(input));
  }
  const text = fixture(); text.snapshots[0]!.name = " padded ";
  assert.throws(() => calculateMarketTechnicalCandidateFeatures(text), /canonical/);
});

function fixture(prices = [100, 120, 90, 108], volumes = [10, 20, 30, 40]): MarketTechnicalCandidateFeatureInput {
  const start = Date.parse("2026-09-01T00:00:00.000Z");
  return { market: "KR", symbol: "SYNTH", interval: "1d", windowStart: new Date(start).toISOString(),
    asOf: new Date(start + (prices.length - 1) * 86400000).toISOString(), minimumObservationCount: 2, maximumAgeSeconds: 60,
    snapshots: prices.map((lastPriceKrw, index) => ({ snapshotId: `synthetic-${index}`, market: "KR", symbol: "SYNTH", interval: "1d",
      observedAt: new Date(start + index * 86400000).toISOString(), lastPriceKrw, volume: volumes[index]!,
      sourceRefs: ["synthetic-source"], createdAt: "2026-09-10T00:00:00.000Z" })) };
}
function feature(result: ReturnType<typeof calculateMarketTechnicalCandidateFeatures>, definition: string): number {
  return result.featureInputs.find((item) => item.featureDefinitionRef === definition)!.value;
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`); }
function frozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
