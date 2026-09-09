// Shared integration fixtures only; importing this module never registers tests.
import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StrategyBucket } from "../domain/schemas.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository, createPaperFillExecutionPaths, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { createRebalancePlanExecutionAppliedEvent } from "./rebalancePlanExecutionAppliedEvent.js";
import { BucketTurnoverWindowFileRepository, createBucketTurnoverWindowPaths } from "./bucketTurnoverWindowFiles.js";
import { createBucketTurnoverEvent, replayBucketTurnoverEvents, type BucketTurnoverState } from "./bucketTurnover.js";
import { BUCKET_TURNOVER_STATE_FILE_NAME, BucketTurnoverStateFileRepository, getDurableBucketTurnoverStateObservation, getDurableBucketTurnoverStateSource } from "./bucketTurnoverStateFiles.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { createPortfolioActionRiskDecisionPaths, PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { resolvePortfolioActionRiskDecisionPolicy } from "./portfolioActionRiskDecisionPolicyResolver.js";
import { createPortfolioPolicyExecutionPreview, portfolioExecutionRuleParametersSchema } from "./portfolioPolicyExecutionPreview.js";
import { createPortfolioActionExecutionPreview, parsePortfolioActionExecutionPreview } from "./portfolioActionExecutionPreview.js";
import { createPortfolioPlanExecutionPreview } from "./portfolioPlanExecutionPreview.js";
import { WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION } from "../paper/versionedExecutionModel.js";
import { MarketPacketBuilder } from "../market/packetBuilder.js";
import { createMarketPacketHash } from "../market/packetHash.js";
import { createStoragePaths, FileMarketPacketStore } from "../storage/repositories.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository, createSourcePriceEvidencePaths, getDurableSourcePriceEvidenceObservation } from "./sourcePriceEvidenceFiles.js";
import { pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { PortfolioSizingSnapshotFileRepository, createPortfolioSizingSnapshotPaths, getDurablePortfolioSizingSnapshotObservation } from "./portfolioSizingSnapshotFiles.js";
import { createInvestmentMandateEvent, createInvestmentMandateRecord, type InvestmentMandateRecord } from "./investmentMandate.js";
import { createInvestmentMandatePaths, InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { createRebalancePlanPaths, RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { createRebalancePlanEventPaths, RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import {
  createBucketDrawdownSemanticsRecord, createBucketSelectionPolicyRecord,
  createPortfolioRiskRuleParameterRecord, createPortfolioRiskRuleSetRecord,
  createScheduleBoundaryRecord, createSessionCalendarRecord, scheduleBoundaryRefFor,
  drawdownSemanticsRefFor, hashCanonicalPayload, hashDerivedId, hashImmutableRecordLineage,
  riskRuleParameterRefFor, riskRuleSetRefFor, selectionPolicyRefFor,
  type ImmutablePolicyDependencyRecords
} from "./runtimePolicyContracts.js";
import { ImmutablePolicyDependencyRepository } from "./runtimePolicyDependencyResolver.js";
import { createImmutablePolicyDependencyPaths } from "./runtimePolicyDependencyFiles.js";
import { RuntimePortfolioPolicyFileRepository, createRuntimePortfolioPolicyPaths } from "./runtimePortfolioPolicyFiles.js";
import { createRuntimePortfolioPolicyActivationPaths, RuntimePortfolioPolicyActivationFileRepository, readStoredRuntimePortfolioPolicyActivationSnapshot } from "./runtimePortfolioPolicyActivationFiles.js";
import { parseRuntimePortfolioPolicyRecord } from "./runtimePortfolioPolicy.js";
import { createPortfolioPolicyActivatedEvent } from "./runtimePortfolioPolicyActivation.js";


export const CREATED_AT = "2026-09-01T00:00:00.000Z";

export const DECIDED_AT = "2026-09-03T00:00:00.000Z";

export const HASH = `sha256:${"a".repeat(64)}`;

export type DecisionInput = Parameters<typeof createPortfolioActionRiskDecision>[0];


export function turnoverCapacityCandidate(fixture: ReturnType<typeof policyFixture>, side: "BUY" | "SELL", prior: number,
  denominator = 1000, requested = 100): DecisionInput {
  const base = decisionInput(fixture, side);
  if (base.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
  return { ...base, requestedNotionalKrw: requested, worstCaseFillNotionalKrw: requested, approvedMaximumFillNotionalKrw: requested,
    cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: requested, approvedMaximumNetCashDebitKrw: requested }
      : { side, expectedMinimumNetCashCreditKrw: requested },
    turnoverAssessment: { ...base.turnoverAssessment, turnoverWindowOpenPortfolioNetWorthKrw: denominator,
      priorBucketTurnoverNotionalKrw: prior, requestedBucketTurnoverNotionalKrw: requested, resultingBucketTurnoverRatio: (prior + requested) / denominator } };
}


export function pendingCashFixture(side: "BUY" | "SELL", remainingNotionalKrw: number): PendingPortfolioActionInput {
  const common = { planId: "pending-plan", planHash: HASH, planEventId: "pending-event", planEventHash: HASH,
    actionId: "action-1", actionExecutionTargetHash: HASH, market: "KR" as const, symbol: "KR:005930", remainingNotionalKrw, asOf: CREATED_AT };
  return side === "BUY" ? { ...common, side, openingCapacityReservationId: "pending-reservation", openingCapacityReservationHash: HASH }
    : { ...common, side, remainingQuantity: 2, priceEvidenceRef: "snapshot-price" };
}


export function snapshotFixture(candidate: Omit<DecisionInput, "decidedAt">, legacy: boolean,
  overrides: Partial<{ portfolioId: string; portfolioVersion: string; policyHash: string; asOf: string; unassigned: boolean; quantity: number; cashKrw: number; pendingActionInputs: PendingPortfolioActionInput[]; holdingLots: Array<{ bucket?: StrategyBucket; quantity: number }> }> = {}) {
  const portfolioId = overrides.portfolioId ?? candidate.portfolioId;
  const { unassigned = legacy, quantity = 2, cashKrw = 1_000, pendingActionInputs = [], holdingLots, ...scopeOverrides } = overrides;
  const lots = holdingLots ?? [{ quantity, ...(unassigned ? {} : { bucket: "swing" as const }) }];
  const bucketExposureKrw = { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 };
  let positionValue = 0;
  let unassignedExposureKrw = 0;
  for (const lot of lots) {
    const value = Math.round(lot.quantity * 100);
    positionValue += value;
    if (lot.bucket === undefined) unassignedExposureKrw += value;
    else bucketExposureKrw[lot.bucket] += value;
  }
  return createPortfolioSizingSnapshot({
    portfolioId, portfolioVersion: "v1", policyHash: candidate.policyHash, asOf: CREATED_AT, ...scopeOverrides,
    virtualPortfolio: { portfolioId, cashKrw, updatedAt: CREATED_AT,
      positions: lots.map((lot) => ({ market: candidate.market, symbol: candidate.symbol, quantity: lot.quantity, averagePriceKrw: 100,
        ...(lot.bucket === undefined ? {} : { strategyBucket: lot.bucket }), sector: "Electronics", region: "KR", updatedAt: CREATED_AT })) },
    valuationInputs: lots.length === 0 ? [] : [{ kind: "mark_price", market: candidate.market, symbol: candidate.symbol, priceKrw: 100,
      evidenceRef: "snapshot-price", evidenceAsOf: CREATED_AT }], pendingActionInputs,
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: cashKrw + positionValue, cashKrw,
      bucketExposureKrw,
      symbolExposureKrw: lots.length === 0 ? [] : [{ market: candidate.market, symbol: candidate.symbol, exposureKrw: positionValue }],
      ...(unassignedExposureKrw === 0 ? {} : { unassignedExposureKrw }),
      marketExposureKrw: { KR: positionValue, US: 0 }, sectorExposureKrw: positionValue === 0 ? {} : { Electronics: positionValue },
      countryExposureKrw: positionValue === 0 ? {} : { KR: positionValue }, currencyExposureKrw: positionValue === 0 ? {} : { KRW: positionValue },
      ...pendingActionExposureTotals(pendingActionInputs) })
  });
}


export function priceBoundFillInput(candidate: Omit<DecisionInput, "decidedAt">, price: ReturnType<typeof createSourcePriceEvidenceRecord>) {
  const executionPolicy: Parameters<typeof createPaperFillExecutionRecord>[0]["executionPolicy"] = {
    modelVersion: PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price",
    slippageBps: 0, feeBps: 0, taxBps: 0, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: true,
    maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 };
  const fill = buildPaperFill({ action: candidate.side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL",
    sourcePriceKrw: price.priceKrw, targetNotionalKrw: candidate.requestedNotionalKrw, policy: executionPolicy });
  return { portfolioId: candidate.portfolioId, rebalancePlanId: candidate.planId, rebalanceActionId: candidate.actionId, fillId: "selected-price-fill",
    market: candidate.market, symbol: candidate.symbol, side: candidate.side, requestedNotionalKrw: candidate.requestedNotionalKrw,
    requestedQuantity: candidate.requestedQuantity, quantityOverride: null, sourcePriceKrw: price.priceKrw,
    sourcePriceEvidence: { sourceContractId: price.sourceContractId, evidenceRef: price.evidenceRef, evidenceHash: price.evidenceHash,
      market: price.market, symbol: price.symbol, priceField: price.priceField, observedAt: price.observedAt }, averagePriceKrw: null,
    fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity, filledNotionalKrw: fill.filledNotionalKrw, grossAmountKrw: fill.grossAmountKrw,
    netAmountKrw: fill.netAmountKrw, participationRate: null, volume: null, averageVolume: null, liquidityStale: false,
    fillStatus: "filled" as const, liquidityStatus: "not_modeled" as const, liquidityRejectReason: null, fractionalShares: true, executionPolicy,
    costBreakdown: { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw, spreadCostKrw: fill.spreadCostKrw,
      impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw }, evidenceRefs: [price.evidenceRef] };
}


export function priceBoundFillEvent(plan: RebalancePlanRecord, decision: ReturnType<typeof createPortfolioActionRiskDecision>,
  fill: ReturnType<typeof createPaperFillExecutionRecord>, committedAt: string) {
  return createRebalancePlanExecutionAppliedEvent({ ...planScope(plan), previousPlanEventId: "approved-event", eventType: "execution_applied",
    asOf: new Date(Date.parse(committedAt) + 1).toISOString(), actionId: decision.actionId, actionSequence: 0, fillSequence: 0,
    fillId: fill.fillId, paperFillRecordId: fill.paperFillRecordId, paperFillHash: fill.paperFillHash, requestedNotionalKrw: fill.requestedNotionalKrw,
    requestedQuantity: fill.requestedQuantity, filledNotionalKrw: fill.filledNotionalKrw, filledQuantity: fill.quantity,
    cumulativeFilledNotionalKrw: fill.filledNotionalKrw, cumulativeFilledQuantity: fill.quantity, riskDecisionId: decision.riskDecisionId,
    expectedPrePortfolioVersion: decision.expectedPortfolioVersion, expectedPrePortfolioSnapshotHash: decision.expectedPortfolioSnapshotHash,
    resultingPortfolioVersion: "v2", resultingPortfolioSnapshotHash: HASH });
}


export function pricePayload(candidate: Omit<DecisionInput, "decidedAt">) {
  return { sourceContractId: "fixture-price", market: candidate.market, symbol: candidate.symbol, priceField: "last_price" as const,
    priceKrw: 100, observedAt: CREATED_AT, createdAt: CREATED_AT, sourceRefs: ["fixture-price-source"] };
}


export async function withPriceFixture(side: "BUY" | "SELL", legacy: boolean,
  run: (input: Parameters<Parameters<typeof withSnapshotFixture>[2]>[0] & {
    price: ReturnType<typeof createSourcePriceEvidenceRecord>; prices: SourcePriceEvidenceFileRepository
  }) => Promise<void>) {
  await withSnapshotFixture(side, legacy, async (input) => {
    const price = createSourcePriceEvidenceRecord(pricePayload(input.candidate));
    const prices = new SourcePriceEvidenceFileRepository(input.directory);
    await prices.append(price);
    await run({ ...input, candidate: { ...input.candidate, riskEvidenceRefs: [...input.candidate.riskEvidenceRefs, price.evidenceRef] }, price, prices });
  });
}


export async function withSnapshotFixture(side: "BUY" | "SELL", legacy: boolean,
  run: (input: Parameters<Parameters<typeof withPlanFixture>[2]>[0] & { snapshot: ReturnType<typeof snapshotFixture> }) => Promise<void>,
  overrides: Parameters<typeof snapshotFixture>[2] = {}) {
  let snapshot: ReturnType<typeof snapshotFixture>;
  await withPlanFixture(side, legacy, async (input) => run({ ...input, snapshot }), false,
    legacy ? undefined : async (directory, candidate) => {
      const mandate = createInvestmentMandateRecord(mandatePayload(candidate));
      const store = new InvestmentMandateFileRepository(directory);
      await store.appendRecord(mandate);
      const { eventType: _type, previousMandateEventId: _previous, mandateEventId: _id, mandateEventHash: _hash, ...scope } = mandateTransition(mandate, "retired", "placeholder");
      await store.appendEvent(createInvestmentMandateEvent({ ...scope, eventType: "activated" }));
      return mandate.mandateId;
    }, async (directory, candidate) => {
      snapshot = snapshotFixture(candidate, legacy, overrides);
      await new PortfolioSizingSnapshotFileRepository(directory).append(snapshot);
      return snapshot.portfolioSnapshotHash;
    });
}


export function mandatePayload(candidate: Omit<DecisionInput, "decidedAt">) {
  return { portfolioId: candidate.portfolioId, policyHash: candidate.policyHash, market: candidate.market, symbol: candidate.symbol,
    bucket: "swing" as const, asOf: CREATED_AT, createdAt: CREATED_AT, targetWeightRatio: 0.1, minWeightRatio: 0.05, maxWeightRatio: 0.2,
    maximumOpeningNotionalKrw: 100, reasonCodes: ["fixture"], evidenceRefs: ["fixture"], evidenceAsOf: CREATED_AT,
    reviewCadence: { mode: "scheduled" as const, boundaryRefs: [scheduleBoundaryRefFor(policyFixture().records.scheduleBoundaries[0]!)] },
    validFrom: CREATED_AT, reviewAfter: "2099-01-01T00:00:00.000Z",
    assignmentSource: "manual_policy" as const, manualAuthorizationScope: "open_or_increase" as const, manualAssignmentEventId: "manual-1",
    capacityReservation: { manualCapacityReservationId: "reservation-1", manualCapacityReservationHash: HASH, reservedMaximumNotionalKrw: 100, reservationKind: "new_position" as const, reservedSlotOrdinal: 0 }
  };
}


export function mandateTransition(mandate: InvestmentMandateRecord, eventType: "review_required" | "retired", previousMandateEventId: string) {
  return createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
    portfolioId: mandate.portfolioId, policyHash: mandate.policyHash, market: mandate.market, symbol: mandate.symbol, bucket: mandate.bucket,
    eventType, previousMandateEventId, asOf: CREATED_AT, createdAt: CREATED_AT, reasonCodes: ["fixture"] });
}


export async function withMandateFixture(side: "BUY" | "SELL", run: (input: Parameters<Parameters<typeof withPlanFixture>[2]>[0] & {
  mandate: InvestmentMandateRecord; mandates: InvestmentMandateFileRepository
}) => Promise<void>, options: { reduceOnly?: boolean; state?: "proposed" | "retired" | "review_required";
  overrides?: Partial<Pick<InvestmentMandateRecord, "bucket" | "portfolioId" | "market" | "symbol" | "policyHash" | "validFrom" | "reviewAfter" | "expiresAt">> } = {}) {
  let mandate: InvestmentMandateRecord;
  let mandates: InvestmentMandateFileRepository;
  await withPlanFixture(side, false, async (input) => run({ ...input, mandate, mandates }), false, async (directory, candidate) => {
    const { capacityReservation, ...payload } = mandatePayload(candidate);
    mandate = createInvestmentMandateRecord({ ...payload, ...options.overrides, ...(options.reduceOnly
      ? { manualAuthorizationScope: "classify_existing_reduce_only" as const, maximumOpeningNotionalKrw: 0 }
      : { capacityReservation }) });
    mandates = new InvestmentMandateFileRepository(directory);
    await mandates.appendRecord(mandate);
    if (options.state !== "proposed") {
      const { eventType: _type, previousMandateEventId: _previous, ...activationPayload } = mandateTransition(mandate, "retired", "placeholder");
      const { mandateEventId: _id, mandateEventHash: _hash, ...scope } = activationPayload;
      const activation = createInvestmentMandateEvent({ ...scope, eventType: "activated", asOf: mandate.validFrom, createdAt: mandate.validFrom });
      await mandates.appendEvent(activation);
      if (options.state !== undefined) await mandates.appendEvent(mandateTransition(mandate, options.state, activation.mandateEventId));
    }
    return mandate.mandateId;
  });
}


export function planScope(plan: RebalancePlanRecord) {
  return { planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash };
}

export function planEvent(plan: RebalancePlanRecord, kind: "previewed" | "approved" | "rejected", previous?: RebalancePlanEvent) {
  const common = { ...planScope(plan), asOf: new Date().toISOString() };
  return kind === "previewed" ? createRebalancePlanEvent({ ...common, eventType: kind })
    : createRebalancePlanEvent({ ...common, eventType: kind, previousPlanEventId: previous!.planEventId, reasonCodes: ["fixture"] });
}

export async function withPlanFixture(side: "BUY" | "SELL", legacy: boolean, run: (input: {
  directory: string; repository: PortfolioActionRiskDecisionFileRepository; plan: RebalancePlanRecord;
  events: RebalancePlanEventFileRepository; candidate: Omit<DecisionInput, "decidedAt">;
}) => Promise<void>, wholeShares = false, setupMandate?: (directory: string, candidate: Omit<DecisionInput, "decidedAt">) => Promise<string>,
setupSnapshot?: (directory: string, candidate: Omit<DecisionInput, "decidedAt">) => Promise<string>) {
  const fixture = policyFixture();
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-plan-"));
  try {
    await storePolicyFixture(directory, fixture);
    const { decidedAt: _time, ...original } = decisionInput(fixture, side, legacy);
    if (setupSnapshot !== undefined) original.expectedPortfolioSnapshotHash = await setupSnapshot(directory, original);
    const mandateId = await setupMandate?.(directory, original) ?? "mandate-1";
    const target = wholeShares ? { targetKind: "whole_share_quantity" as const, targetQuantity: 1, referencePriceKrw: 100, plannedNotionalKrw: 100, residualNotionalKrw: 0, priceEvidenceRef: "price-1" }
      : side === "BUY" ? { targetKind: "fractional_buy_notional" as const, targetNotionalKrw: 100 }
      : { targetKind: "fractional_sell_quantity" as const, targetQuantity: 0.3, referencePriceKrw: 100, markedTargetNotionalKrw: 30, priceEvidenceRef: "price-1" };
    const plan = createRebalancePlanRecord({ cycleId: "cycle-1", portfolioId: original.portfolioId, portfolioVersion: "v1", portfolioSnapshotHash: original.expectedPortfolioSnapshotHash,
      policyHash: fixture.policy.policyHash, evidenceCutoffAt: CREATED_AT, createdAt: CREATED_AT, triggerRef: "trigger-1", phase: side === "BUY" ? "buy" : "sell",
      actions: [{ actionId: "action-1", actionSequence: 0, market: "KR", symbol: original.symbol, maximumNotionalKrw: 100, reasonCodes: ["fixture"], executionTarget: target,
        ...(legacy ? { lineageKind: "unassigned_legacy_reduce_only" as const, side: "SELL" as const, observedPositionRef: "legacy-1", legacyStateDetectedAt: CREATED_AT }
          : { lineageKind: "mandate" as const, side, mandateId }) }] });
    const plans = new RebalancePlanFileRepository(directory);
    await plans.append(plan);
    const events = new RebalancePlanEventFileRepository(directory, plans);
    const preview = await events.append(planEvent(plan, "previewed"));
    await events.append(planEvent(plan, "approved", preview));
    const candidate = { ...original, planId: plan.planId, actionExecutionTargetHash: hashRebalanceExecutionTarget(target),
      requestedQuantity: side === "BUY" ? 1 : 0.3, approvedMaximumFillNotionalKrw: 100 };
    await run({ directory, repository: new PortfolioActionRiskDecisionFileRepository(directory), plan, events, candidate });
  } finally { await rm(directory, { recursive: true, force: true }); }
}


export async function withDecision(
  fixture: ReturnType<typeof policyFixture>, candidate: DecisionInput,
  run: (input: Parameters<typeof resolvePortfolioActionRiskDecisionPolicy>[0]) => Promise<void>
) {
  const directory = await mkdtemp(join(tmpdir(), "toss-risk-policy-"));
  try {
    await storePolicyFixture(directory, fixture);
    const repository = new PortfolioActionRiskDecisionFileRepository(directory);
    const { decidedAt: _decidedAt, ...creationInput } = candidate;
    const decision = await repository.createAndAppendWithPolicyOrigin(creationInput);
    await run({ baseDir: directory, riskDecisionId: decision.riskDecisionId });
  } finally { await rm(directory, { recursive: true, force: true }); }
}


export async function storePolicyFixture(directory: string, fixture: ReturnType<typeof policyFixture>) {
  const paths = createImmutablePolicyDependencyPaths(directory);
  for (const key of Object.keys(paths) as Array<keyof typeof paths>) {
    await writeFile(paths[key], `${fixture.records[key].map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  }
  await new RuntimePortfolioPolicyFileRepository(directory, fixture.dependencies).append(fixture.policy);
  await new RuntimePortfolioPolicyActivationFileRepository(directory, [fixture.policy], fixture.dependencies)
    .appendActivated({ policy: fixture.policy, createdAt: CREATED_AT });
}


export function decisionInput(fixture: ReturnType<typeof policyFixture>, side: "BUY" | "SELL", legacy = false): DecisionInput {
  const set = legacy ? fixture.legacySet : fixture.bucketSet;
  const requiredRuleIds = set.rules.filter((rule) => rule.appliesTo.includes(side)).map((rule) => rule.ruleId);
  return {
    riskRuleSetRecordId: set.riskRuleSetRecordId, riskRuleSetVersion: set.version, riskRuleSetHash: set.hash,
    planId: "plan-1", actionId: "action-1", portfolioId: fixture.policy.portfolioId, policyHash: fixture.policy.policyHash,
    expectedPortfolioVersion: "v1", expectedPortfolioSnapshotHash: HASH,
    market: "KR", symbol: "KR:005930", side,
    riskRuleScope: legacy ? { scopeKind: "legacy_reduce_only", legacyPolicyHash: hashCanonicalPayload(fixture.policy.legacyReduceOnlyPolicy) } : { scopeKind: "bucket", bucket: "swing" },
    actionExecutionTargetHash: HASH,
    turnoverAssessment: legacy ? { scopeKind: "legacy_reduce_only", countedInBucketTurnover: false } : {
      scopeKind: "bucket", turnoverStateId: "turnover-1", turnoverStateHash: HASH,
      turnoverWindowOpenPortfolioNetWorthKrw: 1_000, priorBucketTurnoverNotionalKrw: 0,
      requestedBucketTurnoverNotionalKrw: 100, resultingBucketTurnoverRatio: 0.1
    },
    priorCumulativeFilledNotionalKrw: 0, priorCumulativeFilledQuantity: 0,
    requestedNotionalKrw: 100, requestedQuantity: 1, worstCaseFillNotionalKrw: 100, approvedMaximumFillNotionalKrw: 110,
    cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: 100, approvedMaximumNetCashDebitKrw: 110 } : { side, expectedMinimumNetCashCreditKrw: 90 },
    decision: "approved", requiredRuleIds,
    ruleResults: requiredRuleIds.map((ruleId) => ({ ruleId, result: "pass", reasonCode: "fixture" })),
    riskEvidenceRefs: ["fixture-evidence"], decidedAt: DECIDED_AT
  };
}


export async function withPlanExecutionFixture(run: (value: {
  request: Parameters<typeof createPortfolioPlanExecutionPreview>[0]; input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0];
  plan: RebalancePlanRecord; events: RebalancePlanEventFileRepository; approval: RebalancePlanEvent;
  mandates: InvestmentMandateFileRepository; mandate: InvestmentMandateRecord | null; activation: ReturnType<typeof createInvestmentMandateEvent> | null;
  candidate: Omit<DecisionInput, "decidedAt">;
}) => Promise<void>, options: { side?: "BUY" | "SELL"; legacy?: boolean; whole?: boolean; fractionalPolicy?: boolean; reduceOnly?: boolean; riskSnapshot?: boolean } = {}) {
  const side = options.side ?? "BUY";
  const parameters = executionFixtureParameters(10);
  if (options.whole && !options.fractionalPolicy) {
    parameters.markets.KR!.executionPolicy.modelVersion = WHOLE_SHARE_PAPER_EXECUTION_MODEL_VERSION;
    parameters.markets.KR!.executionPolicy.allowFractionalShares = false;
  }
  await withPolicyExecutionFixture(async ({ input, fixture }) => {
    const { decidedAt: _decidedAt, ...candidate } = decisionInput(fixture, side, options.legacy);
    if (options.riskSnapshot) {
      const snapshot = snapshotFixture(candidate, options.legacy ?? false, { cashKrw: 1_000_000, quantity: 10 });
      await new PortfolioSizingSnapshotFileRepository(input.baseDir).append(snapshot);
      candidate.expectedPortfolioSnapshotHash = snapshot.portfolioSnapshotHash;
    }
    const { capacityReservation, ...payload } = mandatePayload(candidate);
    const mandate = options.legacy ? null : createInvestmentMandateRecord({ ...payload, ...(options.reduceOnly
      ? { manualAuthorizationScope: "classify_existing_reduce_only", maximumOpeningNotionalKrw: 0 } : { capacityReservation }) });
    const mandates = new InvestmentMandateFileRepository(input.baseDir);
    let activation: ReturnType<typeof createInvestmentMandateEvent> | null = null;
    if (mandate !== null) {
      await mandates.appendRecord(mandate);
      activation = createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
        portfolioId: mandate.portfolioId, policyHash: mandate.policyHash, market: mandate.market, symbol: mandate.symbol,
        bucket: mandate.bucket, eventType: "activated", asOf: CREATED_AT, createdAt: CREATED_AT, reasonCodes: ["fixture"] });
      await mandates.appendEvent(activation);
    }
    const target = options.whole ? { targetKind: "whole_share_quantity" as const, targetQuantity: 10, referencePriceKrw: 10_000,
      plannedNotionalKrw: 100_000, residualNotionalKrw: 0, priceEvidenceRef: input.priceEvidenceRef }
      : side === "BUY" ? { targetKind: "fractional_buy_notional" as const, targetNotionalKrw: 100_000 }
      : { targetKind: "fractional_sell_quantity" as const, targetQuantity: 0.3, referencePriceKrw: 10_000,
        markedTargetNotionalKrw: 3000, priceEvidenceRef: input.priceEvidenceRef };
    const plan = createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: input.portfolioId, portfolioVersion: "v1",
      portfolioSnapshotHash: candidate.expectedPortfolioSnapshotHash, policyHash: input.expectedPolicyHash, evidenceCutoffAt: CREATED_AT, createdAt: CREATED_AT,
      triggerRef: "synthetic-trigger", phase: side === "BUY" ? "buy" : "sell", actions: [{ actionId: "action-1", actionSequence: 0,
        market: input.market, symbol: input.symbol, executionTarget: target, maximumNotionalKrw: 100_000, reasonCodes: ["fixture"],
        ...(options.legacy ? { lineageKind: "unassigned_legacy_reduce_only" as const, side: "SELL" as const,
          observedPositionRef: "synthetic-legacy", legacyStateDetectedAt: CREATED_AT }
          : { lineageKind: "mandate" as const, side, mandateId: mandate!.mandateId }) }] });
    const plans = new RebalancePlanFileRepository(input.baseDir);
    await plans.append(plan);
    const events = new RebalancePlanEventFileRepository(input.baseDir, plans);
    const preview = await events.append(planEvent(plan, "previewed"));
    const approval = await events.append(planEvent(plan, "approved", preview));
    const packet = executionLiquidityPacket(input);
    await new FileMarketPacketStore(createStoragePaths(input.baseDir).marketPacketsPath).append(packet);
    await run({ input, plan, events, approval, mandate, mandates, activation, candidate, request: { baseDir: input.baseDir, planId: plan.planId,
      expectedPlanEventHash: approval.planEventHash, priceEvidenceRef: input.priceEvidenceRef, liquidityPacketHash: createMarketPacketHash(packet) } });
  }, policyFixture("v1", { bucket: parameters, legacy: executionFixtureParameters(20) }));
}


export function turnoverRetryInput(fill: ReturnType<typeof createPaperFillExecutionRecord>) {
  const { paperFillRecordId: _id, paperFillHash: _hash, asOf: _asOf, createdAt: _createdAt, ...input } = fill;
  return input;
}


export function rehashTurnoverFillPair(entry: Record<string, unknown>, marker: Record<string, unknown>, completion?: Record<string, unknown>) {
  const { entryHash: _entryHash, ...payload } = entry;
  const entryHash = hashCanonicalPayload(payload);
  const { commitHash: _commitHash, ...commit } = marker;
  const markerPayload = { ...commit, entryHash };
  const commitHash = hashCanonicalPayload(markerPayload);
  const pair = `${JSON.stringify({ ...payload, entryHash })}\n${JSON.stringify({ ...markerPayload, commitHash })}\n`;
  if (completion === undefined) return pair;
  const { completionHash: _completionHash, ...previousCompletion } = completion;
  const proof = { ...previousCompletion, commitHash };
  return `${pair}${JSON.stringify({ ...proof, completionHash: hashCanonicalPayload(proof) })}\n`;
}


export async function withCompletedTurnoverFillFixture(run: Parameters<typeof withTurnoverFillFixture>[0],
  options: Parameters<typeof withTurnoverFillFixture>[1] = {}) {
  return withTurnoverFillFixture(run, { ...options, completion: true });
}


export async function withTurnoverFillFixture(run: (input: { baseDir: string; fill: ReturnType<typeof createPaperFillExecutionRecord>;
  root: Awaited<ReturnType<BucketTurnoverWindowFileRepository["createOrResolve"]>>;
  createNextRisk: (prior: BucketTurnoverState) => Promise<ReturnType<typeof createPortfolioActionRiskDecision>>;
  createNextFill: (prior: BucketTurnoverState, fillId: string) => Promise<ReturnType<typeof createPaperFillExecutionRecord>> }) => Promise<void>,
options: { side?: "BUY" | "SELL"; whole?: boolean; completion?: boolean; turnoverBound?: boolean; assessment?: { turnoverStateId?: string; turnoverWindowOpenPortfolioNetWorthKrw?: number } } = {}) {
  await withRiskExecutionFixture(async ({ baseDir, repository, candidate, selection }) => {
    const windows = new BucketTurnoverWindowFileRepository(baseDir);
    const root = await windows[options.completion ? "createOrResolveWithCompletion" : "createOrResolve"]({ portfolioId: candidate.portfolioId,
      bucket: "swing", expectedPolicyHash: candidate.policyHash });
    assert.equal(candidate.turnoverAssessment.scopeKind, "bucket");
    if (candidate.turnoverAssessment.scopeKind !== "bucket") throw new Error("bucket fixture required");
    const initial = root.snapshotOrigin.initialState;
    const denominator = options.assessment?.turnoverWindowOpenPortfolioNetWorthKrw ?? initial.windowOpenPortfolioNetWorthKrw;
    const bound = { ...candidate, turnoverAssessment: { ...candidate.turnoverAssessment,
      turnoverStateId: options.assessment?.turnoverStateId ?? initial.turnoverStateId, turnoverStateHash: initial.turnoverStateHash,
      turnoverWindowOpenPortfolioNetWorthKrw: denominator,
      resultingBucketTurnoverRatio: candidate.turnoverAssessment.requestedBucketTurnoverNotionalKrw / denominator } };
    const createRisk = (value: typeof bound) => repository[options.turnoverBound ? "createAndAppendWithTurnoverOrigin" : "createAndAppendWithExecutionOrigin"](value, selection);
    if (options.turnoverBound) await new BucketTurnoverStateFileRepository(baseDir).refresh({ expectedProjectionHash: null });
    const decision = await createRisk(bound);
    const history = await repository.readVerifiedHistory();
    const preview = resolveVerifiedPortfolioActionRiskDecisionOrigin(history, decision.riskDecisionId).executionOrigin!.preview;
    const fill = await new PaperFillExecutionFileRepository(baseDir).createAndAppendWithRiskCompletion(executionBoundFillInput(bound, preview), history, decision.riskDecisionId);
    const nextCandidate = (prior: BucketTurnoverState) => ({ ...bound,
      turnoverAssessment: { ...bound.turnoverAssessment, turnoverStateHash: prior.turnoverStateHash,
        priorBucketTurnoverNotionalKrw: prior.cumulativeAbsoluteFilledNotionalKrw,
        resultingBucketTurnoverRatio: (prior.cumulativeAbsoluteFilledNotionalKrw + bound.turnoverAssessment.requestedBucketTurnoverNotionalKrw) / denominator } });
    await run({ baseDir, fill, root,
      createNextRisk: (prior) => createRisk(nextCandidate(prior)),
      createNextFill: async (prior, fillId) => {
      const next = nextCandidate(prior);
      const nextDecision = await createRisk(next);
      const nextHistory = await repository.readVerifiedHistory();
      const nextPreview = resolveVerifiedPortfolioActionRiskDecisionOrigin(nextHistory, nextDecision.riskDecisionId).executionOrigin!.preview;
      return new PaperFillExecutionFileRepository(baseDir).createAndAppendWithRiskCompletion({ ...executionBoundFillInput(next, nextPreview), fillId }, nextHistory, nextDecision.riskDecisionId);
    } });
  }, options);
}


export async function withTurnoverCreationFixture(run: (value: Parameters<Parameters<typeof withRiskExecutionFixture>[0]>[0] & {
  root: Awaited<ReturnType<BucketTurnoverWindowFileRepository["createOrResolve"]>>
}) => Promise<void>, options: { side?: "BUY" | "SELL"; completion?: boolean } = {}) {
  return withRiskExecutionFixture(async (fixture) => {
    const root = await new BucketTurnoverWindowFileRepository(fixture.baseDir)
      [options.completion === false ? "createOrResolve" : "createOrResolveWithCompletion"]({
        portfolioId: fixture.candidate.portfolioId, bucket: "swing", expectedPolicyHash: fixture.candidate.policyHash });
    const state = root.snapshotOrigin.initialState;
    const assessment = fixture.candidate.turnoverAssessment;
    if (assessment.scopeKind !== "bucket") throw new Error("bucket required");
    const candidate = { ...fixture.candidate, turnoverAssessment: { ...assessment, turnoverStateId: state.turnoverStateId,
      turnoverStateHash: state.turnoverStateHash, turnoverWindowOpenPortfolioNetWorthKrw: state.windowOpenPortfolioNetWorthKrw,
      resultingBucketTurnoverRatio: assessment.requestedBucketTurnoverNotionalKrw / state.windowOpenPortfolioNetWorthKrw } };
    await run({ ...fixture, root, candidate });
  }, options);
}


export async function withRiskExecutionFixture(run: (value: { baseDir: string; repository: PortfolioActionRiskDecisionFileRepository;
  candidate: Omit<DecisionInput, "decidedAt">; selection: Parameters<PortfolioActionRiskDecisionFileRepository["createAndAppendWithExecutionOrigin"]>[1];
}) => Promise<void>, options: { side?: "BUY" | "SELL"; legacy?: boolean; whole?: boolean } = {}) {
  await withPlanExecutionFixture(async ({ request, candidate, plan }) => {
    const preview = (await createPortfolioPlanExecutionPreview(request)).packetPreview.policyPreview.preview;
    const gross = preview.execution.grossAmountKrw;
    const net = preview.execution.netAmountKrw;
    const derived = { ...candidate, planId: plan.planId, actionId: plan.actions[0]!.actionId,
      actionExecutionTargetHash: hashRebalanceExecutionTarget(plan.actions[0]!.executionTarget),
      requestedQuantity: preview.requestedQuantity, requestedNotionalKrw: preview.input.requestedNotionalKrw,
      worstCaseFillNotionalKrw: gross, approvedMaximumFillNotionalKrw: 100_000,
      cashAssessment: preview.input.side === "BUY" ? { side: "BUY" as const, worstCaseNetCashDebitKrw: net, approvedMaximumNetCashDebitKrw: net }
        : { side: "SELL" as const, expectedMinimumNetCashCreditKrw: net },
      turnoverAssessment: candidate.turnoverAssessment.scopeKind === "bucket" ? { ...candidate.turnoverAssessment,
        turnoverWindowOpenPortfolioNetWorthKrw: 1_000_000,
        requestedBucketTurnoverNotionalKrw: gross, resultingBucketTurnoverRatio: gross / 1_000_000 }
        : candidate.turnoverAssessment,
      riskEvidenceRefs: [...candidate.riskEvidenceRefs, request.priceEvidenceRef] };
    const { baseDir, planId: _planId, ...selection } = request;
    await run({ baseDir, repository: new PortfolioActionRiskDecisionFileRepository(baseDir), candidate: derived, selection });
  }, { ...options, riskSnapshot: true });
}


export function executionBoundFillInput(candidate: Omit<DecisionInput, "decidedAt">, preview: ReturnType<typeof parsePortfolioActionExecutionPreview>) {
  const { input, execution } = preview;
  return { ...priceBoundFillInput(candidate, input.sourcePriceEvidence), quantityOverride: input.quantityOverride,
    executionPolicy: input.executionPolicy, volume: input.volume, averageVolume: input.averageVolume, liquidityStale: input.liquidityStale,
    fractionalShares: input.executionPolicy.allowFractionalShares, fillStatus: execution.fillStatus as "filled" | "partial",
    liquidityStatus: execution.liquidityStatus as "sufficient" | "partial", participationRate: execution.participationRate,
    fillPriceKrw: execution.fillPriceKrw, quantity: execution.quantity, filledNotionalKrw: execution.filledNotionalKrw,
    grossAmountKrw: execution.grossAmountKrw, netAmountKrw: execution.netAmountKrw, costBreakdown: execution.costBreakdown };
}


export function executionLiquidityPacket(input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0]) {
  const now = new Date();
  return new MarketPacketBuilder({ packetId: "synthetic-execution-liquidity", generatedAt: now, expiresInSeconds: 300,
    maxCandidates: 1, constraints: { maxNewPositions: 1, maxBudgetPerSymbolKrw: 100_000, allowedActions: ["VIRTUAL_BUY", "VIRTUAL_SELL"] } })
    .build({ portfolio: { portfolioId: input.portfolioId, cashKrw: 1_000_000, positions: [], updatedAt: now.toISOString() },
      candidates: [{ market: input.market, symbol: input.symbol, lastPriceKrw: 10_000, volume: 50, averageVolume: 100,
        sourceRefs: ["synthetic-liquidity"] }] }).packet;
}


export function packetExecutionInput(input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0], packet: ReturnType<typeof executionLiquidityPacket>) {
  const { volume: _volume, averageVolume: _average, liquidityStale: _stale, ...request } = input;
  return { ...request, liquidityPacketHash: createMarketPacketHash(packet) };
}


export function executionFixtureParameters(feeBps: number) {
  return portfolioExecutionRuleParametersSchema.parse({ schemaVersion: "portfolio_execution_rule.v1", markets: { KR: {
    maximumPriceAgeSeconds: 3600, allowedPriceSourceContractIds: ["fixture-execution"],
    executionPolicy: { modelVersion: PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price",
      slippageBps: 0, feeBps, taxBps: 20, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 }
  } } });
}


export async function withPolicyExecutionFixture(
  run: (value: { input: Parameters<typeof createPortfolioPolicyExecutionPreview>[0]; fixture: ReturnType<typeof policyFixture> }) => Promise<void>,
  fixture = policyFixture("v1", { bucket: executionFixtureParameters(10), legacy: executionFixtureParameters(20) })
) {
  const baseDir = await mkdtemp(join(tmpdir(), "toss-policy-execution-preview-"));
  try {
    await storePolicyFixture(baseDir, fixture);
    const price = createSourcePriceEvidenceRecord({ sourceContractId: "fixture-execution", market: "KR", symbol: "KR:005930",
      priceField: "last_price", priceKrw: 10_000, observedAt: new Date(Date.now() - 60_000).toISOString(),
      sourceRefs: ["synthetic-fixture"], createdAt: new Date().toISOString() });
    await new SourcePriceEvidenceFileRepository(baseDir).append(price);
    await run({ fixture, input: { baseDir, portfolioId: fixture.policy.portfolioId, expectedPolicyHash: fixture.policy.policyHash,
      scope: { scopeKind: "bucket", bucket: "swing" }, market: "KR", symbol: price.symbol, priceEvidenceRef: price.evidenceRef,
      side: "BUY", requestedNotionalKrw: 100_000, quantityOverride: 10, volume: 100, averageVolume: 200, liquidityStale: false } });
  } finally { await rm(baseDir, { recursive: true, force: true }); }
}


export type ExecutionFixtureOptions = {
  bucket: Parameters<typeof createPortfolioRiskRuleParameterRecord>[0]["parameters"];
  legacy: Parameters<typeof createPortfolioRiskRuleParameterRecord>[0]["parameters"];
  ruleVersion?: string;
  appliesTo?: Array<"BUY" | "SELL">;
};


export function policyFixture(version = "v1", execution?: ExecutionFixtureOptions, maxTurnoverRatio = 0.5) {
  const buckets = ["long_term", "swing", "short_term", "intraday", "hedge"] as const;
  const parameters = ["cash", "exposure", "sell", "legacy"].map((ruleId) => createPortfolioRiskRuleParameterRecord({
    ruleId, ruleVersion: "v1", version: "v1", parameters: { fixtureLimit: 1 }, createdAt: CREATED_AT
  }));
  const rule = (index: number, appliesTo: Array<"BUY" | "SELL">) => ({
    ruleId: parameters[index]!.ruleId, ruleVersion: "v1", appliesTo, parameterRef: riskRuleParameterRefFor(parameters[index]!)
  });
  const executionParameters = execution === undefined ? [] : [execution.bucket, execution.legacy].map((parameters) =>
    createPortfolioRiskRuleParameterRecord({ ruleId: "paper_execution", ruleVersion: execution.ruleVersion ?? "v1",
      version: "v1", parameters, createdAt: CREATED_AT }));
  const executionRules = (index: number) => execution === undefined ? [] : [{ ruleId: "paper_execution",
    ruleVersion: execution.ruleVersion ?? "v1", appliesTo: execution.appliesTo ?? ["BUY", "SELL"] as Array<"BUY" | "SELL">,
    parameterRef: riskRuleParameterRefFor(executionParameters[index]!) }];
  const bucketSet = createPortfolioRiskRuleSetRecord({ version: "bucket.v1", rules: [rule(0, ["BUY"]), rule(1, ["BUY", "SELL"]), rule(2, ["SELL"]), ...executionRules(0)], createdAt: CREATED_AT });
  // The shared rule-set contract covers both sides; legacy scope only uses SELL.
  const legacySet = createPortfolioRiskRuleSetRecord({ version: "legacy.v1", rules: [rule(0, ["BUY"]), rule(3, ["SELL"]), ...executionRules(1)], createdAt: CREATED_AT });
  const selections = buckets.map((bucket) => createBucketSelectionPolicyRecord({
    bucket, version: "v1", requiredEvidence: [{ evidenceClass: "market_technical", sourceContractId: "fixture", maximumAgeSeconds: 60 }],
    everyTickSourceRequirement: { sourceContractId: "fixture", eventType: "verified_market_packet", maximumAgeSeconds: 60, dedupeKey: "packet_hash" },
    hardGateRuleIds: ["fixture"], scoringModelVersion: "v1", featureDefinitionRefs: ["fixture"], createdAt: CREATED_AT
  }));
  const drawdown = createBucketDrawdownSemanticsRecord({
    version: "v1", equityBasis: "bucket_assets_plus_cash", unitFlowRule: "mint_burn_at_pre_flow_unit_nav",
    pnlRule: "mark_to_market_and_execution_cost_only", highWaterMarkRule: "max_previous_and_resulting_unit_nav",
    drawdownFormula: "one_minus_unit_nav_over_high_water_mark", emptyEpochRule: "preserve_nav_until_explicit_initial_or_empty_epoch",
    activationCarryRule: "carry_when_semantics_hash_matches", createdAt: CREATED_AT
  });
  const calendar = createSessionCalendarRecord({
    market: "KR", version: "v1", timeZone: "Asia/Seoul", validFromExchangeDate: "2026-09-01", validThroughExchangeDate: "2026-09-01",
    sessions: [{ exchangeDate: "2026-09-01", sessionKind: "regular", opensAt: "2026-09-01T09:00:00+09:00", closesAt: "2026-09-01T15:30:00+09:00", sourceEvidenceRefs: ["fixture"] }],
    createdAt: CREATED_AT
  });
  const boundary = createScheduleBoundaryRecord({
    market: "KR", version: "v1", timeZone: "Asia/Seoul", sessionCalendarRecordId: calendar.sessionCalendarRecordId,
    sessionCalendarVersion: calendar.version, sessionCalendarHash: calendar.hash, sessionCalendarLineageHash: calendar.lineageHash,
    interval: "daily", anchorLocalTime: "15:30:00", nonSessionDayRule: "previous_session", createdAt: CREATED_AT
  });
  const uniqueExecutionParameters = [...new Map(executionParameters.map((parameter) => [parameter.riskRuleParameterRecordId, parameter])).values()];
  const records: ImmutablePolicyDependencyRecords = { selectionPolicies: selections, riskParameters: [...parameters, ...uniqueExecutionParameters], riskRuleSets: [bucketSet, legacySet],
    drawdownSemantics: [drawdown], sessionCalendars: [calendar], scheduleBoundaries: [boundary] };
  const dependencies = new ImmutablePolicyDependencyRepository(records);
  const targets = [0.35, 0.2, 0.15, 0.1, 0.05];
  const payload = {
    mode: "paper_only", recordType: "runtime_portfolio_policy_record", portfolioId: "paper-main",
    sourcePolicyRecordId: "fixture-source", sourcePolicyRecordHash: HASH, sourcePolicyHash: "b".repeat(64),
    policyId: "fixture", version, name: "Fixture policy",
    strategyBuckets: buckets.map((bucket, index) => ({
      bucket, targetWeightRatio: targets[index]!, minWeightRatio: 0, maxWeightRatio: 0.5, maxTurnoverRatio, maxDrawdownRatio: 0.1,
      turnoverWindow: { mode: "fixed_utc", durationSeconds: 86_400, anchor: "unix_epoch", denominator: "window_open_portfolio_net_worth_krw" },
      drawdownSemanticsRef: drawdownSemanticsRefFor(drawdown),
      reviewCadence: bucket === "intraday" ? { mode: "every_tick" } : { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(boundary)] }, eventTriggers: [],
      selectionTrigger: { mode: "entry_floor_on_due_cycle", entryWeightRatio: 0.02 },
      exitPolicy: { takeProfit: { mode: "disabled" }, timeExpiryAction: "review_required" },
      enabledMarkets: ["KR"], enabledAssetClasses: ["equity"], selectionPolicyRef: selectionPolicyRefFor(selections[index]!), riskRuleSetRef: riskRuleSetRefFor(bucketSet)
    })),
    cashPolicy: { targetCashRatio: 0.15, minimumCashReserveKrw: 100, ruleSource: "static" },
    hedgePolicy: { hedgeEnabled: true, hedgeTargetRatio: 0.05, maxCostRatio: 0.02 },
    exposurePolicy: { maxSymbolExposureRatio: 0.2, maxCountryExposureRatio: 0.8, maxCurrencyExposureRatio: 0.8 },
    legacyReduceOnlyPolicy: { allowBuyOrIncrease: false, maximumParticipationRatio: 0.1, riskRuleSetRef: riskRuleSetRefFor(legacySet) }
  };
  const policyHash = hashCanonicalPayload(payload);
  const runtimePolicyRecordId = hashDerivedId("runtime_portfolio_policy", policyHash);
  const policy = parseRuntimePortfolioPolicyRecord({ ...payload, policyHash, runtimePolicyRecordId, createdAt: CREATED_AT,
    lineageHash: hashImmutableRecordLineage({ recordType: "runtime_portfolio_policy", recordId: runtimePolicyRecordId, semanticHash: policyHash, createdAt: CREATED_AT }) });
  const activation = createPortfolioPolicyActivatedEvent({ policy, activationSequence: 1, createdAt: CREATED_AT });
  return { policy, activation, dependencies, records, bucketSet, legacySet };
}
