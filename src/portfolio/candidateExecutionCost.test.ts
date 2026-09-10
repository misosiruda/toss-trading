import assert from "node:assert/strict";
import test from "node:test";
import { calculateCandidateExecutionCost, CANDIDATE_EXECUTION_COST_MODEL_VERSION,
  parseCandidateExecutionCost, replayCandidateSizingExecutionCost } from "./candidateExecutionCost.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

function parameters() {
  return { modelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION, side: "BUY" as "BUY" | "SELL",
    referenceNotionalKrw: 100_000, participationRate: 0.02,
    fillPriceRule: "current_candidate_last_price" as const, feeBps: 10, taxBps: 20,
    halfSpreadBps: 3, slippageBps: 5, fillRatio: 1, allowFractionalShares: true,
    maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true,
    marketImpactBpsPerParticipationRate: 100, evidenceRefs: ["synthetic-cost"] };
}

test("candidate reference cost independently computes BUY and SELL components with explicit model version", () => {
  const buy = calculateCandidateExecutionCost(parameters());
  assert.deepEqual([buy.feeKrw, buy.taxKrw, buy.slippageKrw, buy.spreadCostKrw, buy.impactCostKrw, buy.estimatedCostKrw],
    [100, 0, 50, 30, 20, 200]);
  const sell = calculateCandidateExecutionCost({ ...parameters(), side: "SELL" });
  assert.equal(sell.taxKrw, 200);
  assert.equal(sell.estimatedCostKrw, 400);
  assert.equal(buy.verificationScope, "reference_notional_cost_only");
  assert.equal("fill" in buy, false);
  assert.equal("eligibility" in buy, false);
});

test("candidate reference cost rounds each component upward using exact canonical decimals", () => {
  const result = calculateCandidateExecutionCost({ ...parameters(), referenceNotionalKrw: 1, side: "SELL" });
  assert.deepEqual([result.feeKrw, result.taxKrw, result.slippageKrw, result.spreadCostKrw, result.impactCostKrw], [1, 1, 1, 1, 1]);
  assert.equal(result.estimatedCostKrw, 5);
  const exact = calculateCandidateExecutionCost({ ...parameters(), referenceNotionalKrw: 1_000_000,
    feeBps: 0.07, taxBps: 0, slippageBps: 0, halfSpreadBps: 0, marketImpactBpsPerParticipationRate: 0 });
  assert.equal(exact.feeKrw, 7); // Binary multiplication must not turn an exact 7 into 8.
  const tiny = calculateCandidateExecutionCost({ ...parameters(), referenceNotionalKrw: 1,
    feeBps: Number.MIN_VALUE, slippageBps: 0, halfSpreadBps: 0,
    participationRate: Number.MIN_VALUE, marketImpactBpsPerParticipationRate: Number.MIN_VALUE });
  assert.equal(tiny.feeKrw, 1);
  assert.equal(tiny.impactCostKrw, 1); // A positive decimal product must not underflow to zero.
});

test("candidate reference cost handles zero notional and zero participation without inventing a fill", () => {
  const zero = calculateCandidateExecutionCost({ ...parameters(), referenceNotionalKrw: 0 });
  assert.equal(zero.estimatedCostKrw, 0);
  assert.equal(calculateCandidateExecutionCost({ ...parameters(), participationRate: 0 }).impactCostKrw, 0);
  assert.equal(calculateCandidateExecutionCost({ ...parameters(), feeBps: 0, taxBps: 0, slippageBps: 0,
    halfSpreadBps: 0, marketImpactBpsPerParticipationRate: 0 }).estimatedCostKrw, 0);
});

test("candidate cost binds all complete parameters but does not reapply fill ratio or whole-share rounding", () => {
  const input = parameters(), before = structuredClone(input), result = calculateCandidateExecutionCost(input);
  assert.deepEqual(input, before);
  input.evidenceRefs[0] = "mutated-after-calculation";
  assert.equal(result.input.evidenceRefs[0], "synthetic-cost");
  for (const patch of [{ fillRatio: 0.5 }, { allowFractionalShares: false }, { maxVolumeParticipationRate: 0.01 },
    { minLiquidityFillRatio: 0.2 }, { rejectStaleLiquidity: false }, { evidenceRefs: ["other-source"] }]) {
    const changed = calculateCandidateExecutionCost({ ...parameters(), ...patch });
    assert.notEqual(changed.inputHash, result.inputHash);
    assert.notEqual(changed.outputHash, result.outputHash);
    assert.equal(changed.estimatedCostKrw, result.estimatedCostKrw);
  }
  frozen(result);
  const { outputHash, ...payload } = result;
  assert.equal(outputHash, hashCanonicalPayload(payload));
  assert.equal(result.inputHash, hashCanonicalPayload(result.input));
  assert.deepEqual(parseCandidateExecutionCost(JSON.parse(JSON.stringify(result))), result);
});

test("candidate cost refuses unknown legacy models missing parameters and noncanonical evidence", () => {
  for (const modelVersion of ["paper_cost_model.v5", "execution_simulator.v4", "execution_simulator.v5", "unknown.v1"]) {
    assert.throws(() => calculateCandidateExecutionCost({ ...parameters(), modelVersion }));
  }
  for (const key of Object.keys(parameters())) {
    const input: Record<string, unknown> = parameters(); delete input[key];
    assert.throws(() => calculateCandidateExecutionCost(input), key);
  }
  for (const patch of [{ estimatedCostKrw: 200 }, { extra: true }, { feeBps: -0 }, { feeBps: -1 },
    { feeBps: Infinity }, { taxBps: Number.MAX_VALUE }, { referenceNotionalKrw: 0.5 },
    { participationRate: 1.01 }, { evidenceRefs: ["b", "a"] }, { evidenceRefs: ["a", "a"] }, { evidenceRefs: [] }]) {
    assert.throws(() => calculateCandidateExecutionCost({ ...parameters(), ...patch }));
  }
});

test("candidate cost rejects unsafe individual amounts and sums instead of rounding or clamping them", () => {
  const base = { ...parameters(), referenceNotionalKrw: Number.MAX_SAFE_INTEGER, slippageBps: 0,
    halfSpreadBps: 0, marketImpactBpsPerParticipationRate: 0 };
  assert.equal(calculateCandidateExecutionCost({ ...base, feeBps: 10_000 }).feeKrw, Number.MAX_SAFE_INTEGER);
  assert.throws(() => calculateCandidateExecutionCost({ ...base, feeBps: 10_001 }), /safe KRW range/);
  assert.throws(() => calculateCandidateExecutionCost({ ...base, feeBps: 10_000, halfSpreadBps: Number.MIN_VALUE }), /safe KRW range/);
});

test("candidate cost parser rejects every changed output even after a forged payload is rehashed", () => {
  const record = calculateCandidateExecutionCost(parameters());
  for (const key of ["feeKrw", "taxKrw", "slippageKrw", "spreadCostKrw", "impactCostKrw", "estimatedCostKrw"] as const) {
    const { outputHash: ignored, ...payload } = record; void ignored;
    const changed = { ...payload, [key]: payload[key] + 1 };
    assert.throws(() => parseCandidateExecutionCost({ ...changed, outputHash: hashCanonicalPayload(changed) }), /replay mismatch/);
  }
  assert.throws(() => parseCandidateExecutionCost({ ...record, input: { ...record.input, feeBps: 11 } }), /replay mismatch/);
  assert.throws(() => parseCandidateExecutionCost({ ...record, inputHash: "sha256:invalid" }), /replay mismatch/);
  assert.throws(() => parseCandidateExecutionCost({ ...record, extra: true }));
});

test("candidate sizing cost replay rejects correctly hashed but incorrect declared estimates", () => {
  const sizingInput = candidate();
  const replay = replayCandidateSizingExecutionCost(sizingInput);
  assert.equal(replay.calculation.estimatedCostKrw, 200);
  frozen(replay);
  const { sizingInputRecordId: ignoredId, sizingInputHash: ignoredHash, ...payload } = sizingInput; void ignoredId; void ignoredHash;
  for (const estimatedCostKrw of [0, 199, 201]) {
    const wrong = createCandidateSizingInputRecord({ ...payload, executionCostInput: { ...payload.executionCostInput, estimatedCostKrw } });
    assert.throws(() => replayCandidateSizingExecutionCost(wrong), /independent replay/);
  }
  assert.throws(() => replayCandidateSizingExecutionCost({ ...sizingInput, selectionScore: 99 }), /hash mismatch/);
});

function candidate() {
  const hash = `sha256:${"a".repeat(64)}`, at = "2026-09-01T00:00:00.000Z";
  return createCandidateSizingInputRecord({ requestId: "synthetic-request", portfolioId: "synthetic-portfolio",
    portfolioSnapshotId: "synthetic-snapshot", portfolioSnapshotHash: hash, policyHash: hash, asOf: at,
    market: "KR", symbol: "SYNTH", bucket: "swing", scoringModelVersion: "score.v1", sizingAlgorithmVersion: "sizing.v1", selectionScore: 1,
    exposureKeys: { sector: "sector", country: "KR", currency: "KRW", classificationEvidenceRef: "classification" },
    featureInputs: [{ featureDefinitionRef: "feature.v1", value: 1, evidenceRefs: ["source"] }],
    exposureCapInputs: { bucketRemainingKrw: 1, symbolRemainingKrw: 1, sectorRemainingKrw: 1,
      countryRemainingKrw: 1, currencyRemainingKrw: 1, cashAvailableKrw: 1 },
    liquidityInput: { averageDailyNotionalKrw: 1, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1, evidenceRefs: ["source"] },
    executionCostInput: { ...parameters(), estimatedCostKrw: 200 }, createdAt: at });
}
function frozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
