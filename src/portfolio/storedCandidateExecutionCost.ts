import { replayCandidateSizingExecutionCost } from "./candidateExecutionCost.js";
import { hashCanonicalPayload } from "./runtimePolicyContracts.js";
import { assessStoredCandidateHardGates } from "./storedCandidateHardGates.js";

/** Actual stored input replay; declared cost sources/parameters still need policy and source authentication. */
export async function resolveStoredCandidateExecutionCost(
  input: Parameters<typeof assessStoredCandidateHardGates>[0],
  options: Parameters<typeof assessStoredCandidateHardGates>[1] = {}
) {
  const hardGateAssessment = await assessStoredCandidateHardGates(input, options);
  const replay = replayCandidateSizingExecutionCost(hardGateAssessment.evidenceAssessment.scoreReplay.sizingInputOrigin.record);
  const assessment = Object.freeze({ verificationScope: "stored_reference_notional_cost_only" as const,
    sizingInputHash: replay.sizingInput.sizingInputHash, hardGateEvaluationHash: hardGateAssessment.evaluationHash,
    costInputHash: replay.calculation.inputHash, costOutputHash: replay.calculation.outputHash,
    estimatedCostKrw: replay.calculation.estimatedCostKrw,
    evidenceAndHardGateConditionsSatisfied: hardGateAssessment.evaluation.contentChecksPassed,
    costParameterAuthority: "not_verified" as const, costEvidenceAuthority: "not_verified" as const,
    fillSimulation: "not_performed" as const });
  return Object.freeze({ hardGateAssessment, calculation: replay.calculation, assessment,
    assessmentHash: hashCanonicalPayload(assessment) });
}
