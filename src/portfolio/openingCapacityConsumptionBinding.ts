import { isDeepStrictEqual } from "node:util";
import { getDurableInvestmentMandateObservation, resolveObservedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { bindOpeningCapacityMandateOrigins, type OpeningCapacityMandateSources } from "./openingCapacityMandateBinding.js";
import { getDurableOpeningCapacityEventObservedAt, resolveStoredOpeningCapacityEventOrigin } from "./openingCapacityReservationEventFiles.js";
import { assertHeldPaperFillExecutionSource, getHeldPaperFillExecutionObservation, resolvePersistedPaperFillExecutionOrigin,
  type VerifiedPaperFillExecutionHistory } from "./paperFillExecutionFiles.js";
import { assertHeldPortfolioActionRiskDecisionSource, getHeldPortfolioActionRiskDecisionObservation, resolveVerifiedPortfolioActionRiskDecisionOrigin,
  type VerifiedPortfolioActionRiskDecisionHistory } from "./portfolioActionRiskDecisionFiles.js";
import { riskDecisionMandateIdentity, validateRiskDecisionMandateState } from "./portfolioActionRiskDecisionMandateContext.js";
import { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import type { RebalancePlanEvent } from "./rebalancePlanEvent.js";
import { assertHeldRebalancePlanEventSource, getHeldRebalancePlanEventObservation, resolveDurableRebalancePlanEventObservation,
  resolveVerifiedRebalancePlanEventOrigin, type VerifiedRebalancePlanEventHistory } from "./rebalancePlanEventFiles.js";
import { replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import { validateRebalancePlanExecutionFillRiskBinding } from "./rebalancePlanExecutionFillRiskBinding.js";
import { assertDurableSourcePriceEvidenceSource, getDurableSourcePriceEvidenceObservation, resolveVerifiedSourcePriceEvidenceOrigin,
  type VerifiedSourcePriceEvidenceHistory } from "./sourcePriceEvidenceFiles.js";

export interface OpeningCapacityConsumptionSources extends OpeningCapacityMandateSources {
  readonly planEvents: VerifiedRebalancePlanEventHistory;
  readonly risks: VerifiedPortfolioActionRiskDecisionHistory;
  readonly fills: VerifiedPaperFillExecutionHistory;
  readonly prices: VerifiedSourcePriceEvidenceHistory;
}

/** Synchronous binding of every portfolio consumption under actual caller-held source leases.
 * No reads, writes, locks, allocation, release, remaining-budget or execution authority. Results are not leases.
 */
export function bindOpeningCapacityConsumptionOrigins(input: Parameters<typeof bindOpeningCapacityMandateOrigins>[0], sources: OpeningCapacityConsumptionSources) {
  // This also validates the strict canonical query and every actual root/mandate source, including terminal scopes.
  const mandates = bindOpeningCapacityMandateOrigins(input, sources);
  const { planEvents, risks, fills, prices, events } = sources;
  assertHeldRebalancePlanEventSource(planEvents, input.baseDir);
  assertHeldPortfolioActionRiskDecisionSource(risks, input.baseDir);
  assertHeldPaperFillExecutionSource(fills, input.baseDir);
  assertDurableSourcePriceEvidenceSource(prices, input.baseDir);
  const times = [getDurableSourcePriceEvidenceObservation(prices).observedAt,
    getHeldRebalancePlanEventObservation(planEvents).observedAt, getDurableInvestmentMandateObservation(sources.mandates).observedAt,
    getHeldPortfolioActionRiskDecisionObservation(risks).observedAt, getHeldPaperFillExecutionObservation(fills).observedAt,
    getDurableOpeningCapacityEventObservedAt(events)].map(Date.parse);
  if (times.some((time, index) => index > 0 && time < times[index - 1]!)) throw new Error("capacity consumption observation clock moved backwards");
  const groups = new Map<string, RebalancePlanEvent[]>();
  for (const event of planEvents.events) if (event.portfolioId === input.portfolioId) {
    const group = groups.get(event.planId) ?? []; group.push(event); groups.set(event.planId, group);
  }
  const executions = [...groups].flatMap(([planId, planHistory]) => {
    const planOrigin = resolveDurableRebalancePlanEventObservation(planEvents, planId).plan;
    return replayRebalancePlanExecutionContexts({ plan: planOrigin.record, events: planHistory }).executionContexts.map((context) => ({
      ...context, planOrigin, predecessorOrigin: resolveVerifiedRebalancePlanEventOrigin(planEvents, planHistory[context.eventIndex - 1]!.planEventId)
    }));
  });
  const byFill = new Map(executions.map((execution) => [execution.event.paperFillRecordId, execution]));
  if (byFill.size !== executions.length) throw new Error("capacity consumption fill is referenced by multiple plan executions");
  const byReservation = new Map(mandates.bindings.map((binding) => [scope(binding.event), binding]));
  const usedFills = new Set<string>(), usedRisks = new Set<string>();
  const bindings = events.events.filter((event) => event.portfolioId === input.portfolioId &&
    (event.eventType === "partially_consumed" || event.eventType === "consumed_by_position")).map((event) => {
    if (event.eventType !== "partially_consumed" && event.eventType !== "consumed_by_position") throw new Error("capacity consumption event required");
    const mandateBinding = byReservation.get(scope(event)), execution = byFill.get(event.paperFillRecordId);
    if (!mandateBinding || !execution) throw new Error("capacity consumption has no actual mandate or plan execution source");
    const binding = validateRebalancePlanExecutionFillRiskBinding({ event: execution.event,
      riskDecisionHistory: risks, paperFillHistory: fills, sourcePriceEvidenceHistory: prices });
    const fill = binding.paperFill, risk = binding.riskDecision;
    const planState = validateRiskDecisionPlanState(risk, execution.priorState);
    const action = execution.planOrigin.record.actions[execution.event.actionSequence]!;
    if (action.lineageKind !== "mandate" || action.mandateId !== mandateBinding.mandate.mandateId || action.side !== "BUY" ||
      event.paperFillHash !== fill.paperFillHash || event.fillId !== fill.fillId || fill.portfolioId !== input.portfolioId || fill.side !== "BUY" ||
      fill.market !== mandateBinding.mandate.market || fill.symbol !== mandateBinding.mandate.symbol || risk.policyHash !== event.policyHash ||
      risk.riskRuleScope.scopeKind !== "bucket" || risk.riskRuleScope.bucket !== event.bucket) {
      throw new Error("capacity consumption fill scope or mandate lineage mismatch");
    }
    const predecessorOrigin = resolveStoredOpeningCapacityEventOrigin(events, event.previousCapacityReservationEventId);
    const consumedNotionalKrw = predecessorOrigin.event.remainingReservedNotionalKrw - event.remainingReservedNotionalKrw;
    if (consumedNotionalKrw !== fill.filledNotionalKrw) throw new Error("capacity consumption differs from actual filled notional");
    const riskOrigin = resolveVerifiedPortfolioActionRiskDecisionOrigin(risks, risk.riskDecisionId);
    const mandateState = validateRiskDecisionMandateState(planState, riskOrigin.mandateOrigin === null ? sources.mandates
      : resolveObservedInvestmentMandateHistory(sources.mandates, riskOrigin.mandateOrigin.observation));
    if (!isDeepStrictEqual(mandateState.record, mandateBinding.mandate)) throw new Error("capacity consumption Risk mandate source mismatch");
    if (riskOrigin.mandateOrigin !== null) {
      const { observation, ...identity } = riskOrigin.mandateOrigin;
      if (!isDeepStrictEqual(identity, riskDecisionMandateIdentity(mandateState)) || Date.parse(observation.observedAt) > Date.parse(risk.decidedAt)) {
        throw new Error("capacity consumption Risk mandate receipt mismatch");
      }
    }
    const executionOrigin = resolveVerifiedRebalancePlanEventOrigin(planEvents, execution.event.planEventId);
    const fillOrigin = resolvePersistedPaperFillExecutionOrigin(fills, event.paperFillRecordId);
    if (Date.parse(execution.predecessorOrigin.appendedAt) >= Date.parse(risk.decidedAt) ||
      Date.parse(predecessorOrigin.committedAt) >= Date.parse(risk.decidedAt) || Date.parse(executionOrigin.appendedAt) >= Date.parse(event.asOf) ||
      (fillOrigin.completion !== null && Date.parse(fillOrigin.completion.completedAt) >= Date.parse(execution.event.asOf))) {
      throw new Error("capacity consumption source chronology mismatch");
    }
    if (riskOrigin.planOrigin !== null) {
      const { observedAt, ...receipt } = riskOrigin.planOrigin;
      const expected = { planId: execution.planOrigin.record.planId, planHash: execution.planOrigin.record.planHash,
        planCommitHash: execution.planOrigin.commitHash, planAppendedAt: execution.planOrigin.appendedAt,
        predecessorEventId: execution.predecessorOrigin.event.planEventId, predecessorEventHash: execution.predecessorOrigin.event.planEventHash,
        predecessorCommitHash: execution.predecessorOrigin.commitHash, predecessorAppendedAt: execution.predecessorOrigin.appendedAt };
      if (!isDeepStrictEqual(receipt, expected) || Date.parse(observedAt) < Date.parse(execution.predecessorOrigin.appendedAt) ||
        Date.parse(observedAt) > Date.parse(risk.decidedAt)) throw new Error("capacity consumption Risk plan receipt mismatch");
    }
    if (usedFills.has(fill.fillId) || usedRisks.has(risk.riskDecisionId)) throw new Error("capacity consumption reuses a portfolio fill or Risk decision");
    usedFills.add(fill.fillId); usedRisks.add(risk.riskDecisionId);
    return Object.freeze({ event, mandateBinding, consumedNotionalKrw, execution: binding, planOrigin: execution.planOrigin,
      executionOrigin, predecessorOrigin, riskOrigin, mandateState, fillOrigin,
      eventOrigin: resolveStoredOpeningCapacityEventOrigin(events, event.capacityReservationEventId),
      priceOrigin: resolveVerifiedSourcePriceEvidenceOrigin(prices, binding.sourcePriceEvidence.evidenceRef) });
  });
  return Object.freeze({ mandates, bindings: Object.freeze(bindings) });
}

function scope(event: { portfolioId: string; policyHash: string; bucket: string; reservationId: string }) {
  return JSON.stringify([event.portfolioId, event.policyHash, event.bucket, event.reservationId]);
}
