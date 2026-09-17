import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { FileVirtualPortfolioStore } from "../storage/virtualPortfolioFileStore.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { PortfolioActionRiskDecisionFileRepository } from "./portfolioActionRiskDecisionFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createPortfolioSizingSnapshotPaths, PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { canonicalizePendingPortfolioActionInputs, pendingActionExposureTotals, type PendingPortfolioActionInput } from "./portfolioSizingInputs.js";
import { policyFixture, storePolicyFixture } from "./portfolioActionRiskDecisionTestFixtures.js";
import { createInvestmentMandateRecord, createInvestmentMandateEvent, type InvestmentMandateRecord } from "./investmentMandate.js";
import { InvestmentMandateFileRepository } from "./investmentMandateFiles.js";
import { scheduleBoundaryRefFor } from "./runtimePolicyContracts.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget, type RebalanceExecutionTarget, type RebalancePlanRecord } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { seedPendingOpeningReservation } from "./currentSizingPendingCapacityTestFixtures.js";
import { createOpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";

interface Tweaks { risk?: Partial<Parameters<typeof createPortfolioActionRiskDecision>[0]>; unbound?: boolean; completion?: boolean;
  mandate?: Partial<Pick<InvestmentMandateRecord, "bucket" | "portfolioId" | "market" | "symbol" | "policyHash" | "validFrom" | "expiresAt">>;
  reduceOnly?: boolean; selector?: boolean; activationOffset?: number }

export const T = Date.parse("2026-09-02T00:00:00.000Z"), at = (offset: number) => new Date(T + offset).toISOString();
export const H = (value: string) => hashCanonicalPayload({ synthetic: value });
export const options = { lockTimeoutMs: 60, lockRetryDelayMs: 3 };
type Kind = "fractional_buy" | "fractional_sell" | "whole_buy" | "whole_sell";
type State = Awaited<ReturnType<typeof seed>>;

async function seed(baseDir: string, kind: Kind, context: TestContext, tweaks: Tweaks) {
  const policy = policyFixture(), portfolioPath = join(baseDir, "portfolio.json");
  const store = new FileVirtualPortfolioStore(portfolioPath, options);
  await store.write({ portfolioId: policy.policy.portfolioId, cashKrw: 1000, updatedAt: at(0), positions: [{ market: "KR", symbol: "SYNTH",
    quantity: 10, averagePriceKrw: 100, region: "KR", sector: "Synthetic", strategyBucket: "swing", updatedAt: at(0) }] });
  await storePolicyFixture(baseDir, policy);
  const side = kind.endsWith("buy") ? "BUY" : "SELL";
  const opening = side === "BUY" && !tweaks.reduceOnly
    ? await seedPendingOpeningReservation(baseDir, policy.policy.portfolioId, H("prior-policy"), tweaks.selector ?? false,
      at, (offset) => context.mock.timers.setTime(T + offset)) : null;
  context.mock.timers.setTime(T + 3);
  const mandates = new InvestmentMandateFileRepository(baseDir, options);
  const mandate = await mandates.appendRecord(createInvestmentMandateRecord({ portfolioId: policy.policy.portfolioId,
    policyHash: H("prior-policy"), market: "KR", symbol: "SYNTH", bucket: "swing", asOf: at(0), createdAt: at(3),
    evidenceAsOf: at(0), validFrom: at(0), targetWeightRatio: 0.1, minWeightRatio: 0.05, maxWeightRatio: 0.2,
    maximumOpeningNotionalKrw: tweaks.reduceOnly ? 0 : 400, reasonCodes: ["synthetic"], evidenceRefs: ["synthetic"],
    reviewCadence: { mode: "scheduled", boundaryRefs: [scheduleBoundaryRefFor(policy.records.scheduleBoundaries[0]!)] }, reviewAfter: at(1000),
    ...(opening?.lineage ?? (tweaks.selector ? { assignmentSource: "deterministic_selector" as const, selectionRequestId: "synthetic-request",
      candidateAssignmentId: "synthetic-assignment", candidateAssignmentSetId: "synthetic-set", candidateAssignmentSetHash: H("set"),
      selectedRank: 1, openingCapacityReservationId: "synthetic-unverified", openingCapacityReservationHash: H("reservation"),
      reservedSlotOrdinal: 0, reservedMaximumNotionalKrw: 400, scoringModelVersion: "synthetic-v1", selectionScore: 1 }
      : tweaks.reduceOnly ? { assignmentSource: "manual_policy" as const, manualAuthorizationScope: "classify_existing_reduce_only" as const,
        manualAssignmentEventId: "synthetic-manual" }
      : { assignmentSource: "manual_policy" as const, manualAuthorizationScope: "open_or_increase" as const, manualAssignmentEventId: "synthetic-manual",
        capacityReservation: { manualCapacityReservationId: "synthetic-unverified", manualCapacityReservationHash: H("reservation"),
          reservedMaximumNotionalKrw: 400, reservationKind: "new_position" as const, reservedSlotOrdinal: 0 } })), ...tweaks.mandate }));
  const activation = await mandates.appendEvent(createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
    portfolioId: mandate.portfolioId, policyHash: mandate.policyHash, market: mandate.market, symbol: mandate.symbol, bucket: mandate.bucket,
    eventType: "activated", asOf: tweaks.activationOffset === undefined ? mandate.validFrom : at(tweaks.activationOffset),
    createdAt: new Date(Math.max(T + 3, Date.parse(tweaks.activationOffset === undefined ? mandate.validFrom : at(tweaks.activationOffset)))).toISOString(),
    reasonCodes: ["synthetic"] }));
  const capacity = new OpeningCapacityReservationEventFileRepository(baseDir, options);
  context.mock.timers.setTime(T + 4);
  const bound = opening === null ? null : createOpeningCapacityReservationEvent({ eventType: "bound_to_mandate",
    portfolioId: opening.root.portfolioId, policyHash: opening.root.policyHash, bucket: opening.root.bucket,
    reservationId: opening.root.reservationId, reservationHash: opening.root.reservationHash,
    previousCapacityReservationEventId: opening.root.capacityReservationEventId, capacityLedgerVersion: 2,
    remainingReservedNotionalKrw: 400, occupiesNewPositionSlot: true, mandateId: mandate.mandateId, mandateHash: mandate.mandateHash,
    asOf: at(4), createdAt: at(4) });
  if (bound !== null) await capacity.append(bound);
  context.mock.timers.setTime(T + 10);
  const prices = new SourcePriceEvidenceFileRepository(baseDir, options);
  const price = await prices.append(createSourcePriceEvidenceRecord({ sourceContractId: "synthetic-pending.v1", market: "KR", symbol: "SYNTH",
    priceField: "last_price", priceKrw: 100, observedAt: at(0), createdAt: at(0), sourceRefs: ["synthetic-price"] }));
  const target: RebalanceExecutionTarget = kind === "fractional_buy" ? { targetKind: "fractional_buy_notional", targetNotionalKrw: 100 }
    : kind === "fractional_sell" ? { targetKind: "fractional_sell_quantity", targetQuantity: 0.3, referencePriceKrw: 100,
      markedTargetNotionalKrw: 30, priceEvidenceRef: price.evidenceRef }
    : { targetKind: "whole_share_quantity", targetQuantity: 3, referencePriceKrw: 100, plannedNotionalKrw: 300,
      residualNotionalKrw: 0, priceEvidenceRef: price.evidenceRef };
  context.mock.timers.setTime(T + 15);
  const plans = new RebalancePlanFileRepository(baseDir, options);
  const plan = await plans.append(createRebalancePlanRecord({ cycleId: "synthetic-cycle", portfolioId: policy.policy.portfolioId,
    portfolioVersion: "synthetic-v1", portfolioSnapshotHash: H("old-snapshot"), policyHash: H("prior-policy"), evidenceCutoffAt: at(12),
    createdAt: at(15), triggerRef: "synthetic-trigger", phase: side === "BUY" ? "buy" : "sell",
    actions: [{ actionId: "synthetic-action", actionSequence: 0, market: "KR", symbol: "SYNTH", lineageKind: "mandate", side,
      mandateId: mandate.mandateId, executionTarget: target, maximumNotionalKrw: 400, reasonCodes: ["synthetic"] }] }));
  const events = new RebalancePlanEventFileRepository(baseDir, plans, options);
  context.mock.timers.setTime(T + 20); const preview = await events.append(event(plan, "previewed", undefined, 20));
  context.mock.timers.setTime(T + 30); const approved = await events.append(event(plan, "approved", preview, 30));
  const amount = kind === "fractional_buy" ? 40 : kind === "fractional_sell" ? 10 : 100, quantity = amount / 100;
  const risks = new PortfolioActionRiskDecisionFileRepository(baseDir, options), fills = new PaperFillExecutionFileRepository(baseDir, options);
  context.mock.timers.setTime(T + 32);
  const risk = await risks.append(createPortfolioActionRiskDecision({ riskRuleSetRecordId: "synthetic-rules", riskRuleSetVersion: "v1", riskRuleSetHash: H("rules"),
    planId: plan.planId, actionId: "synthetic-action", portfolioId: plan.portfolioId, policyHash: plan.policyHash,
    expectedPortfolioVersion: plan.portfolioVersion, expectedPortfolioSnapshotHash: plan.portfolioSnapshotHash,
    market: "KR", symbol: "SYNTH", side, actionExecutionTargetHash: hashRebalanceExecutionTarget(target),
    riskRuleScope: { scopeKind: "bucket", bucket: "swing" },
    turnoverAssessment: { scopeKind: "bucket", turnoverStateId: "synthetic-turnover", turnoverStateHash: H("turnover"),
      turnoverWindowOpenPortfolioNetWorthKrw: 1000, priorBucketTurnoverNotionalKrw: 0,
      requestedBucketTurnoverNotionalKrw: amount, resultingBucketTurnoverRatio: amount / 1000 },
    priorCumulativeFilledNotionalKrw: 0, priorCumulativeFilledQuantity: 0, requestedNotionalKrw: amount, requestedQuantity: quantity,
    worstCaseFillNotionalKrw: amount, approvedMaximumFillNotionalKrw: amount,
    cashAssessment: side === "BUY" ? { side, worstCaseNetCashDebitKrw: amount, approvedMaximumNetCashDebitKrw: amount }
      : { side, expectedMinimumNetCashCreditKrw: amount },
    decision: "approved", requiredRuleIds: ["cash"], ruleResults: [{ ruleId: "cash", result: "pass", reasonCode: "synthetic" }],
    riskEvidenceRefs: [price.evidenceRef], decidedAt: at(31), ...tweaks.risk }));
  const executionPolicy = { modelVersion: PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price" as const,
    slippageBps: 0, feeBps: 0, taxBps: 0, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: !kind.startsWith("whole"),
    maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 };
  const fill = buildPaperFill({ action: side === "BUY" ? "VIRTUAL_BUY" : "VIRTUAL_SELL", targetNotionalKrw: amount,
    sourcePriceKrw: 100, liquidityStale: false, policy: executionPolicy });
  const fillInput: Parameters<PaperFillExecutionFileRepository["createAndAppendWithRiskOrigin"]>[0] = {
    portfolioId: plan.portfolioId, rebalancePlanId: plan.planId, rebalanceActionId: "synthetic-action", fillId: "synthetic-fill",
    market: "KR", symbol: "SYNTH", side, requestedNotionalKrw: amount, requestedQuantity: quantity, quantityOverride: null,
    sourcePriceKrw: 100, sourcePriceEvidence: { sourceContractId: price.sourceContractId, evidenceRef: price.evidenceRef,
      evidenceHash: price.evidenceHash, market: price.market, symbol: price.symbol, priceField: price.priceField, observedAt: price.observedAt },
    averagePriceKrw: null, fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity, filledNotionalKrw: fill.filledNotionalKrw,
    grossAmountKrw: fill.grossAmountKrw, netAmountKrw: fill.netAmountKrw, participationRate: null, volume: null, averageVolume: null,
    liquidityStale: false, fillStatus: "filled", liquidityStatus: "not_modeled", liquidityRejectReason: null,
    fractionalShares: fill.fractionalShares, executionPolicy,
    costBreakdown: { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw,
      spreadCostKrw: fill.spreadCostKrw, impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw }, evidenceRefs: [price.evidenceRef] };
  context.mock.timers.setTime(T + 35);
  const paperFill = tweaks.unbound ? await fills.append(createPaperFillExecutionRecord({ ...fillInput, asOf: at(35), createdAt: at(35) }))
    : tweaks.completion ? await fills.createAndAppendWithRiskCompletion(fillInput, await risks.readVerifiedHistory(), risk.riskDecisionId)
      : await fills.createAndAppendWithRiskOrigin(fillInput, await risks.readVerifiedHistory(), risk.riskDecisionId);
  context.mock.timers.setTime(T + 40);
  const lastEvent = await events.append(event(plan, "execution_applied", approved, 40, { actionId: "synthetic-action", actionSequence: 0, fillSequence: 0,
    fillId: paperFill.fillId, paperFillRecordId: paperFill.paperFillRecordId, paperFillHash: paperFill.paperFillHash, riskDecisionId: risk.riskDecisionId,
    requestedNotionalKrw: amount, requestedQuantity: quantity, filledNotionalKrw: amount, filledQuantity: quantity,
    cumulativeFilledNotionalKrw: amount, cumulativeFilledQuantity: quantity,
    expectedPrePortfolioVersion: plan.portfolioVersion, expectedPrePortfolioSnapshotHash: plan.portfolioSnapshotHash,
    resultingPortfolioVersion: "synthetic-v2", resultingPortfolioSnapshotHash: H("v2") }));
  context.mock.timers.setTime(T + 45);
  if (bound !== null) await capacity.append(createOpeningCapacityReservationEvent({ eventType: "consumed_by_position",
    portfolioId: bound.portfolioId, policyHash: bound.policyHash, bucket: bound.bucket,
    reservationId: bound.reservationId, reservationHash: bound.reservationHash,
    previousCapacityReservationEventId: bound.capacityReservationEventId, capacityLedgerVersion: 3,
    remainingReservedNotionalKrw: 400 - paperFill.grossAmountKrw, occupiesNewPositionSlot: false,
    mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, fillId: paperFill.fillId,
    paperFillRecordId: paperFill.paperFillRecordId, paperFillHash: paperFill.paperFillHash,
    resultingPositionRef: "synthetic-unverified-position", asOf: at(45), createdAt: at(45) }));
  const common = { planId: plan.planId, planHash: plan.planHash, planEventId: lastEvent.planEventId, planEventHash: lastEvent.planEventHash,
    actionId: "synthetic-action", actionExecutionTargetHash: hashRebalanceExecutionTarget(target), market: "KR" as const, symbol: "SYNTH", asOf: at(50),
    remainingNotionalKrw: kind === "fractional_buy" ? 60 : kind === "fractional_sell" ? 20 : 200 };
  const pending: PendingPortfolioActionInput = side === "BUY" ? { ...common, side,
    openingCapacityReservationId: opening?.root.reservationId ?? "synthetic-unverified", openingCapacityReservationHash: opening?.root.reservationHash ?? H("reservation") }
    : { ...common, side, remainingQuantity: kind === "fractional_sell" ? 0.2 : 2, priceEvidenceRef: price.evidenceRef };
  context.mock.timers.setTime(T + 100);
  const records = createPortfolioSizingSnapshotPaths(baseDir).recordsPath;
  const initialSnapshotBytes = await readSnapshotBytes(records);
  return { baseDir, portfolioPath, policy, plans, events, plan, lastEvent, pending, prices, price, risks, fills, risk, paperFill, mandates, mandate, activation,
    opening, bound, capacity, initialSnapshotBytes, initialSnapshotCount: opening === null ? 0 : 1,
    records: createPortfolioSizingSnapshotPaths(baseDir).recordsPath, snapshots: new PortfolioSizingSnapshotFileRepository(baseDir, options) };
}
export async function readSnapshotBytes(path: string): Promise<Buffer | null> {
  try { return await fs.readFile(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export function request(state: State, pending: readonly PendingPortfolioActionInput[] = [state.pending], offset = 50) {
  const pendingActionInputs = canonicalizePendingPortfolioActionInputs(pending);
  return { baseDir: state.baseDir, portfolioPath: state.portfolioPath, policyHash: state.policy.policy.policyHash, asOf: at(offset),
    valuationInputs: [{ kind: "mark_price" as const, market: "KR" as const, symbol: "SYNTH", priceKrw: 100,
      evidenceRef: state.price.evidenceRef, evidenceAsOf: state.price.observedAt }], pendingActionInputs: [...pendingActionInputs],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 2000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 1000 },
      symbolExposureKrw: [{ market: "KR", symbol: "SYNTH", exposureKrw: 1000 }], marketExposureKrw: { KR: 1000, US: 0 },
      sectorExposureKrw: { Synthetic: 1000 }, countryExposureKrw: { KR: 1000 }, currencyExposureKrw: { KRW: 1000 }, ...pendingActionExposureTotals(pendingActionInputs) }) };
}
export function event(plan: RebalancePlanRecord, eventType: RebalancePlanEvent["eventType"], previous: RebalancePlanEvent | undefined,
  offset: number, extra: Record<string, unknown> = {}) {
  return createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId, portfolioId: plan.portfolioId,
    portfolioVersion: plan.portfolioVersion, portfolioSnapshotHash: plan.portfolioSnapshotHash, policyHash: plan.policyHash, asOf: at(offset), eventType,
    ...(previous === undefined ? {} : { previousPlanEventId: previous.planEventId }), ...(["approved", "rejected"].includes(eventType) ? { reasonCodes: ["synthetic"] } : {}),
    ...extra } as Parameters<typeof createRebalancePlanEvent>[0]);
}
export async function fixture(context: TestContext, kind: Kind, operation: (state: State) => Promise<void>, tweaks: Tweaks = {}) {
  const baseDir = await fs.mkdtemp(join(tmpdir(), "current-sizing-pending-"));
  context.mock.timers.enable({ apis: ["Date"], now: T + 10 });
  try { await operation(await seed(baseDir, kind, context, tweaks)); }
  finally { context.mock.timers.reset(); await fs.rm(baseDir, { recursive: true, force: true }); }
}
