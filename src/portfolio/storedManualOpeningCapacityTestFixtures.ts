import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext } from "node:test";
import { PAPER_EXECUTION_MODEL_VERSION } from "../paper/costModel.js";
import { buildPaperFill } from "../paper/executionModel.js";
import { createInvestmentMandateEvent, createInvestmentMandateRecord, createManualAssignmentEvent } from "./investmentMandate.js";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation } from "./investmentMandateFiles.js";
import { ManualAssignmentFileRepository } from "./manualAssignmentFiles.js";
import { createManualOpeningCapacityReservationRecord } from "./manualOpeningCapacityReservation.js";
import { ManualOpeningCapacityReservationFileRepository } from "./manualOpeningCapacityReservationFiles.js";
import { createOpeningCapacityReservationEvent, type OpeningCapacityReservationEvent } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository } from "./openingCapacityReservationEventFiles.js";
import { createPaperFillExecutionRecord } from "./paperFillExecution.js";
import { PaperFillExecutionFileRepository } from "./paperFillExecutionFiles.js";
import { createPortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { PortfolioActionRiskDecisionFileRepository, createPortfolioActionRiskDecisionPaths } from "./portfolioActionRiskDecisionFiles.js";
import { readStoredRiskDecisionPlanContext } from "./portfolioActionRiskDecisionPlanContext.js";
import { createPortfolioSizingSnapshot } from "./portfolioSizingSnapshot.js";
import { PortfolioSizingSnapshotFileRepository } from "./portfolioSizingSnapshotFiles.js";
import { createPortfolioExposureSnapshot } from "./portfolioExposureSnapshot.js";
import { createRebalancePlanRecord, hashRebalanceExecutionTarget } from "./rebalancePlan.js";
import { createRebalancePlanEvent, type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository } from "./rebalancePlanEventFiles.js";
import { createSourcePriceEvidenceRecord } from "./sourcePriceEvidence.js";
import { SourcePriceEvidenceFileRepository } from "./sourcePriceEvidenceFiles.js";
import { resolveStoredManualOpeningCapacityFillOrigins } from "./storedManualOpeningCapacityFillOrigins.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";

export const HASH = `sha256:${"a".repeat(64)}`;
export const OTHER = `sha256:${"b".repeat(64)}`;
export const AT = "2026-09-01T00:00:00.000Z";
export const START = Date.parse(AT);
export const PORTFOLIO = "paper-portfolio";
export const at = (ms: number) => new Date(START + ms).toISOString();
export const stateHash = (version: number) => version === 1 ? HASH : hashCanonicalPayload({ syntheticPortfolioVersion: version });
export interface Options { increase?: boolean; count?: number; unbound?: boolean; wrongMandate?: boolean; wrongRiskBucket?: boolean;
  wrongRiskTarget?: boolean; wrongDelta?: boolean; earlyCapacity?: boolean; feeBps?: number;
  mandateState?: "proposed" | "review_required" | "retired" | "late_activation";
  receipt?: "valid" | "wrong_mandate" | "wrong_event" | "wrong_prefix" | "wrong_plan" }

function snapshot(policyHash = HASH) {
  return createPortfolioSizingSnapshot({ portfolioId: PORTFOLIO, portfolioVersion: "v1", policyHash, asOf: AT,
    virtualPortfolio: { portfolioId: PORTFOLIO, cashKrw: 1000, positions: [], updatedAt: AT }, valuationInputs: [], pendingActionInputs: [],
    ...createPortfolioExposureSnapshot({ virtualNetWorthKrw: 1000, cashKrw: 1000,
      bucketExposureKrw: { hedge: 0, intraday: 0, long_term: 0, short_term: 0, swing: 0 }, symbolExposureKrw: [],
      marketExposureKrw: { KR: 0, US: 0 }, sectorExposureKrw: {}, countryExposureKrw: {}, currencyExposureKrw: {},
      pendingBuyExposureKrw: 0, pendingSellExposureKrw: 0 }) });
}
function manual(id = "one", policyHash = HASH) {
  const origin = snapshot(policyHash);
  return createManualAssignmentEvent({ portfolioId: PORTFOLIO, policyHash, market: "KR", symbol: "005930", bucket: "intraday",
    asOf: AT, selectionPolicyRecordId: "selection", selectionPolicyHash: HASH, reasonCodes: ["manual"], evidenceRefs: ["evidence"],
    evidenceAsOf: AT, evidenceValidationHash: HASH, authorizationRef: id, createdAt: AT,
    authorizationScope: "open_or_increase", evidenceEligibility: "eligible", portfolioSnapshotId: origin.portfolioSnapshotId,
    portfolioSnapshotHash: origin.portfolioSnapshotHash, sizingInputRecordId: "sizing", minWeightRatio: 0, targetWeightRatio: 0.1,
    maxWeightRatio: 0.2, maximumNotionalKrw: 1000, sizingInputHash: HASH, sizingOutputHash: HASH });
}
function reservation(id = "one", increase = false, policyHash = HASH, version = 1) {
  const source = manual(id, policyHash), current = snapshot(policyHash);
  const common = { manualAssignmentEventId: source.manualAssignmentEventId, manualAssignmentEventHash: source.manualAssignmentEventHash,
    portfolioId: source.portfolioId, policyHash, bucket: source.bucket, market: source.market, symbol: source.symbol,
    currentPortfolioSnapshotId: current.portfolioSnapshotId, currentPortfolioSnapshotHash: current.portfolioSnapshotHash,
    capacityLedgerVersion: version, reservedMaximumNotionalKrw: 100, resultingReservedNotionalKrw: increase ? 200 : 100,
    authorizationRef: id, createdAt: AT };
  return createManualOpeningCapacityReservationRecord(increase ? { ...common, reservationKind: "increase_existing", existingPositionRef: "position" }
    : { ...common, reservationKind: "new_position", reservedSlotOrdinal: 0 });
}
function event(record: ReturnType<typeof reservation>) {
  return createOpeningCapacityReservationEvent({ eventType: "reserved", portfolioId: record.portfolioId, policyHash: record.policyHash,
    bucket: record.bucket, reservationId: record.manualCapacityReservationId, reservationHash: record.manualCapacityReservationHash,
    reservationSource: { sourceKind: "manual", manualCapacityReservationId: record.manualCapacityReservationId, manualCapacityReservationHash: record.manualCapacityReservationHash },
    capacityLedgerVersion: record.capacityLedgerVersion, remainingReservedNotionalKrw: record.reservedMaximumNotionalKrw,
    occupiesNewPositionSlot: record.reservationKind === "new_position", asOf: new Date().toISOString(), createdAt: new Date().toISOString() });
}
async function storeReservation(dir: string, record: ReturnType<typeof reservation>, source: ReturnType<typeof manual>) {
  await new ManualAssignmentFileRepository(dir).append(source);
  await new PortfolioSizingSnapshotFileRepository(dir).append(snapshot(record.policyHash));
  return new ManualOpeningCapacityReservationFileRepository(dir).append(record);
}

function openingMandate(record: ReturnType<typeof reservation>, source: ReturnType<typeof manual>, patch: Record<string, unknown> = {}) {
  if (source.authorizationScope !== "open_or_increase") throw new Error("fixture requires opening authorization");
  return createInvestmentMandateRecord({ portfolioId: source.portfolioId, policyHash: source.policyHash,
    bucket: source.bucket, market: source.market, symbol: source.symbol, asOf: source.asOf, evidenceAsOf: source.evidenceAsOf,
    reasonCodes: source.reasonCodes, evidenceRefs: source.evidenceRefs, minWeightRatio: source.minWeightRatio,
    targetWeightRatio: source.targetWeightRatio, maxWeightRatio: source.maxWeightRatio,
    maximumOpeningNotionalKrw: record.reservedMaximumNotionalKrw, reviewCadence: { mode: "every_tick" }, validFrom: source.asOf,
    assignmentSource: "manual_policy", manualAuthorizationScope: "open_or_increase", manualAssignmentEventId: source.manualAssignmentEventId,
    capacityReservation: { manualCapacityReservationId: record.manualCapacityReservationId, manualCapacityReservationHash: record.manualCapacityReservationHash,
      reservedMaximumNotionalKrw: record.reservedMaximumNotionalKrw, ...(record.reservationKind === "new_position"
        ? { reservationKind: record.reservationKind, reservedSlotOrdinal: record.reservedSlotOrdinal }
        : { reservationKind: record.reservationKind, existingPositionRef: record.existingPositionRef }) },
    createdAt: new Date().toISOString(), ...patch } as Parameters<typeof createInvestmentMandateRecord>[0]) as
      Extract<ReturnType<typeof createInvestmentMandateRecord>, { assignmentSource: "manual_policy"; manualAuthorizationScope: "open_or_increase" }>;
}
function bound(root: OpeningCapacityReservationEvent, mandate: ReturnType<typeof openingMandate>, patch: Record<string, unknown> = {}) {
  return createOpeningCapacityReservationEvent({ eventType: "bound_to_mandate", portfolioId: root.portfolioId, policyHash: root.policyHash,
    bucket: root.bucket, reservationId: root.reservationId, reservationHash: root.reservationHash,
    previousCapacityReservationEventId: root.capacityReservationEventId, capacityLedgerVersion: 2,
    remainingReservedNotionalKrw: root.remainingReservedNotionalKrw, occupiesNewPositionSlot: root.occupiesNewPositionSlot,
    mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, asOf: new Date().toISOString(), createdAt: new Date().toISOString(),
    ...patch } as Parameters<typeof createOpeningCapacityReservationEvent>[0]);
}
async function seedManual(dir: string, move: (ms: number) => void, increase = false, policyHash = HASH, id = "one") {
  move(10);
  const record = reservation(id, increase, policyHash), source = manual(id, policyHash);
  await storeReservation(dir, record, source);
  move(20);
  const root = event(record);
  await new OpeningCapacityReservationEventFileRepository(dir).append(root);
  move(30);
  const mandate = openingMandate(record, source);
  await new InvestmentMandateFileRepository(dir).appendRecord(mandate);
  move(40);
  const binding = bound(root, mandate);
  await new OpeningCapacityReservationEventFileRepository(dir).append(binding);
  return { record, source, root, mandate, bound: binding };
}

async function seed(dir: string, context: TestContext, options: Options) {
  const move = (ms: number) => context.mock.timers.setTime(START + ms);
  const manual = await seedManual(dir, move, options.increase ?? false);
  if (options.mandateState !== "proposed") {
    const ms = options.mandateState === "late_activation" ? 84 : 41;
    move(ms);
    const activated = mandateEvent(manual.mandate, "activated", ms);
    await new InvestmentMandateFileRepository(dir).appendEvent(activated);
    if (options.mandateState === "retired" || options.mandateState === "review_required") {
      move(42);
      await new InvestmentMandateFileRepository(dir).appendEvent(mandateEvent(manual.mandate, options.mandateState, 42, activated.mandateEventId));
    }
  }
  move(50);
  const price = await new SourcePriceEvidenceFileRepository(dir).append(createSourcePriceEvidenceRecord({
    sourceContractId: "synthetic", market: "KR", symbol: "005930", priceField: "last_price", priceKrw: 100,
    observedAt: at(45), createdAt: at(45), sourceRefs: ["synthetic"]
  }));
  const target = { targetKind: "fractional_buy_notional" as const, targetNotionalKrw: 100 };
  const plans = new RebalancePlanFileRepository(dir);
  move(60);
  const plan = await plans.append(createRebalancePlanRecord({ cycleId: "cycle", portfolioId: PORTFOLIO, portfolioVersion: "v1",
    portfolioSnapshotHash: HASH, policyHash: HASH, evidenceCutoffAt: at(55), createdAt: at(60), triggerRef: "synthetic", phase: "buy",
    actions: [{ actionId: "action", actionSequence: 0, market: "KR", symbol: "005930", lineageKind: "mandate", side: "BUY",
      mandateId: options.wrongMandate ? "unrelated" : manual.mandate.mandateId, executionTarget: target, maximumNotionalKrw: 100, reasonCodes: ["synthetic"] }]
  }));
  const events = new RebalancePlanEventFileRepository(dir, plans);
  const appendPlanEvent = async (type: RebalancePlanEvent["eventType"], ms: number, previous?: RebalancePlanEvent, extra = {}) => {
    move(ms);
    return events.append(createRebalancePlanEvent({ planId: plan.planId, planHash: plan.planHash, cycleId: plan.cycleId,
      portfolioId: PORTFOLIO, portfolioVersion: "v1", portfolioSnapshotHash: HASH, policyHash: HASH, asOf: at(ms), eventType: type,
      ...(previous ? { previousPlanEventId: previous.planEventId } : {}), ...(type === "approved" ? { reasonCodes: ["synthetic"] } : {}), ...extra
    } as Parameters<typeof createRebalancePlanEvent>[0]));
  };
  let last = await appendPlanEvent("approved", 80, await appendPlanEvent("previewed", 70));
  const risks = new PortfolioActionRiskDecisionFileRepository(dir), fills = new PaperFillExecutionFileRepository(dir);
  const capacity: OpeningCapacityReservationEvent[] = [];
  let remaining = 100, cumulative = 0, priorCapacity = manual.bound;
  for (let n = 0; n < (options.count ?? 1); n++) {
    const amount = n === 0 ? 40 : 30, feeBps = options.feeBps ?? 0;
    const policy = { modelVersion: PAPER_EXECUTION_MODEL_VERSION as typeof PAPER_EXECUTION_MODEL_VERSION, fillPriceRule: "current_candidate_last_price" as const,
      slippageBps: 0, feeBps, taxBps: 0, halfSpreadBps: 0, fillRatio: 1, allowFractionalShares: true,
      maxVolumeParticipationRate: 0.1, minLiquidityFillRatio: 0.1, rejectStaleLiquidity: true, marketImpactBpsPerParticipationRate: 0 };
    const fill = buildPaperFill({ action: "VIRTUAL_BUY", targetNotionalKrw: amount, sourcePriceKrw: 100, liquidityStale: false, policy });
    move(81 + n * 30);
    const receipt = options.receipt ? {
      planOrigin: (await readStoredRiskDecisionPlanContext({ baseDir: dir, planId: plan.planId })).origin,
      mandateOrigin: await new InvestmentMandateFileRepository(dir).withDurableVerifiedHistory(async (history) => ({
        mandateId: manual.mandate.mandateId, mandateHash: manual.mandate.mandateHash,
        mandateEventId: history.events[0]!.mandateEventId, mandateEventHash: history.events[0]!.mandateEventHash,
        observation: getDurableInvestmentMandateObservation(history)
      }))
    } : undefined;
    move(82 + n * 30);
    const risk = await risks.append(createPortfolioActionRiskDecision({
      riskRuleSetRecordId: "rules", riskRuleSetVersion: "v1", riskRuleSetHash: HASH, planId: plan.planId, actionId: "action",
      portfolioId: PORTFOLIO, policyHash: HASH, expectedPortfolioVersion: `v${n + 1}`, expectedPortfolioSnapshotHash: stateHash(n + 1),
      market: "KR", symbol: "005930", side: "BUY", actionExecutionTargetHash: options.wrongRiskTarget ? OTHER : hashRebalanceExecutionTarget(target),
      riskRuleScope: { scopeKind: "bucket", bucket: options.wrongRiskBucket ? "swing" : "intraday" },
      turnoverAssessment: { scopeKind: "bucket", turnoverStateId: "turnover", turnoverStateHash: HASH, turnoverWindowOpenPortfolioNetWorthKrw: 1000,
        priorBucketTurnoverNotionalKrw: cumulative, requestedBucketTurnoverNotionalKrw: amount, resultingBucketTurnoverRatio: (cumulative + amount) / 1000 },
      priorCumulativeFilledNotionalKrw: cumulative, priorCumulativeFilledQuantity: cumulative / 100,
      requestedNotionalKrw: amount, requestedQuantity: amount / 100, worstCaseFillNotionalKrw: amount, approvedMaximumFillNotionalKrw: amount,
      cashAssessment: { side: "BUY", worstCaseNetCashDebitKrw: fill.netAmountKrw, approvedMaximumNetCashDebitKrw: fill.netAmountKrw },
      decision: "approved", requiredRuleIds: ["cash"], ruleResults: [{ ruleId: "cash", result: "pass", reasonCode: "synthetic" }],
      riskEvidenceRefs: [price.evidenceRef], decidedAt: at(81 + n * 30)
    }));
    if (receipt) {
      // Synthetic receipt bytes: preserve the actual decision and commit chronology, independently rehash the envelope.
      const path = createPortfolioActionRiskDecisionPaths(dir).recordsPath;
      const rows = (await readFile(path, "utf8")).trimEnd().split("\n");
      const { entryHash: _entryHash, ...prior } = JSON.parse(rows.at(-2)!);
      const { commitHash: _commitHash, ...marker } = JSON.parse(rows.at(-1)!);
      const payload = { ...prior, schemaVersion: "portfolio_action_risk_decision_entry.v5",
        policyOrigin: { activationId: "synthetic", activationEventHash: HASH, runtimePolicyRecordId: "synthetic", policyHash: HASH,
          policyLineageHash: HASH, observedAt: at(81 + n * 30), activationHistory: { eventCount: 1, eventsHash: HASH } },
        planOrigin: { ...receipt.planOrigin, ...(options.receipt === "wrong_plan" ? { predecessorCommitHash: OTHER } : {}) },
        mandateOrigin: { ...receipt.mandateOrigin, ...(options.receipt === "wrong_mandate" ? { mandateHash: OTHER } : {}),
          ...(options.receipt === "wrong_event" ? { mandateEventHash: OTHER } : {}),
          observation: { ...receipt.mandateOrigin.observation, ...(options.receipt === "wrong_prefix" ? { eventsHash: OTHER } : {}) } } };
      const entryHash = hashCanonicalPayload(payload), nextMarker = { ...marker, entryHash };
      rows.splice(-2, 2, JSON.stringify({ ...payload, entryHash }), JSON.stringify({ ...nextMarker, commitHash: hashCanonicalPayload(nextMarker) }));
      await writeFile(path, rows.join("\n") + "\n");
    }
    move(85 + n * 30);
    const input: Parameters<PaperFillExecutionFileRepository["createAndAppendWithRiskOrigin"]>[0] = {
      portfolioId: PORTFOLIO, rebalancePlanId: plan.planId, rebalanceActionId: "action", fillId: `fill-${n}`,
      market: "KR", symbol: "005930", side: "BUY", requestedNotionalKrw: amount, requestedQuantity: amount / 100, quantityOverride: null,
      sourcePriceKrw: 100, sourcePriceEvidence: { sourceContractId: price.sourceContractId, evidenceRef: price.evidenceRef,
        evidenceHash: price.evidenceHash, market: price.market, symbol: price.symbol, priceField: price.priceField, observedAt: price.observedAt },
      averagePriceKrw: null, fillPriceKrw: fill.fillPriceKrw, quantity: fill.quantity, filledNotionalKrw: fill.filledNotionalKrw,
      grossAmountKrw: fill.grossAmountKrw, netAmountKrw: fill.netAmountKrw, participationRate: null, volume: null, averageVolume: null,
      liquidityStale: false, fillStatus: "filled", liquidityStatus: "not_modeled", liquidityRejectReason: null,
      fractionalShares: fill.fractionalShares, executionPolicy: policy,
      costBreakdown: { feeKrw: fill.feeKrw, taxKrw: fill.taxKrw, slippageKrw: fill.slippageKrw, spreadCostKrw: fill.spreadCostKrw,
        impactCostKrw: fill.impactCostKrw, totalCostKrw: fill.totalCostKrw }, evidenceRefs: [price.evidenceRef]
    };
    const record = options.unbound ? await fills.append(createPaperFillExecutionRecord({ ...input, asOf: at(85 + n * 30), createdAt: at(85 + n * 30) }))
      : await fills.createAndAppendWithRiskOrigin(input, await risks.readVerifiedHistory(), risk.riskDecisionId);
    cumulative += amount;
    last = await appendPlanEvent("execution_applied", 90 + n * 30, last, { actionId: "action", actionSequence: 0, fillSequence: n,
      fillId: record.fillId, paperFillRecordId: record.paperFillRecordId, paperFillHash: record.paperFillHash, riskDecisionId: risk.riskDecisionId,
      requestedNotionalKrw: amount, requestedQuantity: amount / 100, filledNotionalKrw: amount, filledQuantity: amount / 100,
      cumulativeFilledNotionalKrw: cumulative, cumulativeFilledQuantity: cumulative / 100, expectedPrePortfolioVersion: `v${n + 1}`,
      expectedPrePortfolioSnapshotHash: stateHash(n + 1), resultingPortfolioVersion: `v${n + 2}`, resultingPortfolioSnapshotHash: stateHash(n + 2) });
    move(95 + n * 30);
    remaining -= amount + (options.wrongDelta ? 1 : 0);
    const common = { portfolioId: PORTFOLIO, policyHash: HASH, bucket: "intraday" as const, reservationId: priorCapacity.reservationId,
      reservationHash: priorCapacity.reservationHash, previousCapacityReservationEventId: priorCapacity.capacityReservationEventId,
      capacityLedgerVersion: 3 + n, remainingReservedNotionalKrw: remaining, occupiesNewPositionSlot: false as const,
      mandateId: manual.mandate.mandateId, mandateHash: manual.mandate.mandateHash,
      fillId: record.fillId, paperFillRecordId: record.paperFillRecordId, paperFillHash: record.paperFillHash,
      asOf: at((options.earlyCapacity ? 90 : 95) + n * 30), createdAt: at(95 + n * 30) };
    const consumption = createOpeningCapacityReservationEvent((n === 0 && !options.increase) || remaining === 0
      ? { ...common, eventType: "consumed_by_position", resultingPositionRef: "unverified-position" }
      : { ...common, eventType: "partially_consumed" });
    priorCapacity = await new OpeningCapacityReservationEventFileRepository(dir).append(consumption).then((origin) => origin.event);
    capacity.push(consumption);
  }
  return { dir, manual, plan, capacity };
}
export type State = Awaited<ReturnType<typeof seed>>;
export function mandateEvent(mandate: ReturnType<typeof openingMandate>, eventType: "activated" | "retired" | "review_required", ms: number, previousMandateEventId?: string) {
  return createInvestmentMandateEvent({ mandateId: mandate.mandateId, mandateHash: mandate.mandateHash, portfolioId: mandate.portfolioId,
    policyHash: mandate.policyHash, bucket: mandate.bucket, market: mandate.market, symbol: mandate.symbol, eventType,
    asOf: at(ms), createdAt: at(ms), reasonCodes: ["synthetic"], ...(previousMandateEventId ? { previousMandateEventId } : {}) } as Parameters<typeof createInvestmentMandateEvent>[0]);
}
export function run(state: State) { return resolveStoredManualOpeningCapacityFillOrigins({ baseDir: state.dir, portfolioId: PORTFOLIO }); }
export async function fixture(context: TestContext, options: Options, operation: (state: State) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "stored-manual-capacity-fills-"));
  context.mock.timers.enable({ apis: ["Date"], now: START });
  try { await operation(await seed(dir, context, options)); }
  finally { context.mock.timers.reset(); await rm(dir, { recursive: true, force: true }); }
}
