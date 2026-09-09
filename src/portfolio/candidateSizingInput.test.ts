import assert from "node:assert/strict";
import test from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { createCandidateSizingInputRecord, parseCandidateSizingInputRecord, resolveCandidateSizingInputRequestBinding } from "./candidateSizingInput.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const AT = "2026-09-01T00:00:00.000Z";
const LATER = "2026-09-01T01:00:00.000Z";
type Input = Parameters<typeof createCandidateSizingInputRecord>[0];

test("candidate sizing input canonicalizes feature and evidence order without mutating input", () => {
  const input = fixture();
  const original = clone(input);
  const record = createCandidateSizingInputRecord(input);
  assert.deepEqual(input, original);
  assert.deepEqual(record.featureInputs.map((feature) => feature.featureDefinitionRef), ["feature-a", "feature-b", "feature-c"]);
  assert.deepEqual(record.featureInputs[0]!.evidenceRefs, ["evidence-a", "evidence-b"]);
  assert.deepEqual(record.liquidityInput.evidenceRefs, ["liquidity-a", "liquidity-b"]);
  assert.deepEqual(record.executionCostInput.evidenceRefs, ["cost-a", "cost-b"]);
  const reordered = fixture();
  reordered.featureInputs.reverse();
  reordered.featureInputs.forEach((feature) => feature.evidenceRefs.reverse());
  reordered.liquidityInput.evidenceRefs.reverse();
  reordered.executionCostInput.evidenceRefs.reverse();
  assert.deepEqual(createCandidateSizingInputRecord(reordered), record);
  assert.deepEqual(parseCandidateSizingInputRecord(clone(record)), record);
  assertFrozen(record);
});

test("candidate sizing identity uses request market symbol while complete hash includes every payload leaf", () => {
  const record = createCandidateSizingInputRecord(fixture());
  const { sizingInputRecordId, sizingInputHash: _hash, createdAt: _created, ...payload } = record;
  assert.equal(record.sizingInputHash, hashCanonicalPayload(payload));
  for (const leaf of leaves(payload)) {
    const changed = clone(record);
    const next = typeof leaf.value === "number" ? leaf.value + 1 : typeof leaf.value === "boolean" ? !leaf.value : `${leaf.value}-changed`;
    setAt(changed, leaf.path, next);
    assert.throws(() => parseCandidateSizingInputRecord(changed), leaf.path.join("."));
  }
  const scoreChange = createCandidateSizingInputRecord({ ...fixture(), selectionScore: 3 });
  assert.equal(scoreChange.sizingInputRecordId, sizingInputRecordId);
  assert.notEqual(scoreChange.sizingInputHash, record.sizingInputHash);
  const createdChange = createCandidateSizingInputRecord({ ...fixture(), createdAt: LATER });
  assert.equal(createdChange.sizingInputRecordId, sizingInputRecordId);
  assert.equal(createdChange.sizingInputHash, record.sizingInputHash);
  for (const patch of [{ requestId: "other" }, { market: "US" as const }, { symbol: "other" }]) {
    assert.notEqual(createCandidateSizingInputRecord({ ...fixture(), ...patch }).sizingInputRecordId, sizingInputRecordId);
  }
  assert.throws(() => parseCandidateSizingInputRecord({ ...record, sizingInputRecordId: "wrong" }));
  assert.throws(() => parseCandidateSizingInputRecord({ ...record, sizingInputHash: OTHER }));
});

test("candidate sizing parser rejects rehashed noncanonical order duplicate features and duplicate evidence", () => {
  const record = createCandidateSizingInputRecord(fixture());
  const reordered = clone(record);
  reordered.featureInputs.reverse();
  const { sizingInputRecordId: _id, sizingInputHash: _hash, createdAt: _created, ...payload } = reordered;
  assert.throws(() => parseCandidateSizingInputRecord({ ...reordered, sizingInputHash: hashCanonicalPayload(payload) }), /order is not canonical/);
  const duplicateFeature = fixture();
  duplicateFeature.featureInputs.push(clone(duplicateFeature.featureInputs[0]!));
  assert.throws(() => createCandidateSizingInputRecord(duplicateFeature), /duplicate feature/);
  for (const path of [["featureInputs", "0", "evidenceRefs"], ["liquidityInput", "evidenceRefs"], ["executionCostInput", "evidenceRefs"]]) {
    const input = fixture();
    setAt(input, path, ["same", "same"]);
    assert.throws(() => createCandidateSizingInputRecord(input), /duplicate evidence/);
  }
});

test("candidate sizing requires every execution parameter and rejects missing or unknown nested fields", () => {
  const record = createCandidateSizingInputRecord(fixture());
  for (const key of Object.keys(record.executionCostInput)) {
    const input = fixture();
    delete (input.executionCostInput as unknown as Record<string, unknown>)[key];
    assert.throws(() => createCandidateSizingInputRecord(input), key);
  }
  for (const path of [[], ["exposureKeys"], ["featureInputs", "0"], ["exposureCapInputs"], ["liquidityInput"], ["executionCostInput"]]) {
    const input = fixture();
    setAt(input, [...path, "unknown"], true);
    assert.throws(() => createCandidateSizingInputRecord(input));
  }
  const missing = fixture();
  delete (missing.exposureKeys as unknown as Record<string, unknown>).classificationEvidenceRef;
  assert.throws(() => createCandidateSizingInputRecord(missing));
});

test("candidate sizing rejects unsafe negative zero invalid ratios malformed text and unqualified timestamps", () => {
  for (const value of [-1, -0, 0.1, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    const input = fixture();
    input.exposureCapInputs.cashAvailableKrw = value;
    assert.throws(() => createCandidateSizingInputRecord(input));
  }
  for (const value of [-0, Infinity, NaN]) assert.throws(() => createCandidateSizingInputRecord({ ...fixture(), selectionScore: value }));
  for (const value of [-1, -0, 1.1, Infinity]) {
    const input = fixture();
    input.liquidityInput.maximumParticipationRatio = value;
    assert.throws(() => createCandidateSizingInputRecord(input));
  }
  for (const value of ["", " padded", "bad\ud800", "x".repeat(241)]) assert.throws(() => createCandidateSizingInputRecord({ ...fixture(), symbol: value }));
  for (const patch of [{ asOf: "2026-09-01T00:00:00" }, { createdAt: "2026-08-31T23:00:00.000Z" }, { createdAt: "2026-02-30T00:00:00.000Z" }]) {
    assert.throws(() => createCandidateSizingInputRecord({ ...fixture(), ...patch }));
  }
  assert.throws(() => createCandidateSizingInputRecord({ ...fixture(), featureInputs: [] }));
  const invalidFeature = fixture();
  invalidFeature.featureInputs[0]!.value = "bad\ud800";
  assert.throws(() => createCandidateSizingInputRecord(invalidFeature));
});

test("candidate sizing binds independently parsed request scope without granting sizing or capacity authority", () => {
  const request = selectionRequest();
  const record = createCandidateSizingInputRecord(fixture());
  assert.deepEqual(resolveCandidateSizingInputRequestBinding({ sizingInput: record, request }).sizingInput, record);
  for (const patch of [{ requestId: "other" }, { portfolioId: "other" }, { portfolioSnapshotId: "other" },
    { portfolioSnapshotHash: OTHER }, { policyHash: OTHER }, { bucket: "swing" as const }, { asOf: LATER, createdAt: LATER }]) {
    const changed = createCandidateSizingInputRecord({ ...fixture(), ...patch });
    assert.throws(() => resolveCandidateSizingInputRequestBinding({ sizingInput: changed, request }), /request scope/);
  }
  assert.throws(() => resolveCandidateSizingInputRequestBinding({ sizingInput: record, request: { ...request, createdAt: LATER } }), /chronology/);
  assert.throws(() => resolveCandidateSizingInputRequestBinding({ sizingInput: record, request: { ...request, gapKrw: 999 } }));
  const offset = createCandidateSizingInputRecord({ ...fixture(), asOf: "2026-09-01T09:00:00.000+09:00" });
  assert.ok(resolveCandidateSizingInputRequestBinding({ sizingInput: offset, request }));
});

function fixture(): Input {
  const request = selectionRequest();
  return { requestId: request.requestId, portfolioId: request.portfolioId, portfolioSnapshotId: request.portfolioSnapshotId,
    portfolioSnapshotHash: HASH, policyHash: HASH, asOf: AT, market: "KR", symbol: "005930", bucket: "intraday",
    scoringModelVersion: "score.v1", sizingAlgorithmVersion: "sizing.v1", selectionScore: 2,
    exposureKeys: { sector: "Technology", country: "KR", currency: "KRW", classificationEvidenceRef: "classification" },
    featureInputs: [ { featureDefinitionRef: "feature-c", value: "category", evidenceRefs: ["evidence-c"] },
      { featureDefinitionRef: "feature-b", value: true, evidenceRefs: ["evidence-b"] },
      { featureDefinitionRef: "feature-a", value: 1.5, evidenceRefs: ["evidence-b", "evidence-a"] } ],
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 900, sectorRemainingKrw: 800,
      countryRemainingKrw: 700, currencyRemainingKrw: 600, cashAvailableKrw: 500 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000,
      evidenceRefs: ["liquidity-b", "liquidity-a"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 500,
      participationRate: 0.01, estimatedCostKrw: 0, fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2,
      halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true, maxVolumeParticipationRate: 0.1,
      minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5,
      evidenceRefs: ["cost-b", "cost-a"] }, createdAt: AT };
}
function selectionRequest() {
  return createBucketSelectionRequest({ cycleId: "cycle", triggerIdentity: "trigger", triggerRef: "ref", portfolioId: "portfolio",
    portfolioSnapshotId: "snapshot", portfolioSnapshotHash: HASH, policyHash: HASH, asOf: AT, bucket: "intraday",
    gapBasis: "entry_floor", gapKrw: 1000, availableSlots: 2, maximumAdditionalExposureKrw: 1000, evidenceCutoffAt: AT, createdAt: AT });
}
function clone<Value>(value: Value): Value { return JSON.parse(JSON.stringify(value)); }
function setAt(value: unknown, path: string[], replacement: unknown) {
  let parent = value as Record<string, unknown>;
  for (const key of path.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[path.at(-1)!] = replacement;
}
function leaves(value: unknown, path: string[] = []): { path: string[]; value: string | number | boolean }[] {
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => leaves(item, [...path, key]));
  return [{ path, value: value as string | number | boolean }];
}
function assertFrozen(value: unknown) {
  if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); }
}
