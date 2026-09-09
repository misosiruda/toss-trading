import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { resolvePortfolioActionRiskDecisionPolicy } from "./portfolioActionRiskDecisionPolicyResolver.js";
import { readStoredRiskDecisionPlanContext, validateRiskDecisionPlanState } from "./portfolioActionRiskDecisionPlanContext.js";

/** Historical source explanation. Recheck current state and Risk rules in the execution transaction. */
export async function resolvePortfolioActionRiskDecisionPlan(input: { baseDir: string; riskDecisionId: string },
  options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {
  const lockOptions = { ...options };
  const parsed = z.object({ baseDir: z.string().min(1), riskDecisionId: z.string().min(1) }).strict().parse(input);
  const policy = await resolvePortfolioActionRiskDecisionPolicy(parsed, lockOptions);
  const receipt = policy.origin.planOrigin;
  if (receipt === null) throw new Error("risk decision lacks plan-before-creation provenance; legacy record requires review");
  const context = await readStoredRiskDecisionPlanContext({ baseDir: parsed.baseDir, planId: policy.decision.planId, predecessorEventId: receipt.predecessorEventId }, lockOptions);
  const { observedAt: _storedTime, ...stored } = receipt;
  const { observedAt: _currentTime, ...current } = context.origin;
  if (!isDeepStrictEqual(stored, current)) throw new Error("risk decision plan origin does not match stored sources");
  const binding = validateRiskDecisionPlanState(policy.decision, context.state);
  return Object.freeze({ ...policy, ...binding, plan: context.state.plan, priorState: context.state, planOrigin: receipt });
}
