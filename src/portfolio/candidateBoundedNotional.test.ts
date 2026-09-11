import assert from "node:assert/strict";
import test from "node:test";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { calculateCandidateBoundedNotional, parseCandidateBoundedNotional } from "./candidateBoundedNotional.js";
import { CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION, type CandidateNotionalSizingPolicy } from "./candidateNotionalSizingPolicy.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { policyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createBucketSelectionPolicyRecord, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  parseBucketSelectionPolicyRecord, selectionPolicyRefFor } from "./runtimePolicyContracts.js";

const AT = "2026-09-04T00:00:00.000Z", HASH = `sha256:${"a".repeat(64)}`;
const model: CandidateNotionalSizingPolicy = { modelVersion: CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION,
  minimumScoreMultiplier: 0.5, maximumScoreMultiplier: 1.5, minimumOrderNotionalKrw: 1 };

test("bounded notional floors base then interpolates canonical score within explicit policy multiplier bounds", () => {
  for (const [score, expected] of [[0, 25], [0.5, 50], [1, 75]] as const) {
    const input = fixture({ score }), result = calculateCandidateBoundedNotional(input);
    assert.equal(result.baseNotionalKrw, 50);
    assert.equal(result.initialMaximumNotionalKrw, expected);
    assert.deepEqual(parseCandidateBoundedNotional(JSON.parse(JSON.stringify(result))), result);
    assert.ok(Object.isFrozen(result.input.selectionPolicy.notionalSizingPolicy));
    assert.equal(result.currentExecutionAuthority, "not_granted");
    assert.equal(result.costBenefitAndWeightBand, "not_evaluated");
    assert.equal(result.finalSizing, "not_performed");
  }
  assert.equal(calculateCandidateBoundedNotional(fixture({ gap: 100, slots: 3, score: 1 })).uncappedNotionalKrw, "49");
});

test("bounded notional caps every declared dimension and applies zero and minimum order boundaries", () => {
  const baseline = fixture({ score: 1 });
  for (const key of Object.keys(baseline.sizingInput.exposureCapInputs) as (keyof typeof baseline.sizingInput.exposureCapInputs)[]) {
    const input = { ...baseline, sizingInput: rebuildSizing(baseline.sizingInput, {
      exposureCapInputs: { ...baseline.sizingInput.exposureCapInputs, [key]: 17 } }) };
    assert.equal(calculateCandidateBoundedNotional(input).initialMaximumNotionalKrw, 17, key);
  }
  const liquidity = { ...baseline, sizingInput: rebuildSizing(baseline.sizingInput, {
    liquidityInput: { ...baseline.sizingInput.liquidityInput, maximumLiquidityNotionalKrw: 0 } }) };
  assert.deepEqual(calculateCandidateBoundedNotional(liquidity).reasonCodes, ["zero_notional"]);
  assert.equal(calculateCandidateBoundedNotional(fixture({ minimum: 25, score: 0 })).initialMaximumNotionalKrw, 25);
  assert.equal(calculateCandidateBoundedNotional(fixture({ minimum: 26, score: 0 })).initialMaximumNotionalKrw, 0);
  assert.equal(calculateCandidateBoundedNotional(fixture({ gap: 1, slots: 2 })).baseNotionalKrw, 0);
  const largeMultiplier = calculateCandidateBoundedNotional(fixture({ multipliers: [3, 3], slots: 1 }));
  assert.equal(largeMultiplier.initialMaximumNotionalKrw, 101);
  const { requestId: _id, requestHash: _hash, ...requestPayload } = baseline.request;
  const request = createBucketSelectionRequest({ ...requestPayload, maximumAdditionalExposureKrw: 12 });
  assert.equal(calculateCandidateBoundedNotional({ ...baseline, request,
    sizingInput: rebuildSizing(baseline.sizingInput, { requestId: request.requestId }) }).initialMaximumNotionalKrw, 12);
});

test("bounded notional keeps subnormal and overflowing intermediate arithmetic exact without upward cap rounding", () => {
  assert.equal(calculateCandidateBoundedNotional(fixture({ gap: 100, slots: 1, multipliers: [0.29, 0.29] })).initialMaximumNotionalKrw, 29);
  assert.equal(calculateCandidateBoundedNotional(fixture({ gap: Number.MAX_SAFE_INTEGER, slots: 1,
    multipliers: [Number.MIN_VALUE, Number.MIN_VALUE] })).initialMaximumNotionalKrw, 0);
  const maximum = calculateCandidateBoundedNotional(fixture({ gap: Number.MAX_SAFE_INTEGER, slots: 1,
    multipliers: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], cap: Number.MAX_SAFE_INTEGER }));
  assert.equal(maximum.uncappedNotionalKrw, (BigInt(Number.MAX_SAFE_INTEGER) ** 2n).toString());
  assert.equal(maximum.initialMaximumNotionalKrw, Number.MAX_SAFE_INTEGER);
});

test("notional policy parameters change complete selection identity while model-less policy bytes stay unchanged", () => {
  const legacy = policyFixture().records.selectionPolicies.find((item) => item.bucket === "swing")!;
  const { selectionPolicyRecordId: _id, hash: _hash, lineageHash: _lineage, ...payload } = legacy;
  assert.deepEqual(createBucketSelectionPolicyRecord(payload), legacy);
  assert.equal("notionalSizingPolicy" in legacy, false);
  const selected = createBucketSelectionPolicyRecord({ ...payload, notionalSizingPolicy: model });
  assert.notEqual(selected.hash, legacy.hash); assert.notEqual(selected.lineageHash, legacy.lineageHash);
  assert.deepEqual(parseBucketSelectionPolicyRecord(selected), selected);
  assert.throws(() => parseBucketSelectionPolicyRecord({ ...selected, notionalSizingPolicy: { ...model, minimumOrderNotionalKrw: 2 } }));
  for (const patch of [{ minimumScoreMultiplier: -0 }, { maximumScoreMultiplier: 0 }, { minimumScoreMultiplier: 2 },
    { maximumScoreMultiplier: Number.MAX_SAFE_INTEGER + 1 }, { minimumOrderNotionalKrw: 0 }, { minimumOrderNotionalKrw: 0.5 },
    { modelVersion: " padded" }, { modelVersion: "bad\ud800" }, { extra: true }]) {
    assert.throws(() => createBucketSelectionPolicyRecord({ ...payload, notionalSizingPolicy: { ...model, ...patch } }));
  }
});

test("bounded notional refuses legacy unsupported models nonnormalized score SELL and foreign scope", () => {
  assert.throws(() => calculateCandidateBoundedNotional(fixture({ legacy: true })), /policy-selected/);
  assert.throws(() => calculateCandidateBoundedNotional(fixture({ version: "unknown.v1" })), /policy-selected/);
  const input = fixture();
  for (const patch of [{ selectionScore: -0.1 }, { selectionScore: 1.1 }, { sizingAlgorithmVersion: "other" }, { scoringModelVersion: "other" },
    { policyHash: HASH }, { portfolioId: "foreign" }, { asOf: "2026-09-05T00:00:00.000Z", createdAt: "2026-09-05T00:00:00.000Z" },
    { executionCostInput: { ...input.sizingInput.executionCostInput, side: "SELL" } }]) {
    assert.throws(() => calculateCandidateBoundedNotional({ ...input, sizingInput: rebuildSizing(input.sizingInput, patch) }));
  }
  assert.throws(() => calculateCandidateBoundedNotional({ ...input, selectionPolicy: fixture({ minimum: 2 }).selectionPolicy }), /scope/);
  assert.throws(() => calculateCandidateBoundedNotional({ ...input, extra: true }));
});

test("bounded notional parser replays every derived field even after attacker recomputes the calculation hash", () => {
  const result = calculateCandidateBoundedNotional(fixture());
  for (const patch of [{ baseNotionalKrw: 51 }, { initialMaximumNotionalKrw: 51 }, { cappedNotionalKrw: 51 },
    { uncappedNotionalKrw: "51" }, { reasonCodes: ["eligible"] }, { finalSizing: "performed" }, { caps: { ...result.caps, cashAvailableKrw: 1 } },
    { scoreMultiplier: { ...result.scoreMultiplier, numerator: "1" } }]) {
    const { calculationHash: _hash, ...payload } = { ...result, ...patch };
    assert.throws(() => parseCandidateBoundedNotional({ ...payload, calculationHash: hashCanonicalPayload(payload) }), /complete replay/);
  }
});

function fixture(options: { score?: number; gap?: number; slots?: number; multipliers?: number[]; minimum?: number; cap?: number; legacy?: boolean; version?: string } = {}) {
  const original = policyFixture(), base = original.records.selectionPolicies.find((item) => item.bucket === "swing")!;
  const { selectionPolicyRecordId: _selectionId, hash: _selectionHash, lineageHash: _selectionLineage, ...selectionPayload } = base;
  const selectionPolicy = createBucketSelectionPolicyRecord({ ...selectionPayload, ...(options.legacy ? {} : { notionalSizingPolicy: {
    ...model, modelVersion: options.version ?? model.modelVersion, minimumScoreMultiplier: options.multipliers?.[0] ?? model.minimumScoreMultiplier,
    maximumScoreMultiplier: options.multipliers?.[1] ?? model.maximumScoreMultiplier, minimumOrderNotionalKrw: options.minimum ?? 1 } }) });
  const { runtimePolicyRecordId: _id, policyHash: _hash, lineageHash: _lineage, createdAt, ...raw } = original.policy;
  const payload = { ...raw, strategyBuckets: raw.strategyBuckets.map((bucket) => bucket.bucket === "swing" ? { ...bucket, selectionPolicyRef: selectionPolicyRefFor(selectionPolicy) } : bucket) };
  const policyHash = hashCanonicalPayload(payload), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  const request = createBucketSelectionRequest({ cycleId: "cycle", triggerIdentity: "scheduled:boundary", triggerRef: "slot", portfolioId: policy.portfolioId,
    portfolioSnapshotId: "snapshot", portfolioSnapshotHash: HASH, policyHash, asOf: AT, bucket: "swing", gapBasis: "entry_floor",
    gapKrw: options.gap ?? 101, availableSlots: options.slots ?? 2, maximumAdditionalExposureKrw: options.gap ?? 101, evidenceCutoffAt: AT, createdAt: AT });
  const cap = options.cap ?? 1000;
  const sizingInput = createCandidateSizingInputRecord({ requestId: request.requestId, portfolioId: policy.portfolioId, portfolioSnapshotId: "snapshot",
    portfolioSnapshotHash: HASH, policyHash, asOf: AT, market: "KR", symbol: "SYNTH", bucket: "swing", scoringModelVersion: selectionPolicy.scoringModelVersion,
    sizingAlgorithmVersion: options.version ?? model.modelVersion, selectionScore: options.score ?? 0.5,
    exposureKeys: { sector: "Synthetic", country: "KR", currency: "KRW", classificationEvidenceRef: "synthetic" },
    featureInputs: [{ featureDefinitionRef: "synthetic", value: 1, evidenceRefs: ["synthetic"] }],
    exposureCapInputs: { bucketRemainingKrw: cap, symbolRemainingKrw: cap, sectorRemainingKrw: cap, countryRemainingKrw: cap, currencyRemainingKrw: cap, cashAvailableKrw: cap },
    liquidityInput: { averageDailyNotionalKrw: cap, maximumParticipationRatio: 1, maximumLiquidityNotionalKrw: cap, evidenceRefs: ["synthetic"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 100, participationRate: 0, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 0, taxBps: 0, halfSpreadBps: 0, slippageBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 1, minLiquidityFillRatio: 1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0, evidenceRefs: ["synthetic"] }, createdAt: AT });
  return { policy, selectionPolicy, request, sizingInput };
}
function rebuildSizing(record: ReturnType<typeof createCandidateSizingInputRecord>, patch: Record<string, unknown>) {
  const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = record;
  return createCandidateSizingInputRecord({ ...payload, ...patch } as Parameters<typeof createCandidateSizingInputRecord>[0]);
}
