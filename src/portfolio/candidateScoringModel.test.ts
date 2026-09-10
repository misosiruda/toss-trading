import assert from "node:assert/strict";
import test from "node:test";
import { CANDIDATE_SCORING_ALGORITHM, calculateCandidateSelectionScore, createCandidateScoringModel,
  parseCandidateScoringModel, parseCandidateSelectionScore, type CandidateScoringModelInput } from "./candidateScoringModel.js";
import { createMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";
import { hashCanonicalPayload, hashDerivedId } from "./runtimePolicyContracts.js";

const AT = "2026-09-01T00:00:00.000Z";
function parameters(): CandidateScoringModelInput {
  return { algorithm: CANDIDATE_SCORING_ALGORITHM, version: "synthetic-score.v1", createdAt: AT, terms: [
    { featureDefinitionRef: "return.v1", weight: 0.75, lowerBound: -1, upperBound: 1, direction: "higher_is_better" },
    { featureDefinitionRef: "drawdown.v1", weight: 0.25, lowerBound: 0, upperBound: 1, direction: "lower_is_better" }
  ] };
}
function input() {
  return { model: createCandidateScoringModel(parameters()), features: [
    { featureDefinitionRef: "return.v1", value: 0, evidenceRefs: ["source-b", "source-a"] },
    { featureDefinitionRef: "drawdown.v1", value: 0.2, evidenceRefs: ["source-a"] }
  ] };
}

test("candidate scoring model canonicalizes parameters and binds the complete immutable payload", () => {
  const original = parameters(), model = createCandidateScoringModel(original);
  assert.deepEqual(model.terms.map((term) => term.featureDefinitionRef), ["drawdown.v1", "return.v1"]);
  assert.deepEqual(createCandidateScoringModel({ ...original, terms: [...original.terms].reverse() }), model);
  assert.deepEqual(parseCandidateScoringModel(JSON.parse(JSON.stringify(model))), model);
  frozen(model);
  original.terms[0]!.weight = 0.5;
  assert.equal(model.terms[1]!.weight, 0.75);
  for (const patch of [{ version: "synthetic-score.v2" }, { createdAt: "2026-09-02T00:00:00.000Z" },
    { terms: parameters().terms.map((term) => ({ ...term, weight: 0.5 })) }]) {
    assert.notEqual(createCandidateScoringModel({ ...parameters(), ...patch }).scoringModelHash, model.scoringModelHash);
  }
});

test("candidate scoring calculation uses explicit weights directions bounds and canonical ordering", () => {
  const result = calculateCandidateSelectionScore(input());
  assert.equal(result.selectionScore, 0.575);
  assert.deepEqual(result.contributions.map((term) => term.normalizedValue), [0.8, 0.5]);
  assert.deepEqual(result.contributions.map((term) => term.normalizedWeight), [0.25, 0.75]);
  const reversed = input(); reversed.features.reverse(); reversed.features.forEach((feature) => feature.evidenceRefs.reverse());
  assert.deepEqual(calculateCandidateSelectionScore(reversed), result);
  assert.deepEqual(parseCandidateSelectionScore(JSON.parse(JSON.stringify(result))), result);
  assert.equal("eligibility" in result, false); assert.equal("targetWeightRatio" in result, false);
  frozen(result);
});

test("candidate scoring clamps bounds and supports one feature and subnormal positive weights", () => {
  for (const direction of ["higher_is_better", "lower_is_better"] as const) {
    const model = createCandidateScoringModel({ ...parameters(), terms: [{ featureDefinitionRef: "one", weight: Number.MIN_VALUE,
      lowerBound: 0, upperBound: 10, direction }] });
    for (const [value, expected] of [[-1, 0], [0, 0], [5, 0.5], [10, 1], [11, 1]]) {
      const result = calculateCandidateSelectionScore({ model, features: [{ featureDefinitionRef: "one", value: value!, evidenceRefs: ["ref"] }] });
      assert.equal(result.selectionScore, direction === "higher_is_better" ? expected : 1 - expected!);
    }
  }
});

test("candidate scoring rejects missing extra duplicate and nonnumeric features instead of supplying defaults", () => {
  const baseline = input();
  const variants = [[], baseline.features.slice(0, 1), [...baseline.features, baseline.features[0]],
    [...baseline.features, { ...baseline.features[0], featureDefinitionRef: "unused" }],
    ...[NaN, Infinity, -Infinity, -0, true, "0", null, Number.MAX_VALUE].map((value) => [
      { ...baseline.features[0], value }, baseline.features[1]
    ]), baseline.features.map((feature) => ({ ...feature, evidenceRefs: [] })),
    baseline.features.map((feature) => ({ ...feature, evidenceRefs: ["duplicate", "duplicate"] }))];
  for (const features of variants) assert.throws(() => calculateCandidateSelectionScore({ ...baseline, features } as never));
  assert.throws(() => calculateCandidateSelectionScore({ ...baseline, extra: true } as never));
  assert.throws(() => calculateCandidateSelectionScore({ ...baseline, features: baseline.features.map((feature) => ({ ...feature, extra: true })) }));
});

test("candidate scoring model rejects unsupported algorithms incomplete parameters and invalid numbers", () => {
  const raw = parameters(), term = raw.terms[0]!;
  for (const patch of [{ algorithm: "unknown" }, { version: " padded " }, { version: "\ud800" }, { createdAt: "2026-02-30T00:00:00Z" },
    { terms: [] }, { terms: Array.from({ length: 129 }, (_, index) => ({ ...term, featureDefinitionRef: `term-${index}` })) },
    { terms: [term, term] }, { extra: true }]) assert.throws(() => createCandidateScoringModel({ ...raw, ...patch } as never));
  for (const patch of [{ weight: 0 }, { weight: -0 }, { weight: -1 }, { weight: 1.1 }, { weight: NaN },
    { lowerBound: 1, upperBound: 1 }, { lowerBound: 2, upperBound: 1 }, { lowerBound: -0 }, { upperBound: Infinity },
    { upperBound: Number.MAX_VALUE }, { direction: "unknown" }, { extra: true }]) {
    assert.throws(() => createCandidateScoringModel({ ...raw, terms: [{ ...term, ...patch }] } as never));
  }
  for (const key of ["weight", "lowerBound", "upperBound", "direction"] as const) {
    const incomplete: Record<string, unknown> = { ...term }; delete incomplete[key];
    assert.throws(() => createCandidateScoringModel({ ...raw, terms: [incomplete] } as never));
  }
});

test("candidate scoring model parser rejects changed parameters identity noncanonical order and unknown fields", () => {
  const model = createCandidateScoringModel(parameters());
  for (const patch of [{ scoringModelRecordId: "wrong" }, { scoringModelHash: `sha256:${"f".repeat(64)}` },
    { createdAt: "2026-09-02T00:00:00.000Z" }, { terms: [...model.terms].reverse() }, { extra: true },
    { terms: model.terms.map((term) => ({ ...term, weight: 0.5 })) }]) {
    assert.throws(() => parseCandidateScoringModel({ ...model, ...patch }));
  }
  const { scoringModelRecordId: ignoredId, scoringModelHash: ignoredHash, ...payload } = model;
  void ignoredId; void ignoredHash;
  const reversed = { ...payload, terms: [...payload.terms].reverse() };
  const scoringModelHash = hashCanonicalPayload(reversed);
  assert.throws(() => parseCandidateScoringModel({ ...reversed, scoringModelHash,
    scoringModelRecordId: hashDerivedId("candidate_scoring_model", scoringModelHash) }), /order mismatch/);
});

test("candidate score replay rejects fabricated scores contributions and provenance even with recomputed hashes", () => {
  const result = calculateCandidateSelectionScore(input());
  for (const patch of [{ selectionScore: 0.99 }, { contributions: [...result.contributions].reverse() },
    { contributions: result.contributions.map((term) => ({ ...term, weightedScore: 0.99 })) },
    { scoringModelVersion: "other" }, { extra: true }]) {
    const changed = { ...result, ...patch };
    const { input: ignoredInput, outputHash: ignoredOutput, ...payload } = changed; void ignoredInput; void ignoredOutput;
    assert.throws(() => parseCandidateSelectionScore({ ...changed, outputHash: hashCanonicalPayload(payload) }), /replay mismatch/);
  }
  const changedInput = { ...result.input, features: result.input.features.map((feature) => ({ ...feature, evidenceRefs: ["forged-ref"] })) };
  const changed = { ...result, input: changedInput, inputHash: hashCanonicalPayload(changedInput) };
  const { input: ignoredInput, outputHash: ignoredOutput, ...payload } = changed; void ignoredInput; void ignoredOutput;
  assert.throws(() => parseCandidateSelectionScore({ ...changed, outputHash: hashCanonicalPayload(payload) }), /replay mismatch/);
  for (const value of [null, {}, { input: null }, { ...result, input: { ...result.input, features: [...result.input.features].reverse() } }]) {
    assert.throws(() => parseCandidateSelectionScore(value));
  }
});

test("candidate scoring consumes independently replayed market technical evidence with explicit feature model terms", () => {
  const evidence = createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: "synthetic-market.v1", createdAt: "2026-09-03T00:00:00.000Z",
    calculationInput: { market: "KR", symbol: "SYNTH", interval: "1d", windowStart: AT, asOf: "2026-09-02T00:00:00.000Z",
      minimumObservationCount: 2, maximumAgeSeconds: 86400, snapshots: [1, 2].map((day) => ({ snapshotId: `row-${day}`, market: "KR", symbol: "SYNTH", interval: "1d",
        observedAt: `2026-09-0${day}T00:00:00.000Z`, createdAt: `2026-09-0${day}T00:00:00.000Z`, lastPriceKrw: 100 * day, volume: 10, sourceRefs: ["synthetic"] })) } });
  const model = createCandidateScoringModel({ ...parameters(), terms: Object.values(MARKET_TECHNICAL_FEATURE_DEFINITIONS).map((featureDefinitionRef) => ({
    featureDefinitionRef, weight: 1, lowerBound: 0, upperBound: 1, direction: "higher_is_better"
  })) });
  const result = calculateCandidateSelectionScore({ model, features: evidence.calculation.featureInputs });
  assert.equal(result.contributions.length, 6);
  assert.ok(result.selectionScore >= 0 && result.selectionScore <= 1);
  assert.deepEqual(parseCandidateSelectionScore(JSON.parse(JSON.stringify(result))), result);
  assert.ok(result.contributions.every((term) => term.evidenceRefs[0] === evidence.evidenceRef));
});

test("candidate scoring handles the maximum feature count and numeric bounds without overflow", () => {
  const terms = Array.from({ length: 128 }, (_, index) => ({ featureDefinitionRef: `feature-${index}`, weight: 1,
    lowerBound: -Number.MAX_SAFE_INTEGER, upperBound: Number.MAX_SAFE_INTEGER, direction: "higher_is_better" as const }));
  const model = createCandidateScoringModel({ ...parameters(), terms });
  const result = calculateCandidateSelectionScore({ model, features: terms.map((term) => ({ featureDefinitionRef: term.featureDefinitionRef,
    value: 0, evidenceRefs: ["synthetic"] })) });
  assert.equal(result.selectionScore, 0.5);
});

function frozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
