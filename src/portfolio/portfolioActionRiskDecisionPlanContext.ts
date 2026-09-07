import { z } from "zod";
import { sha256HashSchema } from "../domain/schemas.js";
import { offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";
import { hashRebalanceExecutionTarget } from "./rebalancePlan.js";
import { RebalancePlanFileRepository } from "./rebalancePlanFiles.js";
import { RebalancePlanEventFileRepository, replayVerifiedRebalancePlanEventHistory, resolveVerifiedRebalancePlanEventOrigin, resolveDurableRebalancePlanEventObservation } from "./rebalancePlanEventFiles.js";
import { replayRebalancePlanEvents } from "./rebalancePlanEventReplay.js";
import { parsePortfolioActionRiskDecision } from "./portfolioActionRiskDecision.js";
import { canonicalQuantityUnits } from "./canonicalQuantity.js";

export const riskDecisionPlanOriginSchema = z.object({
  planId: z.string().min(1).max(240), planHash: sha256HashSchema, planCommitHash: sha256HashSchema,
  planAppendedAt: offsetQualifiedIsoDateTimeSchema,
  predecessorEventId: z.string().min(1).max(240), predecessorEventHash: sha256HashSchema,
  predecessorCommitHash: sha256HashSchema, predecessorAppendedAt: offsetQualifiedIsoDateTimeSchema,
  observedAt: offsetQualifiedIsoDateTimeSchema
}).strict();
export type RiskDecisionPlanOrigin = Readonly<z.infer<typeof riskDecisionPlanOriginSchema>>;

/** Reads the configured store; an explicit predecessor is for historical explanation only. */
export async function readStoredRiskDecisionPlanContext(input: { baseDir: string; planId: string; predecessorEventId?: string }) {
  const parsed = z.object({ baseDir: z.string().min(1), planId: z.string().min(1), predecessorEventId: z.string().min(1).optional() }).strict().parse(input);
  const plans = new RebalancePlanFileRepository(parsed.baseDir);
  const events = new RebalancePlanEventFileRepository(parsed.baseDir, plans);
  const history = await events.readDurableVerifiedHistory();
  const latest = replayVerifiedRebalancePlanEventHistory(history, parsed.planId);
  const predecessorId = parsed.predecessorEventId ?? latest.lastEvent.planEventId;
  const index = latest.events.findIndex((event) => event.planEventId === predecessorId);
  if (index < 0) throw new Error("risk plan predecessor does not belong to stored plan history");
  const state = index === latest.events.length - 1 ? latest : replayRebalancePlanEvents({ plan: latest.plan, events: latest.events.slice(0, index + 1) });
  const predecessor = resolveVerifiedRebalancePlanEventOrigin(history, predecessorId);
  const { plan, observedAt } = resolveDurableRebalancePlanEventObservation(history, parsed.planId);
  if (predecessor.planCommitHash !== plan.commitHash) throw new Error("risk plan origin changed during observation");
  if (Date.parse(observedAt) < Date.parse(plan.appendedAt) || Date.parse(observedAt) < Date.parse(predecessor.appendedAt)) {
    throw new Error("risk plan observation clock precedes stored availability");
  }
  const origin: RiskDecisionPlanOrigin = Object.freeze({
    planId: plan.record.planId, planHash: plan.record.planHash, planCommitHash: plan.commitHash, planAppendedAt: plan.appendedAt,
    predecessorEventId: predecessor.event.planEventId, predecessorEventHash: predecessor.event.planEventHash,
    predecessorCommitHash: predecessor.commitHash, predecessorAppendedAt: predecessor.appendedAt, observedAt
  });
  return Object.freeze({ state, origin });
}

/** Content/state checks; mandate source, rule calculations and execution transaction are separate. */
export function validateRiskDecisionPlanState(value: unknown, state: ReturnType<typeof replayRebalancePlanEvents>) {
  const decision = parsePortfolioActionRiskDecision(value);
  const plan = state.plan;
  if (state.status !== "approved" && state.status !== "execution_applied") throw new Error("risk decision requires approved unfinished plan history");
  const progress = state.actions.find((action) => !action.complete);
  if (progress === undefined || progress.actionId !== decision.actionId) throw new Error("risk decision must target the next unfinished action");
  const action = plan.actions[progress.actionSequence]!;
  if (decision.planId !== plan.planId || decision.portfolioId !== plan.portfolioId || decision.policyHash !== plan.policyHash ||
    decision.market !== action.market || decision.symbol !== action.symbol || decision.side !== action.side ||
    decision.actionExecutionTargetHash !== hashRebalanceExecutionTarget(action.executionTarget)) throw new Error("risk decision plan or action scope mismatch");
  if ((action.lineageKind === "mandate") !== (decision.riskRuleScope.scopeKind === "bucket")) throw new Error("risk decision plan lineage scope mismatch");
  if (decision.expectedPortfolioVersion !== state.executionPortfolioVersion || decision.expectedPortfolioSnapshotHash !== state.executionPortfolioSnapshotHash ||
    decision.priorCumulativeFilledNotionalKrw !== progress.cumulativeFilledNotionalKrw || decision.priorCumulativeFilledQuantity !== progress.cumulativeFilledQuantity) {
    throw new Error("risk decision pre-state or prior cumulative mismatch");
  }
  // Rejections may record an over-cap request; only approvals can permit a fill.
  if (decision.decision === "approved") {
    const remainingCap = action.maximumNotionalKrw - progress.cumulativeFilledNotionalKrw;
    if (![decision.requestedNotionalKrw, decision.worstCaseFillNotionalKrw, decision.approvedMaximumFillNotionalKrw].every(Number.isSafeInteger) ||
      decision.requestedNotionalKrw > remainingCap || decision.worstCaseFillNotionalKrw > remainingCap ||
      decision.approvedMaximumFillNotionalKrw > remainingCap) throw new Error("risk approval exceeds remaining action notional cap");
    const target = action.executionTarget;
    if (target.targetKind === "fractional_buy_notional") {
      const remaining = target.targetNotionalKrw - progress.cumulativeFilledNotionalKrw;
      if (decision.requestedNotionalKrw > remaining || decision.approvedMaximumFillNotionalKrw > remaining) throw new Error("risk approval exceeds remaining buy target");
    } else {
      if (canonicalQuantityUnits(decision.requestedQuantity) > canonicalQuantityUnits(target.targetQuantity) - canonicalQuantityUnits(progress.cumulativeFilledQuantity)) {
        throw new Error("risk approval exceeds remaining quantity target");
      }
      if (target.targetKind === "whole_share_quantity" && !Number.isSafeInteger(decision.requestedQuantity)) throw new Error("risk approval requires whole-share quantity");
    }
  }
  return Object.freeze({ decision, action, progress });
}
