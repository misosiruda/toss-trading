import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { candidateScoringModelRefFor, calculateCandidateSelectionScore, CANDIDATE_SCORING_ALGORITHM, createCandidateScoringModel } from "./candidateScoringModel.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";
import { createMarketTechnicalEvidencePaths, MarketTechnicalEvidenceFileRepository } from "./marketTechnicalEvidenceFiles.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createBucketSelectionPolicyRecord, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage, selectionPolicyRefFor } from "./runtimePolicyContracts.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent } from "./runtimePortfolioPolicyActivation.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository } from "./runtimePortfolioPolicyActivationFiles.js";
import { createRuntimePortfolioPolicyPaths } from "./runtimePortfolioPolicyFiles.js";
import { resolveStoredCandidateSelectionScore } from "./storedCandidateSelectionScore.js";

const AT = "2026-09-04T00:00:00.000Z";
const CREATED = "2026-09-01T00:00:00.000Z";
type Payload = Parameters<typeof createCandidateSizingInputRecord>[0];
type Options = { patch?: (input: Payload) => Payload; market?: "KR" | "US"; portfolioId?: string;
  policyHash?: string; legacy?: boolean; extraModelFeature?: boolean; upperBound?: number };

test("stored candidate score replays actual policy model and committed features without granting eligibility", async () => temporary(async (baseDir) => {
  const fixture = await seed(baseDir);
  const paths = (await readdir(baseDir)).filter((name) => name.endsWith(".jsonl")).map((name) => join(baseDir, name));
  const before = await Promise.all(paths.map((path) => readFile(path)));
  const result = await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId });
  assert.equal(result.verificationScope, "stored_score_replay_only");
  assert.deepEqual(result.score, fixture.score);
  assert.deepEqual(result.activePolicy.policy, fixture.policy);
  assert.deepEqual(result.selectionPolicy, fixture.selection);
  assert.deepEqual(result.sizingInputOrigin.record, fixture.record);
  assert.deepEqual(result.evidenceOrigin, fixture.evidence);
  assert.equal("eligibility" in result, false); assert.equal("sizingRange" in result, false); assert.equal("approved" in result, false);
  frozen(result);
  assert.deepEqual(await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: fixture.record.sizingInputRecordId }), result);
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
  assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
}));

test("stored candidate score rejects a rehashed committed score with any numeric mismatch", async () => {
  for (const selectionScore of [-1, 999, 0, 0.75]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { patch: (input) => ({ ...input, selectionScore }) });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
    assert.equal((await readdir(baseDir)).some((name) => name.endsWith(".lock")), false);
  });
});

test("stored candidate score rejects an unselected model even when that model exists and reproduces the claimed score", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, scoringModelVersion: "alternate.v1" }) });
  await appendFile(createImmutablePolicyDependencyPaths(baseDir).scoringModels, `${JSON.stringify(model("alternate.v1"))}\n`);
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /policy-selected model version/);
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId, model: model() } as never));
}));

test("stored candidate score cannot consume forged extra features or a model requiring unverified features", async () => {
  for (const options of [
    { patch: (input: Payload): Payload => ({ ...input, featureInputs: [...input.featureInputs, { featureDefinitionRef: "extra.v1", value: 1, evidenceRefs: ["unverified"] }] }) },
    { extraModelFeature: true }
  ]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, options);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /exact verified market feature set|exact model feature set/);
  });
});

test("stored candidate score rejects changed real feature values despite valid candidate hashes", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { patch: (input) => ({ ...input, featureInputs: input.featureInputs.map((feature, index) =>
    index === 0 ? { ...feature, value: Number(feature.value) + 1 } : feature) }) });
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /value or evidence reference mismatch/);
}));

test("stored candidate score uses the exact policy parameters instead of a matching version label", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir, { upperBound: 20000 }); // Candidate still declares the score computed with 10000.
  await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /independent calculation/);
}));

test("stored candidate score fails closed for legacy policies missing models and unavailable candidate IDs", async () => {
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { legacy: true });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /lacks an exact/);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: "missing" }), /stored candidate sizing input is missing/);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: " " }));
    await writeFile(createImmutablePolicyDependencyPaths(baseDir).scoringModels, "");
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /ref does not resolve/);
  });
});

test("stored candidate score resolves policy at candidate asOf rather than using latest or a declared hash", async () => {
  for (const retiredAt of ["2026-09-03T00:00:00.000Z", "2026-09-05T00:00:00.000Z"]) await temporary(async (baseDir) => {
    const { record, policy, dependencies, activation } = await seed(baseDir);
    await new RuntimePortfolioPolicyActivationFileRepository(baseDir, [policy], dependencies).appendRetired({
      portfolioId: policy.portfolioId, retiredActivationId: activation.activationId, reasonCode: "synthetic_retirement", createdAt: retiredAt });
    const result = resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
    if (retiredAt < AT) await assert.rejects(result, /active runtime portfolio policy is required/);
    else assert.deepEqual((await result).activePolicy.activation, activation);
  });
  await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, { policyHash: `sha256:${"f".repeat(64)}` });
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /active policy hash mismatch/);
  });
});

test("stored candidate score rejects another portfolio and a market disabled by the active bucket", async () => {
  for (const options of [{ portfolioId: "other-portfolio" }, { market: "US" as const }]) await temporary(async (baseDir) => {
    const { record } = await seed(baseDir, options);
    await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId }), /active runtime portfolio policy is required|enabled market mismatch/);
  });
});

test("stored candidate score rejects corruption in every actual source instead of trusting its cached score", async () => temporary(async (baseDir) => {
  const { record } = await seed(baseDir);
  const paths = [...Object.values(createImmutablePolicyDependencyPaths(baseDir)), createRuntimePortfolioPolicyPaths(baseDir).recordsPath,
    createRuntimePortfolioPolicyActivationPaths(baseDir).eventsPath, createBucketSelectionRequestPaths(baseDir).recordsPath,
    createPortfolioSizingSnapshotPaths(baseDir).recordsPath, createCandidateSizingInputPaths(baseDir).recordsPath,
    createMarketTechnicalEvidencePaths(baseDir).recordsPath, join(baseDir, "historical-market-snapshots.jsonl")];
  for (const path of paths) {
    const before = await readFile(path);
    await appendFile(path, "corrupt\n");
    try { await assert.rejects(resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId })); }
    finally { await writeFile(path, before); }
  }
  await resolveStoredCandidateSelectionScore({ baseDir, sizingInputRecordId: record.sizingInputRecordId });
}));

function model(version = "synthetic-score.v1", upperBound = 10000, extra = false) {
  return createCandidateScoringModel({ algorithm: CANDIDATE_SCORING_ALGORITHM, version, createdAt: CREATED,
    terms: [...Object.values(MARKET_TECHNICAL_FEATURE_DEFINITIONS), ...(extra ? ["extra.v1"] : [])].map((featureDefinitionRef) =>
      ({ featureDefinitionRef, weight: 1, lowerBound: 0, upperBound, direction: "higher_is_better" })) });
}
async function seed(baseDir: string, options: Options = {}) {
  const original = policyFixture(), scoringModel = model("synthetic-score.v1", options.upperBound, options.extraModelFeature);
  const selection = createBucketSelectionPolicyRecord({ bucket: "swing", version: "scored.v1", createdAt: CREATED,
    requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400 }],
    hardGateRuleIds: ["not-yet-evaluated"], scoringModelVersion: scoringModel.version,
    ...(options.legacy ? {} : { scoringModelRef: candidateScoringModelRefFor(scoringModel) }),
    featureDefinitionRefs: scoringModel.terms.map((term) => term.featureDefinitionRef) });
  const records = { ...original.records, scoringModels: [scoringModel],
    selectionPolicies: original.records.selectionPolicies.map((item) => item.bucket === "swing" ? selection : item) };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const { policyHash: ignoredHash, lineageHash: ignoredLineage, runtimePolicyRecordId: ignoredId, createdAt, ...payload } = original.policy;
  void ignoredHash; void ignoredLineage; void ignoredId;
  const updated = { ...payload, strategyBuckets: payload.strategyBuckets.map((bucket) => bucket.bucket === "swing"
    ? { ...bucket, selectionPolicyRef: selectionPolicyRefFor(selection) } : bucket) };
  const policyHash = hashCanonicalPayload(updated), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...updated, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  const activation = createPortfolioPolicyActivatedEvent({ policy, activationSequence: 1, createdAt: CREATED });
  await storePolicyFixture(baseDir, { ...original, records, dependencies, policy, activation });
  const market = options.market ?? "KR", portfolioId = options.portfolioId ?? policy.portfolioId;
  await new FileHistoricalMarketSnapshotStore(join(baseDir, "historical-market-snapshots.jsonl")).replaceAll([1, 3].map((day) => ({
    snapshotId: `synthetic-${day}`, market, symbol: "SYNTH", interval: "1d" as const, observedAt: `2026-09-0${day}T00:00:00.000Z`,
    createdAt: AT, lastPriceKrw: 100 * day, volume: 10, sourceRefs: ["synthetic"] })));
  const evidence = await new MarketTechnicalEvidenceFileRepository(baseDir).capture({ sourceContractId: "synthetic-local.v1",
    query: { market, symbol: "SYNTH", interval: "1d", windowStart: CREATED, asOf: AT, minimumObservationCount: 2, maximumAgeSeconds: 86400 } });
  const score = calculateCandidateSelectionScore({ model: model(), features: evidence.binding.evidence.calculation.featureInputs });
  const snapshot = createPortfolioSizingSnapshot({ portfolioId, portfolioVersion: "v1", policyHash: options.policyHash ?? policyHash, asOf: AT,
    virtualPortfolio: { portfolioId, cashKrw: 1000, positions: [], updatedAt: AT }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {}, pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
  const request = createBucketSelectionRequest({ cycleId: "synthetic-cycle", triggerIdentity: "scheduled:boundary", triggerRef: "slot",
    portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash, asOf: AT, bucket: "swing", gapBasis: "entry_floor", gapKrw: 1000, availableSlots: 2,
    maximumAdditionalExposureKrw: 1000, evidenceCutoffAt: AT, createdAt: AT });
  await new BucketSelectionRequestFileRepository(baseDir).append(request);
  await new PortfolioSizingSnapshotFileRepository(baseDir).append(snapshot);
  while (Date.now() <= Date.parse(evidence.completion!.observedAt)) await new Promise((done) => setTimeout(done, 1));
  const candidate: Payload = { requestId: request.requestId, portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash, policyHash: snapshot.policyHash, asOf: AT, market, symbol: "SYNTH", bucket: "swing",
    scoringModelVersion: scoringModel.version, sizingAlgorithmVersion: "unverified-sizing.v1", selectionScore: score.selectionScore,
    exposureKeys: { sector: "Synthetic", country: "KR", currency: "KRW", classificationEvidenceRef: "unverified-classification" },
    featureInputs: evidence.binding.evidence.calculation.featureInputs,
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 900, sectorRemainingKrw: 800, countryRemainingKrw: 700, currencyRemainingKrw: 600, cashAvailableKrw: 500 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["unverified-liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 500, participationRate: 0.01, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2, halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5, evidenceRefs: ["unverified-cost"] },
    createdAt: new Date().toISOString() };
  const record = createCandidateSizingInputRecord(options.patch ? options.patch(candidate) : candidate);
  await new CandidateSizingInputFileRepository(baseDir).append(record);
  return { record, evidence, score, policy, selection, dependencies, activation };
}
function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function temporary(run: (baseDir: string) => Promise<void>) {
  const baseDir = await realpath(await mkdtemp(join(tmpdir(), "toss-stored-score-")));
  try { await run(baseDir); } finally { await rm(baseDir, { recursive: true, force: true }); }
}
