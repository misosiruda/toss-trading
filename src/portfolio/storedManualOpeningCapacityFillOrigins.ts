import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { InvestmentMandateFileRepository, getDurableInvestmentMandateObservation, resolveObservedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { openingCapacityReservationEventPayloadSchema } from "./openingCapacityReservationEvent.js";
import { OpeningCapacityReservationEventFileRepository, getDurableOpeningCapacityEventObservedAt,
  resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { PaperFillExecutionFileRepository, resolvePersistedPaperFillExecutionOrigin } from "./paperFillExecutionFiles.js";
import { PortfolioActionRiskDecisionFileRepository, resolveVerifiedPortfolioActionRiskDecisionOrigin } from "./portfolioActionRiskDecisionFiles.js";
import { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { riskDecisionMandateIdentity, validateRiskDecisionMandateState } from "./portfolioActionRiskDecisionMandateContext.js";
import { type RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { RebalancePlanEventFileRepository, resolveDurableRebalancePlanEventObservation, resolveDurableRebalancePlanEventObservedAt,
  resolveVerifiedRebalancePlanEventOrigin } from "./rebalancePlanEventFiles.js";
import { replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { RebalancePlanFileRepository, type RebalancePlanFileRepositoryOptions } from "./rebalancePlanFiles.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { SourcePriceEvidenceFileRepository, getDurableSourcePriceEvidenceObservation,
  resolveVerifiedSourcePriceEvidenceOrigin } from "./sourcePriceEvidenceFiles.js";
import { resolveStoredManualOpeningCapacityMandateOrigins } from "./storedManualOpeningCapacityMandateOrigins.js";

const inputSchema = z.object({ baseDir: z.string().min(1),
  portfolioId: openingCapacityReservationEventPayloadSchema.options[0].shape.portfolioId }).strict();

/** Actual manual reservation consumption amounts and fill/Risk/plan origins; not resulting-position or current allocation authority. */
export async function resolveStoredManualOpeningCapacityFillOrigins(value: z.input<typeof inputSchema>,
  options: RebalancePlanFileRepositoryOptions = {}) {
  const input = inputSchema.parse(value);
  if (!isDeepStrictEqual(input, value)) throw new Error("manual capacity fill input must already be canonical");
  const baseDir = resolve(input.baseDir), lockOptions = { ...options };
  const mandates = await resolveStoredManualOpeningCapacityMandateOrigins({ baseDir, portfolioId: input.portfolioId }, lockOptions);
  const planHistory = await new RebalancePlanEventFileRepository(baseDir, new RebalancePlanFileRepository(baseDir, lockOptions), lockOptions).readDurableVerifiedHistory();
  const planObservedAt = resolveDurableRebalancePlanEventObservedAt(planHistory);
  if (Date.parse(planObservedAt) < Date.parse(mandates.assessment.eventObservedAt)) throw new Error("capacity fill plan observation clock moved backwards");
  const groups = new Map<string, RebalancePlanEvent[]>();
  for (const event of planHistory.events) if (event.portfolioId === input.portfolioId) {
    const group = groups.get(event.planId) ?? []; group.push(event); groups.set(event.planId, group);
  }
  const executions = [...groups].flatMap(([planId, events]) => {
    const planOrigin = resolveDurableRebalancePlanEventObservation(planHistory, planId).plan;
    return replayRebalancePlanExecutionContexts({ plan: planOrigin.record, events }).executionContexts.map((context) =>
      ({ ...context, planOrigin, predecessorOrigin: resolveVerifiedRebalancePlanEventOrigin(planHistory, events[context.eventIndex - 1]!.planEventId) }));
  });
  const byPaperFill = new Map(executions.map((execution) => [execution.event.paperFillRecordId, execution]));
  if (byPaperFill.size !== executions.length) throw new Error("capacity fill is referenced by multiple plan executions");
  const byReservation = new Map(mandates.bindings.map((binding) => [reservationScope(binding.event), binding]));
  const riskDecisionHistory = await new PortfolioActionRiskDecisionFileRepository(baseDir, lockOptions).readVerifiedHistory();
  const paperFillHistory = await new PaperFillExecutionFileRepository(baseDir, lockOptions).readVerifiedHistory();
  return new SourcePriceEvidenceFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (sourcePriceEvidenceHistory) => {
    const priceObservation = getDurableSourcePriceEvidenceObservation(sourcePriceEvidenceHistory);
    return new InvestmentMandateFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (mandateHistory) => {
    const mandateObservation = getDurableInvestmentMandateObservation(mandateHistory);
    return new OpeningCapacityReservationEventFileRepository(baseDir, lockOptions).withDurableVerifiedHistory(async (history) => {
      const observedAt = getDurableOpeningCapacityEventObservedAt(history);
      if (history.generationHash !== mandates.assessment.eventGenerationHash) throw new Error("capacity event generation changed during fill resolution");
      if (Date.parse(priceObservation.observedAt) < Date.parse(planObservedAt) || Date.parse(mandateObservation.observedAt) < Date.parse(priceObservation.observedAt) ||
        Date.parse(observedAt) < Date.parse(mandateObservation.observedAt) || Date.now() < Date.parse(observedAt)) {
        throw new Error("capacity fill observation clock moved backwards");
      }
      const verifiedIds = new Set([...mandates.manualRoots.bindings.map((binding) => binding.event.capacityReservationEventId),
        ...mandates.bindings.map((binding) => binding.event.capacityReservationEventId)]);
      const selected = history.events.filter((event) => event.portfolioId === input.portfolioId);
      const usedFills = new Set<string>(), usedRisk = new Set<string>();
      const bindings = selected.filter((event) => (event.eventType === "partially_consumed" || event.eventType === "consumed_by_position") &&
        byReservation.has(reservationScope(event))).map((event) => {
        if (event.eventType !== "partially_consumed" && event.eventType !== "consumed_by_position") throw new Error("capacity consumption event is invalid");
        const mandateBinding = byReservation.get(reservationScope(event))!;
        const execution = byPaperFill.get(event.paperFillRecordId);
        if (!execution) throw new Error("capacity consumption has no actual plan execution source");
        const binding = validateRebalancePlanExecutionFillRiskBinding({ event: execution.event, riskDecisionHistory, paperFillHistory, sourcePriceEvidenceHistory });
        const fill = binding.paperFill, risk = binding.riskDecision;
        const planState = validateRiskDecisionPlanState(risk, execution.priorState);
        const action = execution.planOrigin.record.actions[execution.event.actionSequence]!;
        if (action.lineageKind !== "mandate" || action.mandateId !== mandateBinding.mandate.mandateId || action.side !== "BUY" ||
          event.paperFillHash !== fill.paperFillHash || event.fillId !== fill.fillId || fill.portfolioId !== input.portfolioId || fill.side !== "BUY" ||
          fill.market !== mandateBinding.mandate.market || fill.symbol !== mandateBinding.mandate.symbol || risk.policyHash !== event.policyHash ||
          risk.riskRuleScope.scopeKind !== "bucket" || risk.riskRuleScope.bucket !== event.bucket) {
          throw new Error("capacity consumption fill scope or mandate lineage mismatch");
        }
        const predecessorOrigin = resolveStoredOpeningCapacityEventOrigin(history, event.previousCapacityReservationEventId);
        const consumedNotionalKrw = predecessorOrigin.event.remainingReservedNotionalKrw - event.remainingReservedNotionalKrw;
        if (consumedNotionalKrw !== fill.filledNotionalKrw) throw new Error("capacity consumption differs from actual filled notional");
        const riskOrigin = resolveVerifiedPortfolioActionRiskDecisionOrigin(riskDecisionHistory, risk.riskDecisionId);
        const mandateState = validateRiskDecisionMandateState(planState, riskOrigin.mandateOrigin === null ? mandateHistory
          : resolveObservedInvestmentMandateHistory(mandateHistory, riskOrigin.mandateOrigin.observation));
        if (!isDeepStrictEqual(mandateState.record, mandateBinding.mandate)) throw new Error("capacity consumption Risk mandate source mismatch");
        if (riskOrigin.mandateOrigin !== null) {
          const { observation, ...identity } = riskOrigin.mandateOrigin;
          if (!isDeepStrictEqual(identity, riskDecisionMandateIdentity(mandateState)) || Date.parse(observation.observedAt) > Date.parse(risk.decidedAt)) {
            throw new Error("capacity consumption Risk mandate receipt mismatch");
          }
        }
        const executionOrigin = resolveVerifiedRebalancePlanEventOrigin(planHistory, execution.event.planEventId);
        if (Date.parse(execution.predecessorOrigin.appendedAt) >= Date.parse(risk.decidedAt) ||
          Date.parse(predecessorOrigin.committedAt) >= Date.parse(risk.decidedAt) || Date.parse(executionOrigin.appendedAt) >= Date.parse(event.asOf)) {
          throw new Error("capacity consumption source chronology mismatch");
        }
        if (riskOrigin.planOrigin !== null) {
          const { observedAt: receiptObservedAt, ...receipt } = riskOrigin.planOrigin;
          const expected = { planId: execution.planOrigin.record.planId, planHash: execution.planOrigin.record.planHash,
            planCommitHash: execution.planOrigin.commitHash, planAppendedAt: execution.planOrigin.appendedAt,
            predecessorEventId: execution.predecessorOrigin.event.planEventId, predecessorEventHash: execution.predecessorOrigin.event.planEventHash,
            predecessorCommitHash: execution.predecessorOrigin.commitHash, predecessorAppendedAt: execution.predecessorOrigin.appendedAt };
          if (!isDeepStrictEqual(receipt, expected) || Date.parse(receiptObservedAt) < Date.parse(execution.predecessorOrigin.appendedAt) ||
            Date.parse(receiptObservedAt) > Date.parse(risk.decidedAt)) throw new Error("capacity consumption Risk plan receipt mismatch");
        }
        if (usedFills.has(fill.fillId) || usedRisk.has(risk.riskDecisionId)) throw new Error("capacity consumption reuses a portfolio fill or Risk decision");
        usedFills.add(fill.fillId); usedRisk.add(risk.riskDecisionId); verifiedIds.add(event.capacityReservationEventId);
        return Object.freeze({ event, mandateBinding, consumedNotionalKrw, execution: binding,
          planOrigin: execution.planOrigin, executionOrigin, predecessorOrigin, riskOrigin, mandateState,
          eventOrigin: resolveStoredOpeningCapacityEventOrigin(history, event.capacityReservationEventId),
          fillOrigin: resolvePersistedPaperFillExecutionOrigin(paperFillHistory, event.paperFillRecordId),
          priceOrigin: resolveVerifiedSourcePriceEvidenceOrigin(sourcePriceEvidenceHistory, binding.sourcePriceEvidence.evidenceRef) });
      });
      const assessment = Object.freeze({ verificationScope: "stored_manual_capacity_fill_origins_only" as const,
        portfolioId: input.portfolioId, mandateAssessmentHash: mandates.assessmentHash, bindingsHash: hashCanonicalPayload(bindings),
        verifiedFillCount: bindings.length, planGenerationHash: planHistory.generationHash, planObservedAt,
        riskRecordsHash: hashCanonicalPayload(riskDecisionHistory.records), fillRecordsHash: hashCanonicalPayload(paperFillHistory.records),
        priceObservation, mandateObservation, eventGenerationHash: history.generationHash, eventObservedAt: observedAt,
        mandateAvailabilityBeforeRisk: "not_proven_for_receiptless_risk" as const,
        unverifiedEventIds: Object.freeze(selected.filter((event) => !verifiedIds.has(event.capacityReservationEventId)).map((event) => event.capacityReservationEventId)),
        riskPolicyAndRuleAuthority: "not_verified" as const, accountingAndResultingPositionAuthority: "not_verified" as const,
        priceFreshnessAndTrust: "not_evaluated" as const, slotAndBudgetAllocationAuthority: "not_verified" as const,
        currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
      return Object.freeze({ mandates, bindings: Object.freeze(bindings), assessment, assessmentHash: hashCanonicalPayload(assessment) });
    });
    });
  });
}

function reservationScope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
