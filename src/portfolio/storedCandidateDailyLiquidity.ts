import { isDeepStrictEqual } from "node:util";
import { calculateCandidateDailyLiquidity, CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION } from "./candidateDailyLiquidity.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredPolicyCandidateExecutionCost } from "./storedPolicyCandidateExecutionCost.js";

/** Historical daily-bar liquidity replay; not trusted market liquidity, sizing or current execution authority. */
export async function resolveStoredCandidateDailyLiquidity(
  input: Parameters<typeof resolveStoredPolicyCandidateExecutionCost>[0],
  options: NonNullable<Parameters<typeof resolveStoredPolicyCandidateExecutionCost>[1]> = {}
) {
  const policyCostReplay = await resolveStoredPolicyCandidateExecutionCost(input, options);
  const scoreReplay = policyCostReplay.costReplay.hardGateAssessment.evidenceAssessment.scoreReplay;
  if (scoreReplay.selectionPolicy.liquidityEstimationModelVersion !== CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION) {
    throw new Error("candidate daily liquidity model is not selected by the as-of selection policy");
  }
  const calculation = calculateCandidateDailyLiquidity({ modelVersion: CANDIDATE_DAILY_LIQUIDITY_MODEL_VERSION,
    evidence: scoreReplay.evidenceOrigin.binding.evidence,
    maximumParticipationRatio: policyCostReplay.assessment.executionParameters.maxVolumeParticipationRate });
  if (!isDeepStrictEqual(scoreReplay.sizingInputOrigin.record.liquidityInput, calculation.liquidityInput)) {
    throw new Error("stored candidate liquidity differs from actual daily evidence and policy replay");
  }
  const assessment = Object.freeze({ verificationScope: "stored_daily_bar_liquidity_only" as const,
    sizingInputHash: scoreReplay.sizingInputOrigin.record.sizingInputHash,
    policyCostAssessmentHash: policyCostReplay.assessmentHash, liquidityOutputHash: calculation.outputHash,
    liquidityModelSelection: "as_of_selection_policy_bound" as const,
    liquidityParameterAuthority: "as_of_policy_bound" as const, sourceTrust: "not_evaluated" as const,
    historicalDiskAvailability: "not_proven" as const,
    evidenceAndHardGateConditionsSatisfied: policyCostReplay.assessment.evidenceAndHardGateConditionsSatisfied });
  return Object.freeze({ policyCostReplay, calculation, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
