import { isDeepStrictEqual } from "node:util";
import { getDurableInvestmentMandateObservation, resolveObservedInvestmentMandateHistory,
  type VerifiedInvestmentMandateHistory } from "./investmentMandateFiles.js";
import { resolveCurrentInvestmentMandateAsOf } from "./investmentMandateState.js";
import { riskDecisionMandateIdentity, validateRiskDecisionMandateState } from "./portfolioActionRiskDecisionMandateContext.js";
import { validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";
import { replayRebalancePlanExecutionContexts } from "./rebalancePlanEventReplay.js";
import type { bindSnapshotPendingExecutionOrigins } from "./snapshotPendingExecutionBinding.js";
import type { bindSnapshotPendingPlanProgress } from "./snapshotPendingPlanBinding.js";
import type { resolveStoredPendingPlanActionProgress } from "./storedPendingPlanActionProgress.js";

/** Current publisher only. Mandate contents/lifecycle and reservation references are not reservation balance authority. */
export function bindSnapshotPendingMandateOrigins(
  progress: Awaited<ReturnType<typeof resolveStoredPendingPlanActionProgress>>,
  pendingBindings: ReturnType<typeof bindSnapshotPendingPlanProgress>,
  executionBindings: ReturnType<typeof bindSnapshotPendingExecutionOrigins>,
  history: VerifiedInvestmentMandateHistory
) {
  const observation = getDurableInvestmentMandateObservation(history);
  if ([...history.records, ...history.events].some((record) => Date.parse(record.createdAt) > Date.parse(observation.observedAt))) {
    throw new Error("sizing snapshot mandate source creation follows its observation");
  }
  const plans = new Map(progress.projection.planReplays.map((item) => [item.calculation.input.plan.planId, item.calculation.input.plan]));
  for (const { pending, remaining } of pendingBindings) {
    const action = remaining.action;
    if (action.lineageKind !== "mandate") continue; // Legacy SELL remains reduce-only and has no fabricated mandate.
    const plan = plans.get(pending.planId)!;
    const mandate = resolveCurrentInvestmentMandateAsOf({ ...history, mandateId: action.mandateId,
      portfolioId: plan.portfolioId, policyHash: plan.policyHash, market: action.market, symbol: action.symbol,
      asOf: pending.asOf, knownAt: pending.asOf });
    if (pending.side !== "BUY") continue;
    const record = mandate.record;
    if (mandate.status !== "active" || (record.assignmentSource === "manual_policy" &&
      record.manualAuthorizationScope === "classify_existing_reduce_only")) {
      throw new Error("sizing snapshot pending BUY requires an active opening mandate");
    }
    const reservation = record.assignmentSource === "deterministic_selector"
      ? { id: record.openingCapacityReservationId, hash: record.openingCapacityReservationHash }
      : { id: record.capacityReservation.manualCapacityReservationId, hash: record.capacityReservation.manualCapacityReservationHash };
    if (pending.openingCapacityReservationId !== reservation.id || pending.openingCapacityReservationHash !== reservation.hash) {
      throw new Error("sizing snapshot pending BUY reservation differs from stored mandate");
    }
  }
  const executions = new Map(executionBindings.map((binding) => [binding.event.planEventId, binding]));
  for (const replay of progress.projection.planReplays) {
    const { plan, events } = replay.calculation.input;
    for (const { event, priorState } of replayRebalancePlanExecutionContexts({ plan, events }).executionContexts) {
      const execution = executions.get(event.planEventId);
      if (execution === undefined) throw new Error("sizing snapshot mandate execution binding is missing");
      const binding = validateRiskDecisionPlanState(execution.riskDecision, priorState);
      if (binding.action.lineageKind !== "mandate") continue;
      const current = validateRiskDecisionMandateState(binding, history);
      const receipt = execution.riskOrigin.mandateOrigin;
      if (receipt === null) continue; // Historical records lack receipts; do not manufacture past durable availability.
      const { observation: priorObservation, ...identity } = receipt;
      const observed = resolveObservedInvestmentMandateHistory(history, priorObservation);
      const prior = validateRiskDecisionMandateState(binding, observed);
      if (Date.parse(priorObservation.observedAt) > Date.parse(binding.decision.decidedAt) ||
        !isDeepStrictEqual(identity, riskDecisionMandateIdentity(prior)) ||
        !isDeepStrictEqual(identity, riskDecisionMandateIdentity(current))) {
        throw new Error("sizing snapshot Risk mandate receipt mismatch");
      }
    }
  }
}
