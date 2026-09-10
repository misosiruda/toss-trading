import assert from "node:assert/strict";
import test from "node:test";
import { calculateCandidateDailyLiquidity, CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION,
  parseCandidateDailyLiquidity } from "./candidateDailyLiquidity.js";
import { createMarketTechnicalCandidateEvidenceRecord } from "./marketTechnicalCandidateEvidence.js";
import { createBucketSelectionPolicyRecord, hashCanonicalPayload, parseBucketSelectionPolicyRecord } from "./runtimePolicyContracts.js";

function input(notionals = [1000, 3000], maximumParticipationRatio = 0.1, interval: "1d" | "1h" = "1d") {
  const asOf = "2026-09-04T00:00:00.000Z";
  return { modelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION, maximumParticipationRatio,
    evidence: createMarketTechnicalCandidateEvidenceRecord({ sourceContractId: "synthetic-daily", createdAt: asOf,
      calculationInput: { market: "KR", symbol: "SYNTH", interval, windowStart: "2026-09-01T00:00:00.000Z", asOf,
        minimumObservationCount: 2, maximumAgeSeconds: 86400,
        snapshots: notionals.map((notional, index) => ({ snapshotId: `synthetic-${index}`, market: "KR", symbol: "SYNTH", interval,
          observedAt: `2026-09-0${index + 2}T00:00:00.000Z`, createdAt: asOf,
          lastPriceKrw: notional || 1, volume: notional === 0 ? 0 : 1, sourceRefs: ["synthetic"] })) } }) };
}

test("daily liquidity explicitly computes daily last-price notional proxy and exact decimal participation cap", () => {
  const original = input(), result = calculateCandidateDailyLiquidity(original);
  assert.deepEqual(result.liquidityInput, { averageDailyNotionalKrw: 2000, maximumParticipationRatio: 0.1,
    maximumLiquidityNotionalKrw: 200, evidenceRefs: [original.evidence.evidenceRef] });
  assert.equal(result.verificationScope, "daily_bar_notional_proxy_only");
  assert.equal(calculateCandidateDailyLiquidity(input([100, 100], 0.29)).liquidityInput.maximumLiquidityNotionalKrw, 29);
  assert.equal(calculateCandidateDailyLiquidity(input([1, 2], 0.9)).liquidityInput.maximumLiquidityNotionalKrw, 0);
  assert.equal(calculateCandidateDailyLiquidity(input([1, 2], 1)).liquidityInput.averageDailyNotionalKrw, 1);
});

test("daily liquidity keeps zero and safe-integer boundaries without sum overflow or upward rounding", () => {
  for (const ratio of [0, Number.MIN_VALUE, 1]) {
    assert.equal(calculateCandidateDailyLiquidity(input([0, 0], ratio)).liquidityInput.maximumLiquidityNotionalKrw, 0);
  }
  const result = calculateCandidateDailyLiquidity(input([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], 1));
  assert.equal(result.liquidityInput.averageDailyNotionalKrw, Number.MAX_SAFE_INTEGER);
  assert.equal(result.liquidityInput.maximumLiquidityNotionalKrw, Number.MAX_SAFE_INTEGER);
  assert.equal(calculateCandidateDailyLiquidity(input([100, 100], Number.MIN_VALUE)).liquidityInput.maximumLiquidityNotionalKrw, 0);
});

test("daily liquidity refuses intraday substitution malformed inputs and forged underlying evidence", () => {
  assert.throws(() => calculateCandidateDailyLiquidity(input([1000, 3000], 0.1, "1h")), /requires daily bars/);
  for (const patch of [{ modelVersion: "unknown.v1" }, { maximumParticipationRatio: -0 }, { maximumParticipationRatio: -1 },
    { maximumParticipationRatio: 1.1 }, { maximumParticipationRatio: NaN }, { extra: true }, { evidence: {} }]) {
    assert.throws(() => calculateCandidateDailyLiquidity({ ...input(), ...patch }));
  }
  const forged = structuredClone(input());
  forged.evidence.calculationInput.snapshots[0]!.lastPriceKrw += 1;
  const { evidenceHash: ignored, ...payload } = forged.evidence; void ignored;
  const rehashed = { ...forged, evidence: { ...payload, evidenceHash: hashCanonicalPayload(payload) } };
  assert.throws(() => calculateCandidateDailyLiquidity(rehashed), /replay mismatch/);
});

test("daily liquidity independently replays every output and binds full evidence without mutating caller input", () => {
  const original = structuredClone(input()), before = structuredClone(original), result = calculateCandidateDailyLiquidity(original);
  assert.deepEqual(original, before);
  original.evidence.calculationInput.snapshots[0]!.lastPriceKrw = 1;
  assert.equal(result.input.evidence.calculationInput.snapshots[0]!.lastPriceKrw, 1000);
  assert.deepEqual(parseCandidateDailyLiquidity(JSON.parse(JSON.stringify(result))), result);
  const { outputHash, ...payload } = result;
  assert.equal(outputHash, hashCanonicalPayload(payload));
  assert.equal(result.inputHash, hashCanonicalPayload(result.input));
  for (const key of ["averageDailyNotionalKrw", "maximumParticipationRatio", "maximumLiquidityNotionalKrw"] as const) {
    const wrong = { ...payload, liquidityInput: { ...payload.liquidityInput, [key]: payload.liquidityInput[key] + 1 } };
    assert.throws(() => parseCandidateDailyLiquidity({ ...wrong, outputHash: hashCanonicalPayload(wrong) }), /replay mismatch/);
  }
  for (const patch of [{ observationCount: 3 }, { inputHash: "wrong" }, { extra: true },
    { liquidityInput: { ...result.liquidityInput, evidenceRefs: ["other"] } }]) {
    assert.throws(() => parseCandidateDailyLiquidity({ ...result, ...patch }), /replay mismatch/);
  }
  frozen(result);
});

test("liquidity model selection changes policy identity while absent legacy fields remain absent", () => {
  const policyInput = { bucket: "swing" as const, version: "synthetic.v1", createdAt: "2026-09-01T00:00:00.000Z",
    requiredEvidence: [{ evidenceClass: "market_technical" as const, sourceContractId: "synthetic", maximumAgeSeconds: 60 }],
    hardGateRuleIds: ["synthetic"], scoringModelVersion: "synthetic.v1", featureDefinitionRefs: ["synthetic"] };
  const legacy = createBucketSelectionPolicyRecord(policyInput);
  const selected = createBucketSelectionPolicyRecord({ ...policyInput, liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION });
  assert.equal("liquidityEstimationModelVersion" in legacy, false);
  assert.equal(JSON.stringify(parseBucketSelectionPolicyRecord(legacy)), JSON.stringify(legacy));
  assert.notEqual(selected.hash, legacy.hash);
  assert.notEqual(selected.selectionPolicyRecordId, legacy.selectionPolicyRecordId);
  assert.notEqual(selected.lineageHash, legacy.lineageHash);
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...selected, liquidityEstimationModelVersion: "other.v1" }), /hash mismatch/);
  for (const liquidityEstimationModelVersion of ["", " ", "x".repeat(81), null]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...policyInput, liquidityEstimationModelVersion } as never));
  }
});

function frozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
