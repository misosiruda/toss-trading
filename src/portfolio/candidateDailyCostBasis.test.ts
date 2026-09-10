import assert from "node:assert/strict";
import test from "node:test";
import { calculateCandidateDailyCostBasis, CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
  parseCandidateDailyCostBasis } from "./candidateDailyCostBasis.js";
import { calculateCandidateDailyLiquidity, CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION } from "./candidateDailyLiquidity.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";
import { createMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { createBucketSelectionPolicyRecord, hashCanonicalPayload, parseBucketSelectionPolicyRecord } from "./runtimePolicyContracts.js";

function input(dailyNotional = 2000, referenceNotionalKrw = 200, maximumParticipationRatio = 0.1) {
  const asOf = "2026-09-04T00:00:00.000Z";
  const evidence = createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: "synthetic-daily", createdAt: asOf,
    calculationInput: { market: "KR", symbol: "SYNTH", interval: "1d", windowStart: "2026-09-01T00:00:00.000Z", asOf,
      minimumObservationCount: 2, maximumAgeSeconds: 86400,
      snapshots: [2, 3].map((day) => ({ snapshotId: `synthetic-${day}`, market: "KR", symbol: "SYNTH", interval: "1d",
        observedAt: `2026-09-0${day}T00:00:00.000Z`, createdAt: asOf,
        lastPriceKrw: dailyNotional || 1, volume: dailyNotional === 0 ? 0 : 1, sourceRefs: ["synthetic"] })) } });
  return { modelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION, referenceNotionalKrw,
    liquidity: calculateCandidateDailyLiquidity({ modelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, evidence, maximumParticipationRatio }) };
}

test("daily cost basis binds exact evidence and derives participation while bounding reference notional", () => {
  const original = input(), result = calculateCandidateDailyCostBasis(original);
  assert.deepEqual(result.costBasis, { referenceNotionalKrw: 200, participationRate: 0.1,
    evidenceRefs: original.liquidity.liquidityInput.evidenceRefs });
  assert.equal(result.verificationScope, "daily_liquidity_cost_basis_only");
  assert.throws(() => calculateCandidateDailyCostBasis(input(2000, 201)), /exceeds daily liquidity cap/);
  assert.equal(calculateCandidateDailyCostBasis(input(100, 29, 0.29)).costBasis.participationRate, 0.29);
});

test("daily participation never underestimates canonical rational exposure including repeating decimal boundaries", () => {
  assert.equal(calculateCandidateDailyCostBasis(input(3, 1, 1)).costBasis.participationRate, 0.33333333333333337);
  const unit = canonicalQuantityUnits(1);
  for (const daily of [3, 7, 10, 29, 100, 2000, Number.MAX_SAFE_INTEGER]) {
    for (const notional of [1, Math.floor(daily / 2), daily - 1, daily]) {
      const result = calculateCandidateDailyCostBasis(input(daily, notional, 1));
      const ratio = result.costBasis.participationRate;
      assert.ok(canonicalQuantityUnits(ratio) * BigInt(daily) >= BigInt(notional) * unit);
      assert.ok(ratio <= 1);
      assert.equal(Object.is(ratio, -0), false);
    }
  }
});

test("daily cost basis handles zero safely and rejects missing invalid and overflowing declarations", () => {
  assert.equal(calculateCandidateDailyCostBasis(input(0, 0)).costBasis.participationRate, 0);
  assert.equal(calculateCandidateDailyCostBasis(input(100, 0, 0)).costBasis.participationRate, 0);
  assert.throws(() => calculateCandidateDailyCostBasis(input(0, 1)), /exceeds daily liquidity cap/);
  for (const patch of [{ modelVersion: "unknown.v1" }, { referenceNotionalKrw: -0 }, { referenceNotionalKrw: -1 },
    { referenceNotionalKrw: 0.5 }, { referenceNotionalKrw: Number.MAX_SAFE_INTEGER + 1 }, { referenceNotionalKrw: Infinity },
    { participationRate: 0.1 }, { liquidity: {} }]) {
    assert.throws(() => calculateCandidateDailyCostBasis({ ...input(), ...patch }));
  }
  for (const key of Object.keys(input())) {
    const missing: Record<string, unknown> = input(); delete missing[key];
    assert.throws(() => calculateCandidateDailyCostBasis(missing));
  }
});

test("daily cost basis independently replays liquidity and rejects forged outputs despite recomputed hashes", () => {
  const original = structuredClone(input()), before = structuredClone(original), result = calculateCandidateDailyCostBasis(original);
  assert.deepEqual(original, before);
  const changedLiquidity = { ...original.liquidity,
    liquidityInput: { ...original.liquidity.liquidityInput, maximumLiquidityNotionalKrw: 201 } };
  const { outputHash: ignored, ...liquidityPayload } = changedLiquidity; void ignored;
  assert.throws(() => calculateCandidateDailyCostBasis({ ...original,
    liquidity: { ...liquidityPayload, outputHash: hashCanonicalPayload(liquidityPayload) } }), /replay mismatch/);
  const { outputHash, ...payload } = result;
  assert.equal(outputHash, hashCanonicalPayload(payload));
  assert.equal(result.inputHash, hashCanonicalPayload(result.input));
  for (const patch of [{ referenceNotionalKrw: 199 }, { participationRate: 0.01 }, { evidenceRefs: ["unverified"] }]) {
    const wrong = { ...payload, costBasis: { ...payload.costBasis, ...patch } };
    assert.throws(() => parseCandidateDailyCostBasis({ ...wrong, outputHash: hashCanonicalPayload(wrong) }), /replay mismatch/);
  }
  assert.throws(() => parseCandidateDailyCostBasis({ ...result, extra: true }), /replay mismatch/);
  assert.deepEqual(parseCandidateDailyCostBasis(JSON.parse(JSON.stringify(result))), result);
  original.liquidity.input.evidence.calculationInput.snapshots[0]!.lastPriceKrw = 1;
  assert.equal(result.input.liquidity.input.evidence.calculationInput.snapshots[0]!.lastPriceKrw, 2000);
  frozen(result);
});

test("daily cost basis model is hash-bound and is never synthesized for legacy policies", () => {
  const policyInput = { bucket: "swing" as const, version: "synthetic.v1", createdAt: "2026-09-01T00:00:00.000Z",
    requiredEvidence: [{ evidenceClass: "market_technical" as const, sourceContractId: "synthetic", maximumAgeSeconds: 60 }],
    hardGateRuleIds: ["synthetic"], scoringModelVersion: "synthetic.v1", featureDefinitionRefs: ["synthetic"] };
  const legacy = createBucketSelectionPolicyRecord(policyInput);
  const selected = createBucketSelectionPolicyRecord({ ...policyInput, costBasisModelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION });
  assert.equal("costBasisModelVersion" in legacy, false);
  assert.equal(JSON.stringify(parseBucketSelectionPolicyRecord(legacy)), JSON.stringify(legacy));
  assert.notEqual(selected.hash, legacy.hash); assert.notEqual(selected.selectionPolicyRecordId, legacy.selectionPolicyRecordId);
  assert.notEqual(selected.lineageHash, legacy.lineageHash);
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...selected, costBasisModelVersion: "other.v1" }), /hash mismatch/);
  for (const costBasisModelVersion of ["", " ", "x".repeat(81), null]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...policyInput, costBasisModelVersion } as never));
  }
});

function frozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
