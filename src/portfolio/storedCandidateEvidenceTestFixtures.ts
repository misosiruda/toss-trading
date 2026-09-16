import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStoragePaths, FileHistoricalMarketSnapshotStore, FileMarketPacketStore } from "../storage/repositories.js";
import type { MarketPacket } from "../domain/schemas.js";
import { createBucketSelectionRequest } from "./bucketSelectionRequest.js";
import { BucketSelectionRequestFileRepository } from "./bucketSelectionRequestFiles.js";
import { candidateScoringModelRefFor, calculateCandidateSelectionScore, CANDIDATE_SCORING_ALGORITHM, createCandidateScoringModel } from "./candidateScoringModel.js";
import { createCandidateSizingInputRecord } from "./candidateSizingInput.js";
import { CandidateSizingInputFileRepository } from "./candidateSizingInputFiles.js";
import { MARKET_TECHNICAL_FEATURE_DEFINITIONS } from "./marketTechnicalCandidateFeatures.js";
import { MarketTechnicalEvidenceFileRepository } from "./marketTechnicalEvidenceFiles.js";
import { policyFixture, storePolicyFixture, type ExecutionFixtureOptions } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createBucketSelectionPolicyRecord, createScheduleBoundaryRecord, createSessionCalendarRecord, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage, scheduleBoundaryRefFor, selectionPolicyRefFor } from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent } from "./runtimePortfolioPolicyActivation.js";
import type { CandidateHardGateRule } from "./candidateHardGateRules.js";
import { calculateCandidateExecutionCost, CANDIDATE_EXECUTION_COST_MODEL_VERSION } from "./candidateExecutionCost.js";
import { CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION } from "./candidateDailyLiquidity.js";
import { CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION } from "./candidateDailyCostBasis.js";
import { pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION, deriveCandidatePacketClassification } from "./candidatePacketClassification.js";
import { classificationPacket } from "./candidatePacketClassificationTestFixtures.js";
import { CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION } from "./candidatePositionExposureBounds.js";
import { calculateCandidateBoundedNotional } from "./candidateBoundedNotional.js";
import { CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION, type CandidateNotionalSizingPolicy } from "./candidateNotionalSizingPolicy.js";
import { calculateCandidateInitialExecutionCost } from "./candidateInitialExecutionCost.js";

export const AT = "2026-09-04T00:00:00.000Z";

export const CREATED = "2026-09-01T00:00:00.000Z";

export type Payload = Parameters<typeof createCandidateSizingInputRecord>[0];

export type Options = { patch?: (input: Payload) => Payload; market?: "KR" | "US"; symbol?: string; portfolioId?: string;
  execution?: ExecutionFixtureOptions;
  costEstimationModelVersion?: string | null;
  liquidityEstimationModelVersion?: string; interval?: "1d" | "1h";
  costBasisModelVersion?: string;
  cashKrw?: number; pendingActions?: PendingPortfolioActionInput[]; krHeldNotionalKrw?: number; heldBucket?: "swing" | "long_term";
  classificationModelVersion?: string; classificationPacket?: MarketPacket; enableUsMarket?: boolean;
  exposureLimitPolicy?: { modelVersion: string; maximumSectorExposureRatio: number };
  notionalSizingPolicy?: CandidateNotionalSizingPolicy;
  policyHash?: string; legacy?: boolean; extraModelFeature?: boolean; upperBound?: number;
  requiredEvidence?: Parameters<typeof createBucketSelectionPolicyRecord>[0]["requiredEvidence"];
  hardGateRules?: CandidateHardGateRule[];
  evidenceCutoffAt?: string; sourceCreatedAt?: string };


export function repriceDeclaredCash(pricing: ReturnType<typeof calculateCandidateInitialExecutionCost>, cash: number) {
  const { sizingInputRecordId: _id, sizingInputHash: _hash, ...payload } = pricing.input.boundedNotional.input.sizingInput;
  const sizingInput = createCandidateSizingInputRecord({ ...payload, exposureCapInputs: { ...payload.exposureCapInputs, cashAvailableKrw: cash } });
  const boundedNotional = calculateCandidateBoundedNotional({ ...pricing.input.boundedNotional.input, sizingInput });
  return calculateCandidateInitialExecutionCost({ ...pricing.input, boundedNotional });
}


export function initialCostOptions(minimumOrderNotionalKrw = 10): Options {
  const options = exposureBoundsOptions(), original = options.patch!;
  return { ...options, notionalSizingPolicy: { modelVersion: CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION,
    minimumScoreMultiplier: 0.5, maximumScoreMultiplier: 1.5, minimumOrderNotionalKrw },
    patch: (input) => ({ ...original(input), sizingAlgorithmVersion: CANDIDATE_BOUNDED_NOTIONAL_MODEL_VERSION }) };
}


export function exposureBoundsOptions(packet = classificationPacket(), cashAvailableKrw = 850): Options {
  const options = classificationOptions(packet), original = options.patch!;
  return { ...options, exposureLimitPolicy: { modelVersion: CANDIDATE_POSITION_EXPOSURE_BOUNDS_MODEL_VERSION, maximumSectorExposureRatio: 0.3 },
    patch: (input) => ({ ...original(input), exposureCapInputs: { bucketRemainingKrw: 100, symbolRemainingKrw: 100,
      sectorRemainingKrw: 100, countryRemainingKrw: 100, currencyRemainingKrw: 100, cashAvailableKrw } }) };
}


export function classificationOptions(packet = classificationPacket()): Options {
  const source = structuredClone(packet); source.virtualPortfolio.portfolioId = policyFixture().policy.portfolioId;
  const cash = cashOptions(850), market = source.candidates[0]!.market;
  const execution = { schemaVersion: "portfolio_execution_rule.v1", markets: { [market]: executionParameters().markets.KR } };
  return { ...cash, market, symbol: source.candidates[0]!.symbol, enableUsMarket: market === "US", execution: { bucket: execution, legacy: execution },
    classificationModelVersion: CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION, classificationPacket: source,
    patch: (input) => ({ ...cash.patch!(input), exposureKeys: deriveCandidatePacketClassification({
      modelVersion: CANDIDATE_PACKET_CLASSIFICATION_MODEL_VERSION, packet: source, market, symbol: input.symbol }).exposureKeys }) };
}


export function cashOptions(cashAvailableKrw: number, costPatch: Partial<Payload["executionCostInput"]> = {}): Options {
  return { execution: executionOptions(), liquidityEstimationModelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION,
    costBasisModelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
    patch: (input) => ({ ...dailyCostBasisCandidate(input, costPatch), exposureCapInputs: { ...input.exposureCapInputs, cashAvailableKrw } }) };
}


export function dailyCostBasisCandidate(input: Payload, patch: Partial<Payload["executionCostInput"]> = {}): Payload {
  return costCandidate(liquidityCandidate(input), { referenceNotionalKrw: 200, participationRate: 0.1,
    evidenceRefs: [...input.featureInputs[0]!.evidenceRefs], ...patch });
}


export function liquidityCandidate(input: Payload): Payload {
  return costCandidate({ ...input, liquidityInput: { averageDailyNotionalKrw: 2000, maximumParticipationRatio: 0.1,
    maximumLiquidityNotionalKrw: 200, evidenceRefs: [...input.featureInputs[0]!.evidenceRefs] } });
}


export function executionParameters(patch: { feeBps?: number; maxVolumeParticipationRate?: number } = {}) {
  return { schemaVersion: "portfolio_execution_rule.v1", markets: { KR: { executionPolicy: {
    modelVersion: "execution_simulator.v4", fillPriceRule: "current_candidate_last_price", feeBps: 1, taxBps: 2,
    halfSpreadBps: 3, slippageBps: 4, fillRatio: 1, allowFractionalShares: true, maxVolumeParticipationRate: 0.1,
    minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 5, ...patch },
    maximumPriceAgeSeconds: 60, allowedPriceSourceContractIds: ["synthetic-price"] } } };
}

export function executionOptions(): ExecutionFixtureOptions { return { bucket: executionParameters(), legacy: executionParameters() }; }

export function costCandidate(input: Payload, patch: Partial<Payload["executionCostInput"]> = {}): Payload {
  const { estimatedCostKrw: ignored, ...parameters } = { ...input.executionCostInput, modelVersion: CANDIDATE_EXECUTION_COST_MODEL_VERSION, ...patch }; void ignored;
  return { ...input, executionCostInput: { ...parameters, estimatedCostKrw: calculateCandidateExecutionCost(parameters).estimatedCostKrw } };
}


export function model(version = "synthetic-score.v1", upperBound = 10000, extra = false) {
  return createCandidateScoringModel({ algorithm: CANDIDATE_SCORING_ALGORITHM, version, createdAt: CREATED,
    terms: [...Object.values(MARKET_TECHNICAL_FEATURE_DEFINITIONS), ...(extra ? ["extra.v1"] : [])].map((featureDefinitionRef) =>
      ({ featureDefinitionRef, weight: 1, lowerBound: 0, upperBound, direction: "higher_is_better" })) });
}

export async function seed(baseDir: string, options: Options = {}) {
  const original = policyFixture("v1", options.execution), scoringModel = model("synthetic-score.v1", options.upperBound, options.extraModelFeature);
  const selection = createBucketSelectionPolicyRecord({ bucket: "swing", version: "scored.v1", createdAt: CREATED,
    requiredEvidence: options.requiredEvidence ?? [{ evidenceClass: "market_technical", sourceContractId: "synthetic-local.v1", maximumAgeSeconds: 86400 }],
    hardGateRuleIds: options.hardGateRules?.map((rule) => rule.ruleId) ?? ["not-yet-evaluated"],
    ...(options.hardGateRules === undefined ? {} : { hardGateRules: options.hardGateRules }), scoringModelVersion: scoringModel.version,
    ...(options.legacy ? {} : { scoringModelRef: candidateScoringModelRefFor(scoringModel) }),
    ...(options.costEstimationModelVersion === null ? {} : {
      costEstimationModelVersion: options.costEstimationModelVersion ?? CANDIDATE_EXECUTION_COST_MODEL_VERSION }),
    ...(options.liquidityEstimationModelVersion === undefined ? {} : { liquidityEstimationModelVersion: options.liquidityEstimationModelVersion }),
    ...(options.costBasisModelVersion === undefined ? {} : { costBasisModelVersion: options.costBasisModelVersion }),
    ...(options.classificationModelVersion === undefined ? {} : { classificationModelVersion: options.classificationModelVersion }),
    ...(options.exposureLimitPolicy === undefined ? {} : { exposureLimitPolicy: options.exposureLimitPolicy }),
    ...(options.notionalSizingPolicy === undefined ? {} : { notionalSizingPolicy: options.notionalSizingPolicy }),
    featureDefinitionRefs: scoringModel.terms.map((term) => term.featureDefinitionRef) });
  const usCalendar = options.enableUsMarket ? createSessionCalendarRecord({ market: "US", version: "synthetic.v1", timeZone: "America/New_York",
    validFromExchangeDate: "2026-09-01", validThroughExchangeDate: "2026-09-01",
    sessions: [{ exchangeDate: "2026-09-01", sessionKind: "regular", opensAt: "2026-09-01T09:30:00-04:00",
      closesAt: "2026-09-01T16:00:00-04:00", sourceEvidenceRefs: ["synthetic-calendar"] }], createdAt: CREATED }) : undefined;
  const usBoundary = usCalendar ? createScheduleBoundaryRecord({ market: "US", version: "synthetic.v1", timeZone: "America/New_York",
    sessionCalendarRecordId: usCalendar.sessionCalendarRecordId, sessionCalendarVersion: usCalendar.version,
    sessionCalendarHash: usCalendar.hash, sessionCalendarLineageHash: usCalendar.lineageHash,
    interval: "daily", anchorLocalTime: "16:00:00", nonSessionDayRule: "previous_session", createdAt: CREATED }) : undefined;
  const records = { ...original.records, scoringModels: [scoringModel],
    ...(usCalendar && usBoundary ? { sessionCalendars: [...original.records.sessionCalendars, usCalendar],
      scheduleBoundaries: [...original.records.scheduleBoundaries, usBoundary] } : {}),
    selectionPolicies: original.records.selectionPolicies.map((item) => item.bucket === "swing" ? selection : item) };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const { policyHash: ignoredHash, lineageHash: ignoredLineage, runtimePolicyRecordId: ignoredId, createdAt, ...payload } = original.policy;
  void ignoredHash; void ignoredLineage; void ignoredId;
  const updated = { ...payload, strategyBuckets: payload.strategyBuckets.map((bucket) => bucket.bucket === "swing"
    ? { ...bucket, selectionPolicyRef: selectionPolicyRefFor(selection),
      ...(usBoundary ? { enabledMarkets: ["US"], reviewCadence: { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(usBoundary)] } } : {}) } : bucket) };
  const policyHash = hashCanonicalPayload(updated), runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...updated, policyHash, runtimePolicyRecordId, createdAt,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt }) });
  const activation = createPortfolioPolicyActivatedEvent({ policy, activationSequence: 1, createdAt: CREATED });
  await storePolicyFixture(baseDir, { ...original, records, dependencies, policy, activation });
  if (options.classificationPacket) await new FileMarketPacketStore(createStoragePaths(baseDir).marketPacketsPath).append(options.classificationPacket);
  const market = options.market ?? "KR", symbol = options.symbol ?? "SYNTH", portfolioId = options.portfolioId ?? policy.portfolioId;
  await new FileHistoricalMarketSnapshotStore(join(baseDir, "historical-market-snapshots.jsonl")).replaceAll([1, 3].map((day) => ({
    snapshotId: `synthetic-${day}`, market, symbol, interval: options.interval ?? "1d", observedAt: `2026-09-0${day}T00:00:00.000Z`,
    createdAt: options.sourceCreatedAt ?? AT, lastPriceKrw: 100 * day, volume: 10, sourceRefs: ["synthetic"] })));
  const evidence = await new MarketTechnicalEvidenceFileRepository(baseDir).capture({ sourceContractId: "synthetic-local.v1",
    query: { market, symbol, interval: options.interval ?? "1d", windowStart: CREATED, asOf: AT, minimumObservationCount: 2, maximumAgeSeconds: 86400 } });
  const score = calculateCandidateSelectionScore({ model: model(), features: evidence.binding.evidence.calculation.featureInputs });
  const cashKrw = options.cashKrw ?? 1000, pendingActionInputs = options.pendingActions ?? [];
  const held = options.krHeldNotionalKrw ?? 0, heldBucket = options.heldBucket ?? "swing";
  const snapshot = createPortfolioSizingSnapshot({ portfolioId, portfolioVersion: "v1", policyHash: options.policyHash ?? policyHash, asOf: AT,
    virtualPortfolio: { portfolioId, cashKrw, positions: held === 0 ? [] : [{ market: "KR", symbol: "HELD", quantity: 1,
      averagePriceKrw: held, strategyBucket: heldBucket, sector: "Synthetic", region: "KR", updatedAt: AT }], updatedAt: AT },
    valuationInputs: held === 0 ? [] : [{ kind: "mark_price", market: "KR", symbol: "HELD", priceKrw: held,
      evidenceRef: "synthetic-price", evidenceAsOf: AT }], pendingActionInputs,
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw + held, cashKrw,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0, [heldBucket]: held },
      symbolExposureKrw: held === 0 ? [] : [{ market: "KR", symbol: "HELD", exposureKrw: held }],
      marketExposureKrw: { KR: held, US: 0 }, sectorExposureKrw: held === 0 ? {} : { Synthetic: held },
      countryExposureKrw: held === 0 ? {} : { KR: held }, currencyExposureKrw: held === 0 ? {} : { KRW: held },
      ...pendingActionExposureTotals(pendingActionInputs) }) });
  const request = createBucketSelectionRequest({ cycleId: "synthetic-cycle", triggerIdentity: "scheduled:boundary", triggerRef: "slot",
    portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId, portfolioSnapshotHash: snapshot.portfolioSnapshotHash,
    policyHash: snapshot.policyHash, asOf: AT, bucket: "swing", gapBasis: "entry_floor", gapKrw: 1000, availableSlots: 2,
    maximumAdditionalExposureKrw: 1000, evidenceCutoffAt: options.evidenceCutoffAt ?? AT, createdAt: AT });
  await new BucketSelectionRequestFileRepository(baseDir).append(request);
  await new PortfolioSizingSnapshotFileRepository(baseDir).append(snapshot);
  while (Date.now() <= Date.parse(evidence.completion!.observedAt)) await new Promise((done) => setTimeout(done, 1));
  const candidate: Payload = { requestId: request.requestId, portfolioId, portfolioSnapshotId: snapshot.portfolioSnapshotId,
    portfolioSnapshotHash: snapshot.portfolioSnapshotHash, policyHash: snapshot.policyHash, asOf: AT, market, symbol, bucket: "swing",
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
  return { record, evidence, score, policy, selection, dependencies, activation, snapshot };
}

export function frozen(value: unknown) { if (value !== null && typeof value === "object") { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }

export async function temporary(run: (baseDir: string) => Promise<void>) {
  const baseDir = await realpath(await mkdtemp(join(tmpdir(), "toss-stored-score-")));
  try { await run(baseDir); } finally { await rm(baseDir, { recursive: true, force: true }); }
}
