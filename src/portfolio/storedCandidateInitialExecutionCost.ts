import { calculateCandidateInitialExecutionCost } from "./candidateInitialExecutionCost.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateBoundedNotional } from "./storedCandidateBoundedNotional.js";

/** Reuse the same verified source chain; never perform a second independent liquidity lookup. */
export async function resolveStoredCandidateInitialExecutionCost(
  input: Parameters<typeof resolveStoredCandidateBoundedNotional>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateBoundedNotional>[1]> = {}
) {
  const notionalReplay = await resolveStoredCandidateBoundedNotional(input, options);
  const costBasisReplay = notionalReplay.boundsReplay.classificationReplay.cashReplay.costBasisReplay;
  const calculation = calculateCandidateInitialExecutionCost({ boundedNotional: notionalReplay.calculation,
    dailyLiquidity: costBasisReplay.liquidityReplay.calculation });
  const assessment = Object.freeze({ verificationScope: "stored_initial_notional_cost_repricing_only" as const,
    notionalAssessmentHash: notionalReplay.assessmentHash, calculationHash: calculation.calculationHash,
    fitsDeclaredCash: calculation.fitsDeclaredCash,
    evidenceAndHardGateConditionsSatisfied: costBasisReplay.assessment.evidenceAndHardGateConditionsSatisfied,
    costParameterAuthority: "as_of_policy_bound" as const, exactCandidateCaps: "not_verified" as const,
    costBenefitThreshold: "not_evaluated" as const, amountAdjustment: "not_performed" as const,
    currentExecutionAuthority: "not_granted" as const, finalSizing: "not_performed" as const });
  return Object.freeze({ notionalReplay, calculation, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
