import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { subtractCanonicalQuantities } from "./canonicalQuantity.js";
import { hashRebalanceExecutionTarget } from "./rebalancePlan.js";
import { replayRebalancePlanEvents } from "./rebalancePlanEventReplay.js";
import { hashCanonicalPayload, offsetQualifiedIsoDateTimeSchema } from "./runtimePolicyContracts.js";

export const PENDING_PLAN_ACTION_PROGRESS_MODEL_VERSION = "pending_plan_action_progress.v1";
const inputSchema = z.object({
  modelVersion: z.literal(PENDING_PLAN_ACTION_PROGRESS_MODEL_VERSION),
  plan: z.unknown(), events: z.array(z.unknown()).min(1).max(100_000), asOf: offsetQualifiedIsoDateTimeSchema
}).strict();

/** All unfinished actions, not just the next executable action. Supplied content is not a storage origin. */
export function calculatePendingPlanActionProgress(value: z.input<typeof inputSchema>) {
  const parsed = inputSchema.parse(value);
  const state = replayRebalancePlanEvents({ plan: parsed.plan, events: parsed.events });
  const input = { ...parsed, plan: state.plan, events: state.events };
  if (!isDeepStrictEqual(value, input)) throw new Error("pending plan progress input must already be canonical");
  if (Date.parse(state.lastEvent.asOf) > Date.parse(input.asOf)) throw new Error("pending plan progress includes a future event");
  const active = state.status === "approved" || state.status === "execution_applied";
  const pendingActions = (active ? state.actions.filter((progress) => !progress.complete) : []).map((progress) => {
    const action = state.plan.actions[progress.actionSequence]!;
    const target = action.executionTarget;
    return {
      planId: state.plan.planId, planHash: state.plan.planHash, portfolioId: state.plan.portfolioId,
      policyHash: state.plan.policyHash, planEventId: state.lastEvent.planEventId, planEventHash: state.lastEvent.planEventHash,
      action, actionExecutionTargetHash: hashRebalanceExecutionTarget(target), progress,
      remainingNotionalCapKrw: action.maximumNotionalKrw - progress.cumulativeFilledNotionalKrw,
      remainingTargetNotionalKrw: target.targetKind === "fractional_buy_notional"
        ? target.targetNotionalKrw - progress.cumulativeFilledNotionalKrw : null,
      remainingQuantity: target.targetKind === "fractional_buy_notional" ? null
        : subtractCanonicalQuantities(target.targetQuantity, progress.cumulativeFilledQuantity)
    };
  });
  const payload = { input, status: state.status, pendingActions,
    verificationScope: "plan_action_progress_content_only" as const,
    valuationAndReservationAuthority: "not_verified" as const, currentExecutionAuthority: "not_granted" as const };
  return deepFreeze({ ...payload, calculationHash: hashCanonicalPayload(payload) });
}

/** Recomputes the complete result, so rehashing a forged remainder cannot make it valid. */
export function parsePendingPlanActionProgress(value: unknown): ReturnType<typeof calculatePendingPlanActionProgress> {
  const envelope = z.object({ input: inputSchema }).passthrough().parse(value);
  const result = calculatePendingPlanActionProgress(envelope.input);
  if (!isDeepStrictEqual(value, result)) throw new Error("pending plan progress result differs from independent replay");
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
