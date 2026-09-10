import { isDeepStrictEqual } from "node:util";
import { calculateCandidateDailyCostBasis, CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION } from "./candidateDailyCostBasis.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { resolveStoredCandidateDailyLiquidity } from "./storedCandidateDailyLiquidity.js";

/** Historical cost basis from stored daily liquidity. Does not authenticate provider data or choose final sizing. */
export async function resolveStoredCandidateDailyCostBasis(
  input: Parameters<typeof resolveStoredCandidateDailyLiquidity>[0],
  options: NonNullable<Parameters<typeof resolveStoredCandidateDailyLiquidity>[1]> = {}
) {
  const liquidityReplay = await resolveStoredCandidateDailyLiquidity(input, options);
  const scoreReplay = liquidityReplay.policyCostReplay.costReplay.hardGateAssessment.evidenceAssessment.scoreReplay;
  if (scoreReplay.selectionPolicy.costBasisModelVersion !== CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION) {
    throw new Error("candidate daily cost basis model is not selected by the as-of selection policy");
  }
  const { referenceNotionalKrw, participationRate, evidenceRefs } = scoreReplay.sizingInputOrigin.record.executionCostInput;
  const calculation = calculateCandidateDailyCostBasis({ modelVersion: CANDIDATE_DAILY_COST_BASIS_MODEL_VERSION,
    liquidity: liquidityReplay.calculation, referenceNotionalKrw });
  if (!isDeepStrictEqual({ referenceNotionalKrw, participationRate, evidenceRefs }, calculation.costBasis)) {
    throw new Error("stored candidate cost basis differs from actual daily liquidity replay");
  }
  const assessment = Object.freeze({ verificationScope: "stored_daily_liquidity_cost_basis_only" as const,
    sizingInputHash: scoreReplay.sizingInputOrigin.record.sizingInputHash, liquidityAssessmentHash: liquidityReplay.assessmentHash,
    costBasisOutputHash: calculation.outputHash, costBasisModelSelection: "as_of_selection_policy_bound" as const,
    costEvidenceBinding: "stored_daily_bar_proxy" as const, referenceNotionalAuthority: "declared_within_liquidity_cap" as const,
    sourceTrust: "not_evaluated" as const, finalSizing: "not_performed" as const,
    evidenceAndHardGateConditionsSatisfied: liquidityReplay.assessment.evidenceAndHardGateConditionsSatisfied });
  return Object.freeze({ liquidityReplay, calculation, assessment, assessmentHash: hashCanonicalPayload(assessment) });
}
