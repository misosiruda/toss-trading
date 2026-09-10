import assert from "node:assert/strict";
import test from "node:test";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { createMarketTechnicalCandidateEvidenceRecord, parseMarketTechnicalCandidateEvidenceRecord,
  resolveMarketTechnicalCandidateSizingFeatures } from "./marketTechnicalCandidateEvidence.js";
import { calculateMarketTechnicalCandidateFeatures, normalizeMarketTechnicalCandidateFeatureInput } from "./marketTechnicalCandidateFeatures.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

type EvidenceInput = Parameters<typeof createMarketTechnicalCandidateEvidenceRecord>[0];
type SizingInput = Parameters<typeof createCandidateSizingInputRecord>[0];
const AT = "2026-09-04T00:00:00.000Z";
const CREATED = "2026-09-10T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;

test("market technical evidence contains complete canonical input and replayable frozen output", () => {
  const input = fixture();
  input.calculationInput.snapshots.reverse();
  input.calculationInput.snapshots[0]!.sourceRefs = ["synthetic-b", "synthetic-a"];
  const original = structuredClone(input);
  const record = createMarketTechnicalCandidateEvidenceRecord(input);
  const normalized = normalizeMarketTechnicalCandidateFeatureInput(input.calculationInput);
  assert.deepEqual(record.calculationInput, normalized);
  assert.deepEqual(record.calculation, calculateMarketTechnicalCandidateFeatures(original.calculationInput));
  assert.deepEqual(input, original);
  assert.deepEqual(parseMarketTechnicalCandidateEvidenceRecord(JSON.parse(JSON.stringify(record))), record);
  frozen(record);
  frozen(normalized);
  const { evidenceHash, ...payload } = record;
  assert.equal(evidenceHash, hashCanonicalPayload(payload));
  assert.equal(record.evidenceRef, record.calculation.evidenceRef);
  const permuted = structuredClone(input);
  permuted.calculationInput.snapshots.reverse();
  permuted.calculationInput.snapshots.forEach((snapshot) => snapshot.sourceRefs.reverse());
  assert.deepEqual(createMarketTechnicalCandidateEvidenceRecord(permuted), record);
});

test("market technical evidence binds declared source contract and creation time without minting source authority", () => {
  const original = createMarketTechnicalCandidateEvidenceRecord(fixture());
  for (const changed of [{ ...fixture(), sourceContractId: "another-declaration" },
    { ...fixture(), createdAt: "2026-09-10T00:00:00.001Z" }]) {
    const record = createMarketTechnicalCandidateEvidenceRecord(changed);
    assert.equal(record.evidenceRef, original.evidenceRef);
    assert.notEqual(record.evidenceHash, original.evidenceHash);
    assert.deepEqual(parseMarketTechnicalCandidateEvidenceRecord(record), record);
  }
  for (const key of ["sourceVerified", "eligibility", "selectionScore", "policyHash", "portfolioId"]) assert.equal(key in original, false);
});

test("market technical evidence rejects forged feature values even after all supplied output and record hashes are recomputed", () => {
  const original = createMarketTechnicalCandidateEvidenceRecord(fixture());
  for (let index = 0; index < original.calculation.featureInputs.length; index += 1) {
    const record = structuredClone(original);
    record.calculation.featureInputs[index]!.value += 1;
    const { outputHash: ignored, ...calculationPayload } = record.calculation;
    void ignored;
    record.calculation.outputHash = hashCanonicalPayload(calculationPayload);
    assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord(rehash(record)), /calculation replay mismatch/);
  }
});

test("market technical evidence replays source snapshot metadata and model settings instead of trusting hashes", () => {
  const original = createMarketTechnicalCandidateEvidenceRecord(fixture());
  for (const change of [
    (record: typeof original) => { record.calculationInput.snapshots[0]!.lastPriceKrw += 1; },
    (record: typeof original) => { record.calculationInput.snapshots[0]!.sourceRefs = ["different-source"]; },
    (record: typeof original) => { record.calculationInput.maximumAgeSeconds += 1; },
    (record: typeof original) => { record.calculation.sourceSnapshotRefs[0]!.snapshotHash = HASH; },
    (record: typeof original) => { record.calculation.observationCount -= 1; }
  ]) {
    const record = structuredClone(original); change(record);
    assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord(rehash(record)), /calculation replay mismatch/);
  }
  const unsupported = { ...original, calculation: { ...original.calculation, modelVersion: "market_technical_features.v2" } };
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord(rehash(unsupported)), /calculation replay mismatch/);
});

test("market technical evidence parser rejects noncanonical order unknown fields and missing calculation", () => {
  const original = createMarketTechnicalCandidateEvidenceRecord(fixture());
  const record = structuredClone(original);
  record.calculationInput.snapshots.reverse();
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord(rehash(record)), /calculation replay mismatch/);
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord({ ...original, extra: true }));
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord({ ...original, calculation: { ...original.calculation, extra: true } }));
  const { calculation: ignored, ...missing } = original; void ignored;
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord(missing));
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord({ ...original, evidenceHash: HASH }));
  assert.throws(() => parseMarketTechnicalCandidateEvidenceRecord({ ...original, evidenceRef: "another" }));
  assert.throws(() => createMarketTechnicalCandidateEvidenceRecord({ ...fixture(), extra: true } as EvidenceInput));
});

test("market technical evidence cannot predate asOf or any included snapshot materialization", () => {
  assert.throws(() => createMarketTechnicalCandidateEvidenceRecord({ ...fixture(), createdAt: "2026-09-03T00:00:00.000Z" }), /predates/);
  assert.throws(() => createMarketTechnicalCandidateEvidenceRecord({ ...fixture(), createdAt: "2026-09-09T23:59:59.999Z" }), /predates/);
  assert.ok(createMarketTechnicalCandidateEvidenceRecord({ ...fixture(), createdAt: "2026-09-10T09:00:00.000+09:00" }));
  for (const sourceContractId of ["", " padded ", "bad\ud800"]) {
    assert.throws(() => createMarketTechnicalCandidateEvidenceRecord({ ...fixture(), sourceContractId }));
  }
  const invalid = fixture(); delete invalid.calculationInput.snapshots[0]!.volume;
  assert.throws(() => createMarketTechnicalCandidateEvidenceRecord(invalid));
});

test("market technical sizing feature binding accepts recomputed values and exact references without validating other sizing claims", () => {
  const evidence = createMarketTechnicalCandidateEvidenceRecord(fixture());
  const sizingInput = createCandidateSizingInputRecord(sizingFixture(evidence));
  const binding = resolveMarketTechnicalCandidateSizingFeatures({ sizingInput, evidence });
  assert.deepEqual(binding, { sizingInput, evidence });
  frozen(binding);
  const extra = sizingFixture(evidence);
  extra.featureInputs.push({ featureDefinitionRef: "unverified-other-feature", value: true, evidenceRefs: ["other"] });
  extra.selectionScore = 999;
  extra.asOf = "2026-09-04T09:00:00.000+09:00";
  assert.ok(resolveMarketTechnicalCandidateSizingFeatures({ sizingInput: createCandidateSizingInputRecord(extra), evidence }));
  assert.equal("eligibility" in binding, false);
});

test("market technical sizing feature binding rejects independently rehashed value or evidence reference substitution", () => {
  const evidence = createMarketTechnicalCandidateEvidenceRecord(fixture());
  for (const change of [
    (input: SizingInput) => { input.featureInputs[0]!.value = 999; },
    (input: SizingInput) => { input.featureInputs[0]!.evidenceRefs = ["another-source"]; },
    (input: SizingInput) => { input.featureInputs[0]!.evidenceRefs.push("extra-source"); },
    (input: SizingInput) => { input.featureInputs.pop(); }
  ]) {
    const input = sizingFixture(evidence); change(input);
    assert.throws(() => resolveMarketTechnicalCandidateSizingFeatures({ sizingInput: createCandidateSizingInputRecord(input), evidence }), /value or evidence reference/);
  }
  const malformed = structuredClone(evidence);
  malformed.calculation.featureInputs[0]!.value = 999;
  const matchingFalse = sizingFixture(malformed);
  assert.throws(() => resolveMarketTechnicalCandidateSizingFeatures({ sizingInput: createCandidateSizingInputRecord(matchingFalse), evidence: rehash(malformed) }), /calculation replay/);
});

test("market technical sizing feature binding rejects scope and creation order mismatch", () => {
  const evidence = createMarketTechnicalCandidateEvidenceRecord(fixture());
  for (const patch of [{ market: "US" as const }, { symbol: "OTHER" }, { asOf: "2026-09-04T00:00:00.001Z" },
    { createdAt: "2026-09-09T23:59:59.999Z" }]) {
    const sizingInput = createCandidateSizingInputRecord({ ...sizingFixture(evidence), ...patch });
    assert.throws(() => resolveMarketTechnicalCandidateSizingFeatures({ sizingInput, evidence }), /scope or chronology/);
  }
});

function fixture(): EvidenceInput {
  const prices = [100, 120, 90, 108];
  return { sourceContractId: "synthetic-history.v1", createdAt: CREATED,
    calculationInput: { market: "KR", symbol: "SYNTH", interval: "1d", windowStart: "2026-09-01T00:00:00.000Z",
      asOf: AT, minimumObservationCount: 2, maximumAgeSeconds: 60,
      snapshots: prices.map((lastPriceKrw, index) => ({ snapshotId: `synthetic-${index}`, market: "KR", symbol: "SYNTH", interval: "1d",
        observedAt: `2026-09-0${index + 1}T00:00:00.000Z`, lastPriceKrw, volume: 10, sourceRefs: ["synthetic-source"], createdAt: CREATED })) } };
}
function sizingFixture(evidence: ReturnType<typeof createMarketTechnicalCandidateEvidenceRecord>): SizingInput {
  return { requestId: "request", portfolioId: "portfolio", portfolioSnapshotId: "snapshot", portfolioSnapshotHash: HASH, policyHash: HASH,
    asOf: AT, market: "KR", symbol: "SYNTH", bucket: "swing", scoringModelVersion: "unverified-score.v1", sizingAlgorithmVersion: "unverified-sizing.v1",
    selectionScore: 1, featureInputs: structuredClone(evidence.calculation.featureInputs),
    exposureKeys: { sector: "synthetic", country: "KR", currency: "KRW", classificationEvidenceRef: "classification" },
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 1000, sectorRemainingKrw: 1000,
      countryRemainingKrw: 1000, currencyRemainingKrw: 1000, cashAvailableKrw: 1000 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 500,
      participationRate: 0.01, estimatedCostKrw: 0, fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2,
      halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true, maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5, evidenceRefs: ["cost"] }, createdAt: CREATED };
}
function rehash<Value extends { evidenceHash: string }>(record: Value): Value {
  const { evidenceHash: ignored, ...payload } = record; void ignored;
  return { ...record, evidenceHash: hashCanonicalPayload(payload) };
}
function frozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
}
