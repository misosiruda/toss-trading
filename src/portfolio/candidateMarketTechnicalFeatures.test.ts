import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileHistoricalMarketSnapshotStore } from "../storage/repositories.js";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository, createBucketSelectionRequestPaths } from "./bucketSelectionRequestFiles.js";
import { CandidateMarketTechnicalFeatureResolver, getCandidateMarketTechnicalFeatureSources,
  type VerifiedCandidateMarketTechnicalFeatures } from "./candidateMarketTechnicalFeatures.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository, createCandidateSizingInputPaths } from "./candidateSizingInputFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths } from "./portfolioSizingSnapshotFiles.js";
import { MarketTechnicalEvidenceFileRepository, createMarketTechnicalEvidencePaths } from "./marketTechnicalEvidenceFiles.js";
import { MarketTechnicalEvidenceFileSource, type MarketTechnicalEvidenceSourceInput } from "./marketTechnicalEvidenceSource.js";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";

const AT = "2026-09-04T00:00:00.000Z";
const HASH = `sha256:${"a".repeat(64)}`;
type Payload = Parameters<typeof createCandidateSizingInputRecord>[0];

test("candidate market technical resolver binds stored input to actual committed evidence without granting eligibility", async () => temporary(async (dir) => {
  const fixture = await seed(dir);
  const resolver = new CandidateMarketTechnicalFeatureResolver(dir);
  await resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async (binding) => {
    assert.deepEqual(binding.sizingInputOrigin, fixture.inputOrigin);
    assert.deepEqual(binding.evidenceOrigin.binding, fixture.binding);
    assert.equal(binding.sizingInputOrigin.record.selectionScore, 999); // Unverified supplied score remains a declaration.
    assert.equal("eligibility" in binding, false); assert.equal("sizingRange" in binding, false);
    const sources = getCandidateMarketTechnicalFeatureSources(binding);
    assert.ok(Date.parse(sources.inputObservedAt) >= Date.parse(binding.sizingInputOrigin.committedAt));
    assert.ok(Date.parse(sources.evidenceObservation.observedAt) >= Date.parse(binding.evidenceOrigin.committedAt));
    frozen(binding); frozen(sources);
  });
}));

test("candidate market technical resolver requires a stored input and committed rather than supplied evidence", async () => temporary(async (dir) => {
  const fixture = await seed(dir, { persistEvidence: false });
  const resolver = new CandidateMarketTechnicalFeatureResolver(dir);
  await assert.rejects(resolver.withResolvedFeatures("missing", async () => {}), /stored candidate sizing input is missing/);
  await assert.rejects(resolver.withResolvedFeatures(" ", async () => {}), /identity is invalid/);
  await assert.rejects(resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async () => {}), /committed market technical evidence is missing/);
}));

test("candidate market technical resolver rejects every changed feature even after the sizing record is rehashed and committed", async () => {
  for (const definition of Object.values(MARKET_TECHNICAL_FEATURE_DEFINITIONS)) await temporary(async (dir) => {
    const fixture = await seed(dir, { patch: (payload) => ({ ...payload, featureInputs: payload.featureInputs.map((feature) =>
      feature.featureDefinitionRef === definition ? { ...feature, value: Number(feature.value) + 1 } : feature) }) });
    await assert.rejects(new CandidateMarketTechnicalFeatureResolver(dir).withResolvedFeatures(fixture.record.sizingInputRecordId, async () => {}), /value or evidence reference mismatch/);
  });
});

test("candidate market technical resolver rejects missing ambiguous and mixed evidence references", async () => {
  const anchor = MARKET_TECHNICAL_FEATURE_DEFINITIONS.windowReturnRatio;
  const mutations: ((payload: Payload) => Payload)[] = [
    (payload) => ({ ...payload, featureInputs: payload.featureInputs.filter((feature) => feature.featureDefinitionRef !== anchor) }),
    (payload) => ({ ...payload, featureInputs: payload.featureInputs.map((feature) => feature.featureDefinitionRef === anchor ? { ...feature, evidenceRefs: ["missing"] } : feature) }),
    (payload) => ({ ...payload, featureInputs: payload.featureInputs.map((feature) => feature.featureDefinitionRef === anchor ? { ...feature, evidenceRefs: [...feature.evidenceRefs, "extra"] } : feature) }),
    (payload) => ({ ...payload, featureInputs: payload.featureInputs.map((feature) => feature.featureDefinitionRef !== anchor ? { ...feature, evidenceRefs: ["other"] } : feature) })
  ];
  for (const patch of mutations) await temporary(async (dir) => {
    const fixture = await seed(dir, { patch });
    await assert.rejects(new CandidateMarketTechnicalFeatureResolver(dir).withResolvedFeatures(fixture.record.sizingInputRecordId, async () => {}), /missing|ambiguous|mismatch/);
  });
});

test("candidate market technical resolver rejects a different market symbol or asOf scope", async () => {
  for (const options of [
    { patch: (payload: Payload): Payload => ({ ...payload, market: "US" }) },
    { patch: (payload: Payload): Payload => ({ ...payload, symbol: "OTHER" }) },
    { inputAsOf: "2026-09-05T00:00:00.000Z" }
  ]) await temporary(async (dir) => {
    const fixture = await seed(dir, options);
    await assert.rejects(new CandidateMarketTechnicalFeatureResolver(dir).withResolvedFeatures(fixture.record.sizingInputRecordId, async () => {}), /scope or chronology mismatch/);
  });
});

test("candidate market technical resolver requires evidence commit availability not just evidence creation time", async (context) => temporary(async (dir) => {
  const now = Date.parse("2026-09-10T00:00:00.000Z");
  context.mock.timers.enable({ apis: ["Date"], now });
  const originalOpen = fs.open;
  let writes = 0;
  const mock = context.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === createMarketTechnicalEvidencePaths(dir).recordsPath && args[1] === "a" && ++writes === 1) {
      const originalSync = handle.sync.bind(handle);
      context.mock.method(handle, "sync", async () => { await originalSync(); context.mock.timers.setTime(now + 1000); });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    const fixture = await seed(dir, { createdAt: new Date(now).toISOString() });
    assert.equal(fixture.record.createdAt, fixture.binding.evidence.createdAt);
    await assert.rejects(new CandidateMarketTechnicalFeatureResolver(dir).withResolvedFeatures(fixture.record.sizingInputRecordId, async () => {}), /predates committed market technical evidence/);
  } finally { context.mock.timers.reset(); mock.mock.restore(); syncBuiltinESMExports(); }
}));

test("candidate market technical binding has callback-only identity and expires after success or failure", async () => temporary(async (dir) => {
  const fixture = await seed(dir), resolver = new CandidateMarketTechnicalFeatureResolver(dir);
  let retained!: VerifiedCandidateMarketTechnicalFeatures;
  await resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async (binding) => {
    retained = binding;
    assert.throws(() => getCandidateMarketTechnicalFeatureSources(structuredClone(binding)), /live source lease/);
    assert.throws(() => getCandidateMarketTechnicalFeatureSources({ ...binding }), /live source lease/);
  });
  assert.throws(() => getCandidateMarketTechnicalFeatureSources(retained), /live source lease/);
  await assert.rejects(resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async (binding) => {
    retained = binding; throw new Error("consumer failed");
  }), /consumer failed/);
  assert.throws(() => getCandidateMarketTechnicalFeatureSources(retained), /live source lease/);
  for (const path of [createCandidateSizingInputPaths(dir).lockPath, createMarketTechnicalEvidencePaths(dir).lockPath]) {
    await assert.rejects(fs.readFile(path), { code: "ENOENT" });
  }
}));

test("candidate market technical resolver keeps all source locks held through consumption and supports concurrent readers", async () => temporary(async (dir) => {
  const fixture = await seed(dir);
  const resolver = new CandidateMarketTechnicalFeatureResolver(dir);
  const options = { lockTimeoutMs: 30, lockRetryDelayMs: 5 };
  await resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async (binding) => {
    await assert.rejects(new CandidateSizingInputFileRepository(dir, options).append(fixture.record), /lock/i);
    await assert.rejects(new MarketTechnicalEvidenceFileRepository(dir, options).capture(query()), /lock/i);
    for (const path of [createCandidateSizingInputPaths(dir).lockPath, createMarketTechnicalEvidencePaths(dir).lockPath]) {
      assert.ok((await fs.readFile(path, "utf8")).trim());
    }
    assert.ok(getCandidateMarketTechnicalFeatureSources(binding));
  });
  const results = await Promise.all(Array.from({ length: 4 }, () => resolver.withResolvedFeatures(fixture.record.sizingInputRecordId,
    async (binding) => binding.evidenceOrigin.commitHash)));
  assert.equal(new Set(results).size, 1);
}));

test("candidate market technical resolver fails before consumer on corruption anywhere in the actual source chain", async () => temporary(async (dir) => {
  const fixture = await seed(dir), resolver = new CandidateMarketTechnicalFeatureResolver(dir);
  const paths = [join(dir, "historical-market-snapshots.jsonl"), createMarketTechnicalEvidencePaths(dir).recordsPath,
    createCandidateSizingInputPaths(dir).recordsPath, createBucketSelectionRequestPaths(dir).recordsPath,
    createPortfolioSizingSnapshotPaths(dir).recordsPath];
  for (const path of paths) {
    const raw = await fs.readFile(path);
    await fs.appendFile(path, "corrupt\n");
    let invoked = false;
    try {
      await assert.rejects(resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async () => { invoked = true; }));
      assert.equal(invoked, false);
    } finally { await fs.writeFile(path, raw); }
  }
  await resolver.withResolvedFeatures(fixture.record.sizingInputRecordId, async (binding) => assert.ok(getCandidateMarketTechnicalFeatureSources(binding)));
}));

async function seed(dir: string, options: { persistEvidence?: boolean; patch?: (payload: Payload) => Payload; inputAsOf?: string; createdAt?: string } = {}) {
  const sourcePath = join(dir, "historical-market-snapshots.jsonl");
  await new FileHistoricalMarketSnapshotStore(sourcePath).replaceAll([1, 3].map((day) => ({ snapshotId: `row-${day}`, market: "KR" as const, symbol: "SYNTH", interval: "1d" as const,
    observedAt: `2026-09-0${day}T00:00:00.000Z`, createdAt: "2026-09-05T00:00:00.000Z", lastPriceKrw: 100 * day, volume: 10, sourceRefs: ["synthetic"] })));
  const binding = options.persistEvidence === false
    ? await new MarketTechnicalEvidenceFileSource(sourcePath).withEvidence(query(), async (value) => value)
    : (await new MarketTechnicalEvidenceFileRepository(dir).capture(query())).binding;
  const asOf = options.inputAsOf ?? AT;
  const snapshot = createPortfolioSizingSnapshot({ portfolioId: "paper-portfolio", portfolioVersion: "v1", policyHash: HASH, asOf,
    virtualPortfolio: { portfolioId: "paper-portfolio", cashKrw: 1000, positions: [], updatedAt: asOf }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {}, pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
  const request = createBucketSelectionRequest({ cycleId: "synthetic-cycle", triggerIdentity: "scheduled:boundary", triggerRef: "slot",
    portfolioId: snapshot.portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: HASH, asOf, bucket: "swing", gapBasis: "entry_floor", gapKrw: 1000, availableSlots: 2, maximumAdditionalExposureKrw: 1000, evidenceCutoffAt: asOf, createdAt: asOf });
  await new BucketSelectionRequestFileRepository(dir).append(request);
  await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot);
  const payload: Payload = { requestId: request.requestId, portfolioId: snapshot.portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash, policyHash: HASH, asOf, market: "KR", symbol: "SYNTH", bucket: "swing",
    scoringModelVersion: "unverified-score.v1", sizingAlgorithmVersion: "unverified-sizing.v1", selectionScore: 999,
    exposureKeys: { sector: "Synthetic", country: "KR", currency: "KRW", classificationEvidenceRef: "unverified-classification" },
    featureInputs: binding.evidence.calculation.featureInputs,
    exposureCapInputs: { bucketRemainingKrw: 1000, symbolRemainingKrw: 900, sectorRemainingKrw: 800, countryRemainingKrw: 700, currencyRemainingKrw: 600, cashAvailableKrw: 500 },
    liquidityInput: { averageDailyNotionalKrw: 10000, maximumParticipationRatio: 0.1, maximumLiquidityNotionalKrw: 1000, evidenceRefs: ["unverified-liquidity"] },
    executionCostInput: { modelVersion: "paper_cost_model.v5", side: "BUY", referenceNotionalKrw: 500, participationRate: 0.01, estimatedCostKrw: 0,
      fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2, halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5, evidenceRefs: ["unverified-cost"] },
    createdAt: options.createdAt ?? new Date().toISOString() };
  const record = createCandidateSizingInputRecord(options.patch ? options.patch(payload) : payload);
  const inputOrigin = await new CandidateSizingInputFileRepository(dir).append(record);
  return { record, inputOrigin, binding };
}
function query(): MarketTechnicalEvidenceSourceInput {
  return { sourceContractId: "synthetic-local.v1", query: { market: "KR", symbol: "SYNTH", interval: "1d", windowStart: "2026-09-01T00:00:00.000Z",
    asOf: AT, minimumObservationCount: 2, maximumAgeSeconds: 86400 } };
}
function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }
async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "toss-candidate-market-features-")));
  try { await run(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
